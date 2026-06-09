'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const express = require('express');
const { mountFinance } = require('./index');
const core = require('./core');

// stub requireAdmin: allow only when header x-test-admin=1
function fakeAuth(req, res, next) {
  if (req.headers['x-test-admin'] === '1') return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function buildApp(storeDir, simplefinFetch) {
  const app = express();
  app.use(express.json());
  mountFinance(app, { requireAdmin: fakeAuth, storePath: join(storeDir, 'store.json'), simplefinFetch });
  return app;
}

const ADMIN = { 'content-type': 'application/json', 'x-test-admin': '1' };

test('budget auto-detects income from deposits', () => {
  const typed = core.typeAll([
    { date: '2026-05-01', description: 'PAYROLL', amount: 5000 },
    { date: '2026-06-01', description: 'PAYROLL', amount: 5000 },
    { date: '2026-06-03', description: 'STORE', amount: -1700 },
  ]);
  const b = core.computeBudget(typed, { savingsTargetMonthly: 600 }, new Date('2026-06-10T12:00:00Z'));
  assert.equal(b.monthlyIncome, 5000);      // detected, not entered
  assert.equal(b.outflows, 1700);
  assert.equal(b.byType.spending, 1700);
  assert.equal(b.safeToSpendRemaining, 2700);
  const p = core.computeProjection(0, 100, 43, 44, { low: 0, expected: 0, high: 0 });
  assert.equal(p[1].expected, 1200);
});

test('type classification + learned merchant rules', () => {
  const txns = [
    { description: 'PAYROLL DEPOSIT', amount: 2500 },
    { description: 'CHASE CARD PMT 1234', amount: -300 },
    { description: 'NETFLIX.COM', amount: -15.49 },
    { description: 'CORNER STORE', amount: -8 },
  ];
  let typed = core.typeAll(txns, [], {});
  assert.equal(typed[0].type, 'income');
  assert.equal(typed[1].type, 'debt');
  assert.equal(typed[2].type, 'bill');
  assert.equal(typed[3].type, 'spending');
  // teach it that CORNER STORE is a bill -> silent learned map (not a visible rule)
  const learned = core.learnTypeMap({}, 'CORNER STORE', 'bill');
  typed = core.typeAll(txns, [], learned);
  assert.equal(typed[3].type, 'bill');
});

test('tagging updates the transaction silently (no visible rule)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fin-'));
  const app = buildApp(dir);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/finance/import`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ csv: 'Date,Description,Amount\n2026-06-01,CORNER STORE,-8\n' }) });
    await fetch(`${base}/api/finance/learn-type`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ description: 'CORNER STORE', type: 'bill' }) });
    const d = await (await fetch(`${base}/api/finance/budget`, { headers: { 'x-test-admin': '1' } })).json();
    assert.equal(d.transactions[0].type, 'bill');   // transaction updated
    assert.equal(d.typeRules.length, 0);            // but NO visible rule added
    // an explicit rule, added via the form, DOES show
    await fetch(`${base}/api/finance/type-rules`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ rules: [{ match: 'netflix', type: 'bill' }] }) });
    const d2 = await (await fetch(`${base}/api/finance/budget`, { headers: { 'x-test-admin': '1' } })).json();
    assert.equal(d2.typeRules.length, 1);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('finance routes require admin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fin-'));
  const app = buildApp(dir);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(`${base}/api/finance/budget`);
    assert.equal(r.status, 401);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('budget + simplefin + retirement flow (admin)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fin-'));
  const fakeFetch = async (url, opts) => {
    if (url === 'https://example.org/claim/xyz') return { ok: true, text: async () => 'https://u:p@bridge/simplefin' };
    if (url.includes('/accounts')) return { ok: true, json: async () => ({ accounts: [{ id: 'a', transactions: [{ id: 't', posted: 1717200000, amount: '-15.49', description: 'NETFLIX.COM' }] }] }) };
    throw new Error('unexpected ' + url);
  };
  const app = buildApp(dir, fakeFetch);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/finance/settings`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ expectedMonthlyIncome: 5000, savingsTargetMonthly: 600 }) });
    const imp = await (await fetch(`${base}/api/finance/import`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ csv: 'Date,Description,Amount\n2026-06-01,Paycheck,5000\n2026-06-03,Rent,-1500\n' }) })).json();
    assert.equal(imp.imported, 2);

    const token = Buffer.from('https://example.org/claim/xyz').toString('base64');
    const c = await (await fetch(`${base}/api/finance/simplefin/connect`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ setupToken: token }) })).json();
    assert.equal(c.connected, true);
    const s = await (await fetch(`${base}/api/finance/simplefin/sync`, { method: 'POST', headers: { 'x-test-admin': '1' } })).json();
    assert.equal(s.imported, 1);

    await fetch(`${base}/api/finance/retirement/settings`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ currentAge: 43, retirementAge: 53, monthlyContribution: null, goalAmount: 500000 }) });
    await fetch(`${base}/api/finance/retirement/snapshot`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ date: '2026-06-01', balance: 10000, contributed: 9000 }) });
    const ret = await (await fetch(`${base}/api/finance/retirement`, { headers: { 'x-test-admin': '1' } })).json();
    assert.equal(ret.currentBalance, 10000);
    assert.equal(ret.effectiveContribution, 600);
    assert.equal(ret.projection.length, 11);
    assert.ok(ret.guidance.some((g) => g.type === 'reassurance'));
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
