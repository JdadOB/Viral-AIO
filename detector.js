const crypto = require('crypto');
const { db, getUserSetting } = require('./db');
const { sendViralAlert } = require('./discord');

function contentHash(caption) {
  if (!caption) return null;
  const normalized = caption.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

function calcEngagementRate(likes, comments, plays, followers) {
  if (plays > 0) return ((likes + comments) / plays) * 100;
  if (!followers || followers === 0) return 0;
  return ((likes + comments) / followers) * 100;
}

function stddev(values, mean) {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function getAccountStats(accountId) {
  const posts = db.prepare(`
    SELECT engagement_rate FROM posts
    WHERE account_id = ? AND is_viral = 0
      AND detected_at >= datetime('now', '-30 days')
    ORDER BY detected_at DESC LIMIT 50
  `).all(accountId);

  if (posts.length === 0) return { avg: 0, stddev: 0, n: 0 };
  const rates = posts.map(p => p.engagement_rate);
  const avg = rates.reduce((s, v) => s + v, 0) / rates.length;
  return { avg, stddev: stddev(rates, avg), n: rates.length };
}

function updateAccountAvg(accountId) {
  const { avg } = getAccountStats(accountId);
  db.prepare('UPDATE accounts SET avg_engagement_rate = ? WHERE id = ?').run(avg, accountId);
  return avg;
}

// Niche baseline: compute median and stddev of ER across all non-viral posts
// from accounts in the same group_name over the last 30 days.
function getNicheStats(groupName, userId) {
  if (!groupName) return { median: 0, stddev: 0, n: 0 };
  const posts = db.prepare(`
    SELECT p.engagement_rate
    FROM posts p
    JOIN accounts a ON p.account_id = a.id
    WHERE a.group_name = ? AND a.user_id = ? AND p.is_viral = 0
      AND p.detected_at >= datetime('now', '-30 days')
    ORDER BY p.detected_at DESC LIMIT 500
  `).all(groupName, userId);

  if (posts.length === 0) return { median: 0, stddev: 0, n: 0 };
  const rates = posts.map(p => p.engagement_rate);
  const med = median(rates);
  const mean = rates.reduce((s, v) => s + v, 0) / rates.length;
  return { median: med, stddev: stddev(rates, mean), n: rates.length };
}

function processNewPosts(accountId, apifyPosts) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) return [];

  const uid = account.user_id;
  const multiplierThreshold = Number(getUserSetting(uid, 'viral_threshold_multiplier')) || 3;
  const velocityThreshold   = Number(getUserSetting(uid, 'velocity_threshold'))           || 500;
  const zThreshold          = Number(getUserSetting(uid, 'viral_z_threshold'))            || 2.5;

  const upsert = db.prepare(`
    INSERT INTO posts
      (account_id, post_id, post_url, post_type, thumbnail_url, caption,
       likes_count, comments_count, plays_count, engagement_rate, posted_at, is_viral, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(post_id) DO UPDATE SET
      likes_count     = excluded.likes_count,
      comments_count  = excluded.comments_count,
      plays_count     = excluded.plays_count,
      engagement_rate = excluded.engagement_rate,
      content_hash    = excluded.content_hash
  `);

  for (const p of apifyPosts) {
    const likes     = Number(p.likesCount    ?? p.likes_count    ?? 0) || 0;
    const comments  = Number(p.commentsCount ?? p.comments_count ?? 0) || 0;
    const plays     = Number(p.videoPlayCount ?? p.videoViewCount ?? p.video_play_count ?? 0) || 0;
    const followers = Number(p.followersCount ?? p.ownerFollowersCount ?? p.owner?.followersCount ?? account.followers_count ?? 1) || 1;
    const er = calcEngagementRate(likes, comments, plays, followers);

    const type = p.type === 'Video' ? 'Reel'
               : p.type === 'Sidecar' ? 'Carousel'
               : 'Image';

    const postId   = String(p.id ?? p.shortCode ?? p.short_code ?? '');
    const postUrl  = p.url ?? (p.shortCode ? `https://www.instagram.com/p/${p.shortCode}/` : null) ?? null;
    const thumb    = p.displayUrl ?? p.display_url ?? null;
    const caption  = p.caption ? String(p.caption).substring(0, 2000) : null;
    const postedAt = p.timestamp ?? p.taken_at_timestamp ?? null;
    const hash     = contentHash(caption);

    if (!postId) continue;

    upsert.run(
      accountId, postId, postUrl ?? null, type,
      thumb, caption, likes, comments, plays, er, postedAt ?? null, hash
    );

    // Keep follower count fresh — only overwrite text fields when new data is non-null
    if (followers > 0 && followers !== account.followers_count) {
      const fullName = p.ownerFullName ?? p.owner?.fullName ?? null;
      const picUrl   = p.profilePicUrl ?? p.ownerProfilePicUrl ?? p.owner?.profilePicUrl ?? null;
      db.prepare(`
        UPDATE accounts SET
          followers_count = ?,
          full_name       = COALESCE(?, full_name),
          profile_pic_url = COALESCE(?, profile_pic_url)
        WHERE id = ?
      `).run(followers, fullName, picUrl, accountId);
    }
  }

  const accountStats = getAccountStats(accountId);
  const avgRate = accountStats.avg;
  db.prepare('UPDATE accounts SET avg_engagement_rate = ? WHERE id = ?').run(avgRate, accountId);

  const nicheStats = getNicheStats(account.group_name, account.user_id);
  const newAlerts = [];

  for (const p of apifyPosts) {
    const postId = p.id || p.shortCode || p.short_code;
    const post = db.prepare('SELECT * FROM posts WHERE post_id = ? AND account_id = ?').get(postId, accountId);
    if (!post) continue;

    const alreadyAlerted = db.prepare('SELECT id FROM alerts WHERE post_id = ?').get(post.id);
    if (alreadyAlerted) continue;

    // Skip if identical content already triggered an alert from a different account (repost dedup)
    if (post.content_hash) {
      const dupAlert = db.prepare(`
        SELECT al.id FROM alerts al
        JOIN posts p ON al.post_id = p.id
        WHERE p.content_hash = ? AND al.account_id != ?
          AND al.triggered_at >= datetime('now', '-7 days')
        LIMIT 1
      `).get(post.content_hash, accountId);
      if (dupAlert) {
        console.log(`[Detector] Skipping duplicate content @${account.username} (hash ${post.content_hash})`);
        continue;
      }
    }

    const multiplier = avgRate > 0 ? post.engagement_rate / avgRate : 0;
    const totalInteractions = post.likes_count + post.comments_count + post.plays_count;

    // Z-score vs account's own baseline (how unusual is this post for this creator?)
    const zAccount = accountStats.stddev > 0
      ? (post.engagement_rate - accountStats.avg) / accountStats.stddev
      : 0;

    // Z-score vs niche baseline (how unusual is this post across the whole niche group?)
    // Uses median as the centre because ER distributions are heavily right-skewed.
    const zNiche = nicheStats.stddev > 0
      ? (post.engagement_rate - nicheStats.median) / nicheStats.stddev
      : 0;

    const viralByMultiplier = avgRate > 0 && multiplier >= multiplierThreshold;
    const viralByVelocity   = totalInteractions >= velocityThreshold;
    // Require BOTH z-scores to clear the threshold so single-creator spikes in a sleepy niche
    // don't over-fire, and niche-wide surges don't fire on flat creators.
    const viralByZScore     = accountStats.n >= 5 && nicheStats.n >= 10
                              && zAccount >= zThreshold && zNiche >= zThreshold;

    if (viralByMultiplier || viralByVelocity || viralByZScore) {
      db.prepare('UPDATE posts SET is_viral = 1 WHERE id = ?').run(post.id);
      db.prepare("UPDATE accounts SET last_viral_at = datetime('now') WHERE id = ?").run(accountId);

      const ins = db.prepare(`
        INSERT OR IGNORE INTO alerts (post_id, account_id, multiplier, engagement_rate, account_avg_rate, z_account, z_niche, niche_median)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(post.id, accountId, multiplier, post.engagement_rate, avgRate, zAccount, zNiche, nicheStats.median);

      if (ins.changes > 0) {
        newAlerts.push({ alertId: ins.lastInsertRowid, username: account.username, multiplier });
        const trigger = viralByMultiplier ? `${multiplier.toFixed(1)}x avg`
                      : viralByZScore     ? `z=${zAccount.toFixed(1)}/${zNiche.toFixed(1)}`
                                          : `${totalInteractions} interactions`;
        console.log(`[Detector] VIRAL: @${account.username} — ${trigger} (${post.post_url})`);
        sendViralAlert({
          userId: account.user_id,
          username: account.username,
          postUrl: post.post_url,
          postType: post.post_type,
          multiplier,
          engagementRate: post.engagement_rate,
          likes: post.likes_count,
          comments: post.comments_count,
          plays: post.plays_count,
          caption: post.caption,
          thumbnailUrl: post.thumbnail_url,
        });
      }
    }
  }

  db.prepare("UPDATE accounts SET last_polled_at = datetime('now') WHERE id = ?").run(accountId);
  return newAlerts;
}

module.exports = { processNewPosts };
