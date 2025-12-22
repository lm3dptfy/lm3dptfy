<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Admin | LM3DPTFY</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="/style.css" />
  <style>
    /* Admin-only layout helpers (keeps rest of site unchanged) */
    .settings-grid{
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 12px;
    }
    @media (max-width: 980px){
      .settings-grid{ grid-template-columns: 1fr; }
    }
    .settings-card{ padding: 16px; }
    .settings-card h3{ margin:0 0 6px; font-size:1rem; }
    .settings-card p{ margin:0; color: var(--muted); font-size:.92rem; line-height:1.4; }
    .settings-row{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 12px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .chip-row{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      margin-top: 10px;
    }
    .chip{
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding: 8px 10px;
      border-radius: 999px;
      border:1px solid var(--border);
      background: rgba(255,255,255,.72);
      font-weight: 750;
      font-size: .86rem;
      color: var(--text);
    }
    .chip small{ color: var(--muted); font-weight:650; }
    .muted{ color: var(--muted); }

    .section-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 16px;
    }

    .order-wrap{
      display:flex;
      flex-direction:column;
      gap: 12px;
      margin-top: 12px;
    }
    .order-card{
      padding: 16px;
      border-radius: var(--radiusXL);
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,.95), rgba(255,255,255,.70));
      box-shadow: var(--shadowSoft);
    }
    .order-top{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .order-meta{
      display:flex;
      flex-direction:column;
      gap: 4px;
      min-width: 240px;
    }
    .order-meta .who{
      font-size: 1.05rem;
      font-weight: 850;
      letter-spacing: -.01em;
      margin:0;
    }
    .order-meta .when{
      font-size: .86rem;
      color: var(--muted);
    }
    .order-meta a{ color: var(--accent); text-decoration:none; }
    .order-meta a:hover{ text-decoration:underline; }

    .order-actions{
      display:flex;
      gap: 10px;
      align-items:center;
      flex-wrap: wrap;
    }

    .order-grid{
      display:grid;
      grid-template-columns: 1.25fr .75fr;
      gap: 14px;
      margin-top: 12px;
      align-items: start;
    }
    @media (max-width: 980px){
      .order-grid{ grid-template-columns: 1fr; }
    }

    .order-block{
      border: 1px solid rgba(15,23,42,.08);
      border-radius: var(--radiusLG);
      padding: 12px;
      background: rgba(255,255,255,.70);
    }
    .order-block h4{
      margin:0 0 8px;
      font-size: .92rem;
      letter-spacing: -.01em;
    }

    .control-row{
      display:grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    @media (max-width: 980px){
      .control-row{ grid-template-columns: 1fr; }
    }

    .inline-help{
      margin-top: 8px;
      font-size: .85rem;
      color: var(--muted);
      line-height:1.4;
    }

    /* Modal */
    .modal-backdrop{
      position: fixed;
      inset: 0;
      background: rgba(2,6,23,.55);
      display:none;
      align-items:center;
      justify-content:center;
      padding: 18px;
      z-index: 999;
    }
    .modal{
      width: min(920px, 100%);
      background: #fff;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.25);
      box-shadow: 0 30px 90px rgba(2,6,23,.35);
      overflow: hidden;
    }
    .modal-head{
      padding: 14px 14px;
      border-bottom: 1px solid var(--border);
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 10px;
    }
    .modal-head h3{ margin:0; font-size: 1.05rem; }
    .modal-body{ padding: 14px; }
    .modal-actions{
      padding: 14px;
      border-top: 1px solid var(--border);
      display:flex;
      justify-content:flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    .btn-secondary{
      border:1px solid var(--border);
      background: rgba(255,255,255,.85);
      color: var(--text);
      border-radius: 14px;
      padding: 12px 14px;
      font-weight: 800;
      cursor:pointer;
    }
    .btn-secondary:hover{
      box-shadow: var(--shadowSoft);
      transform: translateY(-1px);
    }

    .sites-editor{
      display:flex;
      flex-direction:column;
      gap: 10px;
    }
    .site-row{
      border: 1px solid rgba(15,23,42,.10);
      border-radius: 16px;
      padding: 12px;
      background: rgba(246,248,252,.65);
    }
    .site-row-top{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .site-row-top strong{ font-size: .95rem; }
    .site-grid{
      display:grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 10px;
    }
    @media (max-width: 860px){
      .site-grid{ grid-template-columns: 1fr; }
    }
    .site-controls{
      display:flex;
      gap: 10px;
      align-items:center;
      flex-wrap: wrap;
      margin-top: 8px;
    }
  </style>
</head>

<body class="admin-page">
  <div class="page-shell">
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="/" title="Home">
          <img src="/lm3dptfy-logo-tp-cropped.png" alt="LM3DPTFY logo" />
          <div class="brand-title">
            <strong>Let Me 3D Print That For You</strong>
            <span>Admin dashboard • Private</span>
          </div>
        </a>

        <div class="nav-right">
          <a class="pill-link" href="/">Home</a>
          <button id="logoutTopBtn" class="pill-link" type="button">Log out</button>
        </div>
      </div>
    </header>

    <main class="page-main">
      <div class="main-inner">
        <!-- Login -->
        <div id="loginCard" class="card" style="max-width:560px;margin:0 auto;padding:18px;">
          <h1 class="admin-title" style="font-size:1.25rem;margin:0 0 6px;">Admin login</h1>
          <p class="admin-subtitle" style="margin:0 0 14px;">Sign in to see and manage quote requests.</p>

          <form id="loginForm" class="stl-form">
            <div>
              <label for="adminEmail" class="field-label">Admin email</label>
              <input type="email" id="adminEmail" class="field-input" required />
            </div>
            <div>
              <label for="adminPassword" class="field-label">Password</label>
              <input type="password" id="adminPassword" class="field-input" required />
            </div>
            <button type="submit" class="btn-primary">Log in</button>
            <p id="loginStatus" class="status-message" style="display:none;"></p>
          </form>
        </div>

        <!-- Dashboard -->
        <div id="dashboardCard" style="display:none;">
          <div class="admin-head">
            <div>
              <h1 class="admin-title">Quote requests</h1>
              <p class="admin-subtitle">Active + archived requests from lm3dptfy.online.</p>
            </div>

            <div class="admin-actions">
              <button id="reloadSheetsBtn" class="btn-primary btn-sm" type="button">Refresh from Sheets</button>
              <button id="syncSheetsBtn" class="btn-primary btn-sm" type="button">Sync to Sheets</button>
              <a href="/api/export/csv" class="btn-primary btn-sm" style="text-decoration:none;">Export CSV</a>
              <a href="/api/export/json" class="btn-primary btn-sm" style="text-decoration:none;">Export JSON</a>
            </div>
          </div>

          <p id="dashboardStatus" class="status-message" style="display:none;"></p>

          <!-- Settings -->
          <section class="card" style="padding:16px;margin-top:12px;">
            <h2 class="section-title" style="margin:0;">Settings</h2>

            <div class="settings-grid">
              <div class="settings-card card" style="box-shadow:none;">
                <div class="settings-row">
                  <div>
                    <h3>Fulfilled by list</h3>
                    <p>These names appear in the “Fulfilled by” dropdown on each order.</p>
                    <div id="fulfillerChips" class="chip-row"></div>
                  </div>
                  <button id="editFulfillersBtn" class="btn-primary btn-sm" type="button">Edit</button>
                </div>
              </div>

              <div class="settings-card card" style="box-shadow:none;">
                <div class="settings-row">
                  <div>
                    <h3>Supported sites</h3>
                    <p>These sites appear on the Home page as options and power source detection on the Request page.</p>
                    <div id="siteChips" class="chip-row"></div>
                  </div>
                  <button id="editSitesBtn" class="btn-primary btn-sm" type="button">Edit</button>
                </div>
              </div>
            </div>
          </section>

          <!-- Active -->
          <div class="section-head">
            <h2 class="section-title" style="margin:0;">Active</h2>
            <div class="muted" id="activeCount"></div>
          </div>
          <div id="activeWrap" class="order-wrap"></div>

          <!-- Archived -->
          <div class="section-head">
            <h2 class="section-title" style="margin:0;">Archived</h2>
            <div class="muted" id="archivedCount"></div>
          </div>
          <div id="archivedWrap" class="order-wrap"></div>

          <p class="tip">Tip: Bookmark <strong>/admin</strong>. This page is meant to stay private.</p>
        </div>
      </div>
    </main>

    <footer class="site-footer">
      LM3DPTFY Admin · Keep this page private.
    </footer>
  </div>

  <!-- Fulfillers Modal -->
  <div id="fulfillersModal" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal">
      <div class="modal-head">
        <h3>Edit “Fulfilled by” names</h3>
        <button class="btn-secondary" type="button" data-close="fulfillersModal">Close</button>
      </div>
      <div class="modal-body">
        <p class="inline-help" style="margin-top:0;">
          One name per line. These will appear in the “Fulfilled by” dropdown for every order.
        </p>
        <textarea id="fulfillersInput" class="field-input" style="min-height:180px;" placeholder="Robert&#10;Jared&#10;Terence"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-close="fulfillersModal">Cancel</button>
        <button id="saveFulfillersBtn" class="btn-primary" type="button">Save</button>
      </div>
    </div>
  </div>

  <!-- Sites Modal -->
  <div id="sitesModal" class="modal-backdrop" role="dialog" aria-modal="true">
    <div class="modal">
      <div class="modal-head">
        <h3>Edit supported sites</h3>
        <button class="btn-secondary" type="button" data-close="sitesModal">Close</button>
      </div>
      <div class="modal-body">
        <p class="inline-help" style="margin-top:0;">
          Hosts are used for detection (match domains). Browse URL is what opens from the Home page “Browse …” button.
        </p>
        <div class="sites-editor" id="sitesEditor"></div>
        <div style="margin-top:10px;">
          <button id="addSiteBtn" class="btn-secondary" type="button">+ Add site</button>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" type="button" data-close="sitesModal">Cancel</button>
        <button id="saveSitesBtn" class="btn-primary" type="button">Save</button>
      </div>
    </div>
  </div>

  <script>
    // ---------- DOM ----------
    const loginForm = document.getElementById('loginForm');
    const loginStatus = document.getElementById('loginStatus');
    const loginCard = document.getElementById('loginCard');
    const dashboardCard = document.getElementById('dashboardCard');
    const dashboardStatus = document.getElementById('dashboardStatus');

    const reloadBtn = document.getElementById('reloadSheetsBtn');
    const syncBtn = document.getElementById('syncSheetsBtn');
    const logoutTopBtn = document.getElementById('logoutTopBtn');

    const activeWrap = document.getElementById('activeWrap');
    const archivedWrap = document.getElementById('archivedWrap');
    const activeCount = document.getElementById('activeCount');
    const archivedCount = document.getElementById('archivedCount');

    const fulfillerChips = document.getElementById('fulfillerChips');
    const siteChips = document.getElementById('siteChips');

    const fulfillersModal = document.getElementById('fulfillersModal');
    const sitesModal = document.getElementById('sitesModal');

    const editFulfillersBtn = document.getElementById('editFulfillersBtn');
    const editSitesBtn = document.getElementById('editSitesBtn');

    const fulfillersInput = document.getElementById('fulfillersInput');
    const saveFulfillersBtn = document.getElementById('saveFulfillersBtn');

    const sitesEditor = document.getElementById('sitesEditor');
    const addSiteBtn = document.getElementById('addSiteBtn');
    const saveSitesBtn = document.getElementById('saveSitesBtn');

    // ---------- STATE ----------
    let SETTINGS = { fulfilledByNames: [], supportedSites: [] };
    let REQUESTS = [];
    let autoReloadedOnce = false;

    const STATUS_OPTIONS = [
      { value: 'new', label: 'New' },
      { value: 'responded', label: 'Responded' },
      { value: 'quote_approved', label: 'Quote approved' },
      { value: 'sent_to_printer', label: 'Sent to printer' },
      { value: 'print_complete', label: 'Print complete' },
      { value: 'qc_complete', label: 'QC complete' },
      { value: 'shipped', label: 'Shipped' },
      { value: 'paid', label: 'Paid' },
    ];

    const GMAIL_AUTH_USER = 'lm3dptfy@gmail.com';

    function buildGmailUrl(toEmail, subject, body) {
      let url = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1';
      url += '&authuser=' + encodeURIComponent(GMAIL_AUTH_USER);
      url += '&to=' + encodeURIComponent(toEmail);
      url += '&su=' + encodeURIComponent(subject);
      url += '&body=' + encodeURIComponent(body);
      return url;
    }

    function showLoginStatus(msg, isError) {
      loginStatus.textContent = msg;
      loginStatus.style.display = 'block';
      loginStatus.classList.toggle('status-error', !!isError);
      loginStatus.classList.toggle('status-success', !isError);
    }

    function showDashStatus(msg, isError) {
      dashboardStatus.textContent = msg;
      dashboardStatus.style.display = 'block';
      dashboardStatus.classList.toggle('status-error', !!isError);
      dashboardStatus.classList.toggle('status-success', !isError);
      if (!isError) setTimeout(() => { dashboardStatus.style.display = 'none'; }, 4500);
    }

    // ---------- API (SURFACES REAL ERROR TEXT) ----------
    async function api(url, opts = {}) {
      const res = await fetch(url, {
        credentials: 'include',
        ...opts,
        headers: {
          'Accept': 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          ...(opts.headers || {})
        }
      });

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}

      if (!res.ok) {
        const msg =
          (data && data.error) ? data.error :
          (text ? text.slice(0, 220) : `HTTP ${res.status}`);
        throw new Error(msg);
      }
      return data;
    }

    // ---------- MODAL HELPERS ----------
    function openModal(el){ el.style.display = 'flex'; }
    function closeModal(el){ el.style.display = 'none'; }

    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close');
        const el = document.getElementById(id);
        closeModal(el);
      });
    });

    // Close modals when clicking backdrop
    [fulfillersModal, sitesModal].forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) closeModal(m);
      });
    });

    // ---------- RENDER SETTINGS ----------
    function renderSettingsChips(){
      fulfillerChips.innerHTML = '';
      siteChips.innerHTML = '';

      const names = Array.isArray(SETTINGS.fulfilledByNames) ? SETTINGS.fulfilledByNames : [];
      if (!names.length) {
        const span = document.createElement('span');
        span.className = 'muted';
        span.textContent = 'No names found.';
        fulfillerChips.appendChild(span);
      } else {
        names.forEach(n => {
          const c = document.createElement('span');
          c.className = 'chip';
          c.textContent = n;
          fulfillerChips.appendChild(c);
        });
      }

      const sites = Array.isArray(SETTINGS.supportedSites) ? SETTINGS.supportedSites : [];
      const enabledSites = sites.filter(s => s && s.enabled !== false);
      if (!enabledSites.length) {
        const span = document.createElement('span');
        span.className = 'muted';
        span.textContent = 'No enabled sites.';
        siteChips.appendChild(span);
      } else {
        enabledSites.slice(0, 8).forEach(s => {
          const c = document.createElement('span');
          c.className = 'chip';
          c.innerHTML = `${escapeHtml(s.name || 'Site')} <small>${(s.hosts && s.hosts[0]) ? s.hosts[0] : ''}</small>`;
          siteChips.appendChild(c);
        });
        if (enabledSites.length > 8) {
          const more = document.createElement('span');
          more.className = 'chip';
          more.textContent = `+${enabledSites.length - 8} more`;
          siteChips.appendChild(more);
        }
      }
    }

    // ---------- SITES EDITOR ----------
    function getSitesDraft(){
      const arr = Array.isArray(SETTINGS.supportedSites) ? SETTINGS.supportedSites : [];
      return arr.map(s => ({
        id: s.id || '',
        name: s.name || '',
        hosts: Array.isArray(s.hosts) ? s.hosts.join(', ') : '',
        browseUrl: s.browseUrl || '',
        enabled: s.enabled !== false
      }));
    }

    function renderSitesEditor(draft){
      sitesEditor.innerHTML = '';
      draft.forEach((s, idx) => {
        const row = document.createElement('div');
        row.className = 'site-row';

        row.innerHTML = `
          <div class="site-row-top">
            <strong>Site ${idx + 1}</strong>
            <button class="btn-secondary" type="button" data-remove="${idx}">Remove</button>
          </div>
          <div class="site-grid">
            <div>
              <label class="field-label">Name</label>
              <input class="field-input" data-k="name" data-i="${idx}" value="${escapeAttr(s.name)}" placeholder="STLFlix" />
            </div>
            <div>
              <label class="field-label">Browse URL (optional)</label>
              <input class="field-input" data-k="browseUrl" data-i="${idx}" value="${escapeAttr(s.browseUrl)}" placeholder="https://..." />
            </div>
            <div style="grid-column:1/-1;">
              <label class="field-label">Hosts (comma or new line)</label>
              <textarea class="field-input" data-k="hosts" data-i="${idx}" style="min-height:90px;" placeholder="stlflix.com, platform.stlflix.com">${escapeHtml(s.hosts)}</textarea>
            </div>
          </div>
          <div class="site-controls">
            <label class="chip" style="cursor:pointer;">
              <input type="checkbox" data-k="enabled" data-i="${idx}" ${s.enabled ? 'checked' : ''} style="margin-right:8px;" />
              Enabled
            </label>
            <input type="hidden" data-k="id" data-i="${idx}" value="${escapeAttr(s.id)}" />
          </div>
        `;

        sitesEditor.appendChild(row);
      });

      sitesEditor.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = Number(btn.getAttribute('data-remove'));
          const current = readSitesDraftFromDom();
          current.splice(i, 1);
          renderSitesEditor(current);
        });
      });
    }

    function readSitesDraftFromDom(){
      const rows = Array.from(sitesEditor.querySelectorAll('.site-row'));
      const draft = [];
      rows.forEach((row, idx) => {
        const get = (k) => row.querySelector(`[data-k="${k}"][data-i="${idx}"]`);
        const name = (get('name')?.value || '').trim();
        const browseUrl = (get('browseUrl')?.value || '').trim();
        const hostsRaw = (get('hosts')?.value || '').trim();
        const enabled = !!get('enabled')?.checked;
        const id = (get('id')?.value || '').trim();

        draft.push({ id, name, browseUrl, hosts: hostsRaw, enabled });
      });
      return draft;
    }

    // ---------- ORDERS RENDER ----------
    function escapeHtml(str){
      return String(str ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }
    function escapeAttr(str){ return escapeHtml(str).replaceAll('\n', ' '); }

    function getFulfilledOptions(){
      const names = Array.isArray(SETTINGS.fulfilledByNames) ? SETTINGS.fulfilledByNames : [];
      const opts = [{ value: '', label: '-- None --' }, ...names.map(n => ({ value: n, label: n }))];
      return opts;
    }

    function detectSourceName(link){
      const sites = Array.isArray(SETTINGS.supportedSites) ? SETTINGS.supportedSites : [];
      try{
        const u = new URL(link);
        const host = u.hostname.replace(/^www\./,'').toLowerCase();
        for (const s of sites){
          const hosts = Array.isArray(s.hosts) ? s.hosts.map(h => String(h).toLowerCase().replace(/^www\./,'')) : [];
          if (hosts.includes(host)) return s.name || 'Unknown';
          for (const h of hosts){
            if (h && host.endsWith('.' + h)) return s.name || 'Unknown';
          }
        }
      }catch{}
      return 'Unknown';
    }

    function renderOrders(){
      const active = REQUESTS.filter(r => !r.archived);
      const archived = REQUESTS.filter(r => r.archived);

      activeCount.textContent = active.length ? `${active.length} order(s)` : '';
      archivedCount.textContent = archived.length ? `${archived.length} order(s)` : '';

      activeWrap.innerHTML = '';
      archivedWrap.innerHTML = '';

      if (!active.length){
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'No active requests.';
        activeWrap.appendChild(empty);
      } else {
        active.forEach(r => activeWrap.appendChild(renderOrderCard(r)));
      }

      if (!archived.length){
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'No archived requests.';
        archivedWrap.appendChild(empty);
      } else {
        archived.forEach(r => archivedWrap.appendChild(renderOrderCard(r)));
      }
    }

    function renderOrderCard(r){
      const card = document.createElement('div');
      card.className = 'order-card';

      const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
      const sourceName = detectSourceName(r.stlLink || '');

      const subject = `LM3DPTFY quote update`;
      const body = [
        `Hi ${r.name || ''},`,
        ``,
        `Thanks for your request!`,
        ``,
        `Order ID: ${r.id}`,
        `Model link: ${r.stlLink || ''}`,
        ``,
        `— LM3DPTFY`,
      ].join('\n');

      const fulfilledOpts = getFulfilledOptions();

      card.innerHTML = `
        <div class="order-top">
          <div class="order-meta">
            <div class="when">${escapeHtml(created)} • <strong>Source:</strong> ${escapeHtml(sourceName)}</div>
            <p class="who">${escapeHtml(r.name || '(No name)')}</p>
            <div>
              <a href="mailto:${escapeAttr(r.email || '')}">${escapeHtml(r.email || '')}</a>
            </div>
          </div>

          <div class="order-actions">
            <a class="btn-primary btn-sm" href="${escapeAttr(r.stlLink || '#')}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">View model</a>
            <a class="btn-primary btn-sm" href="${escapeAttr(buildGmailUrl(r.email || '', subject, body))}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">Reply</a>
            <label class="chip" style="cursor:pointer;">
              <input type="checkbox" class="archiveToggle" ${r.archived ? 'checked' : ''} style="margin-right:8px;" />
              Archive
            </label>
          </div>
        </div>

        <div class="order-grid">
          <div class="order-block">
            <h4>Customer notes</h4>
            <div style="white-space:pre-wrap;line-height:1.45;color:var(--text);">${escapeHtml(r.details || '(none)')}</div>
          </div>

          <div class="order-block">
            <h4>Admin notes</h4>
            <textarea class="field-input adminNotes" placeholder="Notes for you only...">${escapeHtml(r.adminNotes || '')}</textarea>
            <div class="inline-help">Saved automatically.</div>
          </div>
        </div>

        <div class="control-row">
          <div>
            <label class="field-label">Status</label>
            <select class="statusSelect status-select">
              ${STATUS_OPTIONS.map(o => `<option value="${o.value}" ${o.value===r.status?'selected':''}>${o.label}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="field-label">Fulfilled by</label>
            <select class="fulfilledSelect status-select">
              ${fulfilledOpts.map(o => `<option value="${escapeAttr(o.value)}" ${o.value===(r.fulfilledBy||'')?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="field-label">Tracking #</label>
            <input class="field-input trackingInput" value="${escapeAttr(r.trackingNumber || '')}" placeholder="${r.status==='shipped' ? 'Paste tracking #' : 'Set status to Shipped'}" ${r.status==='shipped' ? '' : 'disabled'} />
            <div class="inline-help">When status is <strong>Shipped</strong>, adding tracking will open a Gmail draft on blur.</div>
          </div>
        </div>
      `;

      // Wire events
      const statusSelect = card.querySelector('.statusSelect');
      const fulfilledSelect = card.querySelector('.fulfilledSelect');
      const adminNotesEl = card.querySelector('.adminNotes');
      const trackingInput = card.querySelector('.trackingInput');
      const archiveToggle = card.querySelector('.archiveToggle');

      statusSelect.addEventListener('change', async () => {
        try{
          const status = statusSelect.value;
          await api(`/api/requests/${encodeURIComponent(r.id)}/status`, {
            method: 'POST',
            body: JSON.stringify({ status })
          });
          r.status = status;
          // re-render this card for tracking enable/disable
          saveCache();
          renderOrders();
        }catch(e){
          showDashStatus(e.message || 'Failed to update status', true);
        }
      });

      fulfilledSelect.addEventListener('change', async () => {
        try{
          const fulfilledBy = fulfilledSelect.value;
          await api(`/api/requests/${encodeURIComponent(r.id)}/fulfilled`, {
            method: 'POST',
            body: JSON.stringify({ fulfilledBy })
          });
          r.fulfilledBy = fulfilledBy;
          saveCache();
        }catch(e){
          showDashStatus(e.message || 'Failed to update fulfilled by', true);
        }
      });

      let notesTimer = null;
      adminNotesEl.addEventListener('input', () => {
        clearTimeout(notesTimer);
        notesTimer = setTimeout(async () => {
          try{
            const adminNotes = adminNotesEl.value;
            await api(`/api/requests/${encodeURIComponent(r.id)}/admin-notes`, {
              method: 'POST',
              body: JSON.stringify({ adminNotes })
            });
            r.adminNotes = adminNotes;
            saveCache();
          }catch(e){
            showDashStatus(e.message || 'Failed to save admin notes', true);
          }
        }, 500);
      });

      trackingInput.addEventListener('blur', async () => {
        if (trackingInput.disabled) return;
        const val = trackingInput.value.trim();

        try{
          await api(`/api/requests/${encodeURIComponent(r.id)}/tracking`, {
            method: 'POST',
            body: JSON.stringify({ trackingNumber: val })
          });
          r.trackingNumber = val;
          saveCache();

          if (val && r.status === 'shipped') {
            const sub = `Your order has shipped — tracking inside`;
            const msg = [
              `Hi ${r.name || ''},`,
              ``,
              `Your order has shipped!`,
              `Tracking: ${val}`,
              ``,
              `Thanks again,`,
              `LM3DPTFY`,
            ].join('\n');
            window.open(buildGmailUrl(r.email || '', sub, msg), '_blank', 'noopener,noreferrer');
          }
        }catch(e){
          showDashStatus(e.message || 'Failed to save tracking', true);
        }
      });

      archiveToggle.addEventListener('change', async () => {
        try{
          const archived = !!archiveToggle.checked;
          await api(`/api/requests/${encodeURIComponent(r.id)}/archive`, {
            method: 'POST',
            body: JSON.stringify({ archived })
          });
          r.archived = archived;
          saveCache();
          renderOrders();
        }catch(e){
          showDashStatus(e.message || 'Failed to archive/unarchive', true);
        }
      });

      return card;
    }

    // ---------- CACHE (RETENTION ON REFRESH) ----------
    const CACHE_KEY = 'lm3dptfy_admin_cache_v1';
    function saveCache(){
      try{
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          at: Date.now(),
          settings: SETTINGS,
          requests: REQUESTS
        }));
      }catch{}
    }

    function loadCache(){
      try{
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.requests)) return false;
        SETTINGS = parsed.settings || SETTINGS;
        REQUESTS = parsed.requests || REQUESTS;
        return true;
      }catch{
        return false;
      }
    }

    // ---------- LOADERS ----------
    function showDashboard(){
      loginCard.style.display = 'none';
      dashboardCard.style.display = 'block';
    }

    function showLogin(){
      dashboardCard.style.display = 'none';
      loginCard.style.display = 'block';
    }

    async function loadSettingsAndOrders({ allowAutoSheetsReload }){
      // Settings
      const s = await api('/api/settings');
      SETTINGS = s.settings || { fulfilledByNames: [], supportedSites: [] };
      renderSettingsChips();

      // Orders
      REQUESTS = await api('/api/requests');
      if (allowAutoSheetsReload && Array.isArray(REQUESTS) && REQUESTS.length === 0 && !autoReloadedOnce) {
        autoReloadedOnce = true;
        try{
          showDashStatus('No orders in memory — auto refreshing from Sheets…', false);
          await api('/api/sheets/reload', { method:'POST' });
          REQUESTS = await api('/api/requests');
        }catch(e){
          // show error but still render empty state
          showDashStatus(e.message || 'Auto refresh from Sheets failed', true);
        }
      }

      saveCache();
      renderOrders();
    }

    async function bootstrap(){
      // draw cache immediately (so refresh never looks empty)
      const hadCache = loadCache();
      if (hadCache) {
        renderSettingsChips();
        renderOrders();
      }

      try{
        await loadSettingsAndOrders({ allowAutoSheetsReload: true });
        showDashboard();
      }catch(e){
        // Unauthorized or server error
        showLogin();
      }
    }

    // ---------- EVENTS ----------
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showLoginStatus('Logging in…', false);

      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;

      try{
        await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });

        showLoginStatus('Logged in!', false);
        showDashboard();
        await loadSettingsAndOrders({ allowAutoSheetsReload: true });
      }catch(err){
        showLoginStatus(err.message || 'Login failed', true);
      }
    });

    logoutTopBtn.addEventListener('click', async () => {
      try{
        await api('/api/logout', { method:'POST' });
      }catch{}
      showLogin();
    });

    reloadBtn.addEventListener('click', async () => {
      try{
        showDashStatus('Refreshing from Sheets…', false);
        await api('/api/sheets/reload', { method:'POST' });
        REQUESTS = await api('/api/requests');
        saveCache();
        renderOrders();
        showDashStatus('Refreshed from Sheets.', false);
      }catch(e){
        showDashStatus(e.message || 'Refresh failed', true);
      }
    });

    syncBtn.addEventListener('click', async () => {
      try{
        showDashStatus('Syncing to Sheets…', false);
        await api('/api/sheets/sync', { method:'POST' });
        showDashStatus('Synced to Sheets.', false);
      }catch(e){
        showDashStatus(e.message || 'Sync failed', true);
      }
    });

    editFulfillersBtn.addEventListener('click', () => {
      const names = Array.isArray(SETTINGS.fulfilledByNames) ? SETTINGS.fulfilledByNames : [];
      fulfillersInput.value = names.join('\n');
      openModal(fulfillersModal);
    });

    saveFulfillersBtn.addEventListener('click', async () => {
      const names = fulfillersInput.value
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);

      try{
        await api('/api/settings/fulfillers', {
          method: 'PUT',
          body: JSON.stringify({ names })
        });

        // reload settings from server
        const s = await api('/api/settings');
        SETTINGS = s.settings || SETTINGS;
        renderSettingsChips();
        saveCache();
        closeModal(fulfillersModal);
        // re-render orders so dropdowns update
        renderOrders();
        showDashStatus('Fulfilled by list updated.', false);
      }catch(e){
        showDashStatus(e.message || 'Failed to update fulfilled by list', true);
      }
    });

    editSitesBtn.addEventListener('click', () => {
      const draft = getSitesDraft();
      renderSitesEditor(draft.length ? draft : [{ id:'', name:'', hosts:'', browseUrl:'', enabled:true }]);
      openModal(sitesModal);
    });

    addSiteBtn.addEventListener('click', () => {
      const current = readSitesDraftFromDom();
      current.push({ id:'', name:'', hosts:'', browseUrl:'', enabled:true });
      renderSitesEditor(current);
    });

    saveSitesBtn.addEventListener('click', async () => {
      const draft = readSitesDraftFromDom();

      const sites = draft.map(s => ({
        id: (s.id || '').trim(),
        name: (s.name || '').trim(),
        hosts: (s.hosts || '')
          .split(/[\n,]+/)
          .map(x => x.trim())
          .filter(Boolean),
        browseUrl: (s.browseUrl || '').trim(),
        enabled: !!s.enabled
      })).filter(s => s.name);

      try{
        await api('/api/settings/sites', {
          method: 'PUT',
          body: JSON.stringify({ sites })
        });

        const s = await api('/api/settings');
        SETTINGS = s.settings || SETTINGS;
        renderSettingsChips();
        saveCache();
        closeModal(sitesModal);
        renderOrders();
        showDashStatus('Supported sites updated.', false);
      }catch(e){
        showDashStatus(e.message || 'Failed to update supported sites', true);
      }
    });

    // ---------- START ----------
    bootstrap();
  </script>
</body>
</html>
