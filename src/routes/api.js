import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import path from "node:path";
import Papa from "papaparse";
import { pb, pbAdmin, apiLimiter, getSettings, APP_SETTINGS_RECORD_ID, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getEntryForOwnerAndProject, getArchivedEntryForOwnerAndProject, getTemplateForEditAndProject, clearEntryViewLogs, hashPreviewPassword, logAuditEvent, getProjectForOwner, getDocumentationHeaderForEditAndProject, getDocumentationFooterForEditAndProject, getChangelogHeaderForEditAndProject, getChangelogFooterForEditAndProject } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();

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

  if (!entryType || !["documentation", "changelog", "roadmap", "knowledge_base"].includes(entryType)) {
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
    const sort = req.query.sort || "-updated";
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
      fields: "id,title,status,type,collection,views,updated,owner,has_staged_changes,tags,roadmap_stage,total_view_duration,view_duration_count",
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
        viewUrl: entryType !== "roadmap" && entryType !== "knowledge_base" ? `/view/${entry.id}` : null,
        formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        has_staged_changes: entry.has_staged_changes ?? false,
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

  const validActions = ["publish", "draft", "archive", "unarchive", "delete", "permanent-delete", "publish-staged"];
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
        case "publish":
        case "draft": {
          if (sourceCollectionName !== "entries_main") {
            throw new Error(`Action '${action}' cannot apply to archived entries.`);
          }
          const statusUpdateData = {
            status: action,
          };
          if (action === "draft") {
            statusUpdateData.has_staged_changes = false;
            statusUpdateData.staged_title = null;
            statusUpdateData.staged_type = null;
            statusUpdateData.staged_content = null;
            statusUpdateData.staged_tags = null;
            statusUpdateData.staged_collection = null;
            statusUpdateData.staged_documentation_header = null;
            statusUpdateData.staged_documentation_footer = null;
            statusUpdateData.staged_changelog_header = null;
            statusUpdateData.staged_changelog_footer = null;
            statusUpdateData.staged_roadmap_stage = null;
          }
          logger.debug(`[API] Updating ${id} status to ${action}`);
          await client.collection(sourceCollectionName).update(id, statusUpdateData);
          break;
        }
        case "publish-staged": {
          if (sourceCollectionName !== "entries_main") {
            throw new Error("Cannot publish staged for archived entries.");
          }
          if (record.status !== "published" || !record.has_staged_changes) {
            throw new Error("Entry not published or no staged changes.");
          }
          const publishUpdateData = {
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
          };
          logger.debug(`[API] Publishing staged changes for ${id}`);
          await client.collection(sourceCollectionName).update(id, publishUpdateData);
          break;
        }
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
        case "unarchive": {
          if (sourceCollectionName !== "entries_archived" || !targetCollectionName) {
            throw new Error("Invalid state for unarchive action.");
          }
          const mainData = {
            ...record,
            custom_documentation_header: record.custom_documentation_header || null,
            custom_documentation_footer: record.custom_documentation_footer || null,
            custom_changelog_header: record.custom_changelog_header || null,
            custom_changelog_footer: record.custom_changelog_footer || null,
            roadmap_stage: record.roadmap_stage || null,
          };
          mainData.id = record.original_id;
          mainData.original_id = undefined;
          mainData.collectionId = undefined;
          mainData.collectionName = undefined;
          mainData.has_staged_changes = false;
          mainData.staged_title = null;
          mainData.staged_type = null;
          mainData.staged_content = null;
          mainData.staged_tags = null;
          mainData.staged_collection = null;
          mainData.staged_documentation_header = null;
          mainData.staged_documentation_footer = null;
          mainData.staged_changelog_header = null;
          mainData.staged_changelog_footer = null;
          mainData.staged_roadmap_stage = null;
          logger.debug(`[API] Unarchiving entry ${id} (original ID: ${mainData.id})`);
          const newMainRecord = await client.collection(targetCollectionName).create(mainData);
          await client.collection(sourceCollectionName).delete(id);
          logDetails.newId = newMainRecord.id;
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

  if (rejectedResults.length === 0) {
    logger.info(`[API] Bulk action '${action}' completed successfully for ${fulfilledCount} entries in project ${projectId}.`);
    logAuditEvent(req, `BULK_${action.toUpperCase()}_COMPLETE`, null, null, {
      ...actionDetails,
      successCount: fulfilledCount,
      failureCount: 0,
    });
    logger.timeEnd(`[API] POST /bulk-action ${action} ${projectId}`);
    res.status(200).json({
      message: `Successfully performed action '${action}' on ${fulfilledCount} entries.`,
    });
  } else if (fulfilledCount > 0) {
    logger.warn(`[API] Bulk action '${action}' completed partially for project ${projectId}. Succeeded: ${fulfilledCount}, Failed: ${rejectedResults.length}.`);
    logAuditEvent(req, `BULK_${action.toUpperCase()}_PARTIAL`, null, null, {
      ...actionDetails,
      successCount: fulfilledCount,
      failureCount: rejectedResults.length,
      errors: rejectedResults,
    });
    logger.timeEnd(`[API] POST /bulk-action ${action} ${projectId}`);
    res.status(207).json({
      message: `Action '${action}' completed with some errors. ${fulfilledCount} succeeded, ${rejectedResults.length} failed.`,
      errors: rejectedResults.map((r) => ({
        id: r.id,
        reason: r.reason,
        status: r.statusCode,
      })),
    });
  } else {
    const firstErrorStatus = rejectedResults[0]?.statusCode || 500;
    const overallStatus = rejectedResults.every((r) => r.statusCode === 403) ? 403 : firstErrorStatus;
    logger.error(`[API] Bulk action '${action}' failed for all ${rejectedResults.length} entries in project ${projectId}. Status: ${overallStatus}`);
    logAuditEvent(req, `BULK_${action.toUpperCase()}_FAILURE`, null, null, {
      ...actionDetails,
      successCount: 0,
      failureCount: rejectedResults.length,
      errors: rejectedResults,
    });
    logger.timeEnd(`[API] POST /bulk-action ${action} ${projectId}`);
    res.status(overallStatus).json({
      error: `Failed to perform action '${action}' on any selected entries.`,
      errors: rejectedResults.map((r) => ({
        id: r.id,
        reason: r.reason,
        status: r.statusCode,
      })),
    });
  }
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

router.post("/projects/:projectId/entries/:id/upload-image", requireLogin, checkProjectAccessApi, upload.single("image"), async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const imageFieldName = "files";
  const originalFilename = req.file?.originalname;
  logger.info(`[API] Attempting image upload for entry ${entryId}, project ${projectId}, user ${userId}. File: ${originalFilename}`);
  logger.time(`[API] POST /upload-image ${entryId}`);

  if (!req.file) {
    logger.warn(`[API] Image upload failed for entry ${entryId}: No file provided.`);
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      reason: "No file uploaded",
    });
    logger.timeEnd(`[API] POST /upload-image ${entryId}`);
    return res.status(400).json({
      error: "No image file provided.",
    });
  }

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);
    const existingFiles = entry[imageFieldName] || [];
    logger.trace(`[API] Existing files for entry ${entryId}: ${existingFiles.join(", ")}`);

    const form = new FormData();
    const blob = new Blob([req.file.buffer], {
      type: req.file.mimetype,
    });
    form.append(imageFieldName, blob, req.file.originalname);
    logger.debug(`[API] Prepared FormData for upload to entry ${entryId}.`);

    const updatedRecord = await pb.collection("entries_main").update(entryId, form);
    logger.debug(`[API] PocketBase update successful for entry ${entryId} image upload.`);

    const newFiles = updatedRecord[imageFieldName] || [];
    let actualFilename = null;

    if (newFiles.length > existingFiles.length) {
      actualFilename = newFiles.find((f) => !existingFiles.includes(f));
    } else if (newFiles.length === 1 && existingFiles.length === 0) {
      actualFilename = newFiles[0];
    } else if (newFiles.length > 0) {
      actualFilename = newFiles[newFiles.length - 1];
      logger.warn(`[API] Could not definitively determine new filename for entry ${entryId}, assuming last file: ${actualFilename}`);
    }

    if (!actualFilename) {
      logger.error(`[API] Could not determine the actual filename after upload for entry ${entryId}. Original: ${originalFilename}. New file list: ${newFiles.join(", ")}`);
      throw new Error("Failed to determine stored filename after upload.");
    }
    logger.trace(`[API] Determined actual filename: ${actualFilename}`);

    const fileUrl = pb.files.getURL(updatedRecord, actualFilename);

    if (!fileUrl) {
      logger.warn(`[API] Could not get URL for uploaded file ${actualFilename} in entry ${entryId}. Check if file exists in record.`);
    } else {
      logger.trace(`[API] Generated file URL: ${fileUrl}`);
    }

    logAuditEvent(req, "IMAGE_UPLOAD_SUCCESS", "entries_main", entryId, {
      projectId: projectId,
      field: imageFieldName,
      filename: actualFilename,
      url: fileUrl,
    });
    logger.info(`[API] Image uploaded successfully for entry ${entryId}: ${actualFilename}`);

    logger.timeEnd(`[API] POST /upload-image ${entryId}`);
    res.status(200).json({
      data: {
        filePath: fileUrl || "",
        filename: actualFilename,
      },
    });
  } catch (error) {
    logger.timeEnd(`[API] POST /upload-image ${entryId}`);
    logger.error(`[API] Error uploading image for entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", "entries_main", entryId, {
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

router.get("/projects/:projectId/archived-entries", requireLogin, checkProjectAccessApi, async (req, res) => {
  const userId = req.session.user.id;
  const projectId = req.params.projectId;
  const entryType = req.query.type;
  logger.debug(`[API] GET /projects/${projectId}/archived-entries requested by user ${userId}, type: ${entryType}`);
  logger.time(`[API] GET /projects/${projectId}/archived-entries ${userId} ${entryType}`);

  if (!entryType || !["documentation", "changelog", "roadmap", "knowledge_base"].includes(entryType)) {
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
    const sort = req.query.sort || "-updated";

    const combinedFilter = baseFilterParts.join(" && ");
    logger.trace(`[API] Archived entries filter: ${combinedFilter}`);

    const resultList = await pbAdmin.collection("entries_archived").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
      fields: "id,title,status,type,updated,original_id,roadmap_stage",
    });
    logger.debug(`[API] Fetched ${resultList.items.length} archived ${entryType} entries (page ${page}/${resultList.totalPages}) for project ${projectId}`);

    const entriesWithDetails = [];
    for (const entry of resultList.items) {
      entriesWithDetails.push({
        ...entry,
        formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
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
    if (dataToDuplicate.type !== "roadmap" && dataToDuplicate.type !== "knowledge_base" && (!dataToDuplicate.content || dataToDuplicate.content.trim() === "")) {
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
      content: dataToDuplicate.type === "roadmap" ? "" : dataToDuplicate.content,
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

export default router;
