import { useState, useRef, useCallback } from 'react'
import {
  FiUploadCloud, FiFile, FiX, FiSend,
  FiAlertCircle, FiCheckCircle, FiZap,
  FiLayers, FiRefreshCw
} from 'react-icons/fi'
import Button from './Button.jsx'
import Loader from './Loader.jsx'
import ResponseCard from './ResponseCard.jsx'
import { uploadPDF, askQuestion } from '../services/api.js'
import styles from './AnalyzeCard.module.css'

/**
 * AnalyzeCard — two-phase RAG workflow:
 *
 * Phase 1 — Upload:
 *   User selects PDF → clicks "Upload & Index" → backend parses + embeds ONCE
 *   → documentId stored in state
 *
 * Phase 2 — Ask (unlimited):
 *   User types question → clicks "Ask" → only the question is embedded
 *   → no re-upload, no re-processing
 */
export default function AnalyzeCard() {
  // ── Upload phase ────────────────────────────────────────────────────────────
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null) // { documentId, chunkCount, fileName }
  const [uploadError, setUploadError] = useState(null)
  const inputRef = useRef(null)

  // ── Ask phase ───────────────────────────────────────────────────────────────
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [response, setResponse] = useState(null)
  const [timestamp, setTimestamp] = useState(null)
  const [askError, setAskError] = useState(null)

  // ── File helpers ────────────────────────────────────────────────────────────
  const selectFile = useCallback((selected) => {
    if (!selected) return
    if (selected.type !== 'application/pdf') {
      setUploadError('Only PDF files are allowed.')
      return
    }
    setFile(selected)
    setUploadError(null)
  }, [])

  const removeFile = () => {
    setFile(null)
    setUploadError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const resetDocument = () => {
    setUploadResult(null)
    setFile(null)
    setQuestion('')
    setResponse(null)
    setTimestamp(null)
    setAskError(null)
    setUploadError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    selectFile(e.dataTransfer.files[0])
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }


  // ── Phase 1: Upload ─────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!file) { setUploadError('Please select a PDF file first.'); return }

    setUploading(true)
    setUploadError(null)

    try {
      const data = await uploadPDF(file)
      setUploadResult({
        documentId: data.documentId,
        chunkCount: data.chunkCount,
        fileName: file.name,
      })
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // ── Phase 2: Ask ────────────────────────────────────────────────────────────
  const handleAsk = async () => {
    if (!question.trim()) { setAskError('Question cannot be empty.'); return }

    setAsking(true)
    setAskError(null)
    setResponse(null)

    try {
      const answer = await askQuestion(uploadResult.documentId, question.trim())
      setResponse(answer)
      setTimestamp(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setAskError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setAsking(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.ctrlKey && e.key === 'Enter') handleAsk()
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // PHASE 2 — document is indexed, user can ask questions
  if (uploadResult) {
    return (
      <div className={`${styles.card} animate-fade-in`}>

        {/* Indexed document banner */}
        <div className={styles.indexedBanner}>
          <div className={styles.indexedLeft}>
            <div className={styles.indexedIcon}>
              <FiLayers size={16} />
            </div>
            <div>
              <p className={styles.indexedTitle}>{uploadResult.fileName}</p>
              <p className={styles.indexedMeta}>
                {uploadResult.chunkCount} chunks indexed · ready for questions
              </p>
            </div>
          </div>
          <button
            className={styles.changeDocBtn}
            onClick={resetDocument}
            title="Upload a different document"
          >
            <FiRefreshCw size={13} />
            Change
          </button>
        </div>

        {/* Divider */}
        <div className={styles.divider} />

        {/* Question */}
        <div className={styles.section}>
          <label htmlFor="question-textarea" className={styles.sectionLabel}>
            <FiZap size={14} /> Your Question
          </label>
          <textarea
            id="question-textarea"
            className={styles.textarea}
            placeholder="Ask anything about your uploaded PDF… (Ctrl+Enter to submit)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={5}
            disabled={asking}
          />
        </div>

        {/* Ask error */}
        {askError && (
          <div className={`${styles.notification} ${styles.error} animate-fade-in`} role="alert">
            <FiAlertCircle size={15} />
            <span>{askError}</span>
          </div>
        )}

        {/* Loader or button */}
        {asking ? (
          <Loader message="Searching document and generating answer…" />
        ) : (
          <Button
            id="ask-btn"
            variant="primary"
            size="lg"
            onClick={handleAsk}
            disabled={!question.trim()}
            style={{ width: '100%' }}
          >
            <FiSend size={16} />
            Ask Question
          </Button>
        )}

        {/* Response */}
        {response && <ResponseCard response={response} timestamp={timestamp} />}
      </div>
    )
  }

  // PHASE 1 — no document yet, show upload UI
  return (
    <div className={`${styles.card} animate-fade-in`}>

      {/* Header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <FiUploadCloud size={18} />
        </div>
        <div>
          <h2 className={styles.cardTitle}>Upload Document</h2>
          <p className={styles.cardSubtitle}>Index your PDF once, ask unlimited questions</p>
        </div>
      </div>

      {/* Drop zone */}
      {!file ? (
        <div
          className={[styles.dropzone, isDragging ? styles.dragging : ''].filter(Boolean).join(' ')}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          aria-label="Drop PDF here or click to browse"
        >
          <input
            ref={inputRef}
            id="pdf-file-input"
            type="file"
            accept=".pdf,application/pdf"
            className={styles.hiddenInput}
            onChange={(e) => selectFile(e.target.files[0])}
          />
          <div className={styles.dropIcon}>
            <FiUploadCloud size={28} />
          </div>
          <p className={styles.dropTitle}>Drag &amp; drop your PDF here</p>
          <p className={styles.dropHint}>or <span className={styles.browseLink}>click to browse</span></p>
          <p className={styles.dropMeta}>PDF format only</p>
        </div>
      ) : (
        <div className={styles.filePreview}>
          <div className={styles.fileIconWrap}>
            <FiFile size={20} />
          </div>
          <div className={styles.fileInfo}>
            <p className={styles.fileName}>{file.name}</p>
            <p className={styles.fileSize}>{formatSize(file.size)}</p>
          </div>
          <button
            className={styles.removeBtn}
            onClick={removeFile}
            aria-label="Remove file"
            title="Remove"
          >
            <FiX size={15} />
          </button>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className={`${styles.notification} ${styles.error} animate-fade-in`} role="alert">
          <FiAlertCircle size={15} />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Workflow hint */}
      <div className={styles.hint}>
        <FiCheckCircle size={13} className={styles.hintIcon} />
        <span>Your PDF will be parsed and indexed. You can then ask as many questions as you want — the document is never re-uploaded.</span>
      </div>

      {/* Upload loader or button */}
      {uploading ? (
        <Loader message="Parsing PDF, generating embeddings… this may take a moment." />
      ) : (
        <Button
          id="upload-btn"
          variant="primary"
          size="lg"
          onClick={handleUpload}
          disabled={!file}
          style={{ width: '100%' }}
        >
          <FiUploadCloud size={17} />
          Upload &amp; Index Document
        </Button>
      )}
    </div>
  )
}
