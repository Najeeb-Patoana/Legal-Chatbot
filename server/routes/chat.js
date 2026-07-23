const express        = require("express");
const { pool }       = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// All chat routes require a valid JWT
router.use(requireAuth);

// ── GET /api/chat/sessions ────────────────────────────────────────────────────
router.get("/sessions", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT session_id, title, created_at FROM vl_chat_sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.userId]
    );
    return res.json({ success: true, sessions: result.rows });
  } catch (err) {
    console.error("[Chat] list sessions error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to load sessions." });
  }
});

// ── POST /api/chat/sessions ───────────────────────────────────────────────────
router.post("/sessions", async (req, res) => {
  try {
    const { title = "New Chat" } = req.body;
    const result = await pool.query(
      "INSERT INTO vl_chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *",
      [req.user.userId, title.slice(0, 255)]
    );
    return res.status(201).json({ success: true, session: result.rows[0] });
  } catch (err) {
    console.error("[Chat] create session error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to create session." });
  }
});

// ── PATCH /api/chat/sessions/:id/title ───────────────────────────────────────
router.patch("/sessions/:id/title", async (req, res) => {
  try {
    const { id }    = req.params;
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required." });

    await pool.query(
      "UPDATE vl_chat_sessions SET title = $1 WHERE session_id = $2 AND user_id = $3",
      [title.slice(0, 255), id, req.user.userId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("[Chat] rename session error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to rename session." });
  }
});

// ── DELETE /api/chat/sessions/:id ────────────────────────────────────────────
router.delete("/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      "DELETE FROM vl_chat_sessions WHERE session_id = $1 AND user_id = $2",
      [id, req.user.userId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("[Chat] delete session error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to delete session." });
  }
});

// ── GET /api/chat/sessions/:id/messages ──────────────────────────────────────
router.get("/sessions/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;

    const sess = await pool.query(
      "SELECT session_id FROM vl_chat_sessions WHERE session_id = $1 AND user_id = $2",
      [id, req.user.userId]
    );
    if (!sess.rows.length) {
      return res.status(404).json({ success: false, message: "Session not found." });
    }

    const result = await pool.query(
      "SELECT message_id, role, content, created_at FROM vl_messages WHERE session_id = $1 ORDER BY created_at ASC",
      [id]
    );
    return res.json({ success: true, messages: result.rows });
  } catch (err) {
    console.error("[Chat] get messages error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to load messages." });
  }
});

// ── POST /api/chat/sessions/:id/messages ─────────────────────────────────────
router.post("/sessions/:id/messages", async (req, res) => {
  try {
    const { id }            = req.params;
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({ success: false, message: "Role and content are required." });
    }

    const sess = await pool.query(
      "SELECT session_id FROM vl_chat_sessions WHERE session_id = $1 AND user_id = $2",
      [id, req.user.userId]
    );
    if (!sess.rows.length) {
      return res.status(404).json({ success: false, message: "Session not found." });
    }

    const result = await pool.query(
      "INSERT INTO vl_messages (session_id, role, content) VALUES ($1, $2, $3) RETURNING *",
      [id, role, content]
    );
    return res.status(201).json({ success: true, message: result.rows[0] });
  } catch (err) {
    console.error("[Chat] save message error:", err.message);
    return res.status(500).json({ success: false, message: "Failed to save message." });
  }
});

module.exports = router;
