import { NavLink } from 'react-router-dom'
import { useApp } from '../store/AppContext'

const navItems = [
  { to: '/', label: 'Dashboard', icon: HomeIcon },
  { to: '/collection', label: 'Collection', icon: CollectionIcon },
  { to: '/deck-builder', label: 'Deck Builder', icon: DeckIcon },
  { to: '/recommendations', label: 'AI Recommendations', icon: SparkIcon },
  { to: '/trials', label: 'Deck Trials', icon: TrialIcon },
]

export default function Sidebar() {
  const { state } = useApp()
  const collectionCount = state.collection
    ? Object.keys(state.collection.cards || {}).length
    : 0

  return (
    <aside className="w-56 flex-shrink-0 bg-mtg-dark border-r border-mtg-border flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-mtg-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-mtg-gold rounded-lg flex items-center justify-center">
            <span className="text-mtg-black font-bold text-sm">MTG</span>
          </div>
          <div>
            <p className="font-semibold text-sm text-mtg-white">Deck Builder</p>
            <p className="text-xs text-gray-400">AI-Powered</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-mtg-gold/10 text-mtg-gold border border-mtg-gold/30'
                  : 'text-gray-400 hover:text-mtg-white hover:bg-mtg-panel'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Collection status */}
      <div className="p-3 border-t border-mtg-border">
        {collectionCount > 0 ? (
          <div className="panel p-3 text-center">
            <p className="text-mtg-gold font-semibold text-sm">{collectionCount.toLocaleString()}</p>
            <p className="text-gray-400 text-xs">unique cards</p>
          </div>
        ) : (
          <NavLink
            to="/collection"
            className="panel p-3 text-center block hover:border-mtg-gold transition-colors"
          >
            <p className="text-xs text-gray-400">No collection</p>
            <p className="text-xs text-mtg-gold mt-0.5">Import from Arena →</p>
          </NavLink>
        )}

        <NavLink
          to="/settings"
          className="flex items-center gap-2 mt-2 px-3 py-2 text-gray-400 hover:text-mtg-white text-sm rounded-lg hover:bg-mtg-panel transition-colors"
        >
          <SettingsIcon className="w-4 h-4" />
          Settings
        </NavLink>
      </div>
    </aside>
  )
}

function HomeIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function CollectionIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
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

function SettingsIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}
