const { getSetting } = require('./db');

const DISCORD_API = 'https://discord.com/api/v10';

async function post(channelId, payload) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !channelId) return false;
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bot ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`[Discord] ${res.status} ${await res.text()}`);
    return res.ok;
  } catch (err) {
    console.error('[Discord] Send error:', err.message);
    return false;
  }
}

async function sendViralAlert({ username, postUrl, postType, multiplier, engagementRate, likes, comments, plays, caption, thumbnailUrl }) {
  const channelId = getSetting('discord_channel_id');
  if (!channelId) return;

  const totalInteractions = likes + comments + plays;

  const embed = {
    title: `🔥 Viral Alert — @${username}`,
    url: postUrl || undefined,
    color: 0xff4444,
    description: caption ? caption.substring(0, 300) + (caption.length > 300 ? '…' : '') : undefined,
    fields: [
      { name: 'Type',            value: postType || 'Post',                 inline: true },
      { name: 'Engagement Rate', value: `${engagementRate.toFixed(2)}%`,    inline: true },
      multiplier > 0 ? { name: 'Multiplier', value: `${multiplier.toFixed(1)}x avg`, inline: true } : null,
      { name: 'Likes',           value: likes.toLocaleString(),             inline: true },
      { name: 'Comments',        value: comments.toLocaleString(),          inline: true },
      plays > 0 ? { name: 'Plays', value: plays.toLocaleString(),           inline: true } : null,
      { name: 'Total Interactions', value: totalInteractions.toLocaleString(), inline: false },
    ].filter(Boolean),
    thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
    footer: { text: 'Social Tracker • Viral Detection' },
    timestamp: new Date().toISOString(),
  };

  await post(channelId, { embeds: [embed] });
}

async function sendDailyDigest(db) {
  const channelId = getSetting('discord_channel_id');
  if (!channelId) return;

  const rows = db.prepare(`
    SELECT
      al.multiplier, al.engagement_rate,
      p.post_type, p.post_url, p.likes_count, p.comments_count, p.plays_count,
      acc.username
    FROM alerts al
    JOIN posts p      ON al.post_id    = p.id
    JOIN accounts acc ON al.account_id = acc.id
    WHERE al.triggered_at >= datetime('now', '-1 day')
      AND al.dismissed = 0
    ORDER BY al.engagement_rate DESC
    LIMIT 10
  `).all();

  const total = db.prepare(
    `SELECT COUNT(*) as c FROM alerts WHERE triggered_at >= datetime('now', '-1 day') AND dismissed = 0`
  ).get().c;

  if (total === 0) {
    await post(channelId, { content: '📊 **Daily Digest** — No viral posts detected in the last 24 hours.' });
    return;
  }

  const top3 = rows.slice(0, 3).map((r, i) => {
    const label = ['🥇', '🥈', '🥉'][i];
    const url   = r.post_url ? `[View Post](${r.post_url})` : 'No URL';
    return `${label} **@${r.username}** — ${r.post_type} — **${r.engagement_rate.toFixed(2)}% ER** (${r.multiplier.toFixed(1)}x avg)\n♥ ${r.likes_count.toLocaleString()}  💬 ${r.comments_count.toLocaleString()}${r.plays_count > 0 ? `  ▶ ${r.plays_count.toLocaleString()}` : ''}  ${url}`;
  }).join('\n\n');

  const embed = {
    title: '📊 Daily Digest — Viral Activity Report',
    color: 0x00f2ff,
    description: `**${total} viral post${total !== 1 ? 's' : ''} detected** in the last 24 hours.\n\n${top3}${rows.length > 3 ? `\n\n*+ ${rows.length - 3} more — check the dashboard for the full list.*` : ''}`,
    footer: { text: 'Social Tracker • Daily Digest' },
    timestamp: new Date().toISOString(),
  };

  await post(channelId, { embeds: [embed] });
  console.log(`[Discord] Daily digest sent — ${total} alerts`);
}

async function testConnection(channelId) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'DISCORD_BOT_TOKEN not set in .env' };
  if (!channelId) return { ok: false, error: 'No channel ID provided' };

  const ok = await post(channelId, { content: '✅ Social Tracker bot connected. Viral alerts will be posted here.' });
  if (ok) return { ok: true };
  return { ok: false, error: 'Failed to send — check bot permissions in that channel' };
}

module.exports = { sendViralAlert, sendDailyDigest, testConnection };
