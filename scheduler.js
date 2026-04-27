const { db, getSetting, getUserSetting } = require('./db');
const { scrapeAccountPosts } = require('./apify');
const { processNewPosts } = require('./detector');
const { sendDailyDigest } = require('./discord');

let timer       = null;
let digestTimer = null;
let polling     = false;
let lastDigestDate = null;

// Trigger a brain rebuild if enough new posts have arrived since the last build.
// Runs fire-and-forget — never blocks the poll cycle.
const BRAIN_REBUILD_THRESHOLD = 5; // new posts needed to trigger a rebuild

async function maybeUpdateBrain(account) {
  try {
    const profile = db.prepare(
      'SELECT post_count_at_build, user_id FROM creator_profiles WHERE account_id = ?'
    ).get(account.id);
    if (!profile) return; // No profile exists yet — skip

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

    // Fire-and-forget: rebuild brain if enough new data has arrived
    maybeUpdateBrain(account).catch(e =>
      console.warn(`[Brain] Background update error for @${account.username}:`, e.message)
    );

    return alerts;
  } catch (err) {
    console.error(`[Poll] Failed for @${account.username}:`, err.message);
    return [];
  }
}

async function pollAllAccounts() {
  if (polling) {
    console.log('[Scheduler] Poll already running, skipping');
    return [];
  }
  polling = true;
  const all = [];
  try {
    const accounts = db.prepare('SELECT * FROM accounts').all();
    console.log(`[Scheduler] Starting poll for ${accounts.length} account(s)`);
    for (const account of accounts) {
      const alerts = await pollAccount(account);
      all.push(...alerts);
    }
    console.log(`[Scheduler] Poll complete — ${all.length} new alert(s) total`);
  } catch (err) {
    console.error('[Scheduler] Poll error:', err.message);
  } finally {
    polling = false;
  }
  return all;
}

function setupScheduler() {
  const minutes = Math.max(15, parseInt(getSetting('polling_interval_minutes')) || 60);

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    console.log(`[Scheduler] Interval fired (every ${minutes} min)`);
    pollAllAccounts().catch(console.error);
  }, minutes * 60 * 1000);

  console.log(`[Scheduler] Polling every ${minutes} minute(s)`);
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

function restartScheduler() {
  setupScheduler();
}

module.exports = { pollAllAccounts, pollAccount, setupScheduler, restartScheduler, setupDigestScheduler };
