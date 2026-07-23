import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FiSend, FiShield, FiCopy, FiCheck,
  FiBookmark, FiBookOpen, FiHelpCircle,
  FiPlus, FiMessageSquare, FiTrash2, FiLogOut, FiMenu, FiX,
  FiLock, FiLogIn
} from 'react-icons/fi'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { askLegalQuestion, getGuestStatus } from '../services/api.js'
import * as chatApi from '../services/authApi.js'
import styles from './ChatDashboard.module.css'
import sidebarStyles from '../styles/Sidebar.module.css'

const FREE_LIMIT = 4
const GUEST_COUNT_KEY = 'vl_guestMsgCount'

export default function ChatDashboard() {
  const { user, accessToken, logout } = useAuth()

  // ── Chat state ─────────────────────────────────────────────────────────────
  const [sessions, setSessions]           = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [messages, setMessages]           = useState([])
  const [input, setInput]                 = useState('')
  const [isLoading, setIsLoading]         = useState(false)
  const [copiedId, setCopiedId]           = useState(null)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen]     = useState(true)
  const [showLimitModal, setShowLimitModal] = useState(false)

  // Guest message count — persisted in localStorage
  const [guestCount, setGuestCount] = useState(() => {
    if (typeof window === 'undefined') return 0
    return parseInt(localStorage.getItem(GUEST_COUNT_KEY) || '0', 10)
  })

  const messagesEndRef = useRef(null)
  const textareaRef    = useRef(null)

  // ── Load guest status ──────────────────────────────────────────────────────
  useEffect(() => {
    if (user) return
    getGuestStatus()
      .then((data) => {
        if (data && typeof data.usage === 'number') {
          setGuestCount(data.usage)
          localStorage.setItem(GUEST_COUNT_KEY, String(data.usage))
        }
      })
      .catch(console.error)
  }, [user])

  // ── Load sessions (authenticated only) ────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return
    setSessionsLoading(true)
    chatApi.getSessions(accessToken)
      .then((data) => { if (data.success) setSessions(data.sessions) })
      .catch(console.error)
      .finally(() => setSessionsLoading(false))
  }, [accessToken])

  // ── Load messages when session changes ─────────────────────────────────────
  useEffect(() => {
    if (!activeSession || !accessToken) { setMessages([]); return }
    chatApi.getMessages(accessToken, activeSession.session_id)
      .then((data) => {
        if (data.success) {
          setMessages(data.messages.map((m) => ({
            id:   m.message_id,
            role: m.role,
            text: m.content,
            time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })))
        }
      })
      .catch(console.error)
  }, [activeSession, accessToken])

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => { textareaRef.current?.focus() }, [activeSession])

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }, [])
  useEffect(() => { adjustTextareaHeight() }, [input, adjustTextareaHeight])

  // ── Copy ───────────────────────────────────────────────────────────────────
  const handleCopy = useCallback((text, id) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  // ── New chat ───────────────────────────────────────────────────────────────
  const handleNewChat = () => {
    setActiveSession(null)
    setMessages([])
    textareaRef.current?.focus()
  }

  // ── Select session ─────────────────────────────────────────────────────────
  const handleSelectSession = (session) => {
    if (activeSession?.session_id === session.session_id) return
    setActiveSession(session)
    setMessages([])
  }

  // ── Delete session ─────────────────────────────────────────────────────────
  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation()
    try {
      await chatApi.deleteSession(accessToken, sessionId)
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId))
      if (activeSession?.session_id === sessionId) {
        setActiveSession(null)
        setMessages([])
      }
    } catch (err) {
      console.error('Delete session error:', err)
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    // Guest limit check
    if (!user) {
      if (guestCount >= FREE_LIMIT) {
        setShowLimitModal(true)
        return
      }
    }

    let currentSession = activeSession

    // Authenticated: create session if needed
    if (user && accessToken && !currentSession) {
      try {
        const title = trimmed.slice(0, 50)
        const data  = await chatApi.createSession(accessToken, title)
        if (data.success) {
          currentSession = data.session
          setActiveSession(data.session)
          setSessions((prev) => [data.session, ...prev])
        }
      } catch (err) {
        console.error('Create session error:', err)
      }
    }

    const userMessage = {
      id:   Date.now(),
      role: 'user',
      text: trimmed,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Save user message to DB (authenticated only)
    if (currentSession && accessToken) {
      chatApi.saveMessage(accessToken, currentSession.session_id, 'user', trimmed).catch(console.error)
    }

    try {
      const resData = await askLegalQuestion(trimmed, { token: accessToken || undefined })
      
      if (!user && resData.guestUsage !== undefined) {
        setGuestCount(resData.guestUsage)
        localStorage.setItem(GUEST_COUNT_KEY, String(resData.guestUsage))
      }
      
      const answer = resData.answer
      const assistantMsg = {
        id:   Date.now() + 1,
        role: 'assistant',
        text: answer,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, assistantMsg])

      // Save assistant message (authenticated only)
      if (currentSession && accessToken) {
        chatApi.saveMessage(accessToken, currentSession.session_id, 'assistant', answer).catch(console.error)
      }

      // Auto-title session on first message
      if (currentSession && currentSession.title === 'New Chat' && accessToken) {
        const newTitle = trimmed.slice(0, 45)
        chatApi.renameSession(accessToken, currentSession.session_id, newTitle).catch(console.error)
        setSessions((prev) => prev.map((s) =>
          s.session_id === currentSession.session_id ? { ...s, title: newTitle } : s
        ))
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id:      Date.now() + 1,
          role:    'assistant',
          text:    err.message || 'Something went wrong. Please try again.',
          isError: true,
          time:    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ])
    } finally {
      setIsLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const useSuggestion = (text) => {
    setInput(text)
    textareaRef.current?.focus()
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
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

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const remainingFree = Math.max(0, FREE_LIMIT - guestCount)

  const suggestions = [
    { icon: <FiBookmark size={16} />, text: 'What does 17 USC § 107 say about fair use?' },
    { icon: <FiBookOpen size={16} />, text: 'Explain the Fourth Amendment protections against unreasonable searches' },
    { icon: <FiHelpCircle size={16} />, text: 'What is the legal standard for summary judgment in federal court?' },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.layout}>

      {/* ── Sidebar — only for authenticated users ── */}
      {user && (
        <aside className={`${sidebarStyles.sidebar} ${!sidebarOpen ? sidebarStyles.sidebarHidden : ''}`}>
          <div className={sidebarStyles.sidebarTop}>
            <button className={sidebarStyles.newChatBtn} onClick={handleNewChat} id="new-chat-btn">
              <FiPlus size={16} />
              New Chat
            </button>
          </div>

          <span className={sidebarStyles.sectionLabel}>History</span>
          <div className={sidebarStyles.sessionList}>
            {sessionsLoading ? (
              <div className={sidebarStyles.noSessions}>Loading…</div>
            ) : sessions.length === 0 ? (
              <div className={sidebarStyles.noSessions}>
                No chats yet.<br />Start a new conversation.
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.session_id}
                  className={`${sidebarStyles.sessionItem} ${activeSession?.session_id === session.session_id ? sidebarStyles.active : ''}`}
                  onClick={() => handleSelectSession(session)}
                  id={`session-${session.session_id}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleSelectSession(session)}
                >
                  <FiMessageSquare size={13} className={sidebarStyles.sessionIcon} />
                  <span className={sidebarStyles.sessionTitle} title={session.title}>
                    {session.title}
                  </span>
                  <button
                    className={sidebarStyles.deleteBtn}
                    onClick={(e) => handleDeleteSession(e, session.session_id)}
                    aria-label={`Delete ${session.title}`}
                  >
                    <FiTrash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className={sidebarStyles.sidebarFooter}>
            <div className={sidebarStyles.userInfo}>
              <div className={sidebarStyles.userAvatar}>{initials}</div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div className={sidebarStyles.userName}>{user?.name || 'User'}</div>
                <div className={sidebarStyles.userEmail}>{user?.email}</div>
              </div>
            </div>
            <button className={sidebarStyles.logoutBtn} onClick={logout} id="logout-btn">
              <FiLogOut size={13} />
              Sign out
            </button>
          </div>
        </aside>
      )}

      {/* ── Main Chat Area ── */}
      <div className={styles.container}>

        {/* Mobile sidebar toggle (auth only) */}
        {user && (
          <button
            className={styles.sidebarToggle}
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            id="sidebar-toggle"
          >
            {sidebarOpen ? <FiX size={18} /> : <FiMenu size={18} />}
          </button>
        )}

        {/* ── Guest free-tier banner ── */}
        {!user && guestCount > 0 && guestCount < FREE_LIMIT && (
          <div className={styles.guestBanner}>
            <FiLock size={13} />
            <span>
              {remainingFree} free {remainingFree === 1 ? 'message' : 'messages'} remaining ·{' '}
              <Link to="/login" className={styles.guestBannerLink}>Sign in</Link> for unlimited access & history
            </span>
          </div>
        )}

        {/* Messages */}
        <div className={styles.messages} id="chat-messages-area">
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyLogo}>
                <div className={styles.emptyLogoInner}>
                  <FiShield size={32} />
                </div>
              </div>
              <h1 className={styles.emptyTitle}>
                {user ? `Hello, ${user.name.split(' ')[0]}!` : 'Vector Law'}
              </h1>
              <p className={styles.emptySubtitle}>
                Ask about federal statutes, case law, or legal concepts.
                Responses are grounded in indexed legal documents with inline citations.
              </p>

              {/* Guest CTA */}
              {!user && (
                <div className={styles.guestCta}>
                  <Link to="/login" className={styles.guestCtaBtn} id="guest-login-cta">
                    <FiLogIn size={15} />
                    Sign in for unlimited access
                  </Link>
                  <span className={styles.guestCtaOr}>or try {FREE_LIMIT} free messages below</span>
                </div>
              )}

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
                  <div className={`${styles.avatar} ${styles[`av_${msg.role}`]}`}>
                    {msg.role === 'user'
                      ? <span style={{ fontSize: '0.65rem', fontWeight: 700 }}>
                          {user ? initials : 'G'}
                        </span>
                      : <FiShield size={15} />
                    }
                  </div>

                  <div className={styles.content}>
                    <div className={styles.meta}>
                      <span className={styles.roleName}>
                        {msg.role === 'user'
                          ? (user?.name?.split(' ')[0] || 'Guest')
                          : 'Vector Law AI'}
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

              {/* Animated typing indicator */}
              {isLoading && (
                <div className={`${styles.row} ${styles.assistant}`}>
                  <div className={`${styles.avatar} ${styles.av_assistant}`}>
                    <FiShield size={15} />
                  </div>
                  <div className={styles.content}>
                    <div className={styles.meta}>
                      <span className={styles.roleName}>Vector Law AI</span>
                    </div>
                    <div className={styles.bubble}>
                      <div className={styles.typingBubble}>
                        <span className={styles.dot} />
                        <span className={styles.dot} />
                        <span className={styles.dot} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className={styles.inputArea}>
          <div className={styles.inputWrap}>
            <textarea
              ref={textareaRef}
              id="chat-input"
              className={styles.textarea}
              placeholder={
                !user && guestCount >= FREE_LIMIT
                  ? 'Sign in to continue chatting…'
                  : 'Ask a legal question…'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading || (!user && guestCount >= FREE_LIMIT)}
              aria-label="Type your message"
            />
            <button
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!input.trim() || isLoading || (!user && guestCount >= FREE_LIMIT)}
              title="Send message (Enter)"
              aria-label="Send message"
              id="send-btn"
            >
              <FiSend size={17} />
            </button>
          </div>
          <p className={styles.hint}>
            {!user
              ? `${remainingFree} of ${FREE_LIMIT} free messages · Sign in for unlimited access`
              : 'Enter to send · Shift+Enter for new line · Responses cite indexed federal sources'
            }
          </p>
        </div>
      </div>

      {/* ── Limit reached modal ── */}
      {showLimitModal && (
        <div className={styles.modalOverlay} onClick={() => setShowLimitModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalIcon}>🔒</div>
            <h2 className={styles.modalTitle}>Free limit reached</h2>
            <p className={styles.modalText}>
              You've used all <strong>{FREE_LIMIT}</strong> free messages. Create a free account to get
              unlimited access, save your chat history, and pick up where you left off.
            </p>
            <div className={styles.modalActions}>
              <Link to="/register" className={styles.modalPrimary} id="modal-register-btn">
                Create free account
              </Link>
              <Link to="/login" className={styles.modalSecondary} id="modal-login-btn">
                Sign in
              </Link>
            </div>
            <button className={styles.modalClose} onClick={() => setShowLimitModal(false)}>
              Maybe later
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
