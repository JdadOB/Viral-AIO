const fs = require('fs')

/**
 * Parses MTG Arena's Player.log to extract the player's card collection.
 * Arena writes JSON blobs to the log for various API responses.
 * The most reliable source is the GetPlayerCardsV3 response.
 */
function parseArenaLog(logPath) {
  const content = fs.readFileSync(logPath, 'utf8')
  const lines = content.split('\n')

  let collection = null
  let wildcards = {}
  let deckList = []

  // Walk backwards to find the most recent collection snapshot
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]

    // Card collection: Inventory.GetPlayerCardsV3
    if (!collection && line.includes('GetPlayerCardsV3') && line.includes('<==')) {
      const jsonBlock = extractNextJson(lines, i + 1)
      if (jsonBlock) {
        try {
          const parsed = JSON.parse(jsonBlock)
          // Format: { payload: { cards: { "arenaId": count, ... } } }
          // or directly: { "arenaId": count }
          if (parsed.payload?.cards) {
            collection = parsed.payload.cards
          } else if (parsed.cards) {
            collection = parsed.cards
          } else if (typeof parsed === 'object' && !parsed.payload) {
            // Direct card map
            const allNumericKeys = Object.keys(parsed).every(k => /^\d+$/.test(k))
            if (allNumericKeys) collection = parsed
          }
        } catch (_) {}
      }
    }

    // Wildcards: from inventory
    if (!Object.keys(wildcards).length && line.includes('Inventory.GetPlayerInventory') && line.includes('<==')) {
      const jsonBlock = extractNextJson(lines, i + 1)
      if (jsonBlock) {
        try {
          const parsed = JSON.parse(jsonBlock)
          const inv = parsed.payload || parsed
          wildcards = {
            common: inv.wcCommon || 0,
            uncommon: inv.wcUncommon || 0,
            rare: inv.wcRare || 0,
            mythic: inv.wcMythic || 0,
          }
        } catch (_) {}
      }
    }

    // Decks: GetPlayerDecksV3
    if (!deckList.length && line.includes('GetPlayerDecksV3') && line.includes('<==')) {
      const jsonBlock = extractNextJson(lines, i + 1)
      if (jsonBlock) {
        try {
          const parsed = JSON.parse(jsonBlock)
          const decks = parsed.payload || parsed
          if (Array.isArray(decks)) deckList = decks
        } catch (_) {}
      }
    }

    if (collection && Object.keys(wildcards).length && deckList.length) break
  }

  if (!collection) {
    // Try the older V2 format
    collection = extractCollectionV2(lines)
  }

  return {
    cards: collection || {},
    wildcards,
    decks: deckList,
    importedAt: new Date().toISOString(),
  }
}

function extractNextJson(lines, startIndex) {
  let buffer = ''
  let depth = 0
  let inJson = false

  for (let i = startIndex; i < Math.min(startIndex + 500, lines.length); i++) {
    const line = lines[i]

    if (!inJson) {
      const start = line.indexOf('{')
      if (start !== -1) {
        inJson = true
        buffer = line.slice(start)
        depth = countBraces(buffer)
        if (depth === 0) return buffer
      }
      continue
    }

    buffer += '\n' + line
    depth += countBraces(line)
    if (depth === 0) return buffer
  }

  return null
}

function countBraces(str) {
  let count = 0
  for (const ch of str) {
    if (ch === '{') count++
    else if (ch === '}') count--
  }
  return count
}

function extractCollectionV2(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('PlayerCardsV2') || lines[i].includes('InventoryUpdated')) {
      const block = extractNextJson(lines, i + 1)
      if (block) {
        try {
          const parsed = JSON.parse(block)
          if (parsed.payload) return parsed.payload
        } catch (_) {}
      }
    }
  }
  return null
}

module.exports = { parseArenaLog }
