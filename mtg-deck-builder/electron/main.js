const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { parseArenaLog } = require('./arena-log')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0D0D0D',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/icon.png'),
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── Arena log import ──────────────────────────────────────────────────────────

ipcMain.handle('arena:detect-log', async () => {
  const candidates = getArenaLogPaths()
  for (const p of candidates) {
    if (fs.existsSync(p)) return { found: true, path: p }
  }
  return { found: false, path: null }
})

ipcMain.handle('arena:browse-log', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select MTG Arena Player.log',
    filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return { canceled: true }
  return { canceled: false, path: result.filePaths[0] }
})

ipcMain.handle('arena:parse-log', async (_event, logPath) => {
  try {
    const collection = parseArenaLog(logPath)
    return { success: true, collection }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── Claude API ────────────────────────────────────────────────────────────────

ipcMain.handle('claude:recommend', async (_event, { apiKey, collection, preferences, metagame }) => {
  try {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic.default({ apiKey })

    const collectionSummary = summarizeCollection(collection)
    const prompt = buildRecommendationPrompt(collectionSummary, preferences, metagame)

    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: `You are an expert Magic: The Gathering deck builder with deep knowledge of all formats, archetypes, and the current metagame. You help players build optimal decks from their available card collections. Always respond with valid JSON.`,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].text
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text]
    return { success: true, result: JSON.parse(jsonMatch[1] || text) }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('claude:trials', async (_event, { apiKey, deck, matchups, format }) => {
  try {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic.default({ apiKey })

    const prompt = buildTrialsPrompt(deck, matchups, format)

    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 8192,
      system: `You are an expert MTG competitive analyst. You analyze deck matchups with deep understanding of game theory, sequencing, and sideboarding. Given statistical win-rate data and deck lists, you provide actionable strategic breakdowns. Always respond with valid JSON.`,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].text
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text]
    return { success: true, result: JSON.parse(jsonMatch[1] || text) }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ── App settings ──────────────────────────────────────────────────────────────

const Store = require('electron-store')
const store = new Store()

ipcMain.handle('store:get', (_event, key) => store.get(key))
ipcMain.handle('store:set', (_event, key, value) => store.set(key, value))
ipcMain.handle('store:delete', (_event, key) => store.delete(key))

// ── Helpers ───────────────────────────────────────────────────────────────────

function getArenaLogPaths() {
  const home = require('os').homedir()
  if (process.platform === 'win32') {
    return [
      path.join(process.env.APPDATA || '', '../LocalLow/Wizards Of The Coast/MTGA/Player.log'),
      path.join(home, 'AppData/LocalLow/Wizards Of The Coast/MTGA/Player.log'),
    ]
  }
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library/Logs/Wizards Of The Coast/MTGA/Player.log'),
    ]
  }
  // Linux (via Wine / Lutris)
  return [
    path.join(home, '.wine/drive_c/users', require('os').userInfo().username, 'AppData/LocalLow/Wizards Of The Coast/MTGA/Player.log'),
  ]
}

function summarizeCollection(collection) {
  if (!collection || !collection.cards) return 'No collection data available.'
  const total = Object.values(collection.cards).reduce((a, b) => a + b, 0)
  const unique = Object.keys(collection.cards).length
  return `Player owns ${unique} unique cards (${total} total copies). Wildcards: ${JSON.stringify(collection.wildcards || {})}. Card list: ${JSON.stringify(collection.cards)}`
}

function buildRecommendationPrompt(collectionSummary, preferences, metagame) {
  return `Based on this player's MTG Arena collection, recommend 3 competitive decks they can build.

COLLECTION:
${collectionSummary}

PLAYER PREFERENCES:
- Format: ${preferences.format || 'Standard'}
- Playstyle: ${preferences.playstyle || 'Any'}
- Budget (wildcards to craft): ${preferences.wildcardBudget || 'Unlimited'}
- Notes: ${preferences.notes || 'None'}

CURRENT META (top decks):
${metagame ? JSON.stringify(metagame.topDecks?.slice(0, 10), null, 2) : 'Meta data unavailable'}

Respond with JSON in this exact format:
\`\`\`json
{
  "recommendations": [
    {
      "name": "Deck Name",
      "archetype": "Archetype (e.g. Azorius Soldiers)",
      "format": "Standard",
      "metaPosition": "Tier 1 / Tier 2 / Rogue",
      "description": "2-3 sentence description of the deck strategy",
      "playstyle": "Aggro / Control / Midrange / Combo",
      "ownedPercentage": 85,
      "cardsTocraft": [
        { "name": "Card Name", "quantity": 2, "rarity": "Rare", "wildcardCost": 2 }
      ],
      "decklist": {
        "mainboard": [
          { "quantity": 4, "name": "Card Name", "type": "Creature" }
        ],
        "sideboard": [
          { "quantity": 2, "name": "Card Name", "type": "Instant" }
        ]
      },
      "keyCards": ["Card 1", "Card 2", "Card 3"],
      "whyThisDeck": "Why this deck suits their collection/playstyle"
    }
  ]
}
\`\`\``
}

function buildTrialsPrompt(deck, matchups, format) {
  const matchupData = matchups
    .map(m => `${m.opponent}: ${m.winRate}% win rate (${m.sampleSize} games) — opponent list: ${JSON.stringify(m.cardList || [])}`)
    .join('\n')

  return `Analyze how this ${format || 'Standard'} deck performs against the current metagame.

OUR DECK:
${JSON.stringify(deck, null, 2)}

STATISTICAL MATCHUP DATA:
${matchupData}

For each matchup, provide:
1. Strategic analysis of why the numbers are what they are
2. Key cards on each side that define the matchup
3. Game plan pre-board and post-board
4. Specific sideboard recommendations

Respond with JSON in this exact format:
\`\`\`json
{
  "deckArchetype": "Detected archetype name",
  "overallMetaScore": 7.2,
  "metaSummary": "Overall assessment of where this deck sits in the meta",
  "matchups": [
    {
      "opponent": "Deck Name",
      "winRate": 52.3,
      "sampleSize": 1240,
      "favorability": "Favored / Even / Unfavored / Highly Unfavored",
      "summary": "One sentence matchup summary",
      "ourGamePlan": "What we're trying to do in this matchup",
      "theirGamePlan": "What they're trying to do",
      "keyCardsOurs": ["Our card that matters", "..."],
      "keyCardsTheirs": ["Their threat to answer", "..."],
      "preBoardLines": "Key pre-board strategic lines",
      "postBoardLines": "How the matchup shifts post-board",
      "sideboardIn": ["Card to bring in", "..."],
      "sideboardOut": ["Card to cut", "..."],
      "tips": ["Tip 1", "Tip 2"]
    }
  ],
  "generalSideboardAdvice": "Overall sideboard construction thoughts",
  "weaknesses": ["Meta weakness 1", "..."],
  "strengths": ["Meta strength 1", "..."]
}
\`\`\``
}
