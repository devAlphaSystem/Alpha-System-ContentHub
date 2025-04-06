import express from "express";
import crypto from "node:crypto";
import { pb, pbAdmin, apiLimiter, ITEMS_PER_PAGE, PREVIEW_TOKEN_EXPIRY_HOURS } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getEntryForOwner, getArchivedEntryForOwner, getTemplateForEdit, clearEntryViewLogs, hashPreviewPassword } from "../utils.js";

const router = express.Router();

router.use(apiLimiter);

router.get("/entries", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "-updated";
    const statusFilter = req.query.status;

    let combinedFilter = filter;
    if (statusFilter && ["published", "draft"].includes(statusFilter)) {
      combinedFilter += ` && status = '${statusFilter}'`;
    }

    const resultList = await pb.collection("entries_main").getList(page, perPage, {
      sort: sort,
      filter: combinedFilter,
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
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

router.post("/entries/:id/publish-staged", requireLogin, async (req, res) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;

  try {
    const record = await pbAdmin.collection("entries_main").getOne(entryId);

    if (record.owner !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (record.status !== "published" || !record.has_staged_changes) {
      return res.status(400).json({ error: "Entry is not published or has no staged changes." });
    }

    const updateData = {
      title: record.staged_title,
      type: record.staged_type,
      domain: record.staged_domain,
      content: record.staged_content,
      tags: record.staged_tags,
      has_staged_changes: false,
      staged_title: null,
      staged_type: null,
      staged_domain: null,
      staged_content: null,
      staged_tags: null,
    };

    await pbAdmin.collection("entries_main").update(entryId, updateData);
    res.status(200).json({ message: "Staged changes published successfully." });
  } catch (error) {
    console.error(`API Error publishing staged changes for entry ${entryId}:`, error);
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

    await pbAdmin.collection("entries_previews").create(previewData);
    const previewUrl = `${req.protocol}://${req.get("host")}/preview/${token}`;

    res.status(201).json({
      previewUrl: previewUrl,
      expiresAt: expiresAt.toISOString(),
      hasPassword: !!passwordHash,
    });
  } catch (error) {
    console.error(`API Error generating preview link for entry ${entryId}:`, error);
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

  for (const id of ids) {
    try {
      let record;
      let sourceCollectionName;
      let targetCollectionName = null;

      if (action === "unarchive" || action === "permanent-delete") {
        sourceCollectionName = "entries_archived";
      } else {
        sourceCollectionName = "entries_main";
      }

      if (action === "archive") targetCollectionName = "entries_archived";
      else if (action === "unarchive") targetCollectionName = "entries_main";

      record = await client.collection(sourceCollectionName).getOne(id);

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
            statusUpdateData.staged_domain = null;
            statusUpdateData.staged_content = null;
            statusUpdateData.staged_tags = null;
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
            domain: record.staged_domain,
            content: record.staged_content,
            tags: record.staged_tags,
            has_staged_changes: false,
            staged_title: null,
            staged_type: null,
            staged_domain: null,
            staged_content: null,
            staged_tags: null,
          };
          await client.collection(sourceCollectionName).update(id, publishUpdateData);
          break;
        }
        case "archive": {
          if (sourceCollectionName !== "entries_main" || !targetCollectionName) {
            throw new Error("Invalid state for archive action.");
          }
          const archiveData = { ...record, original_id: record.id };
          archiveData.id = undefined;
          archiveData.collectionId = undefined;
          archiveData.collectionName = undefined;
          archiveData.has_staged_changes = false;
          archiveData.staged_title = null;
          archiveData.staged_type = null;
          archiveData.staged_domain = null;
          archiveData.staged_content = null;
          archiveData.staged_tags = null;
          await client.collection(targetCollectionName).create(archiveData);
          await client.collection(sourceCollectionName).delete(id);
          break;
        }
        case "unarchive": {
          if (sourceCollectionName !== "entries_archived" || !targetCollectionName) {
            throw new Error("Invalid state for unarchive action.");
          }
          const mainData = { ...record };
          mainData.id = undefined;
          mainData.original_id = undefined;
          mainData.collectionId = undefined;
          mainData.collectionName = undefined;
          mainData.has_staged_changes = false;
          mainData.staged_title = null;
          mainData.staged_type = null;
          mainData.staged_domain = null;
          mainData.staged_content = null;
          mainData.staged_tags = null;
          await client.collection(targetCollectionName).create(mainData);
          await client.collection(sourceCollectionName).delete(id);
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
          break;
        }
        default:
          throw new Error(`Unhandled bulk action: ${action}`);
      }

      results.push({ id, status: "fulfilled", action });
    } catch (error) {
      console.warn(`Bulk action '${action}' failed for entry ${id} by user ${userId}: ${error.status || ""} ${error.message}`);
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
    res.status(200).json({
      message: `Successfully performed action '${action}' on ${fulfilledCount} entries.`,
    });
  } else if (fulfilledCount > 0) {
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
    res.status(200).json({ message: `Theme preference updated to ${theme}` });
  } else {
    res.status(400).json({ error: "Invalid theme value provided." });
  }
});

export default router;
