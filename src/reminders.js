// E-Mail-Erinnerungen vor Kuendigungsfristen: 7 Tage und 1 Tag vorher, als Sammel-Mail pro Benutzer.
const config = require('./config');
const fmt = require('./format');
const { enrich, formatISO, today } = require('./billing');

// Erinnerungsstufen in Tagen vor der Frist (absteigend)
const STAGES = [7, 1];

const logKey = (subId, cancelBy, stage) => `${subId}|${cancelBy}|${stage}`;

// Liefert die faelligen Erinnerungen: [{ sub (angereichert), stage }].
// Die Stufe richtet sich nach den verbleibenden Tagen, damit ein ausgefallener Lauf nachgeholt wird.
function dueReminders(subs, sentKeys, ref = today()) {
  const due = [];
  for (const raw of subs) {
    const sub = enrich(raw, ref);
    if (!sub.cancelBy) continue;
    const stage = [...STAGES].reverse().find((s) => sub.daysUntilCancel <= s);
    if (stage === undefined) continue;
    if (sentKeys.has(logKey(sub.id, formatISO(sub.cancelBy), stage))) continue;
    due.push({ sub, stage });
  }
  return due.sort((a, b) => a.sub.cancelBy - b.sub.cancelBy);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function buildEmail(user, items, { test = false } = {}) {
  const first = items[0].sub;
  const subject = (test ? '[Test] ' : '') + (items.length === 1
    ? `Kündigungsfrist: ${first.name} bis ${fmt.date(first.cancelBy)}`
    : `${items.length} Kündigungsfristen stehen an`);

  const line = ({ sub }) => ({
    name: sub.name,
    deadline: `bis ${fmt.date(sub.cancelBy)} (${fmt.relDays(sub.daysUntilCancel)})`,
    effective: `kündbar zum ${fmt.date(sub.cancelEffective)}`,
    price: `${fmt.money(sub.amount)} ${sub.cycleLabel.toLowerCase()}`,
  });
  const lines = items.map(line);
  const appUrl = config.appUrl;

  const text = [
    `Hallo ${user.name}`,
    '',
    items.length === 1 ? 'Für dieses Abo läuft bald die Kündigungsfrist ab:' : 'Für diese Abos laufen bald die Kündigungsfristen ab:',
    '',
    ...lines.map((l) => `• ${l.name}: kündigen ${l.deadline}, ${l.effective} – ${l.price}`),
    '',
    'Wenn du ein Abo behalten möchtest, musst du nichts tun.',
    ...(appUrl ? ['', `Zu deinen Abos: ${appUrl}/subscriptions`, `Erinnerungen abbestellen: ${appUrl}/account`] : []),
    '',
    'Dein AboTracker',
  ].join('\n');

  const rows = lines.map((l) => `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e3e5ee">
          <strong style="font-size:15px">${escapeHtml(l.name)}</strong><br>
          <span style="color:#6b7084;font-size:13px">${escapeHtml(l.effective)} · ${escapeHtml(l.price)}</span>
        </td>
        <td style="padding:12px 0 12px 12px;border-top:1px solid #e3e5ee;text-align:right;white-space:nowrap;color:#b45309;font-weight:600;font-size:14px">
          ${escapeHtml(l.deadline)}
        </td>
      </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="de"><body style="margin:0;padding:24px;background:#f5f6fa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c1f2a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e5ee;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;color:#4f46e5;font-weight:700">AboTracker</p>
    <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(subject.replace(/^\[Test\] /, ''))}</h1>
    <p style="margin:0 0 12px">Hallo ${escapeHtml(user.name)}</p>
    <p style="margin:0 0 8px">${items.length === 1 ? 'Für dieses Abo läuft bald die Kündigungsfrist ab:' : 'Für diese Abos laufen bald die Kündigungsfristen ab:'}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">${rows}
    </table>
    <p style="margin:16px 0 0;color:#6b7084;font-size:14px">Wenn du ein Abo behalten möchtest, musst du nichts tun.</p>
    ${appUrl ? `<p style="margin:20px 0 0"><a href="${escapeHtml(appUrl)}/subscriptions" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Zu deinen Abos</a></p>` : ''}
  </div>
  ${appUrl ? `<p style="max-width:560px;margin:12px auto 0;color:#6b7084;font-size:12px;text-align:center">Du erhältst diese E-Mail, weil Erinnerungen in deinem Konto eingeschaltet sind. <a href="${escapeHtml(appUrl)}/account" style="color:#6b7084">Erinnerungen abbestellen</a></p>` : ''}
</body></html>`;

  return { subject, text, html };
}

// Verschickt alle faelligen Erinnerungen. db: mysql2-Pool/Verbindung, send: ({to,subject,text,html}) => Promise
async function runReminders({ db, send, dryRun = false, ref = today(), log = console.log }) {
  const [subs] = await db.query(`
    SELECT s.*, u.email AS user_email, u.name AS user_name
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.is_active = 1 AND s.notice_period_days IS NOT NULL
      AND u.is_active = 1 AND u.reminders_enabled = 1`);

  const yesterday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
  const [sent] = await db.query('SELECT subscription_id, cancel_by, stage FROM reminder_log WHERE cancel_by >= ?', [formatISO(yesterday)]);
  const sentKeys = new Set(sent.map((r) => logKey(r.subscription_id, String(r.cancel_by).slice(0, 10), r.stage)));

  const byUser = new Map();
  for (const item of dueReminders(subs, sentKeys, ref)) {
    const key = item.sub.user_id;
    if (!byUser.has(key)) byUser.set(key, { user: { email: item.sub.user_email, name: item.sub.user_name }, items: [] });
    byUser.get(key).items.push(item);
  }

  const summary = { users: 0, reminders: 0, failed: 0 };
  for (const { user, items } of byUser.values()) {
    const mail = buildEmail(user, items);
    if (dryRun) {
      log(`[Testlauf] an ${user.email}: ${mail.subject}`);
      summary.users++;
      summary.reminders += items.length;
      continue;
    }
    try {
      await send({ to: user.email, ...mail });
      for (const { sub, stage } of items) {
        await db.query('INSERT IGNORE INTO reminder_log (subscription_id, cancel_by, stage) VALUES (?, ?, ?)',
          [sub.id, formatISO(sub.cancelBy), stage]);
      }
      log(`✓ an ${user.email}: ${mail.subject}`);
      summary.users++;
      summary.reminders += items.length;
    } catch (err) {
      // Nicht protokolliert, damit der naechste Lauf es erneut versucht
      log(`✗ an ${user.email} fehlgeschlagen: ${err.message}`);
      summary.failed++;
    }
  }
  return summary;
}

module.exports = { STAGES, dueReminders, buildEmail, runReminders };
