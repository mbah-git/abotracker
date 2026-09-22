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

  // Sicherheitsabfrage vor destruktiven Aktionen
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Donut-Diagramm auf dem Dashboard
  var canvas = document.getElementById('categoryChart');
  if (canvas && window.Chart) {
    var data = JSON.parse(canvas.getAttribute('data-chart') || '[]');
    var styles = getComputedStyle(document.documentElement);
    var money = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

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
