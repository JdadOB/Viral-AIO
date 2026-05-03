const { ApifyClient } = require('apify-client');

function getClient() {
  return new ApifyClient({ token: process.env.APIFY_TOKEN });
}

function sessionCookies() {
  const raw = process.env.INSTAGRAM_SESSION_ID;
  if (!raw || raw === 'your_session_id_here') return undefined;
  const sessionId = decodeURIComponent(raw);
  return [
    { name: 'sessionid', value: sessionId, domain: '.instagram.com', path: '/' },
  ];
}

// limit: 30 for initial scrape, 5 for recurring polls
// parentData: true only for initial scrape (fetches follower count / profile metadata)
async function scrapeAccountPosts(username, { limit = 5, parentData = false } = {}) {
  const client = getClient();

  const input = {
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: 'posts',
    resultsLimit: limit,
    addParentData: parentData,
  };

  const cookies = sessionCookies();
  if (cookies) input.loginCookies = cookies;

  const run = await client.actor('apify/instagram-scraper').call(input);
  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  return dataset?.items ?? [];
}

module.exports = { scrapeAccountPosts };
