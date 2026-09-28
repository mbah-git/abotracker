const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin);

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
