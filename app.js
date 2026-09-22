const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');

const config = require('./src/config');
const pool = require('./src/db');
const format = require('./src/format');
const { loadUser } = require('./src/middleware/auth');
const csrf = require('./src/middleware/csrf');
const flash = require('./src/middleware/flash');

const app = express();
const base = config.basePath;

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

app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Standardwerte fuer die Views, damit auch Fehlerseiten immer rendern koennen
app.use((req, res, next) => {
  Object.assign(res.locals, {
    base,
    path: base && req.path.startsWith(base) ? req.path.slice(base.length) || '/' : req.path,
    fmt: format,
    allowRegistration: config.allowRegistration,
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
router.use(require('./src/routes/subscriptions'));
router.use('/admin', require('./src/routes/admin'));
app.use(base || '/', router);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Fehler',
    message: 'Da ist etwas schiefgelaufen. Bitte versuche es später erneut.',
  });
});

app.listen(config.port, () => {
  console.log(`AboTracker läuft auf Port ${config.port}${base ? ` unter ${base}` : ''}`);
});
