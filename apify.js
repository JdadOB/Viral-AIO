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

async function scrapeAccountPosts(username) {
  const client = getClient();

  const input = {
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: 'posts',
    resultsLimit: 30,
    addParentData: true,
  };

  const cookies = sessionCookies();
  if (cookies) input.loginCookies = cookies;

  const run = await client.actor('apify/instagram-scraper').call(input);
  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  return dataset?.items ?? [];
}

async function getAccountProfile(username) {
  const client = getClient();

  const input = {
    directUrls: [`https://www.instagram.com/${username}/`],
    resultsType: 'details',
    resultsLimit: 1,
  };

  const cookies = sessionCookies();
  if (cookies) input.loginCookies = cookies;

  const run = await client.actor('apify/instagram-scraper').call(input);
  const dataset = await client.dataset(run.defaultDatasetId).listItems();
  return dataset?.items?.[0] ?? null;
}

module.exports = { scrapeAccountPosts, getAccountProfile };
