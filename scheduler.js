const { db, getUserSetting } = require('./db');
const { scrapeAccountPosts } = require('./apify');
const { processNewPosts } = require('./detector');
const { sendDailyDigest } = require('./discord');

// Per-user timers: Map<userId, intervalHandle>
const userTimers = new Map();
// Per-user polling lock: Map<userId, boolean>
const userPolling = new Map();

let digestTimer = null;
let lastDigestDate = null;

const BRAIN_REBUILD_THRESHOLD = 5;

async function maybeUpdateBrain(account) {
  try {
    const profile = db.prepare(
      'SELECT post_count_at_build, user_id FROM creator_profiles WHERE account_id = ?'
    ).get(account.id);
    if (!profile) return;

    const { count: currentCount } = db.prepare(
      'SELECT COUNT(*) as count FROM posts WHERE account_id = ?'
    ).get(account.id);

    const newPosts = currentCount - (profile.post_count_at_build || 0);
    if (newPosts < BRAIN_REBUILD_THRESHOLD) return;

    console.log(`[Brain] Auto-updating @${account.username} — ${newPosts} new posts since last build`);
    const { runProfileBuilder } = require('./agents');
    await runProfileBuilder(account.id, profile.user_id);
    console.log(`[Brain] Profile updated for @${account.username}`);
  } catch (err) {
    console.warn(`[Brain] Auto-update failed for @${account.username}:`, err.message);
  }
}

async function pollAccount(account) {
  try {
    console.log(`[Poll] Scraping @${account.username}...`);
    const posts = await scrapeAccountPosts(account.username);
    if (!posts.length) {
      console.log(`[Poll] No posts returned for @${account.username}`);
      return [];
    }
    const alerts = processNewPosts(account.id, posts);
    console.log(`[Poll] @${account.username}: ${posts.length} posts, ${alerts.length} new alert(s)`);

    maybeUpdateBrain(account).catch(e =>
      console.warn(`[Brain] Background update error for @${account.username}:`, e.message)
    );

    return alerts;
  } catch (err) {
    console.error(`[Poll] Failed for @${account.username}:`, err.message);
    return [];
  }
}

async function pollUser(userId) {
  if (userPolling.get(userId)) {
    console.log(`[Scheduler] Poll already running for user ${userId}, skipping`);
    return [];
  }
  userPolling.set(userId, true);
  const all = [];
  try {
    const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
    console.log(`[Scheduler] Starting poll for user ${userId} — ${accounts.length} account(s)`);
    for (const account of accounts) {
      const alerts = await pollAccount(account);
      all.push(...alerts);
    }
    console.log(`[Scheduler] Poll complete for user ${userId} — ${all.length} new alert(s)`);
  } catch (err) {
    console.error(`[Scheduler] Poll error for user ${userId}:`, err.message);
  } finally {
    userPolling.set(userId, false);
  }
  return all;
}

async function pollAllAccounts() {
  const users = db.prepare('SELECT id FROM users').all();
  const results = await Promise.all(users.map(({ id }) => pollUser(id)));
  return results.flat();
}

function setupUserScheduler(userId) {
  const minutes = Math.max(15, parseInt(getUserSetting(userId, 'polling_interval_minutes')) || 60);

  if (userTimers.has(userId)) clearInterval(userTimers.get(userId));

  const timer = setInterval(() => {
    console.log(`[Scheduler] Interval fired for user ${userId} (every ${minutes} min)`);
    pollUser(userId).catch(console.error);
  }, minutes * 60 * 1000);

  userTimers.set(userId, timer);
  console.log(`[Scheduler] User ${userId} polling every ${minutes} minute(s)`);
}

function setupScheduler() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const { id: userId } of users) {
    setupUserScheduler(userId);
  }
}

function restartScheduler() {
  setupScheduler();
}

function restartSchedulerForUser(userId) {
  setupUserScheduler(userId);
}

function setupDigestScheduler() {
  if (digestTimer) clearInterval(digestTimer);

  digestTimer = setInterval(() => {
    const now = new Date();
    const today = now.toDateString();
    const users = db.prepare('SELECT id FROM users').all();

    for (const { id: userId } of users) {
      if (getUserSetting(userId, 'discord_digest_enabled') !== '1') continue;
      const [h, m] = (getUserSetting(userId, 'discord_digest_time') || '09:00').split(':').map(Number);
      const key = `${userId}:${today}`;
      if (now.getHours() === h && now.getMinutes() === m && lastDigestDate !== key) {
        lastDigestDate = key;
        sendDailyDigest(db, userId).catch(console.error);
      }
    }
  }, 60 * 1000);
}

module.exports = { pollAllAccounts, pollAccount, setupScheduler, restartScheduler, restartSchedulerForUser, setupDigestScheduler };
