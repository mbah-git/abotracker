const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const config = require('../config');
const { validateNewUser, createUser, validatePassword, setPassword } = require('../users');
const { isConfigured: isMailConfigured, sendMail } = require('../mailer');
const { createToken, findUserByToken, finishReset, buildResetEmail } = require('../passwordReset');

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

// ---- Passwort vergessen ----
router.get('/forgot-password', (req, res) => {
  if (req.user) return res.redirect(`${res.locals.base}/account/password`);
  res.render('auth/forgot', { title: 'Passwort vergessen', email: '', sent: false });
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 190);
  if (isMailConfigured() && email) {
    const [rows] = await pool.query('SELECT id, email, name FROM users WHERE email = ? AND is_active = 1', [email]);
    const user = rows[0];
    const token = user ? await createToken(user.id) : null;
    if (token) {
      const origin = config.appUrl || `${req.protocol}://${req.get('host')}${res.locals.base}`;
      const link = `${origin}/reset-password?token=${token}`;
      // Nicht abwarten: gleiche Antwortzeit, egal ob das Konto existiert
      sendMail({ to: user.email, ...buildResetEmail(user, link) })
        .catch((err) => console.error(`Passwort-Mail an ${user.email} fehlgeschlagen:`, err.message));
    }
  }
  // Immer dieselbe Antwort, damit sich nicht pruefen laesst, welche Adressen registriert sind
  res.render('auth/forgot', { title: 'Passwort vergessen', email, sent: true });
});

router.get('/reset-password', async (req, res) => {
  const user = await findUserByToken(req.query.token);
  res.set('Cache-Control', 'no-store');
  res.status(user ? 200 : 400).render('auth/reset', { title: 'Neues Passwort', user, token: req.query.token, error: null });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const token = String(req.body.token || '');
  const user = await findUserByToken(token);
  if (!user) {
    return res.status(400).render('auth/reset', { title: 'Neues Passwort', user: null, token, error: null });
  }
  const error = validatePassword(String(req.body.password || ''), String(req.body.password_confirm || ''));
  if (error) {
    return res.status(400).render('auth/reset', { title: 'Neues Passwort', user, token, error });
  }
  await setPassword(user.id, String(req.body.password));
  await finishReset(user.id);
  req.flash('success', 'Dein Passwort wurde geändert. Du kannst dich jetzt anmelden.');
  res.redirect(`${res.locals.base}/login`);
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('abotracker.sid');
    res.redirect(`${res.locals.base}/login`);
  });
});

module.exports = router;
