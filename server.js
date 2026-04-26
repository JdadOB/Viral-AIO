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
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const session = require('express-session');
const bcrypt  = require('bcryptjs');
const passport = require('./auth');

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
const { pollAllAccounts, setupScheduler, restartScheduler, setupDigestScheduler } = require('./scheduler');
const { runStrategist, runWriter, runAssistant, runCaptain, runResearcher, runOrganizer, runIdeator } = require('./agents');

const app = express();
app.use(cors());
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'viral-track-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore(),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.use(passport.initialize());
app.use(passport.session());

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// Serve static assets without auth (CSS, JS, etc.)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Auth routes (no auth required)
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
  ).run(email.toLowerCase().trim(), hash, name.trim());
  seedUserDefaults(lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    res.json({ success: true });
  });
});

app.post('/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    req.login(user, err => {
      if (err) return next(err);
      res.json({ success: true });
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
  const { id, email, name, avatar_url } = req.user;
  res.json({ id, email, name, avatar_url });
});

// Main app — auth required
app.get('/', requireAuth, (req, res) => {
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
  `).all(_req.user.id);
  res.json(rows);
});

app.post('/api/accounts', requireAuth, async (req, res) => {
  const { username, group_name } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const clean = username.replace('@', '').toLowerCase().trim();
  const exists = db.prepare('SELECT id FROM accounts WHERE username = ? AND user_id = ?').get(clean, req.user.id);
  if (exists) return res.status(409).json({ error: 'Account already tracked' });

  const { lastInsertRowid: accountId } = db.prepare(
    'INSERT INTO accounts (username, group_name, user_id) VALUES (?, ?, ?)'
  ).run(clean, group_name || 'Default', req.user.id);

  res.status(202).json({ id: accountId, username: clean, message: 'Added — initial scrape running in background' });

  setImmediate(async () => {
    try {
      console.log(`[Setup] Initial scrape for @${clean}`);
      const posts = await scrapeAccountPosts(clean);
      processNewPosts(accountId, posts);
      console.log(`[Setup] Done — ${posts.length} posts for @${clean}`);
    } catch (err) {
      console.error(`[Setup] Failed for @${clean}:`, err.message);
    }
  });
});

app.patch('/api/accounts/:id', requireAuth, (req, res) => {
  const { group_name } = req.body;
  const account = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  if (group_name !== undefined)
    db.prepare('UPDATE accounts SET group_name = ? WHERE id = ?').run(group_name, account.id);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id));
});

app.post('/api/accounts/:id/poll', requireAuth, (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json({ message: `Scanning @${account.username}` });
  const { pollAccount } = require('./scheduler');
  pollAccount(account).catch(console.error);
});

app.delete('/api/accounts/:id', requireAuth, (req, res) => {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
  res.json({ success: true });
});

app.post('/api/accounts/bulk-delete', requireAuth, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
  const uid = req.user.id;
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
  const uid = req.user.id;

  // Seed any account group_names that aren't in user_groups yet (migration for existing users)
  const accountGroups = db.prepare(
    "SELECT DISTINCT group_name FROM accounts WHERE user_id = ? AND group_name IS NOT NULL"
  ).all(uid);
  for (const { group_name } of accountGroups) {
    db.prepare('INSERT OR IGNORE INTO user_groups (user_id, name) VALUES (?, ?)').run(uid, group_name);
  }

  const rows = db.prepare(`
    SELECT ug.name as group_name, COUNT(a.id) as count
    FROM user_groups ug
    LEFT JOIN accounts a ON a.group_name = ug.name AND a.user_id = ug.user_id
    WHERE ug.user_id = ?
    GROUP BY ug.name ORDER BY ug.name
  `).all(uid);
  res.json(rows);
});

app.post('/api/groups', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    db.prepare('INSERT INTO user_groups (user_id, name) VALUES (?, ?)').run(req.user.id, name.trim());
    res.json({ success: true, name: name.trim() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Group already exists' });
    throw err;
  }
});

app.delete('/api/groups/:name', requireAuth, (req, res) => {
  const groupName = decodeURIComponent(req.params.name);
  const uid = req.user.id;
  db.prepare("UPDATE accounts SET group_name = 'Default' WHERE group_name = ? AND user_id = ?").run(groupName, uid);
  db.prepare("DELETE FROM user_groups WHERE name = ? AND user_id = ?").run(groupName, uid);
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
  `).all(...(group ? [req.user.id, group] : [req.user.id]));

  res.json(rows.map(r => {
    let brief = null;
    if (r.brief_content) {
      try { brief = JSON.parse(r.brief_content); } catch { brief = null; }
    }
    return { ...r, brief, brief_content: undefined };
  }));
});

app.patch('/api/alerts/:id/viewed', requireAuth, (req, res) => {
  db.prepare('UPDATE alerts SET viewed = 1 WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.patch('/api/alerts/:id/acted-on', requireAuth, (req, res) => {
  const { acted_on } = req.body;
  db.prepare('UPDATE alerts SET acted_on = ? WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(acted_on ? 1 : 0, req.params.id, req.user.id);
  res.json({ success: true });
});

app.patch('/api/alerts/:id/dismiss', requireAuth, (req, res) => {
  db.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(req.params.id, req.user.id);
  res.json({ success: true });
});

app.delete('/api/alerts/acted-on', requireAuth, (req, res) => {
  const info = db.prepare('UPDATE alerts SET dismissed = 1 WHERE acted_on = 1 AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)').run(req.user.id);
  res.json({ success: true, dismissed: info.changes });
});

app.post('/api/alerts/:id/brief', requireAuth, async (req, res) => {
  try {
    const brief = await generateBrief(parseInt(req.params.id));
    res.json(brief);
  } catch (err) {
    console.error('[Brief]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Browser Scrape (for age-restricted / private accounts) ────────────────────

app.post('/api/browser-scrape', requireAuth, (req, res) => {
  const { username, followers_count, full_name, profile_pic_url, posts } = req.body;
  if (!username || !Array.isArray(posts) || posts.length === 0)
    return res.status(400).json({ error: 'username and posts[] required' });

  const clean = username.replace('@', '').toLowerCase().trim();

  let account = db.prepare('SELECT * FROM accounts WHERE username = ? AND user_id = ?').get(clean, req.user.id);
  if (!account) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO accounts (username, group_name, followers_count, full_name, profile_pic_url, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(clean, 'Default', followers_count || 0, full_name || null, profile_pic_url || null, req.user.id);
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

app.post('/api/poll', requireAuth, (req, res) => {
  res.json({ message: 'Poll started' });
  pollAllAccounts().catch(console.error);
});

app.get('/api/google-configured', (_req, res) => {
  res.json({ configured: !!process.env.GOOGLE_CLIENT_ID });
});

// ── Image Proxy (bypasses Instagram hotlink protection) ───────────────────────

app.get('/api/img', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).end(); }

  const allowed = ['instagram.com', 'cdninstagram.com', 'fbcdn.net', 'scontent.cdninstagram.com'];
  if (!allowed.some(d => parsed.hostname.endsWith(d))) return res.status(403).end();

  const lib = parsed.protocol === 'https:' ? https : http;
  const request = lib.get(url, {
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
    totalAccounts: db.prepare('SELECT COUNT(*) as c FROM accounts WHERE user_id = ?').get(uid).c,
    totalAlerts:   db.prepare('SELECT COUNT(*) as c FROM alerts al JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ?').get(uid).c,
    unreadAlerts:  db.prepare('SELECT COUNT(*) as c FROM alerts al JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ? AND al.viewed = 0').get(uid).c,
    actedOn:       db.prepare('SELECT COUNT(*) as c FROM alerts al JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ? AND al.acted_on = 1').get(uid).c,
    totalBriefs:   db.prepare('SELECT COUNT(*) as c FROM briefs b JOIN alerts al ON b.alert_id = al.id JOIN accounts acc ON al.account_id = acc.id WHERE acc.user_id = ?').get(uid).c,
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', requireAuth, (req, res) => {
  const uid = req.user.id;
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

app.post('/api/settings', requireAuth, (req, res) => {
  const uid = req.user.id;
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
  res.json({ success: true });
});

app.post('/api/discord/test', requireAuth, async (req, res) => {
  const { testConnection } = require('./discord');
  const channelId = req.body.channel_id || getUserSetting(req.user.id, 'discord_channel_id');
  const result = await testConnection(channelId);
  res.json(result);
});

// ── Agents ────────────────────────────────────────────────────────────────────

app.post('/api/agents/strategist', requireAuth, async (req, res) => {
  try {
    const { days = 7 } = req.body;
    const result = await runStrategist({ days: parseInt(days), userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Strategist]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/writer', requireAuth, async (req, res) => {
  try {
    const { username, contentGoal, viralCaption } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const result = await runWriter({ username, contentGoal, viralCaption, userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Writer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/assistant', requireAuth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });
    const result = await runAssistant({ question, userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Assistant]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/captain', requireAuth, async (req, res) => {
  try {
    const { outputId } = req.body;
    if (!outputId) return res.status(400).json({ error: 'outputId required' });
    const row = db.prepare('SELECT * FROM agent_outputs WHERE id = ?').get(outputId);
    if (!row) return res.status(404).json({ error: 'Output not found' });
    const captain = await runCaptain(row.agent, row.reviewed_output || row.raw_output);
    db.prepare('UPDATE agent_outputs SET reviewed_output = ?, captain_notes = ? WHERE id = ?')
      .run(captain.reviewed, captain.notes, outputId);
    res.json({ ...captain, id: outputId });
  } catch (err) {
    console.error('[Agent:Captain]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/researcher', requireAuth, async (req, res) => {
  try {
    const { niche, username } = req.body;
    if (!niche) return res.status(400).json({ error: 'niche required' });
    const result = await runResearcher({ niche, username: username || null, userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Researcher]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/organizer', requireAuth, async (req, res) => {
  try {
    const { context } = req.body;
    const result = await runOrganizer({ context: context || null, userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Organizer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/ideator', requireAuth, async (req, res) => {
  try {
    const { group } = req.body;
    const result = await runIdeator({ group: group || null, userId: req.user.id });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Ideator]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/history', requireAuth, (req, res) => {
  const { agent } = req.query;
  const uid = req.user.id;
  const rows = agent
    ? db.prepare('SELECT * FROM agent_outputs WHERE user_id = ? AND agent = ? ORDER BY created_at DESC LIMIT 20').all(uid, agent)
    : db.prepare('SELECT * FROM agent_outputs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(uid);
  res.json(rows);
});

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
