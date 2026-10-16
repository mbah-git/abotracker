// Bringt die Datenbank auf den aktuellen Stand (idempotent).
// Wird von "npm run migrate" und beim Start der App ausgefuehrt.
const fs = require('fs');
const path = require('path');
const { legacyCancelBy, formatISO } = require('./billing');

// Spalten, die nach der ersten Version dazugekommen sind: [Tabelle, Spalte, Definition]
const ADDED_COLUMNS = [
  ['users', 'reminders_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active'],
  ['users', 'payment_reminders_enabled', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER reminders_enabled'],
  ['subscriptions', 'shared_with', 'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER amount'],
  ['subscriptions', 'cancel_by_date', 'DATE NULL AFTER next_payment_date'],
];

function schemaStatements() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((chunk) => chunk.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean);
}

async function columnInfo(db, table, column) {
  const [rows] = await db.query(
    `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function tableExists(db, table) {
  const [rows] = await db.query(
    'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table]
  );
  return rows[0].n > 0;
}

// db: mysql2-Pool oder -Verbindung (mit dateStrings). Liefert eine Liste der vorgenommenen Aenderungen.
async function migrate(db) {
  const changes = [];
  for (const statement of schemaStatements()) {
    await db.query(statement);
  }
  for (const [table, column, definition] of ADDED_COLUMNS) {
    if (!(await columnInfo(db, table, column))) {
      await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      changes.push(`${table}.${column} hinzugefügt`);
    }
  }

  // Abrechnungszyklus "Einmalig" und optionales Zahlungsdatum
  const cycle = await columnInfo(db, 'subscriptions', 'billing_cycle');
  if (!cycle.type.includes("'once'")) {
    await db.query("ALTER TABLE subscriptions MODIFY billing_cycle ENUM('weekly','monthly','quarterly','yearly','once') NOT NULL DEFAULT 'monthly'");
    changes.push('subscriptions.billing_cycle um "once" erweitert');
  }
  const nextPayment = await columnInfo(db, 'subscriptions', 'next_payment_date');
  if (nextPayment.nullable === 'NO') {
    await db.query('ALTER TABLE subscriptions MODIFY next_payment_date DATE NULL');
    changes.push('subscriptions.next_payment_date darf leer sein');
  }

  // Kuendigungsfrist in Tagen -> festes Datum (einmalig, danach wird die alte Spalte entfernt)
  if (await columnInfo(db, 'subscriptions', 'notice_period_days')) {
    const [subs] = await db.query(
      'SELECT id, billing_cycle, next_payment_date, notice_period_days FROM subscriptions WHERE notice_period_days IS NOT NULL AND cancel_by_date IS NULL'
    );
    let converted = 0;
    for (const sub of subs) {
      const cancelBy = legacyCancelBy(sub);
      if (cancelBy) {
        await db.query('UPDATE subscriptions SET cancel_by_date = ? WHERE id = ?', [formatISO(cancelBy), sub.id]);
        converted++;
      }
    }
    await db.query('ALTER TABLE subscriptions DROP COLUMN notice_period_days');
    changes.push(`Kündigungsfristen in Tagen in feste Daten umgerechnet (${converted} Abos)`);
  }

  // Altes Erinnerungsprotokoll uebernehmen
  if (await tableExists(db, 'reminder_log')) {
    await db.query(
      `INSERT IGNORE INTO reminders_sent (subscription_id, kind, due_date, stage, sent_at)
       SELECT subscription_id, 'cancel', cancel_by, stage, sent_at FROM reminder_log`
    );
    await db.query('DROP TABLE reminder_log');
    changes.push('Erinnerungsprotokoll übernommen');
  }
  return changes;
}

module.exports = { migrate };
