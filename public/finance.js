const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const charts = {};
function setChart(id, config) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), config); }
async function api(path, opts) {
  const r = await fetch('/api/finance' + path, opts);
  if (r.status === 401) { showLogin(); return null; }
  return r.json();
}
function showLogin() { $('loginOverlay').classList.remove('hidden'); }
function hideLogin() { $('loginOverlay').classList.add('hidden'); }

// ---- Tabs ----
document.querySelectorAll('.tab[data-tab]').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab[data-tab]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    ['budget', 'retirement', 'settings'].forEach((t) => $('tab-' + t).classList.toggle('hidden', tab !== t));
    if (tab === 'retirement' || tab === 'settings') refreshRetirement();
  };
});

// ---- Budget ----
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT_COLORS = ['#f59e0b', '#f87171', '#a78bfa', '#34d399', '#60a5fa', '#fbbf24', '#fb7185', '#22d3ee', '#c084fc', '#4ade80', '#f472b6', '#94a3b8'];
const shortName = (s) => String(s).replace(/\*+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 22);
let lastRules = [];
let CATEGORIES = [];

function catOptions(selected) {
  return CATEGORIES.map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

async function refreshBudget() {
  const d = await api('/budget');
  if (!d) return;
  const s = d.summary;
  lastRules = d.typeRules || [];
  CATEGORIES = d.categories || [];
  const rt = $('ruleType');
  if (rt && rt.dataset.filled !== '1') { rt.innerHTML = catOptions('Bills & Utilities'); rt.dataset.filled = '1'; }

  const pp = s.payPeriod;
  const pd = s.payday;
  if (pd) {
    // Hero = current cash − EVERY unpaid bill through the end of the next pay
    // cycle (ignores future paycheck) — never spend past this.
    $('safeToday').textContent = money(pd.safeToSpend);
    $('safeSub').textContent = `${money(pd.currentCash)} cash − ${money(pd.reservedTotal)} in bills due through the end of your next pay cycle (by ${pd.cycleEnd}). Every bill is covered by cash you already have.`;
  } else if (pp) {
    $('safeToday').textContent = money(pp.safeToSpendPerDay);
    $('safeSub').textContent = `${money(pp.safeToSpendRemaining)} to spend over ${pp.daysLeft} day(s) until your next payday (${pp.nextPayday}) — after ${money(pp.billsDue)} bills due + ${money(pp.iraSetAside)} to retirement.`;
  } else {
    $('safeToday').textContent = money(s.safeToSpendPerDay);
    $('safeSub').textContent = `${money(s.safeToSpendRemaining)} left for ${s.daysLeft} day(s) in ${s.month} — add your pay schedule below for payday-accurate budgeting.`;
  }
  renderPayday(pd);
  renderAccounts(s.accountsView, s.netCash);
  // pay schedule + bills config
  if (d.paySchedule) {
    $('payFreq').value = d.paySchedule.frequency || 'biweekly';
    $('payAnchor').value = d.paySchedule.anchorDate || '';
    $('payAmount').value = d.paySchedule.amount || '';
  }
  renderBills(d.bills || []);
  renderCalendar(s.calendar);
  populateBillPick(d.billCandidates || []);
  if (d.emailSettings) {
    $('emailEnabled').checked = !!d.emailSettings.enabled;
    $('emailTo').value = d.emailSettings.recipient || '';
    $('emailHour').value = d.emailSettings.hour == null ? 7 : d.emailSettings.hour;
  }
  if ($('checkingBal')) $('checkingBal').textContent = s.checkingBalance != null ? money(s.checkingBalance) : '— sync your bank —';
  if ($('balOverride') && document.activeElement !== $('balOverride')) $('balOverride').value = s.manualBalance != null ? s.manualBalance : '';
  $('inflows').textContent = money(s.inflows);
  $('outflows').textContent = money(s.outflows);
  if ($('spendDelta')) {
    if (s.spendDelta == null) {
      $('spendDelta').textContent = '';
    } else if (s.spendDelta >= 0) {
      $('spendDelta').textContent = `${money(s.spendDelta)} above last month (${money(s.lastMonthOut)})`;
    } else {
      $('spendDelta').textContent = `${money(-s.spendDelta)} below last month (${money(s.lastMonthOut)})`;
    }
  }
  if ($('otherIncome')) $('otherIncome').textContent = money(s.otherIncome);
  $('savings').value = d.settings.savingsTargetMonthly || '';
  $('recs').innerHTML = d.recommendations.length
    ? d.recommendations.map((x) => `<li class="rec ${x.type}">${x.message}</li>`).join('')
    : '<li>All good — nothing to flag.</li>';
  $('subs').innerHTML = d.recurring.filter((x) => x.kind === 'expense')
    .map((x) => `<li>${esc(x.description)} — ${money(Math.abs(x.amount))}/mo (${x.occurrences}x)</li>`).join('')
    || '<li>None detected yet.</li>';

  // spending by category (exclude Income; only categories with spend)
  const bc = s.byCategory || {};
  const INFLOW = ['Income', 'Other Income'];
  const spendCats = CATEGORIES.filter((c) => !INFLOW.includes(c) && (bc[c] || 0) > 0).sort((a, b) => bc[b] - bc[a]);
  setChart('catChart', {
    type: 'bar',
    data: { labels: spendCats, datasets: [{ data: spendCats.map((c) => bc[c]), backgroundColor: spendCats.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.x) } } } },
  });

  // top merchants
  const tm = s.topMerchants || [];
  setChart('merchantChart', {
    type: 'bar',
    data: { labels: tm.map((m) => shortName(m.name)), datasets: [{ data: tm.map((m) => m.amount), backgroundColor: '#60a5fa' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.x) } } } },
  });

  renderTxns(d.transactions);
  renderRules(lastRules);
}

function billLi(b) {
  return `<li><span>${esc(b.name)}</span><span class="due-date">${esc(b.date)}</span><span class="neg">-${money(b.amount).slice(1)}</span></li>`;
}

function renderPayday(pd) {
  const card = $('paydayCard');
  if (!card) return;
  if (!pd) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('pdCash').textContent = money(pd.currentCash);
  $('pdBills').textContent = '-' + money(pd.reservedTotal).slice(1);
  $('pdSafe').textContent = money(pd.safeToSpend);
  $('pdSub').textContent = `Next payday ${pd.nextPayday} (${pd.daysLeft} day(s) away). Reserving every bill through ${pd.cycleEnd}, paycheck not counted.`;

  const before = (pd.billsBeforeList || []).filter((b) => !b.paid);
  $('pdBeforeHead').classList.toggle('hidden', !before.length);
  $('pdBeforeList').innerHTML = before.map(billLi).join('');

  const after = (pd.billsAfterList || []).filter((b) => !b.paid);
  $('pdAfterHead').classList.toggle('hidden', !after.length);
  $('pdAfterList').innerHTML = after.map(billLi).join('');

  if (!before.length && !after.length) {
    $('pdBeforeHead').classList.remove('hidden');
    $('pdBeforeHead').textContent = 'No bills due this cycle — all clear.';
  } else {
    $('pdBeforeHead').textContent = 'Before next payday';
  }
}

function renderAccounts(accts, netCash) {
  const card = $('accountsCard');
  if (!card) return;
  if (!accts || !accts.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('accountsList').innerHTML = accts.map((a) => {
    const neg = (Number(a.balance) || 0) < 0;
    return `<div class="acct-row"><span>${esc(a.name)}${a.isChecking ? ' 💳' : ''}</span><strong class="${neg ? 'neg' : ''}">${money(a.balance)}</strong></div>`;
  }).join('');
  $('netCash').textContent = netCash != null ? money(netCash) : '$—';
}

function renderTxns(txns) {
  const cutoff = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const recent = txns.filter((t) => (t.date || '') >= cutoff).slice(0, 1000);
  $('txnNote').textContent = `Last 30 days — ${recent.length} transaction(s). Set each one's category; your choice is remembered for that merchant.`;
  $('txnList').innerHTML = recent.map((t) => {
    const amt = (t.amount < 0 ? '-' : '+') + '$' + Math.abs(t.amount).toFixed(2);
    return `<div class="txn-row" data-desc="${esc(t.description)}">
      <span class="txn-date">${esc(t.date)}</span>
      <span class="txn-desc" title="${esc(t.description)}">${esc(t.description)}</span>
      <span class="txn-amt ${t.amount < 0 ? 'neg' : 'pos'}">${amt}</span>
      <select class="txn-type">${catOptions(t.type)}</select>
    </div>`;
  }).join('') || '<p class="sub">No transactions yet — connect your bank and sync.</p>';
  $('txnList').querySelectorAll('.txn-row').forEach((row) => {
    row.querySelector('.txn-type').addEventListener('change', async (e) => {
      await api('/learn-type', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: row.dataset.desc, type: e.target.value }) });
      refreshBudget();
    });
  });
}

function renderRules(rules) {
  $('rulesList').innerHTML = rules.length
    ? rules.map((r, i) => `<div class="rule-row"><span class="txn-desc">contains "<strong>${esc(r.match)}</strong>" → ${esc(r.type)}</span><button class="rule-del" data-i="${i}">✕</button></div>`).join('')
    : '<p class="sub">No rules yet.</p>';
  $('rulesList').querySelectorAll('.rule-del').forEach((b) => {
    b.onclick = () => saveRules(rules.filter((_, i) => i !== Number(b.dataset.i)));
  });
}

async function saveRules(rules) {
  const d = await api('/type-rules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rules }) });
  if (d) refreshBudget();
}

$('ruleAdd').onclick = () => {
  const match = $('ruleMatch').value.trim();
  if (!match) return;
  $('ruleMatch').value = '';
  saveRules([...lastRules, { match: match.toLowerCase(), type: $('ruleType').value }]);
};

$('saveSettings').onclick = async () => {
  await api('/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ savingsTargetMonthly: Number($('savings').value) }) });
  refreshBudget();
};

// ---- Calendar ----
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function renderCalendar(cal) {
  if (!cal) return;
  $('calTitle').textContent = `📅 ${cal.monthLabel}`;
  $('calWeekdays').innerHTML = WEEKDAYS.map((w) => `<div class="cal-wd">${w}</div>`).join('');
  const startWeekday = new Date(Date.UTC(cal.year, cal.monthIdx, 1)).getUTCDay();
  const days = new Date(Date.UTC(cal.year, cal.monthIdx + 1, 0)).getUTCDate();
  const paydays = new Set(cal.paydays || []);
  const bills = cal.bills || {};
  const todayISO = new Date().toISOString().slice(0, 10);
  let cells = '';
  for (let i = 0; i < startWeekday; i++) cells += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${cal.year}-${String(cal.monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const bs = bills[iso] || [];
    cells += `<div class="cal-day${iso === todayISO ? ' today' : ''}" data-date="${iso}">
      <div class="cal-num">${d}${paydays.has(iso) ? ' 💵' : ''}</div>
      ${bs.map((b) => `<div class="cal-bill ${b.paid ? 'paid' : ''}" title="${esc(b.name)} ${money(b.amount)}${b.paid ? ' — paid' : ' — due'}">${b.paid ? '✅' : '🧾'} ${esc(b.name.slice(0, 12))}</div>`).join('')}
    </div>`;
  }
  $('calendar').innerHTML = cells;
  $('calendar').onclick = (e) => {
    const cell = e.target.closest('.cal-day');
    if (cell && cell.dataset.date) openBillModal(cell.dataset.date);
  };
}

// ---- Pay schedule & bills ----
let lastBills = [];
let lastCandidates = [];
let modalDateISO = null;
function populateBillPick(candidates) {
  lastCandidates = candidates;
  $('billPick').innerHTML = '<option value="">— add a bill —</option>' +
    candidates.map((r) => `<option value="${esc(r.name)}" data-amt="${r.amount}">${esc(r.name)} — ${money(r.amount)} (${esc(r.category)})</option>`).join('');
}
function billSchedLabel(b) {
  return b.recurrence === 'biweekly'
    ? `<span class="bill-edit" style="font-size:.78rem;color:#94a3b8">every 2 wks from ${b.anchorDate || '?'}</span>`
    : `<span class="bill-edit">due <input class="bill-due" type="number" min="1" max="31" value="${b.dueDay || 1}" /></span>`;
}
function renderBills(bills) {
  lastBills = bills;
  $('billsList').innerHTML = bills.length
    ? bills.map((b, i) => `<div class="bill-row" data-i="${i}">
        <span class="bill-name" title="${esc(b.name)}">${esc(b.name)}</span>
        <span class="bill-edit">$<input class="bill-amt" type="number" value="${b.amount}" /></span>
        ${billSchedLabel(b)}
        <button class="rule-del bill-del">✕</button>
      </div>`).join('')
    : '<p class="sub">No bills yet — seed from recurring charges, add one below, or click a calendar date.</p>';
  $('billsList').querySelectorAll('.bill-row').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('.bill-del').onclick = () => saveBills(lastBills.filter((_, j) => j !== i));
    const due = row.querySelector('.bill-due');
    const commit = () => {
      const patch = { amount: Number(row.querySelector('.bill-amt').value) };
      if (due) patch.dueDay = Number(due.value);
      saveBills(lastBills.map((b, j) => (j === i ? { ...b, ...patch } : b)));
    };
    row.querySelector('.bill-amt').onchange = commit;
    if (due) due.onchange = commit;
  });
}

// ---- Calendar: click a date to set a bill due ----
function openBillModal(dateISO) {
  modalDateISO = dateISO;
  $('modalDate').textContent = dateISO;
  $('modalMsg').textContent = '';
  const have = new Set(lastBills.map((b) => b.name.toLowerCase()));
  const opts = lastBills.map((b) => `<option value="${esc(b.name)}" data-amt="${b.amount}">${esc(b.name)} — ${money(b.amount)} (current)</option>`)
    .concat(lastCandidates.filter((c) => !have.has(c.name.toLowerCase()))
      .map((c) => `<option value="${esc(c.name)}" data-amt="${c.amount}">${esc(c.name)} — ${money(c.amount)} (${esc(c.category)})</option>`));
  $('modalBill').innerHTML = opts.join('') || '<option value="">(no bills detected yet)</option>';
  $('billModal').classList.remove('hidden');
}
$('modalCancel').onclick = () => $('billModal').classList.add('hidden');
$('modalSave').onclick = () => {
  const sel = $('modalBill');
  const name = sel.value;
  if (!name || !modalDateISO) { $('billModal').classList.add('hidden'); return; }
  const amount = Number(sel.options[sel.selectedIndex].dataset.amt) || 0;
  const fields = $('modalRec').value === 'biweekly'
    ? { recurrence: 'biweekly', anchorDate: modalDateISO }
    : { recurrence: 'monthly', dueDay: Number(modalDateISO.slice(8, 10)) };
  const idx = lastBills.findIndex((b) => b.name.toLowerCase() === name.toLowerCase());
  const next = idx >= 0 ? lastBills.map((b, i) => (i === idx ? { ...b, ...fields } : b)) : [...lastBills, { name, amount, ...fields }];
  $('billModal').classList.add('hidden');
  saveBills(next);
};
async function saveBills(bills) {
  const d = await api('/bills', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bills }) });
  if (d) refreshBudget();
}
$('billAdd').onclick = () => {
  const sel = $('billPick');
  const name = sel.value;
  if (!name) return;
  const amount = Number(sel.options[sel.selectedIndex].dataset.amt) || 0;
  const dueDay = Number($('billDue').value) || 1;
  sel.value = ''; $('billDue').value = '';
  saveBills([...lastBills, { name, amount, dueDay }]);
};
$('billsSeed').onclick = async () => {
  $('billsSeed').textContent = 'Seeding…';
  await api('/bills/seed', { method: 'POST' });
  $('billsSeed').textContent = 'Seed from recurring charges';
  refreshBudget();
};
// ---- Daily summary email ----
$('emailSave').onclick = async () => {
  await api('/email/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: $('emailEnabled').checked, recipient: $('emailTo').value, hour: Number($('emailHour').value) }) });
  $('emailMsg').textContent = 'Saved.';
  refreshBudget();
};
$('emailTest').onclick = async () => {
  $('emailMsg').textContent = 'Sending test…';
  const r = await fetch('/api/finance/email/test', { method: 'POST' });
  if (r.status === 401) { showLogin(); return; }
  const d = await r.json();
  $('emailMsg').textContent = r.ok ? `Test sent to ${d.sentTo} ✓ — check your inbox.` : `Failed: ${d.error}`;
};

$('savePay').onclick = async () => {
  $('payMsg').textContent = 'Saved.';
  await api('/pay-schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frequency: $('payFreq').value, anchorDate: $('payAnchor').value, amount: Number($('payAmount').value) }) });
  refreshBudget();
};

// ---- SimpleFIN ----
async function refreshSfStatus() {
  const s = await api('/simplefin/status');
  if (!s) return;
  $('sfStatus').textContent = s.connected
    ? `Connected ✓ — last sync: ${s.lastSync ? new Date(s.lastSync * 1000).toLocaleString() : 'never'}`
    : 'Not connected. Paste a SimpleFIN setup token to enable automatic sync.';
  $('sfSync').disabled = !s.connected;
  $('sfConnectArea').classList.toggle('hidden', s.connected);   // hide token box once connected
  $('sfReconnect').classList.toggle('hidden', !s.connected);
  const accts = s.accounts || [];
  if (accts.length > 1) {
    $('acctPickWrap').classList.remove('hidden');
    $('acctPick').innerHTML = accts.map((a) => `<option value="${esc(a.id)}" ${a.id === s.checkingAccountId ? 'selected' : ''}>${esc(a.name)} — ${money(a.balance)}${a.available != null ? ` (avail ${money(a.available)})` : ''}</option>`).join('');
  } else {
    $('acctPickWrap').classList.add('hidden');
  }
  $('pendingWrap').classList.toggle('hidden', !s.connected);
}
$('balOverride').onchange = async () => {
  await api('/simplefin/balance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: $('balOverride').value }) });
  refreshBudget();
};
$('acctPick').onchange = async () => {
  await api('/simplefin/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: $('acctPick').value }) });
  refreshBudget();
};
$('sfReconnect').onclick = (e) => { e.preventDefault(); $('sfConnectArea').classList.remove('hidden'); };
$('sfConnect').onclick = async () => {
  const setupToken = $('sfToken').value.trim();
  if (!setupToken) { $('sfMsg').textContent = 'Paste a token first.'; return; }
  $('sfMsg').textContent = 'Connecting…';
  const d = await api('/simplefin/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ setupToken }) });
  $('sfMsg').textContent = d.connected ? 'Connected!' : `Failed: ${d.error || 'unknown'}`;
  $('sfToken').value = '';
  refreshSfStatus();
};
$('sfSync').onclick = async () => {
  $('sfMsg').textContent = 'Syncing…';
  const r = await fetch('/api/finance/simplefin/sync', { method: 'POST' });
  if (r.status === 401) { showLogin(); return; }
  const d = await r.json();
  $('sfMsg').textContent = r.ok ? `Synced — imported ${d.imported} new transactions.` : `Sync failed: ${d.error}`;
  refreshSfStatus();
  refreshBudget();
};

// ---- Retirement ----
async function refreshRetirement() {
  const d = await api('/retirement');
  if (!d) return;
  $('projBig').textContent = money(d.projectedAtRetirement);
  $('projSub').textContent = d.settings.retirementAge
    ? `by age ${d.settings.retirementAge}, contributing ${money(d.effectiveContribution)}/mo`
    : 'Enter your ages and a balance to see a projection.';
  $('curAge').value = d.settings.currentAge || '';
  $('retAge').value = d.settings.retirementAge || '';
  $('monthlyContrib').value = d.settings.monthlyContribution ?? '';
  $('goalAmount').value = d.settings.goalAmount ?? '';
  $('contribNote').textContent = d.settings.monthlyContribution == null ? `Using your budget savings target: ${money(d.budgetSavingsTarget)}/mo.` : '';
  $('curBalance').textContent = money(d.currentBalance);
  $('curContributed').textContent = money(d.contributedToDate);
  $('curGrowth').textContent = money(d.currentBalance - d.contributedToDate);
  $('retGuidance').innerHTML = d.guidance.length
    ? d.guidance.map((g) => `<li class="rec ${g.type}">${g.message}</li>`).join('')
    : '<li>Enter your details to get guidance.</li>';
  setChart('historyChart', { type: 'line', data: { labels: d.snapshots.map((s) => s.date), datasets: [{ label: 'Balance', data: d.snapshots.map((s) => s.balance) }, { label: 'Contributed', data: d.snapshots.map((s) => s.contributed) }] } });
  setChart('projChart', {
    type: 'line',
    data: { labels: d.projection.map((p) => `Age ${p.age}`), datasets: [
      { label: 'High (10%)', data: d.projection.map((p) => p.high), borderColor: '#34d399', fill: false },
      { label: 'Expected (7%)', data: d.projection.map((p) => p.expected), borderColor: '#60a5fa', fill: false },
      { label: 'Low (4%)', data: d.projection.map((p) => p.low), borderColor: '#f59e0b', fill: false },
    ] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } } },
  });
}
$('saveRetSettings').onclick = async () => {
  const mc = $('monthlyContrib').value, goal = $('goalAmount').value;
  await api('/retirement/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentAge: Number($('curAge').value), retirementAge: Number($('retAge').value), monthlyContribution: mc === '' ? null : Number(mc), goalAmount: goal === '' ? null : Number(goal) }) });
  refreshRetirement();
};
$('addSnap').onclick = async () => {
  if (!$('snapDate').value) { $('snapMsg').textContent = 'Pick a date.'; return; }
  await api('/retirement/snapshot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: $('snapDate').value, balance: Number($('snapBalance').value), contributed: Number($('snapContributed').value) }) });
  $('snapMsg').textContent = 'Saved.';
  refreshRetirement();
};

// ---- Login ----
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginMsg').textContent = 'Signing in…';
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPass').value }),
  });
  if (r.ok) { $('loginMsg').textContent = ''; hideLogin(); init(); }
  else { $('loginMsg').textContent = 'Invalid email or password.'; }
});

async function init() {
  const probe = await api('/simplefin/status'); // 401 -> showLogin (overlay stays up)
  if (!probe) return;
  hideLogin();
  await refreshSfStatus();
  await refreshBudget();
  refreshRetirement();
}
init();
