const BASE = ''

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export const api = {
  getStats:    ()           => req('/api/stats'),
  getAccounts: ()           => req('/api/accounts'),
  addAccount:  (body)       => req('/api/accounts', { method: 'POST', body }),
  delAccount:  (id)         => req(`/api/accounts/${id}`, { method: 'DELETE' }),

  getAlerts:   (filter)     => req(`/api/alerts?filter=${filter || 'all'}`),
  markViewed:  (id)         => req(`/api/alerts/${id}/viewed`, { method: 'PATCH' }),
  markActed:   (id, v)      => req(`/api/alerts/${id}/acted-on`, { method: 'PATCH', body: { acted_on: v } }),
  dismiss:     (id)         => req(`/api/alerts/${id}/dismiss`, { method: 'PATCH' }),
  clearActed:  ()           => req('/api/alerts/acted-on', { method: 'DELETE' }),
  genBrief:    (id)         => req(`/api/alerts/${id}/brief`, { method: 'POST' }),

  poll:        ()           => req('/api/poll', { method: 'POST' }),

  getSettings: ()           => req('/api/settings'),
  saveSettings:(body)       => req('/api/settings', { method: 'POST', body }),

  runStrategist:(days)      => req('/api/agents/strategist', { method: 'POST', body: { days } }),
  runWriter:    (body)       => req('/api/agents/writer',     { method: 'POST', body }),
  runAssistant: (question)  => req('/api/agents/assistant',  { method: 'POST', body: { question } }),
  runCaptain:   (outputId)  => req('/api/agents/captain',    { method: 'POST', body: { outputId } }),
  getHistory:   (agent)     => req(`/api/agents/history${agent ? `?agent=${agent}` : ''}`),

  proxyImg: (url) => url ? `/api/img?url=${encodeURIComponent(url)}` : null,
}

export function fmt(n) {
  if (n == null) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

export function timeAgo(dateStr) {
  if (!dateStr) return 'UNKNOWN'
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'JUST NOW'
  if (m < 60) return `${m}M AGO`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}H AGO`
  return `${Math.floor(h / 24)}D AGO`
}

export function threatId(id) {
  return 'THR-' + String(id).padStart(4, '0')
}
