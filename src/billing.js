// Umrechnung und Datumslogik fuer Abrechnungszyklen

const CYCLES = {
  weekly: { label: 'Wöchentlich', perMonth: 52 / 12 },
  monthly: { label: 'Monatlich', perMonth: 1 },
  quarterly: { label: 'Quartalsweise', perMonth: 1 / 3 },
  yearly: { label: 'Jährlich', perMonth: 1 / 12 },
};

function monthlyCost(amount, cycle) {
  return Number(amount) * CYCLES[cycle].perMonth;
}

// Datumswerte als "YYYY-MM-DD" in lokaler Zeit behandeln
function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addMonthsClamped(date, months, anchorDay) {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(anchorDay, lastDay));
  return target;
}

// Liefert das naechste Zahlungsdatum >= heute, ausgehend vom gespeicherten Datum.
function nextPaymentDate(storedDate, cycle, ref = today()) {
  let date = parseDate(storedDate);
  const anchorDay = date.getDate();
  let guard = 0;
  while (date < ref && guard++ < 1000) {
    if (cycle === 'weekly') date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
    else if (cycle === 'monthly') date = addMonthsClamped(date, 1, anchorDay);
    else if (cycle === 'quarterly') date = addMonthsClamped(date, 3, anchorDay);
    else date = addMonthsClamped(date, 12, anchorDay);
  }
  return date;
}

function daysBetween(from, to) {
  return Math.round((to - from) / 86400000);
}

// Reichert eine Abo-Zeile um berechnete Felder an
function enrich(sub, ref = today()) {
  const next = nextPaymentDate(sub.next_payment_date, sub.billing_cycle, ref);
  let cancelBy = null;
  let cancelEffective = null;
  if (sub.notice_period_days != null) {
    // Frist fuer den naechsten Termin schon verstrichen? Dann zaehlt der Folgetermin.
    let target = next;
    for (let i = 0; i < 1000; i++) {
      cancelBy = new Date(target.getFullYear(), target.getMonth(), target.getDate() - sub.notice_period_days);
      if (cancelBy >= ref) break;
      const dayAfter = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);
      target = nextPaymentDate(sub.next_payment_date, sub.billing_cycle, dayAfter);
    }
    cancelEffective = target;
  }
  return {
    ...sub,
    amount: Number(sub.amount),
    cycleLabel: CYCLES[sub.billing_cycle].label,
    monthly: monthlyCost(sub.amount, sub.billing_cycle),
    nextPayment: next,
    daysUntilPayment: daysBetween(ref, next),
    cancelBy,
    cancelEffective,
    daysUntilCancel: cancelBy ? daysBetween(ref, cancelBy) : null,
  };
}

module.exports = { CYCLES, monthlyCost, nextPaymentDate, enrich, formatISO, parseDate, today };
