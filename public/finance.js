const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const charts = {};
function setChart(id, config) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), config); }
async function api(path, opts) { return (await fetch('/api/finance' + path, opts)).json(); }

// ---- Tabs ----
document.querySelectorAll('.tab[data-tab]').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab[data-tab]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    $('tab-budget').classList.toggle('hidden', tab !== 'budget');
    $('tab-retirement').classList.toggle('hidden', tab !== 'retirement');
    if (tab === 'retirement') refreshRetirement();
  };
});

// ---- Budget ----
async function refreshBudget() {
  const d = await api('/budget');
  const s = d.summary;
  $('safeToday').textContent = money(s.safeToSpendPerDay);
  $('safeSub').textContent = `${money(s.safeToSpendRemaining)} left for ${s.daysLeft} day(s) in ${s.month}`;
  $('inflows').textContent = money(s.inflows);
  $('outflows').textContent = money(s.outflows);
  $('income').value = d.settings.expectedMonthlyIncome || '';
  $('savings').value = d.settings.savingsTargetMonthly || '';
  $('recs').innerHTML = d.recommendations.length
    ? d.recommendations.map((x) => `<li class="rec ${x.type}">${x.message}</li>`).join('')
    : '<li>All good — nothing to flag.</li>';
  $('subs').innerHTML = d.recurring.filter((x) => x.kind === 'expense')
    .map((x) => `<li>${x.description} — ${money(Math.abs(x.amount))}/mo (${x.occurrences}x)</li>`).join('')
    || '<li>None detected yet.</li>';
  const totals = {};
  for (const t of d.transactions) if (t.amount < 0) totals[t.category] = (totals[t.category] || 0) - t.amount;
  const labels = Object.keys(totals);
  setChart('catChart', { type: 'bar', data: { labels, datasets: [{ label: 'Spent', data: labels.map((l) => totals[l].toFixed(2)) }] }, options: { plugins: { legend: { display: false } } } });
}

$('saveSettings').onclick = async () => {
  await api('/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedMonthlyIncome: Number($('income').value), savingsTargetMonthly: Number($('savings').value) }) });
  refreshBudget();
};

$('importBtn').onclick = async () => {
  let text = $('csvText').value;
  const file = $('csvFile').files[0];
  if (file) text = await file.text();
  if (!text) { $('importMsg').textContent = 'Provide a CSV first.'; return; }
  const d = await api('/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: text }) });
  $('importMsg').textContent = `Imported ${d.imported} transactions.`;
  $('csvText').value = '';
  refreshBudget();
};

// ---- SimpleFIN ----
async function refreshSfStatus() {
  const s = await api('/simplefin/status');
  $('sfStatus').textContent = s.connected
    ? `Connected ✓ — last sync: ${s.lastSync ? new Date(s.lastSync * 1000).toLocaleString() : 'never'}`
    : 'Not connected. Paste a SimpleFIN setup token to enable automatic sync.';
  $('sfSync').disabled = !s.connected;
}
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
  const d = await r.json();
  $('sfMsg').textContent = r.ok ? `Synced — imported ${d.imported} new transactions.` : `Sync failed: ${d.error}`;
  refreshSfStatus();
  refreshBudget();
};

// ---- Retirement ----
async function refreshRetirement() {
  const d = await api('/retirement');
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

refreshSfStatus();
refreshBudget();
