// SMTP-Versand ueber das cPanel-Postfach (Einstellungen aus SMTP_* in .env / cPanel)
const nodemailer = require('nodemailer');
const config = require('./config');

function isConfigured() {
  const { host, user, password, from } = config.mail;
  return Boolean(host && user && password && from);
}

let transport = null;
function getTransport() {
  if (!isConfigured()) {
    throw new Error('E-Mail-Versand ist nicht eingerichtet: SMTP_HOST, SMTP_USER, SMTP_PASSWORD und MAIL_FROM setzen.');
  }
  if (!transport) {
    const { host, port, secure, user, password } = config.mail;
    transport = nodemailer.createTransport({ host, port, secure, auth: { user, pass: password } });
  }
  return transport;
}

async function sendMail({ to, subject, text, html }) {
  return getTransport().sendMail({ from: config.mail.from, to, subject, text, html });
}

module.exports = { isConfigured, sendMail };
