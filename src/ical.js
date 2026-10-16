// Kalender-Abo (iCalendar, RFC 5545): Zahlungen der naechsten 12 Monate und Kuendigungsfristen
// als ganztaegige Termine. Kalender-Apps rufen den Link regelmaessig selbst ab.
const config = require('./config');
const fmt = require('./format');
const { paymentsBetween, enrich, formatISO, today } = require('./billing');

const MONTHS_AHEAD = 12;
const DAYS_BACK = 31; // kuerzlich vergangene Termine bleiben sichtbar

// Text-Werte: Backslash, Strichpunkt, Komma und Zeilenumbrueche maskieren
function escapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Zeilen laenger als 75 Bytes umbrechen (Folgezeilen beginnen mit einem Leerzeichen), ohne UTF-8-Zeichen zu teilen
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = parts.length ? 74 : 75; // Folgezeilen: 1 Byte fuer das fuehrende Leerzeichen
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const dateValue = (d) => formatISO(d).replace(/-/g, '');
const nextDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function event({ uid, date, summary, description, url, alarm, stamp }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dateValue(date)}`,
    `DTEND;VALUE=DATE:${dateValue(nextDay(date))}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'TRANSP:TRANSPARENT',
  ];
  if (url) lines.push(`URL:${url}`);
  if (alarm) {
    // Erinnerung am Vortag um 9 Uhr (wird nicht von allen Kalendern bei Abos uebernommen)
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(alarm)}`, 'TRIGGER:-PT15H', 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

function priceText(sub) {
  return sub.share > 1
    ? `${fmt.money(sub.myAmount)} (dein Anteil von ${fmt.money(sub.amount)}, geteilt mit ${sub.share} Personen)`
    : fmt.money(sub.amount);
}

// subs: Abo-Zeilen des Benutzers (mit category_name). origin: oeffentliche Adresse der App fuer Links.
function buildCalendar(subs, { origin = config.appUrl, ref = today(), now = new Date() } = {}) {
  const stamp = utcStamp(now);
  const from = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - DAYS_BACK);
  const to = new Date(ref.getFullYear(), ref.getMonth() + MONTHS_AHEAD + 1, 0);
  const link = origin ? `${origin}/subscriptions` : null;
  const host = (origin && new URL(origin).host) || 'abotracker';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AboTracker//Kalender//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:AboTracker',
    'X-WR-CALDESC:Zahlungen und Kündigungsfristen deiner Abos',
    'X-WR-TIMEZONE:Europe/Zurich',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];

  for (const raw of subs) {
    if (!raw.is_active) continue;
    const sub = enrich(raw, ref);
    const details = [
      `Betrag: ${priceText(sub)}`,
      `Abrechnung: ${sub.cycleLabel}`,
      sub.category_name ? `Kategorie: ${sub.category_name}` : null,
      sub.notes ? `Notiz: ${sub.notes}` : null,
    ].filter(Boolean);

    for (const date of paymentsBetween(raw, from, to)) {
      lines.push(...event({
        uid: `payment-${sub.id}-${dateValue(date)}@${host}`,
        date,
        summary: `Zahlung: ${sub.name} – ${fmt.money(sub.myAmount)}`,
        description: details.join('\n'),
        url: link,
        stamp,
      }));
    }

    if (sub.cancelBy && sub.cancelBy >= from) {
      lines.push(...event({
        uid: `cancel-${sub.id}-${dateValue(sub.cancelBy)}@${host}`,
        date: sub.cancelBy,
        summary: `Kündigen bis: ${sub.name}`,
        description: [`Letzter Tag, um ${sub.name} zu kündigen.`, ...details].join('\n'),
        url: link,
        alarm: `Morgen ist der letzte Tag, um ${sub.name} zu kündigen.`,
        stamp,
      }));
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar, escapeText, fold };
