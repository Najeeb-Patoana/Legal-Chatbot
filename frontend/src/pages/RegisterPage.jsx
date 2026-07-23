import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GoogleLogin } from '@react-oauth/google'
import { useAuth } from '../context/AuthContext'
import { FiShield, FiAlertCircle, FiCheckCircle, FiUser } from 'react-icons/fi'
import styles from '../styles/Auth.module.css'

export default function RegisterPage() {
  const { register, loginWithGoogle } = useAuth()
  const navigate = useNavigate()

  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name || !email || !password) { setError('All fields are required.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setError('')
    setLoading(true)
    try {
      await register(name.trim(), email.trim(), password)
      setSuccess(true)
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className={styles.page}>
        <div className={styles.card} style={{ textAlign: 'center' }}>
          <div className={styles.logo}>
            <div className={styles.logoIcon} style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}>
              <FiCheckCircle size={26} />
            </div>
          </div>
          <h2 className={styles.heading}>Check your inbox!</h2>
          <p className={styles.subheading} style={{ maxWidth: 320, margin: '0 auto 24px' }}>
            We sent a verification link to <strong style={{ color: '#e2e8f0' }}>{email}</strong>.
            Click the link to activate your account, then come back to log in.
          </p>
          <Link to="/login" className={styles.submitBtn} style={{ textDecoration: 'none', display: 'inline-flex', width: 'auto', padding: '12px 32px' }}>
            Go to Login
          </Link>
        </div>
      </div>
    )
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

        <h2 className={styles.heading}>Create your account</h2>
        <p className={styles.subheading}>Free access to AI-powered legal research</p>

        {error && (
          <div className={styles.errorBanner} role="alert">
            <FiAlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            {error}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="reg-name">Full Name</label>
            <input
              id="reg-name"
              className={styles.input}
              type="text"
              placeholder="Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoComplete="name"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
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
            <label className={styles.label} htmlFor="reg-password">Password <span style={{ color: '#475569', textTransform: 'none', letterSpacing: 0 }}>(min 8 chars)</span></label>
            <input
              id="reg-password"
              className={styles.input}
              type="password"
              placeholder="Create a strong password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <button
            className={styles.submitBtn}
            type="submit"
            disabled={loading}
            id="register-submit-btn"
          >
            {loading ? <span className={styles.spinner} /> : null}
            {loading ? 'Creating account…' : 'Create Account'}
          </button>

          <div className={styles.divider}>or sign up with</div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GoogleLogin
              onSuccess={async (credentialResponse) => {
                setLoading(true)
                setError('')
                try {
                  await loginWithGoogle(credentialResponse.credential)
                  navigate('/', { replace: true })
                } catch (e) {
                  setError(e.message || 'Google sign-up failed.')
                } finally {
                  setLoading(false)
                }
              }}
              onError={() => setError('Google sign-up failed or was cancelled.')}
              theme="filled_black"
              shape="rectangular"
              size="large"
              text="signup_with"
              width="368"
            />
          </div>
        </form>

        <p className={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" className={styles.footerLink}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
