// Verschickt die E-Mail-Erinnerungen vor Kuendigungsfristen. Fuer einen stuendlichen Cron-Job gedacht:
// Vor REMINDER_HOUR (Schweizer Zeit) passiert nichts, danach wird alles Faellige genau einmal verschickt.
//   npm run reminders               normaler Lauf
//   npm run reminders -- --dry-run  nur anzeigen, nichts senden
//   npm run reminders -- --now      Uhrzeit-Sperre ignorieren
const config = require('../src/config');
const pool = require('../src/db');
const { migrate } = require('../src/migrations');
const { sendMail } = require('../src/mailer');
const { runReminders } = require('../src/reminders');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const stamp = () => new Date().toLocaleString('de-CH');

async function main() {
  if (!args.has('--now') && !dryRun && new Date().getHours() < config.reminderHour) {
    return; // noch zu frueh; der naechste stuendliche Lauf versucht es erneut
  }
  await migrate(pool);
  const summary = await runReminders({
    db: pool,
    send: sendMail,
    dryRun,
    log: (msg) => console.log(`${stamp()} ${msg}`),
  });
  if (summary.users || summary.failed || dryRun) {
    console.log(`${stamp()} ${summary.reminders} Erinnerung(en) an ${summary.users} Benutzer${summary.failed ? `, ${summary.failed} fehlgeschlagen` : ''}${dryRun ? ' (Testlauf)' : ''}`);
  }
  if (summary.failed) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`${stamp()} Erinnerungen fehlgeschlagen: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
