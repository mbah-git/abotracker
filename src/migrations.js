// Bringt die Datenbank auf den aktuellen Stand (idempotent).
// Wird von "npm run migrate" und beim Start der App ausgefuehrt.
const fs = require('fs');
const path = require('path');

// Spalten, die nach der ersten Version dazugekommen sind: [Tabelle, Spalte, Definition]
const ADDED_COLUMNS = [
  ['users', 'reminders_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active'],
  ['subscriptions', 'shared_with', 'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER amount'],
];

function schemaStatements() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) => chunk.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean);
}

// db: mysql2-Pool oder -Verbindung. Liefert eine Liste der vorgenommenen Aenderungen.
async function migrate(db) {
  const changes = [];
  for (const statement of schemaStatements()) {
    await db.query(statement);
  }
  for (const [table, column, definition] of ADDED_COLUMNS) {
    const [[{ n }]] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    if (!n) {
      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      changes.push(`${table}.${column} hinzugefügt`);
    }
  }
  return changes;
}

module.exports = { migrate };
