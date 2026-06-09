'use strict';
// Pure finance logic (CommonJS).
const { createHash } = require('node:crypto');

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

// ---------- Transactions ----------
function findCol(header, name) { return header.findIndex((h) => h.trim().toLowerCase() === name); }
function num(s) { const n = parseFloat(String(s).replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; }

function normalizeTransactions(rows) {
  if (rows.length < 2) return [];
  const header = rows[0];
  const dateI = findCol(header, 'date'), descI = findCol(header, 'description');
  const amtI = findCol(header, 'amount'), debitI = findCol(header, 'debit'), creditI = findCol(header, 'credit');
  return rows.slice(1).map((r) => {
    const date = (r[dateI] || '').trim();
    const description = (r[descI] || '').trim();
    let amount = amtI !== -1 ? num(r[amtI]) : num(r[creditI]) - num(r[debitI]);
    amount = Math.round(amount * 100) / 100;
    const id = createHash('sha1').update(`${date}|${amount}|${description}`).digest('hex');
    return { id, date, description, amount };
  });
}

// ---------- Type classification (Income / Bill / Debt / Spending) ----------
const TYPES = ['income', 'bill', 'debt', 'spending'];
const DEBT_RE = /\bloan\b|credit\s*card\s*p|card\s*pmt|crd\s*pmt|cardmember|student\s*loan|auto\s*loan|kashable|affirm|klarna|lending|installment|sofi|upstart/i;
const BILL_RE = /electric|water|gas\s*(co|company|bill)|comcast|xfinity|spectrum|at&t|verizon|t-?mobile|internet|insurance|geico|state\s*farm|allstate|progressive|rent|mortgage|netflix|spotify|hulu|disney|hbo|youtube\s*premium|patreon|utilit|energy|gexa|electricity|phone\s*bill/i;

function merchantKey(desc) {
  return String(desc || '').trim().toLowerCase().replace(/\s*#?\d+$/, '').replace(/\s+/g, ' ').trim();
}

function classifyType(t, rules = [], learned = {}) {
  const d = String(t.description || '').toLowerCase();
  // 1) explicit user rules (substring match) win
  for (const r of rules) { if (r.match && d.includes(String(r.match).toLowerCase())) return r.type; }
  // 2) silently-learned per-merchant tags
  const lt = learned[merchantKey(t.description)];
  if (lt && TYPES.includes(lt)) return lt;
  // 3) automatic guess
  if (t.amount > 0) return 'income';
  if (DEBT_RE.test(t.description)) return 'debt';
  if (BILL_RE.test(t.description)) return 'bill';
  return 'spending';
}

function typeAll(txns, rules = [], learned = {}) {
  return txns.map((t) => ({ ...t, type: classifyType(t, rules, learned) }));
}

// Remember a type for a merchant (silent; keyed by normalized merchant name).
function learnTypeMap(learned, description, type) {
  const key = merchantKey(description);
  if (!key || !TYPES.includes(type)) return learned;
  return { ...learned, [key]: type };
}

function sanitizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [], seen = new Set();
  for (const r of rules) {
    const match = String(r && r.match || '').trim().toLowerCase();
    const type = r && r.type;
    if (!match || !TYPES.includes(type) || seen.has(match)) continue;
    seen.add(match);
    out.push({ match, type });
  }
  return out;
}

// ---------- Income (auto-detected) ----------
function round(n) { return Math.round(n * 100) / 100; }
function monthKey(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }

// Typical full-month income from income-typed deposits. Excludes the current
// (incomplete) month when earlier months exist, so payday timing doesn't skew it.
function computeMonthlyIncome(typedTxns, today = new Date()) {
  const byMonth = {};
  for (const t of typedTxns) {
    if (t.type !== 'income') continue;
    const m = (t.date || '').slice(0, 7);
    if (!m) continue;
    byMonth[m] = (byMonth[m] || 0) + t.amount;
  }
  let months = Object.keys(byMonth).sort();
  if (months.length === 0) return 0;
  const cur = monthKey(today);
  if (months.length > 1 && months[months.length - 1] === cur) months = months.slice(0, -1);
  const total = months.reduce((s, m) => s + byMonth[m], 0);
  return round(total / months.length);
}

// ---------- Budget ----------
function computeBudget(typedTxns, settings, today = new Date()) {
  const month = monthKey(today);
  const inMonth = typedTxns.filter((t) => (t.date || '').slice(0, 7) === month);
  const byType = { income: 0, bill: 0, debt: 0, spending: 0 };
  for (const t of inMonth) {
    if (t.type === 'income') byType.income += t.amount;
    else byType[t.type] = (byType[t.type] || 0) + (t.amount < 0 ? -t.amount : 0);
  }
  for (const k of TYPES) byType[k] = round(byType[k]);
  const inflows = byType.income;
  const outflows = round(byType.bill + byType.debt + byType.spending);
  const monthlyIncome = computeMonthlyIncome(typedTxns, today);

  const year = today.getUTCFullYear(), monthIdx = today.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - today.getUTCDate() + 1;
  const savingsTarget = settings.savingsTargetMonthly || 0;
  const safeToSpendRemaining = round(monthlyIncome - savingsTarget - outflows);
  const safeToSpendPerDay = round(Math.max(0, safeToSpendRemaining) / daysLeft);

  return { month, monthlyIncome, savingsTarget, inflows, outflows, byType, daysInMonth, daysLeft, safeToSpendRemaining, safeToSpendPerDay };
}

// ---------- Recurring ----------
function detectRecurring(txns) {
  const groups = new Map();
  for (const t of txns) { const k = merchantKey(t.description); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const result = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const avg = items.reduce((s, t) => s + t.amount, 0) / items.length;
    if (!items.every((t) => Math.abs(t.amount - avg) <= Math.abs(avg) * 0.05)) continue;
    result.push({ description: items[0].description, amount: round(avg), occurrences: items.length, kind: avg < 0 ? 'expense' : 'income' });
  }
  return result;
}

// ---------- Recommendations ----------
function recommend(typedTxns, summary, recurring = []) {
  const recs = [];
  if (summary.safeToSpendRemaining < 0)
    recs.push({ type: 'overspend', message: `You're $${Math.abs(summary.safeToSpendRemaining).toFixed(2)} over budget this month. Ease up on discretionary spending to protect your $${summary.savingsTarget} savings.` });
  if (summary.byType && summary.byType.debt > 0)
    recs.push({ type: 'debt', message: `$${summary.byType.debt.toFixed(2)} went to debt payments this month. Paying debt down faster is a guaranteed return — worth prioritizing.` });
  for (const r of recurring.filter((x) => x.kind === 'expense'))
    recs.push({ type: 'subscription', message: `Recurring charge: ${r.description} (~$${Math.abs(r.amount).toFixed(2)}/mo, ${r.occurrences}x). Still using it?` });
  if (summary.safeToSpendRemaining > summary.savingsTarget && summary.savingsTarget >= 0)
    recs.push({ type: 'savings', message: `You have a surplus this month. Consider raising your savings target — that money can feed your retirement contributions.` });
  return recs;
}

// ---------- Projection ----------
const DEFAULT_RATES = { low: 0.04, expected: 0.07, high: 0.10 };
function simulate(startBalance, monthlyContribution, years, annualRate) {
  const byYear = [round(startBalance)];
  let balance = startBalance;
  for (let m = 1; m <= years * 12; m++) { balance = balance * (1 + annualRate / 12) + monthlyContribution; if (m % 12 === 0) byYear.push(round(balance)); }
  return byYear;
}
function computeProjection(currentBalance, monthlyContribution, currentAge, retirementAge, rates = DEFAULT_RATES) {
  const years = Math.max(0, retirementAge - currentAge);
  const low = simulate(currentBalance, monthlyContribution, years, rates.low);
  const expected = simulate(currentBalance, monthlyContribution, years, rates.expected);
  const high = simulate(currentBalance, monthlyContribution, years, rates.high);
  const points = [];
  for (let i = 0; i <= years; i++) points.push({ year: i, age: currentAge + i, low: low[i], expected: expected[i], high: high[i] });
  return points;
}

// ---------- Retirement guidance ----------
const IRA_ANNUAL_CAP = 7000;
function generateRetirementGuidance({ currentAge, retirementAge, effectiveContribution, goalAmount, projectedAtRetirement }) {
  const out = [];
  out.push({ type: 'reassurance', message: 'Market dips are normal and temporary — your automatic contributions buy more shares when prices are low. This plan only works if you don’t bail out in a panic. Stay the course.' });
  const annual = Math.round(effectiveContribution * 12);
  if (annual < IRA_ANNUAL_CAP) out.push({ type: 'contribution', message: `You’re contributing ~$${annual}/yr. You have room for ~$${IRA_ANNUAL_CAP - annual} more this year before the Roth IRA cap.` });
  else out.push({ type: 'contribution', message: `You’re at or above the ~$${IRA_ANNUAL_CAP} Roth IRA cap. Extra savings can go toward a taxable bridge account for the years before age 59½.` });
  if (goalAmount) {
    if (projectedAtRetirement >= goalAmount) out.push({ type: 'on-track', message: `On track: projected ~$${Math.round(projectedAtRetirement).toLocaleString()} by age ${retirementAge}, at or above your $${goalAmount.toLocaleString()} goal.` });
    else out.push({ type: 'shortfall', message: `Projected ~$${Math.round(projectedAtRetirement).toLocaleString()} by age ${retirementAge}, below your $${goalAmount.toLocaleString()} goal. Increasing monthly contributions is the surest fix.` });
  }
  const years = retirementAge - currentAge;
  if (years <= 2) out.push({ type: 'milestone', message: `You’re within ${years} year(s) of your target — time to plan how you’ll draw this down (and mind the 59½ early-withdrawal rule).` });
  return out;
}

module.exports = {
  parseCsv, normalizeTransactions,
  TYPES, classifyType, typeAll, learnTypeMap, sanitizeRules, merchantKey,
  computeMonthlyIncome, computeBudget, detectRecurring, recommend,
  computeProjection, DEFAULT_RATES, generateRetirementGuidance, IRA_ANNUAL_CAP,
};
