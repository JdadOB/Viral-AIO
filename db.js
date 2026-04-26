const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tracker.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT,
    followers_count INTEGER DEFAULT 0,
    avg_engagement_rate REAL DEFAULT 0,
    group_name TEXT DEFAULT 'Default',
    profile_pic_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_polled_at TEXT,
    last_viral_at TEXT
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    post_id TEXT UNIQUE NOT NULL,
    post_url TEXT,
    post_type TEXT,
    thumbnail_url TEXT,
    caption TEXT,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    plays_count INTEGER DEFAULT 0,
    engagement_rate REAL DEFAULT 0,
    posted_at TEXT,
    detected_at TEXT DEFAULT (datetime('now')),
    is_viral INTEGER DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL UNIQUE,
    account_id INTEGER NOT NULL,
    multiplier REAL DEFAULT 0,
    engagement_rate REAL DEFAULT 0,
    account_avg_rate REAL DEFAULT 0,
    triggered_at TEXT DEFAULT (datetime('now')),
    viewed INTEGER DEFAULT 0,
    acted_on INTEGER DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id INTEGER UNIQUE NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrations
try { db.exec('ALTER TABLE alerts ADD COLUMN dismissed INTEGER DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE posts ADD COLUMN content_hash TEXT'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON posts(content_hash)'); } catch (e) {
  console.warn('[DB] Index warning:', e.message);
}
try { db.exec('ALTER TABLE alerts ADD COLUMN z_account REAL DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE alerts ADD COLUMN z_niche REAL DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE alerts ADD COLUMN niche_median REAL DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    agent TEXT NOT NULL,
    input_summary TEXT,
    raw_output TEXT,
    reviewed_output TEXT,
    captain_notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_id TEXT,
    name TEXT NOT NULL DEFAULT 'User',
    avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL'); } catch (e) {}
try { db.exec('ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE agent_outputs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}

// Keep legacy global settings for backward compat
const defaults = {
  polling_interval_minutes:   '60',
  viral_threshold_multiplier: '3',
  velocity_threshold:         '500',
  viral_z_threshold:          '2.5',
  discord_channel_id:         '',
  discord_digest_enabled:     '0',
  discord_digest_time:        '09:00',
};
for (const [k, v] of Object.entries(defaults)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

const USER_SETTING_DEFAULTS = defaults;

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getUserSetting(userId, key) {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key);
  return row ? row.value : (USER_SETTING_DEFAULTS[key] ?? null);
}

function setUserSetting(userId, key, value) {
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)').run(userId, key, String(value));
}

function seedUserDefaults(userId) {
  for (const [k, v] of Object.entries(USER_SETTING_DEFAULTS)) {
    db.prepare('INSERT OR IGNORE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)').run(userId, k, v);
  }
}

module.exports = { db, getSetting, setSetting, getUserSetting, setUserSetting, seedUserDefaults };
