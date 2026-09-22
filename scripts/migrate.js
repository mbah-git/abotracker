// Legt die Tabellen an (idempotent). Aufruf: npm run migrate
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query(sql);
    console.log(`Schema in Datenbank "${config.db.database}" ist aktuell.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration fehlgeschlagen:', err.message);
  process.exit(1);
});
