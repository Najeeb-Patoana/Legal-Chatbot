import styles from './Navbar.module.css'
import { FiFileText } from 'react-icons/fi'

export default function Navbar() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.logoIcon}>
            <FiFileText size={19} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>PDF Intelligence</span>
            <span className={styles.brandTagline}>AI-Powered Document Q&amp;A</span>
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
