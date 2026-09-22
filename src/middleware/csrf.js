const crypto = require('crypto');

// Einfacher Synchronizer-Token-Schutz fuer alle POST-Formulare
function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (req.method === 'POST') {
    const sent = String((req.body && req.body._csrf) || '');
    const expected = req.session.csrfToken;
    const ok = sent.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
    if (!ok) {
      return res.status(403).render('error', {
        title: 'Sitzung abgelaufen',
        message: 'Das Formular ist abgelaufen. Bitte lade die Seite neu und versuche es erneut.',
      });
    }
  }
  next();
}

module.exports = csrf;
