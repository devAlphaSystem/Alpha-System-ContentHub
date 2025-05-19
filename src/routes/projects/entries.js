import express from "express";
import { projectModuleAccess } from "../../middleware/projectModuleAccess.js";
import { marked } from "marked";
import { pb, pbAdmin, ITEMS_PER_PAGE } from "../../config.js";
import { getProjectForOwner, getEntryForOwnerAndProject, getUserTemplates, getUserHeaders, getUserFooters, logAuditEvent, sanitizeHtml, calculateReadingTime, clearEntryViewLogs } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Entries] checkProjectAccess middleware for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[PROJ][Entries] Project ID is missing in checkProjectAccess.");
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      logger.warn(`[PROJ][Entries] Project ${projectId} not found or access denied for user ${userId} in checkProjectAccess.`);
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    logger.debug(`[PROJ][Entries] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    logger.error(`[PROJ][Entries] Error in checkProjectAccess for project ${projectId}, user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
}

router.use("/:projectId", checkProjectAccess);

const customRenderer = new marked.Renderer();
const originalImageRenderer = customRenderer.image;
const originalCodeRenderer = customRenderer.code;

customRenderer.image = function (href, title, text) {
  let actualHref = href;
  let themeClass = "";
  let cleanHref = "";

  if (typeof href === "object" && href !== null && href.href) {
    actualHref = href.href;
  } else if (typeof href !== "string") {
    logger.warn(`[MarkdownRender] Unexpected href type received: ${typeof href}. Falling back.`, href);
    return originalImageRenderer.call(this, href, title, text);
  }

  cleanHref = actualHref;

  if (typeof actualHref === "string") {
    if (actualHref.includes("#light")) {
      themeClass = "light-mode-image";
      cleanHref = actualHref.replace(/#light$/, "");
    } else if (actualHref.includes("#dark")) {
      themeClass = "dark-mode-image";
      cleanHref = actualHref.replace(/#dark$/, "");
    }
  }

  const titleAttr = title ? ` title="${title}"` : "";
  const classAttr = themeClass ? ` class="${themeClass}"` : "";
  const escapedText = text ? text.replace(/"/g, "&quot;") : "";

  if (typeof cleanHref !== "string") {
    logger.error(`[MarkdownRender] cleanHref ended up non-string: ${typeof cleanHref}. Fallback needed.`);
    return "<!-- Error rendering image: Invalid href type -->";
  }

  return `<img src="${cleanHref}" alt="${escapedText}"${titleAttr}${classAttr}>`;
};

customRenderer.code = function (code, language, isEscaped) {
  if (language === "mermaid") {
    return `<pre class="language-mermaid">${code}</pre>`;
  }
  return originalCodeRenderer.call(this, code, language, isEscaped);
};

function parseMarkdownWithThemeImages(markdownContent) {
  if (!markdownContent) {
    return "";
  }
  const unsafeHtml = marked.parse(markdownContent, {
    renderer: customRenderer,
  });
  return sanitizeHtml(unsafeHtml);
}

async function renderEntriesList(req, res, entryType) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Entries] Rendering entries list for type ${entryType}, project ${projectId}, user ${userId}`);
  logger.time(`[PROJ][Entries] renderEntriesList ${entryType} ${projectId}`);
  let pageTitle = "";
  let viewName = "";
  let listFields = "id,title,status,type,collection,views,updated,owner,has_staged_changes,tags,total_view_duration,view_duration_count,helpful_yes,helpful_no,content_updated_at";

  switch (entryType) {
    case "documentation":
      pageTitle = `Documentation - ${req.project.name}`;
      viewName = "projects/documentation";
      break;
    case "changelog":
      pageTitle = `Changelogs - ${req.project.name}`;
      viewName = "projects/changelogs";
      break;
    case "roadmap":
      pageTitle = `Roadmap - ${req.project.name}`;
      viewName = "projects/roadmaps";
      listFields += ",roadmap_stage";
      break;
    case "knowledge_base":
      pageTitle = `Knowledge Base - ${req.project.name}`;
      viewName = "projects/knowledge_base";
      break;
    default:
      logger.error(`[PROJ][Entries] Invalid entry type requested: ${entryType}`);
      logger.timeEnd(`[PROJ][Entries] renderEntriesList ${entryType} ${projectId}`);
      return res.status(400).send("Invalid entry type");
  }

  try {
    const filter = `owner = '${userId}' && project = '${projectId}' && type = '${entryType}'`;
    const initialPage = 1;
    const initialSort = entryType === "roadmap" ? "+roadmap_stage" : "+title";
    logger.trace(`[PROJ][Entries] Entries list filter: ${filter}, Sort: ${initialSort}`);

    const resultList = await pb.collection("entries_main").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: listFields,
    });
    logger.debug(`[PROJ][Entries] Fetched ${resultList.items.length} ${entryType} entries (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

    let collectionsList = [];
    if (entryType !== "roadmap" && entryType !== "knowledge_base") {
      try {
        logger.trace(`[PROJ][Entries] Fetching collections list for ${entryType}, project ${projectId}`);
        const allCollectionsResult = await pbAdmin.collection("entries_main").getFullList({
          filter: `owner = '${userId}' && project = '${projectId}' && type = '${entryType}' && collection != '' && collection != null`,
          fields: "collection",
          $autoCancel: false,
        });
        collectionsList = [...new Set(allCollectionsResult.map((item) => item.collection).filter(Boolean))].sort();
        logger.trace(`[PROJ][Entries] Found ${collectionsList.length} unique collections for ${entryType}, project ${projectId}`);
      } catch (collectionError) {
        logger.warn(`[PROJ][Entries] Could not fetch collections list for project ${projectId}, type ${entryType}: Status ${collectionError?.status || "N/A"}`, collectionError.message);
      }
    }

    const entriesWithViewUrl = [];
    for (const entry of resultList.items) {
      entriesWithViewUrl.push({
        ...entry,
        viewUrl: entryType !== "roadmap" && entryType !== "knowledge_base" ? `/view/${entry.id}` : null,
        formattedUpdated: new Date(entry.content_updated_at || entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        systemUpdatedAt: entry.updated,
      });
    }

    logger.debug(`[PROJ][Entries] Rendering view ${viewName} for project ${projectId}`);
    logger.timeEnd(`[PROJ][Entries] renderEntriesList ${entryType} ${projectId}`);
    res.render(viewName, {
      pageTitle: pageTitle,
      project: req.project,
      entries: entriesWithViewUrl,
      entryType: entryType,
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
    logger.timeEnd(`[PROJ][Entries] renderEntriesList ${entryType} ${projectId}`);
    logger.error(`[PROJ][Entries] Error fetching ${entryType} entries for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${entryType.toUpperCase()}_LIST_FAILURE`, "entries_main", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render(viewName, {
      pageTitle: pageTitle,
      project: req.project,
      entries: [],
      entryType: entryType,
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "+title",
      collectionsList: [],
      error: `Could not load ${entryType} entries.`,
      action: null,
    });
  }
}

router.get("/:projectId/documentation", projectModuleAccess("documentation"), (req, res) => {
  renderEntriesList(req, res, "documentation");
});

router.get("/:projectId/changelogs", projectModuleAccess("changelog"), (req, res) => {
  renderEntriesList(req, res, "changelog");
});

router.get("/:projectId/roadmaps", projectModuleAccess("roadmap"), (req, res) => {
  renderEntriesList(req, res, "roadmap");
});

router.get("/:projectId/knowledge_base", projectModuleAccess("knowledge_base"), (req, res) => {
  renderEntriesList(req, res, "knowledge_base");
});

router.get("/:projectId/new", async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const validTypes = ["documentation", "changelog", "roadmap", "knowledge_base"];
  const preselectType = validTypes.includes(req.query.type) ? req.query.type : "documentation";

  const moduleFieldMap = {
    documentation: "documentation_enabled",
    changelog: "changelog_enabled",
    roadmap: "roadmap_enabled",
    knowledge_base: "knowledge_base_enabled",
  };

  const moduleField = moduleFieldMap[preselectType];
  if (moduleField && req.project[moduleField] === false) {
    logger.info(`[Entries] Attempt to access new entry page for disabled module '${preselectType}' in project ${projectId}.`);
    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/new ${userId}`);
    return res.status(403).render("errors/403", { message: `The ${preselectType.replace("_", " ")} module is disabled for this project.` });
  }

  logger.debug(`[PROJ][Entries] GET /projects/${projectId}/new requested by user ${userId}, type: ${preselectType}`);
  logger.time(`[PROJ][Entries] GET /projects/${projectId}/new ${userId}`);

  try {
    logger.time(`[PROJ][Entries] FetchNewEntryAssets ${projectId}`);
    const [templates, headers, footers] = await Promise.all([getUserTemplates(userId, projectId), getUserHeaders(userId), getUserFooters(userId)]);
    logger.timeEnd(`[PROJ][Entries] FetchNewEntryAssets ${projectId}`);
    logger.trace(`[PROJ][Entries] Fetched assets for new entry page: ${templates.length} templates, ${headers.length} headers, ${footers.length} footers.`);

    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/new ${userId}`);
    res.render("projects/new_entry", {
      pageTitle: `New Entry - ${req.project.name}`,
      project: req.project,
      entry: {
        type: preselectType,
      },
      errors: null,
      templates: templates,
      headers: headers,
      footers: footers,
      entryType: preselectType,
      roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/new ${userId}`);
    logger.error(`[PROJ][Entries] Error loading new entry page for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_NEW_LOAD_FAILURE", null, null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/new_entry", {
      pageTitle: `New Entry - ${req.project.name}`,
      project: req.project,
      entry: {
        type: preselectType,
      },
      errors: {
        general: "Could not load page data (templates/headers/footers).",
      },
      templates: [],
      headers: [],
      footers: [],
      entryType: preselectType,
      roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
    });
  }
});

router.post("/:projectId/new", async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { title, type, content, status, tags, collection, url, custom_header, custom_footer, show_in_project_sidebar, roadmap_stage } = req.body;
  logger.info(`[PROJ][Entries] POST /projects/${projectId}/new attempt by user ${userId}. Type: ${type}, Title: ${title}`);
  logger.time(`[PROJ][Entries] POST /projects/${projectId}/new ${userId}`);
  const pbErrors = {};

  const trimmedUrl = url ? url.trim() : "";

  if (trimmedUrl && trimmedUrl.length !== 15) {
    pbErrors.url = {
      message: "URL (ID) must be exactly 15 characters long if provided.",
    };
  }
  if (!title || title.trim() === "") {
    pbErrors.title = {
      message: "Title is required.",
    };
  }
  if (!type) {
    pbErrors.type = {
      message: "Type is required.",
    };
  }
  if (type !== "roadmap" && type !== "knowledge_base" && type !== "sidebar_header" && (!content || content.trim() === "")) {
    pbErrors.content = {
      message: "Content is required.",
    };
  }
  if (type === "knowledge_base" && (!content || content.trim() === "")) {
    pbErrors.content = {
      message: "Answer content is required.",
    };
  }
  if (type === "roadmap" && (!roadmap_stage || roadmap_stage.trim() === "")) {
    pbErrors.roadmap_stage = {
      message: "Roadmap Stage is required.",
    };
  }

  if (Object.keys(pbErrors).length > 0) {
    logger.warn(`[PROJ][Entries] New entry validation failed for project ${projectId}:`, pbErrors);
    try {
      logger.time(`[PROJ][Entries] FetchNewEntryAssetsOnError ${projectId}`);
      const [templates, headers, footers] = await Promise.all([getUserTemplates(userId, projectId), getUserHeaders(userId), getUserFooters(userId)]);
      logger.timeEnd(`[PROJ][Entries] FetchNewEntryAssetsOnError ${projectId}`);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_header: custom_header || "",
        custom_footer: custom_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
        content_updated_at: new Date().toISOString(),
      };
      logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/new ${userId}`);
      return res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: pbErrors,
        templates: templates,
        headers: headers,
        footers: footers,
        entryType: type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    } catch (fetchError) {
      logger.timeEnd(`[PROJ][Entries] FetchNewEntryAssetsOnError ${projectId}`);
      logger.error(`[PROJ][Entries] Error fetching assets after entry creation validation failure for project ${projectId}: ${fetchError.message}`);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_header: custom_header || "",
        custom_footer: custom_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
        content_updated_at: new Date().toISOString(),
      };
      logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/new ${userId}`);
      return res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: {
          ...pbErrors,
          general: "Could not load page data.",
        },
        templates: [],
        headers: [],
        footers: [],
        entryType: type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    }
  }

  const data = {
    title,
    type,
    content: content || "",
    status: status || "draft",
    tags: tags || "",
    collection: collection || "",
    views: 0,
    owner: userId,
    project: projectId,
    custom_header: custom_header || null,
    custom_footer: custom_footer || null,
    show_in_project_sidebar: show_in_project_sidebar === "true",
    roadmap_stage: type === "roadmap" ? roadmap_stage || null : null,
    has_staged_changes: false,
    staged_title: null,
    staged_type: null,
    staged_content: null,
    staged_tags: null,
    staged_collection: null,
    staged_header: null,
    staged_footer: null,
    staged_roadmap_stage: null,
    content_updated_at: new Date().toISOString(),
  };

  const recordIdToUse = trimmedUrl.length === 15 ? trimmedUrl : undefined;
  if (recordIdToUse) {
    data.id = recordIdToUse;
    logger.debug(`[PROJ][Entries] Attempting to create entry with provided ID: ${recordIdToUse}`);
  }

  try {
    logger.debug(`[PROJ][Entries] Creating entry in project ${projectId} with data:`, {
      title: data.title,
      type: data.type,
      status: data.status,
      id: data.id,
    });
    const newRecord = await pb.collection("entries_main").create(data);
    logger.info(`[PROJ][Entries] Entry created successfully: ${newRecord.id} (${newRecord.title}) in project ${projectId} by user ${userId}`);
    logAuditEvent(req, "ENTRY_CREATE", "entries_main", newRecord.id, {
      projectId: projectId,
      title: newRecord.title,
      status: newRecord.status,
      type: newRecord.type,
      stage: newRecord.roadmap_stage,
    });
    let redirectPath = `/projects/${projectId}/documentation`;
    if (type === "changelog") redirectPath = `/projects/${projectId}/changelogs`;
    if (type === "roadmap") redirectPath = `/projects/${projectId}/roadmaps`;
    if (type === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base`;
    logger.debug(`[PROJ][Entries] Redirecting to ${redirectPath} after entry creation.`);
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/new ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/new ${userId}`);
    logger.error(`[PROJ][Entries] Failed to create entry in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_CREATE_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
      data: {
        title: data.title,
        type: data.type,
        status: data.status,
      },
      providedId: url,
    });
    const creationErrors = error?.data?.data || error?.originalError?.data?.data || {};
    const errorResponseMessage = error?.data?.message || error?.originalError?.data?.message || "";
    if ((error.status === 400 || error.status === 409) && (errorResponseMessage.includes("already exists") || creationErrors.id?.message)) {
      creationErrors.url = {
        message: "This URL (ID) is already in use. Please choose another.",
      };
      if (creationErrors.id) creationErrors.id = undefined;
      logger.warn(`[PROJ][Entries] Entry creation failed: ID ${recordIdToUse} already exists.`);
    } else if (!creationErrors.general && Object.keys(creationErrors).length === 0) {
      creationErrors.general = {
        message: errorResponseMessage || "Failed to create entry. Please check the form or try again.",
      };
    }

    const headerFooterFields = ["custom_header", "custom_footer"];
    for (const field of headerFooterFields) {
      if (creationErrors[field]) {
        creationErrors[field] = {
          message: `Invalid ${field.replace("custom_", "").replace("_", " ")} selection.`,
        };
      }
    }

    try {
      logger.time(`[PROJ][Entries] FetchNewEntryAssetsOnError ${projectId}`);
      const [templates, headers, footers] = await Promise.all([getUserTemplates(userId, projectId), getUserHeaders(userId), getUserFooters(userId)]);
      logger.timeEnd(`[PROJ][Entries] FetchNewEntryAssetsOnError ${projectId}`);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_header: custom_header || "",
        custom_footer: custom_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
        content_updated_at: new Date().toISOString(),
      };
      res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: creationErrors,
        templates: templates,
        headers: headers,
        footers: footers,
        entryType: type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    } catch (fetchError) {
      logger.timeEnd(`[PROJ][Entries] FetchNewEntryAssetsOnError ${projectId}`);
      logger.error(`[PROJ][Entries] Error fetching assets after entry creation failure: ${fetchError.message}`);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_header: custom_header || "",
        custom_footer: custom_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
        content_updated_at: new Date().toISOString(),
      };
      res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: {
          ...creationErrors,
          general: "Could not load page data.",
        },
        templates: [],
        headers: [],
        footers: [],
        entryType: type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    }
  }
});

router.get("/:projectId/edit/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Entries] GET /projects/${projectId}/edit/${entryId} requested by user ${userId}`);
  logger.time(`[PROJ][Entries] GET /projects/${projectId}/edit/${entryId} ${userId}`);

  try {
    logger.time(`[PROJ][Entries] FetchEditEntryAssets ${entryId}`);
    const [record, headers, footers] = await Promise.all([getEntryForOwnerAndProject(entryId, userId, projectId), getUserHeaders(userId), getUserFooters(userId)]);
    logger.timeEnd(`[PROJ][Entries] FetchEditEntryAssets ${entryId}`);
    logger.trace(`[PROJ][Entries] Fetched entry ${entryId} and assets for edit page.`);

    const entryDataForForm = {
      ...record,
    };
    let isEditingStaged = false;

    if (record.status === "published" && record.has_staged_changes) {
      isEditingStaged = true;
      logger.trace(`[PROJ][Entries] Editing staged changes for entry ${entryId}.`);
      const stagedType = record.staged_type ?? record.type;
      entryDataForForm.title = record.staged_title ?? record.title;
      entryDataForForm.type = stagedType;
      entryDataForForm.content = record.staged_content ?? record.content;
      entryDataForForm.tags = record.staged_tags ?? record.tags;
      entryDataForForm.collection = record.collection;
      entryDataForForm.show_in_project_sidebar = record.show_in_project_sidebar;
      entryDataForForm.custom_header = record.staged_header ?? record.custom_header;
      entryDataForForm.custom_footer = record.staged_footer ?? record.custom_footer;

      if (stagedType === "roadmap") {
        entryDataForForm.roadmap_stage = record.staged_roadmap_stage ?? record.roadmap_stage;
      } else {
        entryDataForForm.roadmap_stage = record.roadmap_stage;
      }
    } else {
      logger.trace(`[PROJ][Entries] Editing published/draft entry ${entryId}.`);
    }

    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/edit/${entryId} ${userId}`);
    res.render("projects/edit_entry", {
      pageTitle: `Edit Entry - ${req.project.name}`,
      project: req.project,
      entry: entryDataForForm,
      originalStatus: record.status,
      hasStagedChanges: record.has_staged_changes,
      isEditingStaged: isEditingStaged,
      errors: null,
      headers: headers,
      footers: footers,
      entryType: entryDataForForm.type,
      roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/edit/${entryId} ${userId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ][Entries] Access denied or not found for edit entry ${entryId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ][Entries] Failed to fetch entry ${entryId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_EDIT_LOAD_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/edit/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { title, type, content, status, tags, collection, custom_header, custom_footer, show_in_project_sidebar, roadmap_stage } = req.body;
  const submittedStatus = status || "draft";
  const submittedType = type;
  const showInSidebarValue = show_in_project_sidebar === "true";
  logger.info(`[PROJ][Entries] POST /projects/${projectId}/edit/${entryId} attempt by user ${userId}. Type: ${submittedType}, Status: ${submittedStatus}`);
  logger.time(`[PROJ][Entries] POST /projects/${projectId}/edit/${entryId} ${userId}`);

  let originalRecord;
  try {
    originalRecord = await pbAdmin.collection("entries_main").getOne(entryId);
    if (originalRecord.owner !== userId || originalRecord.project !== projectId) {
      logger.warn(`[PROJ][Entries] Forbidden attempt to edit entry ${entryId} by user ${userId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      logAuditEvent(req, "ENTRY_UPDATE_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Forbidden",
      });
      logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/edit/${entryId} ${userId}`);
      return next(err);
    }

    const pbErrors = {};
    if (submittedType === "roadmap" && (!roadmap_stage || roadmap_stage.trim() === "")) {
      pbErrors.roadmap_stage = {
        message: "Roadmap Stage is required.",
      };
    }
    if (submittedType !== "roadmap" && submittedType !== "knowledge_base" && submittedType !== "sidebar_header" && (!content || content.trim() === "")) {
      pbErrors.content = {
        message: "Content is required.",
      };
    }
    if (submittedType === "knowledge_base" && (!content || content.trim() === "")) {
      pbErrors.content = {
        message: "Answer content is required.",
      };
    }

    if (Object.keys(pbErrors).length > 0) {
      logger.warn(`[PROJ][Entries] Edit entry validation failed for ${entryId}, project ${projectId}:`, pbErrors);
      logger.time(`[PROJ][Entries] FetchEditEntryAssetsOnError ${entryId}`);
      const [headers, footers] = await Promise.all([getUserHeaders(userId), getUserFooters(userId)]);
      logger.timeEnd(`[PROJ][Entries] FetchEditEntryAssetsOnError ${entryId}`);
      const entryDataForForm = {
        ...originalRecord,
        title,
        type: submittedType,
        content: content || "",
        status: submittedStatus,
        tags,
        collection,
        custom_header,
        custom_footer,
        show_in_project_sidebar: showInSidebarValue,
        roadmap_stage,
      };
      logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/edit/${entryId} ${userId}`);
      return res.status(400).render("projects/edit_entry", {
        pageTitle: `Edit Entry - ${req.project.name}`,
        project: req.project,
        entry: entryDataForForm,
        originalStatus: originalRecord.status,
        hasStagedChanges: originalRecord.has_staged_changes,
        isEditingStaged: originalRecord.status === "published" && originalRecord.has_staged_changes,
        errors: pbErrors,
        headers,
        footers,
        entryType: submittedType,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    }

    let updateData = {};
    const wasPublished = originalRecord.status === "published";
    const isStayingPublished = submittedStatus === "published";
    let actionType = "ENTRY_UPDATE";

    if (wasPublished && isStayingPublished) {
      actionType = "ENTRY_STAGE_CHANGES";
      logger.debug(`[PROJ][Entries] Staging changes for published entry ${entryId}.`);
      updateData = {
        staged_title: title,
        staged_type: submittedType,
        staged_content: submittedType === "sidebar_header" ? "" : content,
        staged_tags: submittedType === "sidebar_header" ? "" : tags || "",
        staged_header: custom_header || null,
        staged_footer: custom_footer || null,
        staged_roadmap_stage: submittedType === "roadmap" ? roadmap_stage || null : null,
        has_staged_changes: true,
        collection: submittedType === "sidebar_header" ? "" : collection || "",
        show_in_project_sidebar: submittedType === "sidebar_header" ? true : showInSidebarValue,
      };
    } else {
      logger.debug(`[PROJ][Entries] Updating entry ${entryId} directly (not staging).`);
      updateData = {
        title,
        type: submittedType,
        content: submittedType === "sidebar_header" ? "" : content,
        tags: submittedType === "sidebar_header" ? "" : tags || "",
        collection: submittedType === "sidebar_header" ? "" : collection || "",
        status: submittedType === "sidebar_header" ? "published" : submittedStatus,
        custom_header: custom_header || null,
        custom_footer: custom_footer || null,
        roadmap_stage: submittedType === "roadmap" ? roadmap_stage || null : null,
        show_in_project_sidebar: submittedType === "sidebar_header" ? true : showInSidebarValue,
        has_staged_changes: false,
        staged_title: null,
        staged_type: null,
        staged_content: null,
        staged_tags: null,
        staged_collection: null,
        staged_header: null,
        staged_footer: null,
        staged_roadmap_stage: null,
        content_updated_at: new Date().toISOString(),
      };
      if (wasPublished && submittedStatus === "draft") {
        actionType = "ENTRY_UNPUBLISH";
        logger.debug(`[PROJ][Entries] Unpublishing entry ${entryId}.`);
      } else if (!wasPublished && submittedStatus === "published") {
        actionType = "ENTRY_PUBLISH";
        logger.debug(`[PROJ][Entries] Publishing entry ${entryId}.`);
      }
    }

    const updatedRecord = await pbAdmin.collection("entries_main").update(entryId, updateData);
    logger.info(`[PROJ][Entries] Entry ${entryId} updated/staged successfully. Action: ${actionType}`);
    logAuditEvent(req, actionType, "entries_main", entryId, {
      projectId: projectId,
      title: updatedRecord.title,
      status: updatedRecord.status,
      type: updatedRecord.type,
      stage: updatedRecord.roadmap_stage,
    });
    let redirectPath = `/projects/${projectId}/documentation`;
    if (updatedRecord.type === "changelog") redirectPath = `/projects/${projectId}/changelogs`;
    if (updatedRecord.type === "roadmap") redirectPath = `/projects/${projectId}/roadmaps`;
    if (updatedRecord.type === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base`;
    if (updatedRecord.type === "sidebar_header") redirectPath = `/projects/${projectId}/sidebar-order`;
    logger.debug(`[PROJ][Entries] Redirecting to ${redirectPath} after entry update.`);
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/edit/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/edit/${entryId} ${userId}`);
    logger.error(`[PROJ][Entries] Failed to update/stage entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_UPDATE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const pbErrors = error?.data?.data || {
      general: "Failed to save changes. Please check the form.",
    };

    const headerFooterFields = ["custom_header", "custom_footer", "staged_header", "staged_footer", "roadmap_stage", "staged_roadmap_stage"];
    for (const field of headerFooterFields) {
      if (pbErrors[field]) {
        pbErrors[field] = {
          message: `Invalid ${field.replace("custom_", "").replace("staged_", "").replace("_", " ")} selection.`,
        };
      }
    }

    try {
      logger.time(`[PROJ][Entries] FetchEditEntryAssetsOnError ${entryId}`);
      const [recordForRender, headers, footers] = await Promise.all([originalRecord || pbAdmin.collection("entries_main").getOne(entryId), getUserHeaders(userId), getUserFooters(userId)]);
      logger.timeEnd(`[PROJ][Entries] FetchEditEntryAssetsOnError ${entryId}`);

      if (recordForRender.owner !== userId || recordForRender.project !== projectId) {
        logger.error(`[PROJ][Entries] Forbidden access detected after update error for entry ${entryId}.`);
        return next(new Error("Forbidden"));
      }

      const entryDataForForm = {
        ...recordForRender,
        title,
        type: submittedType,
        content: content || "",
        status: submittedStatus,
        tags,
        collection,
        custom_header: custom_header || "",
        custom_footer: custom_footer || "",
        show_in_project_sidebar: showInSidebarValue,
        roadmap_stage: roadmap_stage || "",
      };

      let isEditingStaged = false;
      if (recordForRender.status === "published" && recordForRender.has_staged_changes) {
        isEditingStaged = true;
        entryDataForForm.title = title;
        entryDataForForm.type = submittedType;
        entryDataForForm.content = content || "";
        entryDataForForm.tags = tags;
        entryDataForForm.custom_header = custom_header || "";
        entryDataForForm.custom_footer = custom_footer || "";
        entryDataForForm.show_in_project_sidebar = showInSidebarValue;
        entryDataForForm.roadmap_stage = roadmap_stage || "";
      }

      res.status(400).render("projects/edit_entry", {
        pageTitle: `Edit Entry - ${req.project.name}`,
        project: req.project,
        entry: entryDataForForm,
        originalStatus: recordForRender.status,
        hasStagedChanges: recordForRender.has_staged_changes,
        isEditingStaged: isEditingStaged,
        errors: pbErrors,
        headers: headers,
        footers: footers,
        entryType: entryDataForForm.type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    } catch (fetchError) {
      logger.error(`[PROJ][Entries] Error fetching data for edit form after update failure on entry ${entryId}: ${fetchError.message}`);
      next(fetchError);
    }
  }
});

router.get("/:projectId/diff/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Entries] GET /projects/${projectId}/diff/${entryId} requested by user ${userId}`);
  logger.time(`[PROJ][Entries] GET /projects/${projectId}/diff/${entryId} ${userId}`);

  try {
    const record = await getEntryForOwnerAndProject(entryId, userId, projectId);

    if (record.status !== "published" || !record.has_staged_changes) {
      logger.warn(`[PROJ][Entries] Diff view requested for entry ${entryId}, but it's not published or has no staged changes. Status: ${record.status}, HasStaged: ${record.has_staged_changes}`);
      const err = new Error("Diff view is only available for published entries with staged changes.");
      err.status = 400;
      logAuditEvent(req, "ENTRY_DIFF_VIEW_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Not published or no staged changes",
      });
      logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/diff/${entryId} ${userId}`);
      return next(err);
    }

    const publishedContent = record.content || "";
    const stagedContent = record.staged_content || "";

    logAuditEvent(req, "ENTRY_DIFF_VIEW", "entries_main", entryId, {
      projectId: projectId,
      title: record.title,
    });

    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/diff/${entryId} ${userId}`);
    res.render("projects/diff_view", {
      pageTitle: `Changes for ${record.title} - ${req.project.name}`,
      project: req.project,
      entry: record,
      publishedContent: publishedContent,
      stagedContent: stagedContent,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/diff/${entryId} ${userId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ][Entries] Access denied or not found for diff view entry ${entryId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ][Entries] Failed to fetch entry ${entryId} for diff view in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_DIFF_VIEW_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.get("/:projectId/preview-staged/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Entries] GET /projects/${projectId}/preview-staged/${entryId} requested by user ${userId}`);
  logger.time(`[PROJ][Entries] GET /projects/${projectId}/preview-staged/${entryId} ${userId}`);

  try {
    const record = await pbAdmin.collection("entries_main").getOne(entryId, {
      expand: "project,custom_header,custom_footer,staged_header,staged_footer",
      fields: "*,expand.project.*," + "expand.custom_header.id,expand.custom_header.content,expand.custom_header.apply_full_width,expand.custom_header.is_sticky,expand.custom_header.custom_css,expand.custom_header.custom_js," + "expand.custom_footer.id,expand.custom_footer.content,expand.custom_footer.apply_full_width,expand.custom_footer.custom_css,expand.custom_footer.custom_js," + "expand.staged_header.id,expand.staged_header.content,expand.staged_header.apply_full_width,expand.staged_header.is_sticky,expand.staged_header.custom_css,expand.staged_header.custom_js," + "expand.staged_footer.id,expand.staged_footer.content,expand.staged_footer.apply_full_width,expand.staged_footer.custom_css,expand.staged_footer.custom_js",
    });

    if (record.owner !== userId || record.project !== projectId) {
      logger.warn(`[PROJ][Entries] Forbidden attempt to preview staged entry ${entryId} by user ${userId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }

    if (record.status !== "published" || !record.has_staged_changes) {
      logger.warn(`[PROJ][Entries] Staged preview requested for entry ${entryId}, but it's not published or has no staged changes. Status: ${record.status}, HasStaged: ${record.has_staged_changes}`);
      logAuditEvent(req, "ENTRY_STAGED_PREVIEW_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Not published or no staged changes",
      });
      logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/preview-staged/${entryId} ${userId}`);
      return res.redirect(`/projects/${projectId}/edit/${entryId}?error=Staged preview only available for published entries with changes.`);
    }

    const stagedType = record.staged_type ?? record.type;
    const stagedContent = record.staged_content ?? record.content;
    const stagedTitle = record.staged_title ?? record.title;
    const stagedTags = record.staged_tags ?? record.tags;

    const cleanMainHtml = parseMarkdownWithThemeImages(stagedContent);
    const readingTime = calculateReadingTime(stagedContent);

    const headerRecordToUse = record.expand?.staged_header ?? record.expand?.custom_header;
    const footerRecordToUse = record.expand?.staged_footer ?? record.expand?.custom_footer;

    const customHeaderHtml = headerRecordToUse?.content ? parseMarkdownWithThemeImages(headerRecordToUse.content) : null;
    const headerApplyFullWidth = headerRecordToUse?.apply_full_width === true;
    const headerIsSticky = headerRecordToUse?.is_sticky === true;
    const headerCustomCss = headerRecordToUse?.custom_css || null;
    const headerCustomJs = headerRecordToUse?.custom_js || null;

    const customFooterHtml = footerRecordToUse?.content ? parseMarkdownWithThemeImages(footerRecordToUse.content) : null;
    const footerApplyFullWidth = footerRecordToUse?.apply_full_width === true;
    const footerCustomCss = footerRecordToUse?.custom_css || null;
    const footerCustomJs = footerRecordToUse?.custom_js || null;

    let sidebarEntries = [];
    let hasPublishedKbEntries = false;
    if (req.project) {
      try {
        logger.time(`[PROJ][Entries] FetchSidebar /preview-staged/${entryId}`);
        sidebarEntries = await pbAdmin.collection("entries_main").getFullList({
          filter: `project = '${projectId}' && status = 'published' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
          sort: "+sidebar_order,+title",
          fields: "id, title, type",
          $autoCancel: false,
        });
        logger.timeEnd(`[PROJ][Entries] FetchSidebar /preview-staged/${entryId}`);
      } catch (sidebarError) {
        logger.timeEnd(`[PROJ][Entries] FetchSidebar /preview-staged/${entryId}`);
        logger.error(`[PROJ][Entries] Failed to fetch sidebar entries for project ${projectId}: Status ${sidebarError?.status || "N/A"}`, sidebarError?.message || sidebarError);
      }
      try {
        await pbAdmin.collection("entries_main").getFirstListItem(`project = '${projectId}' && type = 'knowledge_base' && status = 'published'`, { fields: "id", $autoCancel: false });
        hasPublishedKbEntries = true;
      } catch (kbError) {
        if (kbError.status !== 404) {
          logger.warn(`[PROJ][Entries] Error checking for published KB entries for project ${projectId} (staged preview): Status ${kbError?.status || "N/A"}`, kbError.message);
        }
        hasPublishedKbEntries = false;
      }
    }

    const entryForView = {
      ...record,
      title: stagedTitle,
      type: stagedType,
      tags: stagedTags,
      updated: record.content_updated_at || record.updated,
    };

    logAuditEvent(req, "ENTRY_STAGED_PREVIEW", "entries_main", entryId, {
      projectId: projectId,
      title: stagedTitle,
    });

    logger.debug(`[PROJ][Entries] Rendering staged preview for entry ${entryId}`);
    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/preview-staged/${entryId} ${userId}`);
    res.render("view", {
      entry: entryForView,
      project: req.project,
      sidebarEntries: sidebarEntries,
      contentHtml: cleanMainHtml,
      readingTime: readingTime,
      customHeaderHtml: customHeaderHtml,
      customFooterHtml: customFooterHtml,
      headerApplyFullWidth: headerApplyFullWidth,
      footerApplyFullWidth: footerApplyFullWidth,
      headerIsSticky: headerIsSticky,
      headerCustomCss: headerCustomCss,
      headerCustomJs: headerCustomJs,
      footerCustomCss: footerCustomCss,
      footerCustomJs: footerCustomJs,
      pageTitle: `[STAGED PREVIEW] ${stagedTitle}`,
      isStagedPreview: true,
      hasPublishedKbEntries: hasPublishedKbEntries,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] GET /projects/${projectId}/preview-staged/${entryId} ${userId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ][Entries] Access denied or not found for staged preview entry ${entryId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ][Entries] Failed to fetch entry ${entryId} for staged preview in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_STAGED_PREVIEW_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/delete/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let entryTitle = entryId;
  let entryType = "documentation";
  logger.warn(`[PROJ][Entries] POST /projects/${projectId}/delete/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ][Entries] POST /projects/${projectId}/delete/${entryId} ${userId}`);

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);
    entryTitle = entry.title;
    entryType = entry.type;
    logger.debug(`[PROJ][Entries] Deleting entry ${entryId} (${entryTitle}) in project ${projectId}`);

    await pb.collection("entries_main").delete(entryId);
    clearEntryViewLogs(entryId);
    logAuditEvent(req, "ENTRY_DELETE", "entries_main", entryId, {
      projectId: projectId,
      title: entryTitle,
      type: entryType,
    });
    logger.info(`[PROJ][Entries] Entry ${entryId} (${entryTitle}) deleted successfully from project ${projectId} by user ${userId}.`);

    try {
      logger.debug(`[PROJ][Entries] Cleaning preview tokens for deleted entry ${entryId}.`);
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({
        filter: `entry = '${entryId}'`,
        fields: "id",
      });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
      logger.trace(`[PROJ][Entries] Cleaned ${previewTokens.length} preview tokens.`);
    } catch (previewCleanError) {
      logger.error(`[PROJ][Entries] Error cleaning preview tokens for deleted entry ${entryId}: ${previewCleanError.message}`);
    }
    let redirectPath = `/projects/${projectId}/documentation?action=deleted`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/changelogs?action=deleted`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/roadmaps?action=deleted`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base?action=deleted`;
    if (entryType === "sidebar_header") redirectPath = `/projects/${projectId}/sidebar-order?action=deleted`;
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/delete/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/delete/${entryId} ${userId}`);
    logger.error(`[PROJ][Entries] Failed to delete entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_DELETE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      title: entryTitle,
      type: entryType,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    let errorRedirectPath = `/projects/${projectId}/documentation?error=delete_failed`;
    if (entryType === "changelog") errorRedirectPath = `/projects/${projectId}/changelogs?error=delete_failed`;
    if (entryType === "roadmap") errorRedirectPath = `/projects/${projectId}/roadmaps?error=delete_failed`;
    if (entryType === "knowledge_base") errorRedirectPath = `/projects/${projectId}/knowledge_base?error=delete_failed`;
    if (entryType === "sidebar_header") errorRedirectPath = `/projects/${projectId}/sidebar-order?error=delete_failed`;
    res.redirect(errorRedirectPath);
  }
});

router.post("/:projectId/archive/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let originalRecord;
  let entryType = "documentation";
  logger.info(`[PROJ][Entries] POST /projects/${projectId}/archive/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ][Entries] POST /projects/${projectId}/archive/${entryId} ${userId}`);

  try {
    originalRecord = await getEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = originalRecord.type;

    if (entryType === "sidebar_header") {
      logger.warn(`[PROJ][Entries] Attempt to archive a sidebar header (${entryId}), which is not allowed. Deleting instead.`);
      await pbAdmin.collection("entries_main").delete(entryId);
      logAuditEvent(req, "ENTRY_DELETE", "entries_main", entryId, {
        projectId: projectId,
        title: originalRecord.title,
        type: entryType,
        reason: "Attempted archive on sidebar header",
      });
      logger.info(`[PROJ][Entries] Sidebar header ${entryId} (${originalRecord.title}) deleted successfully instead of archiving.`);
      logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/archive/${entryId} ${userId}`);
      return res.redirect(`/projects/${projectId}/sidebar-order?action=deleted`);
    }

    logger.debug(`[PROJ][Entries] Archiving entry ${entryId} (${originalRecord.title}) in project ${projectId}`);

    const archiveData = {
      ...originalRecord,
      original_id: originalRecord.id,
      custom_header: originalRecord.custom_header || null,
      custom_footer: originalRecord.custom_footer || null,
      roadmap_stage: originalRecord.roadmap_stage || null,
      content_updated_at: originalRecord.content_updated_at,
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
    archiveData.staged_header = null;
    archiveData.staged_footer = null;
    archiveData.staged_roadmap_stage = null;

    const archivedRecord = await pbAdmin.collection("entries_archived").create(archiveData);
    await pbAdmin.collection("entries_main").delete(entryId);
    logger.info(`[PROJ][Entries] Entry ${entryId} archived successfully as ${archivedRecord.id} in project ${projectId} by user ${userId}.`);

    logAuditEvent(req, "ENTRY_ARCHIVE", "entries_main", entryId, {
      projectId: projectId,
      title: originalRecord.title,
      type: entryType,
      archivedId: archivedRecord.id,
    });

    try {
      logger.debug(`[PROJ][Entries] Cleaning preview tokens for archived entry ${entryId}.`);
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({
        filter: `entry = '${entryId}'`,
        fields: "id",
      });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
      logger.trace(`[PROJ][Entries] Cleaned ${previewTokens.length} preview tokens.`);
    } catch (previewCleanError) {
      logger.error(`[PROJ][Entries] Error cleaning preview tokens for archived entry ${entryId}: ${previewCleanError.message}`);
    }
    let redirectPath = `/projects/${projectId}/documentation?action=archived`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/changelogs?action=archived`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/roadmaps?action=archived`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base?action=archived`;
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/archive/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ][Entries] POST /projects/${projectId}/archive/${entryId} ${userId}`);
    logger.error(`[PROJ][Entries] Failed to archive entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "ENTRY_ARCHIVE_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      title: originalRecord?.title,
      type: entryType,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    let errorRedirectPath = `/projects/${projectId}/documentation?error=archive_failed`;
    if (entryType === "changelog") errorRedirectPath = `/projects/${projectId}/changelogs?error=archive_failed`;
    if (entryType === "roadmap") errorRedirectPath = `/projects/${projectId}/roadmaps?error=archive_failed`;
    if (entryType === "knowledge_base") errorRedirectPath = `/projects/${projectId}/knowledge_base?error=archive_failed`;
    res.redirect(errorRedirectPath);
  }
});

export default router;
