// E-Mail-Erinnerungen 14, 7 und 1 Tag vor Kuendigungsfristen und vor Zahlungen,
// als eine Sammel-Mail pro Benutzer und Tag. Beide Arten sind pro Benutzer abschaltbar.
const config = require('./config');
const fmt = require('./format');
const { CYCLES, enrich, formatISO, today } = require('./billing');

// Erinnerungsstufen in Tagen vor dem Termin
const STAGES = [14, 7, 1];

const logKey = (subId, kind, due, stage) => `${subId}|${kind}|${due}|${stage}`;

// Kleinste passende Stufe; so wird ein ausgefallener Lauf nachgeholt, ohne doppelt zu senden
function stageFor(days, stages = STAGES) {
  if (days == null || days < 0) return undefined;
  return [...stages].sort((a, b) => a - b).find((s) => days <= s);
}

// Faellige Erinnerungen: [{ sub (angereichert), kind: 'cancel'|'payment', due: Date, stage }]
// raw-Zeilen brauchen user_cancel_on / user_payment_on (Einstellungen des Benutzers).
function dueReminders(subs, sentKeys, ref = today()) {
  const due = [];
  const add = (sub, kind, date, stage) => {
    if (stage === undefined || sentKeys.has(logKey(sub.id, kind, formatISO(date), stage))) return;
    due.push({ sub, kind, due: date, stage });
  };
  for (const raw of subs) {
    if (!raw.is_active) continue;
    const sub = enrich(raw, ref);
    if (raw.user_cancel_on && sub.cancelBy) {
      add(sub, 'cancel', sub.cancelBy, stageFor(sub.daysUntilCancel));
    }
    if (raw.user_payment_on && sub.nextPayment) {
      // Bei kurzen Zyklen keine Erinnerung, die vor der vorherigen Zahlung laege (woechentlich: nur 1 Tag vorher)
      const stages = STAGES.filter((s) => s < CYCLES[sub.billing_cycle].days);
      add(sub, 'payment', sub.nextPayment, stageFor(sub.daysUntilPayment, stages));
    }
  }
  return due.sort((a, b) => a.due - b.due);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function buildSubject(cancels, payments) {
  if (cancels.length && payments.length) {
    return `${plural(cancels.length, 'Kündigungsfrist', 'Kündigungsfristen')} und ${plural(payments.length, 'Zahlung', 'Zahlungen')} stehen an`;
  }
  if (cancels.length === 1) return `Kündigungsfrist: ${cancels[0].sub.name} bis ${fmt.date(cancels[0].due)}`;
  if (cancels.length) return `${cancels.length} Kündigungsfristen stehen an`;
  if (payments.length === 1) return `Zahlung: ${payments[0].sub.name} am ${fmt.date(payments[0].due)}`;
  return `${payments.length} Zahlungen stehen an`;
}

function lines(items) {
  return items.map(({ sub, kind, due }) => {
    const days = kind === 'cancel' ? sub.daysUntilCancel : sub.daysUntilPayment;
    const price = sub.share > 1
      ? `${fmt.money(sub.myAmount)} (dein Anteil von ${fmt.money(sub.amount)})`
      : fmt.money(sub.amount);
    return {
      name: sub.name,
      when: `${kind === 'cancel' ? 'kündigen bis' : 'am'} ${fmt.date(due)} (${fmt.relDays(days)})`,
      detail: `${price} · ${sub.cycleLabel.toLowerCase()}`,
    };
  });
}

function buildEmail(user, items, { test = false } = {}) {
  const cancels = items.filter((i) => i.kind === 'cancel');
  const payments = items.filter((i) => i.kind === 'payment');
  const subject = (test ? '[Test] ' : '') + buildSubject(cancels, payments);
  const sections = [
    { title: 'Kündigungsfristen', intro: 'Wenn du eines dieser Abos nicht behalten möchtest, kündige es rechtzeitig:', lines: lines(cancels), color: '#b45309' },
    { title: 'Nächste Zahlungen', intro: 'Diese Beträge werden demnächst fällig:', lines: lines(payments), color: '#4f46e5' },
  ].filter((s) => s.lines.length);
  const appUrl = config.appUrl;

  const text = [
    `Hallo ${user.name}`,
    ...sections.flatMap((s) => ['', `${s.title.toUpperCase()}`, s.intro, ...s.lines.map((l) => `• ${l.name}: ${l.when} – ${l.detail}`)]),
    ...(appUrl ? ['', `Zu deinen Abos: ${appUrl}/subscriptions`, `Erinnerungen einstellen: ${appUrl}/account`] : []),
    '',
    'Dein AboTracker',
  ].join('\n');

  const sectionHtml = sections.map((s) => `
    <h2 style="margin:20px 0 4px;font-size:16px">${escapeHtml(s.title)}</h2>
    <p style="margin:0 0 4px;color:#6b7084;font-size:14px">${escapeHtml(s.intro)}</p>
    <table role="presentation" style="width:100%;border-collapse:collapse">${s.lines.map((l) => `
      <tr>
        <td style="padding:10px 0;border-top:1px solid #e3e5ee">
          <strong style="font-size:15px">${escapeHtml(l.name)}</strong><br>
          <span style="color:#6b7084;font-size:13px">${escapeHtml(l.detail)}</span>
        </td>
        <td style="padding:10px 0 10px 12px;border-top:1px solid #e3e5ee;text-align:right;white-space:nowrap;color:${s.color};font-weight:600;font-size:14px">
          ${escapeHtml(l.when)}
        </td>
      </tr>`).join('')}
    </table>`).join('');

  const html = `<!DOCTYPE html>
<html lang="de"><body style="margin:0;padding:24px;background:#f5f6fa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c1f2a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e5ee;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;color:#4f46e5;font-weight:700">AboTracker</p>
    <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(subject.replace(/^\[Test\] /, ''))}</h1>
    <p style="margin:0">Hallo ${escapeHtml(user.name)}</p>
    ${sectionHtml}
    ${appUrl ? `<p style="margin:24px 0 0"><a href="${escapeHtml(appUrl)}/subscriptions" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">Zu deinen Abos</a></p>` : ''}
  </div>
  ${appUrl ? `<p style="max-width:560px;margin:12px auto 0;color:#6b7084;font-size:12px;text-align:center">Du erhältst diese E-Mail, weil Erinnerungen in deinem Konto eingeschaltet sind. <a href="${escapeHtml(appUrl)}/account" style="color:#6b7084">Erinnerungen einstellen</a></p>` : ''}
</body></html>`;

  return { subject, text, html };
}

// Verschickt alle faelligen Erinnerungen. db: mysql2-Pool/Verbindung, send: ({to,subject,text,html}) => Promise
async function runReminders({ db, send, dryRun = false, ref = today(), log = console.log }) {
  const [subs] = await db.query(`
    SELECT s.*, u.email AS user_email, u.name AS user_name,
           u.reminders_enabled AS user_cancel_on, u.payment_reminders_enabled AS user_payment_on
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.is_active = 1 AND u.is_active = 1
      AND ((u.reminders_enabled = 1 AND s.cancel_by_date IS NOT NULL)
        OR (u.payment_reminders_enabled = 1 AND s.next_payment_date IS NOT NULL))`);

  const yesterday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1);
  const [sent] = await db.query('SELECT subscription_id, kind, due_date, stage FROM reminders_sent WHERE due_date >= ?', [formatISO(yesterday)]);
  const sentKeys = new Set(sent.map((r) => logKey(r.subscription_id, r.kind, String(r.due_date).slice(0, 10), r.stage)));

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
      for (const { sub, kind, due, stage } of items) {
        await db.query('INSERT IGNORE INTO reminders_sent (subscription_id, kind, due_date, stage) VALUES (?, ?, ?, ?)',
          [sub.id, kind, formatISO(due), stage]);
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
