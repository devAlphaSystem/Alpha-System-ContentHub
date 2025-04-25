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

const requiredEnvVars = ["SESSION_SECRET", "IP_HASH_SALT", "POCKETBASE_ADMIN_EMAIL", "POCKETBASE_ADMIN_PASSWORD", "POCKETBASE_URL", "APP_SETTINGS_RECORD_ID"];

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
export const APP_SETTINGS_RECORD_ID = process.env.APP_SETTINGS_RECORD_ID;

export const ITEMS_PER_PAGE = Number.parseInt(process.env.ITEMS_PER_PAGE || "10", 10);
export const SESSION_MAX_AGE_DAYS = Number.parseInt(process.env.SESSION_MAX_AGE_DAYS || "7", 10);
const DEFAULT_PREVIEW_TOKEN_EXPIRY_HOURS = Number.parseInt(process.env.PREVIEW_TOKEN_EXPIRY_HOURS || "6", 10);
const DEFAULT_ENABLE_GLOBAL_SEARCH = process.env.ENABLE_GLOBAL_SEARCH !== "false";
const DEFAULT_ENABLE_AUDIT_LOG = process.env.ENABLE_AUDIT_LOG !== "false";
const DEFAULT_ENABLE_PROJECT_VIEW_TRACKING_DEFAULT = process.env.ENABLE_PROJECT_VIEW_TRACKING_DEFAULT !== "false";
const DEFAULT_ENABLE_PROJECT_TIME_TRACKING_DEFAULT = process.env.ENABLE_PROJECT_TIME_TRACKING_DEFAULT !== "false";
const DEFAULT_ENABLE_PROJECT_FULL_WIDTH_DEFAULT = process.env.ENABLE_PROJECT_FULL_WIDTH_DEFAULT === "true";
const DEFAULT_ENABLE_FILE_SIZE_CALCULATION = process.env.ENABLE_FILE_SIZE_CALCULATION === "true";

let currentSettings = {
  previewTokenExpiryHours: DEFAULT_PREVIEW_TOKEN_EXPIRY_HOURS,
  enableGlobalSearch: DEFAULT_ENABLE_GLOBAL_SEARCH,
  enableAuditLog: DEFAULT_ENABLE_AUDIT_LOG,
  enableProjectViewTrackingDefault: DEFAULT_ENABLE_PROJECT_VIEW_TRACKING_DEFAULT,
  enableProjectTimeTrackingDefault: DEFAULT_ENABLE_PROJECT_TIME_TRACKING_DEFAULT,
  enableProjectFullWidthDefault: DEFAULT_ENABLE_PROJECT_FULL_WIDTH_DEFAULT,
  enableFileSizeCalculation: DEFAULT_ENABLE_FILE_SIZE_CALCULATION,
};

export const VIEW_TIMEFRAME_HOURS = Number.parseInt(process.env.VIEW_TIMEFRAME_HOURS || "24", 10);
export const AVERAGE_WPM = Number.parseInt(process.env.AVERAGE_WPM || "225", 10);
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

export async function loadAppSettings() {
  logger.info("Attempting to load application settings from PocketBase...");
  if (!APP_SETTINGS_RECORD_ID) {
    logger.error("APP_SETTINGS_RECORD_ID is not defined in .env. Cannot load dynamic settings.");
    logger.warn("Using default settings based on environment variables.");
    return;
  }
  try {
    if (!pbAdmin.authStore.isValid) {
      logger.warn("Admin client not authenticated during settings load. Attempting auth...");
      await ensureAdminAuth();
      if (!pbAdmin.authStore.isValid) {
        throw new Error("Admin client authentication failed.");
      }
    }
    const settingsRecord = await pbAdmin.collection("app_settings").getOne(APP_SETTINGS_RECORD_ID);

    currentSettings = {
      previewTokenExpiryHours: settingsRecord.preview_token_expiry_hours ?? DEFAULT_PREVIEW_TOKEN_EXPIRY_HOURS,
      enableGlobalSearch: settingsRecord.enable_global_search ?? DEFAULT_ENABLE_GLOBAL_SEARCH,
      enableAuditLog: settingsRecord.enable_audit_log ?? DEFAULT_ENABLE_AUDIT_LOG,
      enableProjectViewTrackingDefault: settingsRecord.enable_project_view_tracking_default ?? DEFAULT_ENABLE_PROJECT_VIEW_TRACKING_DEFAULT,
      enableProjectTimeTrackingDefault: settingsRecord.enable_project_time_tracking_default ?? DEFAULT_ENABLE_PROJECT_TIME_TRACKING_DEFAULT,
      enableProjectFullWidthDefault: settingsRecord.enable_project_full_width_default ?? DEFAULT_ENABLE_PROJECT_FULL_WIDTH_DEFAULT,
      enableFileSizeCalculation: settingsRecord.enable_file_size_calculation ?? DEFAULT_ENABLE_FILE_SIZE_CALCULATION,
    };
    logger.info("Successfully loaded application settings from PocketBase.");
    logger.debug("Current runtime settings:", currentSettings);
  } catch (error) {
    logger.error(`Failed to load settings from PocketBase (Record ID: ${APP_SETTINGS_RECORD_ID}): ${error.message}`);
    logger.warn("Using default settings based on environment variables.");
  }
}

export function getSettings() {
  return { ...currentSettings };
}

(async () => {
  try {
    await pbAdmin.collection("_superusers").authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
    logger.info("PocketBase Admin client authenticated successfully at startup.");

    await loadAppSettings();

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
          if (indexErr) logger.error("Error creating view_logs index:", indexErr.message);
          else logger.trace("view_logs index ensured.");
        });
      }
    });
    viewDb.run("CREATE TABLE IF NOT EXISTS view_durations (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, duration_seconds INTEGER NOT NULL, logged_at INTEGER NOT NULL, ip_address TEXT)", (createDurationTableErr) => {
      if (createDurationTableErr) {
        logger.error("Error creating view_durations table:", createDurationTableErr.message);
      } else {
        logger.trace("view_durations table ensured.");
        viewDb.run("CREATE INDEX IF NOT EXISTS idx_view_durations_entry ON view_durations (entry_id)", (indexErr) => {
          if (indexErr) logger.error("Error creating view_durations index:", indexErr.message);
          else logger.trace("view_durations index ensured.");
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
