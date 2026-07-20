import styles from './Navbar.module.css'
import { FiShield } from 'react-icons/fi'

export default function Navbar() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.logoIcon}>
            <FiShield size={19} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>US Legal Knowledge Base</span>
            <span className={styles.brandTagline}>AI-Powered Legal Information</span>
          </div>
        </div>

        {/* Author */}
        <div className={styles.author}>
          <span className={styles.authorName}>Najeeb Ullah Khan</span>
        </div>
      </div>
    </header>
  )
}
