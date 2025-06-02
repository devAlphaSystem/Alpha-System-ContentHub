import express from "express";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";
import { getSettings, pbAdmin } from "../config.js";
import { logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[SETTINGS] GET /settings requested by user ${userId}`);
  logger.time(`[SETTINGS] GET /settings ${userId}`);

  try {
    const userSettings = await getSettings(userId);
    const botUserAgentsString = userSettings.botUserAgents.join("\n");

    logger.timeEnd(`[SETTINGS] GET /settings ${userId}`);
    res.render("settings", {
      pageTitle: "System Settings",
      settings: {
        ...userSettings,
        botUserAgents: botUserAgentsString,
      },
      error: req.query.error,
      message: req.query.message,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[SETTINGS] GET /settings ${userId}`);
    logger.error(`[SETTINGS] Error loading settings page for user ${userId}: ${error.message}`);
    res.render("settings", {
      pageTitle: "System Settings",
      settings: getSettings(),
      error: "Could not load settings. Displaying defaults.",
      message: null,
      currentProjectId: null,
    });
  }
});

router.post("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  logger.info(`[SETTINGS] POST /settings attempt by user ${userId}`);
  logger.time(`[SETTINGS] POST /settings ${userId}`);

  const { enable_global_search, enable_audit_log, enable_project_view_tracking_default, enable_project_time_tracking_default, enable_project_full_width_default, enable_file_size_calculation, bot_user_agents } = req.body;

  const errors = {};
  const dataToSave = {
    user: userId,
    enable_global_search: enable_global_search === "true",
    enable_audit_log: enable_audit_log === "true",
    enable_project_view_tracking_default: enable_project_view_tracking_default === "true",
    enable_project_time_tracking_default: enable_project_time_tracking_default === "true",
    enable_project_full_width_default: enable_project_full_width_default === "true",
    enable_file_size_calculation: enable_file_size_calculation === "true",
    bot_user_agents: bot_user_agents || "",
  };

  if (Object.keys(errors).length > 0) {
    logger.warn("[SETTINGS] Settings update validation failed:", errors);
    const userSettings = await getSettings(userId);
    logger.timeEnd(`[SETTINGS] POST /settings ${userId}`);
    return res.status(400).render("settings", {
      pageTitle: "System Settings",
      settings: {
        ...userSettings,
        enableGlobalSearch: dataToSave.enable_global_search,
        enableAuditLog: dataToSave.enable_audit_log,
        enableProjectViewTrackingDefault: dataToSave.enable_project_view_tracking_default,
        enableProjectTimeTrackingDefault: dataToSave.enable_project_time_tracking_default,
        enableProjectFullWidthDefault: dataToSave.enable_project_full_width_default,
        enableFileSizeCalculation: dataToSave.enable_file_size_calculation,
        botUserAgents: dataToSave.bot_user_agents,
      },
      errors: errors,
      message: null,
      currentProjectId: null,
    });
  }

  try {
    let userSettingsRecord;
    try {
      userSettingsRecord = await pbAdmin.collection("app_settings").getFirstListItem(`user = "${userId}"`);
    } catch (error) {
      if (error.status === 404) {
        logger.info(`[SETTINGS] No settings record found for user ${userId}, will create one.`);
        userSettingsRecord = null;
      } else {
        throw error;
      }
    }

    if (userSettingsRecord) {
      logger.debug(`[SETTINGS] Updating app_settings record ${userSettingsRecord.id} for user ${userId} with data:`, dataToSave);
      await pbAdmin.collection("app_settings").update(userSettingsRecord.id, dataToSave);
    } else {
      logger.debug(`[SETTINGS] Creating new app_settings record for user ${userId} with data:`, dataToSave);
      userSettingsRecord = await pbAdmin.collection("app_settings").create(dataToSave);
    }

    logAuditEvent(req, "SETTINGS_UPDATE", "app_settings", userSettingsRecord.id, {
      ...dataToSave,
      user: undefined,
      bot_user_agents: "[REDACTED]",
    });
    logger.info(`[SETTINGS] Settings updated successfully for user ${userId}.`);

    logger.timeEnd(`[SETTINGS] POST /settings ${userId}`);
    res.redirect("/settings?message=Settings updated successfully.");
  } catch (error) {
    logger.timeEnd(`[SETTINGS] POST /settings ${userId}`);
    logger.error(`[SETTINGS] Failed to update settings for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SETTINGS_UPDATE_FAILURE", "app_settings", null, {
      userId: userId,
      error: error?.message,
      dataAttempted: {
        ...dataToSave,
        user: undefined,
        bot_user_agents: "[REDACTED]",
      },
    });

    const userSettings = await getSettings(userId);
    res.status(500).render("settings", {
      pageTitle: "System Settings",
      settings: {
        ...userSettings,
        enableGlobalSearch: dataToSave.enable_global_search,
        enableAuditLog: dataToSave.enable_audit_log,
        enableProjectViewTrackingDefault: dataToSave.enable_project_view_tracking_default,
        enableProjectTimeTrackingDefault: dataToSave.enable_project_time_tracking_default,
        enableProjectFullWidthDefault: dataToSave.enable_project_full_width_default,
        enableFileSizeCalculation: dataToSave.enable_file_size_calculation,
        botUserAgents: dataToSave.bot_user_agents,
      },
      errors: { general: { message: "Failed to save settings." } },
      message: null,
      currentProjectId: null,
    });
  }
});

export default router;
