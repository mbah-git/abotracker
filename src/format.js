// Formatierungs-Helfer fuer die Views (deutsches Format)

const currencyFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

function toDate(value) {
  if (value instanceof Date) return value;
  // "YYYY-MM-DD" oder "YYYY-MM-DD HH:MM:SS" aus MySQL (dateStrings)
  const [d, t = '00:00:00'] = String(value).split(' ');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min, s] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h, min, s);
}

module.exports = {
  money: (n) => currencyFmt.format(Number(n) || 0),
  date: (value) => (value ? dateFmt.format(toDate(value)) : '–'),
  relDays: (days) => {
    if (days === 0) return 'heute';
    if (days === 1) return 'morgen';
    if (days < 0) return `vor ${-days} Tagen`;
    return `in ${days} Tagen`;
  },
};
