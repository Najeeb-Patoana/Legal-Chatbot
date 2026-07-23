require("dotenv").config();
const express    = require("express");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const crypto     = require("crypto");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const { pool }   = require("../db");

const router       = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── SMTP transporter ──────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT ?? "587", 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── Token helpers ─────────────────────────────────────────────────────────────
function signAccess(user) {
  return jwt.sign(
    { userId: user.user_id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

function signRefresh(user) {
  return jwt.sign(
    { userId: user.user_id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "30d" }
  );
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const existing = await pool.query("SELECT user_id FROM vl_users WHERE email = $1", [email]);
    if (existing.rows.length) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO vl_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *",
      [email.toLowerCase().trim(), name.trim(), hash]
    );
    const user = result.rows[0];

    // Create verification token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await pool.query(
      "INSERT INTO vl_email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.user_id, token, expires]
    );

    // Send verification email
    const verifyUrl = `${process.env.BACKEND_URL || "http://localhost:3000"}/api/auth/verify-email?token=${token}`;
    await transporter.sendMail({
      from:    process.env.MAIL_FROM,
      to:      user.email,
      subject: "Verify your Vector Law account",
      html: `
        <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
          <div style="text-align:center;margin-bottom:24px;">
            <h1 style="margin:0;font-size:1.5rem;color:#f1f5f9;">Verify Your Email</h1>
          </div>
          <p style="color:#94a3b8;margin-bottom:24px;">Hi <strong style="color:#e2e8f0;">${user.name}</strong>, thanks for joining <strong style="color:#2dd4bf;">Vector Law</strong>. Please verify your email to get started.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${verifyUrl}" style="background:linear-gradient(135deg,#0f766e,#0d9488);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
              Verify Email Address
            </a>
          </div>
          <p style="color:#64748b;font-size:0.8rem;text-align:center;">Link expires in 24 hours. If you didn't create an account, ignore this email.</p>
        </div>
      `,
    });

    return res.status(201).json({
      success: true,
      message: "Account created. Please check your email to verify your account.",
    });
  } catch (err) {
    console.error("[Auth] register error:", err.message);
    return res.status(500).json({ success: false, message: "Registration failed. Please try again." });
  }
});

// ── GET /api/auth/verify-email ────────────────────────────────────────────────
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("<h2>Invalid verification link.</h2>");

    const result = await pool.query(
      "SELECT * FROM vl_email_verifications WHERE token = $1 AND expires_at > NOW()",
      [token]
    );
    if (!result.rows.length) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:#e2e8f0;">
          <h2>Link expired or invalid.</h2>
          <p>Please register again or request a new verification email.</p>
        </body></html>
      `);
    }

    const { user_id } = result.rows[0];
    await pool.query("UPDATE vl_users SET is_verified = TRUE WHERE user_id = $1", [user_id]);
    await pool.query("DELETE FROM vl_email_verifications WHERE user_id = $1", [user_id]);

    return res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f172a;color:#e2e8f0;">
        <div style="max-width:480px;margin:0 auto;">
          <h2 style="color:#4ade80;">Email Verified!</h2>
          <p style="color:#94a3b8;">Your account is now active. You can close this tab and log in.</p>
          <a href="${process.env.FRONTEND_URL || "http://localhost:5173"}/login"
             style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
            Go to Login
          </a>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error("[Auth] verify-email error:", err.message);
    return res.status(500).send("<h2>Server error. Please try again.</h2>");
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const result = await pool.query("SELECT * FROM vl_users WHERE email = $1", [email.toLowerCase().trim()]);
    const user   = result.rows[0];

    if (!user || !user.password_hash) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    if (!user.is_verified) {
      return res.status(403).json({ success: false, message: "Please verify your email before logging in.", needsVerification: true });
    }

    return res.json({
      success:      true,
      accessToken:  signAccess(user),
      refreshToken: signRefresh(user),
      user: { userId: user.user_id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error("[Auth] login error:", err.message);
    return res.status(500).json({ success: false, message: "Login failed. Please try again." });
  }
});

// ── POST /api/auth/google ─────────────────────────────────────────────────────
router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: "Google credential is required." });
    }

    const ticket  = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, email_verified } = payload;

    if (!email_verified) {
      return res.status(400).json({ success: false, message: "Google account email is not verified." });
    }

    // Upsert user
    let userRow;
    const existing = await pool.query("SELECT * FROM vl_users WHERE google_id = $1 OR email = $2", [googleId, email]);
    if (existing.rows.length) {
      userRow = existing.rows[0];
      if (!userRow.google_id) {
        await pool.query("UPDATE vl_users SET google_id = $1, is_verified = TRUE WHERE user_id = $2", [googleId, userRow.user_id]);
        userRow.google_id   = googleId;
        userRow.is_verified = true;
      }
    } else {
      const insert = await pool.query(
        "INSERT INTO vl_users (email, name, google_id, is_verified) VALUES ($1, $2, $3, TRUE) RETURNING *",
        [email.toLowerCase(), name, googleId]
      );
      userRow = insert.rows[0];
    }

    return res.json({
      success:      true,
      accessToken:  signAccess(userRow),
      refreshToken: signRefresh(userRow),
      user: { userId: userRow.user_id, email: userRow.email, name: userRow.name },
    });
  } catch (err) {
    console.error("[Auth] google error:", err.message);
    return res.status(500).json({ success: false, message: "Google authentication failed." });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Refresh token required." });
    }

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const result  = await pool.query("SELECT * FROM vl_users WHERE user_id = $1", [payload.userId]);
    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: "User not found." });
    }
    const user = result.rows[0];

    return res.json({
      success:     true,
      accessToken: signAccess(user),
      user: { userId: user.user_id, email: user.email, name: user.name },
    });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired refresh token." });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/logout", (_req, res) => {
  return res.json({ success: true, message: "Logged out." });
});

module.exports = router;
