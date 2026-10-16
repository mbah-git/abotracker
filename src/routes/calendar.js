// Oeffentlicher Kalender-Link /calendar/<token>.ics (ohne Anmeldung, da Kalender-Apps sich nicht einloggen).
// Wird in app.js vor der Session registriert, damit regelmaessige Abrufe keine Sessions anlegen.
const crypto = require('crypto');
const pool = require('../db');
const config = require('../config');
const { buildCalendar } = require('../ical');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const newToken = () => crypto.randomBytes(32).toString('base64url');

async function calendarFeed(req, res) {
  const token = String(req.params.token || '');
  const notFound = () => res.status(404).type('text/plain; charset=utf-8').send('Kalender nicht gefunden. Erzeuge in den AboTracker-Einstellungen einen neuen Link.');
  if (!TOKEN_RE.test(token)) return notFound();

  const [users] = await pool.query('SELECT id FROM users WHERE calendar_token = ? AND is_active = 1', [token]);
  if (!users[0]) return notFound();

  const [subs] = await pool.query(
    `SELECT s.*, c.name AS category_name FROM subscriptions s
     LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.user_id = ? AND s.is_active = 1`,
    [users[0].id]
  );
  const origin = config.appUrl || `${req.protocol}://${req.get('host')}${config.basePath}`;
  res
    .type('text/calendar; charset=utf-8')
    .set('Cache-Control', 'no-store')
    .set('Content-Disposition', 'inline; filename="abotracker.ics"')
    .send(buildCalendar(subs, { origin }));
}

module.exports = { calendarFeed, newToken };
