'use strict';
// Pay-period cash-flow planner: paydays, bills-by-due-date, IRA set-aside, and
// "safe to spend until next payday".

const { merchantKey, merchantDisplayName } = require('./core');
const DAY = 86400000;
const round = (n) => Math.round(n * 100) / 100;
const BILL_CATEGORIES = new Set(['Bills & Utilities', 'Housing', 'Debt', 'Subscriptions']);
const INFLOW = new Set(['Income', 'Other Income']);
const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
function iso(d) { return d.toISOString().slice(0, 10); }
function startOfDay(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function addInterval(d, freq) {
  if (freq === 'monthly') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  const days = freq === 'weekly' ? 7 : freq === 'semimonthly' ? 15 : 14;
  return new Date(d.getTime() + days * DAY);
}

// The pay period [start, end) that contains `today`.
function currentPayPeriod(ps, today = new Date()) {
  const t = startOfDay(today);
  const freq = ps.frequency || 'biweekly';
  let start = parseDate(ps.anchorDate);
  // walk forward/back to bracket today
  if (start > t) { while (start > t) start = addBack(start, freq); }
  while (addInterval(start, freq) <= t) start = addInterval(start, freq);
  const end = addInterval(start, freq);
  return { start, end };
}
function addBack(d, freq) {
  if (freq === 'monthly') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()));
  const days = freq === 'weekly' ? 7 : freq === 'semimonthly' ? 15 : 14;
  return new Date(d.getTime() - days * DAY);
}

// Paydays within [from, to] (inclusive) — used by the calendar.
function paydaysBetween(ps, from, to) {
  const freq = ps.frequency || 'biweekly';
  const out = [];
  let d = parseDate(ps.anchorDate);
  while (d > from) d = addBack(d, freq);
  while (d <= to) {
    if (d >= from) out.push(iso(d));
    d = addInterval(d, freq);
  }
  return out;
}

// Dates (Date objects) a bill falls on within [from, to] inclusive.
function billOccurrences(bill, from, to) {
  const out = [];
  if ((bill.recurrence === 'biweekly') && bill.anchorDate) {
    let d = parseDate(bill.anchorDate);
    while (d.getTime() > from.getTime()) d = new Date(d.getTime() - 14 * DAY);
    while (d.getTime() < from.getTime()) d = new Date(d.getTime() + 14 * DAY);
    for (; d.getTime() <= to.getTime(); d = new Date(d.getTime() + 14 * DAY)) out.push(new Date(d));
  } else {
    let y = from.getUTCFullYear(), m = from.getUTCMonth();
    const endY = to.getUTCFullYear(), endM = to.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      const dd = Math.min(bill.dueDay || 1, daysInMonth(y, m));
      const date = new Date(Date.UTC(y, m, dd));
      if (date.getTime() >= from.getTime() && date.getTime() <= to.getTime()) out.push(date);
      m++; if (m > 11) { m = 0; y++; }
    }
  }
  return out;
}

// Bills due in [start, end) — handles monthly + biweekly recurrence.
function billsDueInRange(bills, start, end) {
  let total = 0;
  const due = [];
  const last = new Date(end.getTime() - DAY);
  for (const b of bills) {
    for (const d of billOccurrences(b, start, last)) {
      total += Number(b.amount) || 0;
      due.push({ name: b.name, amount: Number(b.amount) || 0, date: iso(d) });
    }
  }
  return { total: round(total), due };
}

// Has a bill been paid for THIS occurrence's cycle? Matches a transaction by
// merchant within (previous occurrence, this occurrence + 7d grace], up to today
// — so paying early (between paychecks) still counts, but last cycle's payment
// doesn't bleed into this one.
function isPaid(bill, occurrenceISO, txns, todayISO) {
  // match by clean merchant name (alias-aware) so varying masked suffixes still match
  const key = merchantDisplayName(bill.name).toLowerCase();
  if (!key) return false;
  const occ = parseDate(occurrenceISO);
  const prev = (bill.recurrence === 'biweekly')
    ? new Date(occ.getTime() - 14 * DAY)
    : new Date(Date.UTC(occ.getUTCFullYear(), occ.getUTCMonth() - 1, occ.getUTCDate()));
  const prevISO = iso(prev);
  const graceISO = iso(new Date(occ.getTime() + 7 * DAY));
  for (const t of txns) {
    if (!t.date || t.amount >= 0) continue;
    if (t.date <= prevISO || t.date > graceISO || t.date > todayISO) continue;
    if (merchantDisplayName(t.description).toLowerCase() === key) return true;
  }
  return false;
}

// Bills due across a whole month (for the calendar) keyed by ISO date, with paid status.
function billsForMonth(bills, year, monthIdx, txns = [], todayISO = '9999-12-31') {
  const first = new Date(Date.UTC(year, monthIdx, 1));
  const last = new Date(Date.UTC(year, monthIdx + 1, 0));
  const map = {};
  for (const b of bills) {
    for (const d of billOccurrences(b, first, last)) {
      const key = iso(d);
      (map[key] = map[key] || []).push({ name: b.name, amount: Number(b.amount) || 0, paid: isPaid(b, key, txns, todayISO) });
    }
  }
  return map;
}

// Average paycheck from detected Income deposits (last ~100 days) — adapts to OT.
function avgPaycheck(typedTxns, today) {
  const cutoff = iso(new Date(startOfDay(today).getTime() - 100 * DAY));
  const amts = typedTxns.filter((t) => t.type === 'Income' && t.amount > 0 && t.date >= cutoff).map((t) => t.amount);
  if (!amts.length) return 0;
  return round(amts.reduce((a, b) => a + b, 0) / amts.length);
}

// Unpaid bills due from today through the day before the next payday.
function upcomingBillsBeforePayday(bills, todayISO, nextPaydayISO, txns) {
  const from = parseDate(todayISO);
  const lastDay = new Date(parseDate(nextPaydayISO).getTime() - DAY);
  const list = [];
  let unpaidTotal = 0;
  for (const b of bills) {
    for (const d of billOccurrences(b, from, lastDay)) {
      const dateISO = iso(d);
      const paid = isPaid(b, dateISO, txns, todayISO);
      list.push({ name: b.name, amount: round(Number(b.amount) || 0), date: dateISO, paid });
      if (!paid) unpaidTotal += Number(b.amount) || 0;
    }
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  return { unpaidTotal: round(unpaidTotal), list };
}

function computeCashflow(typedTxns, opts, today = new Date()) {
  const ps = opts.paySchedule;
  if (!ps || !ps.anchorDate) return null;
  const { start, end } = currentPayPeriod(ps, today);
  const t = startOfDay(today);
  const daysLeft = Math.max(1, Math.round((end - t) / DAY));
  const freq = ps.frequency || 'biweekly';
  const startISO = iso(start), todayISO = iso(t);

  // Income = ACTUAL paychecks deposited this period (captures OT); fall back to an
  // estimate (typed amount, else detected average) before the check lands.
  let paychecks = 0, otherInc = 0, discretionarySpent = 0;
  for (const tx of typedTxns) {
    if (!tx.date || tx.date < startISO || tx.date > todayISO) continue;
    if (tx.type === 'Income' && tx.amount > 0) paychecks += tx.amount;
    else if (tx.type === 'Other Income' && tx.amount > 0) otherInc += tx.amount;
    else if (tx.amount < 0 && !BILL_CATEGORIES.has(tx.type)) discretionarySpent += -tx.amount;
  }
  const estimate = Number(ps.amount) > 0 ? round(Number(ps.amount)) : avgPaycheck(typedTxns, today);
  const earned = paychecks > 0 ? round(paychecks) : estimate;
  const income = round(earned + otherInc);
  discretionarySpent = round(discretionarySpent);

  const iraSetAside = round((Number(opts.iraMonthly) || 0) * 12 / (PERIODS_PER_YEAR[freq] || 26));
  const { total: billsDue, due: billsDueList } = billsDueInRange(opts.bills || [], start, end);
  const safeToSpendRemaining = round(income - iraSetAside - billsDue - discretionarySpent);
  const safeToSpendPerDay = round(Math.max(0, safeToSpendRemaining) / daysLeft);
  return {
    start: startISO, end: iso(end), nextPayday: iso(end), followingPayday: iso(addInterval(end, freq)), daysLeft,
    income, earned, estimate, paycheckReceived: paychecks > 0, otherIncome: round(otherInc),
    iraSetAside, billsDue, billsDueList, discretionarySpent,
    safeToSpendRemaining, safeToSpendPerDay,
  };
}

module.exports = { currentPayPeriod, paydaysBetween, billsDueInRange, billsForMonth, computeCashflow, upcomingBillsBeforePayday };
