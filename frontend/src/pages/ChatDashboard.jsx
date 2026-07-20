import { useState, useRef, useEffect, useCallback } from 'react'
import { FiSend, FiAlertTriangle, FiShield, FiCpu, FiUser, FiCopy, FiCheck } from 'react-icons/fi'
import { askLegalQuestion } from '../services/api.js'
import styles from './ChatDashboard.module.css'

/**
 * ChatDashboard — ChatGPT-style interface for the US Legal Knowledge Base.
 *
 * Features:
 * - User messages aligned right (teal bubbles)
 * - Bot messages aligned left (light gray bubbles)
 * - Permanent legal disclaimer banner
 * - Auto-scroll to latest message
 * - Copy-to-clipboard on bot responses
 * - Typing indicator while waiting
 */
export default function ChatDashboard() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleCopy = useCallback((text, id) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage = {
      id: Date.now(),
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const answer = await askLegalQuestion(trimmed)

      const botMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }

      setMessages((prev) => [...prev, botMessage])
    } catch (err) {
      const errorMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        text: err.message || 'Something went wrong. Please try again.',
        isError: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  /**
   * Render message text with basic formatting:
   * - Paragraphs split by double newlines
   * - Bold text **like this**
   * - Inline code `like this`
   */
  const renderMessageText = (text) => {
    const paragraphs = text.split(/\n{2,}/)

    return paragraphs.map((para, pIdx) => {
      // Split single newlines within a paragraph
      const lines = para.split('\n')
      return (
        <p key={pIdx} className={styles.messageParagraph}>
          {lines.map((line, lIdx) => (
            <span key={lIdx}>
              {lIdx > 0 && <br />}
              {renderInlineFormatting(line)}
            </span>
          ))}
        </p>
      )
    })
  }

  const renderInlineFormatting = (text) => {
    // Handle **bold** and `code`
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className={styles.inlineCode}>{part.slice(1, -1)}</code>
      }
      return part
    })
  }

  return (
    <div className={styles.chatContainer}>
      {/* Permanent Legal Disclaimer Banner */}
      <div className={styles.disclaimer} role="alert" id="legal-disclaimer-banner">
        <FiAlertTriangle size={16} className={styles.disclaimerIcon} />
        <p className={styles.disclaimerText}>
          <strong>Legal Information Only</strong> — This tool provides general legal information
          retrieved from indexed federal statutes and judicial opinions. It does{' '}
          <strong>not</strong> constitute legal advice, and no attorney-client relationship is
          formed. Always consult a licensed attorney for your specific situation.
        </p>
      </div>

      {/* Chat Messages Area */}
      <div className={styles.messagesArea} id="chat-messages-area">
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <FiShield size={40} />
            </div>
            <h2 className={styles.emptyTitle}>US Legal Knowledge Base</h2>
            <p className={styles.emptyDesc}>
              Ask questions about federal statutes, case law, or legal concepts.
              I'll search through indexed legal documents to provide accurate, cited information.
            </p>
            <div className={styles.suggestions}>
              {[
                'What does 17 USC § 107 say about fair use?',
                'Explain the Fourth Amendment protections',
                'What is the standard for summary judgment?',
              ].map((q, i) => (
                <button
                  key={i}
                  className={styles.suggestionChip}
                  onClick={() => { setInput(q); inputRef.current?.focus() }}
                  id={`suggestion-${i}`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.messageRow} ${styles[msg.role]} animate-slide-up`}
            id={`message-${msg.id}`}
          >
            {/* Avatar */}
            <div className={`${styles.avatar} ${styles[`avatar_${msg.role}`]}`}>
              {msg.role === 'user' ? <FiUser size={16} /> : <FiCpu size={16} />}
            </div>

            {/* Bubble */}
            <div className={`${styles.bubble} ${msg.isError ? styles.errorBubble : ''}`}>
              <div className={styles.bubbleContent}>
                {renderMessageText(msg.text)}
              </div>

              <div className={styles.bubbleMeta}>
                <span className={styles.timestamp}>{msg.timestamp}</span>
                {msg.role === 'assistant' && !msg.isError && (
                  <button
                    className={styles.copyBtn}
                    onClick={() => handleCopy(msg.text, msg.id)}
                    title="Copy response"
                    aria-label="Copy response to clipboard"
                  >
                    {copiedId === msg.id ? <FiCheck size={12} /> : <FiCopy size={12} />}
                    <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Typing Indicator */}
        {isLoading && (
          <div className={`${styles.messageRow} ${styles.assistant} animate-slide-up`}>
            <div className={`${styles.avatar} ${styles.avatar_assistant}`}>
              <FiCpu size={16} />
            </div>
            <div className={styles.bubble}>
              <div className={styles.typingIndicator}>
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar — fixed at bottom */}
      <div className={styles.inputBar}>
        <div className={styles.inputContainer}>
          <textarea
            ref={inputRef}
            id="chat-input"
            className={styles.chatInput}
            placeholder="Ask a legal question or say hello…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
            aria-label="Type your message"
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            title="Send message"
            aria-label="Send message"
            id="send-btn"
          >
            <FiSend size={18} />
          </button>
        </div>
        <p className={styles.inputHint}>
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
