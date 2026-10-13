const express = require('express');
const pool = require('../db');
const { monthlyCost, enrich, formatISO } = require('../billing');
const { sendMail } = require('../mailer');
const { buildEmail } = require('../reminders');
const { requireAdmin } = require('../middleware/auth');
const { validatePassword, validateNewUser, createUser, setPassword } = require('../users');
const { DEMO_SUBS, addSubscriptions } = require('../demoData');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', async (req, res) => {
  const [users] = await pool.query(`
    SELECT u.id, u.email, u.name, u.role, u.is_active, u.reminders_enabled, u.created_at, u.last_login_at,
           COUNT(s.id) AS sub_count
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    GROUP BY u.id, u.email, u.name, u.role, u.is_active, u.reminders_enabled, u.created_at, u.last_login_at
    ORDER BY u.created_at, u.id`);

  const [subs] = await pool.query('SELECT user_id, amount, billing_cycle FROM subscriptions WHERE is_active = 1');
  const monthlyByUser = new Map();
  for (const s of subs) {
    monthlyByUser.set(s.user_id, (monthlyByUser.get(s.user_id) || 0) + monthlyCost(s.amount, s.billing_cycle));
  }

  res.render('admin/users', {
    title: 'Benutzerverwaltung',
    users: users.map((u) => ({ ...u, monthly: monthlyByUser.get(u.id) || 0 })),
  });
});

// ---- Neuen Benutzer erstellen ----
function renderNewUser(res, values, error, status = 200) {
  res.status(status).render('admin/user-new', { title: 'Neuen Benutzer erstellen', values, error });
}

router.get('/users/new', (req, res) => {
  renderNewUser(res, { role: 'user', demo: false }, null);
});

router.post('/users/new', async (req, res) => {
  const { values, password, error } = await validateNewUser(req.body);
  values.role = req.body.role === 'admin' ? 'admin' : 'user';
  values.demo = req.body.demo === '1';
  if (error) return renderNewUser(res, values, error, 400);

  const userId = await createUser({ ...values, password });
  const count = values.demo ? await addSubscriptions(pool, userId, DEMO_SUBS) : 0;
  req.flash('success', `${values.name} wurde erstellt${count ? ` (mit ${count} Beispiel-Abos)` : ''}.`);
  res.redirect(`${res.locals.base}/admin/users`);
});

// ---- Passwort eines beliebigen Benutzers aendern ----
async function loadUserList() {
  const [rows] = await pool.query('SELECT id, name, email FROM users ORDER BY name, id');
  return rows;
}

router.get('/password', async (req, res) => {
  res.render('admin/password', {
    title: 'Passwort ändern',
    users: await loadUserList(),
    selectedId: Number(req.query.user) || null,
    error: null,
  });
});

router.post('/password', async (req, res) => {
  const users = await loadUserList();
  const selectedId = Number(req.body.user_id) || null;
  const user = users.find((u) => u.id === selectedId);

  const error = !user
    ? 'Bitte wähle einen Benutzer aus.'
    : validatePassword(String(req.body.password || ''), String(req.body.password_confirm || ''));
  if (error) {
    return res.status(400).render('admin/password', { title: 'Passwort ändern', users, selectedId, error });
  }

  await setPassword(user.id, String(req.body.password));
  req.flash('success', `Das Passwort von ${user.name} wurde geändert.`);
  res.redirect(`${res.locals.base}/admin/users`);
});

// Alte Adresse aus der vorherigen Version weiterleiten
router.get('/users/:id/password', (req, res) => {
  res.redirect(`${res.locals.base}/admin/password?user=${Number(req.params.id) || ''}`);
});

// ---- Test-E-Mail: Beispiel-Erinnerung an den angemeldeten Admin ----
router.post('/test-mail', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 AND notice_period_days IS NOT NULL',
    [req.user.id]
  );
  let items = rows.map((s) => ({ sub: enrich(s), stage: 7 })).sort((a, b) => a.sub.cancelBy - b.sub.cancelBy).slice(0, 3);
  if (!items.length) {
    // Ohne eigene Fristen ein erfundenes Beispiel verwenden
    const nextPayment = new Date();
    nextPayment.setDate(nextPayment.getDate() + 37); // Frist damit in 7 Tagen
    items = [{ sub: enrich({ id: 0, name: 'Beispiel-Abo', amount: '9.90', billing_cycle: 'monthly', next_payment_date: formatISO(nextPayment), notice_period_days: 30 }), stage: 7 }];
  }

  try {
    await sendMail({ to: req.user.email, ...buildEmail(req.user, items, { test: true }) });
    req.flash('success', `Test-E-Mail an ${req.user.email} verschickt. Schau in dein Postfach (auch im Spam-Ordner).`);
  } catch (err) {
    req.flash('error', `Test-E-Mail fehlgeschlagen: ${err.message}`);
  }
  res.redirect(`${res.locals.base}/admin/users`);
});

// ---- Aktionen pro Benutzer ----
// Laedt den Zielbenutzer; das eigene Konto ist geschuetzt, damit sich kein Admin aussperrt.
async function targetUser(req) {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    req.flash('error', 'Du kannst dein eigenes Konto hier nicht ändern.');
    return null;
  }
  const [rows] = await pool.query('SELECT id, email, name, role, is_active FROM users WHERE id = ?', [id]);
  if (!rows[0]) req.flash('error', 'Benutzer nicht gefunden.');
  return rows[0] || null;
}

router.post('/users/:id/toggle-active', async (req, res) => {
  const user = await targetUser(req);
  if (user) {
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [user.is_active ? 0 : 1, user.id]);
    req.flash('success', `${user.name} wurde ${user.is_active ? 'gesperrt' : 'entsperrt'}.`);
  }
  res.redirect(`${res.locals.base}/admin/users`);
});

// Erinnerungen duerfen auch fuer das eigene Konto umgeschaltet werden (kein Aussperr-Risiko)
router.post('/users/:id/toggle-reminders', async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, reminders_enabled FROM users WHERE id = ?', [Number(req.params.id)]);
  const user = rows[0];
  if (!user) {
    req.flash('error', 'Benutzer nicht gefunden.');
  } else {
    const enabled = user.reminders_enabled ? 0 : 1;
    await pool.query('UPDATE users SET reminders_enabled = ? WHERE id = ?', [enabled, user.id]);
    req.flash('success', `E-Mail-Erinnerungen für ${user.name} sind jetzt ${enabled ? 'eingeschaltet' : 'ausgeschaltet'}.`);
  }
  res.redirect(`${res.locals.base}/admin/users`);
});

router.post('/users/:id/toggle-admin', async (req, res) => {
  const user = await targetUser(req);
  if (user) {
    const role = user.role === 'admin' ? 'user' : 'admin';
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
    req.flash('success', `${user.name} ist jetzt ${role === 'admin' ? 'Administrator' : 'normaler Benutzer'}.`);
  }
  res.redirect(`${res.locals.base}/admin/users`);
});

router.post('/users/:id/delete', async (req, res) => {
  const user = await targetUser(req);
  if (user) {
    await pool.query('DELETE FROM users WHERE id = ?', [user.id]);
    req.flash('success', `${user.name} und alle zugehörigen Abos wurden gelöscht.`);
  }
  res.redirect(`${res.locals.base}/admin/users`);
});

module.exports = router;
