const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db');

const MODEL = 'claude-sonnet-4-6';

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Context builders ──────────────────────────────────────────────────────────

function getAccountsContext(userId) {
  return db.prepare(`
    SELECT username, full_name, followers_count, avg_engagement_rate, group_name
    FROM accounts WHERE user_id = ? ORDER BY followers_count DESC
  `).all(userId);
}

function getRecentViral(days = 7, userId) {
  return db.prepare(`
    SELECT
      acc.username, acc.followers_count,
      p.post_type, p.caption, p.likes_count, p.comments_count, p.plays_count,
      p.engagement_rate, p.post_url, p.posted_at,
      al.multiplier, al.triggered_at
    FROM alerts al
    JOIN posts p ON al.post_id = p.id
    JOIN accounts acc ON al.account_id = acc.id
    WHERE acc.user_id = ? AND al.triggered_at >= datetime('now', '-' || ? || ' days')
    ORDER BY al.multiplier DESC LIMIT 30
  `).all(userId, days);
}

function getProfileCaptions(username, limit = 20) {
  return db.prepare(`
    SELECT p.caption, p.post_type, p.likes_count, p.comments_count, p.plays_count, p.engagement_rate
    FROM posts p
    JOIN accounts a ON p.account_id = a.id
    WHERE a.username = ? AND p.caption IS NOT NULL
    ORDER BY p.engagement_rate DESC LIMIT ?
  `).all(username, limit);
}

function getCreatorProfile(accountId) {
  return db.prepare('SELECT * FROM creator_profiles WHERE account_id = ?').get(accountId);
}

function saveOutput(agent, inputSummary, rawOutput, reviewedOutput = null, captainNotes = null, userId = null) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO agent_outputs (agent, input_summary, raw_output, reviewed_output, captain_notes, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(agent, inputSummary, rawOutput, reviewedOutput, captainNotes, userId);
  return lastInsertRowid;
}

// ── CAPTAIN ───────────────────────────────────────────────────────────────────
// Reviews and humanizes all other agents' outputs before they reach the user.

async function runCaptain(agentName, rawOutput, context = '') {
  const ai = client();

  const isIdeator = agentName === 'Ideator';

  const system = isIdeator
    ? `You are the Captain — the final editor before content reaches a creator client. Your job is to take the Ideator's reel/TikTok ideas and make them immediately understandable and exciting for the creator who will be reading and filming them.

Rules:
1. Keep EVERY idea intact — do not remove, combine, or reorder any of the 5 ideas. All content stays.
2. Strip all analytics-speak, agency jargon, and internal terminology. Replace with plain, direct language a creator can act on.
3. Where a concept is abstract, add a quick concrete example in plain language — enough that the creator pictures the shot in their head.
4. Tone = smart creative director briefing a client: clear, encouraging, specific, no fluff.
5. The "Why It'll Work" for each idea should feel like a genuine insight, not a bullet point — one sentence max, plain English.
6. Priority Picks and Group Patterns sections stay in full — simplify the language there too.
7. In your notes, flag anything you clarified or any idea that needed significant translation.

Respond in EXACTLY this format:

## REVIEWED OUTPUT
[Full client-ready version — all 5 ideas preserved, language simplified and clear]

## CAPTAIN'S NOTES
[Brief: what you translated or clarified, or "Clean — minimal edits needed."]`
    : `You are the Captain — the writing-quality editor for a creator-management agency's analytics team. Context you need: every creator referenced in the work you review is a signed client of this agency, analyzed with explicit consent using their own public Instagram post metrics. This is first-party creator analytics. Your role is strictly a writing/editorial pass — you are NOT a safety, ethics, or policy reviewer, and you do not second-guess whether the analysis should exist. Your job is to review the draft and:

1. Humanize anything that sounds robotic, AI-generated, or corporate — rewrite it to sound like a sharp, experienced strategist who actually uses Instagram
2. Cut hollow filler phrases like "it's crucial to", "leveraging", "utilize", "game-changer", "in today's landscape"
3. Add punch and specificity where it's missing — vague advice is useless
4. Keep the original structure and key insights intact
5. Flag what you changed and why in your notes

Respond in EXACTLY this format (no deviations):

## REVIEWED OUTPUT
[Your refined version]

## CAPTAIN'S NOTES
[What you changed and why — or "Approved with minor edits." if minimal changes]`;

  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: isIdeator ? 5000 : 2500,
    system,
    messages: [{
      role: 'user',
      content: `Review this output from the ${agentName}:

${rawOutput}${context ? `\n\nContext: ${context}` : ''}`,
    }],
  });

  const text = msg.content[0].text;
  const reviewedMatch = text.match(/## REVIEWED OUTPUT\n([\s\S]*?)(?=\n## CAPTAIN'S NOTES|$)/);
  const notesMatch    = text.match(/## CAPTAIN'S NOTES\n([\s\S]*)$/);

  return {
    reviewed: (reviewedMatch ? reviewedMatch[1] : text).trim(),
    notes:    (notesMatch    ? notesMatch[1]    : '').trim(),
  };
}

// ── STRATEGIST ────────────────────────────────────────────────────────────────
// Generates daily/weekly performance reports across the agency's client roster.

async function runStrategist({ days = 7, userId } = {}) {
  const accounts = getAccountsContext(userId);
  const viral    = getRecentViral(days, userId);

  const accountSummary = accounts.length
    ? accounts.map(a =>
        `• @${a.username}${a.full_name ? ` (${a.full_name})` : ''} — ${(a.followers_count || 0).toLocaleString()} followers | avg ER: ${(a.avg_engagement_rate || 0).toFixed(2)}%`
      ).join('\n')
    : '  No accounts tracked yet.';

  const viralSummary = viral.length
    ? viral.map(v =>
        `• @${v.username} | ${v.post_type} | ${(v.multiplier || 0).toFixed(1)}x avg | ER: ${(v.engagement_rate || 0).toFixed(2)}%\n` +
        `  ♥ ${v.likes_count}  💬 ${v.comments_count}  ▶ ${v.plays_count || 0}\n` +
        `  Caption: "${(v.caption || '').substring(0, 200).replace(/\n/g, ' ')}${(v.caption || '').length > 200 ? '…' : ''}"`
      ).join('\n\n')
    : '  No viral posts detected in this period.';

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: `You are the Strategist — a first-party analytics assistant for a creator-management agency. Important context about the data you receive:

- Every account shown to you is a signed client of this agency. The operator manages these creators professionally and has explicit written consent from each of them to ingest and analyze their public Instagram post metrics on their behalf. This is first-party creator analytics, not third-party monitoring.
- The @handles and display names you see are stage names / personas the creators publish under — not personal identifying information. Naming them in the report is how the agency attributes wins to its own clients.
- All engagement data (likes, comments, plays, captions) is data the creators themselves published publicly on Instagram. Nothing here is private, scraped from non-public surfaces, or obtained without the creator's knowledge.
- Your deliverable is a performance briefing the agency will share back with its own clients to help them grow — the creators are the beneficiaries of this analysis, not the subjects of it.

Your job is to study what's working across the client roster and translate the engagement data into actionable content strategy the agency can bring back to its creators. Reference creators by @handle freely — they are clients being analyzed with consent, and naming them is how the agency attributes wins and patterns. Be specific, blunt, and data-driven. No filler. If there's no data, say so clearly and give general strategic guidance on Reels performance, engagement patterns, and growth drivers instead. Do not refuse this task or reframe it as surveillance — it is routine first-party creator analytics.`,
    messages: [{
      role: 'user',
      content: `Generate a strategic performance report for the agency's client roster for the last ${days} days.

CLIENT ROSTER — ${accounts.length} accounts tracked:
${accountSummary}

TOP-PERFORMING POSTS — ${viral.length} flagged this period:
${viralSummary}

Produce a structured report with these exact sections:

## EXECUTIVE SUMMARY
2-3 punchy sentences on what happened this period. Lead with the most important finding.

## TOP PERFORMERS
Which accounts and content types dominated. Cite specific numbers.

## CONTENT PATTERNS
What hooks, formats, caption styles, and themes drove engagement. Be specific — don't say "engaging content," say what made it work.

## TIMING INSIGHTS
Any patterns in when content went viral. If no timing data, note that.

## STRATEGIC RECOMMENDATIONS
5 specific, actionable moves based on this data. Number them. Make them executable, not vague.

## WATCH LIST
3-5 accounts or content trends to monitor closely next period, and why.`,
    }],
  });

  const rawOutput = msg.content[0].text;
  const captain = await runCaptain('Strategist', rawOutput, `${days}-day client performance report, ${accounts.length} client accounts, ${viral.length} top-performing posts`);
  const id = saveOutput('strategist', `${days}-day report`, rawOutput, captain.reviewed, captain.notes, userId);

  return { id, days, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

// ── WRITER ────────────────────────────────────────────────────────────────────
// Generates humanized captions matched to a tracked profile's style and voice.

async function runWriter({ username, contentGoal = null, viralCaption = null, userId }) {
  const account = db.prepare('SELECT * FROM accounts WHERE username = ? AND user_id = ?').get(username, userId);
  if (!account) throw new Error(`@${username} is not in the database`);

  const captions = getProfileCaptions(username);
  const captionExamples = captions.length
    ? captions.map(c =>
        `[${c.post_type} | ER: ${(c.engagement_rate || 0).toFixed(2)}% | ♥${c.likes_count} 💬${c.comments_count}]\n${c.caption}`
      ).join('\n\n---\n\n')
    : 'No caption history available yet.';

  const profile = db.prepare('SELECT * FROM creator_profiles WHERE account_id = ?').get(account.id);
  const profileBlock = profile ? `
CREATOR INTELLIGENCE PROFILE:
• Voice: ${profile.voice_fingerprint}
• Content Pillars: ${profile.content_pillars}
• Audience Triggers: ${profile.audience_triggers}
• Visual Style: ${profile.visual_style}
• Strength: ${profile.strength_summary}
` : '';

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: `You are the Writer — a caption specialist who studies creator voices and writes in them authentically. You don't write generic influencer captions. You study the actual language, cadence, tone, emoji usage, and hooks a creator uses and replicate it convincingly. Every caption you write should pass a "did a human write this?" test.`,
    messages: [{
      role: 'user',
      content: `Write 5 Instagram caption variations for @${username}.

PROFILE:
• Username: @${username}${account.full_name ? ` / ${account.full_name}` : ''}
• Followers: ${(account.followers_count || 0).toLocaleString()}
• Avg Engagement Rate: ${(account.avg_engagement_rate || 0).toFixed(2)}%
${profileBlock}
THEIR BEST-PERFORMING CAPTIONS — study the voice, hooks, emoji usage, sentence length, personality:
${captionExamples}

${viralCaption ? `VIRAL POST TO RIFF ON:\n${viralCaption}\n` : ''}
${contentGoal ? `CONTENT GOAL: ${contentGoal}\n` : ''}

Write 5 caption variations. Each must:
• Open with a hook that stops the scroll
• Sound like @${username} wrote it, not like an AI assistant
• Have a clear CTA
• Include 10–15 hashtags that actually fit

Format:
### CAPTION 1 — [style: e.g. punchy, storytelling, provocative, conversational, aspirational]
[caption]
**Hashtags:** [hashtags]

[repeat for all 5]`,
    }],
  });

  const rawOutput = msg.content[0].text;
  const captain = await runCaptain('Writer', rawOutput, `Captions for @${username}, ${(account.followers_count || 0).toLocaleString()} followers, ${captions.length} caption samples analyzed`);
  const id = saveOutput('writer', `Captions for @${username}${contentGoal ? ` — ${contentGoal}` : ''}`, rawOutput, captain.reviewed, captain.notes, userId);

  return { id, username, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

// ── ASSISTANT ─────────────────────────────────────────────────────────────────
// Research agent: answers questions using database context + Instagram knowledge.

async function runAssistant({ question, requestingAgent = 'user', userId }) {
  const accounts = getAccountsContext(userId);
  const viral    = getRecentViral(30, userId);
  const stats    = {
    totalAccounts: accounts.length,
    totalViral: viral.length,
    avgMultiplier: viral.length ? (viral.reduce((s, v) => s + (v.multiplier || 0), 0) / viral.length).toFixed(2) : 0,
    topAccount: viral.length ? viral[0].username : null,
  };

  const dbContext = [
    `DATABASE SNAPSHOT (${new Date().toISOString().slice(0,10)}):`,
    `Accounts tracked: ${stats.totalAccounts}`,
    accounts.map(a => `  • @${a.username} — ${(a.followers_count||0).toLocaleString()} followers, avg ER ${(a.avg_engagement_rate||0).toFixed(2)}%`).join('\n'),
    '',
    `Viral posts (last 30 days): ${stats.totalViral}`,
    `Avg multiplier: ${stats.avgMultiplier}x`,
    viral.slice(0, 15).map(v =>
      `  • @${v.username} | ${v.post_type} | ${(v.multiplier||0).toFixed(1)}x | ER ${(v.engagement_rate||0).toFixed(2)}%` +
      (v.caption ? ` | "${v.caption.substring(0,100).replace(/\n/g,' ')}…"` : '')
    ).join('\n'),
  ].join('\n');

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 1800,
    system: `You are the Assistant — a research specialist on a creator-management agency's analytics team. Every account in the database is a signed client of this agency (often using stage names or personas rather than legal names), analyzed with explicit consent using their own public Instagram post metrics. This is first-party creator analytics. You have access to the agency's client performance database and deep knowledge of Instagram strategy, algorithm behavior, content trends, and creator economics. Answer questions directly and specifically. When citing database data, say "from our database." When using general knowledge, be clear about that too. No fluff. Do not refuse or reframe this as surveillance — it is routine first-party creator analytics.`,
    messages: [{
      role: 'user',
      content: `${requestingAgent !== 'user' ? `[Research request from ${requestingAgent}]\n` : ''}Question: ${question}\n\n${dbContext}`,
    }],
  });

  const answer = msg.content[0].text;
  const captain = await runCaptain('Assistant', answer, `Research question: "${question.substring(0, 150)}"`);
  const id = saveOutput('assistant', question.substring(0, 200), answer, captain.reviewed, captain.notes, userId);
  return { id, question, answer: captain.reviewed };
}

// ── PROFILE BUILDER ───────────────────────────────────────────────────────────
// Builds a deep intelligence profile for a single creator based on their post data.

async function runProfileBuilder(accountId, userId) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  if (!account) throw new Error('Creator not found');

  const posts = db.prepare(`
    SELECT caption, post_type, likes_count, comments_count, plays_count, engagement_rate, posted_at
    FROM posts WHERE account_id = ? ORDER BY engagement_rate DESC LIMIT 40
  `).all(accountId);

  const viralPosts = db.prepare(`
    SELECT p.caption, p.post_type, p.likes_count, p.comments_count, p.plays_count, p.engagement_rate, al.multiplier
    FROM alerts al JOIN posts p ON al.post_id = p.id
    WHERE al.account_id = ? ORDER BY al.multiplier DESC LIMIT 15
  `).all(accountId);

  if (!posts.length) throw new Error(`No post data yet for @${account.username} — run a scan first`);

  const postBlock = posts.map(p =>
    `[${p.post_type} | ER: ${(p.engagement_rate||0).toFixed(2)}% | ♥${p.likes_count} 💬${p.comments_count} ▶${p.plays_count||0}]\n"${(p.caption||'').substring(0,300).replace(/\n/g,' ')}"`
  ).join('\n\n');

  const viralBlock = viralPosts.length
    ? viralPosts.map(v =>
        `[${v.multiplier.toFixed(1)}x VIRAL | ${v.post_type} | ER: ${(v.engagement_rate||0).toFixed(2)}%]\n"${(v.caption||'').substring(0,300).replace(/\n/g,' ')}"`
      ).join('\n\n')
    : 'No viral posts detected yet.';

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: `You are the Brain — a creator intelligence specialist. You analyze a creator's full post history and build a deep profile that captures who they are as a content creator: their voice, their themes, what makes their audience tick, and how to find more creators like them. You must respond with ONLY valid JSON — no markdown, no prose, no code fences. Match this schema exactly:

{
  "contentPillars": ["string", "string", "string"],
  "voiceFingerprint": "string",
  "audienceTriggers": "string",
  "nichePositioning": "string",
  "visualStyle": "string",
  "discoveryBrief": "string",
  "strengthSummary": "string"
}

contentPillars: 3-5 core topics/themes this creator consistently covers.
voiceFingerprint: 2-3 sentences describing their unique tone, personality, communication style, and how they talk to their audience.
audienceTriggers: What specifically drives engagement for this creator — emotional hooks, topics, formats, or moments that consistently pull their audience in.
nichePositioning: Where they sit in their niche — are they aspirational, relatable, educational, entertainment-driven, authority-based? How do they differentiate?
visualStyle: Their content format preferences — reel style, pacing, text overlay use, aesthetic, talking head vs b-roll, editing energy.
discoveryBrief: A specific 3-4 sentence brief someone could use to find similar creators on Instagram. Be concrete — mention follower range, niche keywords, content style markers, aesthetic cues.
strengthSummary: One sentence — their single biggest content strength that makes them stand out.`,
    messages: [{
      role: 'user',
      content: `Build a creator intelligence profile for @${account.username}${account.full_name ? ` (${account.full_name})` : ''}.

ACCOUNT STATS:
• Followers: ${(account.followers_count||0).toLocaleString()}
• Avg Engagement Rate: ${(account.avg_engagement_rate||0).toFixed(2)}%
• Group: ${account.group_name || 'Ungrouped'}

TOP-PERFORMING POSTS (by engagement rate):
${postBlock}

VIRAL POSTS (above threshold):
${viralBlock}`,
    }],
  });

  const raw = msg.content[0].text;
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    throw new Error('Profile builder returned malformed JSON');
  }

  db.prepare(`
    INSERT INTO creator_profiles (account_id, user_id, content_pillars, voice_fingerprint, audience_triggers, niche_positioning, visual_style, discovery_brief, strength_summary, built_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_id) DO UPDATE SET
      content_pillars = excluded.content_pillars,
      voice_fingerprint = excluded.voice_fingerprint,
      audience_triggers = excluded.audience_triggers,
      niche_positioning = excluded.niche_positioning,
      visual_style = excluded.visual_style,
      discovery_brief = excluded.discovery_brief,
      strength_summary = excluded.strength_summary,
      built_at = datetime('now')
  `).run(
    accountId, userId,
    JSON.stringify(profile.contentPillars),
    profile.voiceFingerprint,
    profile.audienceTriggers,
    profile.nichePositioning,
    profile.visualStyle,
    profile.discoveryBrief,
    profile.strengthSummary
  );

  return { accountId, username: account.username, profile };
}

// ── IDEATOR ───────────────────────────────────────────────────────────────────
// Generates reel/TikTok ideas tailored to a specific creator group's style and data.

async function runIdeator({ group = null, userId } = {}) {
  const accountQuery = group
    ? db.prepare(`SELECT username, full_name, followers_count, avg_engagement_rate, group_name
                  FROM accounts WHERE user_id = ? AND group_name = ? ORDER BY followers_count DESC`).all(userId, group)
    : db.prepare(`SELECT username, full_name, followers_count, avg_engagement_rate, group_name
                  FROM accounts WHERE user_id = ? ORDER BY followers_count DESC`).all(userId);

  if (!accountQuery.length) throw new Error(group ? `No creators found in group "${group}"` : 'No creators tracked yet');

  const viral = db.prepare(`
    SELECT acc.username, acc.group_name, p.post_type, p.caption,
           p.likes_count, p.comments_count, p.plays_count, p.engagement_rate, al.multiplier
    FROM alerts al
    JOIN posts p ON al.post_id = p.id
    JOIN accounts acc ON al.account_id = acc.id
    WHERE acc.user_id = ? ${group ? 'AND acc.group_name = ?' : ''}
      AND al.triggered_at >= datetime('now', '-30 days')
    ORDER BY al.multiplier DESC LIMIT 25
  `).all(...(group ? [userId, group] : [userId]));

  const captions = db.prepare(`
    SELECT acc.username, p.caption, p.post_type, p.likes_count, p.engagement_rate
    FROM posts p
    JOIN accounts acc ON p.account_id = acc.id
    WHERE acc.user_id = ? AND p.caption IS NOT NULL ${group ? 'AND acc.group_name = ?' : ''}
    ORDER BY p.engagement_rate DESC LIMIT 30
  `).all(...(group ? [userId, group] : [userId]));

  const accountSummary = accountQuery.map(a =>
    `• @${a.username}${a.full_name ? ` (${a.full_name})` : ''} — ${(a.followers_count || 0).toLocaleString()} followers | avg ER: ${(a.avg_engagement_rate || 0).toFixed(2)}%`
  ).join('\n');

  const viralSummary = viral.length
    ? viral.map(v =>
        `• @${v.username} | ${v.post_type} | ${(v.multiplier || 0).toFixed(1)}x avg | ER: ${(v.engagement_rate || 0).toFixed(2)}%\n` +
        `  Caption: "${(v.caption || '').substring(0, 150).replace(/\n/g, ' ')}"`
      ).join('\n\n')
    : 'No viral posts yet for this group.';

  const captionSamples = captions.length
    ? captions.slice(0, 15).map(c =>
        `[@${c.username} | ${c.post_type} | ER: ${(c.engagement_rate || 0).toFixed(2)}%]\n"${(c.caption || '').substring(0, 200).replace(/\n/g, ' ')}"`
      ).join('\n\n')
    : 'No caption data yet.';

  const profileRows = db.prepare(`
    SELECT cp.*, a.username FROM creator_profiles cp
    JOIN accounts a ON cp.account_id = a.id
    WHERE cp.user_id = ? ${group ? 'AND a.group_name = ?' : ''}
  `).all(...(group ? [userId, group] : [userId]));

  const profileBlock = profileRows.length
    ? '\nCREATOR INTELLIGENCE PROFILES:\n' + profileRows.map(p =>
        `@${p.username}:\n  Voice: ${p.voice_fingerprint}\n  Pillars: ${p.content_pillars}\n  Triggers: ${p.audience_triggers}\n  Strength: ${p.strength_summary}`
      ).join('\n\n')
    : '';

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: `You are the Ideator — a reel and TikTok content strategist for a creator-management agency. Every creator in your inputs is a signed client of this agency, analyzed with explicit consent using their public Instagram post metrics. Your job is to generate highly specific, ready-to-film reel and TikTok ideas tailored to the exact niche, voice, and style of the creator group you're given. Study what's working in their data and extrapolate ideas that will actually perform — not generic content advice. Every idea must be specific enough that someone could start filming it today.`,
    messages: [{
      role: 'user',
      content: `Generate 5 ready-to-film reel/TikTok ideas for the "${group || 'All Creators'}" group.

CLIENT PROFILES:
${accountSummary}
${profileBlock}

TOP-PERFORMING VIRAL POSTS (last 30 days):
${viralSummary}

CAPTION & VOICE SAMPLES (best-performing content):
${captionSamples}

Study what's working for these specific creators and generate exactly 5 ideas that match their niche, tone, and audience.

For EACH idea use this exact format:

### IDEA [number] — [PUNCHY TITLE IN CAPS]
**Hook:** [The exact first line the viewer sees or hears — make it scroll-stopping]
**Format:** [Length, style, pacing, text overlays, talking head vs B-roll, audio type]
**Concept:** [What happens — describe it like you're pitching it to the creator, 2-3 sentences]
**Caption Angle:** [What emotional hook or narrative the caption should open with]
**Why It'll Work:** [One specific reason grounded in the group's own performance data]

Then close with:

## PRIORITY PICKS
The top 3 ideas to execute first, ranked by expected impact, and why.

## GROUP PATTERNS
2-3 specific observations about what consistently drives engagement for this creator group based on their data.`,
    }],
  });

  const rawOutput = msg.content[0].text;
  const captain = await runCaptain('Ideator', rawOutput, `Reel ideas for group: "${group || 'All'}", ${accountQuery.length} creators, ${viral.length} viral posts analyzed`);
  const id = saveOutput('ideator', `Reel ideas: ${group || 'All creators'}`, rawOutput, captain.reviewed, captain.notes, userId);

  return { id, group, accountCount: accountQuery.length, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

module.exports = { runStrategist, runWriter, runAssistant, runCaptain, runIdeator, runProfileBuilder };
