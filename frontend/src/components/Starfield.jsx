import { useEffect, useRef } from 'react'

export default function Starfield() {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    let stars = [], nebulas = [], raf

    function resize() {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }

    function init() {
      stars = Array.from({ length: 240 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.3 + 0.2,
        speed: Math.random() * 0.1 + 0.01,
        phase: Math.random() * Math.PI * 2,
        color: Math.random() > 0.85 ? [112,0,255] : Math.random() > 0.7 ? [0,242,255] : [180,220,255],
      }))
      nebulas = Array.from({ length: 5 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 200 + 80,
        color: Math.random() > 0.5 ? '112,0,255' : '0,242,255',
        phase: Math.random() * Math.PI * 2,
      }))
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      nebulas.forEach(n => {
        n.phase += 0.003
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * (0.9 + 0.1 * Math.sin(n.phase)))
        g.addColorStop(0, `rgba(${n.color},0.045)`)
        g.addColorStop(1, 'transparent')
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = g; ctx.fill()
      })
      stars.forEach(s => {
        s.phase += 0.018; s.y += s.speed
        if (s.y > canvas.height) { s.y = 0; s.x = Math.random() * canvas.width }
        const op = 0.25 + 0.65 * Math.abs(Math.sin(s.phase))
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${s.color.join(',')},${op})`
        ctx.fill()
      })
      raf = requestAnimationFrame(draw)
    }

    resize(); init(); draw()
    window.addEventListener('resize', () => { resize(); init() })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={ref} className="fixed inset-0 z-0 pointer-events-none opacity-60" />
}
