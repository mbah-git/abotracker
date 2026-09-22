// Legt den Admin-User (aus ADMIN_EMAIL / ADMIN_PASSWORD), Kategorien und Testdaten an.
// Idempotent: Testabos werden nur angelegt, wenn der Benutzer noch keine Abos hat.
// Aufruf: npm run seed
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { formatISO, today } = require('../src/billing');

const CATEGORIES = [
  ['Streaming', '#e11d48'],
  ['Musik', '#16a34a'],
  ['Software & Cloud', '#2563eb'],
  ['Fitness & Gesundheit', '#ea580c'],
  ['Mobilfunk & Internet', '#7c3aed'],
  ['Versicherungen', '#0891b2'],
  ['Zeitungen & Magazine', '#ca8a04'],
  ['Sonstiges', '#64748b'],
];

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

async function upsertUser(conn, { email, name, password, role }) {
  const hash = await bcrypt.hash(password, 12);
  const [rows] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows[0]) {
    await conn.query('UPDATE users SET name = ?, password_hash = ?, role = ?, is_active = 1 WHERE id = ?',
      [name, hash, role, rows[0].id]);
    return { id: rows[0].id, created: false };
  }
  const [res] = await conn.query('INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)',
    [email, name, hash, role]);
  return { id: res.insertId, created: true };
}

async function seedSubs(conn, userId, subs, catIds) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?', [userId]);
  if (n > 0) return 0;
  for (const [name, cat, amount, cycle, inDays, notice, active, notes] of subs) {
    await conn.query(
      `INSERT INTO subscriptions
         (user_id, category_id, name, amount, billing_cycle, next_payment_date, notice_period_days, is_active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, catIds[cat], name, amount, cycle, daysFromNow(inDays), notice || null, active, notes]
    );
  }
  return subs.length;
}

async function main() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminEmail || adminPassword.length < 8) {
    throw new Error('ADMIN_EMAIL und ADMIN_PASSWORD (mind. 8 Zeichen) müssen gesetzt sein.');
  }

  const conn = await mysql.createConnection(config.db);
  try {
    for (const [name, color] of CATEGORIES) {
      await conn.query('INSERT INTO categories (name, color) VALUES (?, ?) ON DUPLICATE KEY UPDATE color = VALUES(color)', [name, color]);
    }
    const [cats] = await conn.query('SELECT id, name FROM categories');
    const catIds = Object.fromEntries(cats.map((c) => [c.name, c.id]));
    console.log(`✓ ${CATEGORIES.length} Kategorien`);

    const admin = await upsertUser(conn, {
      email: adminEmail,
      name: process.env.ADMIN_NAME || 'Administrator',
      password: adminPassword,
      role: 'admin',
    });
    console.log(`✓ Admin ${adminEmail} ${admin.created ? 'angelegt' : 'aktualisiert (Passwort neu gesetzt)'}`);
    const adminSubs = await seedSubs(conn, admin.id, ADMIN_SUBS, catIds);
    console.log(adminSubs ? `✓ ${adminSubs} Testabos für den Admin angelegt` : '• Admin hat bereits Abos, Testdaten übersprungen');

    // Demo-Benutzer, damit die Benutzerverwaltung etwas anzeigt. Zufallspasswort, Login nicht vorgesehen.
    if (process.env.SEED_DEMO_USER !== 'false') {
      const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', ['demo@example.com']);
      if (!existing[0]) {
        const demo = await upsertUser(conn, {
          email: 'demo@example.com',
          name: 'Max Mustermann',
          password: crypto.randomBytes(24).toString('base64url'),
          role: 'user',
        });
        await seedSubs(conn, demo.id, DEMO_SUBS, catIds);
        console.log('✓ Demo-Benutzer demo@example.com mit 3 Abos angelegt');
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Seed fehlgeschlagen:', err.message);
  process.exit(1);
});
