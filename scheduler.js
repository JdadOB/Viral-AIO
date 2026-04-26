const { db, getSetting, getUserSetting } = require('./db');
const { scrapeAccountPosts } = require('./apify');
const { processNewPosts } = require('./detector');
const { sendDailyDigest } = require('./discord');

let timer       = null;
let digestTimer = null;
let polling     = false;
let lastDigestDate = null;

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
