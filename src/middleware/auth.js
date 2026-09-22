const pool = require('../db');

// Laedt den eingeloggten Benutzer bei jedem Request frisch aus der DB,
// damit Sperrungen und Rollenaenderungen sofort greifen.
async function loadUser(req, res, next) {
  res.locals.currentUser = null;
  if (!req.session.userId) return next();

  const [rows] = await pool.query(
    'SELECT id, email, name, role, is_active FROM users WHERE id = ?',
    [req.session.userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    req.session.userId = null;
    return next();
  }
  req.user = user;
  res.locals.currentUser = user;
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect(`${res.locals.base}/login`);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect(`${res.locals.base}/login`);
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Dieser Bereich ist nur für Administratoren.' });
  }
  next();
}

module.exports = { loadUser, requireLogin, requireAdmin };
