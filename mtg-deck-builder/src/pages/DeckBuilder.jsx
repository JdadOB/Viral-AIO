import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../store/AppContext'
import { searchCards, getAutoComplete } from '../api/scryfall'
import CardImage from '../components/CardImage'

const FORMATS = ['Standard', 'Explorer', 'Historic', 'Alchemy', 'Pioneer', 'Modern', 'Legacy', 'Vintage', 'Commander']

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function emptyDeck(format = 'Standard') {
  return {
    id: generateId(),
    name: 'New Deck',
    format,
    mainboard: [],
    sideboard: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export default function DeckBuilder() {
  const { deckId } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()

  const [deck, setDeck] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [searchResults, setSearchResults] = useState([])
  const [selectedCard, setSelectedCard] = useState(null)
  const [searching, setSearching] = useState(false)
  const [activeList, setActiveList] = useState('mainboard')
  const [deckName, setDeckName] = useState('')
  const [editingName, setEditingName] = useState(false)
  const suggestTimeout = useRef(null)
  const nameRef = useRef(null)

  useEffect(() => {
    if (deckId) {
      const found = state.decks.find(d => d.id === deckId)
      if (found) {
        setDeck(found)
        setDeckName(found.name)
      }
    } else {
      const fresh = emptyDeck(state.format)
      setDeck(fresh)
      setDeckName(fresh.name)
    }
  }, [deckId])

  const updateDeck = (updated) => {
    const withTs = { ...updated, updatedAt: new Date().toISOString() }
    setDeck(withTs)
    const exists = state.decks.find(d => d.id === withTs.id)
    if (exists) {
      dispatch({ type: 'UPDATE_DECK', payload: withTs })
    } else {
      dispatch({ type: 'ADD_DECK', payload: withTs })
      navigate(`/deck-builder/${withTs.id}`, { replace: true })
    }
  }

  const handleSearchChange = async (value) => {
    setSearchQuery(value)
    clearTimeout(suggestTimeout.current)

    if (value.length < 2) {
      setSuggestions([])
      return
    }

    suggestTimeout.current = setTimeout(async () => {
      const results = await getAutoComplete(value)
      setSuggestions(results.slice(0, 8))
    }, 200)
  }

  const handleSearch = async (query) => {
    const q = query || searchQuery
    if (!q.trim()) return
    setSearching(true)
    setSuggestions([])
    try {
      const data = await searchCards(q)
      setSearchResults(data.data || [])
    } catch (err) {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const addCard = (card, list = activeList) => {
    if (!deck) return
    const existing = deck[list].find(c => c.id === card.id)
    let updated
    if (existing) {
      updated = {
        ...deck,
        [list]: deck[list].map(c =>
          c.id === card.id ? { ...c, quantity: Math.min(c.quantity + 1, list === 'mainboard' && !card.type_line?.includes('Basic') ? 4 : 99) } : c
        ),
      }
    } else {
      const entry = {
        id: card.id,
        name: card.name,
        quantity: 1,
        type_line: card.type_line,
        cmc: card.cmc,
        colors: card.colors,
        mana_cost: card.mana_cost,
        rarity: card.rarity,
        image_uris: card.image_uris,
        card_faces: card.card_faces,
        set: card.set,
      }
      updated = { ...deck, [list]: [...deck[list], entry] }
    }
    updateDeck(updated)
  }

  const removeCard = (cardId, list = 'mainboard') => {
    if (!deck) return
    const existing = deck[list].find(c => c.id === cardId)
    if (!existing) return
    const updated = existing.quantity > 1
      ? { ...deck, [list]: deck[list].map(c => c.id === cardId ? { ...c, quantity: c.quantity - 1 } : c) }
      : { ...deck, [list]: deck[list].filter(c => c.id !== cardId) }
    updateDeck(updated)
  }

  const saveName = () => {
    if (!deck || !deckName.trim()) return
    setEditingName(false)
    updateDeck({ ...deck, name: deckName })
  }

  const totalMain = deck?.mainboard.reduce((s, c) => s + c.quantity, 0) || 0
  const totalSide = deck?.sideboard.reduce((s, c) => s + c.quantity, 0) || 0

  const groupedDeck = groupByType(deck?.mainboard || [])

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Card Search */}
      <div className="w-80 flex-shrink-0 border-r border-mtg-border flex flex-col">
        <div className="p-4 border-b border-mtg-border">
          <h2 className="font-semibold mb-3">Card Search</h2>
          <div className="relative">
            <input
              type="text"
              placeholder="Search cards..."
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="input pr-10"
            />
            <button onClick={() => handleSearch()} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-mtg-gold">
              <SearchIcon />
            </button>

            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-mtg-panel border border-mtg-border rounded-lg mt-1 z-10 shadow-xl">
                {suggestions.map(name => (
                  <button
                    key={name}
                    onClick={() => { setSearchQuery(name); setSuggestions([]); handleSearch(name) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-mtg-dark transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {searching && (
            <div className="text-center py-8 text-gray-400 text-sm">Searching...</div>
          )}
          {!searching && searchResults.map(card => (
            <div
              key={card.id}
              className="group flex items-center gap-2 p-2 rounded-lg hover:bg-mtg-panel cursor-pointer transition-colors"
              onClick={() => setSelectedCard(card)}
            >
              <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden">
                <CardImage card={card} className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{card.name}</p>
                <p className="text-xs text-gray-400 truncate">{card.type_line}</p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); addCard(card, 'mainboard') }}
                className="opacity-0 group-hover:opacity-100 w-6 h-6 bg-mtg-gold text-mtg-black rounded flex items-center justify-center font-bold text-sm transition-opacity"
              >
                +
              </button>
            </div>
          ))}
          {!searching && searchResults.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">
              <p>Search for cards to add to your deck</p>
            </div>
          )}
        </div>
      </div>

      {/* Center: Deck List */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Deck header */}
        <div className="flex-shrink-0 border-b border-mtg-border p-4 flex items-center gap-4">
          {editingName ? (
            <input
              ref={nameRef}
              value={deckName}
              onChange={e => setDeckName(e.target.value)}
              onBlur={saveName}
              onKeyDown={e => e.key === 'Enter' && saveName()}
              className="input text-lg font-semibold w-64"
              autoFocus
            />
          ) : (
            <h1
              className="text-lg font-semibold cursor-pointer hover:text-mtg-gold transition-colors"
              onClick={() => setEditingName(true)}
            >
              {deck?.name || 'New Deck'}
            </h1>
          )}

          <select
            value={deck?.format || 'Standard'}
            onChange={e => deck && updateDeck({ ...deck, format: e.target.value })}
            className="input w-36 text-sm"
          >
            {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveList('mainboard')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeList === 'mainboard' ? 'bg-mtg-gold text-mtg-black' : 'text-gray-400 hover:text-mtg-white'}`}
              >
                Main ({totalMain})
              </button>
              <button
                onClick={() => setActiveList('sideboard')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${activeList === 'sideboard' ? 'bg-mtg-gold text-mtg-black' : 'text-gray-400 hover:text-mtg-white'}`}
              >
                Side ({totalSide})
              </button>
            </div>
          </div>
        </div>

        {/* Card groups */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeList === 'mainboard' ? (
            Object.entries(groupedDeck).map(([type, cards]) => (
              <div key={type} className="mb-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {type} ({cards.reduce((s, c) => s + c.quantity, 0)})
                </h3>
                {cards.map(card => (
                  <DeckEntry key={card.id} card={card} onAdd={() => addCard(card)} onRemove={() => removeCard(card.id)} onHover={setSelectedCard} />
                ))}
              </div>
            ))
          ) : (
            <div>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Sideboard ({totalSide})
              </h3>
              {deck?.sideboard.map(card => (
                <DeckEntry key={card.id} card={card} onAdd={() => addCard(card, 'sideboard')} onRemove={() => removeCard(card.id, 'sideboard')} onHover={setSelectedCard} />
              ))}
            </div>
          )}

          {totalMain === 0 && activeList === 'mainboard' && (
            <div className="text-center py-16 text-gray-500">
              <p className="text-sm">Your deck is empty</p>
              <p className="text-xs mt-1">Search for cards and click + to add them</p>
            </div>
          )}
        </div>

        {/* Mana curve */}
        {deck && <ManaCurve cards={deck.mainboard} />}
      </div>

      {/* Right: Card Preview */}
      <div className="w-56 flex-shrink-0 border-l border-mtg-border p-4 flex flex-col gap-4">
        {selectedCard ? (
          <>
            <CardImage card={selectedCard} className="w-full aspect-[2.5/3.5]" />
            <div>
              <p className="font-semibold text-sm">{selectedCard.name}</p>
              <p className="text-xs text-gray-400 mt-1">{selectedCard.type_line}</p>
              {selectedCard.oracle_text && (
                <p className="text-xs text-gray-300 mt-2 leading-relaxed">{selectedCard.oracle_text}</p>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => addCard(selectedCard, 'mainboard')} className="btn-primary text-xs flex-1">
                  + Main
                </button>
                <button onClick={() => addCard(selectedCard, 'sideboard')} className="btn-secondary text-xs flex-1">
                  + Side
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center text-gray-500 text-sm py-8">
            <p>Hover a card to preview</p>
          </div>
        )}
      </div>
    </div>
  )
}

function DeckEntry({ card, onAdd, onRemove, onHover }) {
  return (
    <div
      className="group flex items-center gap-2 py-1 px-2 rounded hover:bg-mtg-panel transition-colors"
      onMouseEnter={() => onHover(card)}
    >
      <span className="text-sm text-mtg-gold font-medium w-5 text-center">{card.quantity}</span>
      <span className="flex-1 text-sm">{card.name}</span>
      <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
        <button onClick={onRemove} className="w-5 h-5 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/40">−</button>
        <button onClick={onAdd} className="w-5 h-5 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/40">+</button>
      </div>
    </div>
  )
}

function ManaCurve({ cards }) {
  const curve = {}
  cards.forEach(card => {
    const cmc = Math.min(card.cmc || 0, 7)
    curve[cmc] = (curve[cmc] || 0) + card.quantity
  })

  const max = Math.max(...Object.values(curve), 1)

  return (
    <div className="flex-shrink-0 border-t border-mtg-border p-4">
      <p className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wider">Mana Curve</p>
      <div className="flex items-end gap-1 h-12">
        {[0, 1, 2, 3, 4, 5, 6, 7].map(cmc => (
          <div key={cmc} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-mtg-gold/60 rounded-t transition-all"
              style={{ height: `${((curve[cmc] || 0) / max) * 40}px` }}
            />
            <span className="text-xs text-gray-500">{cmc === 7 ? '7+' : cmc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function groupByType(cards) {
  const order = ['Creature', 'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact', 'Land']
  const groups = {}

  cards.forEach(card => {
    const type = order.find(t => card.type_line?.includes(t)) || 'Other'
    if (!groups[type]) groups[type] = []
    groups[type].push(card)
  })

  const sorted = {}
  order.forEach(t => { if (groups[t]) sorted[t] = groups[t].sort((a, b) => (a.cmc || 0) - (b.cmc || 0)) })
  if (groups['Other']) sorted['Other'] = groups['Other']
  return sorted
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}
