import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GoogleLogin } from '@react-oauth/google'
import { useAuth } from '../context/AuthContext'
import { FiShield, FiAlertCircle, FiCheckCircle } from 'react-icons/fi'
import styles from '../styles/Auth.module.css'

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setError('')
    setInfo('')
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      if (err.message?.toLowerCase().includes('verify')) {
        setInfo(err.message)
      } else {
        setError(err.message || 'Login failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSuccess = async (credentialResponse) => {
    setLoading(true)
    setError('')
    try {
      await loginWithGoogle(credentialResponse.credential)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Google login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <Link to="/" className={styles.logo} style={{ textDecoration: 'none' }}>
          <div className={styles.logoIcon}><FiShield size={26} /></div>
          <h1 className={styles.logoTitle}>Vector Law</h1>
          <span className={styles.logoSub}>AI-Powered Legal Research</span>
        </Link>

        <h2 className={styles.heading}>Welcome back</h2>
        <p className={styles.subheading}>Sign in to continue your legal research</p>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <FiAlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            {error}
          </div>
        )}
        {info && (
          <div className={styles.infoBanner} role="status">
            <FiCheckCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            {info}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className={styles.input}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <button
            className={styles.submitBtn}
            type="submit"
            disabled={loading}
            id="login-submit-btn"
          >
            {loading ? <span className={styles.spinner} /> : null}
            {loading ? 'Signing in…' : 'Sign In'}
          </button>

          <div className={styles.divider}>or continue with</div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Google sign-in failed or was cancelled.')}
              theme="filled_black"
              shape="rectangular"
              size="large"
              text="signin_with"
              width="368"
            />
          </div>
        </form>

        <p className={styles.footer}>
          Don&apos;t have an account?{' '}
          <Link to="/register" className={styles.footerLink}>Create one free</Link>
        </p>
      </div>
    </div>
  )
}
