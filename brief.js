const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('./db');

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const SYSTEM_PROMPT = `You are an expert social media strategist. You must respond with ONLY valid JSON — no markdown, no prose, no code fences. The JSON must exactly match this schema:

{
  "hookAnalysis": "string",
  "formatBlueprint": "string",
  "captionFramework": "string",
  "hashtagStrategy": "string",
  "postingWindow": "string",
  "differentiationTips": "string"
}

Each value is a detailed, actionable paragraph or formatted block of text. Do not nest objects or arrays inside the values.`;

async function generateBrief(alertId) {
  const row = db.prepare(`
    SELECT
      al.id, al.multiplier, al.engagement_rate, al.account_avg_rate,
      p.post_url, p.post_type, p.thumbnail_url, p.caption,
      p.likes_count, p.comments_count, p.plays_count, p.posted_at,
      acc.username, acc.full_name, acc.followers_count
    FROM alerts al
    JOIN posts p    ON al.post_id    = p.id
    JOIN accounts acc ON al.account_id = acc.id
    WHERE al.id = ?
  `).get(alertId);

  if (!row) throw new Error('Alert not found');

  const existing = db.prepare('SELECT content FROM briefs WHERE alert_id = ?').get(alertId);
  if (existing) {
    try { return JSON.parse(existing.content); } catch { /* re-generate if corrupt */ }
  }

  const viewMetric = row.plays_count > 0
    ? ` | Plays/Views: ${(row.plays_count).toLocaleString()}`
    : '';

  const prompt = `Analyze this viral social media post and produce a clear, actionable content brief a creator can hand directly to their team.

VIRAL POST DATA
- Account: @${row.username}${row.full_name ? ` (${row.full_name})` : ''} — ${(row.followers_count || 0).toLocaleString()} followers
- Post Type: ${row.post_type}
- Likes: ${(row.likes_count || 0).toLocaleString()} | Comments: ${(row.comments_count || 0).toLocaleString()}${viewMetric}
- Engagement Rate: ${(row.engagement_rate || 0).toFixed(2)}% (account avg: ${(row.account_avg_rate || 0).toFixed(2)}%, multiplier: ${(row.multiplier || 0).toFixed(1)}x)
- Posted: ${row.posted_at ? new Date(row.posted_at).toDateString() : 'Unknown'}
- URL: ${row.post_url || 'N/A'}
- Caption: ${row.caption || 'No caption'}

Fill every key in the JSON schema:

hookAnalysis — What made someone stop scrolling? Name the exact technique (visual contrast, bold text, emotional trigger, trending audio, etc.) and why it worked for this account's audience.

formatBlueprint — Exact format specs: duration (if Reel/TikTok), aspect ratio, text overlay style, pacing, B-roll or talking head, editing style. What must be replicated to get the same stop-scroll effect.

captionFramework — Opening line template they can fill in, body structure (1-3 sentences max), CTA wording, tone, and ideal character count range.

hashtagStrategy — 20-25 hashtags: 5 niche (under 500k posts), 10 mid-size (500k–5M), 5 broad (5M+), 5 account/topic-specific. Format as a ready-to-paste block.

postingWindow — Best 2-3 day/time windows for this content type, with reasoning based on engagement patterns for this niche.

differentiationTips — 3 specific, concrete ways to recreate this format with a unique angle so the post is inspired, not derivative.`;

  const client = getClient();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1800,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content?.[0]?.text;
  if (!raw) throw new Error('Empty response from Claude API');

  let sections;
  try {
    sections = JSON.parse(raw);
  } catch {
    sections = {
      hookAnalysis: raw,
      formatBlueprint: '',
      captionFramework: '',
      hashtagStrategy: '',
      postingWindow: '',
      differentiationTips: '',
    };
  }

  const stored = JSON.stringify(sections);
  db.prepare('INSERT OR REPLACE INTO briefs (alert_id, content) VALUES (?, ?)').run(alertId, stored);

  return sections;
}

module.exports = { generateBrief };
