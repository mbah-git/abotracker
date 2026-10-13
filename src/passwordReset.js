// "Passwort vergessen": Einmal-Links, die 60 Minuten gelten. Gespeichert wird nur der Hash des Tokens.
const crypto = require('crypto');
const pool = require('./db');

const VALID_MINUTES = 60;
const MIN_MINUTES_BETWEEN_MAILS = 2;

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Liefert ein neues Token oder null, wenn fuer den Benutzer gerade erst eines verschickt wurde
async function createToken(userId) {
  await pool.query('DELETE FROM password_resets WHERE expires_at < NOW()');
  const [[{ recent }]] = await pool.query(
    'SELECT COUNT(*) AS recent FROM password_resets WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)',
    [userId, MIN_MINUTES_BETWEEN_MAILS]
  );
  if (recent) return null;

  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
  await pool.query(
    'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
    [hash(token), userId, VALID_MINUTES]
  );
  return token;
}

// Benutzer zu einem gueltigen Token, sonst null
async function findUserByToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.email, u.name FROM password_resets pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash = ? AND pr.expires_at > NOW() AND u.is_active = 1`,
    [hash(token)]
  );
  return rows[0] || null;
}

// Nach erfolgreichem Zuruecksetzen: alle Links und alle Anmeldungen des Benutzers ungueltig machen
async function finishReset(userId) {
  await pool.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
  try {
    await pool.query('DELETE FROM sessions WHERE data LIKE ? OR data LIKE ?',
      [`%"userId":${Number(userId)},%`, `%"userId":${Number(userId)}}%`]);
  } catch (err) {
    console.error('Sessions konnten nicht beendet werden:', err.message);
  }
}

function buildResetEmail(user, link) {
  const subject = 'Passwort zurücksetzen';
  const text = [
    `Hallo ${user.name}`,
    '',
    'Du hast angefordert, dein AboTracker-Passwort zurückzusetzen. Öffne diesen Link, um ein neues Passwort zu wählen:',
    '',
    link,
    '',
    `Der Link gilt ${VALID_MINUTES} Minuten und funktioniert nur einmal.`,
    'Wenn du das nicht warst, kannst du diese E-Mail ignorieren. Dein Passwort bleibt dann unverändert.',
    '',
    'Dein AboTracker',
  ].join('\n');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<!DOCTYPE html>
<html lang="de"><body style="margin:0;padding:24px;background:#f5f6fa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c1f2a">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e5ee;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;color:#4f46e5;font-weight:700">AboTracker</p>
    <h1 style="margin:0 0 16px;font-size:20px">${subject}</h1>
    <p style="margin:0 0 12px">Hallo ${esc(user.name)}</p>
    <p style="margin:0 0 20px">Du hast angefordert, dein Passwort zurückzusetzen. Klicke auf den Button, um ein neues Passwort zu wählen.</p>
    <p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Neues Passwort wählen</a></p>
    <p style="margin:0;color:#6b7084;font-size:14px">Der Link gilt ${VALID_MINUTES} Minuten und funktioniert nur einmal.
      Wenn du das nicht warst, ignoriere diese E-Mail. Dein Passwort bleibt dann unverändert.</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

module.exports = { createToken, findUserByToken, finishReset, buildResetEmail, VALID_MINUTES };
