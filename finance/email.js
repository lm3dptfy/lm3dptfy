'use strict';
// Builds + sends the daily finance summary email (reuses the site's Resend setup).
const { typeAll, computeBudget, computeProjection, TYPES } = require('./core');
const { computeCashflow } = require('./cashflow');

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY = 86400000;
function iso(d) { return d.toISOString().slice(0, 10); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

function iraMonthlyOf(store) {
  const r = store.getRetirementSettings();
  return r.monthlyContribution != null ? r.monthlyContribution : (store.getSettings().savingsTargetMonthly || 0);
}

// Bills due within the next `days` days (inclusive), with their next due date.
function upcomingBills(bills, now, days) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = new Date(today.getTime() + days * DAY);
  const out = [];
  for (const b of bills) {
    for (let mOff = 0; mOff <= 1; mOff++) {
      const y = today.getUTCFullYear(), m = today.getUTCMonth() + mOff;
      const dd = Math.min(b.dueDay, daysInMonth(y, m));
      const due = new Date(Date.UTC(y, m, dd));
      if (due >= today && due <= horizon) { out.push({ name: b.name, amount: b.amount, date: iso(due) }); break; }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function buildEmail(store, now = new Date()) {
  const typed = typeAll(store.getTransactions(), store.getTypeRules(), store.getLearnedTypes());
  const settings = store.getSettings();
  const summary = computeBudget(typed, settings, now);
  const bills = store.getBills();
  const pp = computeCashflow(typed, { paySchedule: store.getPaySchedule(), bills, iraMonthly: iraMonthlyOf(store) }, now);

  // retirement
  const rset = store.getRetirementSettings();
  const snaps = store.getSnapshots();
  const latest = snaps[snaps.length - 1] || { balance: 0, contributed: 0 };
  const effContrib = rset.monthlyContribution != null ? rset.monthlyContribution : (settings.savingsTargetMonthly || 0);
  const projection = computeProjection(latest.balance, effContrib, rset.currentAge, rset.retirementAge);
  const projected = projection.length ? projection[projection.length - 1].expected : latest.balance;

  const sf = store.getSimplefin();
  const accts = sf.accounts || [];
  const acct = accts.length ? (sf.checkingAccountId ? accts.find((a) => a.id === sf.checkingAccountId) : (accts.length === 1 ? accts[0] : null)) : null;
  const checking = acct ? (acct.available != null ? acct.available : acct.balance) : null;
  const checkingIsAvail = acct ? acct.available != null : false;

  const upcoming = upcomingBills(bills, now, 7);

  // biggest discretionary purchase in the last 2 days
  const cutoff = iso(new Date(now.getTime() - 2 * DAY));
  const recentSpends = typed.filter((t) => t.amount < 0 && (t.date || '') >= cutoff
    && !['Bills & Utilities', 'Housing', 'Debt', 'Subscriptions', 'Income', 'Other Income'].includes(t.type))
    .sort((a, b) => a.amount - b.amount);
  const biggest = recentSpends[0];

  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
  const safe = pp || { safeToSpendPerDay: summary.safeToSpendPerDay, safeToSpendRemaining: summary.safeToSpendRemaining, daysLeft: summary.daysLeft, nextPayday: null };

  const row = (label, val, color) => `<tr><td style="padding:4px 0;color:#475569">${label}</td><td style="padding:4px 0;text-align:right;font-weight:600;color:${color || '#0f172a'}">${val}</td></tr>`;
  const over = safe.safeToSpendRemaining < 0;

  let html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <p style="color:#64748b;margin:0 0 4px">Good morning — your money snapshot for ${dateStr}</p>
    <div style="background:${over ? '#fef2f2' : '#ecfdf5'};border:1px solid ${over ? '#fecaca' : '#a7f3d0'};border-radius:12px;padding:16px;text-align:center;margin:8px 0 16px">
      <div style="color:#64748b;font-size:13px">Safe to spend today</div>
      <div style="font-size:40px;font-weight:800;color:${over ? '#dc2626' : '#059669'}">${money(safe.safeToSpendPerDay)}</div>
      <div style="color:#64748b;font-size:13px">${money(safe.safeToSpendRemaining)} left over ${safe.daysLeft} day(s)${safe.nextPayday ? ` until payday ${safe.nextPayday}` : ' this month'}</div>
    </div>`;

  if (checking != null) {
    html += `<p style="font-size:15px;margin:0 0 8px">💳 <b>Checking balance:</b> ${money(checking)}${checkingIsAvail ? ' (available)' : ''}</p>`;
  }

  if (pp) {
    html += `<h3 style="margin:16px 0 6px">This pay period</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row('Income', money(pp.income))}
      ${row('Bills due', '-' + money(pp.billsDue))}
      ${row('Retirement set aside', '-' + money(pp.iraSetAside))}
      ${row('Spent so far', '-' + money(pp.discretionarySpent))}
      ${row('Remaining', money(pp.safeToSpendRemaining), over ? '#dc2626' : '#059669')}
    </table>`;
  }

  if (upcoming.length) {
    html += `<h3 style="margin:16px 0 6px">Bills due in the next 7 days</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${upcoming.map((b) => `<tr><td style="padding:3px 0">${escapeHtml(b.name)}</td><td style="padding:3px 0;color:#64748b">${b.date}</td><td style="padding:3px 0;text-align:right;font-weight:600">${money(b.amount)}</td></tr>`).join('')}
    </table>`;
  }

  const spendCats = TYPES.filter((c) => !['Income', 'Other Income'].includes(c) && (summary.byCategory[c] || 0) > 0)
    .sort((a, b) => summary.byCategory[b] - summary.byCategory[a]).slice(0, 5);
  if (spendCats.length) {
    html += `<h3 style="margin:16px 0 6px">This month by category</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${spendCats.map((c) => row(c, money(summary.byCategory[c]))).join('')}
    </table>`;
  }

  const watch = [];
  if (over) watch.push(`You're <b>${money(-safe.safeToSpendRemaining)} over</b> for this period — ease off discretionary spending.`);
  if (biggest) watch.push(`Biggest recent purchase: <b>${escapeHtml(biggest.description)}</b> ${money(-biggest.amount)} (${biggest.type}).`);
  if (watch.length) {
    html += `<h3 style="margin:16px 0 6px">Worth a glance</h3><ul style="font-size:14px;color:#334155;padding-left:18px;margin:0">${watch.map((w) => `<li style="margin:3px 0">${w}</li>`).join('')}</ul>`;
  }

  if (rset.retirementAge) {
    html += `<h3 style="margin:16px 0 6px">Retirement</h3>
    <p style="font-size:14px;margin:0">Retirement balance ${money(latest.balance)} · on pace for <b>~${money(projected)}</b> by age ${rset.retirementAge}. Stay the course.</p>`;
  }

  html += `<p style="margin:20px 0 0"><a href="https://www.lm3dptfy.online/finances.html" style="color:#2563eb">Open your dashboard →</a></p>
    <p style="color:#94a3b8;font-size:12px;margin-top:16px">Automated daily summary. Not financial advice.</p>
  </div>`;

  return { subject: `Your money — ${dateStr}`, html };
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function sendViaResend(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('Email is not configured on the server (RESEND_API_KEY missing).');
  const from = process.env.EMAIL_FROM || 'LM3DPTFY <no-reply@lm3dptfy.online>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error('Resend error ' + res.status + ': ' + (await res.text()));
}

// Local date + hour in a timezone (for the daily scheduler).
function localDateHour(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24 };
}

module.exports = { buildEmail, sendViaResend, localDateHour };
