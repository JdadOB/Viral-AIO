const APP_VERSION = '0.52';

// ── Utilities ────────────────────────────────────────────────────────────────

function proxyImg(url) {
  if (!url) return null;
  return '/api/img?url=' + encodeURIComponent(url);
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast${type ? ' ' + type : ''}`;
  setTimeout(() => el.classList.add('hidden'), 3500);
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmt(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function exportAlertsCSV(alerts) {
  if (!alerts.length) { toast('No data to export', 'error'); return; }
  const cols = ['id', 'username', 'group_name', 'post_type', 'post_url', 'likes_count', 'comments_count', 'plays_count', 'engagement_rate', 'multiplier', 'triggered_at'];
  const esc  = v => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const rows = [cols.join(','), ...alerts.map(a => cols.map(c => esc(a[c])).join(','))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `viral-alerts-${new Date().toISOString().slice(0,10)}.csv` });
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${alerts.length} alerts`, 'success');
}

function initials(name) {
  if (!name) return '??';
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().substring(0, 2);
}

function alertId(id) {
  return 'VRL-' + String(id).padStart(4, '0');
}

// Active client workspace (managers set this to view a client's data)
let activeClientId = null;

async function api(path, opts = {}) {
  let url = path;
  // Append ?as=CLIENT_ID for managers/admins scoping to a client workspace
  if (activeClientId && !path.startsWith('/api/admin') && !path.startsWith('/auth')) {
    url += (url.includes('?') ? '&' : '?') + 'as=' + activeClientId;
  }
  const res = await fetch(url, {
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

// ── RBAC nav config ────────────────────────────────────────────────────────────
const NAV_CONFIG = [
  { page: 'dashboard',   label: 'Intelligence Hub', icon: '◼', roles: ['admin', 'manager', 'client'],
    extras: '<span class="badge" id="unread-badge"></span>' },
  { page: 'competitors', label: 'Creator Roster',   icon: '▲', roles: ['admin', 'manager'],
    extras: '<span class="account-count" id="account-count"></span>' },
  { page: 'agents',      label: 'Command Center',   icon: '◆', roles: ['admin', 'manager', 'client'] },
  { page: 'brain',       label: 'The Brain',        icon: '⚙', roles: ['admin', 'manager'] },
  { page: 'messages',    label: 'Messages',         icon: '✉', roles: ['admin', 'manager', 'client'],
    extras: '<span class="badge" id="chat-badge"></span>' },
  { page: 'content',     label: 'Content Hub',      icon: '◉', roles: ['admin', 'manager', 'client'] },
  { page: 'settings',    label: 'Settings',         icon: '○', roles: ['admin', 'manager'] },
  { page: 'admin',       label: 'Admin',            icon: '☠', roles: ['admin'] },
];

function applyRoleNav(role) {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  const allowed = NAV_CONFIG.filter(item => item.roles.includes(role));
  nav.innerHTML = allowed.map(item => `
    <a class="nav-item" data-page="${item.page}" href="#${item.page}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-text">${item.label}</span>
      ${item.extras || ''}
    </a>
  `).join('');
  // Wire click handlers
  $$('#main-nav .nav-item').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.dataset.page);
      window.location.hash = el.dataset.page;
      if (window.innerWidth <= 600) closeSidebar?.();
    });
  });
  // Set active class on current page
  const cur = window.location.hash.replace('#', '') || 'dashboard';
  document.querySelector(`#main-nav .nav-item[data-page="${cur}"]`)?.classList.add('active');
  // Re-run stats to populate badge/count spans just created
  updateStats();
}

function applyRouteGuard(role) {
  const allowed = NAV_CONFIG.filter(i => i.roles.includes(role)).map(i => i.page);
  const fallback = allowed.includes('dashboard') ? 'dashboard' : allowed[0];
  // Guard hash changes
  window.addEventListener('hashchange', () => {
    const page = window.location.hash.replace('#', '');
    if (pages.includes(page) && !allowed.includes(page)) {
      window.location.hash = fallback;
      navigate(fallback);
    }
  });
  // Guard current page on load
  const cur = window.location.hash.replace('#', '') || fallback;
  if (pages.includes(cur) && !allowed.includes(cur)) {
    window.location.hash = fallback;
    navigate(fallback);
  }
}

async function loadClientSwitcher(role) {
  const switcherEl = document.getElementById('client-switcher');
  const selectEl   = document.getElementById('client-select');
  if (!switcherEl || !selectEl) return;
  try {
    const clients = await fetch('/api/my-clients').then(r => r.json());
    if (!clients.length) return; // no clients assigned yet
    switcherEl.style.display = 'block';
    selectEl.innerHTML = `<option value="">My Workspace</option>` +
      clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    selectEl.addEventListener('change', () => {
      activeClientId = selectEl.value ? parseInt(selectEl.value) : null;
      const label = selectEl.value
        ? clients.find(c => c.id === activeClientId)?.name
        : null;
      // Show banner when viewing a client workspace
      const banner = document.getElementById('client-banner');
      if (banner) {
        banner.textContent = label ? `Viewing workspace: ${label}` : '';
        banner.style.display = label ? 'block' : 'none';
      }
      // Reload the current page's data
      const cur = window.location.hash.replace('#', '') || 'dashboard';
      navigate(cur);
    });
  } catch { /* non-critical */ }
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

// ── Theme Toggle ─────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const icon  = $('#theme-icon');
  const label = $('#theme-label');
  if (icon)  icon.textContent  = theme === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
}

(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
})();

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ── Router ───────────────────────────────────────────────────────────────────

const pages = ['dashboard', 'competitors', 'agents', 'brain', 'messages', 'content', 'settings', 'admin'];
let currentPage = 'dashboard';

function navigate(page) {
  if (!pages.includes(page)) page = 'dashboard';
  if (currentPage === 'brain' && page !== 'brain') disposeBrainScene();
  currentPage = page;
  pages.forEach(p => {
    const el = $(`#page-${p}`);
    if (el) el.classList.toggle('hidden', p !== page);
  });
  $$('#main-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  renderPage(page);
}

function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  else if (page === 'competitors') renderCompetitors();
  else if (page === 'agents') renderAgents();
  else if (page === 'settings') renderSettings();
  else if (page === 'brain') renderBrain();
  else if (page === 'admin') renderAdmin();
  else if (page === 'messages') renderMessages();
  else if (page === 'content') renderContent();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function updateStats() {
  try {
    const s = await api('/api/stats');

    const badge = $('#unread-badge');
    if (s.unreadAlerts > 0) { badge.textContent = s.unreadAlerts; badge.classList.add('visible'); }
    else badge.classList.remove('visible');

    $('#account-count').textContent = s.totalAccounts || '';

    $('#bar-alerts').textContent   = s.totalAlerts   || 0;
    $('#bar-unread').textContent   = s.unreadAlerts  || 0;
    $('#bar-acted').textContent    = s.actedOn       || 0;
    $('#bar-briefs').textContent   = s.totalBriefs   || 0;
    $('#bar-accounts').textContent = s.totalAccounts || 0;

    return s;
  } catch { return {}; }
}

async function updateChatBadge() {
  try {
    const { unread } = await fetch('/api/chat/unread').then(r => r.json());
    const badge = $('#chat-badge');
    if (!badge) return;
    if (unread > 0) { badge.textContent = unread; badge.classList.add('visible'); }
    else badge.classList.remove('visible');
  } catch { /* non-critical */ }
}
setInterval(updateChatBadge, 5000);

// ── Ticker ────────────────────────────────────────────────────────────────────

function updateTicker(alerts = []) {
  const el = $('#ticker-text');
  if (!el) return;
  if (!alerts.length) {
    el.textContent = 'System ready — add creators and run a scan to begin tracking';
    return;
  }
  const parts = alerts.slice(0, 10).map(a =>
    `${alertId(a.id)} @${a.username} — ${a.post_type || 'Post'} — ${(a.multiplier||0).toFixed(1)}x avg — ${fmt(a.likes_count)} likes`
  );
  el.textContent = parts.join('   •   ');
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
        <div class="page-title">Intelligence <span class="accent">Hub</span></div>
        <div class="page-subtitle">Viral content detection feed</div>
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
    <button class="filter-tab ${activeFilter==='all'?'active':''}" data-f="all">All Alerts</button>
    <button class="filter-tab ${activeFilter==='unread'?'active':''}" data-f="unread">Unread</button>
    <button class="filter-tab ${activeFilter==='acted_on'?'active':''}" data-f="acted_on">Actioned</button>
    ${groups.length > 1 ? `
      <div class="sort-divider"></div>
      <button class="filter-tab group-tab ${activeGroup===''?'active':''}" data-g="">All Groups</button>
      ${groups.map(g => `<button class="filter-tab group-tab ${activeGroup===g?'active':''}" data-g="${g}">${g}</button>`).join('')}
    ` : ''}
    <div class="sort-divider"></div>
    <button class="filter-tab sort-tab ${activeSort==='latest'?'active':''}" data-s="latest">Latest</button>
    <button class="filter-tab sort-tab ${activeSort==='engagement'?'active':''}" data-s="engagement">Top Engagement</button>
    <button class="filter-tab sort-tab ${activeSort==='views'?'active':''}" data-s="views">Most Viewed</button>
    <button class="filter-tab btn-danger" id="clear-acted-btn" style="margin-left:auto;border-radius:20px">Clear Actioned</button>
    <button class="filter-tab" id="export-csv-btn" style="border-color:var(--amber);color:var(--amber)">Export CSV</button>
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
    toast('Actioned alerts cleared', 'success');
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
      <div class="stat-label">Viral Alerts</div>
      <div class="stat-value magenta">${s.totalAlerts || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Unread Intel</div>
      <div class="stat-value cyan">${s.unreadAlerts || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Actioned</div>
      <div class="stat-value green">${s.actedOn || 0}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Briefs Generated</div>
      <div class="stat-value">${s.totalBriefs || 0}</div>
    </div>
  `;
}

function renderAlerts(alerts) {
  const el = $('#alerts-list');
  if (!alerts.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No viral content detected</h3>
        <p>Add creators and run a scan to start tracking</p>
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
  const typeTag = a.post_type === 'Reel' ? 'tag-type-reel'
                : a.post_type === 'Carousel' ? 'tag-type-carousel'
                : 'tag-type-image';
  const hasBrief = !!a.brief;
  const avatarInner = a.profile_pic_url
    ? `<img src="${proxyImg(a.profile_pic_url)}" alt="">`
    : initials(a.username);

  const er = a.engagement_rate || 0;
  const erPct = Math.min(er * 8, 100);
  const contLevel = er >= 3 ? 'High' : er >= 1.5 ? 'Elevated' : er >= 0.5 ? 'Moderate' : 'Low';

  return `
    <div class="alert-card ${cardClass}" data-id="${a.id}">
      <div class="threat-banner">
        <span>${!a.viewed ? '🔴 New alert' : a.acted_on ? '✅ Actioned' : '📌 Logged'}</span>
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
              <div class="alert-username">@${a.username}</div>
              <div class="alert-followers">${fmt(a.followers_count)} followers · ${timeAgo(a.triggered_at)}</div>
            </div>
          </div>
          <div class="contamination-bar">
            <div class="contamination-label">
              <span>Engagement</span>
              <span class="level">${contLevel} — ${er.toFixed(2)}% ER</span>
            </div>
            <div class="contamination-track">
              <div class="contamination-fill" style="width:${erPct}%"></div>
            </div>
          </div>
          <div class="alert-tags">
            <span class="tag ${typeTag}">${(a.post_type||'Post')}</span>
            ${a.multiplier >= 1 ? `<span class="tag tag-multiplier">▲ ${a.multiplier.toFixed(1)}x avg</span>` : ''}
            ${a.acted_on ? `<span class="tag tag-acted">Actioned</span>` : ''}
          </div>
          <div class="alert-stats">
            <span>❤️ ${fmt(a.likes_count)}</span>
            <span>💬 ${fmt(a.comments_count)}</span>
            ${a.plays_count > 0 ? `<span>▶ ${fmt(a.plays_count)} plays</span>` : ''}
          </div>
          <div class="alert-actions">
            ${!hasBrief
              ? `<button class="btn btn-magenta" data-action="brief" data-id="${a.id}">Generate Brief</button>`
              : `<button class="btn btn-cyan" data-action="toggle-brief" data-id="${a.id}">View Brief</button>`}
            ${a.post_url ? `<a class="btn btn-dim" href="${a.post_url}" target="_blank">View Post</a>` : ''}
            ${!a.acted_on
              ? `<button class="btn btn-green" data-action="act" data-id="${a.id}">Mark Actioned</button>`
              : `<button class="btn btn-dim" data-action="dismiss" data-id="${a.id}">Dismiss</button>`}
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
  // Support both new flat JSON shape and legacy { sections, raw } shape
  const s = brief.hookAnalysis ? brief : (brief.sections || {});
  const sections = [
    { key: 'hookAnalysis',        label: 'Hook Analysis' },
    { key: 'formatBlueprint',     label: 'Format Blueprint' },
    { key: 'captionFramework',    label: 'Caption Framework' },
    { key: 'hashtagStrategy',     label: 'Hashtag Strategy' },
    { key: 'postingWindow',       label: 'Posting Window' },
    { key: 'differentiationTips', label: 'Differentiation Tips' },
  ];

  const rendered = sections.filter(sec => s[sec.key]).map(sec => `
    <div class="brief-section">
      <div class="brief-section-title">${sec.label}</div>
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
    btn.innerHTML = '<span class="spinner"></span> Generating...';
    const panel = $(`#brief-${id}`);
    panel.innerHTML = '<div class="brief-loading">Claude AI is analyzing this post and generating a content brief...</div>';
    panel.classList.add('open');
    api(`/api/alerts/${id}/viewed`, { method: 'PATCH' }).catch(() => {});

    try {
      const brief = await api(`/api/alerts/${id}/brief`, { method: 'POST' });
      panel.innerHTML = briefHTML(brief);
      btn.innerHTML = 'View Brief';
      btn.dataset.action = 'toggle-brief';
      btn.className = 'btn btn-cyan';
      btn.disabled = false;
      updateStats();
      toast('Brief generated', 'success');
    } catch (err) {
      panel.innerHTML = `<div class="brief-loading" style="color:var(--red)">Error: ${err.message}</div>`;
      btn.innerHTML = 'Generate Brief';
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
    card.querySelector('.threat-banner').innerHTML = `<span>✅ Actioned</span><span class="threat-id">${card.querySelector('.threat-id').textContent}</span>`;
    btn.dataset.action = 'dismiss';
    btn.className = 'btn btn-dim';
    btn.textContent = 'Dismiss';
    updateStats();
    toast('Marked as actioned', 'success');
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
    toast('Alert dismissed', 'success');
  }
}

// ── Competitors ───────────────────────────────────────────────────────────────

let selectMode = false;
let selectedIds = new Set();

async function renderCompetitors() {
  const el = $('#page-competitors');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Creator <span class="accent">Roster</span></div>
        <div class="page-subtitle">Tracked creator registry</div>
      </div>
    </div>

    <!-- Add creator form -->
    <div class="add-account-form">
      <div class="input-row">
        <div class="input-group" style="max-width:220px">
          <label>Instagram Handle</label>
          <input type="text" id="add-username" placeholder="@username">
        </div>
        <div class="input-group" style="max-width:200px">
          <label>Group</label>
          <input type="text" id="add-group" placeholder="e.g. Tier 1 Clients" list="group-suggestions">
          <datalist id="group-suggestions"></datalist>
        </div>
        <div style="padding-top:22px">
          <button class="btn btn-accent" id="add-btn">Add Creator</button>
        </div>
        <div style="padding-top:22px">
          <a href="/scraper.html" target="_blank" class="btn btn-magenta">18+ Bypass</a>
        </div>
        <div style="padding-top:22px">
          <button class="btn" id="bulk-toggle-btn" style="border-color:var(--amber);color:var(--amber)">Bulk Add</button>
        </div>
      </div>
      <div id="bulk-add-panel" style="display:none;margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div class="input-row" style="align-items:flex-end;gap:12px">
          <div class="input-group" style="flex:1;max-width:400px">
            <label>Handles — one per line or comma separated</label>
            <textarea id="bulk-usernames" rows="4" class="agent-input" placeholder="@creator1&#10;@creator2&#10;creator3, creator4"></textarea>
          </div>
          <div class="input-group" style="max-width:200px">
            <label>Group (applies to all)</label>
            <input type="text" id="bulk-group" class="agent-input" placeholder="e.g. Competitors">
          </div>
          <div>
            <button class="btn btn-accent" id="bulk-add-btn">Add All</button>
          </div>
        </div>
        <div id="bulk-progress" style="font-size:12px;color:var(--text-sub);margin-top:8px"></div>
      </div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:10px">Use <strong style="color:var(--magenta)">18+ Bypass</strong> for age-restricted profiles that Apify cannot access.</div>
    </div>

    <!-- Group management panel -->
    <div class="group-panel" id="group-panel">
      <div class="group-panel-header" id="group-panel-toggle">
        <span style="font-weight:600;font-size:13px">Manage Groups</span>
        <span style="font-size:11px;color:var(--text-sub)" id="group-panel-caret">▼ Expand</span>
      </div>
      <div id="group-panel-body" style="display:none;padding:16px;border-top:1px solid var(--border)">
        <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end">
          <div class="input-group" style="max-width:220px">
            <label>New Group Name</label>
            <input type="text" id="new-group-name" placeholder="e.g. VIP Clients">
          </div>
          <button class="btn btn-accent" id="create-group-btn">Create Group</button>
        </div>
        <div id="group-list" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>
    </div>

    <!-- Bulk action bar (shown in select mode) -->
    <div id="bulk-action-bar" class="bulk-action-bar" style="display:none">
      <span id="select-count" style="font-size:13px;font-weight:600;color:var(--text-main)">0 selected</span>
      <button class="btn btn-danger" id="delete-selected-btn">Delete Selected</button>
      <button class="btn" id="cancel-select-btn">Cancel</button>
    </div>

    <!-- Toolbar -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div id="roster-filter-tabs" class="filter-tabs" style="margin-bottom:0"></div>
      <button class="btn" id="select-mode-btn" style="border-color:var(--border-strong);white-space:nowrap">Select</button>
    </div>

    <div id="targets-grid" class="targets-grid">
      <div class="empty-state"><span class="spinner"></span></div>
    </div>
  `;

  // Reset selection state
  selectMode = false;
  selectedIds = new Set();

  $('#add-btn').addEventListener('click', addAccount);
  $('#add-username').addEventListener('keydown', e => { if (e.key === 'Enter') addAccount(); });

  $('#bulk-toggle-btn').addEventListener('click', () => {
    const panel = $('#bulk-add-panel');
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    $('#bulk-toggle-btn').textContent = open ? 'Bulk Add' : 'Hide Bulk';
  });

  $('#bulk-add-btn').addEventListener('click', bulkAddAccounts);

  // Group panel toggle
  $('#group-panel-toggle').addEventListener('click', () => {
    const body = $('#group-panel-body');
    const caret = $('#group-panel-caret');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    caret.textContent = open ? '▼ Expand' : '▲ Collapse';
    if (!open) loadGroupPanel();
  });

  // Create group
  $('#create-group-btn').addEventListener('click', async () => {
    const name = $('#new-group-name').value.trim();
    if (!name) return toast('Enter a group name', 'error');
    await api('/api/groups', { method: 'POST', body: { name } });
    $('#new-group-name').value = '';
    toast(`Group "${name}" created`, 'success');
    loadGroupPanel();
    loadAccounts();
  });

  // Select mode
  $('#select-mode-btn').addEventListener('click', () => {
    selectMode = !selectMode;
    selectedIds = new Set();
    $('#select-mode-btn').textContent = selectMode ? 'Cancel Select' : 'Select';
    $('#bulk-action-bar').style.display = selectMode ? 'flex' : 'none';
    loadAccounts();
  });

  $('#delete-selected-btn')?.addEventListener('click', async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} creator${selectedIds.size !== 1 ? 's' : ''} and all their data?`)) return;
    try {
      const result = await api('/api/accounts/bulk-delete', { method: 'POST', body: { ids: [...selectedIds] } });
      toast(`${result.deleted} creator${result.deleted !== 1 ? 's' : ''} deleted`, 'success');
      selectMode = false;
      selectedIds = new Set();
      $('#bulk-action-bar').style.display = 'none';
      $('#select-mode-btn').textContent = 'Select';
      loadAccounts();
      updateStats();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#cancel-select-btn')?.addEventListener('click', () => {
    selectMode = false;
    selectedIds = new Set();
    $('#bulk-action-bar').style.display = 'none';
    $('#select-mode-btn').textContent = 'Select';
    loadAccounts();
  });

  loadAccounts();
}

async function loadGroupPanel() {
  const [groups, accounts] = await Promise.all([api('/api/groups'), api('/api/accounts')]);
  const el = $('#group-list');
  if (!el) return;

  // Keep datalist fresh for the add-creator input
  const dl = $('#group-suggestions');
  if (dl) dl.innerHTML = groups.map(g => `<option value="${g.group_name}">`).join('');

  if (!groups.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-sub);padding:8px 0">No groups yet — type a group name above and click Create Group.</div>';
    return;
  }

  el.innerHTML = groups.map(g => {
    const members = accounts.filter(a => a.group_name === g.group_name);
    const groupOptions = groups.map(gg =>
      `<option value="${gg.group_name}" ${gg.group_name === g.group_name ? 'selected' : ''}>${gg.group_name}</option>`
    ).join('');

    return `
      <div class="group-row">
        <div class="group-row-header">
          <span class="group-name-badge">${g.group_name}</span>
          <span style="font-size:12px;color:var(--text-sub)">${g.count} creator${g.count !== 1 ? 's' : ''}</span>
          ${g.group_name !== 'Default' ? `<button class="btn btn-danger" style="padding:3px 10px;font-size:11px;margin-left:auto" data-delete-group="${g.group_name}">Delete</button>` : ''}
        </div>
        ${members.length ? `
          <div class="group-members-list">
            ${members.map(a => `
              <div class="group-member-row">
                <span style="font-size:13px;color:var(--text-main);min-width:0;overflow:hidden;text-overflow:ellipsis">@${a.username}</span>
                <select class="group-member-select" data-id="${a.id}" title="Move to group">
                  ${groupOptions}
                </select>
              </div>
            `).join('')}
          </div>
        ` : `<div style="font-size:12px;color:var(--text-dim);padding:6px 0">No creators in this group yet.</div>`}
      </div>
    `;
  }).join('');

  el.querySelectorAll('.group-member-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const newGroup = sel.value;
      try {
        await api(`/api/accounts/${sel.dataset.id}`, { method: 'PATCH', body: { group_name: newGroup } });
        toast('Creator moved', 'success');
        loadGroupPanel();
        loadAccounts();
      } catch (err) {
        toast(err.message, 'error');
        sel.value = sel.querySelector('option[selected]')?.value || sel.options[0].value;
      }
    });
  });

  el.querySelectorAll('[data-delete-group]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.deleteGroup;
      if (!confirm(`Delete group "${name}"? Its creators will be moved to Default.`)) return;
      await api(`/api/groups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      toast(`Group "${name}" deleted`, 'success');
      loadGroupPanel();
      loadAccounts();
    });
  });
}

let activeRosterGroup = '';

async function loadAccounts() {
  try {
    const accounts = await api('/api/accounts');
    const grid = $('#targets-grid');

    // Populate group filter tabs
    const groups = [...new Set(accounts.map(a => a.group_name).filter(Boolean))].sort();
    const tabsEl = $('#roster-filter-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = `
        <button class="filter-tab ${activeRosterGroup===''?'active':''}" data-rg="">All</button>
        ${groups.map(g => `<button class="filter-tab ${activeRosterGroup===g?'active':''}" data-rg="${g}">${g}</button>`).join('')}
      `;
      tabsEl.querySelectorAll('[data-rg]').forEach(btn => {
        btn.addEventListener('click', () => { activeRosterGroup = btn.dataset.rg; loadAccounts(); });
      });
    }

    // Populate group suggestions datalist
    const dl = $('#group-suggestions');
    if (dl) dl.innerHTML = groups.map(g => `<option value="${g}">`).join('');

    const filtered = activeRosterGroup ? accounts.filter(a => a.group_name === activeRosterGroup) : accounts;

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">👥</div>
          <h3>${accounts.length ? 'No creators in this group' : 'Creator roster is empty'}</h3>
          <p>${accounts.length ? 'Switch groups or add creators to this group.' : 'Add an Instagram handle above to start tracking'}</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(a => targetPodHTML(a)).join('');

    if (selectMode) {
      grid.querySelectorAll('.target-pod').forEach(pod => {
        const id = parseInt(pod.dataset.id);
        pod.classList.add('selectable');
        if (selectedIds.has(id)) pod.classList.add('selected');
        pod.addEventListener('click', () => {
          if (selectedIds.has(id)) selectedIds.delete(id);
          else selectedIds.add(id);
          pod.classList.toggle('selected', selectedIds.has(id));
          const countEl = $('#select-count');
          if (countEl) countEl.textContent = `${selectedIds.size} selected`;
        });
      });
    } else {
      grid.querySelectorAll('.pod-scan').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); scanAccount(btn.dataset.id, btn.dataset.name, btn); });
      });
      grid.querySelectorAll('.pod-remove').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); removeAccount(btn.dataset.id, btn.dataset.name); });
      });
    }

    updateStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function targetPodHTML(a) {
  const hasViral   = a.total_alerts > 0;
  const podClass   = hasViral ? 'has-viral' : '';
  const statusTxt  = hasViral ? 'Viral Active' : 'Monitoring';
  const statusCls  = hasViral ? 'viral' : 'idle';
  const avatarInner = a.profile_pic_url ? `<img src="${proxyImg(a.profile_pic_url)}" alt="">` : initials(a.username);
  const erPct      = Math.min((a.avg_engagement_rate || 0) * 8, 100);

  return `
    <div class="target-pod ${podClass}" data-id="${a.id}">
      ${hasViral ? `<div class="pod-viral-tag">🔥 Viral activity detected</div>` : ''}
      <div class="pod-header">
        <div class="pod-avatar">${avatarInner}</div>
        <div style="flex:1;min-width:0">
          <div class="pod-username">@${a.username}</div>
          <div class="pod-fullname">${a.full_name || '—'}</div>
          <div class="pod-status-row">
            <div class="pod-status ${statusCls}">${statusTxt}</div>
          </div>
        </div>
        <button class="pod-scan" data-id="${a.id}" data-name="${a.username}" title="Scan now">▶</button>
        <button class="pod-remove" data-id="${a.id}" data-name="${a.username}" title="Remove">✕</button>
      </div>
      <div class="pod-stats">
        <div class="pod-stat-item">
          <div class="pod-stat-label">Followers</div>
          <div class="pod-stat-value">${fmt(a.followers_count) || '—'}</div>
        </div>
        <div class="pod-stat-item">
          <div class="pod-stat-label">Alerts</div>
          <div class="pod-stat-value" style="color:${hasViral?'var(--red)':'inherit'}">${a.total_alerts || 0}</div>
        </div>
        <div class="pod-stat-item">
          <div class="pod-stat-label">Unread</div>
          <div class="pod-stat-value" style="color:${a.unread_alerts?'var(--amber)':'inherit'}">${a.unread_alerts || 0}</div>
        </div>
      </div>
      <div class="pod-activity">
        <div class="pod-activity-label">
          <span>Avg Engagement</span>
          <span style="color:var(--accent)">${(a.avg_engagement_rate||0).toFixed(2)}%</span>
        </div>
        <div class="pod-activity-bar">
          <div class="pod-activity-fill" style="width:${erPct}%"></div>
        </div>
      </div>
      <div class="pod-footer">
        <span class="pod-group">${(a.group_name||'Default')}</span>
        <span class="pod-poll ${!a.last_polled_at ? 'never' : ''}">
          ${a.last_polled_at ? 'Scanned ' + timeAgo(a.last_polled_at) : 'Awaiting scan'}
        </span>
      </div>
    </div>
  `;
}

async function addAccount() {
  const usernameEl = $('#add-username');
  const groupEl    = $('#add-group');
  const username   = usernameEl.value.trim();
  if (!username) { toast('Enter a username', 'error'); return; }

  const btn = $('#add-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Adding...';

  try {
    await api('/api/accounts', {
      method: 'POST',
      body: { username, group_name: groupEl.value.trim() || 'Default' },
    });
    usernameEl.value = '';
    groupEl.value = '';
    toast(`@${username.replace('@','')} added`, 'success');
    loadAccounts();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Creator';
  }
}

async function bulkAddAccounts() {
  const raw = $('#bulk-usernames').value.trim();
  if (!raw) { toast('Paste some handles first', 'error'); return; }

  const group = $('#bulk-group').value.trim() || 'Default';
  const usernames = raw
    .split(/[\n,]+/)
    .map(u => u.trim().replace(/^@/, ''))
    .filter(u => u.length > 0);

  if (!usernames.length) { toast('No valid handles found', 'error'); return; }

  const btn = $('#bulk-add-btn');
  const progress = $('#bulk-progress');
  btn.disabled = true;

  let added = 0, skipped = 0;
  for (const username of usernames) {
    progress.textContent = `Adding ${added + skipped + 1}/${usernames.length} — @${username}...`;
    try {
      await api('/api/accounts', { method: 'POST', body: { username, group_name: group } });
      added++;
    } catch (err) {
      skipped++;
    }
  }

  progress.innerHTML = `<span style="color:var(--green)">✓ ${added} added</span>${skipped ? `  <span style="color:var(--text-dim)">${skipped} skipped (already tracked)</span>` : ''}`;
  btn.disabled = false;
  $('#bulk-usernames').value = '';
  toast(`${added} creator${added !== 1 ? 's' : ''} added`, 'success');
  loadAccounts();
}

async function removeAccount(id, name) {
  if (!confirm(`Remove @${name} and all associated data?`)) return;
  try {
    await api(`/api/accounts/${id}`, { method: 'DELETE' });
    toast(`@${name} removed`);
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
    toast(`Scanning @${name} — results in a few minutes`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '▶';
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function renderSettings() {
  const el = $('#page-settings');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Detection parameters & system configuration</div>
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
      <label>Poll Interval (minutes)</label>
      <input type="number" id="s-interval" value="${settings.polling_interval_minutes || 60}" min="15" max="1440" style="max-width:180px">
      <span class="hint">How often to scan creators. Minimum 15 minutes.</span>
    </div>
    <div class="setting-item">
      <label>Viral Multiplier Threshold</label>
      <input type="number" id="s-multiplier" value="${settings.viral_threshold_multiplier || 3}" min="1" max="20" step="0.5" style="max-width:180px">
      <span class="hint">Alert fires when engagement rate exceeds this multiple of the account's 30-day average.</span>
    </div>
    <div class="setting-item">
      <label>Velocity Threshold (interactions)</label>
      <input type="number" id="s-velocity" value="${settings.velocity_threshold || 500}" min="100" style="max-width:180px">
      <span class="hint">Also alert when total interactions (likes + comments + plays) hits this value.</span>
    </div>
    <div class="setting-item">
      <label>Discord Channel ID</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" id="s-discord-channel" value="${settings.discord_channel_id || ''}" placeholder="e.g. 1234567890123456789" style="max-width:320px">
        <button class="btn btn-cyan" id="discord-test-btn" style="padding:7px 14px;white-space:nowrap">Test Bot</button>
      </div>
      <span class="hint">Discord channel ID where viral alerts will be posted. Bot status: ${settings.discord_bot_configured ? '<span style="color:var(--green)">✓ Token loaded</span>' : '<span style="color:var(--red)">✗ Token missing — add DISCORD_BOT_TOKEN to .env</span>'}</span>
    </div>
    <div class="setting-item">
      <label>Daily Discord Digest</label>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;letter-spacing:0;color:var(--text-main);font-size:13px;text-transform:none;font-weight:400">
          <input type="checkbox" id="s-digest-enabled" ${settings.discord_digest_enabled === '1' ? 'checked' : ''} style="width:auto">
          Enabled
        </label>
        <input type="time" id="s-digest-time" value="${settings.discord_digest_time || '09:00'}" style="max-width:130px">
      </div>
      <span class="hint">Sends a daily summary of viral activity to your Discord channel at the chosen time.</span>
    </div>
    <button class="btn btn-accent" id="save-settings-btn">Save Settings</button>
  `;

  $('#discord-test-btn').addEventListener('click', async () => {
    const btn = $('#discord-test-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Testing...';
    try {
      const result = await api('/api/discord/test', {
        method: 'POST',
        body: { channel_id: $('#s-discord-channel').value },
      });
      if (result.ok) toast('Bot connected — check your channel', 'success');
      else toast(`Discord error: ${result.error}`, 'error');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Test Bot';
    }
  });

  $('#save-settings-btn').addEventListener('click', async () => {
    const btn = $('#save-settings-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving...';
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
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
    }
  });
}

// ── Poll Button ───────────────────────────────────────────────────────────────

let scanAnimationInterval = null;

$('#poll-btn').addEventListener('click', async () => {
  const btn    = $('#poll-btn');
  const status = $('#poll-status');
  btn.disabled = true;

  $$('.target-pod').forEach(pod => pod.classList.add('scanning'));
  $$('.pod-status').forEach(s => { s.className = 'pod-status scanning'; });
  $$('.pod-avatar').forEach(a => a.classList.add('scanning'));

  let dots = 0;
  btn.innerHTML = '<span class="spinner"></span> Scanning...';
  scanAnimationInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    status.textContent = 'Scanning creators' + '.'.repeat(dots);
  }, 400);

  try {
    await api('/api/poll', { method: 'POST' });
    setTimeout(async () => {
      clearInterval(scanAnimationInterval);
      status.textContent = 'Scan complete';
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
    btn.innerHTML = '<span class="poll-icon">▶</span> Execute Scan';
  }
});

// ── Command Center / Agents ───────────────────────────────────────────────────

// Bulk caption upload state — reset each time the agents page is rendered
let _bulkFiles = [];
let _bulkResults = null;
let _bulkThumbnails = {}; // filename → data URL

const AGENT_DEF = {
  captain:    { label: 'The Captain',    role: 'Quality Control & Humanizer', icon: 'C', color: '#FF9F0A', bg: 'rgba(255,159,10,0.12)' },
  strategist: { label: 'The Strategist', role: 'Viral Performance Reports',   icon: 'S', color: '#32ADE6', bg: 'rgba(50,173,230,0.12)' },
  writer:     { label: 'The Writer',     role: 'Caption Generator',           icon: 'W', color: '#30D158', bg: 'rgba(48,209,88,0.12)' },
  assistant:  { label: 'The Assistant',  role: 'Research & Intelligence',     icon: 'A', color: '#FF375F', bg: 'rgba(255,55,95,0.12)' },
  ideator:    { label: 'The Ideator',    role: 'Reel & TikTok Idea Generator',icon: 'I', color: '#FF6B6B', bg: 'rgba(255,107,107,0.12)' },
};

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
        <div class="captain-notes-label">Captain's Notes</div>
        ${captainNotes}
      </div>`;
  }
  overlay.classList.remove('hidden');
}

async function renderAgents() {
  _bulkFiles = [];
  _bulkResults = null;
  _bulkThumbnails = {};
  const el = $('#page-agents');
  const accounts = await api('/api/accounts');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Command <span class="accent">Center</span></div>
        <div class="page-subtitle">AI agent network — 6 active agents</div>
      </div>
    </div>

    <div class="agent-grid">

      <!-- CAPTAIN -->
      <div class="agent-card" id="agent-captain">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.captain.color};--icon-bg:${AGENT_DEF.captain.bg}">C</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.captain.label}</div>
            <div class="agent-role">${AGENT_DEF.captain.role}</div>
          </div>
          <div class="agent-status idle" id="captain-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <p>Automatically reviews every output from the Strategist and Writer before it reaches you. Removes AI-speak, adds punch, and flags issues. Can also re-review any past output on demand.</p>
          <label>Re-review past output (Output ID)</label>
          <input class="agent-input" id="captain-output-id" type="number" placeholder="Output ID from history">
          <button class="btn btn-accent" id="captain-run-btn" style="width:100%;margin-top:10px">Dispatch Captain</button>
        </div>
      </div>

      <!-- STRATEGIST -->
      <div class="agent-card" id="agent-strategist">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.strategist.color};--icon-bg:${AGENT_DEF.strategist.bg}">S</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.strategist.label}</div>
            <div class="agent-role">${AGENT_DEF.strategist.role}</div>
          </div>
          <div class="agent-status idle" id="strategist-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <label>Report Window</label>
          <select class="agent-select" id="strategist-days">
            <option value="1">Last 24 Hours</option>
            <option value="7" selected>Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
          </select>
          <button class="btn btn-accent" id="strategist-run-btn" style="width:100%;margin-top:10px">Generate Report</button>
          <div class="agent-output-panel" id="strategist-output"></div>
        </div>
      </div>

      <!-- WRITER -->
      <div class="agent-card" id="agent-writer">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.writer.color};--icon-bg:${AGENT_DEF.writer.bg}">W</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.writer.label}</div>
            <div class="agent-role">${AGENT_DEF.writer.role}</div>
          </div>
          <div class="agent-status idle" id="writer-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <label>Creator Profile</label>
          <select class="agent-select" id="writer-username">
            <option value="">— Select a tracked account —</option>
            ${accounts.map(a => `<option value="${a.username}" data-account-id="${a.id}">@${a.username} (${(a.followers_count||0).toLocaleString()} followers)</option>`).join('')}
          </select>
          <div id="writer-sheet-status" style="margin-top:6px"></div>
          <label>Content Goal (optional)</label>
          <input class="agent-input" id="writer-goal" type="text" placeholder="e.g. promote new drop, drive DMs, build hype">
          <button class="btn btn-accent" id="writer-run-btn" style="width:100%;margin-top:10px;background:var(--green);border-color:var(--green)">Write Captions</button>
          <div class="agent-output-panel" id="writer-output"></div>
        </div>
      </div>

      <!-- ASSISTANT -->
      <div class="agent-card" id="agent-assistant">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.assistant.color};--icon-bg:${AGENT_DEF.assistant.bg}">A</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.assistant.label}</div>
            <div class="agent-role">${AGENT_DEF.assistant.role}</div>
          </div>
          <div class="agent-status idle" id="assistant-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <label>Your Question</label>
          <textarea class="agent-input" id="assistant-question" rows="3"
            placeholder="Ask anything: strategy questions, competitor analysis, why a post went viral, hashtag research..."></textarea>
          <button class="btn btn-accent" id="assistant-run-btn" style="width:100%;margin-top:10px;background:var(--magenta);border-color:var(--magenta)">Ask Assistant</button>
          <div class="agent-output-panel" id="assistant-output"></div>
        </div>
      </div>

      <!-- IDEATOR -->
      <div class="agent-card" id="agent-ideator">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.ideator.color};--icon-bg:${AGENT_DEF.ideator.bg}">I</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.ideator.label}</div>
            <div class="agent-role">${AGENT_DEF.ideator.role}</div>
          </div>
          <div class="agent-status idle" id="ideator-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <p>Analyzes your tracked creators by group and generates 15 ready-to-film reel and TikTok ideas tailored to their specific niche, voice, and what's already working in their content.</p>
          <label>Creator Group</label>
          <select class="agent-select" id="ideator-group">
            <option value="">— All creators —</option>
            ${[...new Set(accounts.map(a => a.group_name).filter(Boolean))].sort().map(g => `<option value="${g}">${g}</option>`).join('')}
          </select>
          <button class="btn btn-accent" id="ideator-run-btn" style="width:100%;margin-top:10px;background:#FF6B6B;border-color:#FF6B6B">Generate Ideas</button>
          <div class="agent-output-panel" id="ideator-output"></div>
        </div>
      </div>

    </div>

    <!-- ── BULK VIDEO CAPTIONS ────────────────────────────────────────── -->
    <div class="caption-module-section">
      <div class="caption-section-header">
        <div class="caption-section-title">Bulk Video <span class="accent">Captions</span></div>
        <div class="caption-section-sub">Upload up to 10 .MOV files — 3 creator-voice captions generated per video via The Brain</div>
      </div>

      <div class="agent-card" id="agent-bulk">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:var(--purple);--icon-bg:rgba(191,90,242,0.12)">B</div>
          <div class="agent-meta">
            <div class="agent-name">Bulk Video Captions</div>
            <div class="agent-role">Context injection from The Brain · 3 unique captions per video</div>
          </div>
          <div class="agent-status idle" id="bulk-status"></div>
        </div>
        <div class="agent-body">
          <label>Creator Profile</label>
          <select class="agent-select" id="bulk-username">
            <option value="">— Select a tracked account —</option>
            ${accounts.map(a => `<option value="${a.username}" data-account-id="${a.id}">@${a.username} (${(a.followers_count||0).toLocaleString()} followers)</option>`).join('')}
          </select>
          <div id="bulk-sheet-status" style="margin-top:6px"></div>

          <label style="margin-top:14px">Upload Videos</label>
          <div class="video-dropzone" id="video-dropzone">
            <div class="dropzone-icon">▲</div>
            <div class="dropzone-title">Drop .MOV files here or <span class="dropzone-link">click to browse</span></div>
            <div class="dropzone-hint">Max 10 videos per batch · .MOV format only · 500 MB max per file</div>
            <input type="file" id="video-file-input" accept=".mov,video/quicktime" multiple style="display:none">
          </div>

          <div id="video-file-list" class="video-file-list"></div>
          <div id="bulk-error-msg" class="bulk-error-msg" style="display:none"></div>

          <button class="btn btn-accent" id="bulk-generate-btn"
            style="width:100%;margin-top:14px;background:var(--purple);border-color:var(--purple)">
            Generate Captions
          </button>
        </div>
      </div>

      <div id="bulk-caption-results" class="bulk-caption-results" style="display:none"></div>
    </div>

    <!-- ── THE IDEATOR ─────────────────────────────────────────────────── -->
    <div class="caption-module-section">
      <div class="caption-section-header">
        <div class="caption-section-title">The <span class="accent">Ideator</span></div>
        <div class="caption-section-sub">Constraint-based Reel &amp; TikTok concepts — Low-Hanging Fruit · B-Roll Heavy · Engagement Bait</div>
      </div>

      <div class="agent-card" id="agent-ideator-v2">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:#FF6B6B;--icon-bg:rgba(255,107,107,0.12)">I</div>
          <div class="agent-meta">
            <div class="agent-name">The Ideator</div>
            <div class="agent-role">3 constraint-typed ideas · Hook · Concept · CTA · Trend Alignment</div>
          </div>
          <div class="agent-status idle" id="ideator-v2-status"></div>
        </div>
        <div class="agent-body">
          <p>Generates 3 ready-to-film Reel/TikTok concepts built around a specific creator's Brain profile. Each idea is production-typed — easy talking head, cinematic B-roll, or comment-driving engagement bait — so there's a concept for every filming day.</p>
          <label>Creator Profile</label>
          <select class="agent-select" id="ideator-v2-username">
            <option value="">— Select a creator —</option>
            ${accounts.map(a => `<option value="${a.username}">@${a.username} (${(a.followers_count||0).toLocaleString()} followers)</option>`).join('')}
          </select>
          <button class="btn btn-accent" id="ideator-v2-run-btn"
            style="width:100%;margin-top:14px;background:#FF6B6B;border-color:#FF6B6B">
            Generate Ideas
          </button>
        </div>
      </div>

      <div id="ideator-v2-output" class="ideator-v2-output" style="display:none"></div>
    </div>

    <!-- History -->
    <div class="agent-history">
      <div class="agent-history-header">Agent Output History</div>
      <div id="agent-history-list"><div class="empty-state" style="padding:20px"><span class="spinner"></span></div></div>
    </div>

    <!-- Output Modal -->
    <div class="output-modal hidden" id="output-modal">
      <div class="output-modal-inner">
        <div class="output-modal-head">
          <span class="output-modal-title" id="output-modal-title"></span>
          <button class="modal-close" id="output-modal-close">Close</button>
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
      el.innerHTML = '<div style="padding:20px;font-size:13px;color:var(--text-sub);text-align:center">No outputs yet — run an agent to get started.</div>';
      return;
    }
    el.innerHTML = rows.map(r => `
      <div class="history-item" data-id="${r.id}" data-agent="${r.agent}">
        <span class="history-agent ha-${r.agent}">${r.agent}</span>
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
            `${agent} — Output #${row.id}`,
            row.reviewed_output || row.raw_output,
            row.captain_notes
          );
        });
      });
    });
  });
}

function setAgentStatus(agent, status) {
  const el = $(`#${agent}-status`);
  if (el) {
    el.className = `agent-status ${status}`;
    $(`#agent-${agent}`)?.classList.toggle('running', status === 'running');
  }
}

// ── Google Sheets Export Button ───────────────────────────────────────────────

function addSheetsExportButton(panelId, outputId, username, ccountId) {
  const panel = $(`#${panelId}`);
  if (!panel || !outputId) return;

  // Remove existing export button if any
  panel.querySelector('.sheets-export-btn-wrap')?.remove();

  const wrap = document.createElement('div');
  wrap.className = 'sheets-export-btn-wrap';
  wrap.style.cssText = 'margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap';

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.style.cssText = 'border-color:var(--green);color:var(--green);display:flex;align-items:center;gap:6px';
  btn.innerHTML = '📊 Export to Google Sheet';

  // Date picker for tab override
  const datePicker = document.createElement('input');
  datePicker.type = 'date';
  datePicker.className = 'agent-input';
  datePicker.style.cssText = 'max-width:160px;font-size:12px;padding:6px 10px';
  datePicker.value = new Date().toISOString().slice(0, 10);
  datePicker.title = 'Which date tab to export to';

  const statusSpan = document.createElement('span');
  statusSpan.style.cssText = 'font-size:12px;color:var(--text-sub)';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Exporting...';
    statusSpan.textContent = '';
    try {
      const body = { outputId, date: datePicker.value };
      if (ccountId) body.accountId = ccountId;
      const result = await api('/api/sheets/export-output', { method: 'POST', body });
      btn.innerHTML = '📊 Export to Google Sheet';
      statusSpan.innerHTML = `<span style="color:var(--green)">✓ ${result.message}</span>`;
      toast(result.message, 'success');
    } catch (err) {
      btn.innerHTML = '📊 Export to Google Sheet';
      statusSpan.innerHTML = `<span style="color:var(--red)">✗ ${err.message}</span>`;
      if (err.message.includes('No Google Sheet configured')) {
        const link = document.createElement('a');
        link.href = '#';
        link.style.cssText = 'font-size:12px;color:var(--cyan);margin-left:8px';
        link.textContent = 'Configure sheet →';
        link.addEventListener('click', e => { e.preventDefault(); });
        statusSpan.appendChild(link);
      }
    } finally {
      btn.disabled = false;
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(datePicker);
  wrap.appendChild(statusSpan);
  panel.appendChild(wrap);
}

// ── Per-account Google Sheets inline panel ────────────────────────────────────

function wireAccountSheetPanel(selectId, statusId) {
  const sel = $(`#${selectId}`);
  const statusDiv = $(`#${statusId}`);
  if (!sel || !statusDiv) return;

  sel.addEventListener('change', () => {
    const opt = sel.options[sel.selectedIndex];
    const accountId = opt ? opt.dataset.accountId : null;
    if (accountId) {
      loadAccountSheetStatus(accountId, statusDiv);
    } else {
      statusDiv.innerHTML = '';
    }
  });
}

async function loadAccountSheetStatus(accountId, statusDiv) {
  statusDiv.innerHTML = '<span style="font-size:12px;color:var(--text-sub)">📊 Loading...</span>';
  let cfg = { sheetId: '', tabMode: 'date', manualTab: '' };
  try { cfg = await api(`/api/accounts/${accountId}/sheets`); } catch { /* no config */ }

  const label = cfg.sheetId
    ? `📊 Sheet: <span style="color:var(--green)">${cfg.sheetId.slice(0, 18)}…</span>`
    : `📊 Sheet: <span style="color:var(--text-sub)">Not configured</span>`;

  statusDiv.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--text-sub)">${label}</span>
      <a href="#" class="acct-sheet-cfg-link" style="font-size:12px;color:var(--cyan)">Configure</a>
    </div>
    <div class="acct-sheet-panel" style="display:none;margin-top:10px;padding:12px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px">
      <div style="margin-bottom:10px">
        <label style="display:block;margin-bottom:4px;font-size:12px">Google Sheet URL</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input type="text" class="agent-input acct-sheet-url" placeholder="https://docs.google.com/spreadsheets/d/..." style="max-width:340px;font-size:12px;padding:6px 10px" value="${cfg.sheetId ? `https://docs.google.com/spreadsheets/d/${cfg.sheetId}` : ''}">
          <button class="btn btn-cyan acct-sheet-test-btn" style="padding:6px 12px;white-space:nowrap;font-size:12px">Test Connection</button>
        </div>
        <span class="hint acct-sheet-test-status" style="margin-top:4px;display:block"></span>
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;margin-bottom:4px;font-size:12px">Tab Mode</label>
        <select class="acct-sheet-tab-mode" style="max-width:260px;font-size:12px">
          <option value="date" ${cfg.tabMode !== 'manual' ? 'selected' : ''}>Auto — match today's date</option>
          <option value="manual" ${cfg.tabMode === 'manual' ? 'selected' : ''}>Manual — always write to a specific tab</option>
        </select>
      </div>
      <div class="acct-sheet-manual-row" style="display:${cfg.tabMode === 'manual' ? 'block' : 'none'};margin-bottom:10px">
        <label style="display:block;margin-bottom:4px;font-size:12px">Tab Name</label>
        <input type="text" class="agent-input acct-sheet-manual-tab" placeholder="e.g. Sheet1" style="max-width:220px;font-size:12px;padding:6px 10px" value="${cfg.manualTab || ''}">
      </div>
      <button class="btn btn-accent acct-sheet-save-btn" style="width:100%;font-size:12px">Save</button>
      <span class="acct-sheet-save-status" style="font-size:12px;margin-top:6px;display:block"></span>
    </div>
  `;

  wireAccountSheetPanelEvents(statusDiv, accountId);
}

function wireAccountSheetPanelEvents(statusDiv, accountId) {
  const configureLink = statusDiv.querySelector('.acct-sheet-cfg-link');
  const panel         = statusDiv.querySelector('.acct-sheet-panel');
  const tabModeSelect = statusDiv.querySelector('.acct-sheet-tab-mode');
  const manualRow     = statusDiv.querySelector('.acct-sheet-manual-row');
  const testBtn       = statusDiv.querySelector('.acct-sheet-test-btn');
  const testStatus    = statusDiv.querySelector('.acct-sheet-test-status');
  const saveBtn       = statusDiv.querySelector('.acct-sheet-save-btn');
  const saveStatus    = statusDiv.querySelector('.acct-sheet-save-status');

  configureLink.addEventListener('click', e => {
    e.preventDefault();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  tabModeSelect.addEventListener('change', () => {
    manualRow.style.display = tabModeSelect.value === 'manual' ? 'block' : 'none';
  });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spinner"></span> Testing...';
    testStatus.textContent = '';
    try {
      const result = await api('/api/sheets/validate', {
        method: 'POST',
        body: { sheetUrl: statusDiv.querySelector('.acct-sheet-url').value },
      });
      testStatus.innerHTML = `<span style="color:var(--green)">✓ Connected: "${result.title}" — tabs: ${result.tabs.join(', ')}</span>`;
    } catch (err) {
      testStatus.innerHTML = `<span style="color:var(--red)">✗ ${err.message}</span>`;
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Saving...';
    saveStatus.textContent = '';
    try {
      await api(`/api/accounts/${accountId}/sheets`, {
        method: 'POST',
        body: {
          sheetUrl:  statusDiv.querySelector('.acct-sheet-url').value,
          tabMode:   tabModeSelect.value,
          manualTab: statusDiv.querySelector('.acct-sheet-manual-tab').value,
        },
      });
      toast('Sheet config saved', 'success');
      loadAccountSheetStatus(accountId, statusDiv);
    } catch (err) {
      saveStatus.innerHTML = `<span style="color:var(--red)">✗ ${err.message}</span>`;
      toast(err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
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
    btn.innerHTML = '<span class="spinner"></span> Analyzing...';
    setAgentStatus('strategist', 'running');
    try {
      const result = await api('/api/agents/strategist', { method: 'POST', body: { days } });
      setAgentStatus('strategist', 'done');
      showAgentOutput('strategist-output', result.reviewed);
      toast('Strategist report ready', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('strategist', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Report';
    }
  });

  // WRITER
  $('#writer-run-btn').addEventListener('click', async () => {
    const writerSel = $('#writer-username');
    const username = writerSel.value;
    if (!username) return toast('Select a profile first', 'error');
    const accountId = writerSel.options[writerSel.selectedIndex]?.dataset?.accountId || null;
    const btn = $('#writer-run-btn');
    const contentGoal = $('#writer-goal').value.trim() || null;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Writing...';
    setAgentStatus('writer', 'running');
    try {
      const result = await api('/api/agents/writer', { method: 'POST', body: { username, contentGoal } });
      setAgentStatus('writer', 'done');
      renderWriterCaptions('writer-output', result.reviewed, result.id, username, contentGoal, accountId);
      toast('Captions ready', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('writer', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Write Captions';
    }
  });

  // ASSISTANT
  $('#assistant-run-btn').addEventListener('click', async () => {
    const question = $('#assistant-question').value.trim();
    if (!question) return toast('Enter a question first', 'error');
    const btn = $('#assistant-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Researching...';
    setAgentStatus('assistant', 'running');
    try {
      const result = await api('/api/agents/assistant', { method: 'POST', body: { question } });
      setAgentStatus('assistant', 'done');
      showAgentOutput('assistant-output', result.answer);
      toast('Research complete', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('assistant', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ask Assistant';
    }
  });

  // CAPTAIN
  $('#captain-run-btn').addEventListener('click', async () => {
    const outputId = $('#captain-output-id').value;
    if (!outputId) return toast('Enter an output ID from history', 'error');
    const btn = $('#captain-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Reviewing...';
    setAgentStatus('captain', 'running');
    try {
      const result = await api('/api/agents/captain', { method: 'POST', body: { outputId: parseInt(outputId) } });
      setAgentStatus('captain', 'done');
      showOutputModal(`Captain Re-Review — Output #${outputId}`, result.reviewed, result.notes);
      toast('Captain review complete', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('captain', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Dispatch Captain';
    }
  });

  // IDEATOR
  $('#ideator-run-btn').addEventListener('click', async () => {
    const group = $('#ideator-group').value || null;
    const btn = $('#ideator-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating ideas...';
    setAgentStatus('ideator', 'running');
    try {
      const result = await api('/api/agents/ideator', { method: 'POST', body: { group } });
      setAgentStatus('ideator', 'done');
      showAgentOutput('ideator-output', result.reviewed);
      toast(`${result.accountCount} creator${result.accountCount !== 1 ? 's' : ''} analyzed — ideas ready`, 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('ideator', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Ideas';
    }
  });

  // Modal close
  $('#output-modal-close').addEventListener('click', () => {
    $('#output-modal').classList.add('hidden');
  });
  $('#output-modal').addEventListener('click', e => {
    if (e.target === $('#output-modal')) $('#output-modal').classList.add('hidden');
  });

  // ── BULK VIDEO CAPTIONS ──────────────────────────────────────────────────────
  const dropzone  = $('#video-dropzone');
  const fileInput = $('#video-file-input');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleBulkFileSelection(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener('change', () => {
    handleBulkFileSelection(Array.from(fileInput.files));
    fileInput.value = '';
  });

  $('#bulk-generate-btn').addEventListener('click', async () => {
    const bulkSel = $('#bulk-username');
    const username = bulkSel.value;
    if (!username) return toast('Select a creator profile first', 'error');
    if (!_bulkFiles.length) return toast('Add at least one .MOV video first', 'error');
    const accountId = bulkSel.options[bulkSel.selectedIndex]?.dataset?.accountId || null;
    const btn = $('#bulk-generate-btn');
    btn.disabled = true;
    setAgentStatus('bulk', 'running');
    try {
      btn.innerHTML = `<span class="spinner"></span> Extracting keyframes (${_bulkFiles.length} video${_bulkFiles.length !== 1 ? 's' : ''})...`;
      const videos = await Promise.all(
        _bulkFiles.map(async f => ({
          name: f.name,
          size: f.size,
          keyframes: await extractVideoKeyframes(f, 4),
        }))
      );
      btn.innerHTML = '<span class="spinner"></span> Generating captions...';
      const result = await api('/api/agents/bulk-captions', { method: 'POST', body: { username, videos } });
      _bulkResults = result.results;
      setAgentStatus('bulk', 'done');
      renderBulkCaptionResults(result.results);
      addSheetsExportButton('bulk-caption-results', result.id, username, accountId);
      toast(`${result.videoCount} video${result.videoCount !== 1 ? 's' : ''} processed — captions ready`, 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('bulk', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Captions';
    }
  });

  // Per-account sheet status panels
  wireAccountSheetPanel('writer-username', 'writer-sheet-status');
  wireAccountSheetPanel('bulk-username', 'bulk-sheet-status');

  // ── THE IDEATOR V2 ───────────────────────────────────────────────────────────
  $('#ideator-v2-run-btn').addEventListener('click', async () => {
    const username = $('#ideator-v2-username').value;
    if (!username) return toast('Select a creator first', 'error');
    const btn = $('#ideator-v2-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Generating ideas...';
    setAgentStatus('ideator-v2', 'running');
    try {
      const result = await api('/api/agents/ideator-v2', { method: 'POST', body: { username } });
      setAgentStatus('ideator-v2', 'done');
      renderIdeatorV2Output(result.reviewed, result.captainNotes);
      toast('Ideas ready', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('ideator-v2', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate Ideas';
    }
  });
}

// ── Bulk caption helpers ──────────────────────────────────────────────────────

// Extracts `count` JPEG keyframes from a video File at evenly-spaced timestamps.
// Returns an array of base64 strings (no data: prefix). Resolves [] on failure.
function extractVideoKeyframes(file, count = 4) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const frames = [];

    video.addEventListener('error', () => { URL.revokeObjectURL(url); resolve([]); });

    video.addEventListener('loadedmetadata', async () => {
      const dur = video.duration;
      if (!dur || !isFinite(dur) || dur <= 0) { URL.revokeObjectURL(url); resolve([]); return; }

      const timestamps = [0.05, 0.3, 0.6, 0.85].slice(0, count).map(t => t * dur);
      for (const t of timestamps) {
        try {
          await new Promise(res => {
            video.addEventListener('seeked', res, { once: true });
            video.currentTime = t;
          });
          const W = Math.min(video.videoWidth || 640, 640);
          const H = video.videoWidth ? Math.round(W * video.videoHeight / video.videoWidth) : 360;
          canvas.width = W;
          canvas.height = H;
          ctx.drawImage(video, 0, 0, W, H);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
          frames.push(dataUrl.replace(/^data:image\/jpeg;base64,/, ''));
        } catch { /* skip failed frame */ }
      }
      URL.revokeObjectURL(url);
      resolve(frames);
    });

    video.src = url;
  });
}

function handleBulkFileSelection(files) {
  const MAX_SIZE = 500 * 1024 * 1024;
  const errEl = $('#bulk-error-msg');
  const errors = [];

  const nonMov = files.filter(f => !f.name.toLowerCase().endsWith('.mov'));
  if (nonMov.length) {
    errors.push(`Invalid format — only .MOV files accepted. Skipped: ${nonMov.map(f => f.name).join(', ')}`);
  }
  files = files.filter(f => f.name.toLowerCase().endsWith('.mov'));

  const oversized = files.filter(f => f.size > MAX_SIZE);
  if (oversized.length) {
    errors.push(`File too large (max 500 MB). Skipped: ${oversized.map(f => f.name).join(', ')}`);
    files = files.filter(f => f.size <= MAX_SIZE);
  }

  const merged = [..._bulkFiles, ...files];
  if (merged.length > 10) {
    errors.push('Max 10 videos reached — only the first 10 are kept.');
    _bulkFiles = merged.slice(0, 10);
  } else {
    _bulkFiles = merged;
  }

  if (errors.length) {
    errEl.textContent = errors.join(' ');
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }

  renderBulkFileList();

  // Extract thumbnails in the background for newly added files
  for (const f of files) {
    if (!_bulkThumbnails[f.name]) {
      extractVideoKeyframes(f, 1).then(frames => {
        if (frames[0]) {
          _bulkThumbnails[f.name] = `data:image/jpeg;base64,${frames[0]}`;
          renderBulkFileList();
        }
      });
    }
  }
}

function renderBulkFileList() {
  const list = $('#video-file-list');
  if (!list) return;
  if (!_bulkFiles.length) { list.innerHTML = ''; return; }
  list.innerHTML = `
    <div class="video-file-list-header">
      <span>${_bulkFiles.length} / 10 video${_bulkFiles.length !== 1 ? 's' : ''} queued</span>
      <button class="vfl-clear-btn" id="bulk-clear-all">Clear all</button>
    </div>
    ${_bulkFiles.map((f, i) => `
      <div class="video-file-item">
        ${_bulkThumbnails[f.name]
          ? `<img class="video-file-thumb" src="${_bulkThumbnails[f.name]}" alt="thumbnail">`
          : `<div class="video-file-icon">▶</div>`}
        <div class="video-file-info">
          <div class="video-file-name">${escapeHtml(f.name)}</div>
          <div class="video-file-size">${formatFileSize(f.size)}</div>
        </div>
        <button class="video-file-remove" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('')}
  `;
  $('#bulk-clear-all').addEventListener('click', () => {
    _bulkFiles = [];
    renderBulkFileList();
    $('#bulk-error-msg').style.display = 'none';
  });
  $$('#video-file-list .video-file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _bulkFiles.splice(parseInt(btn.dataset.idx), 1);
      renderBulkFileList();
      if (_bulkFiles.length <= 10) $('#bulk-error-msg').style.display = 'none';
    });
  });
}

// ── Writer caption card renderer ──────────────────────────────────────────────────

function parseWriterCaptions(text) {
  const captions = [];
  const re = /###\s*CAPTION\s*(\d+)[^\n]*\n([\s\S]*?)(?=###\s*CAPTION|\s*$)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = parseInt(m[1]) - 1;
    const block = m[2].trim();
    const hashMatch = block.match(/\*\*Hashtags:\*\*\s*([\s\S]*?)$/i);
    const hashtags = hashMatch ? hashMatch[1].trim() : '';
    const body = block.replace(/\*\*Hashtags:\*\*[\s\S]*$/i, '').trim();
    const styleMatch = text.match(new RegExp(`###\\s*CAPTION\\s*${idx+1}[^\\n]*—\\s*([^\\n]+)`));
    const style = styleMatch ? styleMatch[1].trim() : '';
    captions.push({ idx, body, hashtags, style });
  }
  return captions;
}

function renderWriterCaptions(panelId, text, outputId, username, contentGoal, accountId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const captions = parseWriterCaptions(text);
  if (!captions.length) {
    // Fallback: render as markdown if parsing fails
    showAgentOutput(panelId, text);
    addSheetsExportButton(panelId, outputId, username, accountId);
    return;
  }

  panel.classList.add('open');
  panel.innerHTML = '';

  // Caption cards container
  const cardsWrap = document.createElement('div');
  cardsWrap.className = 'writer-caption-cards';
  cardsWrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;margin-bottom:16px';

  captions.forEach((cap, ci) => {
    const card = document.createElement('div');
    card.className = 'caption-card writer-caption-card';
    card.dataset.captionIndex = ci;
    card.style.cssText = 'background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px;position:relative';

    // Top row: number, style badge, platform select, refresh btn, copy btn
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap';

    const numBadge = document.createElement('span');
    numBadge.className = 'caption-num';
    numBadge.textContent = `Caption ${ci + 1}`;

    const styleBadge = document.createElement('span');
    styleBadge.className = 'caption-style-badge';
    styleBadge.textContent = cap.style || 'writer';
    styleBadge.style.cssText = 'font-size:11px;padding:2px 8px;border-radius:20px;background:var(--accent-dim,rgba(48,209,88,0.15));color:var(--green);flex-shrink:0';

    const platformSelect = document.createElement('select');
    platformSelect.className = 'caption-platform-select agent-select';
    platformSelect.style.cssText = 'font-size:11px;padding:3px 8px;border-radius:6px;flex-shrink:0';
    ['TikTok', 'IG Reels', 'OF'].forEach(p => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      platformSelect.appendChild(opt);
    });

    const spacer = document.createElement('span');
    spacer.style.flex = '1';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn';
    refreshBtn.style.cssText = 'font-size:11px;padding:3px 10px;border-color:var(--text-dim);color:var(--text-dim)';
    refreshBtn.textContent = '🔄 Refresh';
    refreshBtn.title = 'Generate a fresh caption with a different angle';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'caption-copy-btn btn';
    copyBtn.style.cssText = 'font-size:11px;padding:3px 10px';
    copyBtn.textContent = 'Copy';

    topRow.append(numBadge, styleBadge, platformSelect, spacer, refreshBtn, copyBtn);

    // Caption body (editable)
    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'caption-card-text caption-editable';
    bodyDiv.contentEditable = 'true';
    bodyDiv.textContent = cap.body;
    bodyDiv.style.cssText = 'min-height:60px;border:1px solid transparent;border-radius:6px;padding:6px 8px;transition:border-color 0.2s;outline:none;white-space:pre-wrap;line-height:1.5;font-size:13px';
    bodyDiv.addEventListener('focus', () => bodyDiv.style.borderColor = 'var(--border-focus,var(--accent,#30D158))');
    bodyDiv.addEventListener('blur',  () => bodyDiv.style.borderColor = 'transparent');

    // Hashtags (editable)
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'caption-card-tags caption-tags-editable';
    tagsDiv.contentEditable = 'true';
    tagsDiv.textContent = cap.hashtags;
    tagsDiv.style.cssText = 'font-size:11px;color:var(--text-dim);margin-top:8px;border:1px solid transparent;border-radius:6px;padding:4px 8px;transition:border-color 0.2s;outline:none;white-space:pre-wrap';
    tagsDiv.addEventListener('focus', () => tagsDiv.style.borderColor = 'var(--border-focus,var(--accent,#30D158))');
    tagsDiv.addEventListener('blur',  () => tagsDiv.style.borderColor = 'transparent');

    // Bottom row: Dropbox input + rating buttons
    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap';

    const dropboxInput = document.createElement('input');
    dropboxInput.type = 'text';
    dropboxInput.className = 'caption-dropbox-input agent-input';
    dropboxInput.placeholder = 'Dropbox link...';
    dropboxInput.style.cssText = 'flex:1;min-width:180px;font-size:12px;padding:5px 10px';

    const thumbUp = document.createElement('button');
    thumbUp.className = 'btn caption-rate-btn';
    thumbUp.dataset.rating = 'up';
    thumbUp.style.cssText = 'font-size:14px;padding:3px 10px;border-color:var(--text-dim)';
    thumbUp.textContent = '👍';
    thumbUp.title = 'Good caption';

    const thumbDown = document.createElement('button');
    thumbDown.className = 'btn caption-rate-btn';
    thumbDown.dataset.rating = 'down';
    thumbDown.style.cssText = 'font-size:14px;padding:3px 10px;border-color:var(--text-dim)';
    thumbDown.textContent = '👎';
    thumbDown.title = 'Bad caption';

    bottomRow.append(dropboxInput, thumbUp, thumbDown);

    card.append(topRow, bodyDiv, tagsDiv, bottomRow);
    cardsWrap.appendChild(card);

    // Wire refresh button
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="spinner"></span>';
      card.style.opacity = '0.6';
      try {
        const res = await api('/api/agents/writer/refresh-caption', {
          method: 'POST',
          body: { username, contentGoal: contentGoal || null },
        });
        // Parse the returned single caption
        const newCaps = parseWriterCaptions(res.caption);
        if (newCaps.length) {
          bodyDiv.textContent = newCaps[0].body;
          tagsDiv.textContent = newCaps[0].hashtags;
          styleBadge.textContent = newCaps[0].style || 'refreshed';
        } else {
          bodyDiv.textContent = res.caption;
          tagsDiv.textContent = '';
        }
        toast('Caption refreshed', 'success');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Refresh';
        card.style.opacity = '1';
      }
    });

    // Wire copy button
    copyBtn.addEventListener('click', () => {
      const full = bodyDiv.textContent + (tagsDiv.textContent ? '\n\n' + tagsDiv.textContent : '');
      navigator.clipboard.writeText(full).then(() => {
        copyBtn.textContent = '✓ Copied';
        copyBtn.style.color = 'var(--green)';
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.style.color = ''; }, 2200);
      }).catch(() => toast('Copy failed', 'error'));
    });

    // Wire rating buttons
    [thumbUp, thumbDown].forEach(btn => {
      btn.addEventListener('click', async () => {
        const rating = btn.dataset.rating;
        try {
          await api('/api/captions/rate', { method: 'POST', body: { outputId, captionIndex: ci, rating } });
          thumbUp.style.borderColor   = rating === 'up'   ? 'var(--green)' : 'var(--text-dim)';
          thumbDown.style.borderColor = rating === 'down' ? 'var(--red)'   : 'var(--text-dim)';
          thumbUp.style.color   = rating === 'up'   ? 'var(--green)' : '';
          thumbDown.style.color = rating === 'down' ? 'var(--red)'   : '';
        } catch (err) {
          toast('Rating failed: ' + err.message, 'error');
        }
      });
    });
  });

  panel.appendChild(cardsWrap);

  // Export button — collects live card data
  const exportWrap = document.createElement('div');
  exportWrap.className = 'sheets-export-btn-wrap';
  exportWrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px';

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn';
  exportBtn.style.cssText = 'border-color:var(--green);color:var(--green);display:flex;align-items:center;gap:6px';
  exportBtn.innerHTML = '📊 Export to Google Sheet';

  const datePicker = document.createElement('input');
  datePicker.type = 'date';
  datePicker.className = 'agent-input';
  datePicker.style.cssText = 'max-width:160px;font-size:12px;padding:6px 10px';
  datePicker.value = new Date().toISOString().slice(0, 10);
  datePicker.title = 'Which date tab to export to';

  const statusSpan = document.createElement('span');
  statusSpan.style.cssText = 'font-size:12px;color:var(--text-sub)';

  // Caption history button
  const historyBtn = document.createElement('button');
  historyBtn.className = 'btn';
  historyBtn.style.cssText = 'border-color:var(--cyan);color:var(--cyan);font-size:12px;padding:5px 12px';
  historyBtn.textContent = '📜 History';
  historyBtn.title = `View all past caption runs for @${username}`;

  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    exportBtn.innerHTML = '<span class="spinner"></span> Exporting...';
    statusSpan.textContent = '';
    try {
      // Collect caption data from live cards
      const captionCards = cardsWrap.querySelectorAll('.writer-caption-card');
      const captionsPayload = Array.from(captionCards).map(c => {
        const body = c.querySelector('.caption-editable')?.textContent || '';
        const tags = c.querySelector('.caption-tags-editable')?.textContent || '';
        const dropboxLink = c.querySelector('.caption-dropbox-input')?.value || '';
        const platform = c.querySelector('.caption-platform-select')?.value || '';
        return {
          caption: body + (tags ? '\n\n' + tags : ''),
          dropboxLink,
          platform,
          category: '',
        };
      }).filter(c => c.caption.trim());

      const body = { captions: captionsPayload, date: datePicker.value };
      if (accountId) body.accountId = accountId;
      const result = await api('/api/sheets/export', { method: 'POST', body });
      exportBtn.innerHTML = '📊 Export to Google Sheet';
      statusSpan.innerHTML = `<span style="color:var(--green)">✓ ${result.message}</span>`;
      toast(result.message, 'success');
    } catch (err) {
      exportBtn.innerHTML = '📊 Export to Google Sheet';
      statusSpan.innerHTML = `<span style="color:var(--red)">✗ ${err.message}</span>`;
    } finally {
      exportBtn.disabled = false;
    }
  });

  historyBtn.addEventListener('click', () => showCaptionHistory(username));

  exportWrap.append(exportBtn, datePicker, historyBtn, statusSpan);
  panel.appendChild(exportWrap);
}

function showCaptionHistory(username) {
  const panel = document.getElementById('writer-output');
  if (!panel) return;

  const historyWrap = document.createElement('div');
  historyWrap.className = 'caption-history-panel';
  historyWrap.style.cssText = 'margin-top:20px;border-top:1px solid var(--border);padding-top:16px';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:13px;font-weight:600;color:var(--text-sub);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em';
  title.textContent = `Caption History — @${username}`;

  const listWrap = document.createElement('div');
  listWrap.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">Loading...</span>';

  historyWrap.append(title, listWrap);
  panel.querySelector('.caption-history-panel')?.remove();
  panel.appendChild(historyWrap);

  api(`/api/captions/history/${encodeURIComponent(username)}`).then(rows => {
    if (!rows.length) {
      listWrap.innerHTML = '<span style="font-size:12px;color:var(--text-dim)">No caption history yet.</span>';
      return;
    }
    listWrap.innerHTML = '';
    rows.forEach(row => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px';

      const date = document.createElement('span');
      date.style.cssText = 'color:var(--text-dim);flex-shrink:0;min-width:130px';
      date.textContent = new Date(row.created_at).toLocaleString();

      const preview = document.createElement('span');
      preview.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-sub)';
      const firstCaption = (row.reviewed_output || '').split('\n').find(l => l.trim() && !l.startsWith('#'));
      preview.textContent = firstCaption || row.input_summary || '(no preview)';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn';
      loadBtn.style.cssText = 'font-size:11px;padding:3px 10px;flex-shrink:0';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', () => {
        renderWriterCaptions('writer-output', row.reviewed_output || '', row.id, username, null, null);
        toast('Caption run loaded', 'success');
      });

      item.append(date, preview, loadBtn);
      listWrap.appendChild(item);
    });
  }).catch(err => {
    listWrap.innerHTML = `<span style="color:var(--red);font-size:12px">${err.message}</span>`;
  });
}

function renderBulkCaptionResults(results) {
  const container = $('#bulk-caption-results');
  if (!container) return;
  container.style.display = 'block';
  container.innerHTML = results.map((video, vi) => `
    <div class="caption-video-group">
      <div class="caption-video-header">
        ${_bulkThumbnails[video.videoName]
          ? `<img class="caption-video-thumb" src="${_bulkThumbnails[video.videoName]}" alt="thumbnail">`
          : `<span class="caption-video-icon">▶</span>`}
        <span class="caption-video-name">${escapeHtml(video.videoName)}</span>
        <span class="caption-count">${(video.captions || []).length} captions</span>
      </div>
      <div class="caption-cards-row">
        ${(video.captions || []).map((cap, ci) => `
          <div class="caption-card">
            <div class="caption-card-top">
              <span class="caption-num">Caption ${ci + 1}</span>
              <span class="caption-style-badge">${escapeHtml(cap.style || 'default')}</span>
              <button class="caption-copy-btn" data-vi="${vi}" data-ci="${ci}">Copy</button>
            </div>
            <div class="caption-card-text">${escapeHtml(cap.text || '')}</div>
            ${cap.hashtags ? `<div class="caption-card-tags">${escapeHtml(cap.hashtags)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  $$('#bulk-caption-results .caption-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { vi, ci } = btn.dataset;
      const cap = _bulkResults[vi].captions[ci];
      const text = (cap.text || '') + (cap.hashtags ? '\n\n' + cap.hashtags : '');
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✓ Copied';
        btn.style.color = 'var(--green)';
        setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = ''; }, 2200);
      }).catch(() => toast('Copy failed — try selecting and copying manually', 'error'));
    });
  });
}

function formatFileSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024)        return (bytes / (1024 ** 2)).toFixed(1) + ' MB';
  if (bytes >= 1024)               return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// ── Ideator V2 helpers ────────────────────────────────────────────────────────

function parseIdeatorV2Ideas(text) {
  const ideas = [];
  const sections = text.split(/(?=### IDEA \d)/);

  for (const section of sections) {
    if (!section.trim() || !section.startsWith('### IDEA')) continue;
    const headerMatch = section.match(/^### IDEA \d+ — ([^\n]+)/);
    if (!headerMatch) continue;

    const headerText = headerMatch[1];
    const typeMatch  = headerText.match(/^([A-Z][A-Z\-\s]+?)(?:\s*\((.+?)\))?$/);
    const type  = typeMatch ? typeMatch[1].trim() : headerText;
    const title = (typeMatch && typeMatch[2]) ? typeMatch[2].trim() : '';

    const extract = keys => {
      for (const key of [].concat(keys)) {
        const re = new RegExp(`\\*\\*${key}[:\\s]*\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|\\n\\*\\*|\\n###|\\n##|$)`, 'i');
        const m = section.match(re);
        if (m) return m[1].trim();
      }
      return '';
    };

    ideas.push({
      type,
      title,
      hook:    extract(['Hook']),
      concept: extract(['Concept', 'The Concept']),
      cta:     extract(['CTA', 'Call to Action', 'Call-to-Action']),
      trend:   extract(['Trend Alignment', 'Trend']),
    });
  }

  const whyMatch  = text.match(/## WHY THESE (?:THREE|3)[^\n]*\n([\s\S]*)$/i);
  ideas.why = whyMatch ? whyMatch[1].trim() : '';
  return ideas;
}

function renderIdeatorV2Output(text, captainNotes) {
  const container = $('#ideator-v2-output');
  if (!container) return;
  container.style.display = 'block';

  const ideas = parseIdeatorV2Ideas(text);
  const CARD_COLORS  = ['var(--green)', 'var(--cyan)', '#FF6B6B'];
  const CARD_LABELS  = ['LOW-HANGING FRUIT', 'B-ROLL HEAVY', 'ENGAGEMENT BAIT'];
  const CARD_DESCS   = ['Easy Talking Head', 'Aesthetic / Voiceover', 'High-Comment Volume'];

  if (ideas.length >= 1) {
    container.innerHTML = `
      <div class="ideator-v2-cards">
        ${ideas.slice(0, 3).map((idea, i) => {
          const color = CARD_COLORS[i];
          const label = idea.type || CARD_LABELS[i] || '';
          const desc  = idea.title || CARD_DESCS[i] || '';
          return `
            <div class="ideator-v2-card" style="--card-color:${color}">
              <div class="iv2-card-header">
                <div class="iv2-type" style="color:${color}">${escapeHtml(label)}</div>
                ${desc ? `<div class="iv2-desc">${escapeHtml(desc)}</div>` : ''}
              </div>
              <div class="iv2-card-body">
                ${idea.hook    ? `<div class="iv2-field"><div class="iv2-label">HOOK</div><div class="iv2-value">${escapeHtml(idea.hook)}</div></div>` : ''}
                ${idea.concept ? `<div class="iv2-field"><div class="iv2-label">CONCEPT</div><div class="iv2-value">${escapeHtml(idea.concept)}</div></div>` : ''}
                ${idea.cta     ? `<div class="iv2-field"><div class="iv2-label">CTA</div><div class="iv2-value">${escapeHtml(idea.cta)}</div></div>` : ''}
                ${idea.trend   ? `<div class="iv2-field iv2-trend"><div class="iv2-label">TREND ALIGNMENT</div><div class="iv2-value">${escapeHtml(idea.trend)}</div></div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
      ${ideas.why ? `
        <div class="iv2-why-block">
          <div class="iv2-why-label">WHY THESE THREE</div>
          <div class="iv2-why-text">${escapeHtml(ideas.why)}</div>
        </div>` : ''}
      ${captainNotes ? `
        <div class="captain-notes" style="margin-top:16px">
          <div class="captain-notes-label">Captain's Notes</div>
          ${captainNotes}
        </div>` : ''}
    `;
  } else {
    // Fallback: plain markdown render
    container.innerHTML = `<div class="agent-output-panel open">${renderMarkdown(text)}</div>`;
  }
}

// ── Brain 3D Engine ───────────────────────────────────────────────────────────

let _brainScene = null, _brainRenderer = null, _brainAnimId = null, _brainCamera = null;
let _brainNodeMeshes = [];

function disposeBrainScene() {
  if (_brainAnimId) { cancelAnimationFrame(_brainAnimId); _brainAnimId = null; }
  if (_brainRenderer) {
    _brainRenderer.domElement.removeEventListener('click', _brainClickHandler);
    _brainRenderer.dispose();
    _brainRenderer = null;
  }
  _brainScene = null;
  _brainCamera = null;
  _brainNodeMeshes = [];
}

function _brainClickHandler(e) {
  if (!_brainRenderer || !_brainCamera || !_brainNodeMeshes.length) return;
  const canvas = _brainRenderer.domElement;
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, _brainCamera);
  const hits = ray.intersectObjects(_brainNodeMeshes.map(n => n.mesh));
  if (hits.length) {
    const node = _brainNodeMeshes.find(n => n.mesh === hits[0].object);
    if (node) showBrainNodeProfile(node.profile);
  }
}

function showBrainNodeProfile(profile) {
  const panel = document.getElementById('brain-profile-panel');
  const content = document.getElementById('brain-panel-content');
  if (!panel || !content) return;
  const pillars = (() => { try { return JSON.parse(profile.content_pillars); } catch { return []; } })();
  const emojiPrint = (() => { try { return JSON.parse(profile.emoji_fingerprint); } catch { return null; } })();
  const emojiSection = (emojiPrint && Object.keys(emojiPrint).length)
    ? `<div class="brain-section"><div class="brain-label">Emoji Fingerprint</div><div class="brain-value">
        ${emojiPrint.signature ? `<div style="margin-bottom:6px;font-style:italic">${emojiPrint.signature}</div>` : ''}
        ${(emojiPrint.mustUse||[]).length ? `<div><span style="color:var(--text-dim);font-size:11px">USE: </span>${emojiPrint.mustUse.join(' ')}</div>` : ''}
        ${(emojiPrint.avoidList||[]).length ? `<div><span style="color:var(--text-dim);font-size:11px">AVOID: </span>${emojiPrint.avoidList.join(' ')}</div>` : ''}
        ${emojiPrint.usageStyle ? `<div style="margin-top:4px;font-size:11px;color:var(--text-dim)">${emojiPrint.usageStyle}</div>` : ''}
      </div></div>`
    : `<div class="brain-section"><div class="brain-label">Emoji Fingerprint</div><div class="brain-value" style="color:var(--text-dim);font-size:12px">Not built yet — rebuild Brain to generate</div></div>`;
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--bg-3);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700;color:var(--accent);flex-shrink:0">
        ${initials(profile.full_name || profile.username)}
      </div>
      <div style="min-width:0">
        <div style="font-weight:700;font-size:16px;color:var(--text-main)">@${profile.username}</div>
        <div style="font-size:12px;color:var(--text-dim)">${(profile.followers_count || 0).toLocaleString()} followers · ${profile.group_name || 'Default'}</div>
      </div>
    </div>
    ${profile.strength_summary ? `<div class="brain-strength" style="margin-bottom:16px">${profile.strength_summary}</div>` : ''}
    ${pillars.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${pillars.map(t => `<span class="brain-pillar">${t}</span>`).join('')}</div>` : ''}
    <div class="brain-section"><div class="brain-label">Voice</div><div class="brain-value">${profile.voice_fingerprint || '—'}</div></div>
    <div class="brain-section"><div class="brain-label">Audience Triggers</div><div class="brain-value">${profile.audience_triggers || '—'}</div></div>
    <div class="brain-section"><div class="brain-label">Niche Position</div><div class="brain-value">${profile.niche_positioning || '—'}</div></div>
    <div class="brain-section"><div class="brain-label">Visual Style</div><div class="brain-value">${profile.visual_style || '—'}</div></div>
    ${emojiSection}
    ${profile.discovery_brief ? `<details class="brain-discovery" style="margin-top:12px"><summary>Find Similar</summary><div class="brain-value" style="margin-top:8px">${profile.discovery_brief}</div></details>` : ''}
    <div style="display:flex;gap:8px;margin-top:20px">
      <button class="btn" style="flex:1;font-size:12px;background:var(--bg-3);border-color:var(--border-strong);color:var(--text-sub)" onclick="rebuildProfile(${profile.account_id})">Rebuild</button>
      <button class="btn btn-danger" style="flex:1;font-size:12px" onclick="removeProfile(${profile.account_id},'${profile.username}')">Remove</button>
    </div>
  `;
  panel.style.transform = 'translateX(0)';
}

function initBrain3D(profiles) {
  const container = document.getElementById('brain-3d-container');
  const canvas = document.getElementById('brain-canvas');
  if (!container || !canvas || typeof THREE === 'undefined') return;

  disposeBrainScene();

  const W = container.clientWidth || 800;
  const H = container.clientHeight || 520;

  _brainScene = new THREE.Scene();
  _brainCamera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
  _brainCamera.position.set(0, 0.4, 6.5);

  _brainRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  _brainRenderer.setSize(W, H);
  _brainRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _brainRenderer.setClearColor(0x000000, 0);

  // Lighting
  _brainScene.add(new THREE.AmbientLight(0x223355, 1.2));
  const pl1 = new THREE.PointLight(0x6366F1, 3, 20);
  pl1.position.set(-3, 4, 3);
  _brainScene.add(pl1);
  const pl2 = new THREE.PointLight(0xFF375F, 3, 20);
  pl2.position.set(4, -2, 2);
  _brainScene.add(pl2);

  // Brain — displaced icosahedron wireframe with blue→pink gradient
  const brainGeo = new THREE.IcosahedronGeometry(1.85, 4);
  const bPos = brainGeo.attributes.position;
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i), y = bPos.getY(i), z = bPos.getZ(i);
    const d = 0.18 * (Math.sin(x * 3.5 + y * 2.3) + Math.cos(y * 2.7 + z * 3.1) + Math.sin(z * 4.0 + x * 1.8));
    const len = Math.sqrt(x*x + y*y + z*z) || 1;
    bPos.setXYZ(i, x + (x/len)*d, y + (y/len)*d, z + (z/len)*d);
  }
  brainGeo.computeVertexNormals();

  const wireGeo = new THREE.WireframeGeometry(brainGeo);
  const wp = wireGeo.attributes.position;
  const wc = new Float32Array(wp.count * 3);
  for (let i = 0; i < wp.count; i++) {
    const t = Math.max(0, Math.min(1, (wp.getX(i) + 1.85) / 3.7));
    wc[i*3]   = 0.388 + (1.0   - 0.388) * t;
    wc[i*3+1] = 0.400 + (0.216 - 0.400) * t;
    wc[i*3+2] = 0.945 + (0.373 - 0.945) * t;
  }
  wireGeo.setAttribute('color', new THREE.BufferAttribute(wc, 3));
  const wireMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65 });
  const brainMesh = new THREE.LineSegments(wireGeo, wireMat);
  _brainScene.add(brainMesh);

  // Cerebellum bump
  const cGeo = new THREE.IcosahedronGeometry(0.88, 3);
  const cPos = cGeo.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    const x = cPos.getX(i), y = cPos.getY(i), z = cPos.getZ(i);
    const d = 0.11 * Math.sin(x * 4.2 + y * 3.1 + z * 2.4);
    const len = Math.sqrt(x*x + y*y + z*z) || 1;
    cPos.setXYZ(i, x + (x/len)*d, y + (y/len)*d, z + (z/len)*d);
  }
  cGeo.computeVertexNormals();
  const cwGeo = new THREE.WireframeGeometry(cGeo);
  const cwp = cwGeo.attributes.position;
  const cwc = new Float32Array(cwp.count * 3);
  for (let i = 0; i < cwp.count; i++) {
    const t = Math.max(0, Math.min(1, (cwp.getX(i) + 0.88) / 1.76));
    cwc[i*3]   = 0.388 + (1.0   - 0.388) * t;
    cwc[i*3+1] = 0.400 + (0.216 - 0.400) * t;
    cwc[i*3+2] = 0.945 + (0.373 - 0.945) * t;
  }
  cwGeo.setAttribute('color', new THREE.BufferAttribute(cwc, 3));
  const cerebellumMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.48 });
  const cerebellum = new THREE.LineSegments(cwGeo, cerebellumMat);
  cerebellum.position.set(0.35, -1.52, -0.85);
  _brainScene.add(cerebellum);

  // Creator nodes
  _brainNodeMeshes = [];
  const NODE_COLORS = [0x6366F1, 0xFF375F, 0x00D4FF, 0xFF9F0A, 0x30D158, 0xBF5AF2, 0xFF6B6B, 0x34C5FF];

  profiles.forEach((profile, idx) => {
    const r = 3.2 + Math.random() * 1.7;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = (r * 0.68) * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    const color = NODE_COLORS[idx % NODE_COLORS.length];

    const nodeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 14, 14),
      new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.7, shininess: 100 })
    );
    nodeMesh.position.set(x, y, z);
    _brainScene.add(nodeMesh);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.36, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    ring.position.set(x, y, z);
    _brainScene.add(ring);

    const brainPt = new THREE.Vector3(x, y, z).normalize().multiplyScalar(1.92);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([brainPt, new THREE.Vector3(x, y, z)]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 }));
    _brainScene.add(line);

    _brainNodeMeshes.push({ mesh: nodeMesh, ring, profile, baseY: y, seed: idx * 2.31 + 0.7 });
  });

  canvas.addEventListener('click', _brainClickHandler);
  canvas.style.cursor = 'crosshair';

  let tick = 0;
  function animate() {
    _brainAnimId = requestAnimationFrame(animate);
    tick += 0.010;

    brainMesh.rotation.y = tick * 0.22;
    brainMesh.rotation.x = Math.sin(tick * 0.16) * 0.07;
    cerebellum.rotation.y = tick * 0.22;
    cerebellum.rotation.x = brainMesh.rotation.x;
    wireMat.opacity = 0.42 + 0.23 * Math.sin(tick * 1.1);
    cerebellumMat.opacity = 0.3 + 0.18 * Math.sin(tick * 1.1 + 0.5);

    _brainNodeMeshes.forEach(n => {
      const pulse = 1 + 0.13 * Math.sin(tick * 1.9 + n.seed);
      n.mesh.scale.setScalar(pulse);
      n.mesh.position.y = n.baseY + 0.1 * Math.sin(tick * 0.85 + n.seed);
      n.ring.position.copy(n.mesh.position);
      n.ring.lookAt(_brainCamera.position);
      n.ring.material.opacity = 0.08 + 0.16 * Math.sin(tick * 1.4 + n.seed);
    });

    _brainRenderer.render(_brainScene, _brainCamera);
  }
  animate();
}

// ── Brain ─────────────────────────────────────────────────────────────────────

async function renderBrain() {
  disposeBrainScene();
  const el = $('#page-brain');
  el.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <h2 class="page-title">The <span class="accent">Brain</span></h2>
        <p style="font-size:13px;color:var(--text-sub);margin-top:4px">Creator intelligence — powering your Writer and Ideator</p>
      </div>
      <button class="btn btn-accent" id="brain-build-all-btn" style="background:var(--purple);border-color:var(--purple)">Build All Profiles</button>
    </div>

    <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <select id="brain-add-select" class="agent-select" style="flex:1;max-width:320px;min-width:180px">
        <option value="">— Select a creator to add —</option>
      </select>
      <button class="btn btn-accent" id="brain-add-btn">Add to Brain</button>
    </div>

    <div id="brain-status" style="display:none;padding:10px 14px;background:var(--accent-soft);border-radius:var(--radius-sm);font-size:13px;color:var(--accent);margin-bottom:16px"></div>

    <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <input id="brain-search-input" class="agent-input" placeholder="Search by voice, niche, style, audience…" style="flex:1;min-width:180px">
      <button class="btn btn-cyan" id="brain-search-btn" style="white-space:nowrap">Search Profiles</button>
      <button class="btn btn-dim" id="brain-search-clear" style="display:none">Clear</button>
    </div>
    <div id="brain-search-results" style="display:none;margin-bottom:20px"></div>

    <div id="brain-3d-container" style="position:relative;width:100%;height:520px;border-radius:18px;overflow:hidden;background:radial-gradient(ellipse at 50% 40%, #0e0a1f 0%, #060609 75%);margin-bottom:28px;border:1px solid rgba(99,102,241,0.18)">
      <canvas id="brain-canvas" style="display:block"></canvas>
      <div style="position:absolute;top:18px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(150,150,200,0.45);pointer-events:none;white-space:nowrap">AI Intelligence Brain</div>
      <div id="brain-node-count" style="position:absolute;bottom:16px;right:18px;font-size:11px;font-weight:600;color:rgba(99,102,241,0.65);letter-spacing:0.05em"></div>
      <div id="brain-3d-empty" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(120,120,160,0.45);font-size:14px;pointer-events:none">
        <div style="font-size:44px;margin-bottom:12px;opacity:0.25">🧠</div>
        <div>Build profiles to connect creators to the Brain</div>
      </div>
    </div>

    <div id="brain-profile-panel" style="position:fixed;top:0;right:0;width:360px;height:100vh;background:var(--bg-2);border-left:1px solid var(--border-strong);z-index:300;transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.4,0,0.2,1);overflow-y:auto;padding:28px 24px 40px;box-shadow:-8px 0 32px rgba(0,0,0,0.4)">
      <button id="brain-panel-close" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--text-dim);font-size:24px;cursor:pointer;line-height:1;padding:4px 8px" title="Close">×</button>
      <div style="font-size:10px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:20px">Creator Profile</div>
      <div id="brain-panel-content"></div>
    </div>

    <div id="brain-grid" class="brain-grid">
      <div style="color:var(--text-dim);font-size:13px;padding:40px 0;text-align:center">Loading profiles...</div>
    </div>
  `;

  $('#brain-build-all-btn').addEventListener('click', async () => {
    const btn = $('#brain-build-all-btn');
    const status = $('#brain-status');
    btn.disabled = true;
    btn.textContent = 'Building...';
    status.style.display = 'block';
    status.style.color = 'var(--accent)';
    status.textContent = 'Running profile builder across all creators — this may take a minute...';
    try {
      const res = await api('/api/brain/build', { method: 'POST', body: {} });
      status.textContent = `Done — ${res.built} profile${res.built !== 1 ? 's' : ''} built successfully.`;
      toast('Profiles built', 'success');
      loadBrainProfiles();
    } catch (err) {
      status.style.color = 'var(--red)';
      status.textContent = 'Error: ' + err.message;
    }
    btn.disabled = false;
    btn.textContent = 'Build All Profiles';
  });

  $('#brain-add-btn').addEventListener('click', async () => {
    const select = $('#brain-add-select');
    const accountId = select.value;
    if (!accountId) return toast('Select a creator first', 'error');
    const btn = $('#brain-add-btn');
    btn.disabled = true;
    btn.textContent = 'Building...';
    try {
      await api('/api/brain/build', { method: 'POST', body: { accountId: parseInt(accountId) } });
      toast('Profile built', 'success');
      select.value = '';
      loadBrainProfiles();
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Add to Brain';
  });

  document.getElementById('brain-panel-close').addEventListener('click', () => {
    document.getElementById('brain-profile-panel').style.transform = 'translateX(100%)';
  });

  loadBrainProfiles();

  // Brain semantic search
  const brainSearchBtn    = $('#brain-search-btn');
  const brainSearchClear  = $('#brain-search-clear');
  const brainSearchInput  = $('#brain-search-input');
  const brainSearchResults = $('#brain-search-results');

  async function runBrainSearch() {
    const query = brainSearchInput.value.trim();
    if (!query) return;
    brainSearchBtn.disabled = true;
    brainSearchBtn.textContent = 'Searching…';
    brainSearchResults.style.display = 'block';
    brainSearchResults.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0">Analyzing profiles with AI…</div>';
    try {
      const data = await api('/api/brain/search', { method: 'POST', body: { query } });
      if (!data.results || !data.results.length) {
        brainSearchResults.innerHTML = '<div style="color:var(--text-dim);font-size:13px;padding:8px 0">No matching profiles found.</div>';
      } else {
        brainSearchResults.innerHTML = `
          <div style="font-size:11px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px">
            ${data.results.length} match${data.results.length !== 1 ? 'es' : ''} for &ldquo;${data.query}&rdquo;
          </div>
          <div class="brain-grid">
            ${data.results.map(p => {
              const pillars = (() => { try { return JSON.parse(p.content_pillars); } catch { return []; } })();
              return `
              <div class="brain-card" style="border-color:rgba(50,173,230,0.4)">
                <div class="brain-card-header">
                  <div class="pod-avatar">${p.profile_pic_url ? `<img src="${proxyImg(p.profile_pic_url)}" onerror="this.style.display='none'">` : ''}<span>${initials(p.full_name || p.username)}</span></div>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:14px;color:var(--text-main)">@${p.username}</div>
                    <div style="font-size:12px;color:var(--text-dim)">${(p.followers_count||0).toLocaleString()} followers · ${p.group_name||'Ungrouped'}</div>
                  </div>
                </div>
                <div style="font-size:12px;color:var(--cyan);background:var(--cyan-soft);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:10px;line-height:1.5">${p.relevance_reason}</div>
                ${p.strength_summary ? `<div class="brain-strength">${p.strength_summary}</div>` : ''}
                ${pillars.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${pillars.map(t => `<span class="brain-pillar">${t}</span>`).join('')}</div>` : ''}
              </div>`;
            }).join('')}
          </div>`;
      }
      brainSearchClear.style.display = '';
    } catch (err) {
      brainSearchResults.innerHTML = `<div style="color:var(--red);font-size:13px">${err.message}</div>`;
    }
    brainSearchBtn.disabled = false;
    brainSearchBtn.textContent = 'Search Profiles';
  }

  brainSearchBtn.addEventListener('click', runBrainSearch);
  brainSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runBrainSearch(); });
  brainSearchClear.addEventListener('click', () => {
    brainSearchInput.value = '';
    brainSearchResults.style.display = 'none';
    brainSearchResults.innerHTML = '';
    brainSearchClear.style.display = 'none';
  });
}

async function loadBrainProfiles() {
  const grid = $('#brain-grid');
  if (!grid) return;
  try {
    const [profiles, accounts] = await Promise.all([
      api('/api/brain/profiles'),
      api('/api/accounts'),
    ]);

    // Populate add-selector
    const profiledIds = new Set(profiles.map(p => p.account_id));
    const select = $('#brain-add-select');
    if (select) {
      select.innerHTML = `<option value="">— Select a creator to add —</option>${
        accounts.filter(a => !profiledIds.has(a.id))
          .map(a => `<option value="${a.id}">@${a.username}${a.group_name ? ` (${a.group_name})` : ''}</option>`)
          .join('')
      }`;
    }

    // Empty overlay
    const emptyEl = document.getElementById('brain-3d-empty');
    if (emptyEl) emptyEl.style.display = profiles.length ? 'none' : 'flex';

    // Init 3D scene
    initBrain3D(profiles);

    const countEl = document.getElementById('brain-node-count');
    if (countEl) countEl.textContent = profiles.length ? `${profiles.length} creator${profiles.length !== 1 ? 's' : ''} connected` : '';

    if (!profiles.length) {
      grid.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--text-dim)">
          <div style="font-size:13px">Build a profile to see creator intelligence cards here.</div>
        </div>`;
      return;
    }

    grid.innerHTML = profiles.map(p => {
      const pillars = (() => { try { return JSON.parse(p.content_pillars); } catch { return []; } })();
      return `
      <div class="brain-card">
        <div class="brain-card-header">
          <div class="target-avatar">${p.profile_pic_url ? `<img src="${proxyImg(p.profile_pic_url)}" onerror="this.style.display='none'">` : ''}<span>${initials(p.full_name || p.username)}</span></div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px;color:var(--text-main)">@${p.username}</div>
            <div style="font-size:12px;color:var(--text-dim)">${(p.followers_count||0).toLocaleString()} followers · ${p.group_name||'Ungrouped'}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn" style="padding:4px 10px;font-size:11px;background:var(--bg-3);color:var(--text-sub);border:1px solid var(--border-strong)" onclick="rebuildProfile(${p.account_id})">Rebuild</button>
            <button class="btn" style="padding:4px 10px;font-size:11px;background:var(--red-soft);color:var(--red);border:1px solid rgba(255,69,58,0.25)" onclick="removeProfile(${p.account_id}, '${p.username}')">Remove</button>
          </div>
        </div>
        ${p.strength_summary ? `<div class="brain-strength">${p.strength_summary}</div>` : ''}
        ${pillars.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${pillars.map(tag => `<span class="brain-pillar">${tag}</span>`).join('')}</div>` : ''}
        <div class="brain-section"><div class="brain-label">Voice</div><div class="brain-value">${p.voice_fingerprint || '—'}</div></div>
        <div class="brain-section"><div class="brain-label">Audience Triggers</div><div class="brain-value">${p.audience_triggers || '—'}</div></div>
        <div class="brain-section"><div class="brain-label">Niche Position</div><div class="brain-value">${p.niche_positioning || '—'}</div></div>
        <div class="brain-section"><div class="brain-label">Visual Style</div><div class="brain-value">${p.visual_style || '—'}</div></div>
        <details class="brain-discovery"><summary>Find Similar Creators</summary><div class="brain-value" style="margin-top:8px">${p.discovery_brief || '—'}</div></details>
        <div style="font-size:10px;color:var(--text-dim);margin-top:10px;text-align:right">Built ${timeAgo(p.built_at)}</div>
      </div>`;
    }).join('');
  } catch {
    grid.innerHTML = '<div style="color:var(--red);font-size:13px;padding:20px">Failed to load profiles.</div>';
  }
}

async function rebuildProfile(accountId) {
  toast('Rebuilding profile...', '');
  try {
    await api('/api/brain/build', { method: 'POST', body: { accountId } });
    toast('Profile rebuilt', 'success');
    loadBrainProfiles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeProfile(accountId, username) {
  if (!confirm(`Remove @${username} from the Brain? Their intelligence profile will be deleted.`)) return;
  try {
    await api(`/api/brain/profiles/${accountId}`, { method: 'DELETE' });
    toast(`@${username} removed from Brain`, 'success');
    loadBrainProfiles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────────

async function renderAdmin() {
  const el = $('#page-admin');
  el.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">Admin — <span class="accent">Access Control</span></h2>
      <p class="page-subtitle">Manage users, roles, and manager–client assignments</p>
    </div>
    <div style="max-width:760px">

      <!-- Create User -->
      <div class="settings-card" style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:14px">Create New User</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Name</label>
            <input id="admin-new-name" type="text" placeholder="Full name">
          </div>
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Email</label>
            <input id="admin-new-email" type="email" placeholder="user@example.com">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Password (min 8 chars)</label>
            <input id="admin-new-password" type="password" placeholder="••••••••">
          </div>
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Role</label>
            <select id="admin-new-role">
              <option value="client">Client — Feed + Agents only</option>
              <option value="manager">Manager — Full access, up to 10 clients</option>
              <option value="admin">Admin — God mode</option>
            </select>
          </div>
        </div>
        <button class="btn btn-accent" id="admin-create-btn">Create User</button>
        <div id="admin-create-error" style="display:none;margin-top:10px;padding:9px 12px;background:rgba(255,69,58,0.08);border:1px solid rgba(255,69,58,0.25);border-radius:8px;color:var(--red);font-size:13px"></div>
      </div>

      <!-- All Users -->
      <div class="settings-card" style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:14px">All Users</div>
        <div id="admin-user-list">Loading...</div>
      </div>

      <!-- Activity Log -->
      <div class="settings-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:var(--text-sub);text-transform:uppercase;letter-spacing:0.05em">Activity Log</div>
          <button class="btn" style="font-size:11px;padding:4px 10px" id="admin-log-refresh">Refresh</button>
        </div>
        <div id="admin-activity-log">Loading...</div>
      </div>

    </div>
  `;

  $('#admin-create-btn').addEventListener('click', async () => {
    const btn = $('#admin-create-btn');
    const errEl = $('#admin-create-error');
    const name     = $('#admin-new-name').value.trim();
    const email    = $('#admin-new-email').value.trim();
    const password = $('#admin-new-password').value;
    const role     = $('#admin-new-role').value;
    errEl.style.display = 'none';
    if (!name || !email || !password) { errEl.textContent = 'All fields required'; errEl.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
      await api('/api/admin/users', { method: 'POST', body: { name, email, password, role } });
      $('#admin-new-name').value = '';
      $('#admin-new-email').value = '';
      $('#admin-new-password').value = '';
      toast(`User "${name}" created as ${role}`, 'success');
      loadAdminUsers();
    } catch (err) {
      errEl.textContent = err.message || 'Failed to create user';
      errEl.style.display = 'block';
    }
    btn.disabled = false; btn.textContent = 'Create User';
  });

  $('#admin-log-refresh').addEventListener('click', loadActivityLog);

  loadAdminUsers();
  loadActivityLog();
}

const ROLE_COLORS = { admin: 'var(--accent)', manager: 'var(--cyan)', client: 'var(--green)' };
const ROLE_BG     = { admin: 'var(--accent-soft)', manager: 'var(--cyan-soft)', client: 'var(--green-soft)' };

function rolePill(role) {
  const c = ROLE_COLORS[role] || 'var(--text-dim)';
  const b = ROLE_BG[role]     || 'var(--bg-3)';
  return `<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:2px 7px;border-radius:10px;background:${b};color:${c}">${role}</span>`;
}

async function loadAdminUsers() {
  const list = $('#admin-user-list');
  if (!list) return;
  try {
    const users = await api('/api/admin/users');
    if (!users.length) { list.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No users yet.</div>'; return; }
    list.innerHTML = users.map(u => {
      const role = u.role || (u.is_admin ? 'admin' : 'client');
      const isSelf = currentUser && u.id === currentUser.id;
      return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-size:14px;font-weight:500;color:var(--text-main)">${u.name}</span>
              ${rolePill(role)}
              ${role === 'manager' ? `<span style="font-size:10px;color:var(--text-dim)">${u.client_count}/10 clients</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:2px">${u.email} · Joined ${new Date(u.created_at).toLocaleDateString()}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            ${isSelf ? '<span style="font-size:11px;color:var(--text-dim)">You</span>' : `
              <select class="agent-select" style="font-size:11px;padding:4px 8px;width:auto" onchange="adminChangeRole(${u.id}, this.value, this)">
                <option value="client"  ${role==='client'  ? 'selected' : ''}>Client</option>
                <option value="manager" ${role==='manager' ? 'selected' : ''}>Manager</option>
                <option value="admin"   ${role==='admin'   ? 'selected' : ''}>Admin</option>
              </select>
              <button class="btn btn-danger" style="padding:4px 10px;font-size:11px" onclick="adminDeleteUser(${u.id}, '${u.name.replace(/'/g, "\\'")}')">Remove</button>
            `}
          </div>
        </div>
        ${role === 'manager' ? `<div id="mc-panel-${u.id}" style="margin-top:10px"></div><button class="btn btn-dim" style="font-size:11px;padding:4px 10px;margin-top:6px" onclick="toggleManagerClients(${u.id})">Manage Clients ▾</button>` : ''}
      </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<div style="color:var(--red);font-size:13px">Failed to load users.</div>';
  }
}

async function adminChangeRole(userId, newRole, selectEl) {
  try {
    await api(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: { role: newRole } });
    toast(`Role updated to ${newRole}`, 'success');
    loadAdminUsers();
  } catch (err) {
    toast(err.message, 'error');
    selectEl.value = selectEl.dataset.prev || 'client';
  }
}

async function toggleManagerClients(managerId) {
  const panel = $(`#mc-panel-${managerId}`);
  if (!panel) return;
  if (panel.dataset.loaded) { panel.innerHTML = ''; delete panel.dataset.loaded; return; }
  panel.dataset.loaded = '1';
  panel.innerHTML = '<div style="color:var(--text-dim);font-size:12px">Loading...</div>';
  try {
    const [clients, allClients] = await Promise.all([
      api(`/api/admin/manager-clients/${managerId}`),
      api('/api/admin/users').then(u => u.filter(x => (x.role || (x.is_admin ? 'admin' : 'client')) === 'client')),
    ]);
    const assignedIds = new Set(clients.map(c => c.id));
    const available = allClients.filter(c => !assignedIds.has(c.id));
    panel.innerHTML = `
      <div style="background:var(--bg-3);border-radius:var(--radius-sm);padding:10px;font-size:12px">
        <div style="font-weight:600;color:var(--text-sub);margin-bottom:8px">Assigned Clients (${clients.length}/10)</div>
        ${clients.length ? clients.map(c => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
            <span style="color:var(--text-main)">${c.name} <span style="color:var(--text-dim)">${c.email}</span></span>
            <button class="btn btn-danger" style="font-size:10px;padding:2px 8px" onclick="adminUnassignClient(${managerId},${c.id})">Remove</button>
          </div>`).join('') : '<div style="color:var(--text-dim)">No clients assigned yet.</div>'}
        ${available.length ? `
          <div style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <select id="mc-add-${managerId}" class="agent-select" style="font-size:11px;padding:4px 8px;flex:1;min-width:140px">
              <option value="">— Add client —</option>
              ${available.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
            <button class="btn btn-cyan" style="font-size:11px;padding:4px 10px" onclick="adminAssignClient(${managerId})">Assign</button>
          </div>` : clients.length >= 10 ? '<div style="color:var(--amber);margin-top:6px;font-size:11px">Cap reached (10/10)</div>' : ''}
      </div>`;
  } catch {
    panel.innerHTML = '<div style="color:var(--red);font-size:12px">Failed to load.</div>';
  }
}

async function adminAssignClient(managerId) {
  const sel = $(`#mc-add-${managerId}`);
  const clientId = sel?.value ? parseInt(sel.value) : null;
  if (!clientId) return;
  try {
    await api('/api/admin/manager-clients', { method: 'POST', body: { managerId, clientId } });
    toast('Client assigned', 'success');
    const panel = $(`#mc-panel-${managerId}`);
    if (panel) { delete panel.dataset.loaded; panel.innerHTML = ''; }
    toggleManagerClients(managerId);
    loadAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function adminUnassignClient(managerId, clientId) {
  try {
    await api(`/api/admin/manager-clients/${managerId}/${clientId}`, { method: 'DELETE' });
    toast('Client removed', 'success');
    const panel = $(`#mc-panel-${managerId}`);
    if (panel) { delete panel.dataset.loaded; panel.innerHTML = ''; }
    toggleManagerClients(managerId);
    loadAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadActivityLog() {
  const logEl = $('#admin-activity-log');
  if (!logEl) return;
  try {
    const logs = await api('/api/admin/logs');
    if (!logs.length) { logEl.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No activity recorded yet.</div>'; return; }
    logEl.innerHTML = `<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;max-height:320px;overflow-y:auto">` +
      logs.map(l => {
        const role = l.user_role || 'unknown';
        const c = ROLE_COLORS[role] || 'var(--text-dim)';
        const details = l.details ? (() => { try { return JSON.stringify(JSON.parse(l.details), null, 0).replace(/[{}]/g,'').replace(/"/g,''); } catch { return l.details; } })() : '';
        return `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid var(--border);align-items:baseline">
          <span style="color:var(--text-dim);white-space:nowrap;flex-shrink:0">${l.created_at?.replace('T',' ').substring(0,16) || ''}</span>
          <span style="color:${c};flex-shrink:0;font-weight:700">${(l.user_name||'system').substring(0,14)}</span>
          <span style="color:var(--text-main)">${l.action}</span>
          ${details ? `<span style="color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${details}</span>` : ''}
        </div>`;
      }).join('') + '</div>';
  } catch {
    logEl.innerHTML = '<div style="color:var(--red);font-size:13px">Failed to load log.</div>';
  }
}

async function adminDeleteUser(id, name) {
  if (!confirm(`Remove "${name}"? They will lose access immediately.`)) return;
  try {
    await api(`/api/admin/users/${id}`, { method: 'DELETE' });
    toast(`"${name}" removed`, 'success');
    loadAdminUsers();
  } catch (err) {
    toast(err.message || 'Failed to remove user', 'error');
  }
}

// ── Messages (Chat) ───────────────────────────────────────────────────────────

let chatState = { roomId: null, lastId: 0, pollTimer: null, sidebarTimer: null };

function renderMessages() {
  const pg = $('#page-messages');
  pg.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Messages</h1>
    </div>
    <div class="chat-layout">
      <div class="chat-sidebar" id="chat-sidebar">
        <div class="chat-sidebar-header">Conversations</div>
        <div id="chat-room-list"><div class="empty-state" style="padding:16px;font-size:13px">Loading…</div></div>
      </div>
      <div class="chat-main" id="chat-main">
        <div class="chat-empty-state" id="chat-placeholder">
          <div style="font-size:32px;margin-bottom:8px">✉</div>
          <div style="font-size:14px;color:var(--text-dim)">Select a conversation to start messaging</div>
        </div>
      </div>
    </div>`;
  loadChatRooms();
  // Keep sidebar unread counts fresh even when no room is open
  if (chatState.sidebarTimer) clearInterval(chatState.sidebarTimer);
  chatState.sidebarTimer = setInterval(() => {
    if (currentPage !== 'messages') { clearInterval(chatState.sidebarTimer); chatState.sidebarTimer = null; return; }
    if (!chatState.roomId) { loadChatRooms(); updateChatBadge(); }
  }, 3000);
}

async function loadChatRooms() {
  try {
    const [rooms, peers] = await Promise.all([
      fetch('/api/chat/rooms').then(r => r.json()),
      fetch('/api/chat/peers').then(r => r.json()),
    ]);

    const roomsByPeer = {};
    for (const r of rooms) roomsByPeer[r.peer_id] = r;

    // Rooms whose peer isn't in manager_clients (e.g. admin-initiated conversations)
    const peerIds = new Set(peers.map(p => p.id));
    const extraRooms = Array.isArray(rooms) ? rooms.filter(r => !peerIds.has(r.peer_id)) : [];

    const listEl = $('#chat-room-list');
    if (!peers.length && !extraRooms.length) {
      listEl.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text-dim)">No contacts yet.</div>';
      return;
    }

    function roomItem(peerId, name, room) {
      const unread = room?.unread_count || 0;
      const preview = room?.last_message ? room.last_message.substring(0, 36) + (room.last_message.length > 36 ? '…' : '') : 'Start a conversation';
      const active = chatState.roomId && room?.id === chatState.roomId ? ' active' : '';
      return `<div class="chat-room-item${active}" data-peer="${peerId}" data-name="${name}" onclick="openRoom(${peerId}, '${name.replace(/'/g, "\\'")}')">
        <div class="chat-room-avatar">${initials(name)}</div>
        <div class="chat-room-info">
          <div class="chat-room-name">${name} ${unread ? `<span class="chat-unread-dot">${unread}</span>` : ''}</div>
          <div class="chat-room-preview">${preview}</div>
        </div>
      </div>`;
    }

    const peerItems  = peers.map(p => roomItem(p.id, p.name, roomsByPeer[p.id]));
    const extraItems = extraRooms.map(r => roomItem(r.peer_id, r.peer_name || 'Unknown', r));

    listEl.innerHTML = [...peerItems, ...extraItems].join('');

    // Keep active highlight on the currently open room
    if (chatState.roomId) {
      const cur = rooms.find(r => r.id === chatState.roomId);
      if (cur) document.querySelector(`.chat-room-item[data-peer="${cur.peer_id}"]`)?.classList.add('active');
    }
  } catch (e) {
    $('#chat-room-list').innerHTML = `<div style="padding:16px;font-size:12px;color:var(--red)">${e.message}</div>`;
  }
}

async function openRoom(peerId, peerName) {
  stopChatPoller();

  // Get or create room
  let roomId;
  try {
    const r = await fetch('/api/chat/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId }),
    }).then(r => r.json());
    if (r.error) { toast(r.error, 'error'); return; }
    roomId = r.roomId;
  } catch (e) { toast(e.message, 'error'); return; }

  chatState.roomId = roomId;
  chatState.lastId = 0;

  // Highlight active room
  $$('.chat-room-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.peer) === peerId));

  const main = $('#chat-main');
  main.innerHTML = `
    <div class="chat-header">
      <div class="chat-header-avatar">${initials(peerName)}</div>
      <div class="chat-header-name">${peerName}</div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-bar">
      <textarea id="chat-input" class="chat-input" placeholder="Type a message…" rows="1"></textarea>
      <button class="btn btn-primary" id="chat-send-btn" onclick="sendChatMessage()">Send</button>
    </div>`;

  // Send on Enter (Shift+Enter for newline)
  $('#chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });

  await loadMessages(roomId);
  startChatPoller(roomId);
  updateChatBadge();
}

async function loadMessages(roomId, since = 0) {
  try {
    const res  = await fetch(`/api/chat/rooms/${roomId}/messages?since=${since}`);
    const msgs = await res.json();
    const container = $('#chat-messages');
    if (!container) return;

    if (!Array.isArray(msgs)) {
      if (since === 0) container.innerHTML = '<div class="chat-no-msgs">Could not load messages.</div>';
      return;
    }

    if (since === 0) container.innerHTML = '';
    if (!msgs.length) {
      if (since === 0) container.innerHTML = '<div class="chat-no-msgs">No messages yet. Say hello!</div>';
      return;
    }

    const noMsgs = container.querySelector('.chat-no-msgs');
    if (noMsgs) noMsgs.remove();

    const myId = currentUser?.id;
    for (const m of msgs) {
      const mine = m.sender_id === myId;
      const div = document.createElement('div');
      div.className = `chat-msg ${mine ? 'chat-msg-mine' : 'chat-msg-theirs'}`;
      div.innerHTML = `
        ${!mine ? `<div class="chat-msg-sender">${m.sender_name}</div>` : ''}
        <div class="chat-msg-bubble">${escapeHtml(m.body)}</div>
        <div class="chat-msg-time">${timeAgo(m.created_at)}</div>`;
      container.appendChild(div);
    }
    chatState.lastId = msgs[msgs.length - 1].id;
    container.scrollTop = container.scrollHeight;
  } catch { /* network error — silently skip */ }
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendChatMessage() {
  const input = $('#chat-input');
  const body = (input?.value || '').trim();
  if (!body || !chatState.roomId) return;
  input.value = '';
  input.style.height = '';
  try {
    const res  = await fetch(`/api/chat/rooms/${chatState.roomId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to send' }));
      toast(err.error || 'Failed to send', 'error');
      input.value = body;
      return;
    }
    await loadMessages(chatState.roomId, chatState.lastId);
    loadChatRooms();
  } catch (e) { toast(e.message, 'error'); }
}

function startChatPoller(roomId) {
  stopChatPoller();
  chatState.pollTimer = setInterval(async () => {
    if (currentPage !== 'messages' || chatState.roomId !== roomId) return stopChatPoller();
    await loadMessages(roomId, chatState.lastId);
    loadChatRooms();
    updateChatBadge();
  }, 3000);
}

function stopChatPoller() {
  if (chatState.pollTimer) { clearInterval(chatState.pollTimer); chatState.pollTimer = null; }
}

// ── Content Hub ───────────────────────────────────────────────────────────────

let contentMyClients = [];

async function renderContent() {
  const pg = $('#page-content');
  const role = currentUser?.role || 'client';
  const canCreate = role === 'admin' || role === 'manager';

  pg.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Content Hub</h1>
      ${canCreate ? `<button class="btn btn-primary" onclick="showContentModal()">+ New Item</button>` : ''}
    </div>
    <div class="filter-tabs" id="content-filter-tabs">
      <button class="filter-tab active" data-type="all"  onclick="filterContent('all', this)">All</button>
      <button class="filter-tab"        data-type="idea"   onclick="filterContent('idea', this)">Ideas</button>
      <button class="filter-tab"        data-type="report" onclick="filterContent('report', this)">Reports</button>
    </div>
    <div id="content-grid" class="content-grid"><div class="empty-state">Loading…</div></div>

    <div id="content-modal" class="modal-overlay hidden">
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <span class="modal-title" id="content-modal-title">New Content Item</span>
          <button class="modal-close" onclick="$('#content-modal').classList.add('hidden')">Close</button>
        </div>
        <div style="padding:18px;display:flex;flex-direction:column;gap:12px">
          <input type="hidden" id="content-edit-id">
          <div>
            <label class="settings-label">For Client</label>
            <select id="content-client-select" class="agent-select" style="width:100%"></select>
          </div>
          <div>
            <label class="settings-label">Type</label>
            <select id="content-type-select" class="agent-select" style="width:100%">
              <option value="idea">Idea</option>
              <option value="report">Report</option>
            </select>
          </div>
          <div>
            <label class="settings-label">Platform</label>
            <input id="content-platform" class="settings-input" placeholder="e.g. Instagram, TikTok" style="width:100%">
          </div>
          <div>
            <label class="settings-label">Title</label>
            <input id="content-title" class="settings-input" placeholder="Title" style="width:100%">
          </div>
          <div>
            <label class="settings-label">Details</label>
            <textarea id="content-body" class="settings-input" rows="5" placeholder="Describe the idea or report…" style="width:100%;resize:vertical"></textarea>
          </div>
          <button class="btn btn-primary" onclick="submitContentItem()">Save</button>
        </div>
      </div>
    </div>

    <div id="content-view-modal" class="modal-overlay hidden">
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <span class="modal-title" id="view-modal-title">Item</span>
          <button class="modal-close" onclick="$('#content-view-modal').classList.add('hidden')">Close</button>
        </div>
        <div id="content-view-body" style="padding:18px;font-size:14px;line-height:1.7;white-space:pre-wrap"></div>
      </div>
    </div>`;

  if (canCreate) {
    try {
      contentMyClients = await fetch('/api/my-clients').then(r => r.json());
      const sel = $('#content-client-select');
      if (sel) sel.innerHTML = contentMyClients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    } catch { contentMyClients = []; }
  }
  await loadContentItems('all');
}

let allContentItems = [];

async function loadContentItems(type = 'all') {
  const grid = $('#content-grid');
  if (!grid) return;
  try {
    allContentItems = await api('/api/content');
    renderContentGrid(allContentItems, type);
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">${e.message}</div>`;
  }
}

function renderContentGrid(items, type = 'all') {
  const grid = $('#content-grid');
  if (!grid) return;
  const filtered = type === 'all' ? items : items.filter(i => i.type === type);
  const role = currentUser?.role || 'client';
  const canEdit = role === 'admin' || role === 'manager';

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">No content items yet.</div>';
    return;
  }

  grid.innerHTML = filtered.map(item => `
    <div class="content-card" onclick="viewContentItem(${item.id})">
      <div class="content-card-header">
        <span class="content-type-badge content-type-${item.type}">${item.type.toUpperCase()}</span>
        ${item.platform ? `<span class="content-platform">${item.platform}</span>` : ''}
        ${canEdit ? `<button class="btn-icon" title="Delete" onclick="event.stopPropagation();deleteContentItem(${item.id})">✕</button>` : ''}
      </div>
      <div class="content-card-title">${item.title}</div>
      ${item.body ? `<div class="content-card-preview">${item.body.substring(0, 100)}${item.body.length > 100 ? '…' : ''}</div>` : ''}
      <div class="content-card-meta">
        ${item.client_name ? `For: <strong>${item.client_name}</strong> · ` : ''}
        By ${item.creator_name} · ${timeAgo(item.created_at)}
      </div>
    </div>`).join('');
}

function filterContent(type, btn) {
  $$('#content-filter-tabs .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderContentGrid(allContentItems, type);
}

function viewContentItem(id) {
  const item = allContentItems.find(i => i.id === id);
  if (!item) return;
  $('#view-modal-title').textContent = item.title;
  $('#content-view-body').innerHTML = `
    <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
      <span class="content-type-badge content-type-${item.type}">${item.type.toUpperCase()}</span>
      ${item.platform ? `<span class="content-platform">${item.platform}</span>` : ''}
    </div>
    <div>${item.body ? escapeHtml(item.body).replace(/\n/g, '<br>') : '<em style="color:var(--text-dim)">No details provided.</em>'}</div>
    <div style="margin-top:14px;font-size:12px;color:var(--text-dim)">
      Created by ${item.creator_name} · ${timeAgo(item.created_at)}
      ${item.client_name ? ` · For ${item.client_name}` : ''}
    </div>`;
  $('#content-view-modal').classList.remove('hidden');
}

function showContentModal(editId = null) {
  $('#content-edit-id').value = editId || '';
  $('#content-modal-title').textContent = editId ? 'Edit Item' : 'New Content Item';
  if (!editId) {
    $('#content-title').value = '';
    $('#content-body').value = '';
    $('#content-platform').value = '';
  } else {
    const item = allContentItems.find(i => i.id === editId);
    if (item) {
      $('#content-title').value = item.title;
      $('#content-body').value = item.body || '';
      $('#content-platform').value = item.platform || '';
      $('#content-type-select').value = item.type;
      $('#content-client-select').value = item.client_id;
    }
  }
  $('#content-modal').classList.remove('hidden');
}

async function submitContentItem() {
  const editId   = $('#content-edit-id').value;
  const clientId = $('#content-client-select').value;
  const type     = $('#content-type-select').value;
  const title    = $('#content-title').value.trim();
  const body     = $('#content-body').value.trim();
  const platform = $('#content-platform').value.trim();
  if (!title) { toast('Title is required', 'error'); return; }
  try {
    if (editId) {
      await api(`/api/content/${editId}`, { method: 'PATCH', body: { title, body, platform } });
    } else {
      if (!clientId) { toast('Select a client', 'error'); return; }
      await api('/api/content', { method: 'POST', body: { clientId: parseInt(clientId), type, title, body, platform } });
    }
    $('#content-modal').classList.add('hidden');
    toast('Saved', 'success');
    await loadContentItems($('#content-filter-tabs .filter-tab.active')?.dataset.type || 'all');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteContentItem(id) {
  if (!confirm('Delete this item?')) return;
  try {
    await api(`/api/content/${id}`, { method: 'DELETE' });
    toast('Deleted', 'success');
    await loadContentItems($('#content-filter-tabs .filter-tab.active')?.dataset.type || 'all');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Nav ───────────────────────────────────────────────────────────────────────
// Nav items are built dynamically by applyRoleNav() after /api/me resolves.
// hashchange guard is wired by applyRouteGuard().
window.addEventListener('hashchange', () => {
  const page = window.location.hash.replace('#', '');
  if (pages.includes(page)) navigate(page);
});

// ── Init ─────────────────────────────────────────────────────────────────────
const initPage = window.location.hash.replace('#', '') || 'dashboard';
navigate(initPage);
updateStats();
setInterval(updateStats, 30000);

const versionEl = document.getElementById('app-version');
if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

// ── Operator Info + RBAC bootstrap ───────────────────────────────────────────
let currentUser = null;
fetch('/api/me').then(r => r.json()).then(user => {
  currentUser = user;
  const role = user.role || (user.is_admin ? 'admin' : 'client');

  const nameEl = document.getElementById('operator-name');
  if (nameEl && user.name) nameEl.textContent = user.name;

  const roleEl = document.getElementById('operator-role');
  if (roleEl) {
    roleEl.textContent = role.toUpperCase();
    roleEl.dataset.role = role;
  }

  // Hide Execute Scan for clients
  const sidebarOps = document.querySelector('.sidebar-ops');
  if (sidebarOps && role === 'client') sidebarOps.style.display = 'none';

  // Build nav + route guards based on role
  applyRoleNav(role);
  applyRouteGuard(role);

  // Load client switcher for managers and admins
  if (role === 'manager' || role === 'admin') loadClientSwitcher(role);
}).catch(() => {});

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────
(function () {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const overlay = document.getElementById('sidebar-overlay');
  const sidebar = document.querySelector('.sidebar');
  if (!menuBtn || !overlay || !sidebar) return;

  function openSidebar() {
    sidebar.classList.add('mobile-open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  menuBtn.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);

  // Close drawer whenever a nav item is tapped on mobile
  $$('.nav-item').forEach(el => el.addEventListener('click', () => {
    if (window.innerWidth <= 600) closeSidebar();
  }));
}());
