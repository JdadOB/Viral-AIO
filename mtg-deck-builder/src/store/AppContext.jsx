import { createContext, useContext, useReducer, useEffect } from 'react'

const AppContext = createContext(null)

const initialState = {
  apiKey: '',
  collection: null,
  arenaLogPath: null,
  decks: [],
  format: 'Standard',
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_API_KEY':
      return { ...state, apiKey: action.payload }
    case 'SET_COLLECTION':
      return { ...state, collection: action.payload }
    case 'SET_LOG_PATH':
      return { ...state, arenaLogPath: action.payload }
    case 'SET_DECKS':
      return { ...state, decks: action.payload }
    case 'ADD_DECK':
      return { ...state, decks: [...state.decks, action.payload] }
    case 'UPDATE_DECK':
      return {
        ...state,
        decks: state.decks.map(d => d.id === action.payload.id ? action.payload : d),
      }
    case 'DELETE_DECK':
      return { ...state, decks: state.decks.filter(d => d.id !== action.payload) }
    case 'SET_FORMAT':
      return { ...state, format: action.payload }
    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Load persisted state on mount
  useEffect(() => {
    async function load() {
      if (!window.mtg) return
      const apiKey = await window.mtg.store.get('apiKey')
      const collection = await window.mtg.store.get('collection')
      const arenaLogPath = await window.mtg.store.get('arenaLogPath')
      const decks = await window.mtg.store.get('decks')
      const format = await window.mtg.store.get('format')

      if (apiKey) dispatch({ type: 'SET_API_KEY', payload: apiKey })
      if (collection) dispatch({ type: 'SET_COLLECTION', payload: collection })
      if (arenaLogPath) dispatch({ type: 'SET_LOG_PATH', payload: arenaLogPath })
      if (decks) dispatch({ type: 'SET_DECKS', payload: decks })
      if (format) dispatch({ type: 'SET_FORMAT', payload: format })
    }
    load()
  }, [])

  // Persist decks whenever they change
  useEffect(() => {
    if (window.mtg && state.decks.length > 0) {
      window.mtg.store.set('decks', state.decks)
    }
  }, [state.decks])

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
