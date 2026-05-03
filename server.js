// Load .env manually — dotenv has a parse issue with this file on Windows
(function loadEnv() {
  const fs = require('fs'), p = require('path').join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0 && !line.startsWith('#')) {
      const k = line.substring(0, eq).trim();
      const v = line.substring(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
})();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const https     = require('https');
const http      = require('http');
const session   = require('express-session');
const bcrypt    = require('bcryptjs');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const passport  = require('./auth');

const { db, getSetting, setSetting, getUserSetting, setUserSetting, seedUserDefaults } = require('./db');

class SQLiteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess, expired FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (Date.now() > row.expired) {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expired = Date.now() + ttl;
      db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expired);
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expired = Date.now() + ttl;
      db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(expired, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}
const { scrapeAccountPosts }         = require('./apify');
const { processNewPosts }            = require('./detector');
const { generateBrief }              = require('./brief');
const { pollAllAccounts, setupScheduler, restartScheduler, restartSchedulerForUser, setupDigestScheduler } = require('./scheduler');
const { runStrategist, runWriter, runAssistant, runCaptain, runIdeator, runProfileBuilder, runBulkCaptions, runIdeatorV2, refreshSingleCaption, refreshBulkSingleCaption } = require('./agents');

const app = express();
app.set('trust proxy', 1); // Fly.io (and most PaaS) terminate TLS at the edge; trust X-Forwarded-Proto
const SESSION_SECRET = (() => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET env var must be set and at least 32 characters');
    }
    console.warn('[Security] SESSION_SECRET not set — using a random ephemeral secret (sessions will not survive restarts)');
    return require('crypto').randomBytes(32).toString('hex');
  }
  return s;
})();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN, credentials: true } : false));
app.use(express.json({ limit: '50mb' }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore(),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));
app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — app uses inline scripts; tighten later
app.use(passport.initialize());
app.use(passport.session());
app.use(buildScopeMiddleware());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const agentLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.isAuthenticated() && (req.user.role === 'admin' || req.user.is_admin)) return next();
  res.status(403).json({ error: 'Forbidden' });
}

// ── RBAC helpers ──────────────────────────────────────────────────────────────

function userRole(user) {
  if (!user) return null;
  return user.role || (user.is_admin ? 'admin' : 'client');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(userRole(req.user))) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

const requireManager    = requireRole('admin', 'manager');
const requireClientOrUp = requireRole('admin', 'manager', 'client');

// Resolve which user's data to scope to.
// Managers pass ?as=CLIENT_ID to view a client's workspace.
// Applied globally so every authenticated route inherits req.scopedUserId.
function buildScopeMiddleware() {
  return (req, res, next) => {
    if (!req.isAuthenticated()) { req.scopedUserId = null; return next(); }
    const role = userRole(req.user);
    const asId = req.query.as ? parseInt(req.query.as) : null;
    if (!asId || isNaN(asId)) { req.scopedUserId = req.user.id; return next(); }
    if (role === 'admin') { req.scopedUserId = asId; return next(); }
    if (role === 'manager') {
      const link = db.prepare('SELECT 1 FROM manager_clients WHERE manager_id = ? AND client_id = ?').get(req.user.id, asId);
      if (!link) return res.status(404).json({ error: 'Not found' });
      req.scopedUserId = asId;
      return next();
    }
    // clients cannot impersonate anyone
    req.scopedUserId = req.user.id;
    next();
  };
}

function checkClientCap(req, res, next) {
  if (userRole(req.user) !== 'manager') return next();
  const { count } = db.prepare('SELECT COUNT(*) as count FROM manager_clients WHERE manager_id = ?').get(req.user.id);
  if (count >= 10) return res.status(403).json({ error: 'Client limit reached — managers may manage a maximum of 10 clients.' });
  next();
}

function logActivity(userId, userName, role, action, details = null) {
  try {
    db.prepare('INSERT INTO activity_log (user_id, user_name, user_role, action, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId || null, userName || null, role || null, action, details ? JSON.stringify(details) : null);
  } catch (e) { /* non-critical */ }
}

// Serve static assets without auth (CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Auth routes (no auth required)
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Registration is admin-only — no public sign-up
app.post('/auth/register', authLimiter, (req, res) => res.status(403).json({ error: 'Registration is disabled. Contact the administrator.' }));

app.post('/auth/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    req.login(user, err => {
      if (err) return next(err);
      logActivity(user.id, user.name, userRole(user), 'login');
      res.json({ success: true, role: userRole(user) });
    });
  })(req, res, next);
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

app.get('/api/me', requireAuth, (req, res) => {
  const { id, email, name, avatar_url, is_admin } = req.user;
  const role = userRole(req.user);
  res.json({ id, email, name, avatar_url, is_admin: !!is_admin, role });
});

// ── Admin routes ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.is_admin, u.role, u.created_at,
      (SELECT COUNT(*) FROM manager_clients WHERE manager_id = u.id) as client_count
    FROM users u ORDER BY u.created_at ASC
  `).all();
  res.json(users);
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { email, password, name, role = 'client' } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email, and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'manager', 'client'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const hash = bcrypt.hashSync(password, 12);
  const isAdmin = role === 'admin' ? 1 : 0;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (email, password_hash, name, role, is_admin) VALUES (?, ?, ?, ?, ?)'
  ).run(email.toLowerCase().trim(), hash, name.trim(), role, isAdmin);
  seedUserDefaults(lastInsertRowid);
  restartSchedulerForUser(lastInsertRowid);
  logActivity(req.user.id, req.user.name, userRole(req.user), 'user_created', { newUser: name.trim(), role });
  res.json({ success: true, id: lastInsertRowid });
});

app.patch('/api/admin/users/:id/role', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id);
  const { role } = req.body;
  if (!['admin', 'manager', 'client'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });
  const isAdmin = role === 'admin' ? 1 : 0;
  db.prepare('UPDATE users SET role = ?, is_admin = ? WHERE id = ?').run(role, isAdmin, targetId);
  if (role !== 'manager') db.prepare('DELETE FROM manager_clients WHERE manager_id = ?').run(targetId);
  const target = db.prepare('SELECT name FROM users WHERE id = ?').get(targetId);
  logActivity(req.user.id, req.user.name, userRole(req.user), 'role_changed', { userId: targetId, userName: target?.name, newRole: role });
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const target = db.prepare('SELECT name FROM users WHERE id = ?').get(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  // Invalidate any active sessions for the deleted user
  db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.passport.user') = ?").run(targetId);
  logActivity(req.user.id, req.user.name, userRole(req.user), 'user_deleted', { userId: targetId, userName: target?.name });
  res.json({ success: true });
});

// Manager ↔ Client assignment
app.get('/api/admin/manager-clients/:managerId', requireAdmin, (req, res) => {
  const managerId = parseInt(req.params.managerId);
  const clients = db.prepare(`
    SELECT u.id, u.name, u.email, mc.assigned_at
    FROM manager_clients mc JOIN users u ON mc.client_id = u.id
    WHERE mc.manager_id = ? ORDER BY mc.assigned_at ASC
  `).all(managerId);
  res.json(clients);
});

app.post('/api/admin/manager-clients', requireAdmin, checkClientCap, (req, res) => {
  const { managerId, clientId } = req.body;
  if (!managerId || !clientId) return res.status(400).json({ error: 'managerId and clientId required' });
  const manager = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'manager'").get(managerId);
  const client  = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'client'").get(clientId);
  if (!manager) return res.status(400).json({ error: 'Manager not found' });
  if (!client)  return res.status(400).json({ error: 'Client not found' });
  try {
    db.prepare('INSERT INTO manager_clients (manager_id, client_id) VALUES (?, ?)').run(managerId, clientId);
    logActivity(req.user.id, req.user.name, userRole(req.user), 'client_assigned', { managerId, clientId });
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Already assigned' });
    throw e;
  }
});

// Middleware for checkClientCap needs to know which manager to check
function checkClientCapForManager(req, res, next) {
  const managerId = parseInt(req.body.managerId);
  if (!managerId) return next();
  const { count } = db.prepare('SELECT COUNT(*) as count FROM manager_clients WHERE manager_id = ?').get(managerId);
  if (count >= 10) return res.status(403).json({ error: 'Client limit reached — managers may manage a maximum of 10 clients.' });
  next();
}

app.delete('/api/admin/manager-clients/:managerId/:clientId', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM manager_clients WHERE manager_id = ? AND client_id = ?')
    .run(parseInt(req.params.managerId), parseInt(req.params.clientId));
  logActivity(req.user.id, req.user.name, userRole(req.user), 'client_unassigned', { managerId: req.params.managerId, clientId: req.params.clientId });
  res.json({ success: true });
});

// My clients (for manager sidebar switcher)
app.get('/api/my-clients', requireManager, (req, res) => {
  const role = userRole(req.user);
  if (role === 'admin') {
    const clients = db.prepare("SELECT id, name, email FROM users WHERE role = 'client' ORDER BY name ASC").all();
    return res.json(clients);
  }
  const clients = db.prepare(`
    SELECT u.id, u.name, u.email FROM manager_clients mc
    JOIN users u ON mc.client_id = u.id
    WHERE mc.manager_id = ? ORDER BY u.name ASC
  `).all(req.user.id);
  res.json(clients);
});

// Activity log (admin only)
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const logs = db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json(logs);
});

// Main app — auth required
// Waitlist email capture
app.post('/api/waitlist', (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run('waitlist_' + Date.now() + '_' + Math.random().toString(36).slice(2), email);
    console.log('[Waitlist]', email);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: view waitlist submissions
app.get('/api/admin/waitlist', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'waitlist_%' ORDER BY key DESC").all();
    const entries = rows.map(r => {
      const parts = r.key.split('_');
      const ts = parseInt(parts[1]) || 0;
      return { email: r.value, submittedAt: ts ? new Date(ts).toISOString() : 'unknown' };
    });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Outreach engine
const { scanReddit } = require('./reddit-module');
app.post('/api/admin/outreach/reddit', requireAdmin, async (req, res) => {
  try {
    const prospects = await scanReddit();
    res.json(prospects);
  } catch (err) {
    console.error('[Outreach:Reddit]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Payment success page
app.get('/payment-success', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'payment-success.html')));

// Legal pages
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// Public landing page
app.get('/landing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/landing');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Accounts ─────────────────────────────────────────────────────────────────

app.get('/api/accounts', requireAuth, (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM alerts WHERE account_id = a.id) as total_alerts,
      (SELECT COUNT(*) FROM alerts WHERE account_id = a.id AND viewed = 0) as unread_alerts
    FROM accounts a
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
  `).all(_req.scopedUserId);
  res.json(rows);
});

app.post('/api/accounts', requireManager, async (req, res) => {
  const { username, group_name } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  // Managers capped at 10 tracked creators per workspace
  if (userRole(req.user) === 'manager') {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE user_id = ?').get(req.scopedUserId);
    if (count >= 10) return res.status(403).json({ error: 'Creator limit reached — managers can track a maximum of 10 creators.' });
  }

  const clean = username.replace('@', '').toLowerCase().trim();
  const exists = db.prepare('SELECT id FROM accounts WHERE username = ? AND user_id = ?').get(clean, req.scopedUserId);
  if (exists) return res.status(409).json({ error: 'Account already tracked' });

  const { lastInsertRowid: accountId } = db.prepare(
    'INSERT INTO accounts (username, group_name, user_id) VALUES (?, ?, ?)'
  ).run(clean, group_name || 'Default', req.scopedUserId);
  logActivity(req.user.id, req.user.name, userRole(req.user), 'account_added', { username: clean, scopedUserId: req.scopedUserId });

  res.status(202).json({ id: accountId, username: clean, message: 'Added — initial scrape running in background' });

  setImmediate(async () => {
    try {
      console.log(`[Setup] Initial scrape for @${clean}`);
      const posts = await scrapeAccountPosts(clean, { limit: 30, parentData: true });
      processNewPosts(accountId, posts);
      db.prepare("UPDATE accounts SET last_scan_status = 'ok', last_scan_error = NULL WHERE id = ?").run(accountId);
      console.log(`[Setup] Done — ${posts.length} posts for @${clean}`);
    } catch (err) {
      console.error(`[Setup] Failed for @${clean}:`, err.message);
    }
  });
});

app.patch('/api/accounts/:id', requireManager, (req, res) => {
  const { group_name } = req.body;
  const account = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.scopedUserId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  if (group_name !== undefined)
    db.prepare('UPDATE accounts SET group_name = ? WHERE id = ?').run(group_name, account.id);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id));
});

app.post('/api/accounts/:id/poll', requireManager, (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.scopedUserId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json({ message: `Scanning @${account.username}` });
  const { pollAccount } = require('./scheduler');
  pollAccount(account).catch(console.error);
});

app.delete('/api/accounts/:id', requireManager, (req, res) => {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.scopedUserId);
  if (!account) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
  logActivity(req.user.id, req.user.name, userRole(req.user), 'account_deleted', { accountId: account.id });
  res.json({ success: true });
});

app.post('/api/accounts/bulk-delete', requireManager, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
  const uid = req.scopedUserId;
  let deleted = 0;
  const del = db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?');
  for (const id of ids) {
    const info = del.run(id, uid);
    deleted += info.changes;
  }
  res.json({ success: true, deleted });
});

// ── Groups ────────────────────────────────────────────────────────────────────

app.get('/api/groups', requireAuth, (req, res) => {
  const uid = req.scopedUserId;

  // Seed any account group_names that aren't in user_groups yet (migration for existing users)
  const accountGroups = db.prepare(
    "SELECT DISTINCT group_name FROM accounts WHERE user_id = ? AND group_name IS NOT NULL"
  ).all(req.scopedUserId);
  for (const { group_name } of accountGroups) {
    db.prepare('INSERT OR IGNORE INTO user_groups (user_id, name) VALUES (?, ?)').run(req.scopedUserId, group_name);
  }

  const rows = db.prepare(`
    SELECT ug.name as group_name, COUNT(a.id) as count
    FROM user_groups ug
    LEFT JOIN accounts a ON a.group_name = ug.name AND a.user_id = ug.user_id
    WHERE ug.user_id = ?
    GROUP BY ug.name ORDER BY ug.name
  `).all(req.scopedUserId);
  res.json(rows);
});

app.post('/api/groups', requireManager, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    db.prepare('INSERT INTO user_groups (user_id, name) VALUES (?, ?)').run(req.scopedUserId, name.trim());
    res.json({ success: true, name: name.trim() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Group already exists' });
    throw err;
  }
});

app.delete('/api/groups/:name', requireManager, (req, res) => {
  const groupName = decodeURIComponent(req.params.name);
  db.prepare("UPDATE accounts SET group_name = 'Default' WHERE group_name = ? AND user_id = ?").run(groupName, req.scopedUserId);
  db.prepare("DELETE FROM user_groups WHERE name = ? AND user_id = ?").run(groupName, req.scopedUserId);
  res.json({ success: true });
});

// ── Alerts ────────────────────────────────────────────────────────────────────

app.get('/api/alerts', requireAuth, (req, res) => {
  const { filter, sort, group } = req.query;
  const where = filter === 'unread'    ? 'AND al.viewed = 0 AND al.dismissed = 0'
              : filter === 'acted_on'  ? 'AND al.acted_on = 1'
              : 'AND al.dismissed = 0';

  const groupWhere = group ? 'AND acc.group_name = ?' : '';

  const orderBy = sort === 'engagement' ? 'al.engagement_rate DESC'
                : sort === 'views'      ? 'p.plays_count DESC'
                : 'al.triggered_at DESC';

  const rows = db.prepare(`
    SELECT
      al.id, al.multiplier, al.engagement_rate, al.account_avg_rate,
      al.triggered_at, al.viewed, al.acted_on,
      p.post_url, p.post_type, p.thumbnail_url, p.caption,
      p.likes_count, p.comments_count, p.plays_count, p.posted_at,
      acc.username, acc.full_name, acc.followers_count, acc.profile_pic_url, acc.group_name,
      b.content AS brief_content
    FROM alerts al
    JOIN posts p      ON al.post_id    = p.id
    JOIN accounts acc ON al.account_id = acc.id
    LEFT JOIN briefs b ON b.alert_id   = al.id
    WHERE acc.user_id = ? ${where} ${groupWhere}
    ORDER BY ${orderBy}
    LIMIT 200
  `).all(...(group ? [req.scopedUserId, group] : [req.scopedUserId]));

  res.json(rows.map(r => {
    let brief = null;
    if (r.brief_content) {
      try { brief = JSON.parse(r.brief_content); } catch { brief = null; }
    }
    return { ...r, brief, brief_content: undefined };
  }));
});

app.patch('/api/alerts/:id/viewed', requireAuth, (req, res) => {
  db.prepare('UPDATE alerts SET viewed = 1 WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(req.params.id, req.scopedUserId);
  res.json({ success: true });
});

app.patch('/api/alerts/:id/acted-on', requireAuth, (req, res) => {
  const { acted_on } = req.body;
  db.prepare('UPDATE alerts SET acted_on = ? WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(acted_on ? 1 : 0, req.params.id, req.scopedUserId);
  res.json({ success: true });
});

app.patch('/api/alerts/:id/dismiss', requireAuth, (req, res) => {
  db.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(req.params.id, req.scopedUserId);
  res.json({ success: true });
});

app.delete('/api/alerts/acted-on', requireAuth, (req, res) => {
  const info = db.prepare('UPDATE alerts SET dismissed = 1 WHERE acted_on = 1 AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(req.scopedUserId);
  res.json({ success: true, dismissed: info.changes });
});

app.post('/api/alerts/:id/brief', requireAuth, async (req, res) => {
  try {
    const alertId = parseInt(req.params.id, 10);
    const owned = db.prepare(`
      SELECT al.id FROM alerts al
      JOIN accounts acc ON al.account_id = acc.id
      WHERE al.id = ? AND acc.user_id = ?
    `).get(alertId, req.scopedUserId);
    if (!owned) return res.status(404).json({ error: 'Not found' });
    const brief = await generateBrief(alertId);
    res.json(brief);
  } catch (err) {
    console.error('[Brief]', err.message);
    res.status(500).json({ error: 'Failed to generate brief' });
  }
});

// ── Browser Scrape (for age-restricted / private accounts) ────────────────────

app.post('/api/browser-scrape', requireManager, (req, res) => {
  const { username, followers_count, full_name, profile_pic_url, posts } = req.body;
  if (!username || !Array.isArray(posts) || posts.length === 0)
    return res.status(400).json({ error: 'username and posts[] required' });

  const clean = username.replace('@', '').toLowerCase().trim();

  let account = db.prepare('SELECT * FROM accounts WHERE username = ? AND user_id = ?').get(clean, req.scopedUserId);
  if (!account) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO accounts (username, group_name, followers_count, full_name, profile_pic_url, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(clean, 'Default', followers_count || 0, full_name || null, profile_pic_url || null, req.scopedUserId);
    account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(lastInsertRowid);
  } else if (followers_count) {
    db.prepare('UPDATE accounts SET followers_count = ?, full_name = COALESCE(?, full_name), profile_pic_url = COALESCE(?, profile_pic_url) WHERE id = ?')
      .run(followers_count, full_name || null, profile_pic_url || null, account.id);
    account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id);
  }

  const apifyPosts = posts.map(p => ({
    id: p.shortcode,
    shortCode: p.shortcode,
    url: `https://www.instagram.com/p/${p.shortcode}/`,
    likesCount: p.likes || 0,
    commentsCount: p.comments || 0,
    videoPlayCount: p.plays || 0,
    followersCount: followers_count || account.followers_count || 1,
    type: p.type === 'XDTGraphVideo' ? 'Video' : p.type === 'XDTGraphSidecar' ? 'Sidecar' : 'Image',
    displayUrl: p.thumbnail || null,
    caption: p.caption || null,
    timestamp: p.timestamp || null,
    ownerFullName: full_name || null,
    profilePicUrl: profile_pic_url || null,
  }));

  const alerts = processNewPosts(account.id, apifyPosts);
  console.log(`[BrowserScrape] @${clean}: ${posts.length} posts, ${alerts.length} new alerts`);
  res.json({ success: true, username: clean, postsProcessed: posts.length, newAlerts: alerts.length });
});

// ── Poll ──────────────────────────────────────────────────────────────────────

app.post('/api/poll', requireManager, (req, res) => {
  res.json({ message: 'Poll started' });
  pollAllAccounts().catch(console.error);
});

app.get('/api/google-configured', requireAuth, (_req, res) => {
  res.json({ configured: !!process.env.GOOGLE_CLIENT_ID });
});

// ── Image Proxy (bypasses Instagram hotlink protection) ───────────────────────

app.get('/api/img', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).end(); }

  if (parsed.protocol !== 'https:') return res.status(400).end();

  const allowed = ['instagram.com', 'cdninstagram.com', 'fbcdn.net', 'scontent.cdninstagram.com'];
  const domainAllowed = d => parsed.hostname === d || parsed.hostname.endsWith('.' + d);
  if (!allowed.some(domainAllowed)) return res.status(403).end();

  const request = https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.instagram.com/',
    },
    timeout: 10000,
  }, (upstream) => {
    if (upstream.statusCode !== 200) return res.status(502).end();
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    upstream.pipe(res);
  });
  request.on('timeout', () => { request.destroy(); res.status(504).end(); });
  request.on('error', () => res.status(502).end());
});

// ── Stats ─────────────────────────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  const uid = req.user.id;
  res.json({
    totalAccounts: db.prepare('SELECT COUNT(*) as c FROM accounts WHERE user_id = ?').get(req.scopedUserId).c,
    totalAlerts:   db.prepare('SELECT COUNT(*) as c FROM alerts al JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ?').get(req.scopedUserId).c,
    unreadAlerts:  db.prepare('SELECT COUNT(*) as c FROM alerts al JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ? AND al.viewed = 0').get(req.scopedUserId).c,
    actedOn:       db.prepare('SELECT COUNT(*) as c FROM alerts al JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ? AND al.acted_on = 1').get(req.scopedUserId).c,
    totalBriefs:   db.prepare('SELECT COUNT(*) as c FROM briefs b JOIN alerts al ON b.alert_id = al.id JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ?').get(req.scopedUserId).c,
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', requireManager, (req, res) => {
  const uid = req.scopedUserId;
  res.json({
    polling_interval_minutes:    getUserSetting(uid, 'polling_interval_minutes'),
    viral_threshold_multiplier:  getUserSetting(uid, 'viral_threshold_multiplier'),
    velocity_threshold:          getUserSetting(uid, 'velocity_threshold'),
    discord_channel_id:          getUserSetting(uid, 'discord_channel_id') || '',
    discord_bot_configured:      !!process.env.DISCORD_BOT_TOKEN,
    discord_digest_enabled:      getUserSetting(uid, 'discord_digest_enabled') || '0',
    discord_digest_time:         getUserSetting(uid, 'discord_digest_time')    || '09:00',
  });
});

app.post('/api/settings', requireManager, (req, res) => {
  const uid = req.scopedUserId;
  logActivity(req.user.id, req.user.name, userRole(req.user), 'settings_changed');
  const {
    polling_interval_minutes, viral_threshold_multiplier, velocity_threshold,
    discord_channel_id, discord_digest_enabled, discord_digest_time,
  } = req.body;
  if (polling_interval_minutes)   setUserSetting(uid, 'polling_interval_minutes',   polling_interval_minutes);
  if (viral_threshold_multiplier) setUserSetting(uid, 'viral_threshold_multiplier', viral_threshold_multiplier);
  if (velocity_threshold)         setUserSetting(uid, 'velocity_threshold',          velocity_threshold);
  if (discord_channel_id    !== undefined) setUserSetting(uid, 'discord_channel_id',    discord_channel_id);
  if (discord_digest_enabled !== undefined) setUserSetting(uid, 'discord_digest_enabled', discord_digest_enabled ? '1' : '0');
  if (discord_digest_time    !== undefined) setUserSetting(uid, 'discord_digest_time',    discord_digest_time);
  if (polling_interval_minutes) restartSchedulerForUser(uid);
  res.json({ success: true });
});

app.post('/api/discord/test', requireAuth, async (req, res) => {
  const { testConnection } = require('./discord');
  const channelId = req.body.channel_id || getUserSetting(req.user.id, 'discord_channel_id');
  const result = await testConnection(channelId);
  res.json(result);
});

// ── Agents ────────────────────────────────────────────────────────────────────

app.post('/api/agents/strategist', requireAuth, agentLimiter, async (req, res) => {
  try {
    const { days = 7 } = req.body;
    logActivity(req.user.id, req.user.name, userRole(req.user), 'agent_run', { agent: 'strategist', scopedUserId: req.scopedUserId });
    const result = await runStrategist({ days: parseInt(days), userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Strategist]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/writer', requireAuth, agentLimiter, async (req, res) => {
  try {
    const { username, contentGoal, viralCaption } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    logActivity(req.user.id, req.user.name, userRole(req.user), 'agent_run', { agent: 'writer', username });
    const result = await runWriter({ username, contentGoal, viralCaption, userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Writer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Caption refresh (single card) ─────────────────────────────────────────
app.post('/api/agents/writer/refresh-caption', requireAuth, async (req, res) => {
  try {
    const { username, contentGoal } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const caption = await refreshSingleCaption({ username, contentGoal, userId: req.scopedUserId });
    res.json({ caption });
  } catch (err) {
    console.error('[Agent:Writer:Refresh]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk caption refresh (single card) ──────────────────────────────────
app.post('/api/agents/bulk-captions/refresh-caption', requireAuth, async (req, res) => {
  try {
    const { username, videoName, keyframes, currentStyle } = req.body;
    if (!username || !videoName) return res.status(400).json({ error: 'username and videoName required' });
    const result = await refreshBulkSingleCaption({ username, videoName, keyframes: keyframes || [], currentStyle, userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:BulkCaptions:Refresh]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Caption rating ─────────────────────────────────────────────────────────
app.post('/api/captions/rate', requireAuth, (req, res) => {
  try {
    const { outputId, captionIndex, rating } = req.body;
    if (!outputId || captionIndex === undefined || !rating) {
      return res.status(400).json({ error: 'outputId, captionIndex, rating required' });
    }
    db.prepare(
      'INSERT OR REPLACE INTO caption_ratings (output_id, caption_index, rating) VALUES (?, ?, ?)'
    ).run(outputId, captionIndex, rating);
    res.json({ success: true });
  } catch (err) {
    console.error('[Captions:Rate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Caption history per creator ─────────────────────────────────────────────
app.get('/api/captions/history/:username', requireAuth, (req, res) => {
  try {
    const { username } = req.params;
    const rows = db.prepare(
      `SELECT id, input_summary, reviewed_output, created_at FROM agent_outputs
       WHERE user_id = ? AND agent = 'writer' AND input_summary LIKE ?
       ORDER BY created_at DESC LIMIT 50`
    ).all(req.scopedUserId, `%@${username}%`);
    res.json(rows);
  } catch (err) {
    console.error('[Captions:History]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/assistant', requireAuth, agentLimiter, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });
    const result = await runAssistant({ question, userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Assistant]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/captain', requireAuth, agentLimiter, async (req, res) => {
  try {
    const { outputId } = req.body;
    if (!outputId) return res.status(400).json({ error: 'outputId required' });
    const row = db.prepare('SELECT * FROM agent_outputs WHERE id = ? AND user_id = ?').get(outputId, req.scopedUserId);
    if (!row) return res.status(404).json({ error: 'Output not found' });
    const captain = await runCaptain(row.agent, row.reviewed_output || row.raw_output);
    db.prepare('UPDATE agent_outputs SET reviewed_output = ?, captain_notes = ? WHERE id = ? AND user_id = ?')
      .run(captain.reviewed, captain.notes, outputId, req.scopedUserId);
    res.json({ ...captain, id: outputId });
  } catch (err) {
    console.error('[Agent:Captain]', err.message);
    res.status(500).json({ error: 'Agent failed' });
  }
});

app.post('/api/agents/ideator', requireAuth, agentLimiter, async (req, res) => {
  try {
    const { group } = req.body;
    const result = await runIdeator({ group: group || null, userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Ideator]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/bulk-captions', requireAuth, async (req, res) => {
  try {
    const { username, videos } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    if (!Array.isArray(videos) || !videos.length) return res.status(400).json({ error: 'videos array required' });
    if (videos.length > 10) return res.status(400).json({ error: 'Maximum 10 videos per batch' });
    const invalid = videos.filter(v => !v.name || typeof v.name !== 'string');
    if (invalid.length) return res.status(400).json({ error: 'Each video must have a name field' });
    logActivity(req.user.id, req.user.name, userRole(req.user), 'agent_run', { agent: 'bulk-captions', username, videoCount: videos.length });
    const result = await runBulkCaptions({ username, videos, userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:BulkCaptions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/ideator-v2', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    logActivity(req.user.id, req.user.name, userRole(req.user), 'agent_run', { agent: 'ideator-v2', username });
    const result = await runIdeatorV2({ username, userId: req.scopedUserId });
    res.json(result);
  } catch (err) {
    console.error('[Agent:IdeatorV2]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Brain routes ──────────────────────────────────────────────────────────────

app.get('/api/brain/profiles', requireAuth, (req, res) => {
  const profiles = db.prepare(`
    SELECT cp.*, a.username, a.full_name, a.followers_count, a.avg_engagement_rate, a.profile_pic_url, a.group_name
    FROM creator_profiles cp
    JOIN accounts a ON cp.account_id = a.id
    WHERE cp.user_id = ?
    ORDER BY a.username ASC
  `).all(req.scopedUserId);
  res.json(profiles);
});

app.delete('/api/brain/profiles/:accountId', requireManager, (req, res) => {
  db.prepare('DELETE FROM creator_profiles WHERE account_id = ? AND user_id = ?').run(parseInt(req.params.accountId), req.scopedUserId);
  res.json({ success: true });
});

app.post('/api/brain/build', requireManager, agentLimiter, async (req, res) => {
  const { accountId } = req.body;
  const uid = req.scopedUserId;
  logActivity(req.user.id, req.user.name, userRole(req.user), 'brain_build', { accountId: accountId || 'all', scopedUserId: uid });
  try {
    if (accountId) {
      const result = await runProfileBuilder(parseInt(accountId), uid);
      return res.json({ built: 1, profiles: [result] });
    }
    const accounts = db.prepare('SELECT id, username FROM accounts WHERE user_id = ?').all(uid);
    const results = [];
    for (const acc of accounts) {
      try {
        const r = await runProfileBuilder(acc.id, uid);
        results.push(r);
      } catch (e) {
        console.warn(`[Brain] Skipped @${acc.username}: ${e.message}`);
      }
    }
    res.json({ built: results.length, profiles: results });
  } catch (err) {
    console.error('[Brain]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/brain/search', requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) return res.status(400).json({ error: 'Query required' });

  const profiles = db.prepare(`
    SELECT cp.*, a.username, a.full_name, a.followers_count, a.profile_pic_url, a.group_name
    FROM creator_profiles cp
    JOIN accounts a ON cp.account_id = a.id
    WHERE cp.user_id = ?
  `).all(req.scopedUserId);

  if (!profiles.length) return res.json({ results: [] });

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const profileList = profiles.map((p, i) =>
    `[${i + 1}] @${p.username}\n  Voice: ${p.voice_fingerprint || '—'}\n  Pillars: ${p.content_pillars || '—'}\n  Audience Triggers: ${p.audience_triggers || '—'}\n  Niche: ${p.niche_positioning || '—'}\n  Visual Style: ${p.visual_style || '—'}\n  Strength: ${p.strength_summary || '—'}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are ranking creator profiles by relevance to a search query.\n\nSearch query: "${query.trim()}"\n\nCreator profiles:\n${profileList}\n\nReturn ONLY a JSON array of matches ordered by relevance (most relevant first). Only include profiles that are genuinely relevant. Max 10 results. Format:\n[{"index": <number>, "reason": "<one short sentence why this matches>"}]`
    }]
  });

  try {
    const text = response.content[0].text;
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.json({ results: [] });
    const ranking = JSON.parse(jsonMatch[0]);
    const results = ranking
      .map(r => r.index >= 1 && r.index <= profiles.length ? { ...profiles[r.index - 1], relevance_reason: r.reason } : null)
      .filter(Boolean);
    res.json({ results, query: query.trim() });
  } catch {
    res.json({ results: [] });
  }
});

app.get('/api/agents/history', requireAuth, (req, res) => {
  const { agent } = req.query;
  const uid = req.user.id;
  const rows = agent
    ? db.prepare('SELECT * FROM agent_outputs WHERE user_id = ? AND agent = ? ORDER BY created_at DESC LIMIT 20').all(req.scopedUserId, agent)
    : db.prepare('SELECT * FROM agent_outputs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.scopedUserId);
  res.json(rows);
});

// ── Chat routes ───────────────────────────────────────────────────────────────

// Users I'm allowed to DM
app.get('/api/chat/peers', requireAuth, (req, res) => {
  const uid  = req.user.id;
  const role = userRole(req.user);
  let peers;
  if (role === 'admin') {
    peers = db.prepare("SELECT id, name, role FROM users WHERE id != ? ORDER BY name ASC").all(uid);
  } else if (role === 'manager') {
    peers = db.prepare(`SELECT u.id, u.name, u.role FROM manager_clients mc
      JOIN users u ON u.id = mc.client_id WHERE mc.manager_id = ? ORDER BY u.name ASC`).all(uid);
  } else {
    peers = db.prepare(`SELECT u.id, u.name, u.role FROM manager_clients mc
      JOIN users u ON u.id = mc.manager_id WHERE mc.client_id = ? ORDER BY u.name ASC`).all(uid);
  }
  res.json(peers);
});

// List rooms for the current user, with unread counts
app.get('/api/chat/rooms', requireAuth, (req, res) => {
  const uid = req.user.id;
  const rooms = db.prepare(`
    SELECT cr.id,
      u.id AS peer_id, u.name AS peer_name, u.role AS peer_role,
      (SELECT body FROM messages WHERE room_id = cr.id ORDER BY id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages WHERE room_id = cr.id ORDER BY id DESC LIMIT 1) AS last_message_at,
      (SELECT COUNT(*) FROM messages
        WHERE room_id = cr.id AND sender_id != ?
          AND id > COALESCE((SELECT last_read_id FROM room_reads WHERE room_id = cr.id AND user_id = ?), 0)
      ) AS unread_count
    FROM chat_rooms cr
    JOIN chat_room_members m1 ON m1.room_id = cr.id AND m1.user_id = ?
    JOIN chat_room_members m2 ON m2.room_id = cr.id AND m2.user_id != ?
    JOIN users u ON u.id = m2.user_id
    ORDER BY last_message_at DESC
  `).all(uid, uid, uid, uid);
  res.json(rooms);
});

// Get or create DM room with a peer
app.post('/api/chat/rooms', requireAuth, (req, res) => {
  const uid    = req.user.id;
  const peerId = parseInt(req.body.peerId);
  if (!peerId) return res.status(400).json({ error: 'peerId required' });

  // If a room already exists between these two users, always return it —
  // the auth check only gates creation of new rooms, not access to existing ones.
  const existing = db.prepare(`
    SELECT cr.id FROM chat_rooms cr
    JOIN chat_room_members m1 ON m1.room_id = cr.id AND m1.user_id = ?
    JOIN chat_room_members m2 ON m2.room_id = cr.id AND m2.user_id = ?
    WHERE (SELECT COUNT(*) FROM chat_room_members WHERE room_id = cr.id) = 2
  `).get(uid, peerId);
  if (existing) return res.json({ roomId: existing.id });

  // No existing room — enforce role-based authorization before creating one.
  const role = userRole(req.user);
  if (role !== 'admin') {
    if (role === 'manager') {
      const link = db.prepare('SELECT 1 FROM manager_clients WHERE manager_id = ? AND client_id = ?').get(uid, peerId);
      if (!link) return res.status(403).json({ error: 'Not authorized' });
    } else {
      const link = db.prepare('SELECT 1 FROM manager_clients WHERE manager_id = ? AND client_id = ?').get(peerId, uid);
      if (!link) return res.status(403).json({ error: 'Not authorized' });
    }
  }

  const { lastInsertRowid: roomId } = db.prepare('INSERT INTO chat_rooms DEFAULT VALUES').run();
  db.prepare('INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?)').run(roomId, uid);
  db.prepare('INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?)').run(roomId, peerId);
  res.json({ roomId });
});

// Get messages (supports ?since=<lastId> for polling)
app.get('/api/chat/rooms/:roomId/messages', requireAuth, (req, res) => {
  const uid    = req.user.id;
  const roomId = parseInt(req.params.roomId);
  if (!db.prepare('SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, uid))
    return res.status(404).json({ error: 'Not found' });

  const since = parseInt(req.query.since) || 0;
  const msgs  = db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.room_id = ? AND m.id > ?
    ORDER BY m.id ASC LIMIT 100
  `).all(roomId, since);

  if (msgs.length) {
    const lastId = msgs[msgs.length - 1].id;
    db.prepare('INSERT OR REPLACE INTO room_reads (room_id, user_id, last_read_id) VALUES (?, ?, ?)').run(roomId, uid, lastId);
  }
  res.json(msgs);
});

// Send a message
app.post('/api/chat/rooms/:roomId/messages', requireAuth, (req, res) => {
  const uid    = req.user.id;
  const roomId = parseInt(req.params.roomId);
  if (!db.prepare('SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?').get(roomId, uid))
    return res.status(404).json({ error: 'Not found' });
  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });
  if (body.length > 4000) return res.status(400).json({ error: 'Message too long (max 4000 characters)' });

  const { lastInsertRowid: msgId } = db.prepare(
    'INSERT INTO messages (room_id, sender_id, body) VALUES (?, ?, ?)'
  ).run(roomId, uid, body);
  db.prepare('INSERT OR REPLACE INTO room_reads (room_id, user_id, last_read_id) VALUES (?, ?, ?)').run(roomId, uid, msgId);

  const msg = db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at, u.name AS sender_name
    FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?
  `).get(msgId);
  res.json(msg);
});

// Total unread across all rooms (for nav badge)
app.get('/api/chat/unread', requireAuth, (req, res) => {
  const uid = req.user.id;
  const row = db.prepare(`
    SELECT COALESCE(SUM(
      (SELECT COUNT(*) FROM messages
        WHERE room_id = cr.id AND sender_id != ?
          AND id > COALESCE((SELECT last_read_id FROM room_reads WHERE room_id = cr.id AND user_id = ?), 0))
    ), 0) AS total
    FROM chat_rooms cr
    JOIN chat_room_members m ON m.room_id = cr.id AND m.user_id = ?
  `).get(uid, uid, uid);
  res.json({ unread: row.total });
});

// ── Content Hub routes ────────────────────────────────────────────────────────

app.get('/api/content', requireAuth, (req, res) => {
  const uid  = req.user.id;
  const role = userRole(req.user);
  let items;
  if (role === 'admin') {
    items = db.prepare(`SELECT ci.*, uc.name AS creator_name, ucl.name AS client_name
      FROM content_items ci JOIN users uc ON uc.id = ci.creator_id JOIN users ucl ON ucl.id = ci.client_id
      ORDER BY ci.created_at DESC`).all();
  } else if (role === 'manager') {
    items = db.prepare(`SELECT ci.*, uc.name AS creator_name, ucl.name AS client_name
      FROM content_items ci JOIN users uc ON uc.id = ci.creator_id JOIN users ucl ON ucl.id = ci.client_id
      WHERE ci.creator_id = ?
      ORDER BY ci.created_at DESC`).all(uid);
  } else {
    items = db.prepare(`SELECT ci.*, uc.name AS creator_name, ucl.name AS client_name
      FROM content_items ci JOIN users uc ON uc.id = ci.creator_id JOIN users ucl ON ucl.id = ci.client_id
      WHERE ci.client_id = ?
      ORDER BY ci.created_at DESC`).all(uid);
  }
  res.json(items);
});

app.post('/api/content', requireManager, (req, res) => {
  const { clientId, type, title, body, platform } = req.body;
  if (!clientId || !title?.trim()) return res.status(400).json({ error: 'clientId and title required' });
  if (!['idea', 'report'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

  const uid  = req.user.id;
  const role = userRole(req.user);
  if (role === 'manager') {
    const link = db.prepare('SELECT 1 FROM manager_clients WHERE manager_id = ? AND client_id = ?').get(uid, parseInt(clientId));
    if (!link) return res.status(403).json({ error: 'Not authorized for this client' });
  }

  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO content_items (creator_id, client_id, type, title, body, platform) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(uid, parseInt(clientId), type, title.trim(), body || '', platform || '');
  logActivity(uid, req.user.name, role, 'content_created', { type, title: title.trim(), clientId });
  res.json({ success: true, id });
});

app.patch('/api/content/:id', requireManager, (req, res) => {
  const uid  = req.user.id;
  const role = userRole(req.user);
  const item = role === 'admin'
    ? db.prepare('SELECT * FROM content_items WHERE id = ?').get(parseInt(req.params.id))
    : db.prepare('SELECT * FROM content_items WHERE id = ? AND creator_id = ?').get(parseInt(req.params.id), uid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const { title, body, platform } = req.body;
  db.prepare('UPDATE content_items SET title = ?, body = ?, platform = ? WHERE id = ?')
    .run(title ?? item.title, body ?? item.body, platform ?? item.platform, item.id);
  res.json({ success: true });
});

app.delete('/api/content/:id', requireManager, (req, res) => {
  const uid  = req.user.id;
  const role = userRole(req.user);
  const item = role === 'admin'
    ? db.prepare('SELECT id FROM content_items WHERE id = ?').get(parseInt(req.params.id))
    : db.prepare('SELECT id FROM content_items WHERE id = ? AND creator_id = ?').get(parseInt(req.params.id), uid);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM content_items WHERE id = ?').run(item.id);
  res.json({ success: true });
});

// ── Google Sheets Integration ───────────────────────────────────────────────
try {
  require('./sheets-routes')(app, { requireAuth, requireManager, db, getUserSetting, setUserSetting, userRole, logActivity });
  require('./stripe-routes')(app, { db, requireAuth, requireAdmin, logActivity, userRole });
  console.log('[Sheets] Google Sheets routes mounted');
} catch (e) {
  console.warn('[Sheets] Routes not loaded:', e.message);
}

// Purge expired sessions every hour
setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now()); } catch {}
}, 60 * 60 * 1000);

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n===========================================');
  console.log(` Instagram Competitor Tracker`);
  console.log(` http://localhost:${PORT}`);
  console.log('===========================================');
  if (!process.env.APIFY_TOKEN)       console.warn(' WARNING: APIFY_TOKEN not set in .env');
  if (!process.env.ANTHROPIC_API_KEY) console.warn(' WARNING: ANTHROPIC_API_KEY not set in .env');
  console.log('');
  setupScheduler();
  setupDigestScheduler();
});
