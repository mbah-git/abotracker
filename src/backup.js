// SQL-Export der App-Tabellen (ohne Sessions). Wiederherstellen z. B. per phpMyAdmin -> Importieren.

// Reihenfolge so, dass Fremdschluessel beim Import erfuellt sind
const TABLES = ['users', 'categories', 'subscriptions', 'reminders_sent', 'password_resets'];
const BATCH = 100;

const ident = (name) => `\`${String(name).replace(/`/g, '``')}\``;

// db: mysql2-Pool oder -Verbindung (mit escape()). Liefert { sql, counts }.
async function dumpDatabase(db, { now = new Date() } = {}) {
  const out = [
    '-- AboTracker Datenbank-Backup',
    `-- Erstellt: ${now.toLocaleString('de-CH')}`,
    '-- Wiederherstellen: phpMyAdmin -> Datenbank waehlen -> Importieren -> diese Datei',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ];
  const counts = {};

  for (const table of TABLES) {
    const [[create]] = await db.query(`SHOW CREATE TABLE ${ident(table)}`);
    const [rows] = await db.query(`SELECT * FROM ${ident(table)}`);
    counts[table] = rows.length;

    out.push(`-- Tabelle ${table}: ${rows.length} Zeile(n)`);
    out.push(`DROP TABLE IF EXISTS ${ident(table)};`);
    out.push(`${create['Create Table']};`);
    if (rows.length) {
      const columns = Object.keys(rows[0]);
      const head = `INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES`;
      for (let i = 0; i < rows.length; i += BATCH) {
        const values = rows.slice(i, i + BATCH)
          .map((row) => `(${columns.map((c) => db.escape(row[c])).join(', ')})`)
          .join(',\n  ');
        out.push(`${head}\n  ${values};`);
      }
    }
    out.push('');
  }

  out.push('SET FOREIGN_KEY_CHECKS = 1;', '');
  return { sql: out.join('\n'), counts };
}

module.exports = { TABLES, dumpDatabase };
