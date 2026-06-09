'use strict';
// Mounts the finance section onto an existing Express app.
// Surgical + additive: only registers /api/finance/* routes, all behind requireAdmin.
const { createStore } = require('./store');
const { claimAccessUrl, fetchSimplefinAccounts, simplefinToTransactions } = require('./simplefin');
const {
  parseCsv, normalizeTransactions, typeAll, learnRule, sanitizeRules, detectRecurring,
  computeBudget, recommend, computeProjection, generateRetirementGuidance,
} = require('./core');

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
    const typed = typeAll(store.getTransactions(), rules);
    const settings = store.getSettings();
    const summary = computeBudget(typed, settings, new Date());
    const recurring = detectRecurring(typed);
    // newest first for the editable list
    const transactions = [...typed].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    res.json({ settings, summary, recurring, recommendations: recommend(typed, summary, recurring), transactions, typeRules: rules });
  });

  // Learn a type from one transaction (remembers it for that merchant).
  app.post('/api/finance/learn-type', guard, (req, res) => {
    const { description, type } = req.body || {};
    store.setTypeRules(learnRule(store.getTypeRules(), description, type));
    res.json({ ok: true, typeRules: store.getTypeRules() });
  });

  // Replace the whole merchant-rules table.
  app.post('/api/finance/type-rules', guard, (req, res) => {
    store.setTypeRules(sanitizeRules(req.body && req.body.rules));
    res.json({ ok: true, typeRules: store.getTypeRules() });
  });

  // TEMP: disk persistence check (no auth; writes only a harmless counter; remove after verifying). [redeploy probe]
  app.get('/api/finance/_diskcheck', (req, res) => {
    const fs = require('node:fs');
    const p = require('node:path');
    const dir = p.dirname(storePath);
    const f = p.join(dir, '_diskcheck.json');
    let d = { count: 0, firstWrite: new Date().toISOString() };
    try { if (fs.existsSync(f)) d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    d.count = (d.count || 0) + 1;
    d.lastWrite = new Date().toISOString();
    let writeOk = true, err = null;
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(d)); } catch (e) { writeOk = false; err = String(e.message); }
    res.json({ storePath, dir, dirExists: fs.existsSync(dir), writeOk, err, count: d.count, firstWrite: d.firstWrite, lastWrite: d.lastWrite, storeFileExists: fs.existsSync(storePath) });
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
