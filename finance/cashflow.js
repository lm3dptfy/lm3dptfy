'use strict';
// Pay-period cash-flow planner: paydays, bills-by-due-date, IRA set-aside, and
// "safe to spend until next payday".

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

// Which calendar dates in [start, end) does each bill fall on (clamps day to month length).
function billsDueInRange(bills, start, end) {
  let total = 0;
  const due = [];
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + DAY)) {
    const dom = d.getUTCDate();
    const last = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
    for (const b of bills) {
      const dd = Math.min(b.dueDay, last);
      if (dom === dd) { total += Number(b.amount) || 0; due.push({ name: b.name, amount: Number(b.amount) || 0, date: iso(d) }); }
    }
  }
  return { total: round(total), due };
}

// Bills due across a whole month (for the calendar) keyed by ISO date.
function billsForMonth(bills, year, monthIdx) {
  const map = {};
  const last = daysInMonth(year, monthIdx);
  for (const b of bills) {
    const dd = Math.min(b.dueDay, last);
    const key = iso(new Date(Date.UTC(year, monthIdx, dd)));
    (map[key] = map[key] || []).push({ name: b.name, amount: Number(b.amount) || 0 });
  }
  return map;
}

function computeCashflow(typedTxns, opts, today = new Date()) {
  const ps = opts.paySchedule;
  if (!ps || !ps.anchorDate || !(Number(ps.amount) > 0)) return null;
  const { start, end } = currentPayPeriod(ps, today);
  const t = startOfDay(today);
  const daysLeft = Math.max(1, Math.round((end - t) / DAY));
  const freq = ps.frequency || 'biweekly';
  const income = round(Number(ps.amount) || 0);
  const iraSetAside = round((Number(opts.iraMonthly) || 0) * 12 / (PERIODS_PER_YEAR[freq] || 26));
  const { total: billsDue, due: billsDueList } = billsDueInRange(opts.bills || [], start, end);

  const startISO = iso(start), todayISO = iso(t);
  let discretionarySpent = 0;
  for (const tx of typedTxns) {
    if (!tx.date || tx.date < startISO || tx.date > todayISO) continue;
    if (tx.amount >= 0 || BILL_CATEGORIES.has(tx.type) || INFLOW.has(tx.type)) continue;
    discretionarySpent += -tx.amount;
  }
  discretionarySpent = round(discretionarySpent);

  const safeToSpendRemaining = round(income - iraSetAside - billsDue - discretionarySpent);
  const safeToSpendPerDay = round(Math.max(0, safeToSpendRemaining) / daysLeft);
  return {
    start: startISO, end: iso(end), nextPayday: iso(end), daysLeft,
    income, iraSetAside, billsDue, billsDueList, discretionarySpent,
    safeToSpendRemaining, safeToSpendPerDay,
  };
}

module.exports = { currentPayPeriod, paydaysBetween, billsDueInRange, billsForMonth, computeCashflow };
