import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import path from "node:path";
import Papa from "papaparse";
import { pb, pbAdmin, apiLimiter, getSettings, APP_SETTINGS_RECORD_ID, ITEMS_PER_PAGE, POCKETBASE_URL } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getEntryForOwnerAndProject, getArchivedEntryForOwnerAndProject, getTemplateForEditAndProject, clearEntryViewLogs, hashPreviewPassword, logAuditEvent, getProjectForOwner, getDocumentationHeaderForEditAndProject, getDocumentationFooterForEditAndProject, getChangelogHeaderForEditAndProject, getChangelogFooterForEditAndProject, getIP, hashIP } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();
const imageFieldName = "files";
const collectionName = "entries_main";

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
      logger.trace(`[API] Image upload allowed for file: ${file.originalname}`);
      return cb(null, true);
    }
    const errorMsg = `Error: File upload only supports the following filetypes - ${filetypes}`;
    logger.warn(`[API] Image upload rejected: ${file.originalname} - ${errorMsg}`);
    cb(new Error(errorMsg));
  },
});

router.use(apiLimiter);

async function checkProjectAccessApi(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[API] checkProjectAccessApi called for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[API] Project ID is required in checkProjectAccessApi.");
    return res.status(400).json({
      error: "Project ID is required.",
    });
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    req.project = project;
    logger.debug(`[API] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    if (error.status === 403) {
      logger.warn(`[API] Forbidden access attempt by user ${userId} to project ${projectId}.`);
      return res.status(403).json({
        error: "Forbidden",
      });
    }
    if (error.status === 404) {
      logger.warn(`[API] Project ${projectId} not found for user ${userId}.`);
      return res.status(404).json({
        error: "Project not found",
      });
    }
    logger.error(`[API] Error checking project access for ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    return res.status(500).json({
      error: "Internal server error checking project access.",
    });
  }
}

router.get("/projects", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[API] GET /projects requested by user ${userId}`);
  logger.time(`[API] GET /projects ${userId}`);
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "name";
    const searchTerm = req.query.search;

    const filterParts = [`owner = '${userId}'`];

    if (searchTerm && searchTerm.trim() !== "") {
      const escapedSearch = searchTerm.trim().replace(/'/g, "''");
      filterParts.push(`(name ~ '${escapedSearch}' || description ~ '${escapedSearch}')`);
      logger.trace(`[API] Adding search term to filter: ${escapedSearch}`);
    }

    const combinedFilter = filterParts.join(" && ");
    logger.trace(`[API] Projects filter: ${combinedFilter}`);

    const resultList = await pb.collection("projects").getList(page, perPage, {
      filter: combinedFilter,
      sort: sort,
    });
    logger.debug(`[API] Fetched ${resultList.items.length} projects (page ${page}/${resultList.totalPages}) for user ${userId}`);

    const projectsWithDetails = [];
    for (const project of resultList.items) {
      projectsWithDetails.push({
        ...project,
        formattedUpdated: new Date(project.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    logger.timeEnd(`[API] GET /projects ${userId}`);
    res.json({
      ...resultList,
      items: projectsWithDetails,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /projects ${userId}`);
    logger.error(`[API] Error fetching projects list for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "API_PROJECT_LIST_FAILURE", "projects", null, {
      error: error?.message,
    });
    res.status(500).json({
      error: "Failed to fetch projects list",
    });
  }
});

router.get("/projects/:projectId/entries", requireLogin, checkProjectAccessApi, async (req, res) => {
  const userId = req.session.user.id;
  const projectId = req.params.projectId;
  const entryType = req.query.type;
  logger.debug(`[API] GET /projects/${projectId}/entries requested by user ${userId}, type: ${entryType}`);
  logger.time(`[API] GET /projects/${projectId}/entries ${userId} ${entryType}`);

  if (!entryType || !["documentation", "changelog", "roadmap", "knowledge_base", "sidebar_header"].includes(entryType)) {
    logger.warn(`[API] Invalid or missing entry type filter for project ${projectId}: ${entryType}`);
    logger.timeEnd(`[API] GET /projects/${projectId}/entries ${userId} ${entryType}`);
    return res.status(400).json({
      error: "Invalid or missing entry type filter.",
    });
  }

  try {
    const baseFilterParts = [`owner = '${userId}'`, `project = '${projectId}'`, `type = '${entryType}'`];
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-content_updated_at";
    const statusFilter = req.query.status;
    const collectionFilter = req.query.collection;
    const searchTerm = req.query.search;

    if (statusFilter && ["published", "draft"].includes(statusFilter)) {
      baseFilterParts.push(`status = '${statusFilter}'`);
      logger.trace(`[API] Adding status filter: ${statusFilter}`);
    }

    if (collectionFilter && collectionFilter.trim() !== "") {
      const escapedCollection = collectionFilter.replace(/'/g, "''");
      baseFilterParts.push(`collection = '${escapedCollection}'`);
      logger.trace(`[API] Adding collection filter: ${escapedCollection}`);
    }

    if (searchTerm && searchTerm.trim() !== "") {
      const escapedSearch = searchTerm.trim().replace(/'/g, "''");
      const searchFilter = `(title ~ '${escapedSearch}' || collection ~ '${escapedSearch}' || tags ~ '${escapedSearch}')`;
      baseFilterParts.push(searchFilter);
      logger.trace(`[API] Adding search term filter: ${escapedSearch}`);
    }

    const combinedFilter = baseFilterParts.join(" && ");
    logger.trace(`[API] Entries filter: ${combinedFilter}`);

    const resultList = await pb.collection("entries_main").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
      fields: "id,title,status,type,collection,views,updated,owner,has_staged_changes,tags,roadmap_stage,total_view_duration,view_duration_count,helpful_yes,helpful_no,content_updated_at",
    });
    logger.debug(`[API] Fetched ${resultList.items.length} ${entryType} entries (page ${page}/${resultList.totalPages}) for project ${projectId}`);

    const entriesWithDetails = [];
    for (const entry of resultList.items) {
      if (!entry || !entry.id) {
        logger.warn(`[API] Skipping entry in response due to missing ID for project ${projectId}:`, entry);
        continue;
      }
      entriesWithDetails.push({
        ...entry,
        viewUrl: entryType !== "roadmap" && entryType !== "knowledge_base" && entryType !== "sidebar_header" ? `/view/${entry.id}` : null,
        formattedUpdated: new Date(entry.content_updated_at || entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        has_staged_changes: entry.has_staged_changes ?? false,
        systemUpdatedAt: entry.updated,
      });
    }

    logger.timeEnd(`[API] GET /projects/${projectId}/entries ${userId} ${entryType}`);
    res.json({
      page: resultList.page,
      perPage: resultList.perPage,
      totalItems: resultList.totalItems,
      totalPages: resultList.totalPages,
      items: entriesWithDetails,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /projects/${projectId}/entries ${userId} ${entryType}`);
    logger.error(`[API] Error fetching entries for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    if (error?.data?.message?.includes("filter")) {
      logger.error("[API] PocketBase filter error details:", error.data);
      return res.status(400).json({
        error: "Invalid search or filter criteria.",
      });
    }
    res.status(500).json({
      error: "Failed to fetch entries",
    });
  }
});

router.get("/projects/:projectId/check-entry-id/:entryId", requireLogin, checkProjectAccessApi, async (req, res) => {
  const { projectId, entryId } = req.params;
  logger.debug(`[API] Checking entry ID availability for ${entryId} in project ${projectId}`);

  if (!entryId || typeof entryId !== "string" || entryId.length !== 15) {
    logger.warn(`[API] Invalid entry ID format for check: ${entryId}`);
    return res.status(400).json({
      available: false,
      reason: "Invalid ID format (must be 15 characters).",
    });
  }

  try {
    await pbAdmin.collection("entries_main").getOne(entryId, {
      fields: "id",
      $autoCancel: false,
    });
    logger.debug(`[API] Entry ID ${entryId} exists.`);
    logAuditEvent(req, "ENTRY_ID_CHECK_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      reason: "ID already exists",
    });
    res.json({
      available: false,
      reason: "ID already exists",
    });
  } catch (error) {
    if (error?.status === 404) {
      logger.debug(`[API] Entry ID ${entryId} is available.`);
      logAuditEvent(req, "ENTRY_ID_CHECK_SUCCESS", "entries_main", entryId, {
        projectId: projectId,
        reason: "ID available",
      });
      res.json({
        available: true,
      });
    } else {
      logger.error(`[API] Error checking entry ID ${entryId} availability: Status ${error?.status || "N/A"}`, error?.message || error);
      if (error?.data) {
        logger.error("[API] PocketBase Error Data:", error.data);
      }
      logAuditEvent(req, "ENTRY_ID_CHECK_ERROR", "entries_main", entryId, {
        projectId: projectId,
        error: error?.message,
        status: error?.status,
      });
      res.status(500).json({
        available: false,
        reason: "Server error checking availability",
      });
    }
  }
});

router.post("/projects/:projectId/entries/:id/publish-staged", requireLogin, checkProjectAccessApi, async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.info(`[API] Attempting to publish staged changes for entry ${entryId} in project ${projectId} by user ${userId}`);
  logger.time(`[API] POST /publish-staged ${entryId}`);

  try {
    const record = await pbAdmin.collection("entries_main").getOne(entryId);

    if (record.owner !== userId || record.project !== projectId) {
      logger.warn(`[API] Forbidden attempt to publish staged changes for entry ${entryId} by user ${userId}.`);
      logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Forbidden",
      });
      logger.timeEnd(`[API] POST /publish-staged ${entryId}`);
      return res.status(403).json({
        error: "Forbidden",
      });
    }

    if (record.status !== "published" || !record.has_staged_changes) {
      logger.warn(`[API] Attempt to publish staged changes for entry ${entryId}, but not published or no staged changes. Status: ${record.status}, HasStaged: ${record.has_staged_changes}`);
      logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Not published or no staged changes",
      });
      logger.timeEnd(`[API] POST /publish-staged ${entryId}`);
      return res.status(400).json({
        error: "Entry is not published or has no staged changes.",
      });
    }

    const updateData = {
      title: record.staged_title,
      type: record.staged_type,
      content: record.staged_content,
      tags: record.staged_tags,
      custom_documentation_header: record.staged_type === "documentation" ? record.staged_documentation_header || null : record.custom_documentation_header,
      custom_documentation_footer: record.staged_type === "documentation" ? record.staged_documentation_footer || null : record.custom_documentation_footer,
      custom_changelog_header: record.staged_type === "changelog" ? record.staged_changelog_header || null : record.custom_changelog_header,
      custom_changelog_footer: record.staged_type === "changelog" ? record.staged_changelog_footer || null : record.custom_changelog_footer,
      roadmap_stage: record.staged_type === "roadmap" ? record.staged_roadmap_stage || null : record.roadmap_stage,
      has_staged_changes: false,
      staged_title: null,
      staged_type: null,
      staged_content: null,
      staged_tags: null,
      staged_collection: null,
      staged_documentation_header: null,
      staged_documentation_footer: null,
      staged_changelog_header: null,
      staged_changelog_footer: null,
      staged_roadmap_stage: null,
      content_updated_at: new Date().toISOString(),
    };
    logger.debug(`[API] Publishing staged changes for entry ${entryId} with data:`, {
      title: updateData.title,
      type: updateData.type,
    });

    await pbAdmin.collection("entries_main").update(entryId, updateData);
    logAuditEvent(req, "ENTRY_PUBLISH_STAGED", "entries_main", entryId, {
      projectId: projectId,
      title: updateData.title,
      type: updateData.type,
      stage: updateData.roadmap_stage,
    });
    logger.info(`[API] Staged changes published successfully for entry ${entryId}.`);
    logger.timeEnd(`[API] POST /publish-staged ${entryId}`);
    res.status(200).json({
      message: "Staged changes published successfully.",
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /publish-staged ${entryId}`);
    logger.error(`[API] Error publishing staged changes for entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({
        error: "Entry not found.",
      });
    }
    if (error.status === 403) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }
    res.status(500).json({
      error: "Failed to publish staged changes.",
    });
  }
});

router.post("/projects/:projectId/entries/:id/generate-preview", requireLogin, checkProjectAccessApi, async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { password } = req.body;
  const hasPassword = password && password.trim() !== "";
  const settings = getSettings();
  const previewTokenExpiryHours = settings.previewTokenExpiryHours;
  logger.info(`[API] Attempting to generate preview link for entry ${entryId} in project ${projectId} by user ${userId}. Has Password: ${hasPassword}`);
  logger.time(`[API] POST /generate-preview ${entryId}`);

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);

    if (entry.status !== "draft") {
      logger.warn(`[API] Preview generation failed for entry ${entryId}: Not a draft (status: ${entry.status}).`);
      logAuditEvent(req, "PREVIEW_GENERATE_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Not a draft",
      });
      logger.timeEnd(`[API] POST /generate-preview ${entryId}`);
      return res.status(400).json({
        error: "Preview links can only be generated for drafts.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + previewTokenExpiryHours);

    let passwordHash = null;
    if (hasPassword) {
      passwordHash = hashPreviewPassword(password);
      if (!passwordHash) {
        logger.error(`[API] Failed to hash preview password for entry ${entryId}.`);
        throw new Error("Failed to hash preview password.");
      }
      logger.trace(`[API] Preview password hashed for entry ${entryId}.`);
    }

    const previewData = {
      entry: entryId,
      token: token,
      expires_at: expiresAt.toISOString(),
      password_hash: passwordHash,
    };

    try {
      logger.debug(`[API] Cleaning up old preview tokens for entry ${entryId}.`);
      const oldTokens = await pbAdmin.collection("entries_previews").getFullList({
        filter: `entry = '${entryId}'`,
        fields: "id",
      });
      if (oldTokens.length > 0) {
        logger.trace(`[API] Found ${oldTokens.length} old tokens to delete.`);
        for (const oldToken of oldTokens) {
          await pbAdmin.collection("entries_previews").delete(oldToken.id);
        }
        logger.debug(`[API] Old preview tokens deleted for entry ${entryId}.`);
      } else {
        logger.trace(`[API] No old preview tokens found for entry ${entryId}.`);
      }
    } catch (cleanupError) {
      logger.warn(`[API] Could not clean up old preview tokens for entry ${entryId}: ${cleanupError.message}`);
    }

    logger.debug(`[API] Creating new preview record for entry ${entryId}.`);
    const previewRecord = await pbAdmin.collection("entries_previews").create(previewData);
    const previewUrl = `${req.protocol}://${req.get("host")}/preview/${token}`;
    logAuditEvent(req, "PREVIEW_GENERATE_SUCCESS", "entries_previews", previewRecord.id, {
      projectId: projectId,
      entryId: entryId,
      hasPassword: !!passwordHash,
    });
    logger.info(`[API] Preview link generated successfully for entry ${entryId}: ${previewUrl}`);

    logger.timeEnd(`[API] POST /generate-preview ${entryId}`);
    res.status(201).json({
      previewUrl: previewUrl,
      expiresAt: expiresAt.toISOString(),
      hasPassword: !!passwordHash,
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /generate-preview ${entryId}`);
    logger.error(`[API] Error generating preview link for entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PREVIEW_GENERATE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({
        error: "Entry not found",
      });
    }
    if (error.status === 403) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }
    if (error?.data?.data?.token?.code === "validation_not_unique") {
      logger.error("[API] Preview token collision occurred.");
      return res.status(500).json({
        error: "Failed to generate unique token, please try again.",
      });
    }
    res.status(500).json({
      error: "Failed to generate preview link",
    });
  }
});

router.post("/projects/:projectId/entries/bulk-action", requireLogin, checkProjectAccessApi, async (req, res) => {
  const { action, ids } = req.body;
  const userId = req.session.user.id;
  const projectId = req.params.projectId;
  logger.info(`[API] Bulk action requested: Action=${action}, Count=${ids?.length}, Project=${projectId}, User=${userId}`);
  logger.time(`[API] POST /bulk-action ${action} ${projectId}`);

  if (!action || !Array.isArray(ids) || ids.length === 0) {
    logger.warn("[API] Invalid bulk action request: Missing action or ids.");
    logger.timeEnd(`[API] POST /bulk-action ${action} ${projectId}`);
    return res.status(400).json({
      error: "Invalid request: 'action' and 'ids' array are required.",
    });
  }

  const validActions = ["archive", "unarchive", "delete", "permanent-delete"];
  if (!validActions.includes(action)) {
    logger.warn(`[API] Invalid bulk action specified: ${action}`);
    logger.timeEnd(`[API] POST /bulk-action ${action} ${projectId}`);
    return res.status(400).json({
      error: `Invalid bulk action: ${action}`,
    });
  }

  const results = [];
  const client = pbAdmin;
  const actionDetails = {
    bulkAction: action,
    requestedIds: ids,
    projectId: projectId,
  };

  for (const id of ids) {
    let record;
    let sourceCollectionName;
    let targetCollectionName = null;
    const logActionType = `BULK_${action.toUpperCase()}`;
    const logDetails = {
      id: id,
      projectId: projectId,
    };
    logger.trace(`[API] Processing bulk action '${action}' for ID: ${id}`);

    try {
      if (action === "unarchive" || action === "permanent-delete") {
        sourceCollectionName = "entries_archived";
        record = await getArchivedEntryForOwnerAndProject(id, userId, projectId);
      } else {
        sourceCollectionName = "entries_main";
        record = await getEntryForOwnerAndProject(id, userId, projectId);
      }
      logger.trace(`[API] Fetched record ${id} from ${sourceCollectionName}`);

      if (action === "archive") targetCollectionName = "entries_archived";
      else if (action === "unarchive") targetCollectionName = "entries_main";

      logDetails.title = record.title;
      logDetails.type = record.type;
      logDetails.stage = record.roadmap_stage;

      switch (action) {
        case "archive": {
          if (sourceCollectionName !== "entries_main" || !targetCollectionName) {
            throw new Error("Invalid state for archive action.");
          }
          const archiveData = {
            ...record,
            original_id: record.id,
            custom_documentation_header: record.custom_documentation_header || null,
            custom_documentation_footer: record.custom_documentation_footer || null,
            custom_changelog_header: record.custom_changelog_header || null,
            custom_changelog_footer: record.custom_changelog_footer || null,
            roadmap_stage: record.roadmap_stage || null,
            content_updated_at: record.content_updated_at,
          };
          archiveData.id = undefined;
          archiveData.collectionId = undefined;
          archiveData.collectionName = undefined;
          archiveData.files = undefined;
          archiveData.has_staged_changes = false;
          archiveData.staged_title = null;
          archiveData.staged_type = null;
          archiveData.staged_content = null;
          archiveData.staged_tags = null;
          archiveData.staged_collection = null;
          archiveData.staged_documentation_header = null;
          archiveData.staged_documentation_footer = null;
          archiveData.staged_changelog_header = null;
          archiveData.staged_changelog_footer = null;
          archiveData.staged_roadmap_stage = null;
          logger.debug(`[API] Archiving entry ${id}`);
          const archivedRecord = await client.collection(targetCollectionName).create(archiveData);
          await client.collection(sourceCollectionName).delete(id);
          logDetails.archivedId = archivedRecord.id;
          break;
        }
        case "delete": {
          if (sourceCollectionName !== "entries_main") {
            throw new Error("Delete action only for main entries via bulk.");
          }
          logger.debug(`[API] Deleting entry ${id}`);
          await client.collection(sourceCollectionName).delete(id);
          clearEntryViewLogs(id);
          break;
        }
        case "permanent-delete": {
          if (sourceCollectionName !== "entries_archived") {
            throw new Error("Permanent delete only for archived via bulk.");
          }
          const idToClean = record.original_id || id;
          logger.debug(`[API] Permanently deleting archived entry ${id} (original ID: ${idToClean})`);
          await client.collection(sourceCollectionName).delete(id);
          clearEntryViewLogs(idToClean);
          logDetails.originalId = record.original_id;
          break;
        }
        default:
          throw new Error(`Unhandled bulk action: ${action}`);
      }

      logAuditEvent(req, logActionType, sourceCollectionName, id, logDetails);
      results.push({
        id,
        status: "fulfilled",
        action,
      });
      logger.trace(`[API] Bulk action '${action}' succeeded for ID: ${id}`);
    } catch (error) {
      logger.warn(`[API] Bulk action '${action}' failed for entry ${id} in project ${projectId} by user ${userId}: Status ${error?.status || "N/A"} ${error.message}`);
      logAuditEvent(req, `${logActionType}_FAILURE`, sourceCollectionName, id, {
        ...logDetails,
        error: error?.message,
        status: error?.status,
      });
      results.push({
        id,
        status: "rejected",
        action,
        reason: error.message || "Unknown error",
        statusCode: error.status || 500,
      });
    }
  }

  const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
  const rejectedResults = results.filter((r) => r.status === "rejected");
  const skippedCount = results.filter((r) => r.status === "skipped").length;

  let message = "";
  let status = 200;

  if (rejectedResults.length === 0 && skippedCount === 0) {
    message = `Successfully performed action '${action}' on ${fulfilledCount} entries.`;
    logger.info(`[API] Bulk action '${action}' completed successfully for ${fulfilledCount} entries in project ${projectId}.`);
    logAuditEvent(req, `BULK_${action.toUpperCase()}_COMPLETE`, null, null, {
      ...actionDetails,
      successCount: fulfilledCount,
      failureCount: 0,
      skippedCount: 0,
    });
  } else {
    status = 207;
    message = `Bulk action '${action}' summary: ${fulfilledCount} succeeded`;
    if (rejectedResults.length > 0) {
      message += `, ${rejectedResults.length} failed`;
    }
    if (skippedCount > 0) {
      message += `, ${skippedCount} skipped (inapplicable)`;
    }
    message += ".";
    logger.warn(`[API] Bulk action '${action}' completed with issues for project ${projectId}. Succeeded: ${fulfilledCount}, Failed: ${rejectedResults.length}, Skipped: ${skippedCount}.`);
    logAuditEvent(req, `BULK_${action.toUpperCase()}_PARTIAL`, null, null, {
      ...actionDetails,
      successCount: fulfilledCount,
      failureCount: rejectedResults.length,
      skippedCount: skippedCount,
      errors: rejectedResults,
    });
  }

  logger.timeEnd(`[API] POST /bulk-action ${action} ${projectId}`);
  res.status(status).json({
    message: message,
    errors: rejectedResults.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.statusCode,
    })),
    skipped: results.filter((r) => r.status === "skipped").map((r) => ({ id: r.id, reason: r.reason })),
  });
});

router.get("/projects/:projectId/templates", requireLogin, checkProjectAccessApi, async (req, res) => {
  const userId = req.session.user.id;
  const projectId = req.params.projectId;
  logger.debug(`[API] GET /projects/${projectId}/templates requested by user ${userId}`);
  logger.time(`[API] GET /projects/${projectId}/templates ${userId}`);
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";
    logger.trace(`[API] Templates filter: ${filter}`);

    const resultList = await pb.collection("templates").getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[API] Fetched ${resultList.items.length} templates (page ${page}/${resultList.totalPages}) for project ${projectId}`);

    const templatesWithDetails = [];
    for (const template of resultList.items) {
      templatesWithDetails.push({
        ...template,
        formattedUpdated: new Date(template.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    logger.timeEnd(`[API] GET /projects/${projectId}/templates ${userId}`);
    res.json({
      ...resultList,
      items: templatesWithDetails,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /projects/${projectId}/templates ${userId}`);
    logger.error(`[API] Error fetching templates for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    res.status(500).json({
      error: "Failed to fetch templates",
    });
  }
});

router.get("/projects/:projectId/templates/:id", requireLogin, checkProjectAccessApi, async (req, res) => {
  const templateId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[API] GET /projects/${projectId}/templates/${templateId} requested by user ${userId}`);
  logger.time(`[API] GET /projects/${projectId}/templates/${templateId}`);

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    logger.debug(`[API] Template ${templateId} content fetched successfully.`);
    logger.timeEnd(`[API] GET /projects/${projectId}/templates/${templateId}`);
    res.json({
      content: template.content,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /projects/${projectId}/templates/${templateId}`);
    logger.error(`[API] Error fetching template ${templateId} for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    if (error.status === 404 || error.status === 403) {
      return res.status(error.status).json({
        error: error.message,
      });
    }
    res.status(500).json({
      error: "Failed to fetch template content",
    });
  }
});

router.post("/set-theme", requireLogin, (req, res) => {
  const { theme } = req.body;
  const userId = req.session.user.id;
  logger.debug(`[API] POST /set-theme requested by user ${userId}, theme: ${theme}`);
  if (theme === "light" || theme === "dark") {
    req.session.theme = theme;
    logAuditEvent(req, "THEME_SET", null, null, {
      theme: theme,
    });
    logger.info(`[API] Theme preference updated to ${theme} for user ${userId}`);
    res.status(200).json({
      message: `Theme preference updated to ${theme}`,
    });
  } else {
    logger.warn(`[API] Invalid theme value provided by user ${userId}: ${theme}`);
    logAuditEvent(req, "THEME_SET_FAILURE", null, null, {
      theme: theme,
      reason: "Invalid theme value",
    });
    res.status(400).json({
      error: "Invalid theme value provided.",
    });
  }
});

router.post("/feedback", apiLimiter, async (req, res) => {
  const { entryId, voteType } = req.body;
  logger.debug(`[API] Received feedback vote: Entry=${entryId}, Type=${voteType}`);
  logger.time(`[API] POST /feedback ${entryId} ${voteType}`);
  if (!entryId || !voteType || !["yes", "no"].includes(voteType)) {
    logger.warn("[API] Invalid feedback request data:", req.body);
    logger.timeEnd(`[API] POST /feedback ${entryId} ${voteType}`);
    return res.status(400).json({ error: "Invalid data provided." });
  }
  const ipAddress = getIP(req);
  const hashedIp = hashIP(ipAddress);
  if (!hashedIp) {
    logger.warn(`[API] Could not get/hash IP for feedback on entry ${entryId}. Rejecting.`);
    logger.timeEnd(`[API] POST /feedback ${entryId} ${voteType}`);
    return res.status(400).json({ error: "Could not process request." });
  }
  try {
    const entry = await pbAdmin.collection("entries_main").getOne(entryId, { fields: "id, project" });
    const projectId = entry.project;
    logger.trace(`[API] Checking for existing vote for entry ${entryId}, hash ${hashedIp}`);
    try {
      await pbAdmin.collection("feedback_votes").getFirstListItem(`entry = '${entryId}' && voter_hash = '${hashedIp}'`, { $autoCancel: false });
      logger.info(`[API] Duplicate feedback attempt detected for entry ${entryId}, hash ${hashedIp}.`);
      logAuditEvent(req, "FEEDBACK_VOTE_DUPLICATE", "feedback_votes", null, {
        entryId: entryId,
        voteType: voteType,
        projectId: projectId,
      });
      logger.timeEnd(`[API] POST /feedback ${entryId} ${voteType}`);
      return res.status(409).json({ message: "Feedback already submitted." });
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
      logger.trace(`[API] No existing vote found for entry ${entryId}, hash ${hashedIp}. Proceeding.`);
    }
    const voteData = {
      entry: entryId,
      vote_type: voteType,
      voter_hash: hashedIp,
      project: projectId,
    };
    logger.debug("[API] Creating feedback vote record:", voteData);
    const voteRecord = await pbAdmin.collection("feedback_votes").create(voteData);
    const counterField = voteType === "yes" ? "helpful_yes" : "helpful_no";
    logger.debug(`[API] Incrementing ${counterField} for entry ${entryId}`);
    await pbAdmin.collection("entries_main").update(entryId, { [`${counterField}+`]: 1 });
    logAuditEvent(req, "FEEDBACK_VOTE_SUCCESS", "feedback_votes", voteRecord.id, {
      entryId: entryId,
      voteType: voteType,
      projectId: projectId,
    });
    logger.info(`[API] Feedback vote recorded successfully for entry ${entryId}, type ${voteType}.`);
    logger.timeEnd(`[API] POST /feedback ${entryId} ${voteType}`);
    res.status(201).json({ message: "Feedback submitted successfully." });
  } catch (error) {
    logger.timeEnd(`[API] POST /feedback ${entryId} ${voteType}`);
    logger.error(`[API] Error processing feedback for entry ${entryId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "FEEDBACK_VOTE_FAILURE", "feedback_votes", null, {
      entryId: entryId,
      voteType: voteType,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found." });
    }
    res.status(500).json({ error: "Failed to submit feedback." });
  }
});

router.post("/projects/:projectId/entries/:id/upload-image", requireLogin, checkProjectAccessApi, upload.single("image"), async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const imageFieldName = "files";
  const originalFilename = req.file?.originalname;
  const collectionName = "entries_main";
  logger.info(`[API] Attempting image upload for entry ${entryId}, project ${projectId}, user ${userId}. File: ${originalFilename}`);
  logger.time(`[API] POST /upload-image ${entryId}`);

  if (!req.file) {
    logger.warn(`[API] Image upload failed for entry ${entryId}: No file provided.`);
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", collectionName, entryId, {
      projectId: projectId,
      reason: "No file uploaded",
    });
    logger.timeEnd(`[API] POST /upload-image ${entryId}`);
    return res.status(400).json({
      error: "No image file provided.",
    });
  }

  try {
    const entryBeforeUpdate = await getEntryForOwnerAndProject(entryId, userId, projectId);
    const existingFileCount = (entryBeforeUpdate[imageFieldName] || []).length;
    logger.trace(`[API] Existing file count for entry ${entryId}: ${existingFileCount}`);

    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    form.append(`${imageFieldName}+`, blob, req.file.originalname);
    logger.debug(`[API] Prepared FormData for appending image to entry ${entryId}. Key: ${imageFieldName}+`);

    await pb.collection(collectionName).update(entryId, form);
    logger.debug(`[API] PocketBase update successful for entry ${entryId} image append.`);

    logger.trace(`[API] Re-fetching entry ${entryId} to confirm new file list.`);
    const updatedRecord = await pb.collection(collectionName).getOne(entryId, { fields: `id,${imageFieldName}` });
    const newFiles = updatedRecord[imageFieldName] || [];
    logger.trace(`[API] New file list after refetch for entry ${entryId}: ${newFiles.join(", ")}`);

    let actualFilename = null;
    if (newFiles.length > existingFileCount && newFiles.length > 0) {
      actualFilename = newFiles[newFiles.length - 1];
      logger.trace(`[API] Determined appended filename (last in list): ${actualFilename}`);
    } else {
      logger.error(`[API] Could not determine the actual filename after append for entry ${entryId}. Original: ${originalFilename}. File list size didn't increase as expected or list is empty. New list: ${newFiles.join(", ")}`);
      throw new Error("Failed to confirm stored filename after upload append.");
    }

    const fileUrl = `${POCKETBASE_URL}/api/files/${collectionName}/${entryId}/${actualFilename}`;
    logger.trace(`[API] Manually constructed file URL: ${fileUrl}`);

    logAuditEvent(req, "IMAGE_UPLOAD_SUCCESS", collectionName, entryId, {
      projectId: projectId,
      field: imageFieldName,
      filename: actualFilename,
      url: fileUrl,
    });
    logger.info(`[API] Image uploaded successfully for entry ${entryId}: ${actualFilename}`);

    logger.timeEnd(`[API] POST /upload-image ${entryId}`);
    res.status(200).json({
      data: {
        filePath: fileUrl,
        filename: actualFilename,
      },
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /upload-image ${entryId}`);
    logger.error(`[API] Error uploading image for entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);

    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", collectionName, entryId, {
      projectId: projectId,
      field: imageFieldName,
      filename: originalFilename,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({
        error: "Entry not found.",
      });
    }
    if (error.status === 403) {
      return res.status(403).json({
        error: "Forbidden.",
      });
    }
    if (error?.data?.data?.[imageFieldName]) {
      const validationError = error.data.data[imageFieldName].message;
      logger.warn(`[API] Image upload validation failed: ${validationError}`);
      return res.status(400).json({
        error: `Upload validation failed: ${validationError}`,
      });
    }
    const errorMessage = error.message || "Failed to upload image.";
    res.status(500).json({
      error: errorMessage,
    });
  }
});

router.get("/files", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const settings = getSettings();
  logger.debug(`[API] GET /files requested by user ${userId}. Size calc enabled: ${settings.enableFileSizeCalculation}`);
  logger.time(`[API] GET /files ${userId}`);

  try {
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sortField = req.query.sort || "-created";

    logger.time(`[API] FetchEntriesWithFiles ${userId}`);
    const allEntriesWithFiles = await pb.collection(collectionName).getFullList({
      filter: `owner = '${userId}' && files != null && files != ""`,
      fields: "id, title, project, files, created, updated, expand, content_updated_at",
      expand: "project",
      sort: sortField.startsWith("project.") ? "-created" : sortField.startsWith("entry.") ? "-created" : sortField.startsWith("created") ? "-content_updated_at" : sortField,
      $autoCancel: false,
    });
    logger.timeEnd(`[API] FetchEntriesWithFiles ${userId}`);
    logger.debug(`[API] Found ${allEntriesWithFiles.length} entries with files for user ${userId}`);

    let allFiles = [];
    let totalSize = null;

    if (settings.enableFileSizeCalculation) {
      logger.debug("[API] File size calculation is ENABLED.");
      const allFilesPromises = [];
      for (const entry of allEntriesWithFiles) {
        if (entry.files && Array.isArray(entry.files)) {
          for (const filename of entry.files) {
            const fileUrl = `${POCKETBASE_URL}/api/files/${collectionName}/${entry.id}/${filename}`;
            allFilesPromises.push(
              (async () => {
                let size = 0;
                try {
                  const headResponse = await fetch(fileUrl, { method: "HEAD" });
                  if (headResponse.ok) {
                    size = Number.parseInt(headResponse.headers.get("content-length"), 10) || 0;
                  } else {
                    logger.warn(`[API] HEAD request failed for ${fileUrl}: Status ${headResponse.status}`);
                  }
                } catch (headError) {
                  logger.warn(`[API] Error fetching HEAD for ${fileUrl}: ${headError.message}`);
                }
                return {
                  entryId: entry.id,
                  entryTitle: entry.title,
                  projectId: entry.project,
                  projectName: entry.expand?.project?.name || "Unknown Project",
                  filename: filename,
                  fileUrl: fileUrl,
                  size: size,
                  created: entry.content_updated_at || entry.updated,
                };
              })(),
            );
          }
        }
      }
      logger.time(`[API] FetchFileSizes ${userId}`);
      allFiles = await Promise.all(allFilesPromises);
      logger.timeEnd(`[API] FetchFileSizes ${userId}`);
      totalSize = allFiles.reduce((sum, file) => sum + file.size, 0);
      logger.debug(`[API] Calculated total file size: ${totalSize} bytes`);
    } else {
      logger.debug("[API] File size calculation is DISABLED.");
      for (const entry of allEntriesWithFiles) {
        if (entry.files && Array.isArray(entry.files)) {
          for (const filename of entry.files) {
            allFiles.push({
              entryId: entry.id,
              entryTitle: entry.title,
              projectId: entry.project,
              projectName: entry.expand?.project?.name || "Unknown Project",
              filename: filename,
              fileUrl: `${POCKETBASE_URL}/api/files/${collectionName}/${entry.id}/${filename}`,
              size: 0,
              created: entry.content_updated_at || entry.updated,
            });
          }
        }
      }
      logger.debug(`[API] Flattened ${allFiles.length} files (no size calc) for user ${userId}`);
    }

    if (sortField.startsWith("project.name") || sortField.startsWith("entry.title") || sortField.startsWith("filename")) {
      const sortKey = sortField.startsWith("-") ? sortField.substring(1) : sortField;
      const direction = sortField.startsWith("-") ? -1 : 1;

      allFiles.sort((a, b) => {
        let valA;
        let valB;
        if (sortKey === "project.name") {
          valA = a.projectName?.toLowerCase() || "";
          valB = b.projectName?.toLowerCase() || "";
        } else if (sortKey === "entry.title") {
          valA = a.entryTitle?.toLowerCase() || "";
          valB = b.entryTitle?.toLowerCase() || "";
        } else if (sortKey === "filename") {
          valA = a.filename?.toLowerCase() || "";
          valB = b.filename?.toLowerCase() || "";
        } else {
          return 0;
        }
        if (valA < valB) return -1 * direction;
        if (valA > valB) return 1 * direction;
        return 0;
      });
      logger.trace(`[API] Manually sorted files by ${sortField}`);
    } else if (sortField.startsWith("created")) {
      logger.trace("[API] Files sorted by entry date via PocketBase");
    }

    const totalItems = allFiles.length;
    const totalPages = Math.ceil(totalItems / perPage);
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedFiles = allFiles.slice(startIndex, endIndex);

    logger.debug(`[API] Paginated files: Page ${page}/${totalPages}, Items ${paginatedFiles.length}/${totalItems}`);

    logger.timeEnd(`[API] GET /files ${userId}`);
    res.json({
      page: page,
      perPage: perPage,
      totalItems: totalItems,
      totalPages: totalPages,
      totalSize: totalSize,
      items: paginatedFiles.map((f) => ({
        ...f,
        formattedCreated: new Date(f.created).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })),
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /files ${userId}`);
    logger.error(`[API] Error fetching files list for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    res.status(500).json({
      error: "Failed to fetch files list",
    });
  }
});

router.delete("/entries/:entryId/files/:filename", requireLogin, async (req, res) => {
  const { entryId, filename } = req.params;
  const userId = req.session.user.id;
  logger.warn(`[API] DELETE /entries/${entryId}/files/${filename} requested by user ${userId}`);
  logger.time(`[API] DELETE /entries/${entryId}/files/${filename}`);

  if (!entryId || !filename) {
    logger.warn("[API] Delete file request missing entryId or filename.");
    logger.timeEnd(`[API] DELETE /entries/${entryId}/files/${filename}`);
    return res.status(400).json({ error: "Missing entry or filename." });
  }

  try {
    logger.debug(`[API] Fetching entry ${entryId} for ownership check.`);
    const entry = await pb.collection(collectionName).getOne(entryId);

    if (entry.owner !== userId) {
      logger.warn(`[API] Forbidden attempt by user ${userId} to delete file ${filename} from entry ${entryId} owned by ${entry.owner}.`);
      logAuditEvent(req, "IMAGE_DELETE_FAILURE", collectionName, entryId, {
        projectId: entry.project,
        filename: filename,
        reason: "Forbidden - User does not own entry",
      });
      logger.timeEnd(`[API] DELETE /entries/${entryId}/files/${filename}`);
      return res.status(403).json({ error: "Forbidden." });
    }
    logger.trace(`[API] Ownership verified for entry ${entryId}.`);

    const currentFiles = entry.files || [];
    if (!currentFiles.includes(filename)) {
      logger.warn(`[API] File ${filename} not found in entry ${entryId} for deletion attempt by user ${userId}.`);
      logger.timeEnd(`[API] DELETE /entries/${entryId}/files/${filename}`);
      return res.status(404).json({ error: "File not found in this entry." });
    }
    const updatedFiles = currentFiles.filter((f) => f !== filename);
    logger.debug(`[API] Updating entry ${entryId} to remove file ${filename}. New file count: ${updatedFiles.length}`);

    await pb.collection(collectionName).update(entryId, { [imageFieldName]: updatedFiles });

    logAuditEvent(req, "IMAGE_DELETE", collectionName, entryId, {
      projectId: entry.project,
      filename: filename,
    });
    logger.info(`[API] File ${filename} deleted successfully from entry ${entryId} by user ${userId}.`);

    logger.timeEnd(`[API] DELETE /entries/${entryId}/files/${filename}`);
    res.status(200).json({ message: "File deleted successfully." });
  } catch (error) {
    logger.timeEnd(`[API] DELETE /entries/${entryId}/files/${filename}`);
    logger.error(`[API] Error deleting file ${filename} from entry ${entryId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "IMAGE_DELETE_FAILURE", collectionName, entryId, {
      filename: filename,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found." });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden." });
    }
    res.status(500).json({ error: "Failed to delete file." });
  }
});

router.get("/projects/:projectId/archived-entries", requireLogin, checkProjectAccessApi, async (req, res) => {
  const userId = req.session.user.id;
  const projectId = req.params.projectId;
  const entryType = req.query.type;
  logger.debug(`[API] GET /projects/${projectId}/archived-entries requested by user ${userId}, type: ${entryType}`);
  logger.time(`[API] GET /projects/${projectId}/archived-entries ${userId} ${entryType}`);

  if (!entryType || !["documentation", "changelog", "roadmap", "knowledge_base", "sidebar_header"].includes(entryType)) {
    logger.warn(`[API] Invalid or missing entry type filter for archived entries, project ${projectId}: ${entryType}`);
    logger.timeEnd(`[API] GET /projects/${projectId}/archived-entries ${userId} ${entryType}`);
    return res.status(400).json({
      error: "Invalid or missing entry type filter.",
    });
  }

  try {
    const baseFilterParts = [`owner = '${userId}'`, `project = '${projectId}'`, `type = '${entryType}'`];
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-content_updated_at";

    const combinedFilter = baseFilterParts.join(" && ");
    logger.trace(`[API] Archived entries filter: ${combinedFilter}`);

    const resultList = await pbAdmin.collection("entries_archived").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
      fields: "id,title,status,type,updated,original_id,roadmap_stage,content_updated_at",
    });
    logger.debug(`[API] Fetched ${resultList.items.length} archived ${entryType} entries (page ${page}/${resultList.totalPages}) for project ${projectId}`);

    const entriesWithDetails = [];
    for (const entry of resultList.items) {
      entriesWithDetails.push({
        ...entry,
        formattedUpdated: new Date(entry.content_updated_at || entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        systemUpdatedAt: entry.updated,
      });
    }

    logger.timeEnd(`[API] GET /projects/${projectId}/archived-entries ${userId} ${entryType}`);
    res.json({
      ...resultList,
      items: entriesWithDetails,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /projects/${projectId}/archived-entries ${userId} ${entryType}`);
    logger.error(`[API] Error fetching archived entries for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    res.status(500).json({
      error: "Failed to fetch archived entries",
    });
  }
});

async function getProjectAssetsApi(collectionName, req, res) {
  const userId = req.session.user.id;
  const projectId = req.params.projectId;
  logger.debug(`[API] GET /projects/${projectId}/${collectionName} requested by user ${userId}`);
  logger.time(`[API] GET /projects/${projectId}/${collectionName} ${userId}`);
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";
    logger.trace(`[API] ${collectionName} filter: ${filter}`);

    const resultList = await pb.collection(collectionName).getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[API] Fetched ${resultList.items.length} ${collectionName} (page ${page}/${resultList.totalPages}) for project ${projectId}`);

    const assetsWithDetails = [];
    for (const asset of resultList.items) {
      assetsWithDetails.push({
        ...asset,
        formattedUpdated: new Date(asset.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    logger.timeEnd(`[API] GET /projects/${projectId}/${collectionName} ${userId}`);
    res.json({
      ...resultList,
      items: assetsWithDetails,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /projects/${projectId}/${collectionName} ${userId}`);
    logger.error(`[API] Error fetching ${collectionName} for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    res.status(500).json({
      error: `Failed to fetch ${collectionName.replace("_", " ")}`,
    });
  }
}

router.get("/projects/:projectId/documentation_headers", requireLogin, checkProjectAccessApi, (req, res) => {
  getProjectAssetsApi("documentation_headers", req, res);
});

router.get("/projects/:projectId/documentation_footers", requireLogin, checkProjectAccessApi, (req, res) => {
  getProjectAssetsApi("documentation_footers", req, res);
});

router.get("/projects/:projectId/changelog_headers", requireLogin, checkProjectAccessApi, (req, res) => {
  getProjectAssetsApi("changelog_headers", req, res);
});

router.get("/projects/:projectId/changelog_footers", requireLogin, checkProjectAccessApi, (req, res) => {
  getProjectAssetsApi("changelog_footers", req, res);
});

router.get("/audit-log", requireLogin, apiLimiter, async (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[API] GET /audit-log requested by user ${userId}`);
  logger.time(`[API] GET /audit-log ${userId}`);
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-created";

    const resultList = await pbAdmin.collection("audit_logs").getList(page, perPage, {
      sort: sort,
      expand: "user",
    });
    logger.debug(`[API] Fetched ${resultList.items.length} audit logs (page ${page}/${resultList.totalPages})`);

    const formattedItems = [];
    for (const log of resultList.items) {
      formattedItems.push({
        ...log,
        user_email: log.expand?.user?.email || log.user || null,
        formatted_created: new Date(log.created).toLocaleString(),
      });
    }

    logger.timeEnd(`[API] GET /audit-log ${userId}`);
    res.json({
      ...resultList,
      items: formattedItems,
    });
  } catch (error) {
    logger.timeEnd(`[API] GET /audit-log ${userId}`);
    logger.error(`[API] Error fetching audit logs: Status ${error?.status || "N/A"}`, error?.message || error);
    res.status(500).json({
      error: "Failed to fetch audit logs",
    });
  }
});

router.delete("/audit-log/all", requireLogin, apiLimiter, async (req, res) => {
  const userId = req.session.user.id;
  logger.warn(`[API] DELETE /audit-log/all requested by user ${userId}. Initiating clear.`);
  logger.time(`[API] DELETE /audit-log/all ${userId}`);
  let deletedCount = 0;
  const batchSize = 200;

  try {
    logAuditEvent(req, "AUDIT_LOG_CLEAR_STARTED", null, null, null);

    const page = 1;
    let logsToDelete;
    do {
      logsToDelete = await pbAdmin.collection("audit_logs").getList(page, batchSize, {
        fields: "id",
        sort: "created",
      });

      if (logsToDelete.items.length > 0) {
        logger.debug(`[API] Deleting batch of ${logsToDelete.items.length} audit logs.`);
        const deletePromises = [];
        for (const log of logsToDelete.items) {
          deletePromises.push(pbAdmin.collection("audit_logs").delete(log.id));
        }
        await Promise.all(deletePromises);
        deletedCount += logsToDelete.items.length;
        logger.trace(`[API] Deleted batch. Total deleted so far: ${deletedCount}`);
      }
    } while (logsToDelete.items.length === batchSize);

    logger.info(`[API] Successfully deleted ${deletedCount} audit logs by user ${userId}.`);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_SUCCESS", null, null, {
      deletedCount: deletedCount,
    });
    logger.timeEnd(`[API] DELETE /audit-log/all ${userId}`);
    res.status(200).json({
      message: `Successfully deleted ${deletedCount} audit log entries.`,
    });
  } catch (error) {
    logger.timeEnd(`[API] DELETE /audit-log/all ${userId}`);
    logger.error(`[API] Error clearing all audit logs: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_FAILURE", null, null, {
      error: error?.message,
      deletedCountBeforeError: deletedCount,
    });
    res.status(500).json({
      error: "Failed to clear all audit logs.",
    });
  }
});

router.get("/audit-log/export/csv", requireLogin, apiLimiter, async (req, res) => {
  const userId = req.session.user.id;
  logger.info(`[API] GET /audit-log/export/csv requested by user ${userId}`);
  logger.time(`[API] GET /audit-log/export/csv ${userId}`);
  logAuditEvent(req, "AUDIT_LOG_EXPORT_STARTED", null, null, null);

  try {
    const allLogs = await pbAdmin.collection("audit_logs").getFullList({
      sort: "-created",
      expand: "user",
    });
    logger.debug(`[API] Fetched ${allLogs.length} audit logs for CSV export.`);

    if (!allLogs || allLogs.length === 0) {
      logger.info("[API] No audit logs found to export.");
      logAuditEvent(req, "AUDIT_LOG_EXPORT_SUCCESS", null, null, {
        recordCount: 0,
        message: "No logs to export",
      });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="audit_logs_empty.csv"');
      logger.timeEnd(`[API] GET /audit-log/export/csv ${userId}`);
      return res.status(200).send("");
    }

    const csvData = [];
    for (const log of allLogs) {
      const userEmail = log.expand?.user?.email || log.user || "System/Unknown";
      const detailsString = log.details ? JSON.stringify(log.details) : "";
      csvData.push({
        Timestamp: new Date(log.created).toISOString(),
        User: userEmail,
        Action: log.action || "",
        TargetCollection: log.target_collection || "",
        TargetRecord: log.target_record || "",
        IPAddress: log.ip_address || "",
        Details: detailsString,
        LogID: log.id,
      });
    }

    const csvHeaders = ["Timestamp", "User", "Action", "TargetCollection", "TargetRecord", "IPAddress", "Details", "LogID"];

    const csvString = Papa.unparse(csvData, {
      header: true,
      columns: csvHeaders,
    });
    logger.trace("[API] Generated CSV string for audit log export.");

    const dateStamp = new Date().toISOString().split("T")[0];
    const filename = `audit_logs_${dateStamp}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    logAuditEvent(req, "AUDIT_LOG_EXPORT_SUCCESS", null, null, {
      recordCount: allLogs.length,
      filename: filename,
    });
    logger.info(`[API] Sending audit log CSV export: ${filename}`);

    logger.timeEnd(`[API] GET /audit-log/export/csv ${userId}`);
    res.status(200).send(csvString);
  } catch (error) {
    logger.timeEnd(`[API] GET /audit-log/export/csv ${userId}`);
    logger.error(`[API] Error exporting audit logs to CSV: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "AUDIT_LOG_EXPORT_FAILURE", null, null, {
      error: error?.message,
    });
    res.status(500).json({
      error: "Failed to export audit logs.",
    });
  }
});

router.post("/projects/:projectId/entries/:entryId/duplicate", requireLogin, checkProjectAccessApi, async (req, res) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const dataToDuplicate = req.body;
  logger.info(`[API] Attempting to duplicate entry ${entryId} in project ${projectId} by user ${userId}`);
  logger.time(`[API] POST /duplicate ${entryId}`);

  try {
    if (!dataToDuplicate.title || dataToDuplicate.title.trim() === "") {
      logger.warn(`[API] Duplicate failed for ${entryId}: Title cannot be empty.`);
      return res.status(400).json({
        error: "Title cannot be empty.",
      });
    }
    if (dataToDuplicate.type !== "roadmap" && dataToDuplicate.type !== "knowledge_base" && dataToDuplicate.type !== "sidebar_header" && (!dataToDuplicate.content || dataToDuplicate.content.trim() === "")) {
      logger.warn(`[API] Duplicate failed for ${entryId}: Content cannot be empty for type ${dataToDuplicate.type}.`);
      return res.status(400).json({
        error: "Content cannot be empty.",
      });
    }
    if (dataToDuplicate.type === "knowledge_base" && (!dataToDuplicate.content || dataToDuplicate.content.trim() === "")) {
      logger.warn(`[API] Duplicate failed for ${entryId}: Answer content cannot be empty for KB.`);
      return res.status(400).json({
        error: "Answer content is required.",
      });
    }
    if (dataToDuplicate.type === "roadmap" && (!dataToDuplicate.roadmap_stage || dataToDuplicate.roadmap_stage.trim() === "")) {
      logger.warn(`[API] Duplicate failed for ${entryId}: Roadmap Stage cannot be empty.`);
      return res.status(400).json({
        error: "Roadmap Stage cannot be empty.",
      });
    }

    const newData = {
      ...dataToDuplicate,
      title: `Copy of ${dataToDuplicate.title}`,
      status: "draft",
      owner: userId,
      project: projectId,
      views: 0,
      has_staged_changes: false,
      staged_title: null,
      staged_type: null,
      staged_content: null,
      staged_tags: null,
      staged_collection: null,
      staged_documentation_header: null,
      staged_documentation_footer: null,
      staged_changelog_header: null,
      staged_changelog_footer: null,
      staged_roadmap_stage: null,
      custom_documentation_header: dataToDuplicate.custom_documentation_header || null,
      custom_documentation_footer: dataToDuplicate.custom_documentation_footer || null,
      custom_changelog_header: dataToDuplicate.custom_changelog_header || null,
      custom_changelog_footer: dataToDuplicate.custom_changelog_footer || null,
      roadmap_stage: dataToDuplicate.roadmap_stage || null,
      content: dataToDuplicate.type === "roadmap" || dataToDuplicate.type === "sidebar_header" ? "" : dataToDuplicate.content,
      content_updated_at: new Date().toISOString(),
    };

    newData.id = undefined;
    newData.created = undefined;
    newData.updated = undefined;
    newData.url = undefined;
    logger.debug(`[API] Prepared data for duplicating entry ${entryId}.`);

    const newRecord = await pbAdmin.collection("entries_main").create(newData);
    logger.info(`[API] Entry ${entryId} duplicated successfully as new entry ${newRecord.id}.`);

    logAuditEvent(req, "ENTRY_DUPLICATE", "entries_main", newRecord.id, {
      projectId: projectId,
      originalEntryId: entryId,
      newTitle: newRecord.title,
      newType: newRecord.type,
    });

    logger.timeEnd(`[API] POST /duplicate ${entryId}`);
    res.status(201).json({
      message: "Entry duplicated successfully as a draft.",
      newEntryId: newRecord.id,
      newEntryType: newRecord.type,
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /duplicate ${entryId}`);
    logger.error(`[API] Error duplicating entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_DUPLICATE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({
        error: "Original entry not found.",
      });
    }
    if (error.status === 403) {
      return res.status(403).json({
        error: "Forbidden.",
      });
    }
    if (error?.data?.data) {
      logger.error("[API] PocketBase validation errors on duplicate:", error.data.data);
      return res.status(400).json({
        error: "Validation failed for the duplicated entry.",
      });
    }
    res.status(500).json({
      error: "Failed to duplicate entry.",
    });
  }
});

router.post("/log-duration-pb", express.json({ type: "*/*" }), async (req, res) => {
  const { entryId, duration } = req.body;

  if (!entryId || typeof entryId !== "string" || !duration || typeof duration !== "number" || duration <= 0) {
    logger.warn("[API] Invalid duration log data received for PB update:", req.body);
    return res.status(400).send("Invalid data");
  }

  const durationSeconds = Math.round(duration);
  logger.debug(`[API] Received duration log for PB: Entry=${entryId}, Duration=${durationSeconds}s`);

  try {
    await pbAdmin.collection("entries_main").update(entryId, {
      "total_view_duration+": durationSeconds,
      "view_duration_count+": 1,
    });

    logger.trace(`[API] Updated duration stats for entry ${entryId} in PocketBase.`);
    res.status(204).send();
  } catch (error) {
    if (error?.status !== 404) {
      logger.error(`[API] Error updating duration stats for entry ${entryId} in PocketBase: Status ${error?.status || "N/A"}`, error?.message || error);
    } else {
      logger.warn(`[API] Attempted to log duration for non-existent entry ${entryId}.`);
    }
    res.status(error?.status === 404 ? 404 : 500).send("Error updating duration");
  }
});

router.post("/projects/:projectId/sidebar-headers", requireLogin, checkProjectAccessApi, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { title } = req.body;
  logger.info(`[API] POST /projects/${projectId}/sidebar-headers requested by user ${userId}. Title: ${title}`);
  logger.time(`[API] POST /sidebar-headers ${projectId}`);

  if (!title || title.trim() === "") {
    logger.warn(`[API] Sidebar header creation failed for project ${projectId}: Title required.`);
    logger.timeEnd(`[API] POST /sidebar-headers ${projectId}`);
    return res.status(400).json({
      error: "Header title is required.",
    });
  }

  try {
    const maxOrderResult = await pbAdmin
      .collection("entries_main")
      .getFirstListItem(`project = '${projectId}' && show_in_project_sidebar = true`, {
        sort: "-sidebar_order",
        fields: "sidebar_order",
        $autoCancel: false,
      })
      .catch((err) => {
        if (err.status === 404) return { sidebar_order: -1 };
        throw err;
      });

    const nextOrder = (maxOrderResult?.sidebar_order ?? -1) + 1;

    const data = {
      title: title.trim(),
      type: "sidebar_header",
      status: "published",
      owner: userId,
      project: projectId,
      show_in_project_sidebar: true,
      sidebar_order: nextOrder,
      content: "",
      tags: "",
      collection: "",
      views: 0,
      has_staged_changes: false,
      content_updated_at: new Date().toISOString(),
    };
    logger.debug(`[API] Creating sidebar header in project ${projectId} with data:`, data);

    const newHeader = await pbAdmin.collection("entries_main").create(data);
    logger.info(`[API] Sidebar header created successfully: ${newHeader.id} (${newHeader.title}) in project ${projectId} by user ${userId}`);
    logAuditEvent(req, "SIDEBAR_HEADER_CREATE", "entries_main", newHeader.id, {
      projectId: projectId,
      title: newHeader.title,
    });

    logger.timeEnd(`[API] POST /sidebar-headers ${projectId}`);
    res.status(201).json({
      message: "Sidebar header created successfully.",
      header: newHeader,
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /sidebar-headers ${projectId}`);
    logger.error(`[API] Failed to create sidebar header '${title}' in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SIDEBAR_HEADER_CREATE_FAILURE", "entries_main", null, {
      projectId: projectId,
      title: title,
      error: error?.message,
    });
    res.status(500).json({
      error: "Failed to create sidebar header.",
    });
  }
});

router.post("/projects/:projectId/sidebar-headers/:headerId", requireLogin, checkProjectAccessApi, async (req, res) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { title } = req.body;
  logger.info(`[API] POST /projects/${projectId}/sidebar-headers/${headerId} (update) requested by user ${userId}. New Title: ${title}`);
  logger.time(`[API] POST /update-sidebar-header ${headerId}`);

  if (!title || title.trim() === "") {
    logger.warn(`[API] Sidebar header update failed for ${headerId}: Title required.`);
    logger.timeEnd(`[API] POST /update-sidebar-header ${headerId}`);
    return res.status(400).json({
      error: "Header title is required.",
    });
  }

  try {
    const record = await pbAdmin.collection("entries_main").getOne(headerId);

    if (record.owner !== userId || record.project !== projectId || record.type !== "sidebar_header") {
      logger.warn(`[API] Forbidden attempt to update sidebar header ${headerId} by user ${userId}.`);
      logAuditEvent(req, "SIDEBAR_HEADER_UPDATE_FAILURE", "entries_main", headerId, {
        projectId: projectId,
        reason: "Forbidden or wrong type",
      });
      logger.timeEnd(`[API] POST /update-sidebar-header ${headerId}`);
      return res.status(403).json({
        error: "Forbidden or invalid header ID.",
      });
    }

    const updateData = {
      title: title.trim(),
      content_updated_at: new Date().toISOString(),
    };
    logger.debug(`[API] Updating sidebar header ${headerId} with data:`, updateData);

    const updatedHeader = await pbAdmin.collection("entries_main").update(headerId, updateData);
    logger.info(`[API] Sidebar header ${headerId} updated successfully to "${updatedHeader.title}".`);
    logAuditEvent(req, "SIDEBAR_HEADER_UPDATE", "entries_main", headerId, {
      projectId: projectId,
      newTitle: updatedHeader.title,
    });

    logger.timeEnd(`[API] POST /update-sidebar-header ${headerId}`);
    res.status(200).json({
      message: "Sidebar header updated successfully.",
      header: updatedHeader,
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /update-sidebar-header ${headerId}`);
    logger.error(`[API] Failed to update sidebar header ${headerId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SIDEBAR_HEADER_UPDATE_FAILURE", "entries_main", headerId, {
      projectId: projectId,
      title: title,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({
        error: "Sidebar header not found.",
      });
    }
    res.status(500).json({
      error: "Failed to update sidebar header.",
    });
  }
});

export default router;
