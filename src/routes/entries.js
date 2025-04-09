import express from "express";
import { pb, pbAdmin, apiLimiter, ITEMS_PER_PAGE, PREVIEW_TOKEN_EXPIRY_HOURS } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getUserTemplates, getEntryForOwner, getArchivedEntryForOwner, clearEntryViewLogs, hashPreviewPassword, logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("entries_main").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
    });

    let collectionsList = [];
    try {
      const allCollectionsResult = await pbAdmin.collection("entries_main").getFullList({
        filter: `owner = '${userId}' && collection != ''`,
        fields: "collection",
      });
      collectionsList = [...new Set(allCollectionsResult.map((item) => item.collection).filter(Boolean))].sort();
    } catch (collectionError) {
      console.warn("Could not fetch collections list:", collectionError);
    }

    const entriesWithViewUrl = resultList.items.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.id}`,
    }));

    res.render("index", {
      entries: entriesWithViewUrl,
      pageTitle: "Dashboard",
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      collectionsList: collectionsList,
      error: req.query.error,
      action: req.query.action,
    });
  } catch (error) {
    console.error("Error fetching user entries for dashboard:", error);
    res.render("index", {
      entries: [],
      pageTitle: "Dashboard",
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      collectionsList: [],
      error: "Could not load entries.",
      action: null,
    });
  }
});

router.get("/new", requireLogin, async (req, res) => {
  try {
    const templates = await getUserTemplates(req.session.user.id);
    res.render("new", {
      entry: null,
      errors: null,
      templates: templates,
      pageTitle: "Create New Entry",
    });
  } catch (error) {
    console.error("Error loading new entry page:", error);
    res.render("new", {
      entry: null,
      errors: { general: "Could not load page data or templates." },
      templates: [],
      pageTitle: "Create New Entry",
    });
  }
});

router.post("/new", requireLogin, async (req, res) => {
  const { title, type, content, status, tags, collection, url } = req.body;
  const userId = req.session.user.id;
  const pbErrors = {};

  const trimmedUrl = url ? url.trim() : "";

  if (trimmedUrl && trimmedUrl.length !== 15) pbErrors.url = { message: "URL (ID) must be exactly 15 characters long if provided." };
  if (!title || title.trim() === "") pbErrors.title = { message: "Title is required." };
  if (!type) pbErrors.type = { message: "Type is required." };
  if (!content || content.trim() === "") pbErrors.content = { message: "Content is required." };

  if (Object.keys(pbErrors).length > 0) {
    try {
      const templates = await getUserTemplates(userId);
      const submittedData = { title, type, content, status: status || "draft", tags: tags || "", collection: collection || "", url: url || "" };
      return res.status(400).render("new", {
        entry: submittedData,
        errors: pbErrors,
        templates: templates,
        pageTitle: "Create New Entry",
      });
    } catch (templateError) {
      console.error("Error fetching templates after entry creation validation failure:", templateError);
      const submittedData = { title, type, content, status: status || "draft", tags: tags || "", collection: collection || "", url: url || "" };
      return res.status(400).render("new", {
        entry: submittedData,
        errors: { ...pbErrors, general: "Could not load templates." },
        templates: [],
        pageTitle: "Create New Entry",
      });
    }
  }

  const data = {
    title,
    type,
    content,
    status: status || "draft",
    tags: tags || "",
    collection: collection || "",
    views: 0,
    owner: userId,
    has_staged_changes: false,
    staged_title: null,
    staged_type: null,
    staged_content: null,
    staged_tags: null,
    staged_collection: null,
  };

  const recordIdToUse = trimmedUrl.length === 15 ? trimmedUrl : undefined;
  if (recordIdToUse) {
    data.id = recordIdToUse;
  }

  try {
    const newRecord = await pb.collection("entries_main").create(data);

    logAuditEvent(req, "ENTRY_CREATE", "entries_main", newRecord.id, { title: newRecord.title, status: newRecord.status });
    res.redirect("/");
  } catch (error) {
    console.error("Failed to create entry in PocketBase:", error);
    logAuditEvent(req, "ENTRY_CREATE_FAILURE", "entries_main", null, { error: error?.message, data, providedId: url });

    const creationErrors = error?.data?.data || error?.originalError?.data?.data || {};
    const errorResponseMessage = error?.data?.message || error?.originalError?.data?.message || "";

    if ((error.status === 400 || error.status === 409) && (errorResponseMessage.includes("already exists") || creationErrors.id?.message)) {
      creationErrors.url = { message: "This URL (ID) is already in use. Please choose another." };
      if (creationErrors.id) creationErrors.id = undefined;
    } else if (!creationErrors.general && Object.keys(creationErrors).length === 0) {
      creationErrors.general = { message: errorResponseMessage || "Failed to create entry. Please check the form or try again." };
    }

    try {
      const templates = await getUserTemplates(userId);
      const submittedData = { title, type, content, status: status || "draft", tags: tags || "", collection: collection || "", url: url || "" };
      res.status(400).render("new", {
        entry: submittedData,
        errors: creationErrors,
        templates: templates,
        pageTitle: "Create New Entry",
      });
    } catch (templateError) {
      console.error("Error fetching templates after entry creation failure:", templateError);
      const submittedData = { title, type, content, status: status || "draft", tags: tags || "", collection: collection || "", url: url || "" };
      res.status(400).render("new", {
        entry: submittedData,
        errors: { ...creationErrors, general: "Could not load templates." },
        templates: [],
        pageTitle: "Create New Entry",
      });
    }
  }
});

router.get("/edit/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;

  try {
    const record = await getEntryForOwner(entryId, userId);

    const entryDataForForm = { ...record };
    let isEditingStaged = false;

    if (record.status === "published" && record.has_staged_changes) {
      isEditingStaged = true;
      entryDataForForm.title = record.staged_title ?? record.title;
      entryDataForForm.type = record.staged_type ?? record.type;
      entryDataForForm.content = record.staged_content ?? record.content;
      entryDataForForm.tags = record.staged_tags ?? record.tags;
      entryDataForForm.collection = record.collection;
    }

    res.render("edit", {
      entry: entryDataForForm,
      originalStatus: record.status,
      hasStagedChanges: record.has_staged_changes,
      isEditingStaged: isEditingStaged,
      errors: null,
      pageTitle: "Edit Entry",
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch entry ${entryId} for edit:`, error);
    next(error);
  }
});

router.post("/edit/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  const { title, type, content, status, tags, collection } = req.body;
  const submittedStatus = status || "draft";

  let originalRecord;
  try {
    originalRecord = await pbAdmin.collection("entries_main").getOne(entryId);
    if (originalRecord.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      logAuditEvent(req, "ENTRY_UPDATE_FAILURE", "entries_main", entryId, { reason: "Forbidden" });
      return next(err);
    }

    let updateData = {};
    const wasPublished = originalRecord.status === "published";
    const isStayingPublished = submittedStatus === "published";
    let actionType = "ENTRY_UPDATE";

    if (wasPublished && isStayingPublished) {
      actionType = "ENTRY_STAGE_CHANGES";
      updateData = {
        staged_title: title,
        staged_type: type,
        staged_content: content,
        staged_tags: tags || "",
        has_staged_changes: true,
        collection: collection || "",
      };
    } else {
      updateData = {
        title,
        type,
        content,
        tags: tags || "",
        collection: collection || "",
        status: submittedStatus,
        has_staged_changes: false,
        staged_title: null,
        staged_type: null,
        staged_content: null,
        staged_tags: null,
        staged_collection: null,
      };
      if (wasPublished && submittedStatus === "draft") {
        actionType = "ENTRY_UNPUBLISH";
      } else if (!wasPublished && submittedStatus === "published") {
        actionType = "ENTRY_PUBLISH";
      }
    }

    const updatedRecord = await pbAdmin.collection("entries_main").update(entryId, updateData);
    logAuditEvent(req, actionType, "entries_main", entryId, { title: updatedRecord.title, status: updatedRecord.status });
    res.redirect("/");
  } catch (error) {
    console.error(`Failed to update/stage entry ${entryId}:`, error);
    logAuditEvent(req, "ENTRY_UPDATE_FAILURE", "entries_main", entryId, { error: error?.message });

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const pbErrors = error?.data?.data || {
      general: "Failed to save changes. Please check the form.",
    };

    try {
      const recordForRender = originalRecord || (await pbAdmin.collection("entries_main").getOne(entryId));
      if (recordForRender.owner !== userId) return next(new Error("Forbidden"));

      const entryDataForForm = {
        ...recordForRender,
        title,
        type,
        content,
        status: submittedStatus,
        tags,
        collection,
      };

      let isEditingStaged = false;
      if (recordForRender.status === "published" && recordForRender.has_staged_changes) {
        isEditingStaged = true;
        entryDataForForm.title = recordForRender.staged_title ?? recordForRender.title;
        entryDataForForm.type = recordForRender.staged_type ?? recordForRender.type;
        entryDataForForm.content = recordForRender.staged_content ?? recordForRender.content;
        entryDataForForm.tags = recordForRender.staged_tags ?? recordForRender.tags;
        entryDataForForm.collection = collection ?? recordForRender.collection;
      }

      res.status(400).render("edit", {
        entry: entryDataForForm,
        originalStatus: recordForRender.status,
        hasStagedChanges: recordForRender.has_staged_changes,
        isEditingStaged: isEditingStaged,
        errors: pbErrors,
        pageTitle: "Edit Entry",
      });
    } catch (fetchError) {
      console.error(`Error fetching original entry ${entryId} after update failure:`, fetchError);
      next(fetchError);
    }
  }
});

router.post("/delete/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  let entryTitle = entryId;

  try {
    const entry = await getEntryForOwner(entryId, userId);
    entryTitle = entry.title;
    await pb.collection("entries_main").delete(entryId);
    clearEntryViewLogs(entryId);
    logAuditEvent(req, "ENTRY_DELETE", "entries_main", entryId, { title: entryTitle });

    try {
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({ filter: `entry = '${entryId}'`, fields: "id" });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
    } catch (previewCleanError) {
      console.error(`Error cleaning preview tokens for deleted entry ${entryId}:`, previewCleanError);
    }

    res.redirect("/?action=deleted");
  } catch (error) {
    console.error(`Failed to delete entry ${entryId}:`, error);
    logAuditEvent(req, "ENTRY_DELETE_FAILURE", "entries_main", entryId, { title: entryTitle, error: error?.message });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/?error=delete_failed");
  }
});

router.post("/archive/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  let originalRecord;

  try {
    originalRecord = await getEntryForOwner(entryId, userId);

    const archiveData = { ...originalRecord, original_id: originalRecord.id };
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

    const archivedRecord = await pbAdmin.collection("entries_archived").create(archiveData);
    await pbAdmin.collection("entries_main").delete(entryId);
    logAuditEvent(req, "ENTRY_ARCHIVE", "entries_main", entryId, { title: originalRecord.title, archivedId: archivedRecord.id });

    try {
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({ filter: `entry = '${entryId}'`, fields: "id" });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
    } catch (previewCleanError) {
      console.error(`Error cleaning preview tokens for archived entry ${entryId}:`, previewCleanError);
    }

    res.redirect("/?action=archived");
  } catch (error) {
    console.error(`Failed to archive entry ${entryId}:`, error);
    logAuditEvent(req, "ENTRY_ARCHIVE_FAILURE", "entries_main", entryId, { title: originalRecord?.title, error: error?.message });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/?error=archive_failed");
  }
});

router.get("/archived", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pbAdmin.collection("entries_archived").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
    });

    const entriesWithViewUrl = resultList.items.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.original_id || entry.id}`,
    }));

    res.render("archived", {
      entries: entriesWithViewUrl,
      pageTitle: "Archived Entries",
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      action: req.query.action,
    });
  } catch (error) {
    console.error("Error fetching archived entries:", error);
    res.render("archived", {
      entries: [],
      pageTitle: "Archived Entries",
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load archived entries.",
      action: null,
    });
  }
});

router.post("/unarchive/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  let originalRecord;

  try {
    originalRecord = await getArchivedEntryForOwner(entryId, userId);

    const mainData = { ...originalRecord };
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

    const newMainRecord = await pbAdmin.collection("entries_main").create(mainData);
    await pbAdmin.collection("entries_archived").delete(entryId);
    logAuditEvent(req, "ENTRY_UNARCHIVE", "entries_archived", entryId, { title: originalRecord.title, newId: newMainRecord.id });

    res.redirect("/archived?action=unarchived");
  } catch (error) {
    console.error(`Failed to unarchive entry ${entryId}:`, error);
    logAuditEvent(req, "ENTRY_UNARCHIVE_FAILURE", "entries_archived", entryId, { title: originalRecord?.title, error: error?.message });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/archived?error=unarchive_failed");
  }
});

router.post("/delete-archived/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;
  let record;

  try {
    record = await getArchivedEntryForOwner(entryId, userId);
    await pbAdmin.collection("entries_archived").delete(entryId);
    const idToClean = record.original_id || entryId;
    clearEntryViewLogs(idToClean);
    logAuditEvent(req, "ENTRY_ARCHIVED_DELETE", "entries_archived", entryId, { title: record.title, originalId: record.original_id });

    res.redirect("/archived?action=deleted");
  } catch (error) {
    console.error(`Failed to delete archived entry ${entryId}:`, error);
    logAuditEvent(req, "ENTRY_ARCHIVED_DELETE_FAILURE", "entries_archived", entryId, { title: record?.title, error: error?.message });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/archived?error=delete_failed");
  }
});

router.get("/audit-log", requireLogin, async (req, res, next) => {
  try {
    const initialPage = 1;
    const initialSort = "-created";

    const resultList = await pbAdmin.collection("audit_logs").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      expand: "user",
    });

    res.render("audit-log", {
      logs: resultList.items,
      pageTitle: "Audit Log",
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: null,
    });
  } catch (error) {
    console.error("Error fetching audit logs for page view:", error);
    res.render("audit-log", {
      logs: [],
      pageTitle: "Audit Log",
      pagination: { page: 1, perPage: ITEMS_PER_PAGE, totalItems: 0, totalPages: 0 },
      initialSort: "-created",
      error: "Could not load audit logs.",
    });
  }
});

export default router;
