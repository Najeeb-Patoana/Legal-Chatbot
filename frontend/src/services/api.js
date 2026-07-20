import axios from 'axios'

// All requests go through the Vite dev proxy → /api/* → backend
// No external URLs, no API keys, no direct backend references
const api = axios.create({
  timeout: 120_000,
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
    return 'The request timed out. Please try again.'
  }
  // Fallback — deliberately vague
  return 'Something went wrong. Please try again.'
}

/**
 * Ask a legal question or send a casual message.
 * Routed through the server's intent detection.
 *
 * @param {string} question
 * @returns {Promise<string>} AI-generated answer
 */
export async function askLegalQuestion(question) {
  try {
    const response = await api.post(
      '/api/legal/ask',
      { question },
      { headers: { 'Content-Type': 'application/json' } }
    )
    return response.data.answer
  } catch (err) {
    throw new Error(parseApiError(err))
  }
}

export default api
