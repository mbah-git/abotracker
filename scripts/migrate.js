// Legt die Tabellen an (idempotent). Aufruf: npm run migrate
const mysql = require('mysql2/promise');
const config = require('../src/config');
const { migrate } = require('../src/migrations');

async function main() {
  const conn = await mysql.createConnection(config.db);
  try {
    for (const change of await migrate(conn)) console.log(`✓ ${change}`);
    console.log(`Schema in Datenbank "${config.db.database}" ist aktuell.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration fehlgeschlagen:', err.message);
  // Diagnose ohne das Passwort preiszugeben (Laenge hilft, Leerzeichen am Ende zu erkennen)
  const { host, port, database, user, password } = config.db;
  console.error(`Verbindung: ${user}@${host}:${port}/${database} (Passwortlänge: ${password.length})`);
  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Hinweis: In cPanel haben DB-Name und DB-Benutzer meist den cPanel-Benutzernamen als Präfix, z. B. "meinuser_abotrackeruser".');
  }
  process.exit(1);
});
