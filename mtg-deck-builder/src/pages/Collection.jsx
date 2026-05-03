import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../store/AppContext'
import { resolveCollection } from '../api/scryfall'
import CardImage from '../components/CardImage'

const COLORS = ['W', 'U', 'B', 'R', 'G', 'C']
const TYPES = ['Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Planeswalker', 'Land']

export default function Collection() {
  const { state, dispatch } = useApp()
  const [resolvedCards, setResolvedCards] = useState([])
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filterColor, setFilterColor] = useState('')
  const [filterType, setFilterType] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [viewMode, setViewMode] = useState('grid')
  const [progress, setProgress] = useState(0)

  const handleAutoDetect = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.mtg.arena.detectLog()
      if (result.found) {
        await importLog(result.path)
      } else {
        setError('Arena log not found automatically. Please browse for it manually.')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleBrowse = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.mtg.arena.browseLog()
      if (!result.canceled) {
        await importLog(result.path)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const importLog = async (logPath) => {
    const result = await window.mtg.arena.parseLog(logPath)
    if (!result.success) {
      setError(`Failed to parse log: ${result.error}`)
      return
    }
    dispatch({ type: 'SET_COLLECTION', payload: result.collection })
    dispatch({ type: 'SET_LOG_PATH', payload: logPath })
    await window.mtg.store.set('collection', result.collection)
    await window.mtg.store.set('arenaLogPath', logPath)
  }

  const resolveCards = useCallback(async () => {
    if (!state.collection?.cards) return
    const cardMap = state.collection.cards
    const ids = Object.keys(cardMap)
    if (!ids.length) return

    setResolving(true)
    setProgress(0)

    try {
      const batchSize = 75
      const allResolved = {}

      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize)
        const batchMap = {}
        batch.forEach(id => { batchMap[id] = cardMap[id] })

        const resolved = await resolveCollection(batchMap)
        Object.assign(allResolved, resolved)
        setProgress(Math.round(((i + batchSize) / ids.length) * 100))
      }

      setResolvedCards(Object.values(allResolved))
    } catch (err) {
      setError('Failed to resolve card data from Scryfall: ' + err.message)
    } finally {
      setResolving(false)
    }
  }, [state.collection])

  useEffect(() => {
    if (state.collection && resolvedCards.length === 0) {
      resolveCards()
    }
  }, [state.collection])

  const filtered = resolvedCards.filter(card => {
    if (search && !card.name.toLowerCase().includes(search.toLowerCase())) return false
    if (filterColor && !card.colors?.includes(filterColor)) return false
    if (filterType && !card.type_line?.includes(filterType)) return false
    return true
  }).sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'count') return (b.count || 0) - (a.count || 0)
    if (sortBy === 'cmc') return (a.cmc || 0) - (b.cmc || 0)
    return 0
  })

  if (!state.collection) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-mtg-gold/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-mtg-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-mtg-white mb-2">Connect Your Arena Collection</h2>
          <p className="text-gray-400 text-sm mb-2">
            Import your card collection from MTG Arena's log file. This lets the app know which cards you own.
          </p>
          <p className="text-gray-500 text-xs mb-6">
            Log location: <code className="text-mtg-gold">%APPDATA%\LocalLow\Wizards Of The Coast\MTGA\Player.log</code>
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-center">
            <button onClick={handleAutoDetect} disabled={loading} className="btn-primary">
              {loading ? 'Detecting...' : 'Auto-Detect Log'}
            </button>
            <button onClick={handleBrowse} disabled={loading} className="btn-secondary">
              Browse for Log
            </button>
          </div>
        </div>
      </div>
    )
  }

  const totalCards = Object.values(state.collection.cards || {}).reduce((a, b) => a + b, 0)
  const uniqueCards = Object.keys(state.collection.cards || {}).length
  const wc = state.collection.wildcards || {}

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-mtg-border p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">My Collection</h1>
            <p className="text-sm text-gray-400">
              {uniqueCards.toLocaleString()} unique cards · {totalCards.toLocaleString()} total
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Wildcards */}
            <div className="flex gap-2">
              {[
                { label: 'C', color: 'bg-gray-400', count: wc.common },
                { label: 'U', color: 'bg-blue-400', count: wc.uncommon },
                { label: 'R', color: 'bg-yellow-400', count: wc.rare },
                { label: 'M', color: 'bg-orange-400', count: wc.mythic },
              ].map(({ label, color, count }) => count > 0 && (
                <div key={label} className="panel px-2 py-1 flex items-center gap-1">
                  <div className={`w-3 h-3 rounded-full ${color}`} />
                  <span className="text-xs text-gray-300">{count}</span>
                </div>
              ))}
            </div>
            <button onClick={handleBrowse} className="btn-secondary text-sm">
              Re-import
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search cards..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input w-48"
          />
          <select value={filterColor} onChange={e => setFilterColor(e.target.value)} className="input w-28">
            <option value="">All Colors</option>
            {COLORS.map(c => <option key={c} value={c}>{colorName(c)}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="input w-36">
            <option value="">All Types</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="input w-32">
            <option value="name">Sort: Name</option>
            <option value="count">Sort: Count</option>
            <option value="cmc">Sort: Mana</option>
          </select>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded ${viewMode === 'grid' ? 'bg-mtg-gold/20 text-mtg-gold' : 'text-gray-400 hover:text-mtg-white'}`}
            >
              <GridIcon />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded ${viewMode === 'list' ? 'bg-mtg-gold/20 text-mtg-gold' : 'text-gray-400 hover:text-mtg-white'}`}
            >
              <ListIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {resolving && (
          <div className="text-center py-12">
            <div className="w-48 h-2 bg-mtg-panel rounded-full mx-auto mb-3">
              <div className="h-2 bg-mtg-gold rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-gray-400 text-sm">Loading card data... {progress}%</p>
          </div>
        )}

        {!resolving && resolvedCards.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">Collection imported. Loading card details from Scryfall...</p>
          </div>
        )}

        {!resolving && viewMode === 'grid' && (
          <div className="grid grid-cols-6 xl:grid-cols-8 gap-3">
            {filtered.map(card => (
              <div key={card.id} className="group relative card-hover cursor-pointer">
                <CardImage card={card} className="w-full aspect-[2.5/3.5]" />
                <div className="absolute top-1 right-1 bg-mtg-dark/80 rounded px-1.5 py-0.5 text-xs font-bold text-mtg-gold">
                  ×{card.count}
                </div>
              </div>
            ))}
          </div>
        )}

        {!resolving && viewMode === 'list' && (
          <div className="space-y-1">
            {filtered.map(card => (
              <div key={card.id} className="panel px-4 py-2.5 flex items-center gap-4 hover:border-mtg-gold/30 transition-colors">
                <span className="text-xs text-mtg-gold font-bold w-6 text-center">×{card.count}</span>
                <span className="font-medium text-sm flex-1">{card.name}</span>
                <span className="text-xs text-gray-400 w-40">{card.type_line}</span>
                <div className="flex gap-1">
                  {(card.colors || []).map(c => (
                    <div key={c} className={`mana-${c}`}>{c}</div>
                  ))}
                </div>
                <span className="text-xs text-gray-500 w-12">{card.set?.toUpperCase()}</span>
                <span className={`badge ${rarityBadge(card.rarity)}`}>{card.rarity}</span>
              </div>
            ))}
          </div>
        )}

        {!resolving && filtered.length === 0 && resolvedCards.length > 0 && (
          <p className="text-center text-gray-500 py-12">No cards match your filters</p>
        )}
      </div>
    </div>
  )
}

function colorName(c) {
  return { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' }[c] || c
}

function rarityBadge(r) {
  return { common: 'badge bg-gray-600/30 text-gray-400', uncommon: 'badge bg-blue-600/30 text-blue-400', rare: 'badge bg-yellow-600/30 text-yellow-400', mythic: 'badge bg-orange-600/30 text-orange-400' }[r] || 'badge'
}

function GridIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}
