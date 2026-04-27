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
try { db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}

// ── RBAC: role column ─────────────────────────────────────────────────────────
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'client'"); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
// Sync role from legacy is_admin flag for existing rows
db.prepare("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role = 'client')").run();
db.prepare("UPDATE users SET role = 'client' WHERE role IS NULL").run();

// Ensure the operator account is always an admin
db.prepare("UPDATE users SET is_admin = 1, role = 'admin' WHERE email = 'jonadkins03@gmail.com'").run();

// ── RBAC: manager → client assignments ───────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS manager_clients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(manager_id, client_id)
  );
`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_mc_manager ON manager_clients(manager_id)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_mc_client  ON manager_clients(client_id)');  } catch (e) {}

// ── Activity log ──────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    user_name  TEXT,
    user_role  TEXT,
    action     TEXT NOT NULL,
    details    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC)'); } catch (e) {}
try { db.exec('ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE agent_outputs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS creator_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    content_pillars TEXT,
    voice_fingerprint TEXT,
    audience_triggers TEXT,
    niche_positioning TEXT,
    visual_style TEXT,
    discovery_brief TEXT,
    strength_summary TEXT,
    built_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)'); } catch (e) {}

// ── Chat + Content tables ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_room_members (
    room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS room_reads (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS content_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type    TEXT NOT NULL DEFAULT 'idea',
    title   TEXT NOT NULL,
    body    TEXT,
    platform TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
try { db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id)'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_content_client ON content_items(client_id)'); } catch (e) {}

// ── Brain adaptive-learning columns ──────────────────────────────────────────
// emoji_fingerprint: JSON blob with per-emoji counts + Claude-generated context
// top_hooks:         JSON array of verbatim best-performing opening lines
// post_count_at_build: snapshot of post count so scheduler can detect new data
// updated_at:        timestamp of last incremental update (vs full rebuild at built_at)
try { db.exec('ALTER TABLE creator_profiles ADD COLUMN emoji_fingerprint TEXT'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE creator_profiles ADD COLUMN top_hooks TEXT'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE creator_profiles ADD COLUMN post_count_at_build INTEGER DEFAULT 0'); } catch (e) {
  if (!e.message.includes('duplicate column')) console.warn('[DB] Migration warning:', e.message);
}
try { db.exec('ALTER TABLE creator_profiles ADD COLUMN updated_at TEXT'); } catch (e) {
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
