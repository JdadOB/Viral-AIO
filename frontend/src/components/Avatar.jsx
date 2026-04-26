import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

/* Pixel-art style agent SVG sprite */
function AvatarSprite({ color, isWalking, isTyping }) {
  return (
    <svg width="28" height="46" viewBox="0 0 28 46" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id={`glow-${color.replace('#','')}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Head — hexagonal */}
      <polygon
        points="14,2 22,7 22,17 14,22 6,17 6,7"
        fill={color} opacity="0.85"
        filter={`url(#glow-${color.replace('#','')})`}
      />
      {/* Visor */}
      <polygon points="14,7 20,10.5 20,15 14,18.5 8,15 8,10.5" fill="rgba(0,0,0,0.75)"/>
      <line x1="8" y1="12.5" x2="20" y2="12.5" stroke={color} strokeWidth="1.2" opacity="0.8"/>
      {/* Eye dot */}
      <circle cx="14" cy="13" r="1.5" fill={color} opacity="0.9">
        <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite"/>
      </circle>

      {/* Neck */}
      <rect x="12" y="22" width="4" height="2" fill={color} opacity="0.6"/>

      {/* Body */}
      <rect x="7" y="24" width="14" height="13" rx="2" fill={color} opacity="0.75"/>
      {/* Chest panel */}
      <rect x="10" y="27" width="8" height="2" rx="1" fill="rgba(0,0,0,0.5)"/>
      <circle cx="14" cy="33" r="2" fill={color} opacity="0.4">
        <animate attributeName="opacity" values="0.2;0.9;0.2" dur="1.8s" repeatCount="indefinite"/>
      </circle>

      {/* Left arm */}
      <rect
        x="1" y={isTyping ? "23" : "26"} width="6" height="3" rx="1.5"
        fill={color} opacity="0.7"
        style={{ transition: 'all 0.2s' }}
      />
      {/* Right arm */}
      <rect
        x="21" y={isTyping ? "23" : "26"} width="6" height="3" rx="1.5"
        fill={color} opacity="0.7"
        style={{ transition: 'all 0.2s' }}
      />

      {/* Left leg */}
      <rect
        x="7" y="37" width="5" height="9" rx="2"
        fill={color} opacity="0.65"
        className={isWalking && !isTyping ? 'walk-leg-l' : ''}
      />
      {/* Right leg */}
      <rect
        x="16" y="37" width="5" height="9" rx="2"
        fill={color} opacity="0.65"
        className={isWalking && !isTyping ? 'walk-leg-r' : ''}
      />
    </svg>
  )
}

export default function Avatar({ color = '#00F2FF', isActive = false, containerWidth = 200 }) {
  const AVATAR_W = 28
  const [x, setX] = useState(Math.random() * (containerWidth - AVATAR_W))
  const [facingRight, setFacingRight] = useState(true)
  const [isWalking, setIsWalking] = useState(false)
  const xRef = useRef(x)
  xRef.current = x

  useEffect(() => {
    if (isActive) { setIsWalking(false); return }
    let timeout
    const wander = () => {
      const max = Math.max(containerWidth - AVATAR_W - 10, 20)
      const next = 10 + Math.random() * max
      setFacingRight(next > xRef.current)
      setIsWalking(true)
      setX(next)
      timeout = setTimeout(() => {
        setIsWalking(false)
        timeout = setTimeout(wander, 800 + Math.random() * 2200)
      }, 600 + Math.random() * 800)
    }
    timeout = setTimeout(wander, Math.random() * 1500)
    return () => clearTimeout(timeout)
  }, [isActive, containerWidth])

  /* When active, walk to the terminal (center-left) */
  const terminalX = containerWidth * 0.2

  return (
    <motion.div
      className="absolute bottom-6 select-none"
      animate={{ x: isActive ? terminalX : x }}
      transition={{ type: 'spring', stiffness: 38, damping: 14 }}
    >
      {/* Processing hologram bubble */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap z-10"
            initial={{ opacity: 0, y: 4, scaleY: 0.5 }}
            animate={{ opacity: [0.8,1,0.8], y: [0,-3,0] }}
            exit={{ opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
          >
            <div className="bg-black/70 border border-cyan/50 px-2 py-0.5 text-[8px] text-cyan font-mono tracking-widest">
              PROCESSING...
            </div>
            {/* Arrow down */}
            <div className="w-0 h-0 mx-auto" style={{
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid rgba(0,242,255,0.5)',
            }}/>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={isActive ? 'animate-bob' : ''}
        style={{ transform: facingRight ? 'scaleX(1)' : 'scaleX(-1)' }}
      >
        <AvatarSprite color={color} isWalking={isWalking} isTyping={isActive}/>
      </div>
    </motion.div>
  )
}
