import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

export function useStats() {
  const [stats, setStats] = useState({ totalAccounts: 0, totalAlerts: 0, unreadAlerts: 0, actedOn: 0, totalBriefs: 0 })
  const refresh = useCallback(() => api.getStats().then(setStats).catch(() => {}), [])
  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t) }, [refresh])
  return { stats, refresh }
}

export function useAccounts() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    setLoading(true)
    api.getAccounts().then(a => { setAccounts(a); setLoading(false) }).catch(() => setLoading(false))
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { accounts, loading, refresh }
}

export function useAlerts(filter) {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    setLoading(true)
    api.getAlerts(filter).then(a => { setAlerts(a); setLoading(false) }).catch(() => setLoading(false))
  }, [filter])
  useEffect(() => { refresh() }, [refresh])
  return { alerts, setAlerts, loading, refresh }
}
