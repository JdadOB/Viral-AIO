import { motion } from 'framer-motion'

const NAV = [
  { id: 'deck',         icon: '◈', label: 'SHIP DECK',        sub: 'AI CREW' },
  { id: 'intel',        icon: '■', label: 'INTELLIGENCE HUB', sub: 'THREATS' },
  { id: 'surveillance', icon: '▲', label: 'SURVEILLANCE NET',  sub: 'TARGETS' },
  { id: 'command',      icon: '△', label: 'COMMAND CENTER',    sub: 'AGENTS' },
  { id: 'config',       icon: '◆', label: 'MISSION CONFIG',    sub: 'SETTINGS' },
]

export default function Sidebar({ currentPage, onNavigate, stats = {}, onPoll, polling }) {
  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col relative z-20"
      style={{ background: 'rgba(5,8,16,0.95)', borderRight: '1px solid rgba(0,242,255,0.15)' }}>

      {/* Glowing right edge */}
      <div className="absolute right-0 top-0 bottom-0 w-px animate-sidebar-glow"
        style={{ background: 'linear-gradient(180deg, transparent, #00F2FF, transparent)' }}/>

      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: 'rgba(0,242,255,0.12)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 text-cyan animate-radar flex-shrink-0"
            style={{ filter: 'drop-shadow(0 0 8px #00F2FF)' }}>
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="12" cy="12" r="4" fill="currentColor"/>
              <line x1="12" y1="2"  x2="12" y2="6"  stroke="currentColor" strokeWidth="1.5"/>
              <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="2"  y1="12" x2="6"  y2="12" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <div className="font-display text-[13px] font-black tracking-[3px] text-bright">
              VIRAL<span className="text-cyan">TRACK</span>
            </div>
            <div className="text-[8px] text-dim tracking-[2px] mt-0.5">INTEL SYS v2.0</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="px-3 pt-4 flex-1">
        <div className="text-[8px] tracking-[3px] text-dim px-2 mb-2">// SECTORS</div>
        <nav className="flex flex-col gap-1">
          {NAV.map(item => {
            const active = currentPage === item.id
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)}
                className="flex items-center gap-2.5 px-3 py-2.5 text-left w-full transition-all duration-200 relative"
                style={{
                  background: active ? 'rgba(0,242,255,0.08)' : 'transparent',
                  border: `1px solid ${active ? 'rgba(0,242,255,0.4)' : 'transparent'}`,
                  clipPath: 'polygon(6px 0,calc(100% - 6px) 0,100% 6px,100% calc(100% - 6px),calc(100% - 6px) 100%,6px 100%,0 calc(100% - 6px),0 6px)',
                  color: active ? '#00F2FF' : '#4A6070',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#C8D6E5' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#4A6070' }}
              >
                {active && (
                  <motion.div className="absolute inset-0 pointer-events-none"
                    style={{ background: 'linear-gradient(135deg, rgba(0,242,255,0.05) 0%, transparent 60%)' }}
                    layoutId="nav-highlight"
                  />
                )}
                <span className="text-[11px] w-4 text-center flex-shrink-0"
                  style={{ filter: active ? 'drop-shadow(0 0 6px #00F2FF)' : 'none' }}>
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] tracking-[2px] font-mono">{item.label}</div>
                  <div className="text-[7px] tracking-[1px] opacity-60 mt-0.5">{item.sub}</div>
                </div>
                {item.id === 'intel' && stats.unreadAlerts > 0 && (
                  <div className="text-[8px] px-1.5 py-0.5 bg-nred/20 border border-nred/60 text-nred font-mono animate-pulse"
                    style={{ clipPath: 'polygon(3px 0,calc(100% - 3px) 0,100% 3px,100% calc(100% - 3px),calc(100% - 3px) 100%,3px 100%,0 calc(100% - 3px),0 3px)' }}>
                    {stats.unreadAlerts}
                  </div>
                )}
                {item.id === 'surveillance' && stats.totalAccounts > 0 && (
                  <div className="text-[8px] px-1.5 py-0.5 bg-cyan/10 border border-cyan/30 text-cyan font-mono">
                    {stats.totalAccounts}
                  </div>
                )}
              </button>
            )
          })}
        </nav>

        {/* Execute Scan */}
        <div className="mt-5 px-1">
          <div className="text-[8px] tracking-[3px] text-dim px-2 mb-2">// OPERATIONS</div>
          <button
            onClick={onPoll}
            disabled={polling}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-cyan text-cyan font-mono text-[10px] tracking-[2px] transition-all duration-200 disabled:opacity-40"
            style={{
              background: polling ? 'rgba(0,242,255,0.1)' : 'transparent',
              clipPath: 'polygon(8px 0,calc(100% - 8px) 0,100% 8px,100% calc(100% - 8px),calc(100% - 8px) 100%,8px 100%,0 calc(100% - 8px),0 8px)',
            }}
            onMouseEnter={e => { if (!polling) e.currentTarget.style.background = 'rgba(0,242,255,0.1)' }}
            onMouseLeave={e => { if (!polling) e.currentTarget.style.background = 'transparent' }}
          >
            {polling ? <><span className="animate-spin">◌</span> SCANNING...</> : '▶ EXECUTE SCAN'}
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t" style={{ borderColor: 'rgba(0,242,255,0.1)' }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-ngreen animate-pulse" style={{ boxShadow: '0 0 8px #00FF88' }}/>
          <span className="text-[8px] tracking-[2px] text-dim">SYSTEM ONLINE</span>
        </div>
        <div className="text-[8px] text-dim tracking-[1px]" id="sys-time">
          {new Date().toISOString().replace('T',' ').slice(0,19)} UTC
        </div>
      </div>
    </aside>
  )
}
