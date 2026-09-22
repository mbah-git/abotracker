const express = require('express');
const pool = require('../db');
const { monthlyCost } = require('../billing');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAdmin);

router.get('/users', async (req, res) => {
  const [users] = await pool.query(`
    SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at, u.last_login_at,
           COUNT(s.id) AS sub_count
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    GROUP BY u.id, u.email, u.name, u.role, u.is_active, u.created_at, u.last_login_at
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

// Laedt den Zielbenutzer; das eigene Konto ist geschuetzt, damit sich kein Admin aussperrt.
async function targetUser(req) {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    req.flash('error', 'Du kannst dein eigenes Konto hier nicht ändern.');
    return null;
  }
  const [rows] = await pool.query('SELECT id, name, role, is_active FROM users WHERE id = ?', [id]);
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
