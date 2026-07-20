import { useState } from 'react'
import { FiMessageSquare, FiSend, FiAlertCircle, FiInfo } from 'react-icons/fi'
import Button from './Button.jsx'
import Loader from './Loader.jsx'
import Textarea from './Textarea.jsx'
import ResponseCard from './ResponseCard.jsx'
import { askQuestion } from '../services/api.js'
import styles from './QuestionCard.module.css'

/**
 * QuestionCard — takes the user's question, re-sends the stored PDF file + question
 * to /upload as a temporary workaround while the backend is not yet split.
 */
export default function QuestionCard({ file }) {
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [timestamp, setTimestamp] = useState(null)

  const handleAsk = async () => {
    if (!file) {
      setError('Please upload a PDF first before asking questions.')
      return
    }
    if (!question.trim()) {
      setError('Question cannot be empty.')
      return
    }

    setLoading(true)
    setError(null)
    setResponse(null)

    try {
      const answer = await askQuestion(file, question.trim())
      setResponse(answer)
      setTimestamp(
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      )
    } catch (err) {
      let msg = 'Something went wrong. Please try again.'
      if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error')) {
        msg = 'Server unavailable. Make sure the backend is running on port 3000.'
      } else if (err?.response?.status === 404) {
        msg = 'No matching content found for your question.'
      } else if (err?.response?.data?.message) {
        msg = err.response.data.message
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    // Submit on Ctrl+Enter
    if (e.ctrlKey && e.key === 'Enter') handleAsk()
  }

  return (
    <section className={`${styles.card} animate-fade-in`} id="questions" aria-label="Ask Questions" style={{ animationDelay: '80ms' }}>
      {/* Card Header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <FiMessageSquare size={18} />
        </div>
        <div>
          <h2 className={styles.cardTitle}>Ask Questions</h2>
          <p className={styles.cardSubtitle}>Get AI answers from your document</p>
        </div>
      </div>

      {/* No file warning */}
      {!file && (
        <div className={`${styles.infoBox} animate-fade-in`}>
          <FiInfo size={15} />
          <span>Upload a PDF first to enable questions.</span>
        </div>
      )}

      {/* Textarea */}
      <Textarea
        id="question-input"
        placeholder="Ask anything about your uploaded PDF… (Ctrl+Enter to submit)"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={5}
        disabled={loading || !file}
        error={error && !response ? error : undefined}
      />

      {/* Error (only when no response) */}
      {error && (
        <div className={`${styles.errorBox} animate-fade-in`} role="alert">
          <FiAlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading */}
      {loading && <Loader message="Analyzing document and generating answer…" />}

      {/* Ask button */}
      {!loading && (
        <Button
          variant="primary"
          size="lg"
          onClick={handleAsk}
          disabled={!file || !question.trim()}
          style={{ width: '100%' }}
          id="ask-btn"
        >
          <FiSend size={16} />
          Ask Question
        </Button>
      )}

      {/* Response */}
      {response && <ResponseCard response={response} timestamp={timestamp} />}
    </section>
  )
}
