const path = require('path');

// .env neben dem Projekt laden (auch wenn ein Cron-Job aus einem anderen Ordner startet).
// Bereits gesetzte Umgebungsvariablen (z. B. aus cPanel) haben Vorrang.
require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '.env') });

// Alle Datumsberechnungen (heute, Fristen) in Schweizer Zeit, unabhaengig vom Serverstandort
process.env.TZ = process.env.TZ || 'Europe/Zurich';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Umgebungsvariable ${name} fehlt (siehe .env.example).`);
  }
  return value;
}

const smtpPort = Number(process.env.SMTP_PORT) || 465;

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  // Pfad, unter dem die App laeuft, z. B. "/abotracker" (leer = Domain-Root)
  basePath: (process.env.BASE_PATH || '').replace(/\/+$/, ''),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
  },
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',

  // Oeffentliche Adresse der App fuer Links in E-Mails, z. B. https://abotracker.example.com
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  mail: {
    host: process.env.SMTP_HOST || '',
    port: smtpPort,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  },
  // Ab dieser Stunde (Schweizer Zeit) verschickt der Cron-Job die Erinnerungen des Tages
  reminderHour: Number(process.env.REMINDER_HOUR) || 8,
};
