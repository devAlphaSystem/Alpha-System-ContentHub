import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import PocketBase from "pocketbase";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import sqlite3 from "sqlite3";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const requiredEnvVars = ["SESSION_SECRET", "IP_HASH_SALT", "POCKETBASE_ADMIN_EMAIL", "POCKETBASE_ADMIN_PASSWORD", "POCKETBASE_URL"];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL ERROR: ${envVar} must be defined in .env`);
    process.exit(1);
  }
}

export const SESSION_SECRET = process.env.SESSION_SECRET;
export const IP_HASH_SALT = process.env.IP_HASH_SALT;
export const POCKETBASE_ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL;
export const POCKETBASE_ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD;
export const POCKETBASE_URL = process.env.POCKETBASE_URL;
export const NODE_ENV = process.env.NODE_ENV || "development";
export const PORT = process.env.PORT || 3000;

export const ITEMS_PER_PAGE = 10;
export const PREVIEW_TOKEN_EXPIRY_HOURS = 6;
export const VIEW_TIMEFRAME_HOURS = 24;
export const AVERAGE_WPM = 225;

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const BASE_DIR = path.dirname(__dirname);

export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

export const pbAdmin = new PocketBase(POCKETBASE_URL);
pbAdmin.autoCancellation(false);

(async () => {
  try {
    await pbAdmin.collection("_superusers").authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
    console.log("PocketBase Admin client authenticated successfully.");
  } catch (adminAuthError) {
    console.error("FATAL ERROR: PocketBase Admin authentication failed:", adminAuthError);
    process.exit(1);
  }
})();

const dbDir = path.join(BASE_DIR, "db");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const SQLiteStore = connectSqlite3(session);
export const sessionStore = new SQLiteStore({
  db: "sessions.db",
  dir: dbDir,
});

const viewDbPath = path.join(dbDir, "view_tracking.db");
export const viewDb = new sqlite3.Database(viewDbPath, (err) => {
  if (err) {
    console.error("Error opening view tracking database:", err.message);
  } else {
    viewDb.run("CREATE TABLE IF NOT EXISTS view_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, ip_address TEXT NOT NULL, viewed_at INTEGER NOT NULL)", (createTableErr) => {
      if (createTableErr) {
        console.error("Error creating view_logs table:", createTableErr.message);
      } else {
        viewDb.run("CREATE INDEX IF NOT EXISTS idx_view_logs_entry_ip_time ON view_logs (entry_id, ip_address, viewed_at)", (indexErr) => {
          if (indexErr) console.error("Error creating index:", indexErr.message);
        });
      }
    });
  }
});

export const configuredHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      styleSrc: ["'self'", "https://*", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://*", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", POCKETBASE_URL, "https://*"],
      connectSrc: ["'self'", POCKETBASE_URL, "https://api.languagetool.org"],
      formAction: ["'self'"],
    },
  },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

export const previewPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
