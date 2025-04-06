import express from "express";
import crypto from "node:crypto";
import { pb, pbAdmin, ITEMS_PER_PAGE, PREVIEW_TOKEN_EXPIRY_HOURS } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getUserTemplates, getEntryForOwner, getArchivedEntryForOwner, clearEntryViewLogs, hashPreviewPassword } from "../utils.js";

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
    res.render("new", {
      entry: null,
      errors: { general: "Could not load templates." },
      templates: [],
      pageTitle: "Create New Entry",
    });
  }
});

router.post("/new", requireLogin, async (req, res) => {
  const { title, type, domain, content, status, tags } = req.body;
  const userId = req.session.user.id;

  const data = {
    title,
    type,
    domain,
    content,
    status: status || "draft",
    tags: tags || "",
    views: 0,
    owner: userId,
    has_staged_changes: false,
    staged_title: null,
    staged_type: null,
    staged_domain: null,
    staged_content: null,
    staged_tags: null,
  };

  try {
    await pb.collection("entries_main").create(data);
    res.redirect("/");
  } catch (error) {
    console.error("Failed to create entry:", error);
    const pbErrors = error?.data?.data || {
      general: "Failed to create entry. Please check the form.",
    };

    try {
      const templates = await getUserTemplates(userId);
      res.status(400).render("new", {
        entry: data,
        errors: pbErrors,
        templates: templates,
        pageTitle: "Create New Entry",
      });
    } catch (templateError) {
      console.error("Error fetching templates after entry creation failure:", templateError);
      res.status(400).render("new", {
        entry: data,
        errors: { ...pbErrors, general: "Could not load templates." },
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
      entryDataForForm.domain = record.staged_domain ?? record.domain;
      entryDataForForm.content = record.staged_content ?? record.content;
      entryDataForForm.tags = record.staged_tags ?? record.tags;
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
  const { title, type, domain, content, status, tags } = req.body;
  const submittedStatus = status || "draft";

  try {
    const originalRecord = await pbAdmin.collection("entries_main").getOne(entryId);
    if (originalRecord.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    let updateData = {};
    const wasPublished = originalRecord.status === "published";
    const isStayingPublished = submittedStatus === "published";

    if (wasPublished && isStayingPublished) {
      updateData = {
        staged_title: title,
        staged_type: type,
        staged_domain: domain,
        staged_content: content,
        staged_tags: tags || "",
        has_staged_changes: true,
      };
    } else {
      updateData = {
        title,
        type,
        domain,
        content,
        tags: tags || "",
        status: submittedStatus,
        has_staged_changes: false,
        staged_title: null,
        staged_type: null,
        staged_domain: null,
        staged_content: null,
        staged_tags: null,
      };
    }

    await pbAdmin.collection("entries_main").update(entryId, updateData);
    res.redirect("/");
  } catch (error) {
    console.error(`Failed to update/stage entry ${entryId}:`, error);

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const pbErrors = error?.data?.data || {
      general: "Failed to save changes. Please check the form.",
    };

    try {
      const recordForRender = await pbAdmin.collection("entries_main").getOne(entryId);
      if (recordForRender.owner !== userId) return next(new Error("Forbidden"));

      const entryDataForForm = {
        ...recordForRender,
        title,
        type,
        domain,
        content,
        status: submittedStatus,
        tags,
      };

      let isEditingStaged = false;
      if (recordForRender.status === "published" && recordForRender.has_staged_changes) {
        isEditingStaged = true;
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

  try {
    await getEntryForOwner(entryId, userId);
    await pb.collection("entries_main").delete(entryId);
    clearEntryViewLogs(entryId);

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
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/?error=delete_failed");
  }
});

router.post("/archive/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;

  try {
    const record = await getEntryForOwner(entryId, userId);

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

    await pbAdmin.collection("entries_archived").create(archiveData);
    await pbAdmin.collection("entries_main").delete(entryId);

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

  try {
    const record = await getArchivedEntryForOwner(entryId, userId);

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

    await pbAdmin.collection("entries_main").create(mainData);
    await pbAdmin.collection("entries_archived").delete(entryId);

    res.redirect("/archived?action=unarchived");
  } catch (error) {
    console.error(`Failed to unarchive entry ${entryId}:`, error);
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/archived?error=unarchive_failed");
  }
});

router.post("/delete-archived/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  const userId = req.session.user.id;

  try {
    const record = await getArchivedEntryForOwner(entryId, userId);
    await pbAdmin.collection("entries_archived").delete(entryId);
    const idToClean = record.original_id || entryId;
    clearEntryViewLogs(idToClean);

    res.redirect("/archived?action=deleted");
  } catch (error) {
    console.error(`Failed to delete archived entry ${entryId}:`, error);
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect("/archived?error=delete_failed");
  }
});

export default router;
