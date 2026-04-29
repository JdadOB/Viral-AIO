// reddit.js — Reddit prospect finder + reply drafter
const axios = require('axios');
const { draftRedditReply } = require('./outreach-drafter');

const SUBREDDITS = [
  'onlyfansadvice',
  'CreatorServices',
  'socialmediamarketing',
  'influencermarketing',
  'Entrepreneur',
  'smallbusiness',
  'content_creators',
  'digitalmarketing',
];

// Keywords that signal a good prospect
const SIGNAL_KEYWORDS = [
  'creator management', 'managing creators', 'creator agency',
  'caption', 'captions', 'viral', 'engagement rate', 'analytics',
  'track', 'tracking', 'influencer management', 'social media manager',
  'content calendar', 'posting schedule', 'hashtags',
  'onlyfans manager', 'of agency', 'of management',
  'tool', 'software', 'automate', 'automation',
  'instagram growth', 'tiktok growth',
];

// Keywords that make it extra relevant
const HIGH_VALUE_KEYWORDS = [
  'looking for', 'recommend', 'suggestion', 'advice', 'help',
  'how do you', 'what do you use', 'best tool', 'any tool',
  'struggling', 'hard to', 'difficult', 'time consuming', 'takes forever',
  'miss', 'missed', 'manual', 'manually',
];

function scorePost(post) {
  const text = (post.title + ' ' + (post.selftext || '')).toLowerCase();
  let score = 0;

  for (const kw of SIGNAL_KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }
  for (const kw of HIGH_VALUE_KEYWORDS) {
    if (text.includes(kw)) score += 3;
  }

  // Boost newer posts
  const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
  if (ageHours < 2) score += 5;
  else if (ageHours < 6) score += 3;
  else if (ageHours < 24) score += 1;

  // Boost posts with comments (engagement = real thread)
  if (post.num_comments > 0 && post.num_comments < 20) score += 2;

  return score;
}

async function getRedditToken() {
  const { REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD } = process.env;
  if (!REDDIT_CLIENT_ID) throw new Error('Reddit credentials not configured in .env');

  const params = new URLSearchParams({
    grant_type: 'password',
    username: REDDIT_USERNAME,
    password: REDDIT_PASSWORD,
  });

  const res = await axios.post('https://www.reddit.com/api/v1/access_token',
    params.toString(),
    {
      auth: { username: REDDIT_CLIENT_ID, password: REDDIT_CLIENT_SECRET },
      headers: { 'User-Agent': 'ViralTrackOutreach/1.0' },
    }
  );
  return res.data.access_token;
}

async function fetchSubredditPosts(token, subreddit, limit = 25) {
  const res = await axios.get(`https://oauth.reddit.com/r/${subreddit}/new`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'ViralTrackOutreach/1.0',
    },
    params: { limit },
  });
  return res.data.data.children.map(c => ({ ...c.data, subreddit }));
}

async function scanReddit() {
  console.log('[Reddit] Scanning for prospects...');

  let token;
  try {
    token = await getRedditToken();
  } catch (e) {
    console.log('[Reddit] No credentials — using public API (rate limited)');
  }

  const prospects = [];

  for (const sub of SUBREDDITS) {
    try {
      let posts;
      if (token) {
        posts = await fetchSubredditPosts(token, sub);
      } else {
        // Fallback: public JSON API (no auth, rate limited)
        const res = await axios.get(`https://www.reddit.com/r/${sub}/new.json`, {
          params: { limit: 25 },
          headers: { 'User-Agent': 'ViralTrackOutreach/1.0' },
        });
        posts = res.data.data.children.map(c => ({ ...c.data, subreddit: sub }));
      }

      for (const post of posts) {
        const score = scorePost(post);
        if (score >= 4) {
          prospects.push({
            score,
            subreddit: sub,
            title: post.title,
            body: (post.selftext || '').substring(0, 500),
            url: `https://reddit.com${post.permalink}`,
            author: post.author,
            created: new Date(post.created_utc * 1000).toISOString(),
            comments: post.num_comments,
            postId: post.id,
          });
        }
      }

      // Rate limit respect
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.error(`[Reddit] r/${sub}: ${e.message}`);
    }
  }

  // Sort by score desc
  prospects.sort((a, b) => b.score - a.score);

  console.log(`[Reddit] Found ${prospects.length} prospects`);

  if (!prospects.length) return [];

  // Draft replies for top 10
  const top = prospects.slice(0, 10);
  const results = [];
  for (const p of top) {
    try {
      const draft = await draftRedditReply(p);
      results.push({ ...p, draft });
    } catch (e) {
      console.error(`[Reddit] Draft failed for "${p.title.substring(0, 40)}": ${e.message}`);
    }
  }

  return results;
}

module.exports = { scanReddit };
