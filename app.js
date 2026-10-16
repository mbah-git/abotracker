const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const config = require('./src/config');
const pool = require('./src/db');
const { migrate } = require('./src/migrations');
const format = require('./src/format');
const { isConfigured: isMailConfigured } = require('./src/mailer');
const { loadUser } = require('./src/middleware/auth');
const csrf = require('./src/middleware/csrf');
const flash = require('./src/middleware/flash');

const app = express();
const base = config.basePath;

// Versionskennung fuer CSS/JS (?v=...): aendert sich nur, wenn sich der Inhalt aendert.
// So laedt der Browser nach einem Update sofort die neuen Dateien, darf sie sonst aber lange zwischenspeichern.
const assetVersion = crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(__dirname, 'public/css/style.css')))
  .update(fs.readFileSync(path.join(__dirname, 'public/js/app.js')))
  .digest('hex').slice(0, 10);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Namecheap/cPanel betreibt Node-Apps hinter Apache (Passenger) als Reverse Proxy
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'upgrade-insecure-requests': config.env === 'production' ? [] : null,
    },
  },
}));

app.use(`${base}/static`, express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use(`${base}/static/vendor`, express.static(path.join(__dirname, 'node_modules/chart.js/dist'), { maxAge: '30d' }));

// ---- PWA: Manifest und Service Worker (vor der Session, damit keine leeren Sessions entstehen) ----
app.get(`${base}/manifest.webmanifest`, (req, res) => {
  const icon = (file, size, purpose) => ({ src: `${base}/static/icons/${file}`, sizes: `${size}x${size}`, type: 'image/png', purpose });
  res.type('application/manifest+json').set('Cache-Control', 'public, max-age=86400').send(JSON.stringify({
    id: `${base}/`,
    name: 'AboTracker',
    short_name: 'AboTracker',
    description: 'Abonnements und monatliche Ausgaben im Blick behalten',
    lang: 'de-CH',
    start_url: `${base}/dashboard`,
    scope: `${base}/`,
    display: 'standalone',
    background_color: '#f5f6fa',
    theme_color: '#4f46e5',
    icons: [
      icon('icon-192.png', 192, 'any'),
      icon('icon-512.png', 512, 'any'),
      icon('maskable-192.png', 192, 'maskable'),
      icon('maskable-512.png', 512, 'maskable'),
    ],
  }));
});

// Der Service Worker muss unterhalb von BASE_PATH liegen, damit er die ganze App abdeckt
app.get(`${base}/sw.js`, (req, res) => {
  res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Standardwerte fuer die Views, damit auch Fehlerseiten immer rendern koennen
app.use((req, res, next) => {
  Object.assign(res.locals, {
    base,
    path: base && req.path.startsWith(base) ? req.path.slice(base.length) || '/' : req.path,
    fmt: format,
    allowRegistration: config.allowRegistration,
    assetVersion,
    mailEnabled: isMailConfigured(),
    currentUser: null,
    flash: null,
    csrfToken: '',
  });
  next();
});

app.use(session({
  name: 'abotracker.sid',
  secret: config.sessionSecret,
  store: new MySQLStore({ createDatabaseTable: true, clearExpired: true }, pool),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: base || '/',
  },
}));

app.use(flash);
app.use(csrf);
app.use(loadUser);

const router = express.Router();
router.get('/', (req, res) => res.redirect(`${base}/${req.user ? 'dashboard' : 'login'}`));
router.use(require('./src/routes/auth'));
router.use('/account', require('./src/routes/account'));
router.use(require('./src/routes/subscriptions'));
router.use('/admin', require('./src/routes/admin'));
app.use(base || '/', router);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // Fehler nach dem Senden (z. B. Session konnte nicht gespeichert werden): keine zweite Antwort,
  // sonst stuerzt der Prozess mit ERR_HTTP_HEADERS_SENT ab
  if (res.headersSent) return next(err);
  res.status(500).render('error', {
    title: 'Fehler',
    message: 'Da ist etwas schiefgelaufen. Bitte versuche es später erneut.',
  });
});

// Datenbank auf den aktuellen Stand bringen, danach Anfragen annehmen
migrate(pool)
  .then((changes) => changes.forEach((c) => console.log(`Migration: ${c}`)))
  .catch((err) => console.error('Migration beim Start fehlgeschlagen:', err.message))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`AboTracker läuft auf Port ${config.port}${base ? ` unter ${base}` : ''}`);
    });
  });
