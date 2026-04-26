import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Avatar from './Avatar'
import { ROOM_SCENES } from './RoomScene'

const AGENTS = {
  captain: {
    label: 'THE CAPTAIN', role: 'Quality Control & Humanizer',
    station: 'DATA CORE', color: '#FF6B00',
    idleActions: ['REVIEWING OUTPUTS','QUALITY CHECK','PATROLLING DECK','HUMANIZING DATA','AWAITING ORDERS'],
  },
  strategist: {
    label: 'THE STRATEGIST', role: 'Viral Intelligence Reports',
    station: 'THREAT ANALYSIS', color: '#00F2FF',
    idleActions: ['MONITORING FEEDS','ANALYZING PATTERNS','RUNNING MODELS','SCANNING VECTORS','INDEXING THREATS'],
  },
  writer: {
    label: 'THE WRITER', role: 'Caption Generator',
    station: 'COMMS ARRAY', color: '#00FF88',
    idleActions: ['STUDYING CAPTIONS','DRAFTING HOOKS','TONE ANALYSIS','VOICE CALIBRATION','STYLE REVIEW'],
  },
  assistant: {
    label: 'THE ASSISTANT', role: 'Research & Intelligence',
    station: 'INTEL HUB', color: '#FF00A8',
    idleActions: ['INDEXING DATABASE','CROSS-REFERENCING','SEARCHING INTEL','STANDBY MODE','COMPILING DATA'],
  },
}

export { AGENTS }

export default function AgentCompartment({ agentKey, status = 'idle', stats = {}, onAction }) {
  const agent   = AGENTS[agentKey]
  const RoomBg  = ROOM_SCENES[agentKey]
  const roomRef = useRef(null)
  const [roomW]  = useState(220)
  const isActive = status === 'running'
  const isDone   = status === 'done'
  const c        = agent.color

  const borderColor = isActive ? c : isDone ? '#00FF88' : 'rgba(0,242,255,0.18)'
  const glowColor   = isActive ? `${c}33` : 'transparent'

  return (
    <motion.div
      className="relative flex flex-col overflow-hidden cursor-default"
      style={{
        background: 'rgba(12,17,26,0.88)',
        border: `1px solid ${borderColor}`,
        boxShadow: isActive ? `0 0 30px ${c}22, inset 0 0 40px ${c}08` : 'none',
        clipPath: 'polygon(14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px),0 14px)',
        transition: 'border-color 0.4s, box-shadow 0.4s',
        minHeight: '320px',
      }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      {/* ── Module header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: `${c}30`, background: `${c}0a` }}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse-slow" style={{ background: c, boxShadow: `0 0 8px ${c}` }}/>
          <span className="font-display text-[10px] tracking-[3px]" style={{ color: c }}>{agent.station}</span>
        </div>
        <div className={`text-[8px] tracking-[2px] px-2 py-0.5 border font-mono`}
          style={{
            borderColor: isActive ? c : isDone ? '#00FF88' : 'rgba(255,255,255,0.1)',
            color:        isActive ? c : isDone ? '#00FF88' : '#4A6070',
            clipPath: 'polygon(4px 0,calc(100% - 4px) 0,100% 4px,100% calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,0 calc(100% - 4px),0 4px)',
            animation: isActive ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }}>
          {isActive ? 'ACTIVE' : isDone ? 'COMPLETE' : 'STANDBY'}
        </div>
      </div>

      {/* ── Room scene (60% height) ── */}
      <div ref={roomRef} className="relative overflow-hidden" style={{ height: '190px', background: '#080c14' }}>
        {/* Background scene */}
        <RoomBg />
        {/* Scanline overlay inside room */}
        <div className="absolute inset-0 scanlines pointer-events-none opacity-40" />
        {/* Top gradient fade */}
        <div className="absolute inset-x-0 top-0 h-6 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, #080c14, transparent)' }}/>
        {/* Bottom gradient fade */}
        <div className="absolute inset-x-0 bottom-0 h-8 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(12,17,26,0.95), transparent)' }}/>

        {/* Walking avatar */}
        <Avatar color={c} isActive={isActive} containerWidth={roomW}/>

        {/* Active: data stream from avatar up to header */}
        {isActive && (
          <motion.div
            className="absolute left-1/4 bottom-0 w-px"
            style={{ background: `linear-gradient(to top, ${c}, transparent)` }}
            animate={{ height: [0, 80, 0], opacity: [0, 0.8, 0] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
          />
        )}
      </div>

      {/* ── Data panel (40% height) ── */}
      <div className="flex flex-col gap-2 px-3 py-3 flex-1">
        {/* Agent identity */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex items-center justify-center font-display font-black text-sm flex-shrink-0"
            style={{
              background: `${c}18`,
              border: `1px solid ${c}50`,
              clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)',
              color: c,
            }}>
            {agent.label[4]}
          </div>
          <div>
            <div className="font-display text-[10px] tracking-[2px] text-bright">{agent.label}</div>
            <div className="text-[9px] text-dim mt-0.5">{agent.role}</div>
          </div>
        </div>

        {/* Current sub-process */}
        <div className="text-[8px] tracking-[2px] text-dim font-mono">
          SUB-PROCESS: <span style={{ color: c }} className="animate-flicker">
            {isActive ? 'PROCESSING REQUEST...' : stats.activity || agent.idleActions[0]}
          </span>
        </div>

        {/* Stats row */}
        {stats.outputs != null && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
            <div>
              <div className="text-[7px] tracking-[1px] text-dim">OUTPUTS</div>
              <div className="font-ui font-semibold text-sm" style={{ color: c }}>{stats.outputs}</div>
            </div>
            {stats.lastRun && (
              <div>
                <div className="text-[7px] tracking-[1px] text-dim">LAST RUN</div>
                <div className="font-ui text-xs text-bright">{stats.lastRun}</div>
              </div>
            )}
          </div>
        )}

        {/* Action button */}
        <div className="mt-auto">
          <button
            onClick={() => onAction?.(agentKey)}
            disabled={isActive}
            className="w-full text-[9px] tracking-[2px] py-1.5 border font-mono transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              borderColor: c,
              color: isActive ? c : c,
              background: isActive ? `${c}18` : 'transparent',
              clipPath: 'polygon(6px 0,calc(100% - 6px) 0,100% 6px,100% calc(100% - 6px),calc(100% - 6px) 100%,6px 100%,0 calc(100% - 6px),0 6px)',
            }}
            onMouseEnter={e => { if (!isActive) e.target.style.background = `${c}18` }}
            onMouseLeave={e => { if (!isActive) e.target.style.background = 'transparent' }}
          >
            {isActive ? '⟳ PROCESSING...' : `[ DISPATCH ${agent.label.split(' ')[1]} ]`}
          </button>
        </div>
      </div>

      {/* Corner brackets */}
      {[['top-1 left-1','border-t border-l'],['top-1 right-1','border-t border-r'],
        ['bottom-1 left-1','border-b border-l'],['bottom-1 right-1','border-b border-r']].map(([pos,brd],i) => (
        <div key={i} className={`absolute ${pos} w-3 h-3 ${brd} pointer-events-none`}
          style={{ borderColor: `${c}60` }}/>
      ))}
    </motion.div>
  )
}
