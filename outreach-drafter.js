// drafter.js — AI-powered reply/DM drafter using Claude
const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const PRODUCT_CONTEXT = `
ViralTrack (viraltrack.org) is a creator intelligence platform for influencer and social media agencies.

What it does:
- Monitors Instagram creators 24/7 and fires alerts the moment a post goes viral (beats their engagement average by a set multiplier)
- AI caption writer trained on each creator's actual voice — writes captions that sound like them, not like AI
- Bulk video caption generation — upload .MOV files, AI analyzes keyframes and writes 3 captions per video
- Google Sheets export with one click
- Discord notifications for viral alerts
- Multi-client workspaces with role-based access (admin/manager/client)
- The Brain — builds a deep voice/style profile for each creator that powers the AI writing

Pricing: $97/mo Solo (10 creators), $159/mo Small Agency (30 creators), $299/mo Unlimited

Key pain points it solves:
- Manually checking every creator's profile every day to catch viral moments
- Writing captions from scratch for every video/post
- Disorganized content workflows across multiple clients
- Missing viral posts because you found out too late to capitalize
`;

async function draftRedditReply(prospect) {
  const ai = getClient();

  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `You write helpful, genuine Reddit replies that naturally mention ViralTrack when relevant. Rules:
- Sound like a real human, not a marketer
- Lead with actual value/advice that answers their question
- Only mention ViralTrack if it genuinely solves their stated problem — don't force it
- Keep it under 150 words
- No exclamation points, no corporate speak, no "Great question!"
- If ViralTrack is relevant, mention it casually at the end, not as the focus
- Include the URL (viraltrack.org) only if you mention the product`,

    messages: [{
      role: 'user',
      content: `Write a Reddit reply to this post in r/${prospect.subreddit}:

Title: ${prospect.title}
Body: ${prospect.body || '(no body)'}

Product context:
${PRODUCT_CONTEXT}

Write the reply text only — no preamble, no "Here's a reply:", just the reply itself.`,
    }],
  });

  return msg.content[0].text.trim();
}

async function draftTwitterDM(prospect) {
  const ai = getClient();

  const msg = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 250,
    system: `You write cold Twitter DMs for ViralTrack outreach. Rules:
- Max 3 sentences
- Reference something specific about their tweet or bio — no generic openers
- One clear CTA: check out viraltrack.org or ask if they want to see it
- Human tone, not salesy
- No "Hey!" or "Hi there!" openers — start with something substantive
- No emojis unless they use them
- Never lie or exaggerate`,

    messages: [{
      role: 'user',
      content: `Write a cold DM to this Twitter user about ViralTrack:

Username: @${prospect.username}
Name: ${prospect.name || ''}
Bio: ${prospect.bio || '(no bio)'}
Their tweet: ${prospect.text}

Product context:
${PRODUCT_CONTEXT}

Write the DM text only.`,
    }],
  });

  return msg.content[0].text.trim();
}

module.exports = { draftRedditReply, draftTwitterDM };
