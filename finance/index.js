'use strict';
// Mounts the finance section onto an existing Express app.
// Surgical + additive: only registers /api/finance/* routes, all behind requireAdmin.
const { createStore } = require('./store');
const { claimAccessUrl, fetchSimplefinAccounts, simplefinToTransactions, accountsBalance } = require('./simplefin');
const {
  parseCsv, normalizeTransactions, typeAll, learnTypeMap, sanitizeRules, detectRecurring,
  computeBudget, recommend, computeProjection, generateRetirementGuidance, TYPES, merchantKey,
} = require('./core');
const { computeCashflow, paydaysBetween, billsForMonth } = require('./cashflow');
const { buildEmail, sendViaResend, localDateHour } = require('./email');

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
  return bills.map((b) => {
    const recurrence = b.recurrence === 'biweekly' ? 'biweekly' : 'monthly';
    const out = {
      id: String(b.id || Math.random().toString(36).slice(2, 9)),
      name: String(b.name || '').slice(0, 60).trim() || 'Bill',
      amount: Math.max(0, Math.round((Number(b.amount) || 0) * 100) / 100),
      recurrence,
    };
    if (recurrence === 'biweekly' && b.anchorDate) out.anchorDate = String(b.anchorDate).slice(0, 10);
    else out.dueDay = Math.min(31, Math.max(1, Math.round(Number(b.dueDay) || 1)));
    return out;
  }).filter((b) => b.amount > 0 && (b.dueDay || b.anchorDate));
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
    const bal = accountsBalance(accountSet);
    store.setSimplefin({ lastSync: Math.floor(Date.now() / 1000), balance: bal.balance, balanceDate: bal.date, accounts: bal.accounts });
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
    const catByKey = {};
    for (const t of typed) catByKey[merchantKey(t.description)] = t.type;
    const recurring = detectRecurring(typed).map((r) => ({ ...r, category: catByKey[merchantKey(r.description)] || 'Other' }));
    // every merchant with a bill-category charge (latest amount) — for the bill picker
    const candMap = {};
    for (const t of typed) {
      if (t.amount >= 0 || !BILL_CATS.has(t.type)) continue;
      const k = merchantKey(t.description);
      if (!candMap[k] || (t.date || '') > (candMap[k].date || '')) {
        candMap[k] = { name: t.description, amount: Math.round(-t.amount * 100) / 100, category: t.type, date: t.date || '' };
      }
    }
    const billCandidates = Object.values(candMap).map(({ date, ...x }) => x).sort((a, b) => b.amount - a.amount);
    // newest first for the editable list
    const transactions = [...typed].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const paySchedule = store.getPaySchedule();
    const bills = store.getBills();
    summary.payPeriod = computeCashflow(typed, { paySchedule, bills, iraMonthly: iraMonthlyOf(store) }, new Date());
    summary.iraMonthly = iraMonthlyOf(store);
    const sf = store.getSimplefin();
    const accts = sf.accounts || [];
    const acct = accts.length
      ? (sf.checkingAccountId ? accts.find((a) => a.id === sf.checkingAccountId) : (accts.length === 1 ? accts[0] : null))
      : null;
    summary.checkingBalance = acct ? (acct.available != null ? acct.available : acct.balance) : null;
    summary.checkingPosted = acct ? acct.balance : null;
    summary.accounts = accts;
    summary.checkingAccountId = sf.checkingAccountId;
    summary.balanceDate = sf.balanceDate;
    // calendar data for the current month
    const now = new Date();
    const y = now.getFullYear(), mi = now.getMonth();
    const first = new Date(Date.UTC(y, mi, 1)), lastD = new Date(Date.UTC(y, mi + 1, 0));
    summary.calendar = {
      year: y, monthIdx: mi,
      monthLabel: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      paydays: paySchedule.anchorDate ? paydaysBetween(paySchedule, first, lastD) : [],
      bills: billsForMonth(bills, y, mi),
    };
    res.json({ settings, summary, recurring, recommendations: recommend(typed, summary, recurring), transactions, typeRules: rules, categories: TYPES, paySchedule, bills, billCandidates, emailSettings: store.getEmailSettings() });
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
    const typed = typeAll(store.getTransactions(), store.getTypeRules(), store.getLearnedTypes());
    const groups = {};
    for (const t of typed) {
      if (t.amount >= 0 || !BILL_CATS.has(t.type)) continue;
      const k = merchantKey(t.description);
      (groups[k] = groups[k] || []).push(t);
    }
    const bills = [...store.getBills()];
    const have = new Set(bills.map((b) => b.name.toLowerCase()));
    for (const items of Object.values(groups)) {
      if (items.length < 2) continue;                          // recurring-ish only
      const latest = items.reduce((a, b) => ((a.date || '') > (b.date || '') ? a : b));
      if (have.has(latest.description.toLowerCase())) continue;
      const days = items.filter((t) => t.date).map((t) => Number(t.date.slice(8, 10)));
      bills.push({ id: Math.random().toString(36).slice(2, 9), name: latest.description, amount: Math.abs(latest.amount), dueDay: days.length ? mode(days) : 1 });
    }
    store.setBills(sanitizeBills(bills));
    res.json({ ok: true, bills: store.getBills() });
  });

  // TEMP: balance diagnostic (remove after diagnosing; reveals structure, not amounts).
  app.get('/api/finance/_baldiag', async (req, res) => {
    const { accessUrl } = store.getSimplefin();
    if (!accessUrl) return res.json({ error: 'not connected' });
    try {
      const accountSet = await fetchSimplefinAccounts(accessUrl, { startDate: Math.floor(Date.now() / 1000) - 30 * 24 * 3600, fetchImpl: sfFetch });
      const out = (accountSet.accounts || []).map((a) => {
        const txns = a.transactions || [];
        const pend = txns.filter((t) => t.pending);
        return {
          name: String(a.name || '').slice(0, 24), balance: a.balance, availBalance: a['available-balance'] ?? null,
          txnCount: txns.length, pendingCount: pend.length,
          pendingSum: Math.round(pend.reduce((s, t) => s + Number(t.amount || 0), 0) * 100) / 100,
          sampleTxnKeys: txns[0] ? Object.keys(txns[0]) : [],
        };
      });
      res.json({ accounts: out });
    } catch (e) { res.json({ error: String(e.message) }); }
  });

  // ---- Daily summary email ----
  app.post('/api/finance/email/settings', guard, (req, res) => {
    const { enabled, recipient, hour } = req.body || {};
    store.setEmailSettings({
      enabled: !!enabled,
      recipient: String(recipient || '').trim() || store.getEmailSettings().recipient,
      hour: Math.min(23, Math.max(0, Math.round(Number(hour)) || 7)),
    });
    res.json({ ok: true, emailSettings: store.getEmailSettings() });
  });

  app.post('/api/finance/email/test', guard, async (req, res) => {
    const es = store.getEmailSettings();
    try {
      const { subject, html } = buildEmail(store, new Date());
      await sendViaResend(es.recipient, subject, html);
      res.json({ ok: true, sentTo: es.recipient });
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e.message) });
    }
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
    res.json({ connected: !!sf.accessUrl, lastSync: sf.lastSync, accounts: sf.accounts || [], checkingAccountId: sf.checkingAccountId });
  });

  app.post('/api/finance/simplefin/account', guard, (req, res) => {
    store.setSimplefin({ checkingAccountId: (req.body && req.body.id) || null });
    res.json({ ok: true });
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

  // Daily summary email: check periodically; send once/day at/after the chosen hour.
  async function maybeSendDaily() {
    const es = store.getEmailSettings();
    if (!es.enabled || !es.recipient) return;
    const { date, hour } = localDateHour(es.timezone || 'America/Chicago');
    if (hour < (es.hour == null ? 7 : es.hour) || es.lastSentDate === date) return;
    try {
      const { subject, html } = buildEmail(store, new Date());
      await sendViaResend(es.recipient, subject, html);
      store.setEmailSettings({ lastSentDate: date });
      console.log(`[finance] daily summary emailed to ${es.recipient}`);
    } catch (e) { console.error('[finance] daily email failed:', e.message); }
  }
  const emailTimer = setInterval(maybeSendDaily, 20 * 60 * 1000);
  if (emailTimer.unref) emailTimer.unref();
  const bootCheck = setTimeout(maybeSendDaily, 30000);
  if (bootCheck.unref) bootCheck.unref();

  return { store, runSync };
}

module.exports = { mountFinance };
