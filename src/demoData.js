// Beispiel-Abos fuer Testbenutzer (Seed-Skript und "Neuen Benutzer erstellen")
const { formatISO, today } = require('./billing');

// [Name, Kategorie, Betrag, Zyklus, Tage bis zur naechsten Zahlung, Kuendigungsfrist, aktiv, Notiz]
const ADMIN_SUBS = [
  ['Netflix Standard', 'Streaming', 13.99, 'monthly', 4, 0, 1, null],
  ['Disney+', 'Streaming', 99.90, 'yearly', 45, 0, 1, 'Jahresabo, günstiger als monatlich'],
  ['Spotify Family', 'Musik', 21.99, 'monthly', 12, 0, 1, 'Mit der Familie geteilt'],
  ['Microsoft 365 Family', 'Software & Cloud', 129.00, 'yearly', 18, 14, 1, null],
  ['iCloud+ 200 GB', 'Software & Cloud', 2.99, 'monthly', 9, 0, 1, null],
  ['GitHub Copilot', 'Software & Cloud', 10.00, 'monthly', 21, 0, 1, null],
  ['Fitnessstudio', 'Fitness & Gesundheit', 34.90, 'monthly', 1, 30, 1, '12 Monate Mindestlaufzeit'],
  ['Handyvertrag', 'Mobilfunk & Internet', 24.99, 'monthly', 15, 90, 1, null],
  ['Glasfaser 500', 'Mobilfunk & Internet', 44.95, 'monthly', 26, 30, 1, null],
  ['Hausratversicherung', 'Versicherungen', 38.40, 'quarterly', 33, 90, 1, null],
  ['Kfz-Versicherung', 'Versicherungen', 486.00, 'yearly', 70, 30, 1, 'Stichtag 30.11. beachten'],
  ['Die Zeit Digital', 'Zeitungen & Magazine', 4.99, 'weekly', 3, 7, 1, null],
  ['DAZN', 'Streaming', 34.99, 'monthly', 8, 0, 0, 'Gekündigt, läuft aus'],
];

const DEMO_SUBS = [
  ['Amazon Prime', 'Streaming', 89.90, 'yearly', 120, 0, 1, null],
  ['YouTube Premium', 'Streaming', 12.99, 'monthly', 6, 0, 1, null],
  ['Urban Sports Club', 'Fitness & Gesundheit', 49.00, 'monthly', 11, 30, 1, null],
];

function daysFromNow(days) {
  const d = today();
  d.setDate(d.getDate() + days);
  return formatISO(d);
}

// Legt die Abos an; db ist ein mysql2-Pool oder eine Verbindung. Liefert die Anzahl.
async function addSubscriptions(db, userId, subs) {
  const [cats] = await db.query('SELECT id, name FROM categories');
  const catIds = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  for (const [name, cat, amount, cycle, inDays, notice, active, notes] of subs) {
    await db.query(
      `INSERT INTO subscriptions
         (user_id, category_id, name, amount, billing_cycle, next_payment_date, notice_period_days, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, catIds[cat] || null, name, amount, cycle, daysFromNow(inDays), notice || null, active, notes]
    );
  }
  return subs.length;
}

module.exports = { ADMIN_SUBS, DEMO_SUBS, addSubscriptions };
