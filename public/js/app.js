// Kleines Frontend-Skript. Keine Inline-Skripte/-Styles wegen Content-Security-Policy.
(function () {
  'use strict';

  var HEX = /^#[0-9a-f]{6}$/i;

  // Farben und Balkenbreiten aus data-Attributen setzen
  document.querySelectorAll('[data-color]').forEach(function (el) {
    var color = el.getAttribute('data-color');
    if (HEX.test(color)) el.style.backgroundColor = color;
  });
  document.querySelectorAll('[data-width]').forEach(function (el) {
    el.style.width = Math.min(100, Number(el.getAttribute('data-width')) || 0) + '%';
  });

  // ---- PWA ----
  var base = document.body.getAttribute('data-base');
  if ('serviceWorker' in navigator && base !== null) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register(base + '/sw.js', { scope: base + '/' }).catch(function (err) {
        console.warn('Service Worker nicht registriert:', err);
      });
    });
  }

  // "App installieren"-Button, sobald der Browser die Installation anbietet (Chrome, Edge, Android)
  var installBtn = document.getElementById('installBtn');
  var installPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt.userChoice.finally(function () {
        installPrompt = null;
        installBtn.hidden = true;
      });
    });
  }
  window.addEventListener('appinstalled', function () {
    if (installBtn) installBtn.hidden = true;
  });

  // Offline-Seite: erneut laden
  document.querySelectorAll('[data-reload]').forEach(function (el) {
    el.addEventListener('click', function () { window.location.reload(); });
  });

  // Sicherheitsabfrage vor destruktiven Aktionen
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Balkendiagramm: Abbuchungen der naechsten 12 Monate
  var forecastCanvas = document.getElementById('forecastChart');
  if (forecastCanvas && window.Chart) {
    var months = JSON.parse(forecastCanvas.getAttribute('data-forecast') || '[]');
    var css = getComputedStyle(document.documentElement);
    var chf = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' });
    var chfShort = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF', maximumFractionDigits: 0 });
    var muted = css.getPropertyValue('--muted').trim();
    var grid = css.getPropertyValue('--border').trim();

    new window.Chart(forecastCanvas, {
      type: 'bar',
      data: {
        labels: months.map(function (m) { return m.label; }),
        datasets: [{
          data: months.map(function (m) { return m.total; }),
          backgroundColor: css.getPropertyValue('--accent').trim() || '#4f46e5',
          borderRadius: 6,
          maxBarThickness: 48,
        }],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ' ' + chf.format(ctx.parsed.y); },
              afterBody: function (items) {
                var m = months[items[0].dataIndex];
                var lines = m.items.slice(0, 6).map(function (i) {
                  return '• ' + i.name + (i.count > 1 ? ' (' + i.count + '×)' : '') + ': ' + chf.format(i.amount);
                });
                if (m.items.length > 6) lines.push('• … und ' + (m.items.length - 6) + ' weitere');
                return lines;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: muted } },
          y: { beginAtZero: true, grid: { color: grid }, ticks: { color: muted, callback: function (v) { return chfShort.format(v); } } },
        },
      },
    });
  }

  // Donut-Diagramm auf dem Dashboard
  var canvas = document.getElementById('categoryChart');
  if (canvas && window.Chart) {
    var data = JSON.parse(canvas.getAttribute('data-chart') || '[]');
    var styles = getComputedStyle(document.documentElement);
    var money = new Intl.NumberFormat('de-CH', { style: 'currency', currency: 'CHF' });

    new window.Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map(function (c) { return c.name; }),
        datasets: [{
          data: data.map(function (c) { return c.total; }),
          backgroundColor: data.map(function (c) { return HEX.test(c.color) ? c.color : '#9ca3af'; }),
          borderColor: styles.getPropertyValue('--surface').trim() || '#fff',
          borderWidth: 2,
        }],
      },
      options: {
        cutout: '62%',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ' ' + ctx.label + ': ' + money.format(ctx.parsed); },
            },
          },
        },
      },
    });
  }
})();
