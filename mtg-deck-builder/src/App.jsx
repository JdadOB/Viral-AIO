import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Collection from './pages/Collection'
import DeckBuilder from './pages/DeckBuilder'
import Recommendations from './pages/Recommendations'
import Trials from './pages/Trials'
import Settings from './pages/Settings'
import { AppProvider } from './store/AppContext'

export default function App() {
  return (
    <AppProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/collection" element={<Collection />} />
            <Route path="/deck-builder" element={<DeckBuilder />} />
            <Route path="/deck-builder/:deckId" element={<DeckBuilder />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/trials" element={<Trials />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </AppProvider>
  )
}
