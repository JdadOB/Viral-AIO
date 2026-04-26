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
  const s = brief.sections || {};
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

const AGENT_DEF = {
  captain:    { label: 'The Captain',    role: 'Quality Control & Humanizer', icon: 'C', color: '#FF9F0A', bg: 'rgba(255,159,10,0.12)' },
  strategist: { label: 'The Strategist', role: 'Viral Performance Reports',   icon: 'S', color: '#32ADE6', bg: 'rgba(50,173,230,0.12)' },
  writer:     { label: 'The Writer',     role: 'Caption Generator',           icon: 'W', color: '#30D158', bg: 'rgba(48,209,88,0.12)' },
  assistant:  { label: 'The Assistant',  role: 'Research & Intelligence',     icon: 'A', color: '#FF375F', bg: 'rgba(255,55,95,0.12)' },
  researcher: { label: 'The Researcher', role: 'Instagram Trend Analysis',    icon: 'R', color: '#FF9F0A', bg: 'rgba(255,159,10,0.12)' },
  organizer:  { label: 'The Organizer',  role: 'Brief Compiler & Reel Ideas', icon: 'O', color: '#BF5AF2', bg: 'rgba(191,90,242,0.12)' },
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
            ${accounts.map(a => `<option value="${a.username}">@${a.username} (${(a.followers_count||0).toLocaleString()} followers)</option>`).join('')}
          </select>
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

      <!-- RESEARCHER -->
      <div class="agent-card" id="agent-researcher">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.researcher.color};--icon-bg:${AGENT_DEF.researcher.bg}">R</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.researcher.label}</div>
            <div class="agent-role">${AGENT_DEF.researcher.role}</div>
          </div>
          <div class="agent-status idle" id="researcher-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <label>Niche or Topic</label>
          <input class="agent-input" id="researcher-niche" type="text" placeholder="e.g. fitness, fashion, luxury cars, cooking...">
          <label>Focus on Creator (optional)</label>
          <select class="agent-select" id="researcher-username">
            <option value="">— All tracked accounts —</option>
            ${accounts.map(a => `<option value="${a.username}">@${a.username}</option>`).join('')}
          </select>
          <button class="btn btn-accent" id="researcher-run-btn" style="width:100%;margin-top:10px;background:var(--orange);border-color:var(--orange)">Run Research</button>
          <div class="agent-output-panel" id="researcher-output"></div>
        </div>
      </div>

      <!-- ORGANIZER -->
      <div class="agent-card" id="agent-organizer">
        <div class="agent-header">
          <div class="agent-icon" style="--icon-color:${AGENT_DEF.organizer.color};--icon-bg:${AGENT_DEF.organizer.bg}">O</div>
          <div class="agent-meta">
            <div class="agent-name">${AGENT_DEF.organizer.label}</div>
            <div class="agent-role">${AGENT_DEF.organizer.role}</div>
          </div>
          <div class="agent-status idle" id="organizer-status" title="Status"></div>
        </div>
        <div class="agent-body">
          <p>Pulls the latest Researcher and Strategist outputs from the database and compiles them into a master brief with 10 ready-to-film reel ideas.</p>
          <label>Extra Context (optional)</label>
          <input class="agent-input" id="organizer-context" type="text" placeholder="e.g. launching a new product, targeting Gen Z...">
          <button class="btn btn-accent" id="organizer-run-btn" style="width:100%;margin-top:10px;background:var(--purple);border-color:var(--purple)">Compile Brief</button>
          <div class="agent-output-panel" id="organizer-output"></div>
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
    const username = $('#writer-username').value;
    if (!username) return toast('Select a profile first', 'error');
    const btn = $('#writer-run-btn');
    const contentGoal = $('#writer-goal').value.trim() || null;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Writing...';
    setAgentStatus('writer', 'running');
    try {
      const result = await api('/api/agents/writer', { method: 'POST', body: { username, contentGoal } });
      setAgentStatus('writer', 'done');
      showAgentOutput('writer-output', result.reviewed);
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

  // RESEARCHER
  $('#researcher-run-btn').addEventListener('click', async () => {
    const niche = $('#researcher-niche').value.trim();
    if (!niche) return toast('Enter a niche or topic first', 'error');
    const username = $('#researcher-username').value || null;
    const btn = $('#researcher-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Researching...';
    setAgentStatus('researcher', 'running');
    try {
      const result = await api('/api/agents/researcher', { method: 'POST', body: { niche, username } });
      setAgentStatus('researcher', 'done');
      showAgentOutput('researcher-output', result.reviewed);
      toast('Trend research ready', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('researcher', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run Research';
    }
  });

  // ORGANIZER
  $('#organizer-run-btn').addEventListener('click', async () => {
    const context = $('#organizer-context').value.trim() || null;
    const btn = $('#organizer-run-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Compiling...';
    setAgentStatus('organizer', 'running');
    try {
      const result = await api('/api/agents/organizer', { method: 'POST', body: { context } });
      setAgentStatus('organizer', 'done');
      showAgentOutput('organizer-output', result.reviewed);
      toast('Master brief ready', 'success');
      loadAgentHistory();
    } catch (err) {
      setAgentStatus('organizer', 'idle');
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Compile Brief';
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

// ── Operator Info ─────────────────────────────────────────────────────────────
fetch('/api/me').then(r => r.json()).then(user => {
  const el = document.getElementById('operator-name');
  if (el && user.name) el.textContent = user.name;
}).catch(() => {});
