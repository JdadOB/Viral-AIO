/* Sci-fi room backgrounds — one per agent */

function ServerRack({ x, color, height = 80 }) {
  return (
    <g transform={`translate(${x},${140 - height})`}>
      <rect width="18" height={height} rx="1" fill="#121822" stroke={color} strokeWidth="0.5" opacity="0.7"/>
      {Array.from({length: Math.floor(height/14)}, (_,i) => (
        <g key={i} transform={`translate(2,${4 + i*14})`}>
          <rect width="14" height="8" rx="1" fill="rgba(0,0,0,0.5)" stroke={color} strokeWidth="0.3"/>
          <rect width={4 + Math.random()*6} height="2" y="3" x="2" fill={color} opacity="0.5">
            <animate attributeName="opacity" values="0.3;0.8;0.3" dur={`${1+Math.random()}s`} repeatCount="indefinite"/>
          </rect>
        </g>
      ))}
    </g>
  )
}

function Screen({ x, y, w = 40, h = 26, color, children }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx="2" fill="#0a0e17" stroke={color} strokeWidth="0.8" opacity="0.9"/>
      <rect width={w} height="3" fill={color} opacity="0.15"/>
      {children}
    </g>
  )
}

/* ── DATA CORE (Captain) ── */
export function DataCoreScene() {
  const color = '#FF6B00'
  return (
    <svg viewBox="0 0 220 140" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      {/* Floor grid */}
      <defs>
        <pattern id="grid-dc" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke={color} strokeWidth="0.2" opacity="0.3"/>
        </pattern>
      </defs>
      <rect width="220" height="140" fill="url(#grid-dc)" opacity="0.4"/>

      {/* Back wall glow */}
      <ellipse cx="110" cy="0" rx="90" ry="50" fill={color} opacity="0.04"/>

      {/* Server racks */}
      <ServerRack x={8}   color={color} height={100}/>
      <ServerRack x={30}  color={color} height={85}/>
      <ServerRack x={172} color={color} height={95}/>
      <ServerRack x={194} color={color} height={80}/>

      {/* Central holographic globe */}
      <g transform="translate(110,60)">
        <circle r="28" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4"/>
        <circle r="28" fill="none" stroke={color} strokeWidth="0.3" opacity="0.2" strokeDasharray="4 4">
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="20s" repeatCount="indefinite"/>
        </circle>
        <ellipse rx="28" ry="8" fill="none" stroke={color} strokeWidth="0.4" opacity="0.3"/>
        <ellipse rx="28" ry="8" fill="none" stroke={color} strokeWidth="0.3" opacity="0.2" transform="rotate(60)"/>
        <circle r="6" fill={color} opacity="0.6">
          <animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite"/>
        </circle>
        {/* Orbit ping */}
        <circle r="28" fill="none" stroke={color} strokeWidth="1" opacity="0">
          <animate attributeName="r" values="0;30" dur="3s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.6;0" dur="3s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Command terminal */}
      <Screen x={78} y={100} w={64} h={32} color={color}>
        {[0,1,2].map(i => (
          <rect key={i} x="4" y={6+i*8} width={20+Math.random()*20} height="2" fill={color} opacity="0.5">
            <animate attributeName="width" values={`${10+i*8};${30+i*5};${10+i*8}`} dur={`${2+i*0.5}s`} repeatCount="indefinite"/>
          </rect>
        ))}
      </Screen>

      {/* Floor reflection */}
      <rect x="0" y="130" width="220" height="10" fill={color} opacity="0.04"/>
    </svg>
  )
}

/* ── THREAT ANALYSIS (Strategist) ── */
export function ThreatAnalysisScene() {
  const color = '#00F2FF'
  return (
    <svg viewBox="0 0 220 140" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="grid-ta" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke={color} strokeWidth="0.2" opacity="0.3"/>
        </pattern>
        <radialGradient id="radar-glow">
          <stop offset="0%" stopColor={color} stopOpacity="0.15"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="220" height="140" fill="url(#grid-ta)" opacity="0.35"/>

      {/* Radar circle */}
      <g transform="translate(110,65)">
        {[40,28,16].map(r => (
          <circle key={r} r={r} fill="none" stroke={color} strokeWidth="0.5" opacity="0.35"/>
        ))}
        {/* Crosshairs */}
        <line x1="-42" x2="42" stroke={color} strokeWidth="0.4" opacity="0.3"/>
        <line y1="-42" y2="42" stroke={color} strokeWidth="0.4" opacity="0.3"/>
        {/* Spinning sweep */}
        <g>
          <path d="M0,0 L0,-40 A40,40 0 0,1 20,-34.6 Z" fill={color} opacity="0.08">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
          </path>
          <line x2="0" y2="-40" stroke={color} strokeWidth="1" opacity="0.6">
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"/>
          </line>
        </g>
        {/* Blips */}
        {[{x:18,y:-28},{x:-24,y:14},{x:32,y:10}].map((p,i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} opacity="0.8">
            <animate attributeName="opacity" values="0;1;0" dur={`${2+i*0.7}s`} begin={`${i*0.8}s`} repeatCount="indefinite"/>
          </circle>
        ))}
        <circle r="3" fill={color} opacity="0.9"/>
      </g>

      {/* Side data panels */}
      <Screen x={8}  y={20} w={55} h={40} color={color}>
        {[0,1,2,3].map(i => (
          <g key={i}>
            <rect x="4" y={6+i*8} width="8" height="2" fill={color} opacity="0.4"/>
            <rect x="14" y={6+i*8} width={15+i*4} height="2" fill={color} opacity="0.6">
              <animate attributeName="width" values={`${10+i*3};${20+i*4};${10+i*3}`} dur={`${1.5+i*0.3}s`} repeatCount="indefinite"/>
            </rect>
          </g>
        ))}
      </Screen>
      <Screen x={157} y={20} w={55} h={40} color={color}>
        {/* Mini bar chart */}
        {[0,1,2,3,4].map(i => {
          const h = 8 + i*4
          return <rect key={i} x={5+i*9} y={32-h} width="6" height={h} fill={color} opacity="0.5">
            <animate attributeName="height" values={`${h};${h+6};${h}`} dur={`${1+i*0.2}s`} repeatCount="indefinite"/>
          </rect>
        })}
      </Screen>

      {/* Terminal at bottom */}
      <Screen x={78} y={105} w={64} h={28} color={color}>
        <text x="4" y="14" fill={color} fontSize="5" opacity="0.7" fontFamily="monospace">&gt; SCANNING...</text>
        <rect x="4" y="20" width="40" height="2" fill={color} opacity="0.4">
          <animate attributeName="width" values="0;40;40;0" dur="3s" repeatCount="indefinite"/>
        </rect>
      </Screen>
    </svg>
  )
}

/* ── COMMS ARRAY (Writer) ── */
export function CommsArrayScene() {
  const color = '#00FF88'
  return (
    <svg viewBox="0 0 220 140" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="grid-ca" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke={color} strokeWidth="0.2" opacity="0.25"/>
        </pattern>
      </defs>
      <rect width="220" height="140" fill="url(#grid-ca)" opacity="0.35"/>

      {/* Comms dish */}
      <g transform="translate(110,30)">
        <path d="M-30,20 Q0,-20 30,20" fill="none" stroke={color} strokeWidth="1.5" opacity="0.7"/>
        <path d="M-22,16 Q0,-12 22,16" fill="none" stroke={color} strokeWidth="0.8" opacity="0.4"/>
        <line x1="0" y1="20" x2="0" y2="50" stroke={color} strokeWidth="1" opacity="0.6"/>
        {/* Signal rings */}
        {[1,2,3].map(i => (
          <ellipse key={i} cx="0" cy="0" rx={i*10} ry={i*6} fill="none" stroke={color} strokeWidth="0.4" opacity="0">
            <animate attributeName="opacity" values="0;0.5;0" dur="3s" begin={`${i*0.8}s`} repeatCount="indefinite"/>
            <animate attributeName="rx" values={`${i*5};${i*15}`} dur="3s" begin={`${i*0.8}s`} repeatCount="indefinite"/>
            <animate attributeName="ry" values={`${i*3};${i*9}`} dur="3s" begin={`${i*0.8}s`} repeatCount="indefinite"/>
          </ellipse>
        ))}
      </g>

      {/* Left screen bank */}
      <Screen x={8} y={20} w={45} h={80} color={color}>
        {/* Waveform */}
        {Array.from({length:8}, (_,i) => (
          <rect key={i} x={3+i*5} y={20-i%3*5} width="3" height={10+i%3*5} fill={color} opacity="0.5">
            <animate attributeName="height" values={`${5+i*2};${15+i*2};${5+i*2}`} dur={`${0.6+i*0.1}s`} repeatCount="indefinite"/>
          </rect>
        ))}
        {[0,1,2,3].map(i => (
          <rect key={i} x="4" y={40+i*9} width={20+i*3} height="2" fill={color} opacity="0.4"/>
        ))}
      </Screen>

      {/* Right screens */}
      <Screen x={167} y={20} w={45} h={35} color={color}>
        <text x="4" y="14" fill={color} fontSize="5" fontFamily="monospace" opacity="0.8">TRANSMIT</text>
        <rect x="4" y="18" width="30" height="2" fill={color} opacity="0.3">
          <animate attributeName="width" values="0;30;30;0" dur="2.5s" repeatCount="indefinite"/>
        </rect>
        <text x="4" y="28" fill={color} fontSize="4" fontFamily="monospace" opacity="0.5">SIG: 98.4%</text>
      </Screen>
      <Screen x={167} y={60} w={45} h={35} color={color}>
        {[0,1,2].map(i => (
          <rect key={i} x="4" y={8+i*8} width={18+i*5} height="3" rx="1" fill={color} opacity="0.4"/>
        ))}
      </Screen>

      {/* Keyboard terminal */}
      <Screen x={70} y={108} w={80} h={26} color={color}>
        <text x="4" y="12" fill={color} fontSize="4.5" fontFamily="monospace" opacity="0.7">&gt; DRAFTING CAPTIONS_</text>
        <rect x="4" y="18" width="55" height="1.5" fill={color} opacity="0.3"/>
      </Screen>
    </svg>
  )
}

/* ── INTEL HUB (Assistant) ── */
export function IntelHubScene() {
  const color = '#FF00A8'
  return (
    <svg viewBox="0 0 220 140" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="grid-ih" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke={color} strokeWidth="0.2" opacity="0.25"/>
        </pattern>
      </defs>
      <rect width="220" height="140" fill="url(#grid-ih)" opacity="0.35"/>

      {/* Database cylinders */}
      {[30, 60, 90].map((x,i) => (
        <g key={i} transform={`translate(${x},40)`}>
          <ellipse cx="9" cy="0" rx="9" ry="4" fill="none" stroke={color} strokeWidth="0.6" opacity="0.6"/>
          <rect x="0" y="0" width="18" height="50" fill="#0a0e17" stroke={color} strokeWidth="0.5" opacity="0.6"/>
          <ellipse cx="9" cy="50" rx="9" ry="4" fill="#121822" stroke={color} strokeWidth="0.6" opacity="0.6"/>
          {/* Fill level */}
          <rect x="1" y={30-i*8} width="16" height={20+i*8} fill={color} opacity="0.07">
            <animate attributeName="height" values={`${18+i*8};${22+i*8};${18+i*8}`} dur={`${2+i*0.4}s`} repeatCount="indefinite"/>
          </rect>
          {/* Ring */}
          <ellipse cx="9" cy="24" rx="9" ry="4" fill="none" stroke={color} strokeWidth="0.4" opacity="0.4">
            <animate attributeName="cy" values="20;35;20" dur={`${2+i*0.3}s`} repeatCount="indefinite"/>
          </ellipse>
        </g>
      ))}

      {/* Search beam from right */}
      <g transform="translate(180,65)">
        <circle r="18" fill="none" stroke={color} strokeWidth="1" opacity="0.6"/>
        <circle r="12" fill="none" stroke={color} strokeWidth="0.5" opacity="0.4"/>
        <circle r="4" fill={color} opacity="0.5"/>
        {/* Handle */}
        <line x1="13" y1="13" x2="28" y2="28" stroke={color} strokeWidth="2" opacity="0.7"/>
        {/* Scan ring */}
        <circle r="18" fill="none" stroke={color} strokeWidth="2" opacity="0">
          <animate attributeName="r" values="4;22" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.8;0" dur="2s" repeatCount="indefinite"/>
        </circle>
      </g>

      {/* Connection nodes */}
      {[[110,30],[140,55],[95,58],[125,80]].map((p,i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r="3" fill={color} opacity="0.7">
            <animate attributeName="opacity" values="0.4;1;0.4" dur={`${1.5+i*0.3}s`} repeatCount="indefinite"/>
          </circle>
          <circle cx={p[0]} cy={p[1]} r="6" fill="none" stroke={color} strokeWidth="0.5" opacity="0">
            <animate attributeName="r" values="3;10" dur="2s" begin={`${i*0.5}s`} repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.5;0" dur="2s" begin={`${i*0.5}s`} repeatCount="indefinite"/>
          </circle>
        </g>
      ))}
      {/* Lines between nodes */}
      <line x1="110" y1="30" x2="140" y2="55" stroke={color} strokeWidth="0.4" opacity="0.25"/>
      <line x1="140" y1="55" x2="125" y2="80" stroke={color} strokeWidth="0.4" opacity="0.25"/>
      <line x1="95"  y1="58" x2="125" y2="80" stroke={color} strokeWidth="0.4" opacity="0.25"/>

      {/* Query terminal */}
      <Screen x={70} y={108} w={80} h={26} color={color}>
        <text x="4" y="12" fill={color} fontSize="4.5" fontFamily="monospace" opacity="0.7">&gt; QUERY: INTEL_DB_</text>
        <rect x="4" y="18" width="60" height="1.5" fill={color} opacity="0.3"/>
      </Screen>
    </svg>
  )
}

export const ROOM_SCENES = {
  captain:    DataCoreScene,
  strategist: ThreatAnalysisScene,
  writer:     CommsArrayScene,
  assistant:  IntelHubScene,
}
