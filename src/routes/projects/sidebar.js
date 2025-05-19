import express from "express";
import { pb } from "../../config.js";
import { getProjectForOwner, logAuditEvent } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Sidebar] checkProjectAccess middleware for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[PROJ][Sidebar] Project ID is missing in checkProjectAccess.");
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      logger.warn(`[PROJ][Sidebar] Project ${projectId} not found or access denied for user ${userId} in checkProjectAccess.`);
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    logger.debug(`[PROJ][Sidebar] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    logger.error(`[PROJ][Sidebar] Error in checkProjectAccess for project ${projectId}, user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
}

router.use("/:projectId/sidebar-order", checkProjectAccess);

router.get("/:projectId/sidebar-order", async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Sidebar] GET /projects/${projectId}/sidebar-order requested by user ${userId}`);
  logger.time(`[PROJ][Sidebar] GET /projects/${projectId}/sidebar-order ${userId}`);

  try {
    const moduleFieldMap = {
      documentation: "documentation_enabled",
      changelog: "changelog_enabled",
      roadmap: "roadmap_enabled",
      knowledge_base: "knowledge_base_enabled",
    };
    let sidebarEntries = await pb.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && owner = '${userId}' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
      sort: "+sidebar_order,+title",
      fields: "id,title,sidebar_order,type",
    });
    sidebarEntries = sidebarEntries.filter((entry) => {
      const field = moduleFieldMap[entry.type];
      return !field || req.project[field] !== false;
    });
    logger.debug(`[PROJ][Sidebar] Fetched ${sidebarEntries.length} entries for sidebar ordering in project ${projectId}.`);

    logger.timeEnd(`[PROJ][Sidebar] GET /projects/${projectId}/sidebar-order ${userId}`);
    res.render("projects/sidebar_order", {
      pageTitle: `Sidebar Order - ${req.project.name}`,
      project: req.project,
      entries: sidebarEntries,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Sidebar] GET /projects/${projectId}/sidebar-order ${userId}`);
    logger.error(`[PROJ][Sidebar] Error fetching entries for sidebar ordering for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SIDEBAR_ORDER_LOAD_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.redirect(`/projects/${projectId}?error=Could not load sidebar order page.`);
  }
});

router.post("/:projectId/sidebar-order", async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { entryOrder } = req.body;
  logger.info(`[PROJ][Sidebar] POST /projects/${projectId}/sidebar-order attempt by user ${userId}. Count: ${entryOrder?.length}`);
  logger.time(`[PROJ][Sidebar] POST /projects/${projectId}/sidebar-order ${userId}`);

  if (!Array.isArray(entryOrder)) {
    logger.warn(`[PROJ][Sidebar] Invalid sidebar order data format for project ${projectId}. Expected array.`);
    logger.timeEnd(`[PROJ][Sidebar] POST /projects/${projectId}/sidebar-order ${userId}`);
    return res.status(400).json({
      error: "Invalid data format. Expected 'entryOrder' array.",
    });
  }

  try {
    const updatePromises = entryOrder.map((entryId, index) => {
      logger.trace(`[PROJ][Sidebar] Updating sidebar order for entry ${entryId} to ${index}`);
      return pb
        .collection("entries_main")
        .update(
          entryId,
          {
            sidebar_order: index,
          },
          {
            $autoCancel: false,
          },
        )
        .catch((err) => {
          logger.error(`[PROJ][Sidebar] Failed to update sidebar order for entry ${entryId}: Status ${err?.status || "N/A"}`, err?.message || err);
          return {
            id: entryId,
            error: err.message || "Update failed",
            status: err.status || 500,
          };
        });
    });

    const results = await Promise.all(updatePromises);
    const errors = results.filter((r) => r?.error);

    if (errors.length > 0) {
      logger.warn(`[PROJ][Sidebar] Sidebar order update completed with ${errors.length} errors for project ${projectId}.`);
      logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_PARTIAL", "entries_main", null, {
        projectId: projectId,
        errors: errors,
      });
      const statusCode = errors.some((e) => e.status === 403) ? 403 : errors.some((e) => e.status >= 500) ? 500 : 400;
      logger.timeEnd(`[PROJ][Sidebar] POST /projects/${projectId}/sidebar-order ${userId}`);
      return res.status(statusCode).json({
        error: `Failed to update order for ${errors.length} out of ${entryOrder.length} entries.`,
        details: errors,
      });
    }

    logger.info(`[PROJ][Sidebar] Sidebar order updated successfully for ${entryOrder.length} entries in project ${projectId}.`);
    logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_SUCCESS", "entries_main", null, {
      projectId: projectId,
      count: entryOrder.length,
    });
    logger.timeEnd(`[PROJ][Sidebar] POST /projects/${projectId}/sidebar-order ${userId}`);
    res.status(200).json({
      message: "Sidebar order updated successfully.",
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Sidebar] POST /projects/${projectId}/sidebar-order ${userId}`);
    logger.error(`[PROJ][Sidebar] Error updating sidebar order for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.status(500).json({
      error: "An unexpected error occurred while updating sidebar order.",
    });
  }
});

export default router;
