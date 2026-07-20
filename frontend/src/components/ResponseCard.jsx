import { useState } from 'react'
import { FiCopy, FiCheck, FiCpu, FiClock } from 'react-icons/fi'
import styles from './ResponseCard.module.css'

/**
 * Displays the AI-generated answer in a polished card.
 */
export default function ResponseCard({ response, timestamp }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(response)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`${styles.card} animate-fade-in-scale`}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.aiIcon}>
            <FiCpu size={14} />
          </div>
          <div>
            <p className={styles.headerTitle}>AI Response</p>
            {timestamp && (
              <p className={styles.headerMeta}>
                <FiClock size={10} />
                <span>{timestamp}</span>
              </p>
            )}
          </div>
        </div>
        <button
          className={styles.copyBtn}
          onClick={handleCopy}
          title="Copy to clipboard"
          aria-label="Copy response"
        >
          {copied ? <FiCheck size={15} /> : <FiCopy size={15} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>

      {/* Divider */}
      <div className={styles.divider} />

      {/* Response body */}
      <div className={styles.body}>
        {response.split('\n').map((line, i) =>
          line.trim() ? (
            <p key={i} className={styles.line}>
              {line}
            </p>
          ) : (
            <br key={i} />
          )
        )}
      </div>
    </div>
  )
}
