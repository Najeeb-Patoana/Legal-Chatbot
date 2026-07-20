import styles from './Textarea.module.css'

/**
 * Reusable Textarea component.
 */
export default function Textarea({
  label,
  id,
  error,
  className = '',
  rows = 5,
  ...rest
}) {
  return (
    <div className={styles.wrapper}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
      <textarea
        id={id}
        rows={rows}
        className={[styles.textarea, error ? styles.hasError : '', className]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {error && <p className={styles.errorText}>{error}</p>}
    </div>
  )
}
