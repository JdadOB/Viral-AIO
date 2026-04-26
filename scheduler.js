const { db, getSetting } = require('./db');
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

  // Check every minute if it's time to send the digest
  digestTimer = setInterval(() => {
    const enabled = getSetting('discord_digest_enabled');
    if (enabled !== '1') return;

    const digestTime = getSetting('discord_digest_time') || '09:00';
    const now = new Date();
    const [h, m] = digestTime.split(':').map(Number);
    const today = now.toDateString();

    if (now.getHours() === h && now.getMinutes() === m && lastDigestDate !== today) {
      lastDigestDate = today;
      console.log('[Scheduler] Sending daily Discord digest');
      sendDailyDigest(db).catch(console.error);
    }
  }, 60 * 1000);
}

function restartScheduler() {
  setupScheduler();
}

module.exports = { pollAllAccounts, pollAccount, setupScheduler, restartScheduler, setupDigestScheduler };
