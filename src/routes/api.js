import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import path from "node:path";
import Papa from "papaparse";
import { pb, pbAdmin, apiLimiter, ITEMS_PER_PAGE, PREVIEW_TOKEN_EXPIRY_HOURS, POCKETBASE_URL } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getEntryForOwner, getArchivedEntryForOwner, getTemplateForEdit, clearEntryViewLogs, hashPreviewPassword, logAuditEvent } from "../utils.js";

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

router.get("/entries", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const baseFilterParts = [`owner = '${userId}'`];
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";
    const statusFilter = req.query.status;
    const collectionFilter = req.query.collection;
    const searchTerm = req.query.search;

    if (statusFilter && ["published", "draft"].includes(statusFilter)) {
      baseFilterParts.push(`status = '${statusFilter}'`);
    }

    if (collectionFilter && collectionFilter.trim() !== "") {
      const escapedCollection = collectionFilter.replace(/'/g, "''");
      baseFilterParts.push(`collection = '${escapedCollection}'`);
    }

    if (searchTerm && searchTerm.trim() !== "") {
      const escapedSearch = searchTerm.trim().replace(/'/g, "''");
      const searchFilter = `(title ~ '${escapedSearch}' || collection ~ '${escapedSearch}' || type ~ '${escapedSearch}' || tags ~ '${escapedSearch}')`;
      baseFilterParts.push(searchFilter);
    }

    const combinedFilter = baseFilterParts.join(" && ");

    const resultList = await pb.collection("entries_main").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
      fields: "id,title,status,type,collection,views,updated,owner,has_staged_changes,custom_header,custom_footer,tags",
    });

    const entriesWithDetails = resultList.items.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.id}`,
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      canPreview: entry.status === "draft",
      has_staged_changes: entry.has_staged_changes ?? false,
    }));

    res.json({
      ...resultList,
      items: entriesWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching user entries:", error);
    if (error?.data?.message?.includes("filter")) {
      console.error("PocketBase filter error details:", error.data);
      return res.status(400).json({ error: "Invalid search or filter criteria." });
    }
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

router.post("/entries/:id/publish-staged", requireLogin, async (req, res) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;

  try {
    const record = await pbAdmin.collection("entries_main").getOne(entryId);

    if (record.owner !== userId) {
      logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, { reason: "Forbidden" });
      return res.status(403).json({ error: "Forbidden" });
    }

    if (record.status !== "published" || !record.has_staged_changes) {
      logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, { reason: "Not published or no staged changes" });
      return res.status(400).json({ error: "Entry is not published or has no staged changes." });
    }

    const updateData = {
      title: record.staged_title,
      type: record.staged_type,
      content: record.staged_content,
      tags: record.staged_tags,
      custom_header: record.staged_custom_header || null,
      custom_footer: record.staged_custom_footer || null,
      has_staged_changes: false,
      staged_title: null,
      staged_type: null,
      staged_content: null,
      staged_tags: null,
      staged_collection: null,
      staged_custom_header: null,
      staged_custom_footer: null,
    };

    await pbAdmin.collection("entries_main").update(entryId, updateData);
    logAuditEvent(req, "ENTRY_PUBLISH_STAGED", "entries_main", entryId, { title: updateData.title });
    res.status(200).json({ message: "Staged changes published successfully." });
  } catch (error) {
    console.error(`API Error publishing staged changes for entry ${entryId}:`, error);
    logAuditEvent(req, "ENTRY_PUBLISH_STAGED_FAILURE", "entries_main", entryId, { error: error?.message });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found." });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.status(500).json({ error: "Failed to publish staged changes." });
  }
});

router.post("/entries/:id/generate-preview", requireLogin, async (req, res) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  const { password } = req.body;

  try {
    const entry = await getEntryForOwner(entryId, userId);

    if (entry.status !== "draft") {
      logAuditEvent(req, "PREVIEW_GENERATE_FAILURE", "entries_main", entryId, { reason: "Not a draft" });
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
    logAuditEvent(req, "PREVIEW_GENERATE_SUCCESS", "entries_previews", previewRecord.id, { entryId: entryId, hasPassword: !!passwordHash });

    res.status(201).json({
      previewUrl: previewUrl,
      expiresAt: expiresAt.toISOString(),
      hasPassword: !!passwordHash,
    });
  } catch (error) {
    console.error(`API Error generating preview link for entry ${entryId}:`, error);
    logAuditEvent(req, "PREVIEW_GENERATE_FAILURE", "entries_main", entryId, { error: error?.message });
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

router.post("/entries/bulk-action", requireLogin, async (req, res) => {
  const { action, ids } = req.body;
  const userId = req.session.user.id;

  if (!action || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Invalid request: 'action' and 'ids' array are required." });
  }

  const validActions = ["publish", "draft", "archive", "unarchive", "delete", "permanent-delete", "publish-staged"];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid bulk action: ${action}` });
  }

  const results = [];
  const client = pbAdmin;
  const actionDetails = { bulkAction: action, requestedIds: ids };

  for (const id of ids) {
    let record;
    let sourceCollectionName;
    let targetCollectionName = null;
    const logActionType = `BULK_${action.toUpperCase()}`;
    const logDetails = { id: id };

    try {
      if (action === "unarchive" || action === "permanent-delete") {
        sourceCollectionName = "entries_archived";
      } else {
        sourceCollectionName = "entries_main";
      }

      if (action === "archive") targetCollectionName = "entries_archived";
      else if (action === "unarchive") targetCollectionName = "entries_main";

      record = await client.collection(sourceCollectionName).getOne(id);
      logDetails.title = record.title;

      if (record.owner !== userId) {
        throw Object.assign(new Error("Forbidden"), { status: 403 });
      }

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
            statusUpdateData.staged_custom_header = null;
            statusUpdateData.staged_custom_footer = null;
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
            custom_header: record.staged_custom_header || null,
            custom_footer: record.staged_custom_footer || null,
            has_staged_changes: false,
            staged_title: null,
            staged_type: null,
            staged_content: null,
            staged_tags: null,
            staged_collection: null,
            staged_custom_header: null,
            staged_custom_footer: null,
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
            custom_header: record.custom_header || null,
            custom_footer: record.custom_footer || null,
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
          archiveData.staged_custom_header = null;
          archiveData.staged_custom_footer = null;
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
            custom_header: record.custom_header || null,
            custom_footer: record.custom_footer || null,
          };
          mainData.id = undefined;
          mainData.original_id = undefined;
          mainData.collectionId = undefined;
          mainData.collectionName = undefined;
          mainData.has_staged_changes = false;
          mainData.staged_title = null;
          mainData.staged_type = null;
          mainData.staged_content = null;
          mainData.staged_tags = null;
          mainData.staged_collection = null;
          mainData.staged_custom_header = null;
          mainData.staged_custom_footer = null;
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
      console.warn(`Bulk action '${action}' failed for entry ${id} by user ${userId}: ${error.status || ""} ${error.message}`);
      logAuditEvent(req, `${logActionType}_FAILURE`, sourceCollectionName, id, { ...logDetails, error: error?.message, status: error?.status });
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
    logAuditEvent(req, `BULK_${action.toUpperCase()}_COMPLETE`, null, null, { ...actionDetails, successCount: fulfilledCount, failureCount: 0 });
    res.status(200).json({
      message: `Successfully performed action '${action}' on ${fulfilledCount} entries.`,
    });
  } else if (fulfilledCount > 0) {
    logAuditEvent(req, `BULK_${action.toUpperCase()}_PARTIAL`, null, null, { ...actionDetails, successCount: fulfilledCount, failureCount: rejectedResults.length, errors: rejectedResults });
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
    logAuditEvent(req, `BULK_${action.toUpperCase()}_FAILURE`, null, null, { ...actionDetails, successCount: 0, failureCount: rejectedResults.length, errors: rejectedResults });
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

router.get("/templates", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";

    const resultList = await pb.collection("templates").getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });

    const templatesWithDetails = resultList.items.map((template) => ({
      ...template,
      formattedUpdated: new Date(template.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    res.json({
      ...resultList,
      items: templatesWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching user templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

router.get("/templates/:id", requireLogin, async (req, res) => {
  const templateId = req.params.id;
  const userId = req.session.user.id;

  try {
    const template = await getTemplateForEdit(templateId, userId);
    res.json({ content: template.content });
  } catch (error) {
    console.error(`API Error fetching template ${templateId}:`, error);
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
    logAuditEvent(req, "THEME_SET_FAILURE", null, null, { theme: theme, reason: "Invalid theme value" });
    res.status(400).json({ error: "Invalid theme value provided." });
  }
});

router.post("/entries/:id/upload-image", requireLogin, upload.single("image"), async (req, res) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  const imageFieldName = "files";

  if (!req.file) {
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", "entries_main", entryId, { reason: "No file uploaded" });
    return res.status(400).json({ error: "No image file provided." });
  }

  try {
    const entry = await getEntryForOwner(entryId, userId);
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

    logAuditEvent(req, "IMAGE_UPLOAD_SUCCESS", "entries_main", entryId, { field: imageFieldName, filename: actualFilename, url: fileUrl });

    res.status(200).json({
      data: {
        filePath: fileUrl || "",
        filename: actualFilename,
      },
    });
  } catch (error) {
    console.error(`API Error uploading image for entry ${entryId}:`, error);
    logAuditEvent(req, "IMAGE_UPLOAD_FAILURE", "entries_main", entryId, { field: imageFieldName, filename: req.file?.originalname, error: error?.message });
    if (error.status === 404) {
      return res.status(404).json({ error: "Entry not found." });
    }
    if (error.status === 403) {
      return res.status(403).json({ error: "Forbidden." });
    }
    if (error?.data?.data?.[imageFieldName]) {
      return res.status(400).json({ error: `Upload validation failed: ${error.data.data[imageFieldName].message}` });
    }
    const errorMessage = error.message || "Failed to upload image.";
    res.status(500).json({ error: errorMessage });
  }
});

router.get("/archived-entries", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";

    const resultList = await pbAdmin.collection("entries_archived").getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,title,status,type,updated,original_id",
    });

    const entriesWithDetails = resultList.items.map((entry) => ({
      ...entry,
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    res.json({
      ...resultList,
      items: entriesWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching archived entries:", error);
    res.status(500).json({ error: "Failed to fetch archived entries" });
  }
});

router.get("/headers", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";

    const resultList = await pb.collection("headers").getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });

    const headersWithDetails = resultList.items.map((header) => ({
      ...header,
      formattedUpdated: new Date(header.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    res.json({
      ...resultList,
      items: headersWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching user headers:", error);
    res.status(500).json({ error: "Failed to fetch headers" });
  }
});

router.get("/footers", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";

    const resultList = await pb.collection("footers").getList(page, perPage, {
      sort: sort,
      filter: filter,
      fields: "id,name,updated",
    });

    const footersWithDetails = resultList.items.map((footer) => ({
      ...footer,
      formattedUpdated: new Date(footer.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    res.json({
      ...resultList,
      items: footersWithDetails,
    });
  } catch (error) {
    console.error("API Error fetching user footers:", error);
    res.status(500).json({ error: "Failed to fetch footers" });
  }
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

    const formattedItems = resultList.items.map((log) => ({
      ...log,
      user_email: log.expand?.user?.email || log.user || null,
      formatted_created: new Date(log.created).toLocaleString(),
    }));

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
        const deletePromises = logsToDelete.items.map((log) => pbAdmin.collection("audit_logs").delete(log.id));
        await Promise.all(deletePromises);
        deletedCount += logsToDelete.items.length;
        console.log(`Deleted batch of ${logsToDelete.items.length} audit logs.`);
      }
    } while (logsToDelete.items.length === batchSize);

    console.log(`Successfully deleted ${deletedCount} audit logs.`);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_SUCCESS", null, null, { deletedCount: deletedCount });
    res.status(200).json({ message: `Successfully deleted ${deletedCount} audit log entries.` });
  } catch (error) {
    console.error("API Error clearing all audit logs:", error);
    logAuditEvent(req, "AUDIT_LOG_CLEAR_FAILURE", null, null, { error: error?.message, deletedCountBeforeError: deletedCount });
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
      logAuditEvent(req, "AUDIT_LOG_EXPORT_SUCCESS", null, null, { recordCount: 0, message: "No logs to export" });
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="audit_logs_empty.csv"');
      return res.status(200).send("");
    }

    const csvData = allLogs.map((log) => {
      const userEmail = log.expand?.user?.email || log.user || "System/Unknown";
      const detailsString = log.details ? JSON.stringify(log.details) : "";

      return {
        Timestamp: new Date(log.created).toISOString(),
        User: userEmail,
        Action: log.action || "",
        TargetCollection: log.target_collection || "",
        TargetRecord: log.target_record || "",
        IPAddress: log.ip_address || "",
        Details: detailsString,
        LogID: log.id,
      };
    });

    const csvHeaders = ["Timestamp", "User", "Action", "TargetCollection", "TargetRecord", "IPAddress", "Details", "LogID"];

    const csvString = Papa.unparse(csvData, {
      header: true,
      columns: csvHeaders,
    });

    const dateStamp = new Date().toISOString().split("T")[0];
    const filename = `audit_logs_${dateStamp}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    logAuditEvent(req, "AUDIT_LOG_EXPORT_SUCCESS", null, null, { recordCount: allLogs.length, filename: filename });

    res.status(200).send(csvString);
  } catch (error) {
    console.error("API Error exporting audit logs to CSV:", error);
    logAuditEvent(req, "AUDIT_LOG_EXPORT_FAILURE", null, null, { error: error?.message });
    res.status(500).json({ error: "Failed to export audit logs." });
  }
});

export default router;
