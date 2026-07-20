import AnalyzeCard from '../components/AnalyzeCard.jsx'
import styles from './Home.module.css'

export default function Home() {
  return (
    <div className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={`container ${styles.heroInner}`}>
          <div className={styles.heroBadge}>
            <span className={styles.heroDot} />
            Retrieval-Augmented Generation
          </div>
          <h1 className={styles.heroTitle}>
            Get instant answers from<br />
            <span className={styles.heroHighlight}>your PDF documents</span>
          </h1>
          <p className={styles.heroDesc}>
            Upload a PDF, ask a question, and receive a precise AI-generated answer
            grounded in your document — powered by Gemini &amp; Qdrant.
          </p>

          {/* Pipeline chips */}
          <div className={styles.pipeline}>
            {['Upload PDF', '→', 'Embed Chunks', '→', 'Semantic Search', '→', 'AI Answer'].map(
              (item, i) => (
                item === '→'
                  ? <span key={i} className={styles.arrow}>{item}</span>
                  : <span key={i} className={styles.chip}>{item}</span>
              )
            )}
          </div>
        </div>
      </section>

      {/* Unified card */}
      <section className={`container ${styles.cardSection}`}>
        <AnalyzeCard />
      </section>
    </div>
  )
}
