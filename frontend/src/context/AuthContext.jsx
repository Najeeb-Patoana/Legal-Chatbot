import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as authApi from '../services/authApi'
import { setApiToken } from '../services/authApi'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [loading, setLoading]         = useState(true)  

  // ── Silent token refresh on page load ──────────────────────────────────────
  useEffect(() => {
    const storedRefresh = localStorage.getItem('refreshToken')
    const storedUser    = localStorage.getItem('user')

    if (!storedRefresh) {
      setLoading(false)
      return
    }

    authApi.refreshToken(storedRefresh)
      .then((data) => {
        if (data.success) {
          setAccessToken(data.accessToken)
          setApiToken(data.accessToken)
          setUser(data.user)
        } else {
          localStorage.removeItem('refreshToken')
          localStorage.removeItem('user')
        }
      })
      .catch(() => {
        localStorage.removeItem('refreshToken')
        localStorage.removeItem('user')
      })
      .finally(() => setLoading(false))
  }, [])

  // ── Access-token auto-refresh (every 13 minutes) ───────────────────────────
  useEffect(() => {
    if (!accessToken) return
    const interval = setInterval(async () => {
      const stored = localStorage.getItem('refreshToken')
      if (!stored) return
      try {
        const data = await authApi.refreshToken(stored)
        if (data.success) setAccessToken(data.accessToken)
      } catch {
        // Let the next API call surface the 401
      }
    }, 13 * 60 * 1000)
    return () => clearInterval(interval)
  }, [accessToken])

  // ── Auth helpers ───────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const data = await authApi.login({ email, password })
    if (!data.success) throw new Error(data.message)
    _storeSession(data)
    return data
  }, [])

  const register = useCallback(async (name, email, password) => {
    const data = await authApi.register({ name, email, password })
    if (!data.success) throw new Error(data.message)
    return data
  }, [])

  const loginWithGoogle = useCallback(async (credential) => {
    const data = await authApi.googleLogin(credential)
    if (!data.success) throw new Error(data.message)
    _storeSession(data)
    return data
  }, [])

 const logout = useCallback(async () => {
    try { if (accessToken) await authApi.logout() } catch { /* ignore */ }
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('user')
    setAccessToken(null)
    setUser(null)
    setApiToken(null) 
  }, [accessToken])

  function _storeSession(data) {
    localStorage.setItem('refreshToken', data.refreshToken)
    localStorage.setItem('user', JSON.stringify(data.user))
    setAccessToken(data.accessToken)
    setUser(data.user)

    setApiToken(data.accessToken) 
  }

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, register, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
