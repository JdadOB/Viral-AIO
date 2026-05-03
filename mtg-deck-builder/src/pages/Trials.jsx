import { useState } from 'react'
import { useApp } from '../store/AppContext'
import { getMatchupData, detectArchetype } from '../api/metagame'

const FORMATS = ['Standard', 'Explorer', 'Historic', 'Pioneer']

function parseDeckText(text) {
  const lines = text.trim().split('\n')
  const mainboard = []
  const sideboard = []
  let inSideboard = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.toLowerCase() === 'sideboard' || line.toLowerCase() === 'side') {
      inSideboard = true
      continue
    }

    const match = line.match(/^(\d+)\s+(.+)$/)
    if (match) {
      const entry = { quantity: parseInt(match[1]), name: match[2].trim() }
      if (inSideboard) sideboard.push(entry)
      else mainboard.push(entry)
    }
  }

  return { mainboard, sideboard }
}

export default function Trials() {
  const { state } = useApp()
  const [format, setFormat] = useState('Standard')
  const [deckText, setDeckText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState(null)
  const [expandedMatchup, setExpandedMatchup] = useState(null)
  const [phase, setPhase] = useState('')

  const canRun = state.apiKey && deckText.trim()

  const handleRun = async () => {
    setLoading(true)
    setError(null)
    setResults(null)
    setExpandedMatchup(null)

    try {
      setPhase('Parsing deck...')
      const deck = parseDeckText(deckText)
      if (deck.mainboard.length === 0) throw new Error('Could not parse deck. Use format: "4 Card Name" per line.')

      setPhase('Detecting archetype...')
      const archetype = await detectArchetype(deck)

      setPhase('Fetching meta matchup data...')
      const matchups = await getMatchupData(archetype, format.toLowerCase())

      setPhase('Running AI analysis with Claude...')
      const result = await window.mtg.claude.trials({
        apiKey: state.apiKey,
        deck: { ...deck, archetype },
        matchups,
        format,
      })

      if (!result.success) throw new Error(result.error)
      setResults(result.result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setPhase('')
    }
  }

  const favorabilityBadge = (f = '') => {
    const map = {
      'Favored': 'badge-favored',
      'Even': 'badge-even',
      'Unfavored': 'badge-unfavored',
      'Highly Unfavored': 'bg-red-900/30 text-red-300',
    }
    return map[f] || 'badge-even'
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Input panel */}
      <div className="w-72 flex-shrink-0 border-r border-mtg-border flex flex-col">
        <div className="p-5 border-b border-mtg-border">
          <div className="flex items-center gap-2 mb-1">
            <TrialIcon className="w-5 h-5 text-mtg-gold" />
            <h2 className="font-semibold">Deck Trials</h2>
          </div>
          <p className="text-xs text-gray-400">Statistical matchup data combined with Claude's strategic analysis</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!state.apiKey && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-xs">
              Add your Anthropic API key in Settings to use AI features.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Format</label>
            <select value={format} onChange={e => setFormat(e.target.value)} className="input">
              {FORMATS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
              Paste Deck List
            </label>
            <textarea
              value={deckText}
              onChange={e => setDeckText(e.target.value)}
              placeholder={`4 Lightning Bolt\n4 Monastery Swiftspear\n20 Mountain\n...\n\nSideboard\n3 Relic of Progenitus`}
              className="input h-64 resize-none text-sm font-mono"
              spellCheck={false}
            />
            <p className="text-xs text-gray-500 mt-1">Format: "4 Card Name" per line</p>
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
                {phase || 'Analyzing...'}
              </>
            ) : (
              <>
                <TrialIcon className="w-4 h-4" />
                Run Trials
              </>
            )}
          </button>
          {loading && (
            <p className="text-xs text-gray-500 text-center mt-2">{phase}</p>
          )}
        </div>
      </div>

      {/* Right: Results */}
      <div className="flex-1 overflow-y-auto p-6">
        {!results && !loading && !error && (
          <EmptyState hasKey={!!state.apiKey} />
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
              <p className="text-gray-400">{phase}</p>
              <p className="text-gray-500 text-sm mt-1">This may take 20-40 seconds</p>
            </div>
          </div>
        )}

        {results && (
          <div className="space-y-6">
            {/* Summary header */}
            <div className="panel p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-semibold">{results.deckArchetype}</h2>
                    <div className="flex items-center gap-1">
                      <span className="text-2xl font-bold text-mtg-gold">{results.overallMetaScore?.toFixed(1)}</span>
                      <span className="text-gray-400 text-sm">/10</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300">{results.metaSummary}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                {results.strengths?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-2">Strengths</h4>
                    <ul className="space-y-1">
                      {results.strengths.map((s, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-1.5">
                          <span className="text-green-400 mt-0.5">✓</span> {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {results.weaknesses?.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Weaknesses</h4>
                    <ul className="space-y-1">
                      {results.weaknesses.map((w, i) => (
                        <li key={i} className="text-sm text-gray-300 flex items-start gap-1.5">
                          <span className="text-red-400 mt-0.5">✗</span> {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Matchup overview */}
            <div>
              <h3 className="font-semibold mb-3">Matchup Breakdown</h3>
              <div className="space-y-2">
                {(results.matchups || []).map((m, i) => (
                  <MatchupCard
                    key={i}
                    matchup={m}
                    expanded={expandedMatchup === i}
                    onToggle={() => setExpandedMatchup(expandedMatchup === i ? null : i)}
                    favorabilityBadge={favorabilityBadge}
                  />
                ))}
              </div>
            </div>

            {/* General sideboard advice */}
            {results.generalSideboardAdvice && (
              <div className="panel p-4">
                <h4 className="text-sm font-semibold text-mtg-gold mb-2">General Sideboard Advice</h4>
                <p className="text-sm text-gray-300">{results.generalSideboardAdvice}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MatchupCard({ matchup, expanded, onToggle, favorabilityBadge }) {
  const winRate = matchup.winRate || 50
  const barColor = winRate >= 55 ? 'bg-green-500' : winRate >= 48 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="panel overflow-hidden">
      <div
        className="p-4 cursor-pointer hover:bg-mtg-dark/30 transition-colors flex items-center gap-4"
        onClick={onToggle}
      >
        <div className="w-48 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium text-sm">{matchup.opponent}</span>
            <span className={`badge ${favorabilityBadge(matchup.favorability)}`}>{matchup.favorability}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-mtg-dark rounded-full overflow-hidden">
              <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${winRate}%` }} />
            </div>
            <span className="text-sm font-bold text-mtg-white">{winRate.toFixed(1)}%</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{matchup.sampleSize?.toLocaleString()} games</p>
        </div>

        <p className="flex-1 text-sm text-gray-400">{matchup.summary}</p>

        <ChevronIcon className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {expanded && (
        <div className="border-t border-mtg-border p-4 bg-mtg-dark/20 grid grid-cols-2 gap-5">
          <div className="space-y-4">
            <div>
              <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Our Game Plan</h5>
              <p className="text-sm text-gray-300">{matchup.ourGamePlan}</p>
            </div>
            <div>
              <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Their Game Plan</h5>
              <p className="text-sm text-gray-300">{matchup.theirGamePlan}</p>
            </div>
            <div>
              <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Pre-Board Lines</h5>
              <p className="text-sm text-gray-300">{matchup.preBoardLines}</p>
            </div>
            <div>
              <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Post-Board Lines</h5>
              <p className="text-sm text-gray-300">{matchup.postBoardLines}</p>
            </div>
          </div>

          <div className="space-y-4">
            {matchup.keyCardsOurs?.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-green-400 uppercase tracking-wider mb-1">Our Key Cards</h5>
                <div className="flex flex-wrap gap-1">
                  {matchup.keyCardsOurs.map(c => <span key={c} className="badge bg-green-500/10 text-green-400 border border-green-500/20">{c}</span>)}
                </div>
              </div>
            )}
            {matchup.keyCardsTheirs?.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">Their Threats</h5>
                <div className="flex flex-wrap gap-1">
                  {matchup.keyCardsTheirs.map(c => <span key={c} className="badge bg-red-500/10 text-red-400 border border-red-500/20">{c}</span>)}
                </div>
              </div>
            )}
            {matchup.sideboardIn?.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">Bring In</h5>
                <div className="flex flex-wrap gap-1">
                  {matchup.sideboardIn.map(c => <span key={c} className="badge bg-blue-500/10 text-blue-400 border border-blue-500/20">{c}</span>)}
                </div>
              </div>
            )}
            {matchup.sideboardOut?.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Cut</h5>
                <div className="flex flex-wrap gap-1">
                  {matchup.sideboardOut.map(c => <span key={c} className="badge bg-gray-600/20 text-gray-400 border border-gray-600/30 line-through">{c}</span>)}
                </div>
              </div>
            )}
            {matchup.tips?.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold text-mtg-gold uppercase tracking-wider mb-1">Tips</h5>
                <ul className="space-y-1">
                  {matchup.tips.map((t, i) => (
                    <li key={i} className="text-sm text-gray-300 flex gap-1.5">
                      <span className="text-mtg-gold">•</span> {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ hasKey }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-sm">
        <TrialIcon className="w-16 h-16 text-mtg-gold/30 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-300 mb-2">Deck Trials</h3>
        <p className="text-gray-500 text-sm">
          {!hasKey
            ? 'Add your Anthropic API key in Settings, then paste your deck list and run trials.'
            : 'Paste your deck list on the left and click Run Trials. You\'ll get real matchup win rates from the meta combined with Claude\'s strategic breakdown.'}
        </p>
        <div className="mt-4 panel p-3 text-left text-xs text-gray-400">
          <p className="font-medium text-gray-300 mb-1">How it works:</p>
          <p>① Statistical data pulled from the metagame</p>
          <p>② Claude analyzes each matchup strategically</p>
          <p>③ Get win rates + per-matchup game plans</p>
        </div>
      </div>
    </div>
  )
}

function TrialIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
