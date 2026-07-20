import styles from './Loader.module.css'

/**
 * Full-area loading overlay with spinner and message.
 */
export default function Loader({ message = 'Processing…' }) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.inner}>
        <div className={styles.spinner} aria-hidden="true">
          <div className={styles.ring} />
          <div className={styles.ring} />
          <div className={styles.ring} />
        </div>
        <p className={styles.message}>{message}</p>
      </div>
    </div>
  )
}
