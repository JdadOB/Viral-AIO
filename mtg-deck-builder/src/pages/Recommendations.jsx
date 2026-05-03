import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/AppContext'
import { getMetagame } from '../api/metagame'

const FORMATS = ['Standard', 'Explorer', 'Historic', 'Pioneer', 'Modern']
const PLAYSTYLES = ['Any', 'Aggro', 'Control', 'Midrange', 'Combo', 'Ramp']
const BUDGETS = [
  { label: 'Unlimited', value: 999 },
  { label: '20+ Wildcards', value: 20 },
  { label: '10+ Wildcards', value: 10 },
  { label: '5 or fewer', value: 5 },
]

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function Recommendations() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const [format, setFormat] = useState(state.format || 'Standard')
  const [playstyle, setPlaystyle] = useState('Any')
  const [wildcardBudget, setWildcardBudget] = useState(999)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [expandedDeck, setExpandedDeck] = useState(null)

  const canRun = state.apiKey && state.collection

  const handleRun = async () => {
    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const metagame = await getMetagame(format.toLowerCase())

      const result = await window.mtg.claude.recommend({
        apiKey: state.apiKey,
        collection: state.collection,
        preferences: { format, playstyle, wildcardBudget, notes },
        metagame,
      })

      if (!result.success) throw new Error(result.error)
      setResults(result.result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const importDeck = (rec) => {
    const deck = {
      id: generateId(),
      name: rec.name,
      format: rec.format || format,
      mainboard: (rec.decklist?.mainboard || []).map(c => ({
        id: `${c.name}-${generateId()}`,
        name: c.name,
        quantity: c.quantity,
        type_line: c.type || '',
        cmc: 0,
        colors: [],
      })),
      sideboard: (rec.decklist?.sideboard || []).map(c => ({
        id: `${c.name}-${generateId()}`,
        name: c.name,
        quantity: c.quantity,
        type_line: c.type || '',
        cmc: 0,
        colors: [],
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'ADD_DECK', payload: deck })
    navigate(`/deck-builder/${deck.id}`)
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Config panel */}
      <div className="w-72 flex-shrink-0 border-r border-mtg-border flex flex-col">
        <div className="p-5 border-b border-mtg-border">
          <div className="flex items-center gap-2 mb-1">
            <SparkIcon className="w-5 h-5 text-mtg-gold" />
            <h2 className="font-semibold">AI Recommendations</h2>
          </div>
          <p className="text-xs text-gray-400">Claude analyzes your collection and builds optimized decks for the current meta</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!state.apiKey && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-xs">
              Add your Anthropic API key in Settings to use AI features.
            </div>
          )}

          {!state.collection && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-blue-400 text-xs">
              Import your Arena collection first for personalized recommendations.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Format</label>
            <select value={format} onChange={e => setFormat(e.target.value)} className="input">
              {FORMATS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Playstyle</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PLAYSTYLES.map(p => (
                <button
                  key={p}
                  onClick={() => setPlaystyle(p)}
                  className={`py-1.5 rounded text-xs font-medium transition-colors ${playstyle === p ? 'bg-mtg-gold text-mtg-black' : 'bg-mtg-dark text-gray-400 hover:text-mtg-white border border-mtg-border'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Wildcard Budget</label>
            <select value={wildcardBudget} onChange={e => setWildcardBudget(Number(e.target.value))} className="input">
              {BUDGETS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. I prefer fast games, I have a good black collection..."
              className="input h-20 resize-none text-sm"
            />
          </div>
        </div>

        <div className="p-5 border-t border-mtg-border">
          <button
            onClick={handleRun}
            disabled={!canRun || loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <SpinnerIcon className="w-4 h-4 animate-spin" />
                Analyzing collection...
              </>
            ) : (
              <>
                <SparkIcon className="w-4 h-4" />
                Get Recommendations
              </>
            )}
          </button>
        </div>
      </div>

      {/* Right: Results */}
      <div className="flex-1 overflow-y-auto p-6">
        {!results && !loading && !error && (
          <EmptyState hasKey={!!state.apiKey} hasCollection={!!state.collection} />
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            <p className="font-medium mb-1">Error</p>
            <p>{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <SpinnerIcon className="w-8 h-8 animate-spin text-mtg-gold mx-auto mb-3" />
              <p className="text-gray-400">Claude is analyzing your collection and the current meta...</p>
              <p className="text-gray-500 text-sm mt-1">This may take 15-30 seconds</p>
            </div>
          </div>
        )}

        {results?.recommendations && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Recommended Decks</h2>
              <span className="text-sm text-gray-400">{results.recommendations.length} decks for {format}</span>
            </div>

            {results.recommendations.map((rec, i) => (
              <RecommendationCard
                key={i}
                rec={rec}
                expanded={expandedDeck === i}
                onToggle={() => setExpandedDeck(expandedDeck === i ? null : i)}
                onImport={() => importDeck(rec)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RecommendationCard({ rec, expanded, onToggle, onImport }) {
  const tierBadge = { 'Tier 1': 'badge-tier1', 'Tier 2': 'badge-tier2', 'Rogue': 'badge-rogue' }
  return (
    <div className="panel overflow-hidden">
      <div
        className="p-4 cursor-pointer hover:bg-mtg-dark/30 transition-colors flex items-start gap-4"
        onClick={onToggle}
      >
        {/* Color pips */}
        <div className="flex gap-1 pt-0.5 flex-shrink-0">
          {(rec.colors || guessColors(rec.archetype)).map(c => (
            <div key={c} className={`mana-${c}`}>{c}</div>
          ))}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{rec.name}</h3>
            <span className={`badge ${tierBadge[rec.metaPosition] || 'badge-tier2'}`}>{rec.metaPosition}</span>
            <span className="badge bg-gray-600/30 text-gray-400">{rec.playstyle}</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">{rec.description}</p>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-20 h-1.5 bg-mtg-dark rounded-full overflow-hidden">
                <div className="h-full bg-mtg-gold rounded-full" style={{ width: `${rec.ownedPercentage || 0}%` }} />
              </div>
              <span className="text-xs text-gray-400">{rec.ownedPercentage || 0}% owned</span>
            </div>
            {rec.cardsTocraft?.length > 0 && (
              <span className="text-xs text-gray-400">
                {rec.cardsTocraft.reduce((s, c) => s + (c.wildcardCost || c.quantity || 0), 0)} wildcards to craft
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); onImport() }}
            className="btn-primary text-xs px-3 py-1.5"
          >
            Import Deck
          </button>
          <ChevronIcon className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-mtg-border p-4 bg-mtg-dark/20">
          <div className="grid grid-cols-2 gap-6">
            {/* Decklist */}
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Decklist</h4>
              <div className="space-y-1 text-sm">
                {(rec.decklist?.mainboard || []).map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-mtg-gold w-4">{c.quantity}</span>
                    <span>{c.name}</span>
                    <span className="text-gray-500 text-xs self-center">{c.type}</span>
                  </div>
                ))}
              </div>
              {rec.decklist?.sideboard?.length > 0 && (
                <>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 mt-4">Sideboard</h4>
                  <div className="space-y-1 text-sm">
                    {rec.decklist.sideboard.map((c, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-mtg-gold w-4">{c.quantity}</span>
                        <span>{c.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Why this deck + crafting */}
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Why This Deck</h4>
                <p className="text-sm text-gray-300">{rec.whyThisDeck}</p>
              </div>

              {rec.keyCards?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Key Cards</h4>
                  <div className="flex flex-wrap gap-1">
                    {rec.keyCards.map(card => (
                      <span key={card} className="badge bg-mtg-panel text-gray-300 border border-mtg-border">{card}</span>
                    ))}
                  </div>
                </div>
              )}

              {rec.cardsTocraft?.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Cards to Craft</h4>
                  <div className="space-y-1">
                    {rec.cardsTocraft.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={`badge ${rarityBadge(c.rarity)}`}>{c.rarity?.[0]?.toUpperCase()}</span>
                        <span>{c.name}</span>
                        <span className="text-gray-500 text-xs ml-auto">×{c.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ hasKey, hasCollection }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-sm">
        <SparkIcon className="w-16 h-16 text-mtg-gold/30 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">AI Deck Recommendations</h3>
        <p className="text-gray-500 text-sm">
          {!hasKey
            ? 'Add your Anthropic API key in Settings, then configure your preferences and click Get Recommendations.'
            : !hasCollection
            ? 'Import your Arena collection first so Claude can see what cards you have available.'
            : 'Configure your preferences on the left and click Get Recommendations to see personalized deck suggestions.'}
        </p>
      </div>
    </div>
  )
}

function guessColors(archetype = '') {
  const a = archetype.toLowerCase()
  const map = { azorius: ['W', 'U'], dimir: ['U', 'B'], rakdos: ['B', 'R'], gruul: ['R', 'G'], selesnya: ['G', 'W'], orzhov: ['W', 'B'], izzet: ['U', 'R'], golgari: ['B', 'G'], boros: ['R', 'W'], simic: ['G', 'U'] }
  for (const [name, colors] of Object.entries(map)) {
    if (a.includes(name)) return colors
  }
  return []
}

function rarityBadge(r = '') {
  const map = { common: 'bg-gray-600/30 text-gray-400', uncommon: 'bg-blue-600/30 text-blue-400', rare: 'bg-yellow-600/30 text-yellow-400', mythic: 'bg-orange-600/30 text-orange-400' }
  return map[r.toLowerCase()] || 'bg-gray-600/30 text-gray-400'
}

function SparkIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  )
}

function SpinnerIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
