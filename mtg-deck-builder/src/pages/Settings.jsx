import { useState, useEffect } from 'react'
import { useApp } from '../store/AppContext'

export default function Settings() {
  const { state, dispatch } = useApp()
  const [apiKey, setApiKey] = useState(state.apiKey || '')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [format, setFormat] = useState(state.format || 'Standard')

  useEffect(() => {
    setApiKey(state.apiKey || '')
    setFormat(state.format || 'Standard')
  }, [state.apiKey, state.format])

  const saveApiKey = async () => {
    dispatch({ type: 'SET_API_KEY', payload: apiKey })
    await window.mtg.store.set('apiKey', apiKey)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const saveFormat = async (f) => {
    setFormat(f)
    dispatch({ type: 'SET_FORMAT', payload: f })
    await window.mtg.store.set('format', f)
  }

  const clearCollection = async () => {
    if (!confirm('Clear your imported collection? You can re-import it at any time.')) return
    dispatch({ type: 'SET_COLLECTION', payload: null })
    dispatch({ type: 'SET_LOG_PATH', payload: null })
    await window.mtg.store.delete('collection')
    await window.mtg.store.delete('arenaLogPath')
  }

  const clearDecks = async () => {
    if (!confirm('Delete all saved decks? This cannot be undone.')) return
    dispatch({ type: 'SET_DECKS', payload: [] })
    await window.mtg.store.delete('decks')
  }

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl">
      <h1 className="text-lg font-semibold mb-6">Settings</h1>

      {/* API Key */}
      <section className="panel p-5 mb-4">
        <h2 className="font-semibold mb-1">Anthropic API Key</h2>
        <p className="text-sm text-gray-400 mb-4">
          Required for AI features (Deck Recommendations and Deck Trials). Your key is stored locally and never sent anywhere except directly to Anthropic's API.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="input pr-10"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-mtg-white"
            >
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <button onClick={saveApiKey} className="btn-primary px-5">
            {saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
        {state.apiKey && (
          <p className="text-xs text-green-400 mt-2">✓ API key is set</p>
        )}
        <p className="text-xs text-gray-500 mt-2">
          Get your key at console.anthropic.com
        </p>
      </section>

      {/* Default Format */}
      <section className="panel p-5 mb-4">
        <h2 className="font-semibold mb-1">Default Format</h2>
        <p className="text-sm text-gray-400 mb-4">Used as the default when creating new decks and getting recommendations.</p>
        <div className="flex flex-wrap gap-2">
          {['Standard', 'Explorer', 'Historic', 'Alchemy', 'Pioneer', 'Modern'].map(f => (
            <button
              key={f}
              onClick={() => saveFormat(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${format === f ? 'bg-mtg-gold text-mtg-black' : 'bg-mtg-dark border border-mtg-border text-gray-400 hover:text-mtg-white'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </section>

      {/* Collection */}
      <section className="panel p-5 mb-4">
        <h2 className="font-semibold mb-1">Arena Collection</h2>
        {state.collection ? (
          <>
            <p className="text-sm text-gray-400 mb-1">
              {Object.keys(state.collection.cards || {}).length.toLocaleString()} unique cards imported
            </p>
            {state.arenaLogPath && (
              <p className="text-xs text-gray-500 mb-4 font-mono truncate">{state.arenaLogPath}</p>
            )}
            <p className="text-xs text-gray-500 mb-4">
              Imported: {state.collection.importedAt ? new Date(state.collection.importedAt).toLocaleString() : 'Unknown'}
            </p>
            <button onClick={clearCollection} className="btn-secondary text-sm text-red-400 border-red-500/30 hover:border-red-500/60">
              Clear Collection
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-400">No collection imported. Go to the Collection page to import from Arena.</p>
        )}
      </section>

      {/* Data */}
      <section className="panel p-5">
        <h2 className="font-semibold mb-1">Saved Data</h2>
        <p className="text-sm text-gray-400 mb-4">
          {state.decks.length} deck{state.decks.length !== 1 ? 's' : ''} saved locally.
        </p>
        <button
          onClick={clearDecks}
          disabled={state.decks.length === 0}
          className="btn-secondary text-sm text-red-400 border-red-500/30 hover:border-red-500/60 disabled:opacity-40"
        >
          Delete All Decks
        </button>
      </section>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}
