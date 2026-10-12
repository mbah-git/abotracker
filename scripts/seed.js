// Legt den Admin-User (aus ADMIN_EMAIL / ADMIN_PASSWORD), Kategorien und Testdaten an.
// Idempotent: Testabos werden nur angelegt, wenn der Benutzer noch keine Abos hat.
// Aufruf: npm run seed
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { ADMIN_SUBS, DEMO_SUBS, addSubscriptions } = require('../src/demoData');

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

// Testabos nur anlegen, wenn der Benutzer noch keine hat
async function seedSubs(conn, userId, subs) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?', [userId]);
  return n > 0 ? 0 : addSubscriptions(conn, userId, subs);
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
    console.log(`✓ ${CATEGORIES.length} Kategorien`);

    const admin = await upsertUser(conn, {
      email: adminEmail,
      name: process.env.ADMIN_NAME || 'Administrator',
      password: adminPassword,
      role: 'admin',
    });
    console.log(`✓ Admin ${adminEmail} ${admin.created ? 'angelegt' : 'aktualisiert (Passwort neu gesetzt)'}`);
    const adminSubs = await seedSubs(conn, admin.id, ADMIN_SUBS);
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
        await seedSubs(conn, demo.id, DEMO_SUBS);
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
