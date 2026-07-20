import styles from './Footer.module.css'

export default function Footer() {
  const year = new Date().getFullYear()

  const tech = [
    { label: 'React', href: 'https://react.dev' },
    { label: 'Express', href: 'https://expressjs.com' },
    { label: 'Gemini', href: 'https://ai.google.dev' },
    { label: 'Qdrant', href: 'https://qdrant.tech' },
  ]

  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p className={styles.copy}>&copy; {year} PDF Intelligence</p>

        <div className={styles.techRow}>
          <span className={styles.poweredBy}>Powered by</span>
          {tech.map((t, i) => (
            <span key={t.label}>
              <a
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.techLink}
              >
                {t.label}
              </a>
              {i < tech.length - 1 && <span className={styles.dot}>·</span>}
            </span>
          ))}
        </div>
      </div>
    </footer>
  )
}
