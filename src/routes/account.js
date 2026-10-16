const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const config = require('../config');
const { newToken } = require('./calendar');

const router = express.Router();
router.use(requireLogin);

// ---- Einstellungen ----
router.get('/', (req, res) => {
  let calendar = null;
  if (req.user.calendar_token) {
    const origin = config.appUrl || `${req.protocol}://${req.get('host')}${res.locals.base}`;
    const url = `${origin}/calendar/${req.user.calendar_token}.ics`;
    calendar = { url, webcal: url.replace(/^https?:/, 'webcal:') };
  }
  res.render('account/settings', { title: 'Einstellungen', calendar });
});

// Kalender-Abo: Link erzeugen, ersetzen (alter wird ungueltig) oder ausschalten
router.post('/calendar', async (req, res) => {
  const action = req.body.action;
  if (action === 'disable') {
    await pool.query('UPDATE users SET calendar_token = NULL WHERE id = ?', [req.user.id]);
    req.flash('success', 'Das Kalender-Abo ist ausgeschaltet. Der bisherige Link funktioniert nicht mehr.');
  } else {
    await pool.query('UPDATE users SET calendar_token = ? WHERE id = ?', [newToken(), req.user.id]);
    req.flash('success', action === 'rotate'
      ? 'Neuer Kalender-Link erzeugt. Der alte funktioniert nicht mehr – trage den neuen in deinem Kalender ein.'
      : 'Dein Kalender-Link ist bereit.');
  }
  res.redirect(`${res.locals.base}/account#kalender`);
});

router.post('/', async (req, res) => {
  const cancel = req.body.reminders_enabled === '1' ? 1 : 0;
  const payment = req.body.payment_reminders_enabled === '1' ? 1 : 0;
  await pool.query('UPDATE users SET reminders_enabled = ?, payment_reminders_enabled = ? WHERE id = ?', [cancel, payment, req.user.id]);
  req.flash('success', 'Deine Einstellungen wurden gespeichert.');
  res.redirect(`${res.locals.base}/account`);
});

// ---- Passwort ----
router.get('/password', (req, res) => {
  res.render('account/password', { title: 'Passwort ändern', error: null });
});

router.post('/password', async (req, res) => {
  const current = String(req.body.current_password || '');
  const password = String(req.body.password || '');
  const confirm = String(req.body.password_confirm || '');

  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  let error = null;
  if (!(await bcrypt.compare(current, rows[0].password_hash))) error = 'Das aktuelle Passwort ist falsch.';
  else if (password.length < 8) error = 'Das neue Passwort muss mindestens 8 Zeichen lang sein.';
  else if (password !== confirm) error = 'Die neuen Passwörter stimmen nicht überein.';
  else if (password === current) error = 'Das neue Passwort muss sich vom aktuellen unterscheiden.';
  if (error) {
    return res.status(400).render('account/password', { title: 'Passwort ändern', error });
  }

  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 12), req.user.id]);
  req.flash('success', 'Dein Passwort wurde geändert.');
  res.redirect(`${res.locals.base}/dashboard`);
});

module.exports = router;
