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

// ---------- Category classification ----------
const TYPES = [
  'Income', 'Other Income', 'Bills & Utilities', 'Housing', 'Debt', 'Groceries',
  'Dining', 'Auto & Transport', 'Shopping', 'Subscriptions', 'Health', 'Entertainment', 'Other',
];
// Money-in categories: shown as inflow, but only 'Income' counts as the earned
// baseline that drives safe-to-spend. 'Other Income' (gifts/reimbursements) nets
// against the month but never inflates the recurring income figure.
const INFLOW_TYPES = ['Income', 'Other Income'];
// Ordered rules; first match wins. Income is handled by a positive amount.
const CATEGORY_RULES = [
  [/\bloan\b|credit\s*card\s*p|card\s*pmt|crd\s*pmt|cardmember|student\s*loan|auto\s*loan|kashable|affirm|klarna|lending|installment|sofi|upstart|toyota|personify/i, 'Debt'],
  [/rent|mortgage|invitation\s*homes|landlord|apartment|leasing|property\s*mgmt|hoa\b/i, 'Housing'],
  [/electric|water|atmos|gas\s*(co|company|service|bill)|coserv|optimum|cable|comcast|xfinity|spectrum|at&t|verizon|t-?mobile|internet|insurance|geico|state\s*farm|allstate|progressive|utilit|energy|gexa|electricity|phone\s*bill|render\.com|waste|sewer|trash/i, 'Bills & Utilities'],
  [/netflix|spotify|hulu|disney\s*plus|disney\+|hbo|youtube\s*premium|patreon|rocket\s*money|google\s*one|icloud|apple\.com\/bill|prime\s*video|audible|adobe|microsoft|dropbox|membership/i, 'Subscriptions'],
  [/kroger|safeway|whole\s*foods|trader\s*joe|aldi|h-?e-?b|publix|sprouts|food\s*lion|wegmans|grocery|tom\s*thumb|market\s*street/i, 'Groceries'],
  [/restaurant|starbucks|coffee|mcdonald|chick-?fil|taco|pizza|doordash|uber\s*eats|grubhub|chipotle|sonic|wendy|burger|cafe|dunkin|panera|subway|domino|whataburger|grill|\bbbq\b|ihop|chili/i, 'Dining'],
  [/shell|chevron|exxon|valero|conoco|phillips\s*66|quiktrip|racetrac|buc-?ee|\bgas\b|fuel|uber\b|lyft|parking|toll|ntta|transit|autozone|o'reilly|jiffy\s*lube|car\s*wash|firestone|discount\s*tire|\bdmv\b/i, 'Auto & Transport'],
  [/cvs|walgreens|rite\s*aid|pharmacy|medical|dental|dentist|clinic|hospital|doctor|\bgym\b|fitness|planet\s*fitness|lifetime|optometr|vision/i, 'Health'],
  [/cinema|\bamc\b|theater|theatre|steampowered|playstation|xbox|nintendo|ticketmaster|stubhub|concert|six\s*flags|\bmovie/i, 'Entertainment'],
  [/amazon|amzn|target|walmart|wal-?mart|costco|best\s*buy|home\s*depot|lowe'?s|etsy|\bebay\b|ikea|macy|kohl|marshalls|tj\s*maxx|dollar\s*(tree|general)|wayfair|\bshop\b/i, 'Shopping'],
];

// Roll noisy descriptions up to a clean merchant name for the top-merchants chart
// (e.g. "PP DOORDASH KROGER 402" and "PP DOORDASH KRYSTAL 40" -> "DoorDash").
const MERCHANT_ALIASES = [
  [/doordash/i, 'DoorDash'], [/uber\s*eats/i, 'Uber Eats'], [/\buber\b/i, 'Uber'],
  [/\blyft\b/i, 'Lyft'], [/grubhub/i, 'Grubhub'], [/instacart/i, 'Instacart'],
  [/affirm/i, 'Affirm'], [/personify/i, 'Personify'], [/kashable/i, 'Kashable'],
  [/amazon|amzn/i, 'Amazon'], [/walmart|wal-?mart/i, 'Walmart'], [/\btarget\b/i, 'Target'],
  [/starbucks/i, 'Starbucks'], [/kroger/i, 'Kroger'], [/costco/i, 'Costco'],
  [/t-?mobile/i, 'T-Mobile'], [/\bat&t\b|att\s/i, 'AT&T'], [/verizon/i, 'Verizon'],
  [/usaa/i, 'USAA'], [/netflix/i, 'Netflix'], [/spotify/i, 'Spotify'],
  [/shell/i, 'Shell'], [/chevron/i, 'Chevron'], [/texaco/i, 'Texaco'], [/exxon/i, 'Exxon'],
  [/apple\.com|\bapple\b/i, 'Apple'], [/google/i, 'Google'], [/coserv/i, 'CoServ'],
  [/optimum/i, 'Optimum'], [/invitation\s*homes/i, 'Invitation Homes'], [/toyota/i, 'Toyota'],
];

function merchantDisplayName(desc) {
  for (const [re, name] of MERCHANT_ALIASES) if (re.test(desc)) return name;
  return String(desc || '')
    .replace(/\*/g, ' ').replace(/\b\d{3,}\b/g, '').replace(/\s{2,}/g, ' ').trim()
    .replace(/\s+\d+$/, '').slice(0, 28) || String(desc || '');
}

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
  if (t.amount > 0) return 'Income';
  for (const [re, cat] of CATEGORY_RULES) { if (re.test(t.description)) return cat; }
  return 'Other';
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
    if (t.type !== 'Income') continue;
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

  // per-category totals (Income = inflow; everything else = outflow magnitude)
  const byCategory = {};
  for (const k of TYPES) byCategory[k] = 0;
  const merchants = {};
  const INFLOW = new Set(INFLOW_TYPES);
  for (const t of inMonth) {
    if (INFLOW.has(t.type)) { byCategory[t.type] += t.amount; continue; }
    const out = t.amount < 0 ? -t.amount : 0;
    byCategory[t.type] = (byCategory[t.type] || 0) + out;
    if (out > 0) {
      const name = merchantDisplayName(t.description);
      if (!merchants[name]) merchants[name] = { name, amount: 0 };
      merchants[name].amount += out;
    }
  }
  for (const k of TYPES) byCategory[k] = round(byCategory[k]);
  const inflows = byCategory.Income;
  const otherIncome = byCategory['Other Income'];
  const outflows = round(TYPES.filter((k) => !INFLOW.has(k)).reduce((s, k) => s + byCategory[k], 0));
  const topMerchants = Object.values(merchants)
    .map((m) => ({ name: m.name, amount: round(m.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);
  const monthlyIncome = computeMonthlyIncome(typedTxns, today);

  const year = today.getUTCFullYear(), monthIdx = today.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - today.getUTCDate() + 1;
  const savingsTarget = settings.savingsTargetMonthly || 0;
  const safeToSpendRemaining = round(monthlyIncome + otherIncome - savingsTarget - outflows);
  const safeToSpendPerDay = round(Math.max(0, safeToSpendRemaining) / daysLeft);

  return { month, monthlyIncome, savingsTarget, inflows, otherIncome, outflows, byCategory, topMerchants, daysInMonth, daysLeft, safeToSpendRemaining, safeToSpendPerDay };
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
  if (summary.byCategory && summary.byCategory.Debt > 0)
    recs.push({ type: 'debt', message: `$${summary.byCategory.Debt.toFixed(2)} went to debt payments this month. Paying debt down faster is a guaranteed return — worth prioritizing.` });
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
