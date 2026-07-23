const jwt = require("jsonwebtoken");

/**
 * Middleware: verify Bearer JWT.
 * Attaches req.user = { userId, email, name } on success.
 */
function requireAuth(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { userId: payload.userId, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
}

module.exports = { requireAuth };
