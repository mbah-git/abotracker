const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const config = require('../config');
const { validateNewUser, createUser } = require('../users');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', {
    title: 'Zu viele Versuche',
    message: 'Bitte warte ein paar Minuten und versuche es dann erneut.',
  }),
});

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(`${res.locals.base}/dashboard`);
  res.render('auth/login', { title: 'Anmelden', email: '', error: null });
});

router.post('/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const [rows] = await pool.query('SELECT id, password_hash, is_active FROM users WHERE email = ?', [email]);
  const user = rows[0];
  const valid = user && (await bcrypt.compare(password, user.password_hash));

  if (!valid) {
    return res.status(401).render('auth/login', { title: 'Anmelden', email, error: 'E-Mail oder Passwort ist falsch.' });
  }
  if (!user.is_active) {
    return res.status(403).render('auth/login', { title: 'Anmelden', email, error: 'Dieses Konto wurde gesperrt.' });
  }

  await regenerate(req);
  req.session.userId = user.id;
  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  res.redirect(`${res.locals.base}/dashboard`);
});

router.get('/register', (req, res) => {
  if (!config.allowRegistration) return res.redirect(`${res.locals.base}/login`);
  if (req.user) return res.redirect(`${res.locals.base}/dashboard`);
  res.render('auth/register', { title: 'Registrieren', values: {}, error: null });
});

router.post('/register', authLimiter, async (req, res) => {
  if (!config.allowRegistration) return res.redirect(`${res.locals.base}/login`);

  const { values, password, error } = await validateNewUser(req.body);
  if (error) {
    return res.status(400).render('auth/register', { title: 'Registrieren', values, error });
  }
  const userId = await createUser({ ...values, password });

  await regenerate(req);
  req.session.userId = userId;
  req.flash('success', `Willkommen, ${values.name}! Lege jetzt dein erstes Abo an.`);
  res.redirect(`${res.locals.base}/dashboard`);
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('abotracker.sid');
    res.redirect(`${res.locals.base}/login`);
  });
});

module.exports = router;
