'use strict';
// Mounts the finance section onto an existing Express app.
// Surgical + additive: only registers /api/finance/* routes, all behind requireAdmin.
const { createStore } = require('./store');
const { claimAccessUrl, fetchSimplefinAccounts, simplefinToTransactions } = require('./simplefin');
const {
  parseCsv, normalizeTransactions, typeAll, learnTypeMap, sanitizeRules, detectRecurring,
  computeBudget, recommend, computeProjection, generateRetirementGuidance, TYPES, merchantKey,
} = require('./core');
const { computeCashflow } = require('./cashflow');

const BILL_CATS = new Set(['Bills & Utilities', 'Housing', 'Debt', 'Subscriptions']);
function iraMonthlyOf(store) {
  const r = store.getRetirementSettings();
  return r.monthlyContribution != null ? r.monthlyContribution : (store.getSettings().savingsTargetMonthly || 0);
}
function mode(nums) {
  const c = {};
  let best = nums[0], bestN = 0;
  for (const n of nums) { c[n] = (c[n] || 0) + 1; if (c[n] > bestN) { bestN = c[n]; best = n; } }
  return best;
}
function sanitizeBills(bills) {
  if (!Array.isArray(bills)) return [];
  return bills.map((b) => ({
    id: String(b.id || Math.random().toString(36).slice(2, 9)),
    name: String(b.name || '').slice(0, 60).trim() || 'Bill',
    amount: Math.max(0, Math.round((Number(b.amount) || 0) * 100) / 100),
    dueDay: Math.min(31, Math.max(1, Math.round(Number(b.dueDay) || 1))),
  })).filter((b) => b.amount > 0);
}

function mountFinance(app, { requireAdmin, storePath, simplefinFetch } = {}) {
  if (typeof requireAdmin !== 'function') throw new Error('mountFinance requires a requireAdmin middleware');
  const store = createStore(storePath);
  const sfFetch = simplefinFetch || globalThis.fetch;
  const guard = requireAdmin;

  async function runSync() {
    const { accessUrl, lastSync } = store.getSimplefin();
    if (!accessUrl) return { imported: 0, skipped: 'not connected' };
    const startDate = lastSync || Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
    const accountSet = await fetchSimplefinAccounts(accessUrl, { startDate, fetchImpl: sfFetch });
    const txns = simplefinToTransactions(accountSet);
    store.addTransactions(txns);
    store.setSimplefin({ lastSync: Math.floor(Date.now() / 1000) });
    return { imported: txns.length };
  }

  // ---- Budget ----
  app.post('/api/finance/settings', guard, (req, res) => {
    store.setSettings(req.body || {});
    res.json(store.getSettings());
  });

  app.post('/api/finance/import', guard, (req, res) => {
    const csv = (req.body && req.body.csv) || '';
    const txns = normalizeTransactions(parseCsv(csv));
    store.addTransactions(txns);
    res.json({ imported: txns.length });
  });

  app.get('/api/finance/budget', guard, (req, res) => {
    const rules = store.getTypeRules();
    const typed = typeAll(store.getTransactions(), rules, store.getLearnedTypes());
    const settings = store.getSettings();
    const summary = computeBudget(typed, settings, new Date());
    const recurring = detectRecurring(typed);
    // newest first for the editable list
    const transactions = [...typed].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const paySchedule = store.getPaySchedule();
    const bills = store.getBills();
    summary.payPeriod = computeCashflow(typed, { paySchedule, bills, iraMonthly: iraMonthlyOf(store) }, new Date());
    summary.iraMonthly = iraMonthlyOf(store);
    res.json({ settings, summary, recurring, recommendations: recommend(typed, summary, recurring), transactions, typeRules: rules, categories: TYPES, paySchedule, bills });
  });

  // Learn a type from one transaction (silent; remembers it for that merchant,
  // does NOT add a visible rule).
  app.post('/api/finance/learn-type', guard, (req, res) => {
    const { description, type } = req.body || {};
    store.setLearnedTypes(learnTypeMap(store.getLearnedTypes(), description, type));
    res.json({ ok: true });
  });

  // Replace the whole merchant-rules table.
  app.post('/api/finance/type-rules', guard, (req, res) => {
    store.setTypeRules(sanitizeRules(req.body && req.body.rules));
    res.json({ ok: true, typeRules: store.getTypeRules() });
  });

  // ---- Pay schedule & bills ----
  app.post('/api/finance/pay-schedule', guard, (req, res) => {
    const { frequency, anchorDate, amount } = req.body || {};
    const ok = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
    store.setPaySchedule({
      frequency: ok.includes(frequency) ? frequency : 'biweekly',
      anchorDate: anchorDate || null,
      amount: Math.max(0, Math.round((Number(amount) || 0) * 100) / 100),
    });
    res.json({ ok: true, paySchedule: store.getPaySchedule() });
  });

  app.post('/api/finance/bills', guard, (req, res) => {
    store.setBills(sanitizeBills(req.body && req.body.bills));
    res.json({ ok: true, bills: store.getBills() });
  });

  // Seed bills from detected recurring bill-category charges (due day = most common day-of-month).
  app.post('/api/finance/bills/seed', guard, (req, res) => {
    const txns = store.getTransactions();
    const typed = typeAll(txns, store.getTypeRules(), store.getLearnedTypes());
    const catByKey = {};
    for (const t of typed) catByKey[merchantKey(t.description)] = t.type;
    const recurring = detectRecurring(typed).filter((r) => r.kind === 'expense');
    const bills = [...store.getBills()];
    const have = new Set(bills.map((b) => b.name.toLowerCase()));
    for (const r of recurring) {
      const key = merchantKey(r.description);
      if (!BILL_CATS.has(catByKey[key])) continue;            // only real bills
      if (have.has(r.description.toLowerCase())) continue;
      const days = txns.filter((t) => merchantKey(t.description) === key && t.date).map((t) => Number(t.date.slice(8, 10)));
      const dueDay = days.length ? mode(days) : 1;
      bills.push({ id: Math.random().toString(36).slice(2, 9), name: r.description, amount: Math.abs(r.amount), dueDay });
    }
    store.setBills(sanitizeBills(bills));
    res.json({ ok: true, bills: store.getBills() });
  });

  // ---- SimpleFIN ----
  app.post('/api/finance/simplefin/connect', guard, async (req, res) => {
    try {
      const accessUrl = await claimAccessUrl(req.body.setupToken, sfFetch);
      store.setSimplefin({ accessUrl });
      res.json({ connected: true });
    } catch (e) {
      res.status(400).json({ connected: false, error: String(e.message) });
    }
  });

  app.post('/api/finance/simplefin/sync', guard, async (req, res) => {
    if (!store.getSimplefin().accessUrl) return res.status(400).json({ error: 'Not connected' });
    try { res.json(await runSync()); }
    catch (e) { res.status(502).json({ error: String(e.message) }); }
  });

  app.get('/api/finance/simplefin/status', guard, (req, res) => {
    const sf = store.getSimplefin();
    res.json({ connected: !!sf.accessUrl, lastSync: sf.lastSync });
  });

  // ---- Retirement ----
  app.post('/api/finance/retirement/settings', guard, (req, res) => {
    store.setRetirementSettings(req.body || {});
    res.json(store.getRetirementSettings());
  });

  app.post('/api/finance/retirement/snapshot', guard, (req, res) => {
    const { date, balance, contributed } = req.body || {};
    store.addSnapshot({ date, balance: Number(balance), contributed: Number(contributed) });
    res.json(store.getSnapshots());
  });

  app.get('/api/finance/retirement', guard, (req, res) => {
    const rset = store.getRetirementSettings();
    const snapshots = store.getSnapshots();
    const latest = snapshots[snapshots.length - 1] || { balance: 0, contributed: 0 };
    const budgetSavingsTarget = store.getSettings().savingsTargetMonthly || 0;
    const effectiveContribution = rset.monthlyContribution != null ? rset.monthlyContribution : budgetSavingsTarget;
    const projection = computeProjection(latest.balance, effectiveContribution, rset.currentAge, rset.retirementAge);
    const projectedAtRetirement = projection.length ? projection[projection.length - 1].expected : latest.balance;
    const guidance = generateRetirementGuidance({
      currentAge: rset.currentAge, retirementAge: rset.retirementAge,
      effectiveContribution, goalAmount: rset.goalAmount, projectedAtRetirement,
    });
    res.json({
      settings: rset, snapshots, currentBalance: latest.balance, contributedToDate: latest.contributed,
      effectiveContribution, budgetSavingsTarget, projection, projectedAtRetirement, guidance,
    });
  });

  // Background auto-sync every 6h while the server runs.
  const timer = setInterval(() => {
    runSync().then((r) => { if (r.imported) console.log(`[finance auto-sync] imported ${r.imported}`); })
      .catch((e) => console.error('[finance auto-sync] failed:', e.message));
  }, 6 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();

  return { store, runSync };
}

module.exports = { mountFinance };
