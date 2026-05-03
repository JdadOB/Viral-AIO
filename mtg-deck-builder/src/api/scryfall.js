const BASE = 'https://api.scryfall.com'

const cache = new Map()

async function fetchWithCache(url) {
  if (cache.has(url)) return cache.get(url)
  // Scryfall rate limit: max 10 req/sec; add small delay
  await new Promise(r => setTimeout(r, 75))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Scryfall error ${res.status}: ${url}`)
  const data = await res.json()
  cache.set(url, data)
  return data
}

export async function searchCards(query, page = 1) {
  const url = `${BASE}/cards/search?q=${encodeURIComponent(query)}&page=${page}&order=name`
  return fetchWithCache(url)
}

export async function getCardByName(name) {
  const url = `${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`
  return fetchWithCache(url)
}

export async function getCardByArenaId(arenaId) {
  const url = `${BASE}/cards/arena/${arenaId}`
  return fetchWithCache(url)
}

export async function getCardById(scryfallId) {
  const url = `${BASE}/cards/${scryfallId}`
  return fetchWithCache(url)
}

export async function resolveCollection(arenaCardMap) {
  // arenaCardMap: { "arenaId": count, ... }
  // Use Scryfall's collection endpoint (max 75 per request)
  const ids = Object.keys(arenaCardMap)
  const results = {}

  for (let i = 0; i < ids.length; i += 75) {
    const batch = ids.slice(i, i + 75)
    const identifiers = batch.map(id => ({ arena_id: parseInt(id) }))

    await new Promise(r => setTimeout(r, 100))
    const res = await fetch(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    })

    if (!res.ok) continue
    const data = await res.json()

    for (const card of (data.data || [])) {
      if (card.arena_id) {
        results[card.arena_id] = {
          ...card,
          count: arenaCardMap[card.arena_id] || 1,
        }
      }
    }
  }

  return results
}

export async function getAutoComplete(query) {
  if (query.length < 2) return []
  const url = `${BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`
  const data = await fetchWithCache(url)
  return data.data || []
}

export async function getMetaDecks(format = 'standard') {
  // Scryfall doesn't have meta data; this is a placeholder
  // Used by the metagame module instead
  return []
}
