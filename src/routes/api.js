import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import path from "node:path";
import Papa from "papaparse";
import { pb, pbAdmin, apiLimiter, ITEMS_PER_PAGE, PREVIEW_TOKEN_EXPIRY_HOURS } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getEntryForOwnerAndProject, getArchivedEntryForOwnerAndProject, getTemplateForEditAndProject, clearEntryViewLogs, hashPreviewPassword, logAuditEvent, getProjectForOwner, getDocumentationHeaderForEditAndProject, getDocumentationFooterForEditAndProject, getChangelogHeaderForEditAndProject, getChangelogFooterForEditAndProject } from "../utils.js";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error(`Error: File upload only supports the following filetypes - ${filetypes}`));
  },
});

router.use(apiLimiter);

async function checkProjectAccessApi(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  if (!projectId) {
    return res.status(400).json({ error: "Project ID is required." });
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    req.project = project;
    next();
  } catch (error) {
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (error.status === 404) {
      return res.status(404).json({ error: "Project not found" });
    }
    console.error(`API Error checking project access for ${projectId}:`, error);
    return res.status(500).json({ error: "Internal server error checking project access." });
  }
}

router.get("/projects", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "name";
    const searchTerm = req.query.search;

    const filterParts = [`owner = '${userId}'`];

    if (searchTerm && searchTerm.trim() !== "") {
      const escapedSearch = searchTerm.trim().replace(/'/g, "''");
      filterParts.push(`(name ~ '${escapedSearch}' || description ~ '${escapedSearch}')`);
    }

    const combinedFilter = filterParts.join(" && ");

    const resultList = await pb.collection("projects").getList(page, perPage, {
      filter: combinedFilter,
      sort: sort,
    });

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

    res.json({
      ...resultList,
      items: projectsWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching projects list:", error);
    logAuditEvent(req, "API_PROJECT_LIST_FAILURE", "projects", null, {
      error: error?.message,
    });
    res.status(500).json({ error: "Failed to fetch projects list" });
  }
});

router.get("/projects/:projectId/entries", requireLogin, checkProjectAccessApi, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const projectId = req.params.projectId;
    const baseFilterParts = [`owner = '${userId}'`, `project = '${projectId}'`];
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";
    const statusFilter = req.query.status;
    const collectionFilter = req.query.collection;
    const searchTerm = req.query.search;
    const entryType = req.query.type;

    if (entryType && ["documentation", "changelog", "roadmap"].includes(entryType)) {
      baseFilterParts.push(`type = '${entryType}'`);
    } else {
      return res.status(400).json({ error: "Invalid or missing entry type filter." });
    }

    if (statusFilter && ["published", "draft"].includes(statusFilter)) {
      baseFilterParts.push(`status = '${statusFilter}'`);
    }

    if (collectionFilter && collectionFilter.trim() !== "") {
      const escapedCollection = collectionFilter.replace(/'/g, "''");
      baseFilterParts.push(`collection = '${escapedCollection}'`);
    }

    if (searchTerm && searchTerm.trim() !== "") {
      const escapedSearch = searchTerm.trim().replace(/'/g, "''");
      const searchFilter = `(title ~ '${escapedSearch}' || collection ~ '${escapedSearch}' || tags ~ '${escapedSearch}')`;
      baseFilterParts.push(searchFilter);
    }

    const combinedFilter = baseFilterParts.join(" && ");

    const resultList = await pb.collection("entries_main").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
      fields: "id,title,status,type,collection,views,updated,owner,has_staged_changes,tags,roadmap_stage",
    });

    const entriesWithDetails = [];
    for (const entry of resultList.items) {
      if (!entry || !entry.id) {
        console.warn("Skipping entry in API response due to missing ID:", entry);
        continue;
      }
      entriesWithDetails.push({
        ...entry,
        viewUrl: entryType !== "roadmap" ? `/view/${entry.id}` : null,
        formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        has_staged_changes: entry.has_staged_changes ?? false,
      });
    }

    res.json({
      page: resultList.page,
      perPage: resultList.perPage,
      totalItems: resultList.totalItems,
      totalPages: resultList.totalPages,
      items: entriesWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching project entries:", error);
    if (error?.data?.message?.includes("filter")) {
      console.error("PocketBase filter error details:", error.data);
      return res.status(400).json({ error: "Invalid search or filter criteria." });
    }
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

router.post("/projects/:projectId/entries/:id/publish-staged", requireLogin, checkProjectAccessApi, async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const record = await pbAdmin.collection("entries_main").getOne(entryId);

    if (record.owner !== userId || record.project !== projectId) {
      logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, { projectId: projectId, reason: "Forbidden" });
      return res.status(403).json({ error: "Forbidden" });
    }

    if (record.status !== "published" || !record.has_staged_changes) {
      logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Not published or no staged changes",
      });
      return res.status(400).json({ error: "Entry is not published or has no staged changes." });
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

    await pbAdmin.collection("entries_main").update(entryId, updateData);
    logAuditEvent(req, "ENTRY_PUBLISH_STAGED", "entries_main", entryId, {
      projectId: projectId,
      title: updateData.title,
      type: updateData.type,
      stage: updateData.roadmap_stage,
    });
    res.status(200).json({ message: "Staged changes published successfully." });
  } catch (error) {
    console.error(`API Error publishing staged changes for entry ${entryId} in project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, { projectId: projectId, error: error?.message });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found." });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.status(500).json({ error: "Failed to publish staged changes." });
  }
});

router.post("/projects/:projectId/entries/:id/generate-preview", requireLogin, checkProjectAccessApi, async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { password } = req.body;

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);

    if (entry.status !== "draft") {
      logAuditEvent(req, "PREVIEW_GENERATE_FAILURE", "entries_main", entryId, { projectId: projectId, reason: "Not a draft" });
      return res.status(400).json({ error: "Preview links can only be generated for drafts." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + PREVIEW_TOKEN_EXPIRY_HOURS);

    let passwordHash = null;
    if (password && password.trim() !== "") {
      passwordHash = hashPreviewPassword(password);
      if (!passwordHash) {
        throw new Error("Failed to hash preview password.");
      }
    }

    const previewData = {
      entry: entryId,
      token: token,
      expires_at: expiresAt.toISOString(),
      password_hash: passwordHash,
    };

    try {
      const oldTokens = await pbAdmin.collection("entries_previews").getFullList({
        filter: `entry = '${entryId}'`,
        fields: "id",
      });
      for (const oldToken of oldTokens) {
        await pbAdmin.collection("entries_previews").delete(oldToken.id);
      }
    } catch (cleanupError) {
      console.warn(`Could not clean up old preview tokens for entry ${entryId}:`, cleanupError);
    }

    const previewRecord = await pbAdmin.collection("entries_previews").create(previewData);
    const previewUrl = `${req.protocol}://${req.get("host")}/preview/${token}`;
    logAuditEvent(req, "PREVIEW_GENERATE_SUCCESS", "entries_previews", previewRecord.id, {
      projectId: projectId,
      entryId: entryId,
      hasPassword: !!passwordHash,
    });

    res.status(201).json({
      previewUrl: previewUrl,
      expiresAt: expiresAt.toISOString(),
      hasPassword: !!passwordHash,
    });
  } catch (error) {
    console.error(`API Error generating preview link for entry ${entryId} in project ${projectId}:`, error);
    logAuditEvent(req, "PREVIEW_GENERATE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found" });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (error?.data?.data?.token?.code === "validation_not_unique") {
      return res.status(500).json({ error: "Failed to generate unique token, please try again." });
    }
    res.status(500).json({ error: "Failed to generate preview link" });
  }
});

router.post("/projects/:projectId/entries/bulk-action", requireLogin, checkProjectAccessApi, async (req, res) => {
  const { action, ids } = req.body;
  const userId = req.session.user.id;
  const projectId = req.params.projectId;

  if (!action || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Invalid request: 'action' and 'ids' array are required." });
  }

  const validActions = ["publish", "draft", "archive", "unarchive", "delete", "permanent-delete", "publish-staged"];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid bulk action: ${action}` });
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
    const logDetails = { id: id, projectId: projectId };

    try {
      if (action === "unarchive" || action === "permanent-delete") {
        sourceCollectionName = "entries_archived";
        record = await getArchivedEntryForOwnerAndProject(id, userId, projectId);
      } else {
        sourceCollectionName = "entries_main";
        record = await getEntryForOwnerAndProject(id, userId, projectId);
      }

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
          const statusUpdateData = { status: action };
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
          const newMainRecord = await client.collection(targetCollectionName).create(mainData);
          await client.collection(sourceCollectionName).delete(id);
          logDetails.newId = newMainRecord.id;
          break;
        }
        case "delete": {
          if (sourceCollectionName !== "entries_main") {
            throw new Error("Delete action only for main entries via bulk.");
          }
          await client.collection(sourceCollectionName).delete(id);
          clearEntryViewLogs(id);
          break;
        }
        case "permanent-delete": {
          if (sourceCollectionName !== "entries_archived") {
            throw new Error("Permanent delete only for archived via bulk.");
          }
          await client.collection(sourceCollectionName).delete(id);
          const idToClean = record.original_id || id;
          clearEntryViewLogs(idToClean);
          logDetails.originalId = record.original_id;
          break;
        }
        default:
          throw new Error(`Unhandled bulk action: ${action}`);
      }

      logAuditEvent(req, logActionType, sourceCollectionName, id, logDetails);
      results.push({ id, status: "fulfilled", action });
    } catch (error) {
      console.warn(`Bulk action '${action}' failed for entry ${id} in project ${projectId} by user ${userId}: ${error.status || ""} ${error.message}`);
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
    logAuditEvent(req, `BULK_${action.toUpperCase()}_COMPLETE`, null, null, {
      ...actionDetails,
      successCount: fulfilledCount,
      failureCount: 0,
    });
    res.status(200).json({
      message: `Successfully performed action '${action}' on ${fulfilledCount} entries.`,
    });
  } else if (fulfilledCount > 0) {
    logAuditEvent(req, `BULK_${action.toUpperCase()}_PARTIAL`, null, null, {
      ...actionDetails,
      successCount: fulfilledCount,
      failureCount: rejectedResults.length,
      errors: rejectedResults,
    });
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
    logAuditEvent(req, `BULK_${action.toUpperCase()}_FAILURE`, null, null, {
      ...actionDetails,
      successCount: 0,
      failureCount: rejectedResults.length,
      errors: rejectedResults,
    });
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
  try {
    const userId = req.session.user.id;
    const projectId = req.params.projectId;
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";

    const resultList = await pb.collection("templates").getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });

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

    res.json({
      ...resultList,
      items: templatesWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching project templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.get("/projects/:projectId/templates/:id", requireLogin, checkProjectAccessApi, async (req, res) => {
  const templateId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    res.json({ content: template.content });
  } catch (error) {
    console.error(`API Error fetching template ${templateId} for project ${projectId}:`, error);
    if (error.status === 404 || error.status === 403) {
      return res.status(error.status).json({ error: error.message });
    }
    res.status(500).json({ error: "Failed to fetch template content" });
  }
});

router.post("/set-theme", requireLogin, (req, res) => {
  const { theme } = req.body;
  if (theme === "light" || theme === "dark") {
    req.session.theme = theme;
    logAuditEvent(req, "THEME_SET", null, null, { theme: theme });
    res.status(200).json({ message: `Theme preference updated to ${theme}` });
  } else {
    logAuditEvent(req, "THEME_SET_FAILURE", null, null, {
      theme: theme,
      reason: "Invalid theme value",
    });
    res.status(400).json({ error: "Invalid theme value provided." });
  }
});

router.post("/projects/:projectId/entries/:id/upload-image", requireLogin, checkProjectAccessApi, upload.single("image"), async (req, res) => {
  const entryId = req.params.id;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const imageFieldName = "files";

  if (!req.file) {
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      reason: "No file uploaded",
    });
    return res.status(400).json({ error: "No image file provided." });
  }

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);
    const existingFiles = entry[imageFieldName] || [];

    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    form.append(imageFieldName, blob, req.file.originalname);

    const updatedRecord = await pb.collection("entries_main").update(entryId, form);

    const newFiles = updatedRecord[imageFieldName] || [];
    let actualFilename = null;

    if (newFiles.length > existingFiles.length) {
      actualFilename = newFiles.find((f) => !existingFiles.includes(f));
    } else if (newFiles.length === 1 && existingFiles.length === 0) {
      actualFilename = newFiles[0];
    }

    if (!actualFilename) {
      console.error(`Could not determine the actual filename after upload for entry ${entryId}. Original: ${req.file.originalname}. New file list: ${newFiles.join(", ")}`);
      throw new Error("Failed to determine stored filename after upload.");
    }

    const fileUrl = pb.files.getURL(updatedRecord, actualFilename);

    if (!fileUrl) {
      console.warn(`Could not get URL for uploaded file ${actualFilename} in entry ${entryId}. Check if file exists in record.`);
    }

    logAuditEvent(req, "IMAGE_UPLOAD_SUCCESS", "entries_main", entryId, {
      projectId: projectId,
      field: imageFieldName,
      filename: actualFilename,
      url: fileUrl,
    });

    res.status(200).json({
      data: {
        filePath: fileUrl || "",
        filename: actualFilename,
      },
    });
  } catch (error) {
    console.error(`API Error uploading image for entry ${entryId} in project ${projectId}:`, error);
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      field: imageFieldName,
      filename: req.file?.originalname,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found." });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden." });
    }
    if (error?.data?.data?.[imageFieldName]) {
      return res.status(400).json({
        error: `Upload validation failed: ${error.data.data[imageFieldName].message}`,
      });
    }
    const errorMessage = error.message || "Failed to upload image.";
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/projects/:projectId/archived-entries", requireLogin, checkProjectAccessApi, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const projectId = req.params.projectId;
    const baseFilterParts = [`owner = '${userId}'`, `project = '${projectId}'`];
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";
    const entryType = req.query.type;

    if (entryType && ["documentation", "changelog", "roadmap"].includes(entryType)) {
      baseFilterParts.push(`type = '${entryType}'`);
    } else {
      return res.status(400).json({ error: "Invalid or missing entry type filter." });
    }

    const combinedFilter = baseFilterParts.join(" && ");

    const resultList = await pbAdmin.collection("entries_archived").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
      fields: "id,title,status,type,updated,original_id,roadmap_stage",
    });

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

    res.json({
      ...resultList,
      items: entriesWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching archived entries for project:", error);
    res.status(500).json({ error: "Failed to fetch archived entries" });
  }
});

async function getProjectAssetsApi(collectionName, req, res) {
  try {
    const userId = req.session.user.id;
    const projectId = req.params.projectId;
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";

    const resultList = await pb.collection(collectionName).getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });

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

    res.json({
      ...resultList,
      items: assetsWithDetails,
    });
  } catch (error) {
    console.error(`API Error fetching ${collectionName} for project:`, error);
    res.status(500).json({ error: `Failed to fetch ${collectionName.replace("_", " ")}` });
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
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-created";

    const resultList = await pbAdmin.collection("audit_logs").getList(page, perPage, {
      sort: sort,
      expand: "user",
    });

    const formattedItems = [];
    for (const log of resultList.items) {
      formattedItems.push({
        ...log,
        user_email: log.expand?.user?.email || log.user || null,
        formatted_created: new Date(log.created).toLocaleString(),
      });
    }

    res.json({
      ...resultList,
      items: formattedItems,
    });
  } catch (error) {
    console.error("API Error fetching audit logs:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

router.delete("/audit-log/all", requireLogin, apiLimiter, async (req, res) => {
  let deletedCount = 0;
  const batchSize = 200;

  try {
    console.log(`User ${req.session.user.id} initiated clearing all audit logs.`);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_STARTED", null, null, null);

    const page = 1;
    let logsToDelete;
    do {
      logsToDelete = await pbAdmin.collection("audit_logs").getList(page, batchSize, {
        fields: "id",
        sort: "created",
      });

      if (logsToDelete.items.length > 0) {
        const deletePromises = [];
        for (const log of logsToDelete.items) {
          deletePromises.push(pbAdmin.collection("audit_logs").delete(log.id));
        }
        await Promise.all(deletePromises);
        deletedCount += logsToDelete.items.length;
        console.log(`Deleted batch of ${logsToDelete.items.length} audit logs.`);
      }
    } while (logsToDelete.items.length === batchSize);

    console.log(`Successfully deleted ${deletedCount} audit logs.`);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_SUCCESS", null, null, {
      deletedCount: deletedCount,
    });
    res.status(200).json({ message: `Successfully deleted ${deletedCount} audit log entries.` });
  } catch (error) {
    console.error("API Error clearing all audit logs:", error);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_FAILURE", null, null, {
      error: error?.message,
      deletedCountBeforeError: deletedCount,
    });
    res.status(500).json({ error: "Failed to clear all audit logs." });
  }
});

router.get("/audit-log/export/csv", requireLogin, apiLimiter, async (req, res) => {
  logAuditEvent(req, "AUDIT_LOG_EXPORT_STARTED", null, null, null);

  try {
    const allLogs = await pbAdmin.collection("audit_logs").getFullList({
      sort: "-created",
      expand: "user",
    });

    if (!allLogs || allLogs.length === 0) {
      logAuditEvent(req, "AUDIT_LOG_EXPORT_SUCCESS", null, null, {
        recordCount: 0,
        message: "No logs to export",
      });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="audit_logs_empty.csv"');
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

    const dateStamp = new Date().toISOString().split("T")[0];
    const filename = `audit_logs_${dateStamp}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    logAuditEvent(req, "AUDIT_LOG_EXPORT_SUCCESS", null, null, {
      recordCount: allLogs.length,
      filename: filename,
    });

    res.status(200).send(csvString);
  } catch (error) {
    console.error("API Error exporting audit logs to CSV:", error);
    logAuditEvent(req, "AUDIT_LOG_EXPORT_FAILURE", null, null, {
      error: error?.message,
    });
    res.status(500).json({ error: "Failed to export audit logs." });
  }
});

router.post("/projects/:projectId/entries/:entryId/duplicate", requireLogin, checkProjectAccessApi, async (req, res) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const dataToDuplicate = req.body;

  try {
    if (!dataToDuplicate.title || dataToDuplicate.title.trim() === "") {
      return res.status(400).json({ error: "Title cannot be empty." });
    }
    if (dataToDuplicate.type !== "roadmap" && (!dataToDuplicate.content || dataToDuplicate.content.trim() === "")) {
      return res.status(400).json({ error: "Content cannot be empty." });
    }
    if (dataToDuplicate.type === "roadmap" && (!dataToDuplicate.roadmap_stage || dataToDuplicate.roadmap_stage.trim() === "")) {
      return res.status(400).json({ error: "Roadmap Stage cannot be empty." });
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
    };

    newData.id = undefined;
    newData.created = undefined;
    newData.updated = undefined;
    newData.url = undefined;

    const newRecord = await pbAdmin.collection("entries_main").create(newData);

    logAuditEvent(req, "ENTRY_DUPLICATE", "entries_main", newRecord.id, {
      projectId: projectId,
      originalEntryId: entryId,
      newTitle: newRecord.title,
      newType: newRecord.type,
    });

    res.status(201).json({
      message: "Entry duplicated successfully as a draft.",
      newEntryId: newRecord.id,
      newEntryType: newRecord.type,
    });
  } catch (error) {
    console.error(`API Error duplicating entry ${entryId} in project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_DUPLICATE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    if (error.status === 404) {
      return res.status(404).json({ error: "Original entry not found." });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden." });
    }
    if (error?.data?.data) {
      console.error("PocketBase validation errors:", error.data.data);
      return res.status(400).json({ error: "Validation failed for the duplicated entry." });
    }
    res.status(500).json({ error: "Failed to duplicate entry." });
  }
});

export default router;
