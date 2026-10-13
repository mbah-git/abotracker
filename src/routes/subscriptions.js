const express = require('express');
const pool = require('../db');
const { CYCLES, enrich, forecast, formatISO, today } = require('../billing');
const { requireLogin } = require('../middleware/auth');
const fmt = require('../format');
const { toCsv } = require('../csv');

const router = express.Router();
router.use(requireLogin);

const SUB_SELECT = `
  SELECT s.*, c.name AS category_name, c.color AS category_color
  FROM subscriptions s
  LEFT JOIN categories c ON c.id = s.category_id`;

async function loadCategories() {
  const [rows] = await pool.query('SELECT id, name, color FROM categories ORDER BY name');
  return rows;
}

async function findOwn(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return null;
  const [rows] = await pool.query(`${SUB_SELECT} WHERE s.id = ? AND s.user_id = ?`, [id, req.user.id]);
  return rows[0] || null;
}

function notFound(res) {
  return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Dieses Abo existiert nicht.' });
}

// Validiert Formulardaten und liefert { values, error, data }
function parseForm(body, categories) {
  const values = {
    name: String(body.name || '').trim(),
    amount: String(body.amount || '').trim().replace(',', '.'),
    shared_with: String(body.shared_with ?? '1').trim() || '1',
    billing_cycle: String(body.billing_cycle || ''),
    category_id: body.category_id ? Number(body.category_id) : null,
    next_payment_date: String(body.next_payment_date || ''),
    notice_period_days: String(body.notice_period_days ?? '').trim(),
    is_active: body.is_active === '1' ? 1 : 0,
    notes: String(body.notes || '').trim(),
  };

  let error = null;
  const amount = Number(values.amount);
  const notice = values.notice_period_days === '' ? null : Number(values.notice_period_days);
  const sharedWith = Number(values.shared_with);

  if (!values.name || values.name.length > 120) error = 'Bitte gib einen Namen an (max. 120 Zeichen).';
  else if (!/^\d+(\.\d{1,2})?$/.test(values.amount) || amount <= 0 || amount >= 100000000) error = 'Bitte gib einen gültigen Betrag an, z. B. 9.90.';
  else if (!Number.isInteger(sharedWith) || sharedWith < 1 || sharedWith > 20) error = 'Geteilt mit: bitte eine Zahl von 1 bis 20 angeben (1 = nicht geteilt).';
  else if (!CYCLES[values.billing_cycle]) error = 'Bitte wähle einen Abrechnungszyklus.';
  else if (values.category_id !== null && !categories.some((c) => c.id === values.category_id)) error = 'Unbekannte Kategorie.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.next_payment_date) || Number.isNaN(Date.parse(values.next_payment_date))) error = 'Bitte gib ein gültiges Zahlungsdatum an.';
  else if (notice !== null && (!Number.isInteger(notice) || notice < 0 || notice > 365)) error = 'Die Kündigungsfrist muss zwischen 0 und 365 Tagen liegen.';
  else if (values.notes.length > 500) error = 'Notizen dürfen maximal 500 Zeichen lang sein.';

  return {
    values,
    error,
    data: { ...values, amount, shared_with: sharedWith, notice_period_days: notice, notes: values.notes || null },
  };
}

// ---- Dashboard ----
router.get('/dashboard', async (req, res) => {
  const [rows] = await pool.query(`${SUB_SELECT} WHERE s.user_id = ? ORDER BY s.name`, [req.user.id]);
  const subs = rows.map((s) => enrich(s));
  const active = subs.filter((s) => s.is_active);

  const monthlyTotal = active.reduce((sum, s) => sum + s.monthly, 0);

  const byCategory = new Map();
  for (const s of active) {
    const key = s.category_name || 'Ohne Kategorie';
    const entry = byCategory.get(key) || { name: key, color: s.category_color || '#9ca3af', total: 0 };
    entry.total += s.monthly;
    byCategory.set(key, entry);
  }
  const categories = [...byCategory.values()]
    .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  const upcoming = active
    .filter((s) => s.daysUntilPayment <= 30)
    .sort((a, b) => a.nextPayment - b.nextPayment);

  const deadlines = active
    .filter((s) => s.cancelBy && s.daysUntilCancel <= 30)
    .sort((a, b) => a.cancelBy - b.cancelBy);

  const mostExpensive = [...active].sort((a, b) => b.monthly - a.monthly).slice(0, 5);

  const months = forecast(rows);
  const yearTotal = months.reduce((sum, m) => sum + m.total, 0);
  const peak = months.reduce((max, m) => (m.total > max.total ? m : max), months[0]);

  res.render('dashboard', {
    title: 'Übersicht',
    stats: {
      monthlyTotal,
      yearlyTotal: monthlyTotal * 12,
      activeCount: active.length,
      inactiveCount: subs.length - active.length,
      upcomingSum: upcoming.reduce((sum, s) => sum + s.myAmount, 0),
    },
    categories,
    upcoming,
    deadlines,
    mostExpensive,
    forecast: { months, yearTotal, average: yearTotal / months.length, peak },
  });
});

// ---- Liste ----
router.get('/subscriptions', async (req, res) => {
  const [rows] = await pool.query(`${SUB_SELECT} WHERE s.user_id = ? ORDER BY s.is_active DESC, s.name`, [req.user.id]);
  res.render('subscriptions/index', { title: 'Meine Abos', subs: rows.map((s) => enrich(s)) });
});

// ---- CSV-Export ----
const money = (n) => Math.round(n * 100) / 100;
const EXPORT_COLUMNS = [
  { header: 'Name', value: (s) => s.name },
  { header: 'Kategorie', value: (s) => s.category_name },
  { header: 'Betrag (CHF)', value: (s) => money(s.amount).toFixed(2) },
  { header: 'Geteilt mit (Personen)', value: (s) => s.share },
  { header: 'Dein Anteil (CHF)', value: (s) => money(s.myAmount).toFixed(2) },
  { header: 'Zyklus', value: (s) => s.cycleLabel },
  { header: 'Pro Monat, dein Anteil (CHF)', value: (s) => money(s.monthly).toFixed(2) },
  { header: 'Pro Jahr, dein Anteil (CHF)', value: (s) => money(s.monthly * 12).toFixed(2) },
  { header: 'Nächste Zahlung', value: (s) => (s.is_active ? fmt.date(s.nextPayment) : null) },
  { header: 'Kündigungsfrist (Tage)', value: (s) => s.notice_period_days },
  { header: 'Kündigen bis', value: (s) => (s.is_active && s.cancelBy ? fmt.date(s.cancelBy) : null) },
  { header: 'Kündbar zum', value: (s) => (s.is_active && s.cancelEffective ? fmt.date(s.cancelEffective) : null) },
  { header: 'Status', value: (s) => (s.is_active ? 'aktiv' : 'inaktiv') },
  { header: 'Notizen', value: (s) => s.notes },
];

router.get('/subscriptions/export.csv', async (req, res) => {
  const [rows] = await pool.query(`${SUB_SELECT} WHERE s.user_id = ? ORDER BY s.is_active DESC, s.name`, [req.user.id]);
  res
    .type('text/csv; charset=utf-8')
    .attachment(`abos-${formatISO(today())}.csv`)
    .set('Cache-Control', 'no-store')
    .send(toCsv(rows.map((s) => enrich(s)), EXPORT_COLUMNS));
});

// ---- Anlegen ----
router.get('/subscriptions/new', async (req, res) => {
  res.render('subscriptions/form', {
    title: 'Neues Abo',
    sub: null,
    values: { billing_cycle: 'monthly', is_active: 1, shared_with: 1, next_payment_date: formatISO(today()) },
    categories: await loadCategories(),
    cycles: CYCLES,
    error: null,
  });
});

router.post('/subscriptions', async (req, res) => {
  const categories = await loadCategories();
  const { values, error, data } = parseForm(req.body, categories);
  if (error) {
    return res.status(400).render('subscriptions/form', { title: 'Neues Abo', sub: null, values, categories, cycles: CYCLES, error });
  }
  await pool.query(
    `INSERT INTO subscriptions
       (user_id, category_id, name, amount, shared_with, billing_cycle, next_payment_date, notice_period_days, is_active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, data.category_id, data.name, data.amount, data.shared_with, data.billing_cycle, data.next_payment_date,
      data.notice_period_days, data.is_active, data.notes]
  );
  req.flash('success', `„${data.name}“ wurde hinzugefügt.`);
  res.redirect(`${res.locals.base}/subscriptions`);
});

// ---- Bearbeiten ----
router.get('/subscriptions/:id/edit', async (req, res) => {
  const sub = await findOwn(req);
  if (!sub) return notFound(res);
  res.render('subscriptions/form', {
    title: `${sub.name} bearbeiten`,
    sub,
    values: { ...sub, notice_period_days: sub.notice_period_days ?? '' },
    categories: await loadCategories(),
    cycles: CYCLES,
    error: null,
  });
});

router.post('/subscriptions/:id', async (req, res) => {
  const sub = await findOwn(req);
  if (!sub) return notFound(res);

  const categories = await loadCategories();
  const { values, error, data } = parseForm(req.body, categories);
  if (error) {
    return res.status(400).render('subscriptions/form', { title: `${sub.name} bearbeiten`, sub, values, categories, cycles: CYCLES, error });
  }
  await pool.query(
    `UPDATE subscriptions SET category_id = ?, name = ?, amount = ?, shared_with = ?, billing_cycle = ?, next_payment_date = ?,
       notice_period_days = ?, is_active = ?, notes = ?
     WHERE id = ? AND user_id = ?`,
    [data.category_id, data.name, data.amount, data.shared_with, data.billing_cycle, data.next_payment_date,
      data.notice_period_days, data.is_active, data.notes, sub.id, req.user.id]
  );
  req.flash('success', `„${data.name}“ wurde gespeichert.`);
  res.redirect(`${res.locals.base}/subscriptions`);
});

// ---- Loeschen ----
router.post('/subscriptions/:id/delete', async (req, res) => {
  const sub = await findOwn(req);
  if (sub) {
    await pool.query('DELETE FROM subscriptions WHERE id = ? AND user_id = ?', [sub.id, req.user.id]);
    req.flash('success', `„${sub.name}“ wurde gelöscht.`);
  }
  res.redirect(`${res.locals.base}/subscriptions`);
});

module.exports = router;
