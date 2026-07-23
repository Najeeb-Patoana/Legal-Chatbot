import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/**
 * Wraps protected routes. Redirects to /login if user is not authenticated.
 * Shows nothing while the silent token refresh is in progress.
 */
export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#060b14',
        flexDirection: 'column',
        gap: 16,
      }}>
        <div style={{
          width: 40, height: 40,
          border: '3px solid rgba(15,118,110,0.2)',
          borderTopColor: '#0f766e',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <span style={{ color: '#475569', fontSize: '0.85rem' }}>Loading…</span>
      </div>
    )
  }

  return user ? children : <Navigate to="/login" replace />
}
