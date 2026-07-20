import { useState, useRef, useCallback } from 'react'
import { FiUploadCloud, FiFile, FiX, FiCheckCircle, FiAlertCircle } from 'react-icons/fi'
import Button from './Button.jsx'
import Loader from './Loader.jsx'
import { uploadPDF } from '../services/api.js'
import styles from './UploadCard.module.css'

/**
 * UploadCard — handles PDF drag-and-drop, file selection, and upload.
 * Exposes the selected file to the parent via onFileChange so QuestionCard can reuse it.
 */
export default function UploadCard({ onFileChange }) {
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null) // { type: 'success'|'error', message: '' }
  const inputRef = useRef(null)

  const selectFile = useCallback(
    (selected) => {
      if (!selected) return
      if (selected.type !== 'application/pdf') {
        setStatus({ type: 'error', message: 'Only PDF files are allowed.' })
        return
      }
      setFile(selected)
      setStatus(null)
      onFileChange(selected)
    },
    [onFileChange]
  )

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    selectFile(dropped)
  }

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)

  const handleInputChange = (e) => selectFile(e.target.files[0])

  const removeFile = () => {
    setFile(null)
    setStatus(null)
    onFileChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleUpload = async () => {
    if (!file) {
      setStatus({ type: 'error', message: 'Please select a PDF first.' })
      return
    }
    setLoading(true)
    setStatus(null)
    try {
      await uploadPDF(file)
      setStatus({
        type: 'success',
        message: 'Document uploaded successfully! Ready for questions.',
      })
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        (err.code === 'ECONNREFUSED' ? 'Server unavailable. Is it running on port 3000?' : 'Upload failed. Please try again.')
      setStatus({ type: 'error', message: msg })
    } finally {
      setLoading(false)
    }
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <section className={`${styles.card} animate-fade-in`} id="upload" aria-label="Upload Document">
      {/* Card Header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon}>
          <FiUploadCloud size={18} />
        </div>
        <div>
          <h2 className={styles.cardTitle}>Upload Document</h2>
          <p className={styles.cardSubtitle}>PDF files up to any size</p>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        className={[
          styles.dropzone,
          isDragging ? styles.dragging : '',
          file ? styles.hasFile : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => !file && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop PDF here or click to browse"
        onKeyDown={(e) => e.key === 'Enter' && !file && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className={styles.hiddenInput}
          onChange={handleInputChange}
          id="pdf-upload-input"
        />

        {!file ? (
          <div className={styles.dropContent}>
            <div className={styles.dropIcon}>
              <FiUploadCloud size={32} />
            </div>
            <p className={styles.dropTitle}>Drag &amp; drop your PDF here</p>
            <p className={styles.dropHint}>or <span className={styles.browseLink}>click to browse</span></p>
            <p className={styles.dropMeta}>PDF format only</p>
          </div>
        ) : (
          <div className={styles.filePreview}>
            <div className={styles.fileIcon}>
              <FiFile size={22} />
            </div>
            <div className={styles.fileInfo}>
              <p className={styles.fileName}>{file.name}</p>
              <p className={styles.fileSize}>{formatSize(file.size)}</p>
            </div>
            <button
              className={styles.removeBtn}
              onClick={(e) => { e.stopPropagation(); removeFile() }}
              aria-label="Remove file"
              title="Remove file"
            >
              <FiX size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Status notification */}
      {status && (
        <div className={`${styles.notification} ${styles[status.type]} animate-fade-in`} role="alert">
          {status.type === 'success' ? <FiCheckCircle size={16} /> : <FiAlertCircle size={16} />}
          <span>{status.message}</span>
        </div>
      )}

      {/* Upload button */}
      {loading ? (
        <Loader message="Uploading & indexing your PDF…" />
      ) : (
        <Button
          variant="primary"
          size="lg"
          onClick={handleUpload}
          disabled={!file}
          style={{ width: '100%', marginTop: 'var(--space-md)' }}
          id="upload-btn"
        >
          <FiUploadCloud size={17} />
          Upload PDF
        </Button>
      )}
    </section>
  )
}
