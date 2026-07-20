# PDF Intelligence — AI-Powered Document Q&A

> A production-style **Retrieval-Augmented Generation (RAG)** application that lets you upload any PDF and ask unlimited questions about it — powered by **Google Gemini** and **Qdrant**.

**Developed by Najeeb Ullah Khan**

---

## Features

- **Upload once, ask unlimited times** — the PDF is parsed and indexed into Qdrant once; every follow-up question only costs one embedding call
- **Semantic search** — Qdrant vector similarity search retrieves the most relevant chunks from your document
- **Document-scoped results** — Qdrant payload filters ensure answers only come from your uploaded PDF, never other documents
- **Smart chunking** — paragraphs are merged into ~600-word semantic chunks for optimal retrieval quality
- **Rate-limit protection** — exponential backoff retry on Gemini 429 errors; 250 ms throttle between embedding calls
- **Production security** — Helmet headers, per-route rate limiting, file-type and size validation, zero sensitive data in logs or client responses
- **Clean professional UI** — teal/emerald design, drag-and-drop upload, copy-to-clipboard responses, responsive layout

---

## Architecture

```
User uploads PDF
      |
      v
POST /upload  -->  pdf-parse  -->  Smart Chunker  -->  Gemini Embedding (x N chunks)
                                                              |
                                                              v
                                                    Qdrant (upsert with documentId)
                                                              |
                                                              v
                                               Returns: { documentId, chunkCount }

User asks a question
      |
      v
POST /ask  -->  Gemini Embedding (x1 question only)
                      |
                      v
             Qdrant search (filtered by documentId, top 5 chunks)
                      |
                      v
             Gemini 2.5 Flash Lite  -->  Returns AI answer
```

### Embedding cost comparison

| Approach | 80-chunk PDF x 20 questions |
|---|---|
| Old (re-embed on every question) | 1,620 embedding calls |
| New (embed once, search only) | 101 embedding calls |

---

## Project Structure

```
Smart PDF ChatBot/
├── server/                      # Express backend
│   ├── index.js                 # Entry point — routes, middleware, startup
│   ├── helpers/
│   │   ├── embedding.js         # Gemini client + retry/backoff
│   │   ├── chunking.js          # Smart text chunker (~600 words/chunk)
│   │   └── qdrant.js            # Qdrant client, storeChunks, searchChunks
│   ├── uploads/                 # Temp PDF storage (auto-deleted after parse)
│   └── package.json
│
└── frontend/                    # React + Vite frontend
    ├── src/
    │   ├── components/
    │   │   ├── AnalyzeCard.jsx  # Two-phase upload + ask UI
    │   │   ├── ResponseCard.jsx # AI answer display with copy button
    │   │   ├── Navbar.jsx
    │   │   ├── Footer.jsx
    │   │   ├── Button.jsx
    │   │   ├── Loader.jsx
    │   │   └── Textarea.jsx
    │   ├── pages/
    │   │   └── Home.jsx
    │   ├── services/
    │   │   └── api.js           # Axios client — uploadPDF() + askQuestion()
    │   └── styles/
    │       └── global.css       # Design tokens, animations
    └── package.json
```

---

## Getting Started

### Prerequisites

| Tool | Notes |
|---|---|
| Node.js v18+ | https://nodejs.org |
| npm v9+ | Comes with Node.js |
| Qdrant Cloud account | https://qdrant.tech |
| Google Gemini API key | https://ai.google.dev |

---

### 1. Clone the repository

```bash
git clone https://github.com/Najeeb-Patoana/Smart-PDF-ChatBot.git
cd Smart-PDF-ChatBot
```

---

### 2. Create a `.env` file in the `server/` directory (use `.env.example` as the template):

```bash
cp server/.env.example server/.env
```

```env
GEMINI_API_KEY=your_gemini_api_key_here
QDRANT_URL=https://your-cluster-id.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key_here

# Server port (default: 3000)
PORT=3000

# Comma-separated list of allowed frontend URLs
# Add your production frontend URL here when deploying
CORS_ORIGIN=http://localhost:5173
```

> **Important:** Never commit `.env` — it is already listed in `.gitignore`.  
> The `.env.example` file is safe to commit — it contains no real secrets.

Install backend dependencies:

```bash
npm install
```

---

### 3. Create the Qdrant collection

Start the server first, then open this URL **once** in your browser:

```
http://localhost:3000/create-collection
```

This creates the `pdf-docs` collection with:
- Vector size: `3072` (Gemini Embedding-2 output dimension)
- Distance metric: `Cosine`
- Keyword payload index on `documentId` (required for document-scoped filtering)

You only need to do this **once** per Qdrant account.

---

### 4. Install frontend dependencies

```bash
cd ../frontend
npm install
```

---

### 5. Run the application

**Terminal 1 — Backend:**

```bash
cd server
node index.js
```

Expected startup output:

```
[Server] Connecting to Qdrant...
[Qdrant] Collection 'pdf-docs' ready with payload index.
PDF Intelligence server  -->  http://localhost:3000
  POST /upload  -- index a PDF
  POST /ask     -- answer a question
```

**Terminal 2 — Frontend:**

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## API Reference

### POST /upload

Index a PDF document. The document is processed once and stored in Qdrant.

**Request:** `multipart/form-data`

| Field | Type | Required | Notes |
|---|---|---|---|
| `pdf` | File | Yes | PDF only, max 10 MB |

**Success response:**

```json
{
  "success": true,
  "message": "Document uploaded and indexed successfully.",
  "documentId": "fd39fa0a-f634-499f-a78f-583ec0736e43",
  "chunkCount": 42
}
```

---

### POST /ask

Ask a question about an already-indexed document. The PDF is **not** re-uploaded.

**Request:** `application/json`

```json
{
  "documentId": "fd39fa0a-f634-499f-a78f-583ec0736e43",
  "question": "What are the main topics covered in this document?"
}
```

**Success response:**

```json
{
  "success": true,
  "answer": "Based on the document, the main topics covered are..."
}
```

---

### Error responses

All endpoints return errors in the same shape:

```json
{
  "success": false,
  "message": "Human-readable description of what went wrong."
}
```

Common error messages:

| HTTP Status | Message |
|---|---|
| 400 | No PDF file provided / Question cannot be empty / Invalid documentId format |
| 413 | File is too large. Maximum size is 10 MB |
| 422 | Could not extract text from this PDF (scanned/image-based) |
| 429 | API rate limit reached. Please wait 30 seconds and try again |
| 404 | No relevant content found for that question |
| 500 | An error occurred while processing your request |

---

## Security

| Measure | Details |
|---|---|
| HTTP security headers | `helmet` middleware sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and more |
| CORS | Restricted to `http://localhost:5173` only — no public API access |
| Rate limiting | Upload endpoint: 10 requests / 10 minutes. Ask endpoint: 60 requests / minute |
| File validation | MIME type and extension checked by multer `fileFilter`; 10 MB hard cap |
| Input validation | UUID regex on `documentId`; question length enforced 3–500 characters |
| Log safety | Logs never contain API keys, full error messages, stack traces, or user data |
| Error responses | All client-facing errors use `safeErrorMessage()` — internal details never leak |
| Secret management | All API keys stored in `.env` which is gitignored |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, CSS Modules, Axios, react-icons |
| Backend | Node.js, Express 5, multer, pdf-parse |
| AI Embeddings | Google Gemini Embedding-2 (3072 dimensions) |
| LLM | Google Gemini 2.5 Flash Lite |
| Vector Database | Qdrant Cloud |
| Security | Helmet, express-rate-limit |

---

## License

MIT License — Copyright 2024 Najeeb Ullah Khan
