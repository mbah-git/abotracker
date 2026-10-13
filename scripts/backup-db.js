// Datenbank-Backup als .sql.gz, fuer einen woechentlichen Cron-Job gedacht.
//   npm run backup
// BACKUP_DIR (Standard: ~/backups/abotracker) und BACKUP_KEEP (Standard: 8) in .env anpassbar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
require('../src/config');
const pool = require('../src/db');
const { dumpDatabase } = require('../src/backup');

const dir = path.resolve(process.env.BACKUP_DIR || path.join(os.homedir(), 'backups', 'abotracker'));
const keep = Math.max(1, Number(process.env.BACKUP_KEEP) || 8);
const PREFIX = 'abotracker-';
const stamp = () => new Date().toLocaleString('de-CH');

function fileName(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${PREFIX}${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.sql.gz`;
}

async function main() {
  // Backups enthalten E-Mail-Adressen und Passwort-Hashes: nie in einen oeffentlichen Webordner
  if (/[\\/](public_html|www)([\\/]|$)/.test(dir)) {
    throw new Error(`BACKUP_DIR ${dir} liegt in einem öffentlichen Webordner. Bitte einen Ordner ausserhalb wählen.`);
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const now = new Date();
  const { sql, counts } = await dumpDatabase(pool, { now });
  const file = path.join(dir, fileName(now));
  fs.writeFileSync(file, zlib.gzipSync(sql), { mode: 0o600 });

  // Aeltere Backups ueber BACKUP_KEEP hinaus loeschen (Dateinamen sind chronologisch sortierbar)
  const old = fs.readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sql.gz'))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));

  const summary = Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ');
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`${stamp()} ✓ Backup ${file} (${kb} KB; ${summary})${old.length ? `, ${old.length} alte(s) gelöscht` : ''}`);
}

main()
  .catch((err) => {
    console.error(`${stamp()} Backup fehlgeschlagen: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
