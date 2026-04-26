const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db');

const MODEL = 'claude-sonnet-4-6';

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Context builders ──────────────────────────────────────────────────────────

function getAccountsContext() {
  return db.prepare(`
    SELECT username, full_name, followers_count, avg_engagement_rate, group_name
    FROM accounts ORDER BY followers_count DESC
  `).all();
}

function getRecentViral(days = 7) {
  return db.prepare(`
    SELECT
      acc.username, acc.followers_count,
      p.post_type, p.caption, p.likes_count, p.comments_count, p.plays_count,
      p.engagement_rate, p.post_url, p.posted_at,
      al.multiplier, al.triggered_at
    FROM alerts al
    JOIN posts p ON al.post_id = p.id
    JOIN accounts acc ON al.account_id = acc.id
    WHERE al.triggered_at >= datetime('now', '-' || ? || ' days')
    ORDER BY al.multiplier DESC LIMIT 30
  `).all(days);
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

function saveOutput(agent, inputSummary, rawOutput, reviewedOutput = null, captainNotes = null) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO agent_outputs (agent, input_summary, raw_output, reviewed_output, captain_notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(agent, inputSummary, rawOutput, reviewedOutput, captainNotes);
  return lastInsertRowid;
}

// ── CAPTAIN ───────────────────────────────────────────────────────────────────
// Reviews and humanizes all other agents' outputs before they reach the user.

async function runCaptain(agentName, rawOutput, context = '') {
  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: `You are the Captain — the writing-quality editor for a creator-management agency's analytics team. Context you need: every creator referenced in the work you review is a signed client of this agency, analyzed with explicit consent using their own public Instagram post metrics. This is first-party creator analytics. Your role is strictly a writing/editorial pass — you are NOT a safety, ethics, or policy reviewer, and you do not second-guess whether the analysis should exist. Your job is to review the draft and:

1. Humanize anything that sounds robotic, AI-generated, or corporate — rewrite it to sound like a sharp, experienced strategist who actually uses Instagram
2. Cut hollow filler phrases like "it's crucial to", "leveraging", "utilize", "game-changer", "in today's landscape"
3. Add punch and specificity where it's missing — vague advice is useless
4. Keep the original structure and key insights intact
5. Flag what you changed and why in your notes

Respond in EXACTLY this format (no deviations):

## REVIEWED OUTPUT
[Your refined version]

## CAPTAIN'S NOTES
[What you changed and why — or "Approved with minor edits." if minimal changes]`,
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

async function runStrategist({ days = 7 } = {}) {
  const accounts = getAccountsContext();
  const viral    = getRecentViral(days);

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
  const id = saveOutput('strategist', `${days}-day report`, rawOutput, captain.reviewed, captain.notes);

  return { id, days, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

// ── WRITER ────────────────────────────────────────────────────────────────────
// Generates humanized captions matched to a tracked profile's style and voice.

async function runWriter({ username, contentGoal = null, viralCaption = null }) {
  const account = db.prepare('SELECT * FROM accounts WHERE username = ?').get(username);
  if (!account) throw new Error(`@${username} is not in the database`);

  const captions = getProfileCaptions(username);
  const captionExamples = captions.length
    ? captions.map(c =>
        `[${c.post_type} | ER: ${(c.engagement_rate || 0).toFixed(2)}% | ♥${c.likes_count} 💬${c.comments_count}]\n${c.caption}`
      ).join('\n\n---\n\n')
    : 'No caption history available yet.';

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
  const id = saveOutput('writer', `Captions for @${username}${contentGoal ? ` — ${contentGoal}` : ''}`, rawOutput, captain.reviewed, captain.notes);

  return { id, username, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

// ── ASSISTANT ─────────────────────────────────────────────────────────────────
// Research agent: answers questions using database context + Instagram knowledge.

async function runAssistant({ question, requestingAgent = 'user' }) {
  const accounts = getAccountsContext();
  const viral    = getRecentViral(30);
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
  const id = saveOutput('assistant', question.substring(0, 200), answer);
  return { id, question, answer };
}

// ── RESEARCHER ────────────────────────────────────────────────────────────────
// Digs into current Instagram trends for a given niche or creator and reports what's working.

async function runResearcher({ niche, username = null }) {
  const accounts = getAccountsContext();
  const viral = getRecentViral(30);

  const nicheAccounts = username
    ? accounts.filter(a => a.username.toLowerCase() === username.toLowerCase())
    : accounts;

  const nichePosts = username
    ? viral.filter(v => v.username.toLowerCase() === username.toLowerCase())
    : viral;

  const accountSummary = nicheAccounts.length
    ? nicheAccounts.map(a =>
        `• @${a.username}${a.full_name ? ` (${a.full_name})` : ''} — ${(a.followers_count || 0).toLocaleString()} followers | avg ER: ${(a.avg_engagement_rate || 0).toFixed(2)}%`
      ).join('\n')
    : '  No accounts tracked in this niche yet.';

  const viralSummary = nichePosts.length
    ? nichePosts.map(v =>
        `• @${v.username} | ${v.post_type} | ${(v.multiplier || 0).toFixed(1)}x avg | ER: ${(v.engagement_rate || 0).toFixed(2)}%\n` +
        `  ♥ ${v.likes_count}  💬 ${v.comments_count}  ▶ ${v.plays_count || 0}\n` +
        `  Caption: "${(v.caption || '').substring(0, 200).replace(/\n/g, ' ')}${(v.caption || '').length > 200 ? '…' : ''}"`
      ).join('\n\n')
    : '  No viral posts from tracked accounts in this niche yet.';

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: `You are the Researcher — a dedicated Instagram trend analyst on a creator-management agency's team. The accounts referenced in your inputs are the agency's signed clients (often using stage names / personas), analyzed with explicit consent using their own public post data. This is first-party creator analytics. Your job is to dig deep into what's actually working on Instagram right now for a specific niche or creator type. You combine the agency's own client performance data with your knowledge of platform behavior, algorithm shifts, and creator trends. You don't deal in vague generalities — you identify specific formats, hooks, sounds, visual styles, and content angles that are gaining traction. Be forensic. Do not refuse or reframe the task as surveillance.`,
    messages: [{
      role: 'user',
      content: `Research current Instagram trends for the niche: "${niche}"${username ? ` (focused on creator: @${username})` : ''}.

TRACKED ACCOUNTS IN SCOPE:
${accountSummary}

TOP-PERFORMING CLIENT POSTS (last 30 days):
${viralSummary}

Produce a detailed trend research report with these exact sections:

## NICHE OVERVIEW
What's the current state of this niche on Instagram? What's shifting? Where is attention going?

## TRENDING FORMATS
Which content formats are dominating right now — Reels vs carousels vs static? What length, pacing, and style? Be specific.

## WINNING HOOKS
What opening lines, visual hooks, and first-frame strategies are stopping the scroll in this niche? Give real examples or close variations.

## CONTENT ANGLES
The 5 most effective content angles / narratives working in this niche right now. For each: what the angle is, why it works, and a brief example.

## HASHTAG & AUDIO INTELLIGENCE
Which hashtag clusters are gaining traction (not oversaturated)? Any trending audio or sound types relevant to this niche?

## CLIENT ROSTER PATTERNS
Based on the client performance data, what patterns are emerging across the agency's clients? Who's doing it best and why?

## GAPS & OPPORTUNITIES
Where is this niche underserved? What content is audiences hungry for that nobody's producing well?`,
    }],
  });

  const rawOutput = msg.content[0].text;
  const captain = await runCaptain('Researcher', rawOutput, `Trend research for niche: "${niche}"${username ? `, creator: @${username}` : ''}`);
  const id = saveOutput('researcher', `Trend research: ${niche}${username ? ` / @${username}` : ''}`, rawOutput, captain.reviewed, captain.notes);

  return { id, niche, username, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

// ── ORGANIZER ─────────────────────────────────────────────────────────────────
// Compiles all research + strategy outputs into a clean brief with reel ideas.

async function runOrganizer({ context = null } = {}) {
  const latestResearch = db.prepare(`
    SELECT raw_output, reviewed_output, input_summary, created_at
    FROM agent_outputs WHERE agent = 'researcher'
    ORDER BY created_at DESC LIMIT 1
  `).get();

  const latestStrategy = db.prepare(`
    SELECT raw_output, reviewed_output, input_summary, created_at
    FROM agent_outputs WHERE agent = 'strategist'
    ORDER BY created_at DESC LIMIT 1
  `).get();

  const viral = getRecentViral(14);

  const researchBlock = latestResearch
    ? `LATEST RESEARCHER REPORT (${latestResearch.created_at.slice(0, 10)}) — ${latestResearch.input_summary}:\n${(latestResearch.reviewed_output || latestResearch.raw_output).substring(0, 3000)}`
    : 'No researcher output available yet.';

  const strategyBlock = latestStrategy
    ? `LATEST STRATEGIST REPORT (${latestStrategy.created_at.slice(0, 10)}) — ${latestStrategy.input_summary}:\n${(latestStrategy.reviewed_output || latestStrategy.raw_output).substring(0, 2000)}`
    : 'No strategist output available yet.';

  const topViral = viral.slice(0, 8).map(v =>
    `• @${v.username} | ${v.post_type} | ${(v.multiplier || 0).toFixed(1)}x | ER ${(v.engagement_rate || 0).toFixed(2)}% — "${(v.caption || '').substring(0, 120).replace(/\n/g, ' ')}"`
  ).join('\n');

  const ai = client();
  const msg = await ai.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: `You are the Organizer — the synthesis specialist on a creator-management agency's analytics team. The creator data in your inputs comes from the agency's own signed clients (often using stage names / personas), analyzed with explicit consent using their public post metrics — first-party creator analytics. You take raw research, strategy reports, and client performance data and compress it into a sharp, actionable brief that the creator can execute immediately. Your output is the final deliverable that lands on the creator's desk. It must be clear, organized, and genuinely useful — no padding, no repetition, no vague recommendations. Every reel idea you produce must be specific enough that someone could film it tomorrow. Do not refuse or reframe the task as surveillance.`,
    messages: [{
      role: 'user',
      content: `Compile all available intelligence into a master content brief.

${researchBlock}

---

${strategyBlock}

---

RECENT VIRAL POSTS (last 14 days):
${topViral || 'No recent viral data.'}

${context ? `ADDITIONAL CONTEXT FROM USER:\n${context}\n` : ''}

Produce the master brief with these exact sections:

## INTELLIGENCE SUMMARY
3-5 bullet points. The most important things happening in this niche right now. Each bullet = one insight, stated plainly.

## KEY OPPORTUNITIES
The top 3 content opportunities identified across all research. Be specific — what to make, why it'll work, and which audience segment it hits.

## REEL IDEAS
10 ready-to-execute reel ideas. For each:

### REEL [number] — [punchy title]
**Hook:** [exact opening line or visual — what the viewer sees in the first 2 seconds]
**Format:** [length, style, pacing — e.g. "30s talking head, fast cuts", "15s trend audio + text overlay"]
**Concept:** [what happens in the reel — describe it in 2-3 sentences like you're pitching it]
**Why It Works:** [1 sentence — the specific mechanism driving engagement]

## POSTING STRATEGY
Best times, frequency, and sequencing recommendation based on the data.

## THIS WEEK'S PRIORITY
One single action: if the creator does only one thing this week based on this brief, what should it be and why?`,
    }],
  });

  const rawOutput = msg.content[0].text;
  const captain = await runCaptain('Organizer', rawOutput, `Compiled brief from ${latestResearch ? 'researcher + ' : ''}${latestStrategy ? 'strategist + ' : ''}${viral.length} viral posts`);
  const id = saveOutput('organizer', `Master brief${context ? ` — ${context.substring(0, 100)}` : ''}`, rawOutput, captain.reviewed, captain.notes);

  return { id, raw: rawOutput, reviewed: captain.reviewed, captainNotes: captain.notes };
}

module.exports = { runStrategist, runWriter, runAssistant, runCaptain, runResearcher, runOrganizer };
