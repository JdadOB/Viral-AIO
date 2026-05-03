import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/AppContext'

export default function Dashboard() {
  const { state } = useApp()
  const navigate = useNavigate()

  const totalCards = Object.values(state.collection?.cards || {}).reduce((a, b) => a + b, 0)
  const uniqueCards = Object.keys(state.collection?.cards || {}).length
  const wc = state.collection?.wildcards || {}
  const recentDecks = (state.decks || []).slice(-4).reverse()

  const quickActions = [
    { label: 'Build a Deck', desc: 'Create a new deck with card search', path: '/deck-builder', icon: DeckIcon },
    { label: 'Get AI Recommendations', desc: 'Let Claude suggest decks from your collection', path: '/recommendations', icon: SparkIcon },
    { label: 'Run Deck Trials', desc: 'Test your deck against the meta', path: '/trials', icon: TrialIcon },
  ]

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Welcome */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">MTG Deck Builder</h1>
        <p className="text-gray-400 mt-1">AI-powered deck building for MTG Arena</p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Unique Cards"
          value={uniqueCards > 0 ? uniqueCards.toLocaleString() : '—'}
          sub={uniqueCards > 0 ? `${totalCards.toLocaleString()} total copies` : 'Import collection'}
          color="text-mtg-gold"
          onClick={() => navigate('/collection')}
        />
        <StatCard
          label="Decks Built"
          value={state.decks.length || '—'}
          sub={state.decks.length > 0 ? 'View in Deck Builder' : 'Create your first deck'}
          color="text-blue-400"
          onClick={() => navigate('/deck-builder')}
        />
        <StatCard
          label="API Status"
          value={state.apiKey ? 'Connected' : 'Not set'}
          sub={state.apiKey ? 'Claude is ready' : 'Add key in Settings'}
          color={state.apiKey ? 'text-green-400' : 'text-red-400'}
          onClick={() => navigate('/settings')}
        />
        <StatCard
          label="Wildcards"
          value={wc.rare !== undefined ? wc.rare : '—'}
          sub={wc.rare !== undefined ? `${wc.mythic || 0} mythic available` : 'Import collection first'}
          color="text-yellow-400"
          onClick={() => navigate('/collection')}
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div>
          <h2 className="font-semibold mb-3">Quick Actions</h2>
          <div className="space-y-2">
            {quickActions.map(({ label, desc, path, icon: Icon }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="panel w-full p-4 text-left hover:border-mtg-gold/40 transition-colors flex items-center gap-4"
              >
                <div className="w-10 h-10 bg-mtg-gold/10 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-mtg-gold" />
                </div>
                <div>
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                </div>
                <ChevronIcon className="w-4 h-4 text-gray-500 ml-auto" />
              </button>
            ))}
          </div>
        </div>

        {/* Recent Decks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Recent Decks</h2>
            {state.decks.length > 0 && (
              <button onClick={() => navigate('/deck-builder')} className="text-xs text-mtg-gold hover:underline">
                View all
              </button>
            )}
          </div>

          {recentDecks.length > 0 ? (
            <div className="space-y-2">
              {recentDecks.map(deck => (
                <button
                  key={deck.id}
                  onClick={() => navigate(`/deck-builder/${deck.id}`)}
                  className="panel w-full p-3.5 text-left hover:border-mtg-gold/40 transition-colors flex items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{deck.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {deck.format} · {deck.mainboard?.reduce((s, c) => s + c.quantity, 0) || 0} cards
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(deck.updatedAt).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <div className="panel p-8 text-center">
              <p className="text-gray-500 text-sm">No decks yet</p>
              <button onClick={() => navigate('/deck-builder')} className="text-mtg-gold text-sm mt-1 hover:underline">
                Build your first deck →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Setup checklist */}
      {(!state.apiKey || !state.collection) && (
        <div className="mt-6 panel p-5">
          <h3 className="font-semibold mb-3">Getting Started</h3>
          <div className="space-y-2">
            <SetupStep
              done={!!state.collection}
              label="Import your MTG Arena collection"
              action="Import Collection"
              onClick={() => navigate('/collection')}
            />
            <SetupStep
              done={!!state.apiKey}
              label="Add your Anthropic API key for AI features"
              action="Open Settings"
              onClick={() => navigate('/settings')}
            />
            <SetupStep
              done={state.decks.length > 0}
              label="Build or import your first deck"
              action="Deck Builder"
              onClick={() => navigate('/deck-builder')}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, color, onClick }) {
  return (
    <button onClick={onClick} className="panel p-4 text-left hover:border-mtg-gold/40 transition-colors w-full">
      <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
    </button>
  )
}

function SetupStep({ done, label, action, onClick }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500' : 'border-2 border-mtg-border'}`}>
        {done && <span className="text-white text-xs">✓</span>}
      </div>
      <span className={`text-sm flex-1 ${done ? 'text-gray-500 line-through' : 'text-gray-300'}`}>{label}</span>
      {!done && (
        <button onClick={onClick} className="text-xs text-mtg-gold hover:underline">{action}</button>
      )}
    </div>
  )
}

function DeckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function SparkIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  )
}

function TrialIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  )
}

function ChevronIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}
