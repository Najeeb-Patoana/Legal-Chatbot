require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT ?? "5432", 10),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS vl_users (
    user_id       SERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    name          VARCHAR(255),
    password_hash VARCHAR(255),
    google_id     VARCHAR(255) UNIQUE,
    is_verified   BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS vl_guest_limits (
    ip            VARCHAR(45) PRIMARY KEY,
    message_count INT DEFAULT 0,
    last_request  TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS vl_email_verifications (
    id         SERIAL PRIMARY KEY,
    user_id    INT REFERENCES vl_users(user_id) ON DELETE CASCADE,
    token      VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vl_chat_sessions (
    session_id SERIAL PRIMARY KEY,
    user_id    INT REFERENCES vl_users(user_id) ON DELETE CASCADE,
    title      VARCHAR(255) DEFAULT 'New Chat',
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS vl_messages (
    message_id SERIAL PRIMARY KEY,
    session_id INT REFERENCES vl_chat_sessions(session_id) ON DELETE CASCADE,
    role       VARCHAR(50) NOT NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );
`;

async function initDB() {
  const client = await pool.connect();
  try {
    
    //  create tables if they don't yet exist
    await client.query(SCHEMA_SQL);
    console.log("[DB] Vector Law schema ready (vl_users, vl_chat_sessions, vl_messages).");
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
