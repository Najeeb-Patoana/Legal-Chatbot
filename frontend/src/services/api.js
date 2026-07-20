import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 300_000, // 5 minutes max for large PDFs
})


/**
 * Parse an Axios error into a safe, user-facing message.
 * NEVER exposes: status codes, server internals, API keys, or raw JSON.
 * @param {unknown} err
 * @returns {string}
 */
function parseApiError(err) {
  // Server returned a JSON { message } — already sanitized by the server
  if (err?.response?.data?.message) {
    return err.response.data.message
  }
  // Network error (server not running)
  if (err?.code === 'ERR_NETWORK' || err?.message?.includes('Network Error')) {
    return 'Cannot reach the server. Make sure the backend is running on port 3000.'
  }
  // Request timed out
  if (err?.code === 'ECONNABORTED') {
    return 'The request timed out. Your PDF may be very large — please try again.'
  }
  // Fallback — deliberately vague
  return 'Something went wrong. Please try again.'
}

/**
 * Upload a PDF and index it in Qdrant.
 * The document is processed ONCE. Use the returned documentId for all questions.
 *
 * @param {File} pdfFile
 * @returns {Promise<{ documentId: string, chunkCount: number, message: string }>}
 */
export async function uploadPDF(pdfFile) {
  try {
    const formData = new FormData()
    formData.append('pdf', pdfFile)

    const response = await api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })

    return response.data
  } catch (err) {
    throw new Error(parseApiError(err))
  }
}

/**
 * Ask a question about an already-indexed PDF.
 * Only the question is embedded — the PDF is NOT re-processed.
 *
 * @param {string} documentId - returned by uploadPDF()
 * @param {string} question
 * @returns {Promise<string>} AI-generated answer
 */
export async function askQuestion(documentId, question) {
  try {
    const response = await api.post(
      '/ask',
      { documentId, question },
      { headers: { 'Content-Type': 'application/json' } }
    )
    return response.data.answer
  } catch (err) {
    throw new Error(parseApiError(err))
  }
}

export default api
