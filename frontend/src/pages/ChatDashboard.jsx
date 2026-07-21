import { useState, useRef, useEffect, useCallback } from 'react'
import { FiSend, FiAlertTriangle, FiShield, FiUser, FiCopy, FiCheck, FiBookOpen, FiBookmark, FiHelpCircle } from 'react-icons/fi'
import { askLegalQuestion } from '../services/api.js'
import styles from './ChatDashboard.module.css'

export default function ChatDashboard() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [copiedId, setCopiedId] = useState(null)
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Focus input on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }, [])

  useEffect(() => {
    adjustTextareaHeight()
  }, [input, adjustTextareaHeight])

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
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const answer = await askLegalQuestion(trimmed)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: answer,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text: err.message || 'Something went wrong. Please try again.',
          isError: true,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const useSuggestion = (text) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  // ── Render Helpers ──────────────────────────────────────────────────────────

  const renderText = (text) => {
    const paragraphs = text.split(/\n{2,}/)
    return paragraphs.map((para, pi) => {
      const lines = para.split('\n')
      return (
        <p key={pi} className={styles.paragraph}>
          {lines.map((line, li) => (
            <span key={li}>
              {li > 0 && <br />}
              {formatInline(line)}
            </span>
          ))}
        </p>
      )
    })
  }

  const formatInline = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i}>{part.slice(2, -2)}</strong>
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} className={styles.code}>{part.slice(1, -1)}</code>
      return part
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const suggestions = [
    { icon: <FiBookmark size={16} />, text: 'What does 17 USC § 107 say about fair use?' },
    { icon: <FiBookOpen size={16} />, text: 'Explain the Fourth Amendment protections against unreasonable searches' },
    { icon: <FiHelpCircle size={16} />, text: 'What is the legal standard for summary judgment in federal court?' },
  ]

  return (
    <div className={styles.container}>
          {/* ── Messages ── */}
      <div className={styles.messages} id="chat-messages-area">
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyLogo}>
              <div className={styles.emptyLogoInner}>
                <FiShield size={32} />
              </div>
            </div>
            <h1 className={styles.emptyTitle}>US Legal Knowledge Base</h1>
            <p className={styles.emptySubtitle}>
              Ask about federal statutes, case law, or legal concepts.
              Responses are grounded in indexed legal documents with inline citations.
            </p>

            <div className={styles.cards}>
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className={styles.card}
                  onClick={() => useSuggestion(s.text)}
                  id={`suggestion-${i}`}
                >
                  <span className={styles.cardIcon}>{s.icon}</span>
                  <span className={styles.cardText}>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.thread}>
            {messages.map((msg) => (
              <div key={msg.id} className={`${styles.row} ${styles[msg.role]}`} id={`message-${msg.id}`}>
                {/* Avatar */}
                <div className={`${styles.avatar} ${styles[`av_${msg.role}`]}`}>
                  {msg.role === 'user' ? <FiUser size={15} /> : <FiShield size={15} />}
                </div>

                {/* Content */}
                <div className={styles.content}>
                  <div className={styles.meta}>
                    <span className={styles.roleName}>
                      {msg.role === 'user' ? 'You' : 'Legal Assistant'}
                    </span>
                    <span className={styles.time}>{msg.time}</span>
                  </div>

                  <div className={`${styles.bubble} ${msg.isError ? styles.error : ''}`}>
                    {renderText(msg.text)}
                  </div>

                  {msg.role === 'assistant' && !msg.isError && (
                    <button
                      className={styles.copyBtn}
                      onClick={() => handleCopy(msg.text, msg.id)}
                      aria-label="Copy response"
                    >
                      {copiedId === msg.id
                        ? <><FiCheck size={13} /> Copied</>
                        : <><FiCopy size={13} /> Copy</>
                      }
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className={`${styles.row} ${styles.assistant}`}>
                <div className={`${styles.avatar} ${styles.av_assistant}`}>
                  <FiShield size={15} />
                </div>
                <div className={styles.content}>
                  <div className={styles.meta}>
                    <span className={styles.roleName}>Legal Assistant</span>
                  </div>
                  <div className={styles.bubble}>
                    <div className={styles.dots}>
                      <span /><span /><span />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <div className={styles.inputArea}>
        <div className={styles.inputWrap}>
          <textarea
            ref={textareaRef}
            id="chat-input"
            className={styles.textarea}
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
            title="Send message (Enter)"
            aria-label="Send message"
            id="send-btn"
          >
            <FiSend size={17} />
          </button>
        </div>
        <p className={styles.hint}>
          Enter to send · Shift+Enter for new line · Responses cite indexed federal sources
        </p>
      </div>
    </div>
  )
}
