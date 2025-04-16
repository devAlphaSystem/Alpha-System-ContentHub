import express from "express";
import { pb, pbAdmin, ITEMS_PER_PAGE } from "../config.js";
import { getUserTemplates, getProjectForOwner, getEntryForOwnerAndProject, getArchivedEntryForOwnerAndProject, getTemplateForEditAndProject, clearEntryViewLogs, logAuditEvent, getUserDocumentationHeaders, getUserDocumentationFooters, getUserChangelogHeaders, getUserChangelogFooters, getDocumentationHeaderForEditAndProject, getDocumentationFooterForEditAndProject, getChangelogHeaderForEditAndProject, getChangelogFooterForEditAndProject, hashPreviewPassword } from "../utils.js";

const router = express.Router();

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  if (!projectId) {
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    next();
  } catch (error) {
    next(error);
  }
}

router.get("/", async (req, res) => {
  const userId = req.session.user.id;
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "name";
    const filter = `owner = '${userId}'`;

    const resultList = await pb.collection("projects").getList(page, perPage, {
      filter: filter,
      sort: sort,
    });

    res.render("projects/index", {
      pageTitle: "Projects",
      projects: resultList.items,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      currentProjectId: null,
      error: req.query.error,
      message: req.query.message,
    });
  } catch (error) {
    console.error("Error fetching projects list:", error);
    logAuditEvent(req, "PROJECT_LIST_FAILURE", "projects", null, {
      error: error?.message,
    });
    res.render("projects/index", {
      pageTitle: "Projects",
      projects: [],
      pagination: null,
      currentProjectId: null,
      error: "Could not load projects.",
      message: null,
    });
  }
});

router.get("/new", (req, res) => {
  res.render("projects/new", {
    pageTitle: "Create New Project",
    currentProjectId: null,
    project: null,
    errors: null,
  });
});

router.post("/new", async (req, res) => {
  const { name, description } = req.body;
  const userId = req.session.user.id;

  if (!name || name.trim() === "") {
    return res.status(400).render("projects/new", {
      pageTitle: "Create New Project",
      currentProjectId: null,
      project: { name, description },
      errors: { name: { message: "Project name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      description: description || "",
      owner: userId,
    };
    const newProject = await pb.collection("projects").create(data);
    logAuditEvent(req, "PROJECT_CREATE", "projects", newProject.id, {
      name: newProject.name,
    });
    res.redirect(`/projects/${newProject.id}/documentation`);
  } catch (error) {
    console.error("Failed to create project:", error);
    logAuditEvent(req, "PROJECT_CREATE_FAILURE", "projects", null, {
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new", {
      pageTitle: "Create New Project",
      currentProjectId: null,
      project: { name, description },
      errors: { general: { message: "Failed to create project." } },
    });
  }
});

router.get("/:projectId", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let firstSidebarEntryId = null;
  let hasPublishedKbEntries = false;

  try {
    try {
      await pbAdmin.collection("entries_main").getFirstListItem(`project = '${projectId}' && type = 'knowledge_base' && status = 'published'`, { fields: "id", $autoCancel: false });
      hasPublishedKbEntries = true;
    } catch (kbError) {
      if (kbError.status !== 404) {
        console.warn(`Error checking for published KB entries for project ${projectId}:`, kbError.message);
      }
      hasPublishedKbEntries = false;
    }

    try {
      const firstEntryResult = await pbAdmin.collection("entries_main").getFirstListItem(`project = '${projectId}' && show_in_project_sidebar = true && status = 'published' && type != 'roadmap' && type != 'knowledge_base'`, {
        sort: "+sidebar_order,+title",
        fields: "id",
        $autoCancel: false,
      });
      firstSidebarEntryId = firstEntryResult?.id || null;
    } catch (firstEntryError) {
      if (firstEntryError.status !== 404) {
        console.warn(`Could not fetch first sidebar entry for project ${projectId}:`, firstEntryError.message);
      }
      firstSidebarEntryId = null;
    }

    let totalEntries = 0;
    let totalViews = 0;
    const entriesByType = { changelog: 0, documentation: 0, knowledge_base: 0 };
    let activityData = [];

    const projectEntries = await pbAdmin.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && type != 'roadmap'`,
      fields: "id, views, type, created",
      $autoCancel: false,
    });

    totalEntries = projectEntries.length;
    const activityMap = new Map();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const entry of projectEntries) {
      totalViews += entry.views || 0;
      if (entry.type === "changelog") {
        entriesByType.changelog++;
      } else if (entry.type === "documentation") {
        entriesByType.documentation++;
      } else if (entry.type === "knowledge_base") {
        entriesByType.knowledge_base++;
      }

      const createdDate = new Date(entry.created);
      if (createdDate >= thirtyDaysAgo) {
        const dateString = createdDate.toISOString().split("T")[0];
        activityMap.set(dateString, (activityMap.get(dateString) || 0) + 1);
      }
    }

    activityData = Array.from(activityMap.entries())
      .map(([date, count]) => ({ x: date, y: count }))
      .sort((a, b) => new Date(a.x) - new Date(b.x));

    const recentEntriesResult = await pbAdmin.collection("entries_main").getList(1, 5, {
      filter: `project = '${projectId}' && type != 'roadmap'`,
      sort: "-updated",
      fields: "id, title, updated, type",
      $autoCancel: false,
    });

    const metrics = {
      totalEntries: totalEntries,
      totalViews: totalViews,
      entriesByType: entriesByType,
      recentEntries: recentEntriesResult.items.map((e) => ({
        ...e,
        formattedUpdated: new Date(e.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      })),
      activityData: activityData,
    };

    res.render("projects/dashboard", {
      pageTitle: `Dashboard - ${req.project.name}`,
      project: req.project,
      metrics: metrics,
      firstSidebarEntryId: firstSidebarEntryId,
      hasPublishedKbEntries: hasPublishedKbEntries,
      error: null,
    });
  } catch (error) {
    console.error(`Error loading dashboard for project ${projectId}:`, error);
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

router.get("/:projectId/edit", checkProjectAccess, async (req, res, next) => {
  try {
    const projectData = await pb.collection("projects").getOne(req.project.id);
    res.render("projects/edit", {
      pageTitle: `Edit Project: ${projectData.name}`,
      project: projectData,
      errors: null,
      message: req.query.message,
    });
  } catch (error) {
    console.error(`Failed to fetch project ${req.project.id} for edit page:`, error);
    next(error);
  }
});

router.post("/:projectId/edit", checkProjectAccess, async (req, res) => {
  const { name, description, is_publicly_viewable, password_protected, access_password, roadmap_enabled } = req.body;
  const projectId = req.params.projectId;
  const errors = {};

  if (!name || name.trim() === "") {
    errors.name = { message: "Project name is required." };
  }

  const isPublic = is_publicly_viewable === "true";
  const requirePassword = password_protected === "true";
  const isRoadmapEnabled = roadmap_enabled === "true";

  if (requirePassword && !isPublic) {
    errors.password_protected = {
      message: "Cannot require password if Public View is disabled.",
    };
  }

  if (Object.keys(errors).length > 0) {
    const projectDataOnError = await pb.collection("projects").getOne(projectId);
    return res.status(400).render("projects/edit", {
      pageTitle: `Edit Project: ${projectDataOnError.name}`,
      project: {
        ...projectDataOnError,
        name,
        description,
        is_publicly_viewable: isPublic,
        password_protected: requirePassword,
        roadmap_enabled: isRoadmapEnabled,
      },
      errors: errors,
    });
  }

  try {
    const data = {
      name: name.trim(),
      description: description || "",
      is_publicly_viewable: isPublic,
      password_protected: requirePassword,
      roadmap_enabled: isRoadmapEnabled,
    };

    if (access_password && access_password.trim() !== "") {
      const newHash = hashPreviewPassword(access_password.trim());
      if (!newHash) {
        throw new Error("Failed to hash project password.");
      }
      data.access_password_hash = newHash;
      logAuditEvent(req, "PROJECT_PASSWORD_SET", "projects", projectId, {
        name: data.name,
      });
    } else if (!requirePassword && req.project.password_protected) {
      data.access_password_hash = "";
      logAuditEvent(req, "PROJECT_PASSWORD_DISABLED", "projects", projectId, {
        name: data.name,
      });
    }

    const updatedProject = await pb.collection("projects").update(projectId, data);
    logAuditEvent(req, "PROJECT_UPDATE", "projects", projectId, {
      name: updatedProject.name,
      is_public: updatedProject.is_publicly_viewable,
      pw_protected: updatedProject.password_protected,
      roadmap_enabled: updatedProject.roadmap_enabled,
    });
    res.redirect(`/projects/${projectId}/edit?message=updated`);
  } catch (error) {
    console.error(`Failed to update project ${projectId}:`, error);
    logAuditEvent(req, "PROJECT_UPDATE_FAILURE", "projects", projectId, {
      name: name,
      error: error?.message,
    });
    const projectDataOnError = await pb.collection("projects").getOne(projectId);
    res.status(500).render("projects/edit", {
      pageTitle: `Edit Project: ${projectDataOnError.name}`,
      project: {
        ...projectDataOnError,
        name,
        description,
        is_publicly_viewable: isPublic,
        password_protected: requirePassword,
        roadmap_enabled: isRoadmapEnabled,
      },
      errors: { general: { message: "Failed to update project." } },
    });
  }
});

router.post("/:projectId/delete", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const projectName = req.project.name;
  const BATCH_SIZE = 200;

  try {
    logAuditEvent(req, "PROJECT_DELETE_STARTED", "projects", projectId, {
      name: projectName,
    });

    const relatedCollections = ["entries_main", "entries_archived", "templates", "documentation_headers", "documentation_footers", "changelog_headers", "changelog_footers", "entries_previews"];

    for (const collectionName of relatedCollections) {
      const page = 1;
      let itemsToDelete;
      let deletedInCollection = 0;
      console.log(`[Delete Project ${projectId}] Starting deletion for collection: ${collectionName}`);
      do {
        try {
          itemsToDelete = { items: [], totalPages: 0 };

          if (collectionName === "entries_previews") {
            const projectEntryIds = await pbAdmin.collection("entries_main").getFullList({
              filter: `project = '${projectId}'`,
              fields: "id",
              $autoCancel: false,
            });
            const entryIdFilter = projectEntryIds.map((e) => `entry = '${e.id}'`).join(" || ");
            if (entryIdFilter) {
              itemsToDelete = await pbAdmin.collection(collectionName).getList(page, BATCH_SIZE, {
                filter: entryIdFilter,
                fields: "id",
                $autoCancel: false,
              });
            }
          } else {
            itemsToDelete = await pbAdmin.collection(collectionName).getList(page, BATCH_SIZE, {
              filter: `project = '${projectId}'`,
              fields: "id",
              $autoCancel: false,
            });
          }

          if (itemsToDelete.items.length > 0) {
            const deletePromises = [];
            for (const item of itemsToDelete.items) {
              if (collectionName === "entries_main") {
                clearEntryViewLogs(item.id);
              } else if (collectionName === "entries_archived") {
                try {
                  const archivedEntry = await pbAdmin.collection("entries_archived").getOne(item.id, { fields: "original_id" });
                  clearEntryViewLogs(archivedEntry.original_id || item.id);
                } catch (fetchErr) {
                  console.warn(`Could not fetch original_id for archived entry ${item.id} during project deletion`);
                }
              }
              deletePromises.push(pbAdmin.collection(collectionName).delete(item.id));
            }
            await Promise.all(deletePromises);
            deletedInCollection += itemsToDelete.items.length;
            console.log(`[Delete Project ${projectId}] Deleted batch of ${itemsToDelete.items.length} from ${collectionName}`);
          }
        } catch (batchError) {
          console.error(`[Delete Project ${projectId}] Error deleting batch from ${collectionName}:`, batchError);
          logAuditEvent(req, "PROJECT_DELETE_CASCADE_ERROR", collectionName, null, {
            projectId: projectId,
            error: batchError?.message,
          });
          break;
        }
      } while (itemsToDelete && itemsToDelete.items.length === BATCH_SIZE);
      console.log(`[Delete Project ${projectId}] Finished deletion for ${collectionName}. Total deleted: ${deletedInCollection}`);
    }

    await pbAdmin.collection("projects").delete(projectId);

    logAuditEvent(req, "PROJECT_DELETE_COMPLETE", "projects", projectId, {
      name: projectName,
    });
    res.redirect("/projects?message=Project and all associated data deleted successfully.");
  } catch (error) {
    console.error(`Failed to delete project ${projectId} or its related data:`, error);
    logAuditEvent(req, "PROJECT_DELETE_FAILURE", "projects", projectId, {
      name: projectName,
      error: error?.message,
    });
    res.redirect(`/projects?error=Failed to delete project. Check logs. Error: ${encodeURIComponent(error.message || "Unknown error")}`);
  }
});

async function renderEntriesList(req, res, entryType) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let pageTitle = "";
  let viewName = "";
  let listFields = "id,title,status,type,collection,views,updated,owner,has_staged_changes,tags";

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
      return res.status(400).send("Invalid entry type");
  }

  try {
    const filter = `owner = '${userId}' && project = '${projectId}' && type = '${entryType}'`;
    const initialPage = 1;
    const initialSort = entryType === "roadmap" ? "+roadmap_stage" : "+title";

    const resultList = await pb.collection("entries_main").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: listFields,
    });

    let collectionsList = [];
    if (entryType !== "roadmap" && entryType !== "knowledge_base") {
      try {
        const allCollectionsResult = await pbAdmin.collection("entries_main").getFullList({
          filter: `owner = '${userId}' && project = '${projectId}' && type = '${entryType}' && collection != '' && collection != null`,
          fields: "collection",
          $autoCancel: false,
        });
        collectionsList = [...new Set(allCollectionsResult.map((item) => item.collection).filter(Boolean))].sort();
      } catch (collectionError) {
        console.warn(`Could not fetch collections list for project ${projectId}, type ${entryType}:`, collectionError);
      }
    }

    const entriesWithViewUrl = [];
    for (const entry of resultList.items) {
      entriesWithViewUrl.push({
        ...entry,
        viewUrl: entryType !== "roadmap" && entryType !== "knowledge_base" ? `/view/${entry.id}` : null,
        formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

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
    console.error(`Error fetching ${entryType} entries for project ${projectId}:`, error);
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

router.get("/:projectId/documentation", checkProjectAccess, (req, res) => {
  renderEntriesList(req, res, "documentation");
});

router.get("/:projectId/changelogs", checkProjectAccess, (req, res) => {
  renderEntriesList(req, res, "changelog");
});

router.get("/:projectId/roadmaps", checkProjectAccess, (req, res) => {
  renderEntriesList(req, res, "roadmap");
});

router.get("/:projectId/knowledge_base", checkProjectAccess, (req, res) => {
  renderEntriesList(req, res, "knowledge_base");
});

router.get("/:projectId/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const validTypes = ["documentation", "changelog", "roadmap", "knowledge_base"];
  const preselectType = validTypes.includes(req.query.type) ? req.query.type : "documentation";

  try {
    const [templates, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserTemplates(userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);

    res.render("projects/new_entry", {
      pageTitle: `New Entry - ${req.project.name}`,
      project: req.project,
      entry: { type: preselectType },
      errors: null,
      templates: templates,
      documentationHeaders: documentationHeaders,
      documentationFooters: documentationFooters,
      changelogHeaders: changelogHeaders,
      changelogFooters: changelogFooters,
      entryType: preselectType,
      roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
    });
  } catch (error) {
    console.error(`Error loading new entry page for project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_NEW_LOAD_FAILURE", null, null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/new_entry", {
      pageTitle: `New Entry - ${req.project.name}`,
      project: req.project,
      entry: { type: preselectType },
      errors: {
        general: "Could not load page data (templates/headers/footers).",
      },
      templates: [],
      documentationHeaders: [],
      documentationFooters: [],
      changelogHeaders: [],
      changelogFooters: [],
      entryType: preselectType,
      roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
    });
  }
});

router.post("/:projectId/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { title, type, content, status, tags, collection, url, custom_documentation_header, custom_documentation_footer, custom_changelog_header, custom_changelog_footer, show_in_project_sidebar, roadmap_stage } = req.body;
  const pbErrors = {};

  const trimmedUrl = url ? url.trim() : "";

  if (trimmedUrl && trimmedUrl.length !== 15)
    pbErrors.url = {
      message: "URL (ID) must be exactly 15 characters long if provided.",
    };
  if (!title || title.trim() === "") pbErrors.title = { message: "Title is required." };
  if (!type) pbErrors.type = { message: "Type is required." };
  if (type !== "roadmap" && type !== "knowledge_base" && (!content || content.trim() === "")) pbErrors.content = { message: "Content is required." };
  if (type === "knowledge_base" && (!content || content.trim() === "")) pbErrors.content = { message: "Answer content is required." };
  if (type === "roadmap" && (!roadmap_stage || roadmap_stage.trim() === "")) {
    pbErrors.roadmap_stage = { message: "Roadmap Stage is required." };
  }

  if (Object.keys(pbErrors).length > 0) {
    try {
      const [templates, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserTemplates(userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_documentation_header: custom_documentation_header || "",
        custom_documentation_footer: custom_documentation_footer || "",
        custom_changelog_header: custom_changelog_header || "",
        custom_changelog_footer: custom_changelog_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
      };
      return res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: pbErrors,
        templates: templates,
        documentationHeaders: documentationHeaders,
        documentationFooters: documentationFooters,
        changelogHeaders: changelogHeaders,
        changelogFooters: changelogFooters,
        entryType: type,
        roadmapStages: ["Planned", "In Progress", "Done"],
      });
    } catch (fetchError) {
      console.error("Error fetching data after entry creation validation failure:", fetchError);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_documentation_header: custom_documentation_header || "",
        custom_documentation_footer: custom_documentation_footer || "",
        custom_changelog_header: custom_changelog_header || "",
        custom_changelog_footer: custom_changelog_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
      };
      return res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: { ...pbErrors, general: "Could not load page data." },
        templates: [],
        documentationHeaders: [],
        documentationFooters: [],
        changelogHeaders: [],
        changelogFooters: [],
        entryType: type,
        roadmapStages: ["Planned", "In Progress", "Done"],
      });
    }
  }

  const data = {
    title,
    type,
    content: type === "roadmap" ? "" : content,
    status: status || "draft",
    tags: tags || "",
    collection: collection || "",
    views: 0,
    owner: userId,
    project: projectId,
    custom_documentation_header: type === "documentation" ? custom_documentation_header || null : null,
    custom_documentation_footer: type === "documentation" ? custom_documentation_footer || null : null,
    custom_changelog_header: type === "changelog" ? custom_changelog_header || null : null,
    custom_changelog_footer: type === "changelog" ? custom_changelog_footer || null : null,
    show_in_project_sidebar: show_in_project_sidebar === "true",
    roadmap_stage: type === "roadmap" ? roadmap_stage || null : null,
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

  const recordIdToUse = trimmedUrl.length === 15 ? trimmedUrl : undefined;
  if (recordIdToUse) {
    data.id = recordIdToUse;
  }

  try {
    const newRecord = await pb.collection("entries_main").create(data);
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
    res.redirect(redirectPath);
  } catch (error) {
    console.error(`Failed to create entry in project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_CREATE_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
      data,
      providedId: url,
    });
    const creationErrors = error?.data?.data || error?.originalError?.data?.data || {};
    const errorResponseMessage = error?.data?.message || error?.originalError?.data?.message || "";
    if ((error.status === 400 || error.status === 409) && (errorResponseMessage.includes("already exists") || creationErrors.id?.message)) {
      creationErrors.url = {
        message: "This URL (ID) is already in use. Please choose another.",
      };
      if (creationErrors.id) creationErrors.id = undefined;
    } else if (!creationErrors.general && Object.keys(creationErrors).length === 0) {
      creationErrors.general = {
        message: errorResponseMessage || "Failed to create entry. Please check the form or try again.",
      };
    }

    const headerFooterFields = ["custom_documentation_header", "custom_documentation_footer", "custom_changelog_header", "custom_changelog_footer"];
    for (const field of headerFooterFields) {
      if (creationErrors[field]) {
        creationErrors[field] = {
          message: `Invalid ${field.replace("custom_", "").replace("_", " ")} selection.`,
        };
      }
    }

    try {
      const [templates, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserTemplates(userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_documentation_header: custom_documentation_header || "",
        custom_documentation_footer: custom_documentation_footer || "",
        custom_changelog_header: custom_changelog_header || "",
        custom_changelog_footer: custom_changelog_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
      };
      res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: creationErrors,
        templates: templates,
        documentationHeaders: documentationHeaders,
        documentationFooters: documentationFooters,
        changelogHeaders: changelogHeaders,
        changelogFooters: changelogFooters,
        entryType: type,
        roadmapStages: ["Planned", "In Progress", "Done"],
      });
    } catch (fetchError) {
      console.error("Error fetching data after entry creation failure:", fetchError);
      const submittedData = {
        title,
        type,
        content: content || "",
        status: status || "draft",
        tags: tags || "",
        collection: collection || "",
        url: url || "",
        custom_documentation_header: custom_documentation_header || "",
        custom_documentation_footer: custom_documentation_footer || "",
        custom_changelog_header: custom_changelog_header || "",
        custom_changelog_footer: custom_changelog_footer || "",
        show_in_project_sidebar: show_in_project_sidebar === "true",
        roadmap_stage: roadmap_stage || "",
      };
      res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: { ...creationErrors, general: "Could not load page data." },
        templates: [],
        documentationHeaders: [],
        documentationFooters: [],
        changelogHeaders: [],
        changelogFooters: [],
        entryType: type,
        roadmapStages: ["Planned", "In Progress", "Done"],
      });
    }
  }
});

router.get("/:projectId/edit/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const [record, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getEntryForOwnerAndProject(entryId, userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);

    const entryDataForForm = { ...record };
    let isEditingStaged = false;

    if (record.status === "published" && record.has_staged_changes) {
      isEditingStaged = true;
      const stagedType = record.staged_type ?? record.type;
      entryDataForForm.title = record.staged_title ?? record.title;
      entryDataForForm.type = stagedType;
      entryDataForForm.content = record.staged_content ?? record.content;
      entryDataForForm.tags = record.staged_tags ?? record.tags;
      entryDataForForm.collection = record.collection;
      entryDataForForm.show_in_project_sidebar = record.show_in_project_sidebar;

      if (stagedType === "documentation") {
        entryDataForForm.custom_documentation_header = record.staged_documentation_header ?? record.custom_documentation_header;
        entryDataForForm.custom_documentation_footer = record.staged_documentation_footer ?? record.custom_documentation_footer;
        entryDataForForm.custom_changelog_header = record.custom_changelog_header;
        entryDataForForm.custom_changelog_footer = record.custom_changelog_footer;
      } else if (stagedType === "changelog") {
        entryDataForForm.custom_changelog_header = record.staged_changelog_header ?? record.custom_changelog_header;
        entryDataForForm.custom_changelog_footer = record.staged_changelog_footer ?? record.custom_changelog_footer;
        entryDataForForm.custom_documentation_header = record.custom_documentation_header;
        entryDataForForm.custom_documentation_footer = record.custom_documentation_footer;
      }
      if (stagedType === "roadmap") {
        entryDataForForm.roadmap_stage = record.staged_roadmap_stage ?? record.roadmap_stage;
      } else {
        entryDataForForm.roadmap_stage = record.roadmap_stage;
      }
    }

    res.render("projects/edit_entry", {
      pageTitle: `Edit Entry - ${req.project.name}`,
      project: req.project,
      entry: entryDataForForm,
      originalStatus: record.status,
      hasStagedChanges: record.has_staged_changes,
      isEditingStaged: isEditingStaged,
      errors: null,
      documentationHeaders: documentationHeaders,
      documentationFooters: documentationFooters,
      changelogHeaders: changelogHeaders,
      changelogFooters: changelogFooters,
      entryType: entryDataForForm.type,
      roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch entry ${entryId} for edit in project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_EDIT_LOAD_FAILURE", "entries_main", entryId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/edit/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { title, type, content, status, tags, collection, custom_documentation_header, custom_documentation_footer, custom_changelog_header, custom_changelog_footer, show_in_project_sidebar, roadmap_stage } = req.body;
  const submittedStatus = status || "draft";
  const submittedType = type;
  const showInSidebarValue = show_in_project_sidebar === "true";

  let originalRecord;
  try {
    originalRecord = await pbAdmin.collection("entries_main").getOne(entryId);
    if (originalRecord.owner !== userId || originalRecord.project !== projectId) {
      const err = new Error("Forbidden");
      err.status = 403;
      logAuditEvent(req, "ENTRY_UPDATE_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Forbidden",
      });
      return next(err);
    }

    const pbErrors = {};
    if (submittedType === "roadmap" && (!roadmap_stage || roadmap_stage.trim() === "")) {
      pbErrors.roadmap_stage = { message: "Roadmap Stage is required." };
    }
    if (submittedType !== "roadmap" && submittedType !== "knowledge_base" && (!content || content.trim() === "")) {
      pbErrors.content = { message: "Content is required." };
    }
    if (submittedType === "knowledge_base" && (!content || content.trim() === "")) {
      pbErrors.content = { message: "Answer content is required." };
    }

    if (Object.keys(pbErrors).length > 0) {
      const [documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      const entryDataForForm = {
        ...originalRecord,
        title,
        type: submittedType,
        content: content || "",
        status: submittedStatus,
        tags,
        collection,
        custom_documentation_header,
        custom_documentation_footer,
        custom_changelog_header,
        custom_changelog_footer,
        show_in_project_sidebar: showInSidebarValue,
        roadmap_stage,
      };
      return res.status(400).render("projects/edit_entry", {
        pageTitle: `Edit Entry - ${req.project.name}`,
        project: req.project,
        entry: entryDataForForm,
        originalStatus: originalRecord.status,
        hasStagedChanges: originalRecord.has_staged_changes,
        isEditingStaged: originalRecord.status === "published" && originalRecord.has_staged_changes,
        errors: pbErrors,
        documentationHeaders,
        documentationFooters,
        changelogHeaders,
        changelogFooters,
        entryType: submittedType,
        roadmapStages: ["Planned", "In Progress", "Done"],
      });
    }

    let updateData = {};
    const wasPublished = originalRecord.status === "published";
    const isStayingPublished = submittedStatus === "published";
    let actionType = "ENTRY_UPDATE";

    if (wasPublished && isStayingPublished) {
      actionType = "ENTRY_STAGE_CHANGES";
      updateData = {
        staged_title: title,
        staged_type: submittedType,
        staged_content: submittedType === "roadmap" ? "" : content,
        staged_tags: tags || "",
        staged_documentation_header: submittedType === "documentation" ? custom_documentation_header || null : null,
        staged_documentation_footer: submittedType === "documentation" ? custom_documentation_footer || null : null,
        staged_changelog_header: submittedType === "changelog" ? custom_changelog_header || null : null,
        staged_changelog_footer: submittedType === "changelog" ? custom_changelog_footer || null : null,
        staged_roadmap_stage: submittedType === "roadmap" ? roadmap_stage || null : null,
        has_staged_changes: true,
        collection: collection || "",
        show_in_project_sidebar: showInSidebarValue,
      };
    } else {
      updateData = {
        title,
        type: submittedType,
        content: submittedType === "roadmap" ? "" : content,
        tags: tags || "",
        collection: collection || "",
        status: submittedStatus,
        custom_documentation_header: submittedType === "documentation" ? custom_documentation_header || null : null,
        custom_documentation_footer: submittedType === "documentation" ? custom_documentation_footer || null : null,
        custom_changelog_header: submittedType === "changelog" ? custom_changelog_header || null : null,
        custom_changelog_footer: submittedType === "changelog" ? custom_changelog_footer || null : null,
        roadmap_stage: submittedType === "roadmap" ? roadmap_stage || null : null,
        show_in_project_sidebar: showInSidebarValue,
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
      if (wasPublished && submittedStatus === "draft") {
        actionType = "ENTRY_UNPUBLISH";
      } else if (!wasPublished && submittedStatus === "published") {
        actionType = "ENTRY_PUBLISH";
      }
    }

    const updatedRecord = await pbAdmin.collection("entries_main").update(entryId, updateData);
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
    res.redirect(redirectPath);
  } catch (error) {
    console.error(`Failed to update/stage entry ${entryId} in project ${projectId}:`, error);
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

    const headerFooterFields = ["custom_documentation_header", "custom_documentation_footer", "custom_changelog_header", "custom_changelog_footer", "staged_documentation_header", "staged_documentation_footer", "staged_changelog_header", "staged_changelog_footer", "roadmap_stage", "staged_roadmap_stage"];
    for (const field of headerFooterFields) {
      if (pbErrors[field]) {
        pbErrors[field] = {
          message: `Invalid ${field.replace("custom_", "").replace("staged_", "").replace("_", " ")} selection.`,
        };
      }
    }

    try {
      const [recordForRender, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([originalRecord || pbAdmin.collection("entries_main").getOne(entryId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);

      if (recordForRender.owner !== userId || recordForRender.project !== projectId) return next(new Error("Forbidden"));

      const entryDataForForm = {
        ...recordForRender,
        title,
        type: submittedType,
        content: content || "",
        status: submittedStatus,
        tags,
        collection,
        custom_documentation_header: custom_documentation_header || "",
        custom_documentation_footer: custom_documentation_footer || "",
        custom_changelog_header: custom_changelog_header || "",
        custom_changelog_footer: custom_changelog_footer || "",
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
        entryDataForForm.custom_documentation_header = custom_documentation_header || "";
        entryDataForForm.custom_documentation_footer = custom_documentation_footer || "";
        entryDataForForm.custom_changelog_header = custom_changelog_header || "";
        entryDataForForm.custom_changelog_footer = custom_changelog_footer || "";
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
        documentationHeaders: documentationHeaders,
        documentationFooters: documentationFooters,
        changelogHeaders: changelogHeaders,
        changelogFooters: changelogFooters,
        entryType: entryDataForForm.type,
        roadmapStages: ["Planned", "In Progress", "Done"],
      });
    } catch (fetchError) {
      console.error(`Error fetching data for edit form after update failure on entry ${entryId}:`, fetchError);
      next(fetchError);
    }
  }
});

router.post("/:projectId/delete/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let entryTitle = entryId;
  let entryType = "documentation";

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);
    entryTitle = entry.title;
    entryType = entry.type;
    await pb.collection("entries_main").delete(entryId);
    clearEntryViewLogs(entryId);
    logAuditEvent(req, "ENTRY_DELETE", "entries_main", entryId, {
      projectId: projectId,
      title: entryTitle,
      type: entryType,
    });

    try {
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({ filter: `entry = '${entryId}'`, fields: "id" });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
    } catch (previewCleanError) {
      console.error(`Error cleaning preview tokens for deleted entry ${entryId}:`, previewCleanError);
    }
    let redirectPath = `/projects/${projectId}/documentation?action=deleted`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/changelogs?action=deleted`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/roadmaps?action=deleted`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base?action=deleted`;
    res.redirect(redirectPath);
  } catch (error) {
    console.error(`Failed to delete entry ${entryId} in project ${projectId}:`, error);
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
    res.redirect(errorRedirectPath);
  }
});

router.post("/:projectId/archive/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let originalRecord;
  let entryType = "documentation";

  try {
    originalRecord = await getEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = originalRecord.type;

    const archiveData = {
      ...originalRecord,
      original_id: originalRecord.id,
      custom_documentation_header: originalRecord.custom_documentation_header || null,
      custom_documentation_footer: originalRecord.custom_documentation_footer || null,
      custom_changelog_header: originalRecord.custom_changelog_header || null,
      custom_changelog_footer: originalRecord.custom_changelog_footer || null,
      roadmap_stage: originalRecord.roadmap_stage || null,
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

    const archivedRecord = await pbAdmin.collection("entries_archived").create(archiveData);
    await pbAdmin.collection("entries_main").delete(entryId);

    logAuditEvent(req, "ENTRY_ARCHIVE", "entries_main", entryId, {
      projectId: projectId,
      title: originalRecord.title,
      type: entryType,
      archivedId: archivedRecord.id,
    });

    try {
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({ filter: `entry = '${entryId}'`, fields: "id" });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
    } catch (previewCleanError) {
      console.error(`Error cleaning preview tokens for archived entry ${entryId}:`, previewCleanError);
    }
    let redirectPath = `/projects/${projectId}/documentation?action=archived`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/changelogs?action=archived`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/roadmaps?action=archived`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base?action=archived`;
    res.redirect(redirectPath);
  } catch (error) {
    console.error(`Failed to archive entry ${entryId} in project ${projectId}:`, error);
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

async function renderArchivedList(req, res, entryType) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let pageTitle = "";
  let viewName = "";
  let listFields = "id,title,status,type,updated,original_id";

  switch (entryType) {
    case "documentation":
      pageTitle = `Archived Documentation - ${req.project.name}`;
      viewName = "projects/archived_documentation";
      break;
    case "changelog":
      pageTitle = `Archived Changelogs - ${req.project.name}`;
      viewName = "projects/archived_changelogs";
      break;
    case "roadmap":
      pageTitle = `Archived Roadmap Items - ${req.project.name}`;
      viewName = "projects/archived_roadmaps";
      listFields += ",roadmap_stage";
      break;
    case "knowledge_base":
      pageTitle = `Archived Knowledge Base - ${req.project.name}`;
      viewName = "projects/archived_knowledge_base";
      break;
    default:
      return res.status(400).send("Invalid entry type");
  }

  try {
    const filter = `owner = '${userId}' && project = '${projectId}' && type = '${entryType}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pbAdmin.collection("entries_archived").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: listFields,
    });

    const entriesForView = [];
    for (const entry of resultList.items) {
      entriesForView.push({
        ...entry,
        formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    res.render(viewName, {
      pageTitle: pageTitle,
      project: req.project,
      entries: entriesForView,
      entryType: entryType,
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
    console.error(`Error fetching archived ${entryType} entries for project ${projectId}:`, error);
    logAuditEvent(req, `ARCHIVED_${entryType.toUpperCase()}_LIST_FAILURE`, "entries_archived", null, {
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
      initialSort: "-updated",
      error: `Could not load archived ${entryType} entries.`,
      action: null,
    });
  }
}

router.get("/:projectId/archived_documentation", checkProjectAccess, (req, res) => {
  renderArchivedList(req, res, "documentation");
});

router.get("/:projectId/archived_changelogs", checkProjectAccess, (req, res) => {
  renderArchivedList(req, res, "changelog");
});

router.get("/:projectId/archived_roadmaps", checkProjectAccess, (req, res) => {
  renderArchivedList(req, res, "roadmap");
});

router.get("/:projectId/archived_knowledge_base", checkProjectAccess, (req, res) => {
  renderArchivedList(req, res, "knowledge_base");
});

router.post("/:projectId/unarchive/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let originalRecord;
  let entryType = "documentation";

  try {
    originalRecord = await getArchivedEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = originalRecord.type;

    const mainData = {
      ...originalRecord,
      custom_documentation_header: originalRecord.custom_documentation_header || null,
      custom_documentation_footer: originalRecord.custom_documentation_footer || null,
      custom_changelog_header: originalRecord.custom_changelog_header || null,
      custom_changelog_footer: originalRecord.custom_changelog_footer || null,
      roadmap_stage: originalRecord.roadmap_stage || null,
    };

    mainData.id = originalRecord.original_id;
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

    const newMainRecord = await pbAdmin.collection("entries_main").create(mainData);
    await pbAdmin.collection("entries_archived").delete(entryId);
    logAuditEvent(req, "ENTRY_UNARCHIVE", "entries_archived", entryId, {
      projectId: projectId,
      title: originalRecord.title,
      type: entryType,
      newId: newMainRecord.id,
    });
    let redirectPath = `/projects/${projectId}/archived_documentation?action=unarchived`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/archived_changelogs?action=unarchived`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/archived_roadmaps?action=unarchived`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/archived_knowledge_base?action=unarchived`;
    res.redirect(redirectPath);
  } catch (error) {
    console.error(`Failed to unarchive entry ${entryId} in project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_UNARCHIVE_FAILURE", "entries_archived", entryId, {
      projectId: projectId,
      title: originalRecord?.title,
      type: entryType,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    let errorRedirectPath = `/projects/${projectId}/archived_documentation?error=unarchive_failed`;
    if (entryType === "changelog") errorRedirectPath = `/projects/${projectId}/archived_changelogs?error=unarchive_failed`;
    if (entryType === "roadmap") errorRedirectPath = `/projects/${projectId}/archived_roadmaps?error=unarchive_failed`;
    if (entryType === "knowledge_base") errorRedirectPath = `/projects/${projectId}/archived_knowledge_base?error=unarchive_failed`;

    if (error.status === 400 && error?.data?.data?.id) {
      console.error(`Potential ID conflict during unarchive for archived ID ${entryId}. Original ID ${originalRecord?.original_id} might exist in main table.`);
      errorRedirectPath = errorRedirectPath.replace("unarchive_failed", "unarchive_conflict");
    }
    res.redirect(errorRedirectPath);
  }
});

router.post("/:projectId/delete-archived/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let record;
  let entryType = "documentation";

  try {
    record = await getArchivedEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = record.type;
    await pbAdmin.collection("entries_archived").delete(entryId);
    const idToClean = record.original_id || entryId;
    clearEntryViewLogs(idToClean);
    logAuditEvent(req, "ENTRY_ARCHIVED_DELETE", "entries_archived", entryId, {
      projectId: projectId,
      title: record.title,
      type: entryType,
      originalId: record.original_id,
    });
    let redirectPath = `/projects/${projectId}/archived_documentation?action=deleted`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/archived_changelogs?action=deleted`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/archived_roadmaps?action=deleted`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/archived_knowledge_base?action=deleted`;
    res.redirect(redirectPath);
  } catch (error) {
    console.error(`Failed to delete archived entry ${entryId} in project ${projectId}:`, error);
    logAuditEvent(req, "ENTRY_ARCHIVED_DELETE_FAILURE", "entries_archived", entryId, {
      projectId: projectId,
      title: record?.title,
      type: entryType,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    let errorRedirectPath = `/projects/${projectId}/archived_documentation?error=delete_failed`;
    if (entryType === "changelog") errorRedirectPath = `/projects/${projectId}/archived_changelogs?error=delete_failed`;
    if (entryType === "roadmap") errorRedirectPath = `/projects/${projectId}/archived_roadmaps?error=delete_failed`;
    if (entryType === "knowledge_base") errorRedirectPath = `/projects/${projectId}/archived_knowledge_base?error=delete_failed`;
    res.redirect(errorRedirectPath);
  }
});

router.get("/:projectId/templates", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("templates").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });

    const templatesForView = [];
    for (const template of resultList.items) {
      templatesForView.push({
        ...template,
        formattedUpdated: new Date(template.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    res.render("projects/templates", {
      pageTitle: `Templates - ${req.project.name}`,
      project: req.project,
      templates: templatesForView,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      message: req.query.message,
    });
  } catch (error) {
    console.error(`Error fetching templates for project ${projectId}:`, error);
    logAuditEvent(req, "TEMPLATE_LIST_FAILURE", "templates", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/templates", {
      pageTitle: `Templates - ${req.project.name}`,
      project: req.project,
      templates: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load templates.",
      message: null,
    });
  }
});

router.get("/:projectId/templates/new", checkProjectAccess, (req, res) => {
  res.render("projects/new_template", {
    pageTitle: `New Template - ${req.project.name}`,
    project: req.project,
    template: null,
    errors: null,
  });
});

router.post("/:projectId/templates/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).render("projects/new_template", {
      pageTitle: `New Template - ${req.project.name}`,
      project: req.project,
      template: { name, content },
      errors: { name: { message: "Template name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    const newTemplate = await pb.collection("templates").create(data);
    logAuditEvent(req, "TEMPLATE_CREATE", "templates", newTemplate.id, {
      projectId: projectId,
      name: newTemplate.name,
    });
    res.redirect(`/projects/${projectId}/templates?message=Template created successfully.`);
  } catch (error) {
    console.error(`Failed to create template in project ${projectId}:`, error);
    logAuditEvent(req, "TEMPLATE_CREATE_FAILURE", "templates", null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new_template", {
      pageTitle: `New Template - ${req.project.name}`,
      project: req.project,
      template: { name, content },
      errors: { general: { message: "Failed to create template." } },
    });
  }
});

router.get("/:projectId/templates/edit/:templateId", checkProjectAccess, async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    res.render("projects/edit_template", {
      pageTitle: `Edit Template - ${req.project.name}`,
      project: req.project,
      template: template,
      errors: null,
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch template ${templateId} for edit in project ${projectId}:`, error);
    logAuditEvent(req, "TEMPLATE_EDIT_LOAD_FAILURE", "templates", templateId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/templates/edit/:templateId", checkProjectAccess, async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    return res.status(400).render("projects/edit_template", {
      pageTitle: `Edit Template - ${req.project.name}`,
      project: req.project,
      template: { ...template, name, content },
      errors: { name: { message: "Template name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    const updatedTemplate = await pb.collection("templates").update(templateId, data);
    logAuditEvent(req, "TEMPLATE_UPDATE", "templates", templateId, {
      projectId: projectId,
      name: updatedTemplate.name,
    });
    res.redirect(`/projects/${projectId}/templates?message=Template updated successfully.`);
  } catch (error) {
    console.error(`Failed to update template ${templateId} in project ${projectId}:`, error);
    logAuditEvent(req, "TEMPLATE_UPDATE_FAILURE", "templates", templateId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    res.status(500).render("projects/edit_template", {
      pageTitle: `Edit Template - ${req.project.name}`,
      project: req.project,
      template: { ...template, name, content },
      errors: { general: { message: "Failed to update template." } },
    });
  }
});

router.post("/:projectId/templates/delete/:templateId", checkProjectAccess, async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let templateName = templateId;

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    templateName = template.name;
    await pb.collection("templates").delete(templateId);
    logAuditEvent(req, "TEMPLATE_DELETE", "templates", templateId, {
      projectId: projectId,
      name: templateName,
    });
    res.redirect(`/projects/${projectId}/templates?message=Template deleted successfully.`);
  } catch (error) {
    console.error(`Failed to delete template ${templateId} in project ${projectId}:`, error);
    logAuditEvent(req, "TEMPLATE_DELETE_FAILURE", "templates", templateId, {
      projectId: projectId,
      name: templateName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`/projects/${projectId}/templates?error=Failed to delete template.`);
  }
});

router.get("/:projectId/sidebar-order", checkProjectAccess, async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const sidebarEntries = await pb.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && owner = '${userId}' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
      sort: "+sidebar_order,+title",
      fields: "id,title,sidebar_order,type",
    });

    res.render("projects/sidebar_order", {
      pageTitle: `Sidebar Order - ${req.project.name}`,
      project: req.project,
      entries: sidebarEntries,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (error) {
    console.error(`Error fetching entries for sidebar ordering for project ${projectId}:`, error);
    logAuditEvent(req, "SIDEBAR_ORDER_LOAD_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.redirect(`/projects/${projectId}?error=Could not load sidebar order page.`);
  }
});

router.post("/:projectId/sidebar-order", checkProjectAccess, async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { entryOrder } = req.body;

  if (!Array.isArray(entryOrder)) {
    return res.status(400).json({ error: "Invalid data format. Expected 'entryOrder' array." });
  }

  try {
    const updatePromises = entryOrder.map((entryId, index) => {
      return pb
        .collection("entries_main")
        .update(entryId, { sidebar_order: index }, { filter: `owner = '${userId}' && project = '${projectId}'` })
        .catch((err) => {
          console.error(`Failed to update sidebar order for entry ${entryId}:`, err);
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
      logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_PARTIAL", "entries_main", null, {
        projectId: projectId,
        errors: errors,
      });
      const statusCode = errors.some((e) => e.status === 403) ? 403 : errors.some((e) => e.status >= 500) ? 500 : 400;
      return res.status(statusCode).json({
        error: `Failed to update order for ${errors.length} out of ${entryOrder.length} entries.`,
        details: errors,
      });
    }

    logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_SUCCESS", "entries_main", null, {
      projectId: projectId,
      count: entryOrder.length,
    });
    res.status(200).json({ message: "Sidebar order updated successfully." });
  } catch (error) {
    console.error(`Error updating sidebar order for project ${projectId}:`, error);
    logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.status(500).json({ error: "An unexpected error occurred while updating sidebar order." });
  }
});

router.get("/:projectId/documentation_headers", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("documentation_headers").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });

    const headersForView = [];
    for (const header of resultList.items) {
      headersForView.push({
        ...header,
        formattedUpdated: new Date(header.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    res.render("projects/documentation_headers", {
      pageTitle: `Documentation Headers - ${req.project.name}`,
      project: req.project,
      headers: headersForView,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      message: req.query.message,
    });
  } catch (error) {
    console.error(`Error fetching documentation headers for project ${projectId}:`, error);
    logAuditEvent(req, "DOC_HEADER_LIST_FAILURE", "documentation_headers", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/documentation_headers", {
      pageTitle: `Documentation Headers - ${req.project.name}`,
      project: req.project,
      headers: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load documentation headers.",
      message: null,
    });
  }
});

router.get("/:projectId/documentation_headers/new", checkProjectAccess, (req, res) => {
  res.render("projects/new_documentation_header", {
    pageTitle: `New Documentation Header - ${req.project.name}`,
    project: req.project,
    header: null,
    errors: null,
  });
});

router.post("/:projectId/documentation_headers/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).render("projects/new_documentation_header", {
      pageTitle: `New Documentation Header - ${req.project.name}`,
      project: req.project,
      header: { name, content },
      errors: { name: { message: "Header name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    const newHeader = await pb.collection("documentation_headers").create(data);
    logAuditEvent(req, "DOC_HEADER_CREATE", "documentation_headers", newHeader.id, {
      projectId: projectId,
      name: newHeader.name,
    });
    res.redirect(`/projects/${projectId}/documentation_headers?message=Documentation Header created successfully.`);
  } catch (error) {
    console.error(`Failed to create documentation header in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_HEADER_CREATE_FAILURE", "documentation_headers", null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new_documentation_header", {
      pageTitle: `New Documentation Header - ${req.project.name}`,
      project: req.project,
      header: { name, content },
      errors: { general: { message: "Failed to create documentation header." } },
    });
  }
});

router.get("/:projectId/documentation_headers/edit/:headerId", checkProjectAccess, async (req, res, next) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const header = await getDocumentationHeaderForEditAndProject(headerId, userId, projectId);
    res.render("projects/edit_documentation_header", {
      pageTitle: `Edit Documentation Header - ${req.project.name}`,
      project: req.project,
      header: header,
      errors: null,
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch documentation header ${headerId} for edit in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_HEADER_EDIT_LOAD_FAILURE", "documentation_headers", headerId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/documentation_headers/edit/:headerId", checkProjectAccess, async (req, res, next) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    const header = await getDocumentationHeaderForEditAndProject(headerId, userId, projectId);
    return res.status(400).render("projects/edit_documentation_header", {
      pageTitle: `Edit Documentation Header - ${req.project.name}`,
      project: req.project,
      header: { ...header, name, content },
      errors: { name: { message: "Header name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    const updatedHeader = await pb.collection("documentation_headers").update(headerId, data);
    logAuditEvent(req, "DOC_HEADER_UPDATE", "documentation_headers", headerId, {
      projectId: projectId,
      name: updatedHeader.name,
    });
    res.redirect(`/projects/${projectId}/documentation_headers?message=Documentation Header updated successfully.`);
  } catch (error) {
    console.error(`Failed to update documentation header ${headerId} in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_HEADER_UPDATE_FAILURE", "documentation_headers", headerId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    const header = await getDocumentationHeaderForEditAndProject(headerId, userId, projectId);
    res.status(500).render("projects/edit_documentation_header", {
      pageTitle: `Edit Documentation Header - ${req.project.name}`,
      project: req.project,
      header: { ...header, name, content },
      errors: { general: { message: "Failed to update documentation header." } },
    });
  }
});

router.post("/:projectId/documentation_headers/delete/:headerId", checkProjectAccess, async (req, res, next) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let headerName = headerId;

  try {
    const header = await getDocumentationHeaderForEditAndProject(headerId, userId, projectId);
    headerName = header.name;
    await pb.collection("documentation_headers").delete(headerId);
    logAuditEvent(req, "DOC_HEADER_DELETE", "documentation_headers", headerId, {
      projectId: projectId,
      name: headerName,
    });
    res.redirect(`/projects/${projectId}/documentation_headers?message=Documentation Header deleted successfully.`);
  } catch (error) {
    console.error(`Failed to delete documentation header ${headerId} in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_HEADER_DELETE_FAILURE", "documentation_headers", headerId, {
      projectId: projectId,
      name: headerName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`/projects/${projectId}/documentation_headers?error=Failed to delete documentation header.`);
  }
});

router.get("/:projectId/documentation_footers", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("documentation_footers").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });

    const footersForView = [];
    for (const footer of resultList.items) {
      footersForView.push({
        ...footer,
        formattedUpdated: new Date(footer.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    res.render("projects/documentation_footers", {
      pageTitle: `Documentation Footers - ${req.project.name}`,
      project: req.project,
      footers: footersForView,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      message: req.query.message,
    });
  } catch (error) {
    console.error(`Error fetching documentation footers for project ${projectId}:`, error);
    logAuditEvent(req, "DOC_FOOTER_LIST_FAILURE", "documentation_footers", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/documentation_footers", {
      pageTitle: `Documentation Footers - ${req.project.name}`,
      project: req.project,
      footers: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load documentation footers.",
      message: null,
    });
  }
});

router.get("/:projectId/documentation_footers/new", checkProjectAccess, (req, res) => {
  res.render("projects/new_documentation_footer", {
    pageTitle: `New Documentation Footer - ${req.project.name}`,
    project: req.project,
    footer: null,
    errors: null,
  });
});

router.post("/:projectId/documentation_footers/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).render("projects/new_documentation_footer", {
      pageTitle: `New Documentation Footer - ${req.project.name}`,
      project: req.project,
      footer: { name, content },
      errors: { name: { message: "Footer name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    const newFooter = await pb.collection("documentation_footers").create(data);
    logAuditEvent(req, "DOC_FOOTER_CREATE", "documentation_footers", newFooter.id, {
      projectId: projectId,
      name: newFooter.name,
    });
    res.redirect(`/projects/${projectId}/documentation_footers?message=Documentation Footer created successfully.`);
  } catch (error) {
    console.error(`Failed to create documentation footer in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_FOOTER_CREATE_FAILURE", "documentation_footers", null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new_documentation_footer", {
      pageTitle: `New Documentation Footer - ${req.project.name}`,
      project: req.project,
      footer: { name, content },
      errors: { general: { message: "Failed to create documentation footer." } },
    });
  }
});

router.get("/:projectId/documentation_footers/edit/:footerId", checkProjectAccess, async (req, res, next) => {
  const footerId = req.params.footerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const footer = await getDocumentationFooterForEditAndProject(footerId, userId, projectId);
    res.render("projects/edit_documentation_footer", {
      pageTitle: `Edit Documentation Footer - ${req.project.name}`,
      project: req.project,
      footer: footer,
      errors: null,
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch documentation footer ${footerId} for edit in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_FOOTER_EDIT_LOAD_FAILURE", "documentation_footers", footerId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/documentation_footers/edit/:footerId", checkProjectAccess, async (req, res, next) => {
  const footerId = req.params.footerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    const footer = await getDocumentationFooterForEditAndProject(footerId, userId, projectId);
    return res.status(400).render("projects/edit_documentation_footer", {
      pageTitle: `Edit Documentation Footer - ${req.project.name}`,
      project: req.project,
      footer: { ...footer, name, content },
      errors: { name: { message: "Footer name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    const updatedFooter = await pb.collection("documentation_footers").update(footerId, data);
    logAuditEvent(req, "DOC_FOOTER_UPDATE", "documentation_footers", footerId, {
      projectId: projectId,
      name: updatedFooter.name,
    });
    res.redirect(`/projects/${projectId}/documentation_footers?message=Documentation Footer updated successfully.`);
  } catch (error) {
    console.error(`Failed to update documentation footer ${footerId} in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_FOOTER_UPDATE_FAILURE", "documentation_footers", footerId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    const footer = await getDocumentationFooterForEditAndProject(footerId, userId, projectId);
    res.status(500).render("projects/edit_documentation_footer", {
      pageTitle: `Edit Documentation Footer - ${req.project.name}`,
      project: req.project,
      footer: { ...footer, name, content },
      errors: { general: { message: "Failed to update documentation footer." } },
    });
  }
});

router.post("/:projectId/documentation_footers/delete/:footerId", checkProjectAccess, async (req, res, next) => {
  const footerId = req.params.footerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let footerName = footerId;

  try {
    const footer = await getDocumentationFooterForEditAndProject(footerId, userId, projectId);
    footerName = footer.name;
    await pb.collection("documentation_footers").delete(footerId);
    logAuditEvent(req, "DOC_FOOTER_DELETE", "documentation_footers", footerId, {
      projectId: projectId,
      name: footerName,
    });
    res.redirect(`/projects/${projectId}/documentation_footers?message=Documentation Footer deleted successfully.`);
  } catch (error) {
    console.error(`Failed to delete documentation footer ${footerId} in project ${projectId}:`, error);
    logAuditEvent(req, "DOC_FOOTER_DELETE_FAILURE", "documentation_footers", footerId, {
      projectId: projectId,
      name: footerName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`/projects/${projectId}/documentation_footers?error=Failed to delete documentation footer.`);
  }
});

router.get("/:projectId/changelog_headers", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("changelog_headers").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });

    const headersForView = [];
    for (const header of resultList.items) {
      headersForView.push({
        ...header,
        formattedUpdated: new Date(header.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    res.render("projects/changelog_headers", {
      pageTitle: `Changelog Headers - ${req.project.name}`,
      project: req.project,
      headers: headersForView,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      message: req.query.message,
    });
  } catch (error) {
    console.error(`Error fetching changelog headers for project ${projectId}:`, error);
    logAuditEvent(req, "CL_HEADER_LIST_FAILURE", "changelog_headers", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/changelog_headers", {
      pageTitle: `Changelog Headers - ${req.project.name}`,
      project: req.project,
      headers: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load changelog headers.",
      message: null,
    });
  }
});

router.get("/:projectId/changelog_headers/new", checkProjectAccess, (req, res) => {
  res.render("projects/new_changelog_header", {
    pageTitle: `New Changelog Header - ${req.project.name}`,
    project: req.project,
    header: null,
    errors: null,
  });
});

router.post("/:projectId/changelog_headers/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).render("projects/new_changelog_header", {
      pageTitle: `New Changelog Header - ${req.project.name}`,
      project: req.project,
      header: { name, content },
      errors: { name: { message: "Header name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    const newHeader = await pb.collection("changelog_headers").create(data);
    logAuditEvent(req, "CL_HEADER_CREATE", "changelog_headers", newHeader.id, {
      projectId: projectId,
      name: newHeader.name,
    });
    res.redirect(`/projects/${projectId}/changelog_headers?message=Changelog Header created successfully.`);
  } catch (error) {
    console.error(`Failed to create changelog header in project ${projectId}:`, error);
    logAuditEvent(req, "CL_HEADER_CREATE_FAILURE", "changelog_headers", null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new_changelog_header", {
      pageTitle: `New Changelog Header - ${req.project.name}`,
      project: req.project,
      header: { name, content },
      errors: { general: { message: "Failed to create changelog header." } },
    });
  }
});

router.get("/:projectId/changelog_headers/edit/:headerId", checkProjectAccess, async (req, res, next) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const header = await getChangelogHeaderForEditAndProject(headerId, userId, projectId);
    res.render("projects/edit_changelog_header", {
      pageTitle: `Edit Changelog Header - ${req.project.name}`,
      project: req.project,
      header: header,
      errors: null,
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch changelog header ${headerId} for edit in project ${projectId}:`, error);
    logAuditEvent(req, "CL_HEADER_EDIT_LOAD_FAILURE", "changelog_headers", headerId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/changelog_headers/edit/:headerId", checkProjectAccess, async (req, res, next) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    const header = await getChangelogHeaderForEditAndProject(headerId, userId, projectId);
    return res.status(400).render("projects/edit_changelog_header", {
      pageTitle: `Edit Changelog Header - ${req.project.name}`,
      project: req.project,
      header: { ...header, name, content },
      errors: { name: { message: "Header name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    const updatedHeader = await pb.collection("changelog_headers").update(headerId, data);
    logAuditEvent(req, "CL_HEADER_UPDATE", "changelog_headers", headerId, {
      projectId: projectId,
      name: updatedHeader.name,
    });
    res.redirect(`/projects/${projectId}/changelog_headers?message=Changelog Header updated successfully.`);
  } catch (error) {
    console.error(`Failed to update changelog header ${headerId} in project ${projectId}:`, error);
    logAuditEvent(req, "CL_HEADER_UPDATE_FAILURE", "changelog_headers", headerId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    const header = await getChangelogHeaderForEditAndProject(headerId, userId, projectId);
    res.status(500).render("projects/edit_changelog_header", {
      pageTitle: `Edit Changelog Header - ${req.project.name}`,
      project: req.project,
      header: { ...header, name, content },
      errors: { general: { message: "Failed to update changelog header." } },
    });
  }
});

router.post("/:projectId/changelog_headers/delete/:headerId", checkProjectAccess, async (req, res, next) => {
  const headerId = req.params.headerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let headerName = headerId;

  try {
    const header = await getChangelogHeaderForEditAndProject(headerId, userId, projectId);
    headerName = header.name;
    await pb.collection("changelog_headers").delete(headerId);
    logAuditEvent(req, "CL_HEADER_DELETE", "changelog_headers", headerId, {
      projectId: projectId,
      name: headerName,
    });
    res.redirect(`/projects/${projectId}/changelog_headers?message=Changelog Header deleted successfully.`);
  } catch (error) {
    console.error(`Failed to delete changelog header ${headerId} in project ${projectId}:`, error);
    logAuditEvent(req, "CL_HEADER_DELETE_FAILURE", "changelog_headers", headerId, {
      projectId: projectId,
      name: headerName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`/projects/${projectId}/changelog_headers?error=Failed to delete changelog header.`);
  }
});

router.get("/:projectId/changelog_footers", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";

    const resultList = await pb.collection("changelog_footers").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });

    const footersForView = [];
    for (const footer of resultList.items) {
      footersForView.push({
        ...footer,
        formattedUpdated: new Date(footer.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    res.render("projects/changelog_footers", {
      pageTitle: `Changelog Footers - ${req.project.name}`,
      project: req.project,
      footers: footersForView,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      message: req.query.message,
    });
  } catch (error) {
    console.error(`Error fetching changelog footers for project ${projectId}:`, error);
    logAuditEvent(req, "CL_FOOTER_LIST_FAILURE", "changelog_footers", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/changelog_footers", {
      pageTitle: `Changelog Footers - ${req.project.name}`,
      project: req.project,
      footers: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load changelog footers.",
      message: null,
    });
  }
});

router.get("/:projectId/changelog_footers/new", checkProjectAccess, (req, res) => {
  res.render("projects/new_changelog_footer", {
    pageTitle: `New Changelog Footer - ${req.project.name}`,
    project: req.project,
    footer: null,
    errors: null,
  });
});

router.post("/:projectId/changelog_footers/new", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).render("projects/new_changelog_footer", {
      pageTitle: `New Changelog Footer - ${req.project.name}`,
      project: req.project,
      footer: { name, content },
      errors: { name: { message: "Footer name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    const newFooter = await pb.collection("changelog_footers").create(data);
    logAuditEvent(req, "CL_FOOTER_CREATE", "changelog_footers", newFooter.id, {
      projectId: projectId,
      name: newFooter.name,
    });
    res.redirect(`/projects/${projectId}/changelog_footers?message=Changelog Footer created successfully.`);
  } catch (error) {
    console.error(`Failed to create changelog footer in project ${projectId}:`, error);
    logAuditEvent(req, "CL_FOOTER_CREATE_FAILURE", "changelog_footers", null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new_changelog_footer", {
      pageTitle: `New Changelog Footer - ${req.project.name}`,
      project: req.project,
      footer: { name, content },
      errors: { general: { message: "Failed to create changelog footer." } },
    });
  }
});

router.get("/:projectId/changelog_footers/edit/:footerId", checkProjectAccess, async (req, res, next) => {
  const footerId = req.params.footerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;

  try {
    const footer = await getChangelogFooterForEditAndProject(footerId, userId, projectId);
    res.render("projects/edit_changelog_footer", {
      pageTitle: `Edit Changelog Footer - ${req.project.name}`,
      project: req.project,
      footer: footer,
      errors: null,
    });
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    console.error(`Failed to fetch changelog footer ${footerId} for edit in project ${projectId}:`, error);
    logAuditEvent(req, "CL_FOOTER_EDIT_LOAD_FAILURE", "changelog_footers", footerId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/changelog_footers/edit/:footerId", checkProjectAccess, async (req, res, next) => {
  const footerId = req.params.footerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;

  if (!name || name.trim() === "") {
    const footer = await getChangelogFooterForEditAndProject(footerId, userId, projectId);
    return res.status(400).render("projects/edit_changelog_footer", {
      pageTitle: `Edit Changelog Footer - ${req.project.name}`,
      project: req.project,
      footer: { ...footer, name, content },
      errors: { name: { message: "Footer name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    const updatedFooter = await pb.collection("changelog_footers").update(footerId, data);
    logAuditEvent(req, "CL_FOOTER_UPDATE", "changelog_footers", footerId, {
      projectId: projectId,
      name: updatedFooter.name,
    });
    res.redirect(`/projects/${projectId}/changelog_footers?message=Changelog Footer updated successfully.`);
  } catch (error) {
    console.error(`Failed to update changelog footer ${footerId} in project ${projectId}:`, error);
    logAuditEvent(req, "CL_FOOTER_UPDATE_FAILURE", "changelog_footers", footerId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    const footer = await getChangelogFooterForEditAndProject(footerId, userId, projectId);
    res.status(500).render("projects/edit_changelog_footer", {
      pageTitle: `Edit Changelog Footer - ${req.project.name}`,
      project: req.project,
      footer: { ...footer, name, content },
      errors: { general: { message: "Failed to update changelog footer." } },
    });
  }
});

router.post("/:projectId/changelog_footers/delete/:footerId", checkProjectAccess, async (req, res, next) => {
  const footerId = req.params.footerId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let footerName = footerId;

  try {
    const footer = await getChangelogFooterForEditAndProject(footerId, userId, projectId);
    footerName = footer.name;
    await pb.collection("changelog_footers").delete(footerId);
    logAuditEvent(req, "CL_FOOTER_DELETE", "changelog_footers", footerId, {
      projectId: projectId,
      name: footerName,
    });
    res.redirect(`/projects/${projectId}/changelog_footers?message=Changelog Footer deleted successfully.`);
  } catch (error) {
    console.error(`Failed to delete changelog footer ${footerId} in project ${projectId}:`, error);
    logAuditEvent(req, "CL_FOOTER_DELETE_FAILURE", "changelog_footers", footerId, {
      projectId: projectId,
      name: footerName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`/projects/${projectId}/changelog_footers?error=Failed to delete changelog footer.`);
  }
});

router.get("/:projectId/audit-log", checkProjectAccess, async (req, res, next) => {
  const projectId = req.params.projectId;
  try {
    const initialPage = 1;
    const initialSort = "-created";

    const resultList = await pbAdmin.collection("audit_logs").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      expand: "user",
    });

    const formattedLogs = [];
    for (const log of resultList.items) {
      formattedLogs.push({ ...log });
    }

    res.render("projects/audit-log", {
      pageTitle: `Audit Log - ${req.project.name}`,
      project: req.project,
      logs: formattedLogs,
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
    console.error(`Error fetching audit logs for project ${projectId}:`, error);
    logAuditEvent(req, "AUDIT_LOG_LIST_FAILURE", "audit_logs", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render("projects/audit-log", {
      pageTitle: `Audit Log - ${req.project.name}`,
      project: req.project,
      logs: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-created",
      error: "Could not load audit logs.",
    });
  }
});

export default router;
