# MTG Deck Builder

A cross-platform desktop app (Electron + React) for building MTG Arena decks, powered by two AI agents.

## Features

- **Collection Import** — reads your card collection directly from MTG Arena's local log file
- **Deck Builder** — full card search via Scryfall API, mana curve visualization, group-by-type view
- **AI Deck Recommendations** — Claude analyzes your collection + the current meta and suggests 3 optimized decks with crafting lists
- **Deck Trials** — paste any deck; get real matchup win-rate data combined with Claude's strategic breakdown per matchup (game plan, sideboard guide, key cards)

## Getting Started

### Prerequisites
- Node.js 18+
- MTG Arena installed (for collection import)
- Anthropic API key (for AI features — get one at console.anthropic.com)

### Install & Run

```bash
cd mtg-deck-builder
npm install
cp .env.example .env   # optional; API key can also be set in-app
npm run dev
```

### Build for Distribution

```bash
npm run build        # current platform
npm run build:win    # Windows .exe
npm run build:mac    # macOS .dmg
npm run build:linux  # Linux .AppImage
```

Output goes to `dist-electron/`.

## How the AI Agents Work

### Agent 1 — Deck Recommendations
Sends your collection summary + metagame snapshot to Claude (`claude-opus-4-7`). Claude returns 3 deck recommendations with full decklists, crafting requirements, and reasoning. You can import any recommended deck directly into the Deck Builder.

### Agent 2 — Deck Trials
1. Parses your pasted deck list
2. Detects the archetype
3. Pulls statistical matchup win-rate data for that archetype from the metagame database
4. Sends both to Claude, which produces a per-matchup breakdown: win rate, game plan, key cards, sideboard guide, tips

## Arena Log Location

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\LocalLow\Wizards Of The Coast\MTGA\Player.log` |
| macOS | `~/Library/Logs/Wizards Of The Coast/MTGA/Player.log` |

The app auto-detects this path or you can browse for it manually.
