// Umrechnung und Datumslogik fuer Abrechnungszyklen

const CYCLES = {
  weekly: { label: 'Wöchentlich', perMonth: 52 / 12, days: 7 },
  monthly: { label: 'Monatlich', perMonth: 1, days: 30 },
  quarterly: { label: 'Quartalsweise', perMonth: 1 / 3, days: 91 },
  yearly: { label: 'Jährlich', perMonth: 1 / 12, days: 365 },
  // Einmalige Zahlung: zaehlt nicht zu den laufenden Monatskosten, Zahlungsdatum ist optional
  once: { label: 'Einmalig', perMonth: 0, days: Infinity },
};

// Anzahl Personen, mit denen ein Abo geteilt wird (mind. 1)
function shareOf(sub) {
  return Math.max(1, Number(sub.shared_with) || 1);
}

// Monatskosten; mit shared_with nur der eigene Anteil
function monthlyCost(amount, cycle, sharedWith = 1) {
  return (Number(amount) * CYCLES[cycle].perMonth) / Math.max(1, Number(sharedWith) || 1);
}

// Datumswerte als "YYYY-MM-DD" in lokaler Zeit behandeln
function parseDate(str) {
  const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
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

// Naechster Termin nach date gemaess Zyklus; anchorDay haelt z. B. den 31. ueber kurze Monate hinweg.
// Bei einmaligen Zahlungen gibt es keinen weiteren Termin (null).
function stepCycle(date, cycle, anchorDay) {
  if (cycle === 'once') return null;
  if (cycle === 'weekly') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
  if (cycle === 'monthly') return addMonthsClamped(date, 1, anchorDay);
  if (cycle === 'quarterly') return addMonthsClamped(date, 3, anchorDay);
  return addMonthsClamped(date, 12, anchorDay);
}

// Naechstes Zahlungsdatum >= ref, ausgehend vom gespeicherten Datum.
// null, wenn kein Datum gespeichert ist oder eine einmalige Zahlung schon vorbei ist.
function nextPaymentDate(storedDate, cycle, ref = today()) {
  if (!storedDate) return null;
  let date = parseDate(storedDate);
  if (cycle === 'once') return date >= ref ? date : null;
  const anchorDay = date.getDate();
  let guard = 0;
  while (date < ref && guard++ < 1000) date = stepCycle(date, cycle, anchorDay);
  return date;
}

function daysBetween(from, to) {
  return Math.round((to - from) / 86400000);
}

// Reichert eine Abo-Zeile um berechnete Felder an
function enrich(sub, ref = today()) {
  const next = nextPaymentDate(sub.next_payment_date, sub.billing_cycle, ref);
  const cancelBy = sub.cancel_by_date ? parseDate(sub.cancel_by_date) : null;
  const daysUntilCancel = cancelBy ? daysBetween(ref, cancelBy) : null;
  const share = shareOf(sub);
  return {
    ...sub,
    amount: Number(sub.amount),
    share,
    myAmount: Number(sub.amount) / share,
    cycleLabel: CYCLES[sub.billing_cycle].label,
    recurring: sub.billing_cycle !== 'once',
    monthly: monthlyCost(sub.amount, sub.billing_cycle, share),
    nextPayment: next,
    daysUntilPayment: next ? daysBetween(ref, next) : null,
    cancelBy,
    daysUntilCancel,
    cancelPassed: daysUntilCancel != null && daysUntilCancel < 0,
  };
}

// Alle Zahlungstermine eines Abos zwischen from und to (jeweils inklusive)
function paymentsBetween(sub, from, to) {
  if (!sub.next_payment_date) return [];
  const anchorDay = parseDate(sub.next_payment_date).getDate();
  const dates = [];
  let date = nextPaymentDate(sub.next_payment_date, sub.billing_cycle, from);
  while (date && date <= to && dates.length < 60) {
    dates.push(date);
    date = stepCycle(date, sub.billing_cycle, anchorDay);
  }
  return dates;
}

const monthLabel = new Intl.DateTimeFormat('de-CH', { month: 'short', year: '2-digit' });

// Tatsaechliche Abbuchungen (eigener Anteil) pro Monat: laufender Monat ab heute plus 11 weitere
function forecast(subs, months = 12, ref = today()) {
  const buckets = Array.from({ length: months }, (_, i) => {
    const start = new Date(ref.getFullYear(), ref.getMonth() + i, 1);
    return { label: monthLabel.format(start).replace('.', ''), total: 0, items: [] };
  });
  const end = new Date(ref.getFullYear(), ref.getMonth() + months, 0);
  for (const sub of subs) {
    if (!sub.is_active) continue;
    const myAmount = Number(sub.amount) / shareOf(sub);
    for (const date of paymentsBetween(sub, ref, end)) {
      const b = buckets[(date.getFullYear() - ref.getFullYear()) * 12 + date.getMonth() - ref.getMonth()];
      b.total += myAmount;
      // Mehrere Abbuchungen desselben Abos im Monat (z. B. woechentlich) zusammenfassen
      const item = b.items.find((x) => x.id === sub.id && x.name === sub.name);
      if (item) { item.amount += myAmount; item.count++; } else b.items.push({ id: sub.id, name: sub.name, amount: myAmount, count: 1 });
    }
  }
  for (const b of buckets) {
    b.total = Math.round(b.total * 100) / 100;
    b.items = b.items
      .sort((a, c) => c.amount - a.amount)
      .map(({ name, amount, count }) => ({ name, amount: Math.round(amount * 100) / 100, count }));
  }
  return buckets;
}

// Nur fuer die einmalige Umstellung: Frist aus der frueheren Angabe "Kuendigungsfrist in Tagen"
// (Tage vor der naechsten Zahlung; war sie schon verstrichen, zaehlte der Folgetermin)
function legacyCancelBy(sub, ref = today()) {
  if (sub.notice_period_days == null || !sub.next_payment_date) return null;
  let target = nextPaymentDate(sub.next_payment_date, sub.billing_cycle, ref);
  for (let i = 0; target && i < 1000; i++) {
    const cancelBy = new Date(target.getFullYear(), target.getMonth(), target.getDate() - sub.notice_period_days);
    if (cancelBy >= ref) return cancelBy;
    const dayAfter = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);
    target = nextPaymentDate(sub.next_payment_date, sub.billing_cycle, dayAfter);
  }
  return null;
}

module.exports = {
  CYCLES, monthlyCost, shareOf, stepCycle, nextPaymentDate, paymentsBetween, forecast,
  enrich, legacyCancelBy, daysBetween, formatISO, parseDate, today,
};
