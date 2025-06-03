import express from "express";
import multer from "multer";
import path from "node:path";
import { pb, pbAdmin, POCKETBASE_URL, PUBLIC_POCKETBASE_URL } from "../../config.js";
import { getProjectForOwner, logAuditEvent, hashPreviewPassword, clearEntryViewLogs } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/x-icon", "image/png", "image/svg+xml", "image/vnd.microsoft.icon"];
    const allowedExts = [".ico", ".png", ".svg"];

    const mimetype = allowedMimes.includes(file.mimetype);
    const extname = allowedExts.includes(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      cb(null, true);
    } else {
      logger.warn(`Favicon upload rejected. Field: ${file.fieldname}, Filename: ${file.originalname}, Mimetype: ${file.mimetype}`);
      cb(new Error(`Invalid file type. Allowed: ${allowedExts.join(", ")}`));
    }
  },
});

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] checkProjectAccess middleware for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[PROJ] Project ID is missing in checkProjectAccess.");
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      logger.warn(`[PROJ] Project ${projectId} not found or access denied for user ${userId} in checkProjectAccess.`);
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    logger.debug(`[PROJ] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    logger.error(`[PROJ] Error in checkProjectAccess for project ${projectId}, user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
}

router.use("/:projectId", checkProjectAccess);

router.get("/:projectId", async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId} (dashboard) requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId} ${userId}`);
  let firstSidebarEntryId = null;
  let hasPublishedKbEntries = false;

  try {
    if (req.project.knowledge_base_enabled !== false) {
      try {
        logger.trace(`[PROJ] Checking for published KB entries in project ${projectId}`);
        await pbAdmin.collection("entries_main").getFirstListItem(`project = '${projectId}' && type = 'knowledge_base' && status = 'published'`, {
          fields: "id",
          $autoCancel: false,
        });
        hasPublishedKbEntries = true;
        logger.trace(`[PROJ] Found published KB entries for project ${projectId}`);
      } catch (kbError) {
        if (kbError.status !== 404) {
          logger.warn(`[PROJ] Error checking for published KB entries for project ${projectId}: Status ${kbError?.status || "N/A"}`, kbError.message);
        } else {
          logger.trace(`[PROJ] No published KB entries found for project ${projectId}`);
        }
        hasPublishedKbEntries = false;
      }
    } else {
      logger.trace(`[PROJ] Knowledge Base module is disabled for project ${projectId}, skipping KB entries check`);
      hasPublishedKbEntries = false;
    }

    try {
      logger.trace(`[PROJ] Fetching first sidebar entry for project ${projectId}`);
      const filterConditions = [`project = '${projectId}' && show_in_project_sidebar = true && status = 'published'`];

      filterConditions.push(`type != 'sidebar_header'`);

      if (req.project.roadmap_enabled === false) {
        filterConditions.push(`type != 'roadmap'`);
      }

      if (req.project.knowledge_base_enabled === false) {
        filterConditions.push(`type != 'knowledge_base'`);
      }

      if (req.project.documentation_enabled === false) {
        filterConditions.push(`type != 'documentation'`);
      }

      if (req.project.changelog_enabled === false) {
        filterConditions.push(`type != 'changelog'`);
      }

      const firstEntryFilter = filterConditions.join(" && ");

      const firstEntryResult = await pbAdmin.collection("entries_main").getFirstListItem(firstEntryFilter, {
        sort: "+sidebar_order,+title",
        fields: "id",
        $autoCancel: false,
      });
      firstSidebarEntryId = firstEntryResult?.id || null;
      logger.trace(`[PROJ] First sidebar entry ID for project ${projectId}: ${firstSidebarEntryId}`);
    } catch (firstEntryError) {
      if (firstEntryError.status !== 404) {
        logger.warn(`[PROJ] Could not fetch first sidebar entry for project ${projectId}: Status ${firstEntryError?.status || "N/A"}`, firstEntryError.message);
      } else {
        logger.trace(`[PROJ] No first sidebar entry found for project ${projectId}`);
      }
      firstSidebarEntryId = null;
    }

    logger.time(`[PROJ] FetchProjectEntriesMetrics ${projectId}`);
    let totalEntries = 0;
    let totalViews = 0;
    const entriesByType = {
      changelog: 0,
      documentation: 0,
      knowledge_base: 0,
    };
    let activityData = [];
    let totalDurationSum = 0;
    let totalDurationCountSum = 0;
    let helpfulYesCount = 0;
    let helpfulNoCount = 0;

    const moduleFilters = [`project = '${projectId}'`, `type != 'sidebar_header'`];

    if (req.project.documentation_enabled === false) {
      moduleFilters.push(`type != 'documentation'`);
    }

    if (req.project.changelog_enabled === false) {
      moduleFilters.push(`type != 'changelog'`);
    }

    if (req.project.roadmap_enabled === false) {
      moduleFilters.push(`type != 'roadmap'`);
    }

    if (req.project.knowledge_base_enabled === false) {
      moduleFilters.push(`type != 'knowledge_base'`);
    }

    const entriesFilter = moduleFilters.join(" && ");

    const projectEntries = await pbAdmin.collection("entries_main").getFullList({
      filter: entriesFilter,
      fields: "id, views, type, created, total_view_duration, view_duration_count, helpful_yes, helpful_no",
      $autoCancel: false,
    });
    logger.timeEnd(`[PROJ] FetchProjectEntriesMetrics ${projectId}`);
    logger.trace(`[PROJ] Fetched ${projectEntries.length} entries for project ${projectId} metrics.`);

    totalEntries = projectEntries.length;
    const activityMap = new Map();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const entry of projectEntries) {
      totalViews += entry.views || 0;
      helpfulYesCount += entry.helpful_yes || 0;
      helpfulNoCount += entry.helpful_no || 0;
      if (entry.type === "changelog") {
        entriesByType.changelog++;
        totalDurationSum += entry.total_view_duration || 0;
        totalDurationCountSum += entry.view_duration_count || 0;
      } else if (entry.type === "documentation") {
        entriesByType.documentation++;
        totalDurationSum += entry.total_view_duration || 0;
        totalDurationCountSum += entry.view_duration_count || 0;
      } else if (entry.type === "knowledge_base") {
        entriesByType.knowledge_base++;
      }

      const createdDate = new Date(entry.created);
      if (createdDate >= thirtyDaysAgo) {
        const dateString = createdDate.toISOString().split("T")[0];
        activityMap.set(dateString, (activityMap.get(dateString) || 0) + 1);
      }
    }
    logger.trace("[PROJ] Calculated project entry metrics.");

    activityData = Array.from(activityMap.entries())
      .map(([date, count]) => ({
        x: date,
        y: count,
      }))
      .sort((a, b) => new Date(a.x) - new Date(b.x));
    logger.trace(`[PROJ] Processed ${activityData.length} days of project activity.`);

    logger.time(`[PROJ] FetchRecentEntries ${projectId}`);
    const recentEntriesResult = await pbAdmin.collection("entries_main").getList(1, 5, {
      filter: entriesFilter,
      sort: "-content_updated_at",
      fields: "id, title, updated, type, content_updated_at",
      $autoCancel: false,
    });
    logger.timeEnd(`[PROJ] FetchRecentEntries ${projectId}`);
    logger.trace(`[PROJ] Fetched ${recentEntriesResult.items.length} recent entries.`);

    const metrics = {
      totalEntries: totalEntries,
      totalViews: totalViews,
      entriesByType: entriesByType,
      recentEntries: recentEntriesResult.items.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        formattedUpdated: new Date(e.content_updated_at || e.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      })),
      activityData: activityData,
      totalDurationSum: totalDurationSum,
      totalDurationCountSum: totalDurationCountSum,
      helpfulYesCount: helpfulYesCount,
      helpfulNoCount: helpfulNoCount,
    };

    logger.debug(`[PROJ] Rendering project dashboard for ${projectId}`);
    logger.timeEnd(`[PROJ] GET /projects/${projectId} ${userId}`);
    res.render("projects/dashboard", {
      pageTitle: `Dashboard - ${req.project.name}`,
      project: req.project,
      metrics: metrics,
      firstSidebarEntryId: firstSidebarEntryId,
      hasPublishedKbEntries: hasPublishedKbEntries,
      error: null,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ] GET /projects/${projectId} ${userId}`);
    logger.error(`[PROJ] Error loading dashboard for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_DASHBOARD_LOAD_FAILURE", "projects", projectId, {
      error: error?.message,
    });
    res.render("projects/dashboard", {
      pageTitle: `Dashboard - ${req.project.name}`,
      project: req.project,
      metrics: null,
      firstSidebarEntryId: null,
      hasPublishedKbEntries: false,
      error: "Could not load project dashboard data.",
    });
  }
});

router.get("/:projectId/edit", async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId}/edit requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId}/edit ${userId}`);
  try {
    const projectData = await pb.collection("projects").getOne(req.project.id);
    logger.debug(`[PROJ] Fetched project data for edit page: ${projectId}`);

    let faviconUrl = null;
    if (projectData.favicon) {
      faviconUrl = `${PUBLIC_POCKETBASE_URL}/api/files/projects/${projectId}/${projectData.favicon}`;
      logger.trace(`[PROJ] Constructed favicon URL: ${faviconUrl}`);
    }

    logger.timeEnd(`[PROJ] GET /projects/${projectId}/edit ${userId}`);
    res.render("projects/edit", {
      pageTitle: `Edit Project: ${projectData.name}`,
      project: {
        ...projectData,
        roadmap_enabled: projectData.roadmap_enabled !== false,
        documentation_enabled: projectData.documentation_enabled !== false,
        changelog_enabled: projectData.changelog_enabled !== false,
        knowledge_base_enabled: projectData.knowledge_base_enabled !== false,
      },
      faviconUrl: faviconUrl,
      errors: null,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/edit ${userId}`);
    logger.error(`[PROJ] Failed to fetch project ${projectId} for edit page: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
});

router.post("/:projectId/edit", upload.single("favicon"), async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.info(`[PROJ] POST /projects/${projectId}/edit attempt by user ${userId}`);
  logger.time(`[PROJ] POST /edit ${projectId}`);

  const { name, description, is_publicly_viewable, password_protected, access_password, roadmap_enabled, documentation_enabled, changelog_enabled, knowledge_base_enabled, view_tracking_enabled, view_time_tracking_enabled, use_full_width_content, remove_favicon } = req.body;

  const errors = {};
  const data = {};

  if (!name || name.trim() === "") {
    errors.name = { message: "Project name is required." };
  } else {
    data.name = name.trim();
  }
  data.description = description || "";
  data.is_publicly_viewable = is_publicly_viewable === "true";
  data.password_protected = password_protected === "true";
  data.roadmap_enabled = roadmap_enabled === "true";
  data.documentation_enabled = documentation_enabled === "true";
  data.changelog_enabled = changelog_enabled === "true";
  data.knowledge_base_enabled = knowledge_base_enabled === "true";
  data.view_tracking_enabled = view_tracking_enabled === "true";
  data.view_time_tracking_enabled = view_time_tracking_enabled === "true";
  data.use_full_width_content = use_full_width_content === "true";

  if (data.password_protected && access_password && access_password.trim() !== "") {
    data.access_password_hash = hashPreviewPassword(access_password);
    if (!data.access_password_hash) {
      errors.access_password = {
        message: "Failed to process password.",
      };
    }
  } else if (data.password_protected && (!access_password || access_password.trim() === "")) {
    logger.trace(`[PROJ] Keeping existing password hash for project ${projectId}.`);
  } else if (!data.password_protected) {
    data.access_password_hash = null;
    logger.trace(`[PROJ] Clearing password hash for project ${projectId} as protection is disabled.`);
  }

  if (!data.view_tracking_enabled && data.view_time_tracking_enabled) {
    errors.view_time_tracking_enabled = {
      message: "Time tracking requires view tracking to be enabled.",
    };
  }

  if (remove_favicon === "true") {
    data.favicon = null;
    logger.trace(`[PROJ] Marked favicon for removal for project ${projectId}.`);
  }

  if (Object.keys(errors).length > 0) {
    logger.warn(`[PROJ] Validation errors updating project ${projectId}:`, errors);
    const project = await getProjectForOwner(projectId, userId);
    let faviconUrl = null;
    if (project.favicon) {
      faviconUrl = `${POCKETBASE_URL}/api/files/projects/${projectId}/${project.favicon}`;
    }
    logger.timeEnd(`[PROJ] POST /edit ${projectId}`);
    return res.status(400).render("projects/edit", {
      pageTitle: `Edit Project: ${project.name}`,
      project: { ...project, ...data },
      faviconUrl: faviconUrl,
      errors: errors,
      message: null,
    });
  }

  try {
    const formData = new FormData();
    for (const key in data) {
      if (key !== "favicon") {
        if (typeof data[key] === "boolean") {
          formData.append(key, data[key] ? "true" : "false");
        } else if (data[key] !== null && data[key] !== undefined) {
          formData.append(key, data[key]);
        } else if (key === "access_password_hash" && data[key] === null) {
          formData.append(key, "");
        }
      }
    }

    if (remove_favicon === "true") {
      formData.append("favicon", "");
      logger.trace("[PROJ] Appending empty favicon field to FormData for removal.");
    } else if (req.file) {
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
      formData.append("favicon", blob, req.file.originalname);
      logger.trace(`[PROJ] Appending new favicon file to FormData: ${req.file.originalname}`);
    } else {
      logger.trace("[PROJ] No new favicon uploaded and not removing, keeping existing.");
    }

    logger.debug(`[PROJ] Updating project ${projectId} with data (file omitted from log):`, data);
    await pb.collection("projects").update(projectId, formData);

    logAuditEvent(req, "PROJECT_UPDATE", "projects", projectId, {
      name: data.name,
      public: data.is_publicly_viewable,
      passwordProtected: data.password_protected,
      roadmapEnabled: data.roadmap_enabled,
      viewTracking: data.view_tracking_enabled,
      timeTracking: data.view_time_tracking_enabled,
      fullWidth: data.use_full_width_content,
      faviconAction: remove_favicon === "true" ? "removed" : req.file ? "updated" : "unchanged",
    });
    logger.info(`[PROJ] Project ${projectId} (${data.name}) updated successfully by user ${userId}.`);
    logger.timeEnd(`[PROJ] POST /edit ${projectId}`);
    res.redirect(`/projects/${projectId}/edit?message=updated`);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /edit ${projectId}`);
    logger.error(`[PROJ] Failed to update project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_UPDATE_FAILURE", "projects", projectId, {
      error: error?.message,
      dataAttempted: data,
    });

    if (error?.data?.data?.favicon?.code === "validation_invalid_mime_type") {
      errors.favicon = { message: "Invalid file type for favicon." };
    } else if (error?.data?.data?.favicon?.code === "validation_file_size_limit") {
      errors.favicon = { message: "Favicon file is too large." };
    } else {
      errors.general = { message: "Failed to save project settings." };
    }

    const project = await getProjectForOwner(projectId, userId);
    let faviconUrl = null;
    if (project.favicon) {
      faviconUrl = `${POCKETBASE_URL}/api/files/projects/${projectId}/${project.favicon}`;
    }
    res.status(500).render("projects/edit", {
      pageTitle: `Edit Project: ${project.name}`,
      project: { ...project, ...data },
      faviconUrl: faviconUrl,
      errors: errors,
      message: null,
    });
  }
});

router.get("/:projectId/export", async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.info(`[PROJ] GET /projects/${projectId}/export requested by user ${userId}`);
  logger.time(`[PROJ] Export ${projectId}`);

  try {
    const projectData = await pb.collection("projects").getOne(projectId);
    if (projectData.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }

    const relatedCollections = ["entries_main", "entries_archived", "templates", "documentation_headers", "documentation_footers", "changelog_headers", "changelog_footers"];
    const exportData = {
      export_metadata: {
        version: req.app.locals.appVersion,
        timestamp: new Date().toISOString(),
        source_project_id: projectId,
      },
      project: { ...projectData, owner: undefined },
      related_data: {},
    };

    for (const collectionName of relatedCollections) {
      logger.debug(`[PROJ][Export ${projectId}] Fetching all records from ${collectionName}`);
      logger.time(`[PROJ][Export ${projectId}] Fetch ${collectionName}`);
      const records = await pb.collection(collectionName).getFullList({
        filter: `project = '${projectId}'`,
        $autoCancel: false,
      });
      logger.timeEnd(`[PROJ][Export ${projectId}] Fetch ${collectionName}`);

      exportData.related_data[collectionName] = records.map((record) => {
        const cleanedRecord = { ...record };
        cleanedRecord.owner = undefined;
        cleanedRecord.project = undefined;
        cleanedRecord.collectionId = undefined;
        cleanedRecord.collectionName = undefined;
        return cleanedRecord;
      });
      logger.debug(`[PROJ][Export ${projectId}] Fetched ${records.length} records from ${collectionName}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `project_${projectData.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${projectId}_export_${timestamp}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    logAuditEvent(req, "PROJECT_EXPORT_SUCCESS", "projects", projectId, {
      name: projectData.name,
    });
    logger.info(`[PROJ] Project ${projectId} exported successfully by user ${userId}.`);
    logger.timeEnd(`[PROJ] Export ${projectId}`);
    res.json(exportData);
  } catch (error) {
    logger.timeEnd(`[PROJ] Export ${projectId}`);
    logger.error(`[PROJ] Failed to export project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_EXPORT_FAILURE", "projects", projectId, {
      name: req.project?.name || projectId,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`/projects/${projectId}/edit?error=Failed to export project.`);
  }
});

router.post("/:projectId/delete", async (req, res) => {
  const projectId = req.params.projectId;
  const projectName = req.project.name;
  const userId = req.session.user.id;
  const BATCH_SIZE = 200;
  logger.warn(`[PROJ] POST /projects/${projectId}/delete initiated by user ${userId}. Project: ${projectName}`);
  logger.time(`[PROJ] POST /projects/${projectId}/delete ${userId}`);

  try {
    logAuditEvent(req, "PROJECT_DELETE_STARTED", "projects", projectId, {
      name: projectName,
    });

    const relatedCollections = ["entries_main", "entries_archived", "templates", "documentation_headers", "documentation_footers", "changelog_headers", "changelog_footers", "entries_previews", "feedback_votes"];

    for (const collectionName of relatedCollections) {
      let page = 1;
      let itemsToDelete;
      let deletedInCollection = 0;
      logger.info(`[PROJ][Delete ${projectId}] Starting deletion for collection: ${collectionName}`);
      logger.time(`[PROJ][Delete ${projectId}] Collection ${collectionName}`);
      do {
        try {
          itemsToDelete = { items: [], totalPages: 0 };
          logger.trace(`[PROJ][Delete ${projectId}] Fetching batch ${page} from ${collectionName}`);

          if (collectionName === "entries_previews" || collectionName === "feedback_votes") {
            const projectEntryIds = await pbAdmin.collection("entries_main").getFullList({
              filter: `project = '${projectId}'`,
              fields: "id",
              $autoCancel: false,
            });

            if (projectEntryIds.length > 0) {
              const entryIdFilter = projectEntryIds.map((e) => `entry = '${e.id}'`).join(" || ");
              itemsToDelete = await pbAdmin.collection(collectionName).getList(page, BATCH_SIZE, {
                filter: entryIdFilter,
                fields: "id",
                $autoCancel: false,
              });
            } else {
              logger.trace(`[PROJ][Delete ${projectId}] No related entries found for ${collectionName} cleanup.`);
            }
          } else {
            itemsToDelete = await pbAdmin.collection(collectionName).getList(page, BATCH_SIZE, {
              filter: `project = '${projectId}'`,
              fields: "id,original_id",
              $autoCancel: false,
            });
          }

          if (itemsToDelete.items.length > 0) {
            logger.debug(`[PROJ][Delete ${projectId}] Deleting batch of ${itemsToDelete.items.length} from ${collectionName}`);
            const deletePromises = [];
            for (const item of itemsToDelete.items) {
              if (collectionName === "entries_main") {
                clearEntryViewLogs(item.id);
              } else if (collectionName === "entries_archived") {
                clearEntryViewLogs(item.original_id || item.id);
              }
              deletePromises.push(pbAdmin.collection(collectionName).delete(item.id));
            }
            await Promise.all(deletePromises);
            deletedInCollection += itemsToDelete.items.length;
            logger.trace(`[PROJ][Delete ${projectId}] Deleted batch from ${collectionName}. Total this collection: ${deletedInCollection}`);
          } else {
            logger.trace(`[PROJ][Delete ${projectId}] No items found in batch ${page} for ${collectionName}`);
          }
        } catch (batchError) {
          logger.error(`[PROJ][Delete ${projectId}] Error deleting batch from ${collectionName}: Status ${batchError?.status || "N/A"}`, batchError?.message || batchError);
          logAuditEvent(req, "PROJECT_DELETE_CASCADE_ERROR", collectionName, null, {
            projectId: projectId,
            error: batchError?.message,
          });
          if (batchError?.status === 401 || batchError?.status === 403) {
            throw batchError;
          }
        }
        page++;
      } while (itemsToDelete && itemsToDelete.items.length === BATCH_SIZE);
      logger.timeEnd(`[PROJ][Delete ${projectId}] Collection ${collectionName}`);
      logger.info(`[PROJ][Delete ${projectId}] Finished deletion for ${collectionName}. Total deleted: ${deletedInCollection}`);
    }

    logger.info(`[PROJ][Delete ${projectId}] Deleting project record itself.`);
    await pbAdmin.collection("projects").delete(projectId);

    logger.warn(`[PROJ] Project ${projectId} (${projectName}) and all associated data deleted successfully by user ${userId}.`);
    logAuditEvent(req, "PROJECT_DELETE_COMPLETE", "projects", projectId, {
      name: projectName,
    });
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/delete ${userId}`);
    res.redirect("/projects?message=Project and all associated data deleted successfully.");
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/delete ${userId}`);
    logger.error(`[PROJ] Failed to delete project ${projectId} or its related data: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_DELETE_FAILURE", "projects", projectId, {
      name: projectName,
      error: error?.message,
    });
    res.redirect(`/projects?error=Failed to delete project. Check logs. Error: ${encodeURIComponent(error.message || "Unknown error")}`);
  }
});

export default router;
