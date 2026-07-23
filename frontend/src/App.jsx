import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import ChatDashboard from './pages/ChatDashboard.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import './styles/global.css'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

function AppRoutes() {
  const { user, loading } = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        {/* Auth pages — redirect to "/" if already logged in */}
        <Route
          path="/login"
          element={user && !loading ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={user && !loading ? <Navigate to="/" replace /> : <RegisterPage />}
        />

        {/* Main chat — accessible to EVERYONE (guests get 4 free messages) */}
        <Route
          path="/"
          element={
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
              <Navbar />
              <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <ChatDashboard />
              </main>
            </div>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}
