import styles from './Navbar.module.css'
import { FiShield } from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user } = useAuth()

  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        {/* Brand */}
        <Link to="/" className={styles.brand} style={{ textDecoration: 'none' }}>
          <div className={styles.logoIcon}>
            <FiShield size={19} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>Vector Law</span>
            <span className={styles.brandTagline}>US Legal Knowledge Base</span>
          </div>
        </Link>

        {/* Right side — only show if not logged in (logged-in user info is in sidebar) */}
        {!user && (
          <div className={styles.author}>
            <span className={styles.authorName}>AI-Powered Legal Research</span>
          </div>
        )}
      </div>
    </header>
  )
}
