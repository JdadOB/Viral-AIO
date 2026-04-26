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

const { db, getSetting, setSetting } = require('./db');
const { scrapeAccountPosts }         = require('./apify');
const { processNewPosts }            = require('./detector');
const { generateBrief }              = require('./brief');
const { pollAllAccounts, setupScheduler, restartScheduler, setupDigestScheduler } = require('./scheduler');
const { runStrategist, runWriter, runAssistant, runCaptain, runResearcher, runOrganizer } = require('./agents');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Accounts ─────────────────────────────────────────────────────────────────

app.get('/api/accounts', (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM alerts WHERE account_id = a.id) as total_alerts,
      (SELECT COUNT(*) FROM alerts WHERE account_id = a.id AND viewed = 0) as unread_alerts
    FROM accounts a
    ORDER BY a.created_at DESC
  `).all();
  res.json(rows);
});

app.post('/api/accounts', async (req, res) => {
  const { username, group_name } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const clean = username.replace('@', '').toLowerCase().trim();
  const exists = db.prepare('SELECT id FROM accounts WHERE username = ?').get(clean);
  if (exists) return res.status(409).json({ error: 'Account already tracked' });

  const { lastInsertRowid: accountId } = db.prepare(
    'INSERT INTO accounts (username, group_name) VALUES (?, ?)'
  ).run(clean, group_name || 'Default');

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

app.patch('/api/accounts/:id', (req, res) => {
  const { group_name } = req.body;
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  if (group_name !== undefined)
    db.prepare('UPDATE accounts SET group_name = ? WHERE id = ?').run(group_name, account.id);
  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id));
});

app.post('/api/accounts/:id/poll', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  res.json({ message: `Scanning @${account.username}` });
  const { pollAccount } = require('./scheduler');
  pollAccount(account).catch(console.error);
});

app.delete('/api/accounts/:id', (req, res) => {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
  res.json({ success: true });
});

// ── Alerts ────────────────────────────────────────────────────────────────────

app.get('/api/alerts', (req, res) => {
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
    WHERE 1=1 ${where} ${groupWhere}
    ORDER BY ${orderBy}
    LIMIT 200
  `).all(...(group ? [group] : []));

  res.json(rows.map(r => {
    let brief = null;
    if (r.brief_content) {
      try { brief = JSON.parse(r.brief_content); } catch { brief = null; }
    }
    return { ...r, brief, brief_content: undefined };
  }));
});

app.patch('/api/alerts/:id/viewed', (req, res) => {
  db.prepare('UPDATE alerts SET viewed = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.patch('/api/alerts/:id/acted-on', (req, res) => {
  const { acted_on } = req.body;
  db.prepare('UPDATE alerts SET acted_on = ? WHERE id = ?').run(acted_on ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.patch('/api/alerts/:id/dismiss', (req, res) => {
  db.prepare('UPDATE alerts SET dismissed = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/alerts/acted-on', (req, res) => {
  const info = db.prepare('UPDATE alerts SET dismissed = 1 WHERE acted_on = 1').run();
  res.json({ success: true, dismissed: info.changes });
});

app.post('/api/alerts/:id/brief', async (req, res) => {
  try {
    const brief = await generateBrief(parseInt(req.params.id));
    res.json(brief);
  } catch (err) {
    console.error('[Brief]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Browser Scrape (for age-restricted / private accounts) ────────────────────

app.post('/api/browser-scrape', (req, res) => {
  const { username, followers_count, full_name, profile_pic_url, posts } = req.body;
  if (!username || !Array.isArray(posts) || posts.length === 0)
    return res.status(400).json({ error: 'username and posts[] required' });

  const clean = username.replace('@', '').toLowerCase().trim();

  let account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(clean);
  if (!account) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO accounts (username, group_name, followers_count, full_name, profile_pic_url) VALUES (?, ?, ?, ?, ?)'
    ).run(clean, 'Default', followers_count || 0, full_name || null, profile_pic_url || null);
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

app.post('/api/poll', (req, res) => {
  res.json({ message: 'Poll started' });
  pollAllAccounts().catch(console.error);
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

app.get('/api/stats', (_req, res) => {
  res.json({
    totalAccounts: db.prepare('SELECT COUNT(*) as c FROM accounts').get().c,
    totalAlerts:   db.prepare('SELECT COUNT(*) as c FROM alerts').get().c,
    unreadAlerts:  db.prepare('SELECT COUNT(*) as c FROM alerts WHERE viewed = 0').get().c,
    actedOn:       db.prepare('SELECT COUNT(*) as c FROM alerts WHERE acted_on = 1').get().c,
    totalBriefs:   db.prepare('SELECT COUNT(*) as c FROM briefs').get().c,
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  res.json({
    polling_interval_minutes:    getSetting('polling_interval_minutes'),
    viral_threshold_multiplier:  getSetting('viral_threshold_multiplier'),
    velocity_threshold:          getSetting('velocity_threshold'),
    discord_channel_id:          getSetting('discord_channel_id') || '',
    discord_bot_configured:      !!process.env.DISCORD_BOT_TOKEN,
    discord_digest_enabled:      getSetting('discord_digest_enabled') || '0',
    discord_digest_time:         getSetting('discord_digest_time')    || '09:00',
  });
});

app.post('/api/settings', (req, res) => {
  const {
    polling_interval_minutes, viral_threshold_multiplier, velocity_threshold,
    discord_channel_id, discord_digest_enabled, discord_digest_time,
  } = req.body;
  if (polling_interval_minutes) { setSetting('polling_interval_minutes', polling_interval_minutes); restartScheduler(); }
  if (viral_threshold_multiplier) setSetting('viral_threshold_multiplier', viral_threshold_multiplier);
  if (velocity_threshold)         setSetting('velocity_threshold', velocity_threshold);
  if (discord_channel_id    !== undefined) setSetting('discord_channel_id',    discord_channel_id);
  if (discord_digest_enabled !== undefined) setSetting('discord_digest_enabled', discord_digest_enabled ? '1' : '0');
  if (discord_digest_time    !== undefined) setSetting('discord_digest_time',    discord_digest_time);
  res.json({ success: true });
});

app.post('/api/discord/test', async (req, res) => {
  const { testConnection } = require('./discord');
  const channelId = req.body.channel_id || getSetting('discord_channel_id');
  const result = await testConnection(channelId);
  res.json(result);
});

// ── Agents ────────────────────────────────────────────────────────────────────

app.post('/api/agents/strategist', async (req, res) => {
  try {
    const { days = 7 } = req.body;
    const result = await runStrategist({ days: parseInt(days) });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Strategist]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/writer', async (req, res) => {
  try {
    const { username, contentGoal, viralCaption } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const result = await runWriter({ username, contentGoal, viralCaption });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Writer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/assistant', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question required' });
    const result = await runAssistant({ question });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Assistant]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/captain', async (req, res) => {
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

app.post('/api/agents/researcher', async (req, res) => {
  try {
    const { niche, username } = req.body;
    if (!niche) return res.status(400).json({ error: 'niche required' });
    const result = await runResearcher({ niche, username: username || null });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Researcher]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents/organizer', async (req, res) => {
  try {
    const { context } = req.body;
    const result = await runOrganizer({ context: context || null });
    res.json(result);
  } catch (err) {
    console.error('[Agent:Organizer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/history', (req, res) => {
  const { agent } = req.query;
  const rows = agent
    ? db.prepare('SELECT * FROM agent_outputs WHERE agent = ? ORDER BY created_at DESC LIMIT 20').all(agent)
    : db.prepare('SELECT * FROM agent_outputs ORDER BY created_at DESC LIMIT 50').all();
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
