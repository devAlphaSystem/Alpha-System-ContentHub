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
export const PUBLIC_POCKETBASE_URL = process.env.PUBLIC_POCKETBASE_URL || POCKETBASE_URL;
export const NODE_ENV = process.env.NODE_ENV || "development";
export const PORT = process.env.PORT || 3000;

export const ITEMS_PER_PAGE = Number.parseInt(process.env.ITEMS_PER_PAGE || "10", 10);
export const SESSION_MAX_AGE_DAYS = Number.parseInt(process.env.SESSION_MAX_AGE_DAYS || "7", 10);
const DEFAULT_PREVIEW_TOKEN_EXPIRY_HOURS = Number.parseInt(process.env.PREVIEW_TOKEN_EXPIRY_HOURS || "6", 10);
const DEFAULT_ENABLE_GLOBAL_SEARCH = process.env.ENABLE_GLOBAL_SEARCH !== "false";
const DEFAULT_ENABLE_AUDIT_LOG = process.env.ENABLE_AUDIT_LOG !== "false";
const DEFAULT_ENABLE_PROJECT_VIEW_TRACKING_DEFAULT = process.env.ENABLE_PROJECT_VIEW_TRACKING_DEFAULT !== "false";
const DEFAULT_ENABLE_PROJECT_TIME_TRACKING_DEFAULT = process.env.ENABLE_PROJECT_TIME_TRACKING_DEFAULT !== "false";
const DEFAULT_ENABLE_PROJECT_FULL_WIDTH_DEFAULT = process.env.ENABLE_PROJECT_FULL_WIDTH_DEFAULT === "true";
const DEFAULT_ENABLE_FILE_SIZE_CALCULATION = process.env.ENABLE_FILE_SIZE_CALCULATION === "true";
const DEFAULT_BOT_USER_AGENTS_STRING = "googleimageproxy\ngooglebot\nadsbot-google\nmediapartners-google\napis-google\nfeedfetcher-google\nbingbot\nduckduckbot\nbaiduspider\nyandexbot\nslurp\nfacebookexternalhit\nfacebot\ntwitterbot\nlinkedinbot\npinterestbot\nslackbot\ndiscordbot\napplebot\npetalbot\nbytespider\nsemrushbot\nahrefsbot\nmj12bot\ndotbot\nuptimerobot\npingdom\nstatuscake\ncurl\nwget\npostman\npython-requests\nheadlesschrome\npuppeteer\nplaywright\nselenium\nelectron\nbot\ncrawler\nspider\nprobe\nscan";

let defaultAppSettings = {};

function initializeDefaultSettings() {
  defaultAppSettings = {
    previewTokenExpiryHours: DEFAULT_PREVIEW_TOKEN_EXPIRY_HOURS,
    enableGlobalSearch: DEFAULT_ENABLE_GLOBAL_SEARCH,
    enableAuditLog: DEFAULT_ENABLE_AUDIT_LOG,
    enableProjectViewTrackingDefault: DEFAULT_ENABLE_PROJECT_VIEW_TRACKING_DEFAULT,
    enableProjectTimeTrackingDefault: DEFAULT_ENABLE_PROJECT_TIME_TRACKING_DEFAULT,
    enableProjectFullWidthDefault: DEFAULT_ENABLE_PROJECT_FULL_WIDTH_DEFAULT,
    enableFileSizeCalculation: DEFAULT_ENABLE_FILE_SIZE_CALCULATION,
    botUserAgents: DEFAULT_BOT_USER_AGENTS_STRING.split("\n")
      .map((ua) => ua.trim().toLowerCase())
      .filter((ua) => ua.length > 0),
  };
  logger.info("Default application settings initialized.");
}

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

export async function getSettings(userId = null) {
  if (!userId) {
    logger.trace("[CONFIG] getSettings: No userId provided, returning default app settings.");
    return { ...defaultAppSettings };
  }

  try {
    if (!pbAdmin.authStore.isValid) {
      logger.warn("[CONFIG] getSettings: Admin client not authenticated. Attempting auth...");
      await ensureAdminAuth();
      if (!pbAdmin.authStore.isValid) {
        logger.error("[CONFIG] getSettings: Admin client authentication failed. Returning defaults.");
        return { ...defaultAppSettings };
      }
    }

    let userSettingsRecord;
    try {
      userSettingsRecord = await pbAdmin.collection("app_settings").getFirstListItem(`user = "${userId}"`);
      logger.trace(`[CONFIG] getSettings: Found settings for user ${userId}`);
    } catch (error) {
      if (error.status === 404) {
        logger.info(`[CONFIG] getSettings: No settings found for user ${userId}. Creating with defaults.`);
        const newSettingsData = {
          user: userId,
          enable_global_search: defaultAppSettings.enableGlobalSearch,
          enable_audit_log: defaultAppSettings.enableAuditLog,
          enable_project_view_tracking_default: defaultAppSettings.enableProjectViewTrackingDefault,
          enable_project_time_tracking_default: defaultAppSettings.enableProjectTimeTrackingDefault,
          enable_project_full_width_default: defaultAppSettings.enableProjectFullWidthDefault,
          enable_file_size_calculation: defaultAppSettings.enableFileSizeCalculation,
          bot_user_agents: defaultAppSettings.botUserAgents.join("\n"),
        };
        userSettingsRecord = await pbAdmin.collection("app_settings").create(newSettingsData);
        logger.info(`[CONFIG] getSettings: Created default settings for user ${userId} with ID ${userSettingsRecord.id}`);
      } else {
        logger.error(`[CONFIG] getSettings: Error fetching settings for user ${userId}: ${error.message}. Returning defaults.`);
        return { ...defaultAppSettings };
      }
    }

    const userBotUserAgentsString = userSettingsRecord.bot_user_agents;
    let finalBotUserAgentsList;
    if (userBotUserAgentsString && userBotUserAgentsString.trim() !== "") {
      finalBotUserAgentsList = userBotUserAgentsString
        .split("\n")
        .map((ua) => ua.trim().toLowerCase())
        .filter((ua) => ua.length > 0);
    } else {
      finalBotUserAgentsList = defaultAppSettings.botUserAgents;
    }

    return {
      enableGlobalSearch: userSettingsRecord.enable_global_search ?? defaultAppSettings.enableGlobalSearch,
      enableAuditLog: userSettingsRecord.enable_audit_log ?? defaultAppSettings.enableAuditLog,
      enableProjectViewTrackingDefault: userSettingsRecord.enable_project_view_tracking_default ?? defaultAppSettings.enableProjectViewTrackingDefault,
      enableProjectTimeTrackingDefault: userSettingsRecord.enable_project_time_tracking_default ?? defaultAppSettings.enableProjectTimeTrackingDefault,
      enableProjectFullWidthDefault: userSettingsRecord.enable_project_full_width_default ?? defaultAppSettings.enableProjectFullWidthDefault,
      enableFileSizeCalculation: userSettingsRecord.enable_file_size_calculation ?? defaultAppSettings.enableFileSizeCalculation,
      botUserAgents: finalBotUserAgentsList,
      previewTokenExpiryHours: defaultAppSettings.previewTokenExpiryHours,
    };
  } catch (error) {
    logger.error(`[CONFIG] getSettings: General error for user ${userId}: ${error.message}. Returning defaults.`);
    return { ...defaultAppSettings };
  }
}

(async () => {
  try {
    initializeDefaultSettings();
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
          if (indexErr) {
            logger.error("Error creating view_logs index:", indexErr.message);
          } else {
            logger.trace("view_logs index ensured.");
          }
        });
      }
    });
    viewDb.run("CREATE TABLE IF NOT EXISTS view_durations (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, duration_seconds INTEGER NOT NULL, logged_at INTEGER NOT NULL, ip_address TEXT)", (createDurationTableErr) => {
      if (createDurationTableErr) {
        logger.error("Error creating view_durations table:", createDurationTableErr.message);
      } else {
        logger.trace("view_durations table ensured.");
        viewDb.run("CREATE INDEX IF NOT EXISTS idx_view_durations_entry ON view_durations (entry_id)", (indexErr) => {
          if (indexErr) {
            logger.error("Error creating view_durations index:", indexErr.message);
          } else {
            logger.trace("view_durations index ensured.");
          }
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
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "https://*", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://*", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", POCKETBASE_URL, PUBLIC_POCKETBASE_URL, "https://*"],
      connectSrc: ["'self'", POCKETBASE_URL, PUBLIC_POCKETBASE_URL, "https://api.languagetool.org"],
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
