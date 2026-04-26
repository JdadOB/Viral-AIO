// ── Utilities ────────────────────────────────────────────────────────────────

function proxyImg(url) {
  if (!url) return null;
  return '/api/img?url=' + encodeURIComponent(url);
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = '>> ' + msg;
  el.className = `toast${type ? ' ' + type : ''}`;
  setTimeout(() => el.classList.add('hidden'), 3500);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'UNKNOWN';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'JUST NOW';
  if (m < 60) return `${m}M AGO`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}H AGO`;
  return `${Math.floor(h / 24)}D AGO`;
}

function fmt(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function exportAlertsCSV(alerts) {
  if (!alerts.length) { toast('NO DATA TO EXPORT', 'error'); return; }
  const cols = ['id', 'username', 'group_name', 'post_type', 'post_url', 'likes_count', 'comments_count', 'plays_count', 'engagement_rate', 'multiplier', 'triggered_at'];
  const esc  = v => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const rows = [cols.join(','), ...alerts.map(a => cols.map(c => esc(a[c])).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `viral-alerts-${new Date().toISOString().slice(0,10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast(`EXPORTED ${alerts.length} ALERTS`, 'success');
}

function initials(name) {
  if (!name) return '??';
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().substring(0, 2);
}

function alertId(id) {
  return 'VRL-' + String(id).padStart(4, '0');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ── System Clock ─────────────────────────────────────────────────────────────
function updateClock() {
  const el = $('#sys-time');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}
setInterval(updateClock, 1000);
updateClock();

// ── Router ───────────────────────────────────────────────────────────────────

const pages = ['dashboard', 'competitors', 'agents', 'settings'];
let currentPage = 'dashboard';

function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  currentPage = page;
  pages.forEach(p => {
    $(`#page-${p}`).classList.toggle('hidden', p !== page);
  });
  $$('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  renderPage(page);
}

function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  else if (page === 'competitors') renderCompetitors();
  else if (page === 'agents') renderAgents();
  else if (page === 'settings') renderSettings();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function updateStats() {
  try {
    const s = await api('/api/stats');

    // Sidebar badge
    const badge = $('#unread-badge');
    if (s.unreadAlerts > 0) { badge.textContent = s.unreadAlerts; badge.classList.add('visible'); }
    else badge.classList.remove('visible');

    $('#account-count').textContent = s.totalAccounts || '';

    // Mission bar
    $('#bar-alerts').textContent   = s.totalAlerts   || 0;
    $('#bar-unread').textContent   = s.unreadAlerts  || 0;
    $('#bar-acted').textContent    = s.actedOn       || 0;
    $('#bar-briefs').textContent   = s.totalBriefs   || 0;
    $('#bar-accounts').textContent = s.totalAccounts || 0;

    return s;
  } catch { return {}; }
}

// ── Ticker ────────────────────────────────────────────────────────────────────

function updateTicker(alerts = []) {
  const el = $('#ticker-text');
  if (!el) return;
  if (!alerts.length) {
    el.textContent = 'SYSTEM READY // AWAITING SCAN DATA // ADD CREATORS TO BEGIN TRACKING';
    return;
  }
  const parts = alerts.slice(0, 10).map(a =>
    `${alertId(a.id)} @${a.username.toUpperCase()} — ${a.post_type?.toUpperCase()} — ${(a.multiplier||0).toFixed(1)}x AVG — ${fmt(a.likes_count)} LIKES`
  );
  el.textContent = parts.join('   //   ');
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

let activeFilter = 'all';
let activeSort   = 'latest';
let activeGroup  = '';

async function renderDashboard() {
  const el = $('#page-dashboard');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">INTELLIGENCE <span class="accent">HUB</span></div>
        <div class="page-subtitle">// VIRAL CONTENT DETECTION FEED</div>
      </div>
    </div>
    <div class="stats-row" id="stats-row"></div>
    <div class="filter-tabs" id="filter-tabs-row"></div>
    <div id="alerts-list" class="alerts-list">
      <div class="empty-state"><span class="spinner"></span></div>
    </div>
  `;

  const [stats, alerts, accounts] = await Promise.all([
    api('/api/stats'),
    api(`/api/alerts?filter=${activeFilter}&sort=${activeSort}${activeGroup ? `&group=${encodeURIComponent(activeGroup)}` : ''}`),
    api('/api/accounts'),
  ]);

  const groups = [...new Set(accounts.map(a => a.group_name).filter(Boolean))];

  $('#filter-tabs-row').innerHTML = `
    <button class="filter-tab ${activeFilter==='all'?'active':''}" data-f="all">[ ALL ALERTS ]</button>
    <button class="filter-tab ${activeFilter==='unread'?'active':''}" data-f="unread">[ UNREAD ]</button>
    <button class="filter-tab ${activeFilter==='acted_on'?'active':''}" data-f="acted_on">[ ACTED ON ]</button>
    ${groups.length > 1 ? `
      <div class="sort-divider"></div>
      <button class="filter-tab group-tab ${activeGroup===''?'active':''}" data-g="">[ ALL GROUPS ]</button>
      ${groups.map(g => `<button class="filter-tab group-tab ${activeGroup===g?'active':''}" data-g="${g}">[ ${g.toUpperCase()} ]</button>`).join('')}
    ` : ''}
    <div class="sort-divider"></div>
    <button class="filter-tab sort-tab ${activeSort==='latest'?'active':''}" data-s="latest">[ LATEST ]</button>
    <button class="filter-tab sort-tab ${activeSort==='engagement'?'active':''}" data-s="engagement">[ TOP ENGAGEMENT ]</button>
    <button class="filter-tab sort-tab ${activeSort==='views'?'active':''}" data-s="views">[ MOST VIEWED ]</button>
    <button class="filter-tab" id="clear-acted-btn" style="margin-left:auto;border-color:var(--red);color:var(--red)">[ CLEAR ACTED ON ]</button>
    <button class="filter-tab" id="export-csv-btn" style="border-color:#FF9500;color:#FF9500">[ EXPORT CSV ]</button>
  `;

  $('#filter-tabs-row').querySelectorAll('[data-f]').forEach(btn => {
    btn.addEventListener('click', () => { activeFilter = btn.dataset.f; renderDashboard(); });
  });
  $('#filter-tabs-row').querySelectorAll('[data-s]').forEach(btn => {
    btn.addEventListener('click', () => { activeSort = btn.dataset.s; renderDashboard(); });
  });
  $('#filter-tabs-row').querySelectorAll('[data-g]').forEach(btn => {
    btn.addEventListener('click', () => { activeGroup = btn.dataset.g; renderDashboard(); });
  });
  $('#clear-acted-btn').addEventListener('click', async () => {
    await api('/api/alerts/acted-on', { method: 'DELETE' });
    toast('ACTED-ON ALERTS CLEARED', 'success');
    renderDashboard();
  });
  $('#export-csv-btn').addEventListener('click', () => exportAlertsCSV(alerts));

  renderStatsRow(stats);
  renderAlerts(alerts);
  updateTicker(alerts);
  updateStats();
}

function renderStatsRow(s) {
  $('#stats-row').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">VIRAL ALERTS</div>
      <div class="stat-value magenta">${s.totalAlerts || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">UNREAD INTEL</div>
      <div class="stat-value cyan">${s.unreadAlerts || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">MISSIONS ACTED</div>
      <div class="stat-value green">${s.actedOn || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">BRIEFS GENERATED</div>
      <div class="stat-value">${s.totalBriefs || 0}</div>
    </div>
  `;
}

function renderAlerts(alerts) {
  const el = $('#alerts-list');
  if (!alerts.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">[ NO SIGNAL ]</div>
        <h3>NO VIRAL CONTENT DETECTED</h3>
        <p>ADD CREATORS AND EXECUTE SCAN TO BEGIN TRACKING</p>
      </div>
    `;
    return;
  }
  el.innerHTML = alerts.map(alertCardHTML).join('');
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleAlertAction);
  });
}

function alertCardHTML(a) {
  const cardClass = !a.viewed ? 'unread' : a.acted_on ? 'acted-on' : '';
  const bannerClass = a.acted_on ? 'acted-on' : '';
  const typeTag = a.post_type === 'Reel' ? 'tag-type-reel'
                : a.post_type === 'Carousel' ? 'tag-type-carousel'
                : 'tag-type-image';
  const hasBrief = !!a.brief;
  const avatarInner = a.profile_pic_url
    ? `<img src="${proxyImg(a.profile_pic_url)}" alt="">`
    : initials(a.username);

  // Contamination level bar (engagement rate, capped at 100% width)
  const er = a.engagement_rate || 0;
  const erPct = Math.min(er * 8, 100); // scale ER% for visual bar
  const contLevel = er >= 3 ? 'CRITICAL' : er >= 1.5 ? 'ELEVATED' : er >= 0.5 ? 'MODERATE' : 'TRACE';

  return `
    <div class="alert-card ${cardClass}" data-id="${a.id}">
      <div class="threat-banner ${bannerClass}">
        <span>${!a.viewed ? '&#9632; NEW VIRAL ALERT' : a.acted_on ? '&#10003; MISSION COMPLETE' : '&#9632; ALERT LOGGED'}</span>
        <span class="threat-id">${alertId(a.id)}</span>
      </div>
      <div class="alert-inner">
        <div class="alert-thumb">
          ${a.thumbnail_url ? `<img src="${proxyImg(a.thumbnail_url)}" alt="" onerror="this.style.display='none'">` : ''}
        </div>
        <div class="alert-main">
          <div class="alert-profile">
            <div class="alert-avatar">${avatarInner}</div>
            <div>
              <div class="alert-username">@${a.username.toUpperCase()}</div>
              <div class="alert-followers">${fmt(a.followers_count)} FOLLOWERS // ${timeAgo(a.triggered_at)}</div>
            </div>
          </div>
          <div class="contamination-bar">
            <div class="contamination-label">
              <span>ENGAGEMENT LEVEL</span>
              <span class="level">${contLevel} &mdash; ${er.toFixed(2)}% ER</span>
            </div>
            <div class="contamination-track">
              <div class="contamination-fill" style="width:${erPct}%"></div>
            </div>
          </div>
          <div class="alert-tags">
            <span class="tag ${typeTag}">${(a.post_type||'POST').toUpperCase()}</span>
            ${a.multiplier >= 1 ? `<span class="tag tag-multiplier">&#9650; ${a.multiplier.toFixed(1)}x WARP</span>` : ''}
            ${a.acted_on ? `<span class="tag tag-acted">ACTIONED</span>` : ''}
          </div>
          <div class="alert-stats">
            <span>&#9829; ${fmt(a.likes_count)}</span>
            <span>&#9654; ${fmt(a.comments_count)}</span>
            ${a.plays_count > 0 ? `<span>&#9632; ${fmt(a.plays_count)} PLAYS</span>` : ''}
          </div>
          <div class="alert-actions">
            ${!hasBrief
              ? `<button class="btn btn-magenta" data-action="brief" data-id="${a.id}">[ INTEL BRIEF ]</button>`
              : `<button class="btn btn-cyan" data-action="toggle-brief" data-id="${a.id}">[ VIEW BRIEF ]</button>`}
            ${a.post_url ? `<a class="btn btn-dim" href="${a.post_url}" target="_blank">[ VIEW POST ]</a>` : ''}
            ${!a.acted_on
              ? `<button class="btn btn-green" data-action="act" data-id="${a.id}">[ MARK ACTIONED ]</button>`
              : `<button class="btn btn-dim" data-action="dismiss" data-id="${a.id}">[ DISMISS ]</button>`}
          </div>
        </div>
      </div>
      <div class="brief-panel ${hasBrief ? 'open' : ''}" id="brief-${a.id}">
        ${hasBrief ? `<div class="brief-content">${briefHTML(a.brief)}</div>` : ''}
      </div>
    </div>
  `;
}

function briefHTML(brief) {
  if (!brief) return '';
  const s = brief.sections || {};
  const sections = [
    { key: 'hookAnalysis',        label: 'HOOK ANALYSIS' },
    { key: 'formatBlueprint',     label: 'FORMAT BLUEPRINT' },
    { key: 'captionFramework',    label: 'CAPTION FRAMEWORK' },
    { key: 'hashtagStrategy',     label: 'HASHTAG STRATEGY' },
    { key: 'postingWindow',       label: 'POSTING WINDOW' },
    { key: 'differentiationTips', label: 'DIFFERENTIATION TIPS' },
  ];

  const rendered = sections.filter(sec => s[sec.key]).map(sec => `
    <div class="brief-section">
      <div class="brief-section-title">// ${sec.label}</div>
      <p>${s[sec.key].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
    </div>
  `).join('');

  return rendered || `<div class="brief-section"><p>${(brief.raw||'').replace(/</g,'&lt;')}</p></div>`;
}

async function handleAlertAction(e) {
  const btn = e.currentTarget;
  const { action, id } = btn.dataset;

  if (action === 'brief') {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> GENERATING...';
    const panel = $(`#brief-${id}`);
    panel.innerHTML = '<div class="brief-loading">// CLAUDE AI ANALYZING POST // GENERATING CONTENT BRIEF...</div>';
    panel.classList.add('open');
    api(`/api/alerts/${id}/viewed`, { method: 'PATCH' }).catch(() => {});

    try {
      const brief = await api(`/api/alerts/${id}/brief`, { method: 'POST' });
      panel.innerHTML = briefHTML(brief);
      btn.innerHTML = '[ VIEW BRIEF ]';
      btn.dataset.action = 'toggle-brief';
      btn.className = 'btn btn-cyan';
      btn.disabled = false;
      updateStats();
      toast('BRIEF GENERATED', 'success');
    } catch (err) {
      panel.innerHTML = `<div class="brief-loading" style="color:var(--red)">// ERROR: ${err.message}</div>`;
      btn.innerHTML = '[ GENERATE BRIEF ]';
      btn.disabled = false;
    }
  }

  if (action === 'toggle-brief') {
    $(`#brief-${id}`).classList.toggle('open');
    api(`/api/alerts/${id}/viewed`, { method: 'PATCH' }).catch(() => {});
  }

  if (action === 'act') {
    await api(`/api/alerts/${id}/acted-on`, { method: 'PATCH', body: { acted_on: true } });
    const card = btn.closest('.alert-card');
    card.classList.remove('unread');
    card.classList.add('acted-on');
    card.querySelector('.threat-banner').innerHTML = `<span>&#10003; MISSION COMPLETE</span><span class="threat-id">${card.querySelector('.threat-id').textContent}</span>`;
    btn.dataset.action = 'dismiss';
    btn.className = 'btn btn-dim';
    btn.textContent = '[ DISMISS ]';
    updateStats();
    toast('MISSION MARKED COMPLETE', 'success');
  }

  if (action === 'dismiss') {
    await api(`/api/alerts/${id}/dismiss`, { method: 'PATCH' });
    const card = btn.closest('.alert-card');
    card.style.transition = 'opacity 0.3s, max-height 0.4s';
    card.style.opacity = '0';
    card.style.maxHeight = '0';
    card.style.overflow = 'hidden';
    setTimeout(() => card.remove(), 400);
    updateStats();
    toast('ALERT DISMISSED', 'success');
  }
}

// ── Competitors ───────────────────────────────────────────────────────────────

async function renderCompetitors() {
  const el = $('#page-competitors');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">CREATOR <span class="accent">ROSTER</span></div>
        <div class="page-subtitle">// ACTIVE CREATOR REGISTRY</div>
      </div>
    </div>
    <div class="add-account-form">
      <div class="input-row">
        <div class="input-group" style="max-width:220px">
          <label>INSTAGRAM HANDLE</label>
          <input type="text" id="add-username" placeholder="@username">
        </div>
        <div class="input-group" style="max-width:200px">
          <label>SECTOR GROUP</label>
          <input type="text" id="add-group" placeholder="e.g. TIER 1 CLIENTS">
        </div>
        <div style="padding-top:20px">
          <button class="btn btn-cyan" id="add-btn">[ ADD CREATOR ]</button>
        </div>
        <div style="padding-top:20px">
          <a href="/scraper.html" target="_blank" class="btn btn-magenta">[ 18+ BYPASS ]</a>
        </div>
        <div style="padding-top:20px">
          <button class="btn" id="bulk-toggle-btn" style="border-color:#FF9500;color:#FF9500">[ BULK ADD ]</button>
        </div>
      </div>
      <div id="bulk-add-panel" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="input-row" style="align-items:flex-end;gap:12px">
          <div class="input-group" style="flex:1;max-width:400px">
            <label>HANDLES — ONE PER LINE OR COMMA SEPARATED</label>
            <textarea id="bulk-usernames" rows="4" class="agent-input" placeholder="@creator1&#10;@creator2&#10;creator3, creator4"></textarea>
          </div>
          <div class="input-group" style="max-width:200px">
            <label>SECTOR GROUP (applies to all)</label>
            <input type="text" id="bulk-group" class="agent-input" placeholder="e.g. COMPETITORS">
          </div>
          <div>
            <button class="btn" id="bulk-add-btn" style="background:#FF9500;color:#000;font-weight:700">[ ADD ALL ]</button>
          </div>
        </div>
        <div id="bulk-progress" style="font-size:11px;color:var(--text-dim);margin-top:8px"></div>
      </div>
      <div style="font-size:0.72rem;color:#556677;margin-top:0.5rem">// Use <strong style="color:#ff0080">18+ BYPASS</strong> for age-restricted profiles that Apify cannot access</div>
    </div>
    <div id="targets-grid" class="targets-grid">
      <div class="empty-state"><span class="spinner"></span></div>
    </div>
  `;

  $('#add-btn').addEventListener('click', addAccount);
  $('#add-username').addEventListener('keydown', e => { if (e.key === 'Enter') addAccount(); });

  $('#bulk-toggle-btn').addEventListener('click', () => {
    const panel = $('#bulk-add-panel');
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    $('#bulk-toggle-btn').textContent = open ? '[ BULK ADD ]' : '[ HIDE BULK ]';
  });

  $('#bulk-add-btn').addEventListener('click', bulkAddAccounts);

  loadAccounts();
}

async function loadAccounts() {
  try {
    const accounts = await api('/api/accounts');
    const grid = $('#targets-grid');
    if (!accounts.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">[ NO CREATORS ]</div>
          <h3>CREATOR ROSTER EMPTY</h3>
          <p>ADD AN INSTAGRAM HANDLE TO BEGIN TRACKING</p>
        </div>
      `;
      return;
    }
    grid.innerHTML = accounts.map(targetPodHTML).join('');
    grid.querySelectorAll('.pod-scan').forEach(btn => {
      btn.addEventListener('click', () => scanAccount(btn.dataset.id, btn.dataset.name, btn));
    });
    grid.querySelectorAll('.pod-remove').forEach(btn => {
      btn.addEventListener('click', () => removeAccount(btn.dataset.id, btn.dataset.name));
    });
    updateStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function targetPodHTML(a) {
  const hasViral   = a.total_alerts > 0;
  const podClass   = hasViral ? 'has-viral' : '';
  const statusTxt  = hasViral ? 'VIRAL ACTIVE' : 'MONITORING';
  const statusCls  = hasViral ? 'viral' : 'idle';
  const avatarInner = a.profile_pic_url ? `<img src="${proxyImg(a.profile_pic_url)}" alt="">` : initials(a.username);
  const erPct      = Math.min((a.avg_engagement_rate || 0) * 8, 100);

  return `
    <div class="target-pod ${podClass}" data-id="${a.id}">
      ${hasViral ? `<div class="pod-viral-tag">&#9632; VIRAL ACTIVITY DETECTED</div>` : ''}
      <div class="pod-header">
        <div class="pod-avatar">${avatarInner}</div>
        <div style="flex:1;min-width:0">
          <div class="pod-username">@${a.username.toUpperCase()}</div>
          <div class="pod-fullname">${a.full_name || '—'}</div>
          <div class="pod-status-row">
            <div class="pod-status ${statusCls}">${statusTxt}</div>
          </div>
        </div>
        <button class="pod-scan" data-id="${a.id}" data-name="${a.username}" title="Scan now">&#9654;</button>
        <button class="pod-remove" data-id="${a.id}" data-name="${a.username}" title="Remove">&#10005;</button>
      </div>
      <div class="pod-stats">
        <div class="pod-stat-item">
          <div class="pod-stat-label">FOLLOWERS</div>
          <div class="pod-stat-value">${fmt(a.followers_count) || '—'}</div>
        </div>
        <div class="pod-stat-item">
          <div class="pod-stat-label">SIGNALS</div>
          <div class="pod-stat-value" style="color:${hasViral?'var(--red)':'inherit'}">${a.total_alerts || 0}</div>
        </div>
        <div class="pod-stat-item">
          <div class="pod-stat-label">UNREAD</div>
          <div class="pod-stat-value" style="color:${a.unread_alerts?'var(--amber)':'inherit'}">${a.unread_alerts || 0}</div>
        </div>
      </div>
      <div class="pod-activity">
        <div class="pod-activity-label">
          <span>ACTIVITY INDEX</span>
          <span style="color:var(--cyan)">${(a.avg_engagement_rate||0).toFixed(2)}%</span>
        </div>
        <div class="pod-activity-bar">
          <div class="pod-activity-fill" style="width:${erPct}%"></div>
        </div>
      </div>
      <div class="pod-footer">
        <span class="pod-group">&#9670; ${(a.group_name||'DEFAULT').toUpperCase()}</span>
        <span class="pod-poll ${!a.last_polled_at ? 'never' : ''}">
          ${a.last_polled_at ? 'SCANNED ' + timeAgo(a.last_polled_at) : 'AWAITING SCAN'}
        </span>
      </div>
    </div>
  `;
}

async function addAccount() {
  const usernameEl = $('#add-username');
  const groupEl    = $('#add-group');
  const username   = usernameEl.value.trim();
  if (!username) { toast('ENTER A USERNAME', 'error'); return; }

  const btn = $('#add-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ADDING CREATOR...';

  try {
    await api('/api/accounts', {
      method: 'POST',
      body: { username, group_name: groupEl.value.trim() || 'DEFAULT' },
    });
    usernameEl.value = '';
    groupEl.value = '';
    toast(`CREATOR @${username.replace('@','').toUpperCase()} ADDED`, 'success');
    loadAccounts();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '[ ADD CREATOR ]';
  }
}

async function bulkAddAccounts() {
  const raw = $('#bulk-usernames').value.trim();
  if (!raw) { toast('PASTE SOME HANDLES FIRST', 'error'); return; }

  const group = $('#bulk-group').value.trim() || 'DEFAULT';
  const usernames = raw
    .split(/[\n,]+/)
    .map(u => u.trim().replace(/^@/, ''))
    .filter(u => u.length > 0);

  if (!usernames.length) { toast('NO VALID HANDLES FOUND', 'error'); return; }

  const btn = $('#bulk-add-btn');
  const progress = $('#bulk-progress');
  btn.disabled = true;

  let added = 0, skipped = 0;
  for (const username of usernames) {
    progress.textContent = `ADDING ${added + skipped + 1}/${usernames.length} — @${username.toUpperCase()}...`;
    try {
      await api('/api/accounts', { method: 'POST', body: { username, group_name: group } });
      added++;
    } catch (err) {
      skipped++;
    }
  }

  progress.innerHTML = `<span style="color:var(--green)">✓ ${added} ADDED</span>${skipped ? `  <span style="color:var(--text-dim)">${skipped} SKIPPED (ALREADY TRACKED)</span>` : ''}`;
  btn.disabled = false;
  $('#bulk-usernames').value = '';
  toast(`${added} CREATOR${added !== 1 ? 'S' : ''} ADDED`, 'success');
  loadAccounts();
}

async function removeAccount(id, name) {
  if (!confirm(`REMOVE CREATOR @${name.toUpperCase()} AND ALL ASSOCIATED DATA?`)) return;
  try {
    await api(`/api/accounts/${id}`, { method: 'DELETE' });
    toast(`CREATOR @${name.toUpperCase()} REMOVED`);
    loadAccounts();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function scanAccount(id, name, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await api(`/api/accounts/${id}/poll`, { method: 'POST' });
    toast(`SCANNING @${name.toUpperCase()} — RESULTS IN A FEW MINUTES`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#9654;';
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function renderSettings() {
  const el = $('#page-settings');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">MISSION <span class="accent">CONFIG</span></div>
        <div class="page-subtitle">// DETECTION PARAMETERS &amp; SYSTEM SETTINGS</div>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-row" id="settings-form">
        <div class="empty-state"><span class="spinner"></span></div>
      </div>
    </div>
  `;

  const settings = await api('/api/settings');

  $('#settings-form').innerHTML = `
    <div class="setting-item">
      <label>POLL INTERVAL (MINUTES)</label>
      <input type="number" id="s-interval" value="${settings.polling_interval_minutes || 60}" min="15" max="1440" style="max-width:180px">
      <span class="hint">// HOW OFTEN TO SCAN CREATORS. MINIMUM 15 MIN.</span>
    </div>
    <div class="setting-item">
      <label>VIRAL MULTIPLIER THRESHOLD</label>
      <input type="number" id="s-multiplier" value="${settings.viral_threshold_multiplier || 3}" min="1" max="20" step="0.5" style="max-width:180px">
      <span class="hint">// ALERT FIRES WHEN ER EXCEEDS THIS MULTIPLE OF ACCOUNT'S 30-DAY AVERAGE.</span>
    </div>
    <div class="setting-item">
      <label>VELOCITY THRESHOLD (INTERACTIONS)</label>
      <input type="number" id="s-velocity" value="${settings.velocity_threshold || 500}" min="100" style="max-width:180px">
      <span class="hint">// ALSO ALERT WHEN TOTAL INTERACTIONS (LIKES + COMMENTS + PLAYS) HITS THIS VALUE.</span>
    </div>
    <div class="setting-item">
      <label>DISCORD CHANNEL ID</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" id="s-discord-channel" value="${settings.discord_channel_id || ''}" placeholder="e.g. 1234567890123456789" style="max-width:320px">
        <button class="btn btn-cyan" id="discord-test-btn" style="padding:6px 14px;font-size:12px">[ TEST BOT ]</button>
      </div>
      <span class="hint">// DISCORD CHANNEL ID WHERE VIRAL ALERTS WILL BE POSTED. BOT TOKEN IS SET IN .ENV.
        BOT STATUS: ${settings.discord_bot_configured ? '<span style="color:#00ff88">✓ TOKEN LOADED</span>' : '<span style="color:#ff4444">✗ TOKEN MISSING — ADD DISCORD_BOT_TOKEN TO .ENV</span>'}</span>
    </div>
    <div class="setting-item">
      <label>DAILY DISCORD DIGEST</label>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;letter-spacing:0;color:var(--text);font-size:11px">
          <input type="checkbox" id="s-digest-enabled" ${settings.discord_digest_enabled === '1' ? 'checked' : ''}>
          ENABLED
        </label>
        <input type="time" id="s-digest-time" value="${settings.discord_digest_time || '09:00'}" style="max-width:130px;background:rgba(0,0,0,0.5);border:1px solid var(--border);color:var(--text);font-family:var(--font-mono);font-size:11px;padding:6px 10px">
      </div>
      <span class="hint">// SENDS A DAILY SUMMARY OF VIRAL ACTIVITY TO YOUR DISCORD CHANNEL AT THE CHOSEN TIME.</span>
    </div>
    <button class="btn btn-cyan" id="save-settings-btn">[ SAVE CONFIG ]</button>
  `;

  $('#discord-test-btn').addEventListener('click', async () => {
    const btn = $('#discord-test-btn');
    btn.disabled = true;
    btn.textContent = '[ TESTING... ]';
    try {
      const result = await api('/api/discord/test', {
        method: 'POST',
        body: { channel_id: $('#s-discord-channel').value },
      });
      if (result.ok) toast('BOT CONNECTED — CHECK YOUR CHANNEL', 'success');
      else toast(`DISCORD ERROR: ${result.error}`, 'error');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ TEST BOT ]';
    }
  });

  $('#save-settings-btn').addEventListener('click', async () => {
    const btn = $('#save-settings-btn');
    btn.disabled = true;
    try {
      await api('/api/settings', {
        method: 'POST',
        body: {
          polling_interval_minutes:   $('#s-interval').value,
          viral_threshold_multiplier: $('#s-multiplier').value,
          velocity_threshold:         $('#s-velocity').value,
          discord_channel_id:         $('#s-discord-channel').value,
          discord_digest_enabled:     $('#s-digest-enabled').checked,
          discord_digest_time:        $('#s-digest-time').value,
        },
      });
      toast('CONFIG SAVED', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ── Poll Button ───────────────────────────────────────────────────────────────

let scanAnimationInterval = null;

$('#poll-btn').addEventListener('click', async () => {
  const btn    = $('#poll-btn');
  const status = $('#poll-status');
  btn.disabled = true;

  // Animate scanning state on all pods
  $$('.target-pod').forEach(pod => pod.classList.add('scanning'));
  $$('.pod-status').forEach(s => { s.className = 'pod-status scanning'; });
  $$('.pod-avatar').forEach(a => a.classList.add('scanning'));

  let dots = 0;
  btn.innerHTML = '<span class="spinner"></span> SCANNING...';
  scanAnimationInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    status.textContent = '>> SCANNING CREATORS' + '.'.repeat(dots);
  }, 400);

  try {
    await api('/api/poll', { method: 'POST' });
    setTimeout(async () => {
      clearInterval(scanAnimationInterval);
      status.textContent = '>> SCAN COMPLETE';
      setTimeout(() => { status.textContent = ''; }, 3000);

      $$('.target-pod').forEach(pod => pod.classList.remove('scanning'));
      $$('.pod-avatar').forEach(a => a.classList.remove('scanning'));

      if (currentPage === 'dashboard') renderDashboard();
      else if (currentPage === 'competitors') loadAccounts();
      updateStats();
    }, 2500);
  } catch (err) {
    clearInterval(scanAnimationInterval);
    toast(err.message, 'error');
    status.textContent = '';
    $$('.target-pod').forEach(pod => pod.classList.remove('scanning'));
    $$('.pod-avatar').forEach(a => a.classList.remove('scanning'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="poll-icon">&#9654;</span> EXECUTE SCAN';
  }
});

// ── Command Center / Agents ───────────────────────────────────────────────────

const AGENT_DEF = {
  captain:    { label: 'THE CAPTAIN',    role: 'Quality Control & Humanizer',  station: 'DATA CORE',         cls: 'captain-theme',    rank: 'C', color: '#FF6B00' },
  strategist: { label: 'THE STRATEGIST', role: 'Viral Performance Reports',    station: 'PERFORMANCE ANALYSIS', cls: 'strategist-theme', rank: 'S', color: '#00F2FF' },
  writer:     { label: 'THE WRITER',     role: 'Caption Generator',            station: 'COMMS ARRAY',       cls: 'writer-theme',     rank: 'W', color: '#00FF88' },
  assistant:  { label: 'THE ASSISTANT',  role: 'Research & Intelligence',      station: 'INTEL HUB',         cls: 'assistant-theme',  rank: 'A', color: '#FF00A8' },
  researcher: { label: 'THE RESEARCHER', role: 'Instagram Trend Analysis',     station: 'TREND SCANNER',     cls: 'researcher-theme', rank: 'R', color: '#FF9500' },
  organizer:  { label: 'THE ORGANIZER',  role: 'Brief Compiler & Reel Ideas',  station: 'SYNTHESIS LAB',     cls: 'organizer-theme',  rank: 'O', color: '#B44FFF' },
};

const AGENT_IDLE_ACTIVITIES = {
  captain:    ['REVIEWING OUTPUTS', 'QUALITY CHECK', 'PATROLLING DECK', 'HUMANIZING DATA', 'AWAITING ORDERS'],
  strategist: ['MONITORING FEEDS', 'ANALYZING PATTERNS', 'RUNNING MODELS', 'SCANNING VECTORS', 'INDEXING CONTENT'],
  writer:     ['STUDYING CAPTIONS', 'DRAFTING HOOKS', 'TONE ANALYSIS', 'VOICE CALIBRATION', 'STYLE REVIEW'],
  assistant:  ['INDEXING DATABASE', 'CROSS-REFERENCING', 'SEARCHING INTEL', 'STANDBY MODE', 'COMPILING DATA'],
  researcher: ['SCANNING TRENDS', 'INDEXING NICHES', 'PULLING SIGNALS', 'MAPPING PATTERNS', 'SURFACING GAPS'],
  organizer:  ['COMPILING BRIEFS', 'STRUCTURING IDEAS', 'SYNTHESIZING DATA', 'DRAFTING REELS', 'ORGANIZING INTEL'],
};

const agentActivity = { captain: 'AWAITING ORDERS', strategist: 'MONITORING FEEDS', writer: 'STUDYING CAPTIONS', assistant: 'STANDBY MODE', researcher: 'SCANNING TRENDS', organizer: 'STANDBY MODE' };

function bridgeDeckHTML(accounts) {
  const stationOrder = ['captain', 'strategist', 'writer', 'assistant', 'researcher', 'organizer'];
  return `
    <div class="bridge-wrap">
      <div class="bridge-header">
        <span class="bridge-title">&#9632; THE BRIDGE // AI CREW ACTIVE</span>
        <span class="bridge-status" id="bridge-status">6 OPERATIVES ONLINE</span>
      </div>
      <div class="bridge-deck">
        <div class="station-grid">
          ${stationOrder.map(key => {
            const d = AGENT_DEF[key];
            return `
            <div class="station ${d.cls}" id="station-${key}" data-agent="${key}">
              <div class="station-label">${d.station}</div>
              <div class="agent-avatar" id="bridge-avatar-${key}" style="animation-delay:${stationOrder.indexOf(key)*0.8}s">
                <div class="agent-avatar-ring"></div>
                <div class="agent-avatar-core">${d.rank}</div>
                <div class="data-stream" id="stream-${key}"></div>
              </div>
              <div class="agent-progress" id="bridge-progress-${key}">PROCESSING...</div>
              <div class="station-name">${d.label}</div>
              <div class="holo-id">
                <div class="holo-rank">${d.label}</div>
                <div class="holo-role">${d.role}</div>
                <div class="holo-divider"></div>
                <div class="holo-process-label">CURRENT SUB-PROCESS</div>
                <div class="holo-process" id="holo-proc-${key}">${agentActivity[key]}</div>
                <div class="holo-divider"></div>
                <div class="holo-stat"><span>UPTIME</span><span>99.8%</span></div>
                <div class="holo-stat"><span>STATUS</span><span id="holo-status-${key}">IDLE</span></div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (const raw of lines) {
    let line = escapeHtml(raw)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    if (/^## (.+)/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2>${line.replace(/^## /, '')}</h2>`;
    } else if (/^### (.+)/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${line.replace(/^### /, '')}</h3>`;
    } else if (/^[•\-] (.+)/.test(line) || /^\d+\. (.+)/.test(line)) {
      const content = line.replace(/^[•\-] /, '').replace(/^\d+\. /, '');
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${content}</li>`;
    } else if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${line}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

function showOutputModal(title, output, captainNotes) {
  const overlay = $('#output-modal');
  $('#output-modal-title').textContent = title;
  $('#output-modal-body').innerHTML = renderMarkdown(output);
  if (captainNotes) {
    $('#output-modal-body').innerHTML += `
      <div class="captain-notes">
        <div class="captain-notes-label">// CAPTAIN'S NOTES</div>
        ${captainNotes}
      </div>`;
  }
  overlay.classList.remove('hidden');
}

async function renderAgents() {
  const el = $('#page-agents');
  const accounts = await api('/api/accounts');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">COMMAND <span class="accent">CENTER</span></div>
        <div class="page-subtitle">// AI AGENT NETWORK — 6 ACTIVE OPERATIVES</div>
      </div>
    </div>

    ${bridgeDeckHTML(accounts)}

    <div class="agent-grid">

      <!-- CAPTAIN -->
      <div class="agent-card" id="agent-captain">
        <div class="agent-header">
          <div class="agent-rank rank-captain">C</div>
          <div class="agent-meta">
            <div class="agent-name" style="color:var(--orange)">THE CAPTAIN</div>
            <div class="agent-role">Quality Control &amp; Humanizer</div>
          </div>
          <div class="agent-status idle" id="captain-status">STANDBY</div>
        </div>
        <div class="agent-body">
          <p style="font-size:11px;color:var(--text-dim);line-height:1.7">
            Automatically reviews every output from the Strategist and Writer before it reaches you. Removes AI-speak, adds punch, and flags issues. Can also re-review any past output on demand.
          </p>
          <div style="margin-top:12px">
            <label>RE-REVIEW PAST OUTPUT (OUTPUT ID)</label>
            <input class="agent-input" id="captain-output-id" type="number" placeholder="Output ID from history">
            <button class="btn btn-cyan" id="captain-run-btn" style="width:100%">[ DISPATCH CAPTAIN ]</button>
          </div>
        </div>
      </div>

      <!-- STRATEGIST -->
      <div class="agent-card" id="agent-strategist">
        <div class="agent-header">
          <div class="agent-rank rank-strategist">S</div>
          <div class="agent-meta">
            <div class="agent-name" style="color:var(--cyan)">THE STRATEGIST</div>
            <div class="agent-role">Viral Intelligence Reports</div>
          </div>
          <div class="agent-status idle" id="strategist-status">STANDBY</div>
        </div>
        <div class="agent-body">
          <label>REPORT WINDOW</label>
          <select class="agent-select" id="strategist-days">
            <option value="1">Last 24 Hours</option>
            <option value="7" selected>Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
          </select>
          <button class="btn btn-cyan" id="strategist-run-btn" style="width:100%">[ GENERATE REPORT ]</button>
          <div class="agent-output-panel" id="strategist-output"></div>
        </div>
      </div>

      <!-- WRITER -->
      <div class="agent-card" id="agent-writer">
        <div class="agent-header">
          <div class="agent-rank rank-writer">W</div>
          <div class="agent-meta">
            <div class="agent-name" style="color:var(--green)">THE WRITER</div>
            <div class="agent-role">Caption Generator</div>
          </div>
          <div class="agent-status idle" id="writer-status">STANDBY</div>
        </div>
        <div class="agent-body">
          <label>CREATOR PROFILE</label>
          <select class="agent-select" id="writer-username">
            <option value="">— Select a tracked account —</option>
            ${accounts.map(a => `<option value="${a.username}">@${a.username} (${(a.followers_count||0).toLocaleString()} followers)</option>`).join('')}
          </select>
          <label>CONTENT GOAL (optional)</label>
          <input class="agent-input" id="writer-goal" type="text" placeholder="e.g. promote new drop, drive DMs, build hype">
          <button class="btn btn-green" id="writer-run-btn" style="width:100%">[ WRITE CAPTIONS ]</button>
          <div class="agent-output-panel" id="writer-output"></div>
        </div>
      </div>

      <!-- ASSISTANT -->
      <div class="agent-card" id="agent-assistant">
        <div class="agent-header">
          <div class="agent-rank rank-assistant">A</div>
          <div class="agent-meta">
            <div class="agent-name" style="color:var(--magenta)">THE ASSISTANT</div>
            <div class="agent-role">Research &amp; Intelligence</div>
          </div>
          <div class="agent-status idle" id="assistant-status">STANDBY</div>
        </div>
        <div class="agent-body">
          <label>YOUR QUESTION</label>
          <textarea class="agent-input" id="assistant-question" rows="3"
            placeholder="Ask anything: strategy questions, competitor analysis, why a post went viral, hashtag research..."></textarea>
          <button class="btn btn-magenta" id="assistant-run-btn" style="width:100%">[ ASK ASSISTANT ]</button>
          <div class="agent-output-panel" id="assistant-output"></div>
        </div>
      </div>

      <!-- RESEARCHER -->
      <div class="agent-card" id="agent-researcher">
        <div class="agent-header">
          <div class="agent-rank rank-researcher">R</div>
          <div class="agent-meta">
            <div class="agent-name" style="color:#FF9500">THE RESEARCHER</div>
            <div class="agent-role">Instagram Trend Analysis</div>
          </div>
          <div class="agent-status idle" id="researcher-status">STANDBY</div>
        </div>
        <div class="agent-body">
          <label>NICHE OR TOPIC</label>
          <input class="agent-input" id="researcher-niche" type="text" placeholder="e.g. fitness, fashion, luxury cars, cooking...">
          <label>FOCUS ON CREATOR (optional)</label>
          <select class="agent-select" id="researcher-username">
            <option value="">— All tracked accounts —</option>
            ${accounts.map(a => `<option value="${a.username}">@${a.username}</option>`).join('')}
          </select>
          <button class="btn" id="researcher-run-btn" style="width:100%;background:#FF9500;color:#000;font-weight:700">[ RUN RESEARCH ]</button>
          <div class="agent-output-panel" id="researcher-output"></div>
        </div>
      </div>

      <!-- ORGANIZER -->
      <div class="agent-card" id="agent-organizer">
        <div class="agent-header">
          <div class="agent-rank rank-organizer">O</div>
          <div class="agent-meta">
            <div class="agent-name" style="color:#B44FFF">THE ORGANIZER</div>
            <div class="agent-role">Brief Compiler &amp; Reel Ideas</div>
          </div>
          <div class="agent-status idle" id="organizer-status">STANDBY</div>
        </div>
        <div class="agent-body">
          <p style="font-size:11px;color:var(--text-dim);line-height:1.7">
            Pulls the latest Researcher and Strategist outputs from the database and compiles them into a master brief with 10 ready-to-film reel ideas.
          </p>
          <label>EXTRA CONTEXT (optional)</label>
          <input class="agent-input" id="organizer-context" type="text" placeholder="e.g. launching a new product, targeting Gen Z...">
          <button class="btn" id="organizer-run-btn" style="width:100%;background:#B44FFF;color:#fff;font-weight:700">[ COMPILE BRIEF ]</button>
          <div class="agent-output-panel" id="organizer-output"></div>
        </div>
      </div>

    </div>

    <!-- History -->
    <div class="agent-history">
      <div class="agent-history-header">// AGENT OUTPUT HISTORY</div>
      <div id="agent-history-list"><div class="empty-state" style="padding:20px"><span class="spinner"></span></div></div>
    </div>

    <!-- Output Modal -->
    <div class="output-modal hidden" id="output-modal">
      <div class="output-modal-inner">
        <div class="output-modal-head">
          <span class="output-modal-title" id="output-modal-title"></span>
          <button class="modal-close" id="output-modal-close">[ CLOSE ]</button>
        </div>
        <div class="output-modal-body" id="output-modal-body"></div>
      </div>
    </div>
  `;

  loadAgentHistory();
  wireAgentButtons();
}

function loadAgentHistory() {
  api('/api/agents/history').then(rows => {
    const el = $('#agent-history-list');
    if (!rows.length) {
      el.innerHTML = '<div style="padding:20px;font-size:11px;color:var(--text-dim);text-align:center">No outputs yet — run an agent to get started.</div>';
      return;
    }
    el.innerHTML = rows.map(r => `
      <div class="history-item" data-id="${r.id}" data-agent="${r.agent}">
        <span class="history-agent ha-${r.agent}">${r.agent.toUpperCase()}</span>
        <span class="history-summary">${r.input_summary || '—'}</span>
        <span class="history-time">${timeAgo(r.created_at)}</span>
      </div>
    `).join('');

    $$('#agent-history-list .history-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        const agent = item.dataset.agent;
        api(`/api/agents/history?agent=${agent}`).then(rows => {
          const row = rows.find(r => String(r.id) === id);
          if (!row) return;
          showOutputModal(
            `// ${agent.toUpperCase()} — OUTPUT #${row.id}`,
            row.reviewed_output || row.raw_output,
            row.captain_notes
          );
        });
      });
    });
  });
}

function setAgentStatus(agent, status) {
  // Card status badge
  const el = $(`#${agent}-status`);
  if (el) {
    el.className = `agent-status ${status}`;
    el.textContent = status === 'running' ? 'RUNNING' : status === 'done' ? 'DONE' : 'STANDBY';
    $(`#agent-${agent}`)?.classList.toggle('running', status === 'running');
  }
  // Bridge deck station
  const station = $(`#station-${agent}`);
  if (station) {
    station.classList.toggle('active', status === 'running');
  }
  const holoStatus = $(`#holo-status-${agent}`);
  if (holoStatus) {
    holoStatus.textContent = status === 'running' ? 'ACTIVE' : status === 'done' ? 'COMPLETE' : 'IDLE';
    holoStatus.style.color = status === 'running' ? 'var(--cyan)' : status === 'done' ? 'var(--green)' : 'var(--text-dim)';
  }
  if (status === 'running') {
    agentActivity[agent] = 'PROCESSING REQUEST...';
    const proc = $(`#holo-proc-${agent}`);
    if (proc) proc.textContent = 'PROCESSING REQUEST...';
  }
}

function showAgentOutput(panelId, text) {
  const panel = $(`#${panelId}`);
  if (!panel) return;
  panel.innerHTML = renderMarkdown(text);
  panel.classList.add('open');
}

function wireAgentButtons() {
  // STRATEGIST
  $('#strategist-run-btn').addEventListener('click', async () => {
    const btn = $('#strategist-run-btn');
    const days = parseInt($('#strategist-days').value) || 7;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> ANALYZING...';
    setAgentStatus('strategist', 'running');
    try {
      const result = await api('/api/agents/strategist', { method: 'POST', body: { days } });
      setAgentStatus('strategist', 'done');
      showAgentOutput('strategist-output', result.reviewed);
      toast('STRATEGIST REPORT READY', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('strategist', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ GENERATE REPORT ]';
    }
  });

  // WRITER
  $('#writer-run-btn').addEventListener('click', async () => {
    const username = $('#writer-username').value;
    if (!username) return toast('Select a profile first', 'error');
    const btn = $('#writer-run-btn');
    const contentGoal = $('#writer-goal').value.trim() || null;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> WRITING...';
    setAgentStatus('writer', 'running');
    try {
      const result = await api('/api/agents/writer', { method: 'POST', body: { username, contentGoal } });
      setAgentStatus('writer', 'done');
      showAgentOutput('writer-output', result.reviewed);
      toast('CAPTIONS READY', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('writer', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ WRITE CAPTIONS ]';
    }
  });

  // ASSISTANT
  $('#assistant-run-btn').addEventListener('click', async () => {
    const question = $('#assistant-question').value.trim();
    if (!question) return toast('Enter a question first', 'error');
    const btn = $('#assistant-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> RESEARCHING...';
    setAgentStatus('assistant', 'running');
    try {
      const result = await api('/api/agents/assistant', { method: 'POST', body: { question } });
      setAgentStatus('assistant', 'done');
      showAgentOutput('assistant-output', result.answer);
      toast('RESEARCH COMPLETE', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('assistant', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ ASK ASSISTANT ]';
    }
  });

  // RESEARCHER
  $('#researcher-run-btn').addEventListener('click', async () => {
    const niche = $('#researcher-niche').value.trim();
    if (!niche) return toast('Enter a niche or topic first', 'error');
    const username = $('#researcher-username').value || null;
    const btn = $('#researcher-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> RESEARCHING...';
    setAgentStatus('researcher', 'running');
    try {
      const result = await api('/api/agents/researcher', { method: 'POST', body: { niche, username } });
      setAgentStatus('researcher', 'done');
      showAgentOutput('researcher-output', result.reviewed);
      toast('TREND RESEARCH READY', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('researcher', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ RUN RESEARCH ]';
    }
  });

  // ORGANIZER
  $('#organizer-run-btn').addEventListener('click', async () => {
    const context = $('#organizer-context').value.trim() || null;
    const btn = $('#organizer-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> COMPILING...';
    setAgentStatus('organizer', 'running');
    try {
      const result = await api('/api/agents/organizer', { method: 'POST', body: { context } });
      setAgentStatus('organizer', 'done');
      showAgentOutput('organizer-output', result.reviewed);
      toast('MASTER BRIEF READY', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('organizer', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ COMPILE BRIEF ]';
    }
  });

  // CAPTAIN (re-review)
  $('#captain-run-btn').addEventListener('click', async () => {
    const outputId = $('#captain-output-id').value;
    if (!outputId) return toast('Enter an output ID from history', 'error');
    const btn = $('#captain-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> REVIEWING...';
    setAgentStatus('captain', 'running');
    try {
      const result = await api('/api/agents/captain', { method: 'POST', body: { outputId: parseInt(outputId) } });
      setAgentStatus('captain', 'done');
      showOutputModal(`// CAPTAIN RE-REVIEW — OUTPUT #${outputId}`, result.reviewed, result.notes);
      toast('CAPTAIN REVIEW COMPLETE', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('captain', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '[ DISPATCH CAPTAIN ]';
    }
  });

  // Modal close
  $('#output-modal-close').addEventListener('click', () => {
    $('#output-modal').classList.add('hidden');
  });
  $('#output-modal').addEventListener('click', e => {
    if (e.target === $('#output-modal')) $('#output-modal').classList.add('hidden');
  });
}

// ── Nav ───────────────────────────────────────────────────────────────────────

$$('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigate(el.dataset.page);
    window.location.hash = el.dataset.page;
  });
});

window.addEventListener('hashchange', () => {
  const page = window.location.hash.replace('#', '');
  if (pages.includes(page)) navigate(page);
});

// ── Init ─────────────────────────────────────────────────────────────────────
const initPage = window.location.hash.replace('#', '') || 'dashboard';
navigate(initPage);
updateStats();
setInterval(updateStats, 30000);

// ── Starfield ─────────────────────────────────────────────────────────────────
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [], nebulas = [], W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function init() {
    stars = Array.from({ length: 220 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      speed: Math.random() * 0.12 + 0.01,
      phase: Math.random() * Math.PI * 2,
      color: Math.random() > 0.85 ? '#7000FF' : Math.random() > 0.7 ? '#00F2FF' : '#B4DCFF',
    }));
    nebulas = Array.from({ length: 4 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 180 + 80,
      hue: Math.random() > 0.5 ? '112,0,255' : '0,242,255',
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const T = t * 0.0004;

    // Nebula wisps
    nebulas.forEach(n => {
      n.phase += 0.002;
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      grd.addColorStop(0, `rgba(${n.hue},0.04)`);
      grd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    });

    // Stars
    stars.forEach(s => {
      s.phase += 0.015;
      s.y += s.speed;
      if (s.y > H) { s.y = 0; s.x = Math.random() * W; }
      const op = 0.35 + 0.55 * Math.abs(Math.sin(s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.color.replace(')', `,${op})`).replace('rgb', 'rgba').replace('#B4DCFF', `rgba(180,220,255,${op})`);
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  resize();
  init();
  window.addEventListener('resize', () => { resize(); init(); });
  requestAnimationFrame(draw);
})();

// ── Agent Behavior Loop ───────────────────────────────────────────────────────
setInterval(() => {
  for (const [key, activities] of Object.entries(AGENT_IDLE_ACTIVITIES)) {
    // Only update idle agents
    const statusEl = $(`#${key}-status`);
    if (statusEl && statusEl.classList.contains('running')) continue;

    const next = activities[Math.floor(Math.random() * activities.length)];
    agentActivity[key] = next;
    const proc = $(`#holo-proc-${key}`);
    if (proc) proc.textContent = next;
  }
}, 3500);
