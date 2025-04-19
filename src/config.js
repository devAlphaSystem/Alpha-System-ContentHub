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
import { logger } from "./logger.js";

const requiredEnvVars = ["SESSION_SECRET", "IP_HASH_SALT", "POCKETBASE_ADMIN_EMAIL", "POCKETBASE_ADMIN_PASSWORD", "POCKETBASE_URL"];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`FATAL ERROR: ${envVar} must be defined in .env`);
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
const ADMIN_AUTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
export const BASE_DIR = path.dirname(__dirname);

export const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

export const pbAdmin = new PocketBase(POCKETBASE_URL);
pbAdmin.autoCancellation(false);

let isReauthenticating = false;
let adminAuthIntervalId = null;

async function ensureAdminAuth() {
  if (isReauthenticating) {
    logger.debug("Admin re-authentication already in progress, skipping check.");
    return;
  }

  if (pbAdmin.authStore.isValid) {
    logger.trace("Admin token is valid.");
    return;
  }

  logger.warn("Admin token is invalid or missing. Attempting re-authentication...");
  isReauthenticating = true;
  try {
    await pbAdmin.collection("_superusers").authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
    logger.info("PocketBase Admin client re-authenticated successfully.");
  } catch (adminAuthError) {
    logger.error("PocketBase Admin re-authentication failed:", adminAuthError?.message || adminAuthError);
    if (adminAuthError?.data) {
      logger.error("PocketBase Error Data:", adminAuthError.data);
    }
  } finally {
    isReauthenticating = false;
  }
}

(async () => {
  try {
    await pbAdmin.collection("_superusers").authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
    logger.info("PocketBase Admin client authenticated successfully at startup.");

    if (adminAuthIntervalId) {
      clearInterval(adminAuthIntervalId);
    }
    adminAuthIntervalId = setInterval(ensureAdminAuth, ADMIN_AUTH_CHECK_INTERVAL_MS);
    logger.info(`Started admin auth check interval (${ADMIN_AUTH_CHECK_INTERVAL_MS}ms).`);
  } catch (adminAuthError) {
    logger.error("FATAL ERROR: PocketBase Admin authentication failed at startup:", adminAuthError?.message || adminAuthError);
    if (adminAuthError?.data) {
      logger.error("PocketBase Error Data:", adminAuthError.data);
    }
    process.exit(1);
  }
})();

const dbDir = path.join(BASE_DIR, "db");
if (!fs.existsSync(dbDir)) {
  logger.info(`Creating database directory: ${dbDir}`);
  fs.mkdirSync(dbDir, {
    recursive: true,
  });
}

const SQLiteStore = connectSqlite3(session);
export const sessionStore = new SQLiteStore({
  db: "sessions.db",
  dir: dbDir,
});

const viewDbPath = path.join(dbDir, "view_tracking.db");
export const viewDb = new sqlite3.Database(viewDbPath, (err) => {
  if (err) {
    logger.error("Error opening view tracking database:", err.message);
  } else {
    logger.debug("View tracking database opened successfully.");
    viewDb.run("CREATE TABLE IF NOT EXISTS view_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, ip_address TEXT NOT NULL, viewed_at INTEGER NOT NULL)", (createTableErr) => {
      if (createTableErr) {
        logger.error("Error creating view_logs table:", createTableErr.message);
      } else {
        logger.trace("view_logs table ensured.");
        viewDb.run("CREATE INDEX IF NOT EXISTS idx_view_logs_entry_ip_time ON view_logs (entry_id, ip_address, viewed_at)", (indexErr) => {
          if (indexErr) logger.error("Error creating index:", indexErr.message);
          else logger.trace("view_logs index ensured.");
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
  handler: (req, res, next, options) => {
    logger.warn(`Login rate limit exceeded for IP: ${req.ip}, Email: ${req.body?.email}`);
    res.status(options.statusCode).send(options.message);
  },
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn(`API rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
    res.status(options.statusCode).send(options.message);
  },
});

export const previewPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn(`Preview password rate limit exceeded for IP: ${req.ip}, Token: ${req.params?.token}`);
    res.status(options.statusCode).send(options.message);
  },
});
