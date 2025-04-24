import express from "express";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";
import { getSettings, loadAppSettings, pbAdmin, APP_SETTINGS_RECORD_ID } from "../config.js";
import { logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[SETTINGS] GET /settings requested by user ${userId}`);
  logger.time(`[SETTINGS] GET /settings ${userId}`);

  const currentSettings = getSettings();

  logger.timeEnd(`[SETTINGS] GET /settings ${userId}`);
  res.render("settings", {
    pageTitle: "System Settings",
    settings: currentSettings,
    error: req.query.error,
    message: req.query.message,
    currentProjectId: null,
  });
});

router.post("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  logger.info(`[SETTINGS] POST /settings attempt by user ${userId}`);
  logger.time(`[SETTINGS] POST /settings ${userId}`);

  const { enable_global_search, enable_audit_log, enable_project_view_tracking_default, enable_project_time_tracking_default, enable_project_full_width_default } = req.body;

  const errors = {};
  const dataToSave = {};

  dataToSave.enable_global_search = enable_global_search === "true";
  dataToSave.enable_audit_log = enable_audit_log === "true";
  dataToSave.enable_project_view_tracking_default = enable_project_view_tracking_default === "true";
  dataToSave.enable_project_time_tracking_default = enable_project_time_tracking_default === "true";
  dataToSave.enable_project_full_width_default = enable_project_full_width_default === "true";

  if (Object.keys(errors).length > 0) {
    logger.warn("[SETTINGS] Settings update validation failed:", errors);
    const currentSettings = getSettings();
    logger.timeEnd(`[SETTINGS] POST /settings ${userId}`);
    return res.status(400).render("settings", {
      pageTitle: "System Settings",
      settings: {
        ...currentSettings,
        enableGlobalSearch: dataToSave.enable_global_search,
        enableAuditLog: dataToSave.enable_audit_log,
        enableProjectViewTrackingDefault: dataToSave.enable_project_view_tracking_default,
        enableProjectTimeTrackingDefault: dataToSave.enable_project_time_tracking_default,
        enableProjectFullWidthDefault: dataToSave.enable_project_full_width_default,
      },
      errors: errors,
      message: null,
      currentProjectId: null,
    });
  }

  try {
    if (!APP_SETTINGS_RECORD_ID) {
      throw new Error("Application settings record ID is not configured.");
    }

    logger.debug(`[SETTINGS] Updating app_settings record ${APP_SETTINGS_RECORD_ID} with data:`, dataToSave);
    await pbAdmin.collection("app_settings").update(APP_SETTINGS_RECORD_ID, dataToSave);

    logAuditEvent(req, "SETTINGS_UPDATE", "app_settings", APP_SETTINGS_RECORD_ID, dataToSave);
    logger.info(`[SETTINGS] Settings updated successfully by user ${userId}.`);

    await loadAppSettings();

    logger.timeEnd(`[SETTINGS] POST /settings ${userId}`);
    res.redirect("/settings?message=Settings updated successfully.");
  } catch (error) {
    logger.timeEnd(`[SETTINGS] POST /settings ${userId}`);
    logger.error(`[SETTINGS] Failed to update settings: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SETTINGS_UPDATE_FAILURE", "app_settings", APP_SETTINGS_RECORD_ID, {
      error: error?.message,
      dataAttempted: dataToSave,
    });

    const currentSettings = getSettings();
    res.status(500).render("settings", {
      pageTitle: "System Settings",
      settings: {
        ...currentSettings,
        enableGlobalSearch: dataToSave.enable_global_search,
        enableAuditLog: dataToSave.enable_audit_log,
        enableProjectViewTrackingDefault: dataToSave.enable_project_view_tracking_default,
        enableProjectTimeTrackingDefault: dataToSave.enable_project_time_tracking_default,
        enableProjectFullWidthDefault: dataToSave.enable_project_full_width_default,
      },
      errors: { general: { message: "Failed to save settings." } },
      message: null,
      currentProjectId: null,
    });
  }
});

export default router;
