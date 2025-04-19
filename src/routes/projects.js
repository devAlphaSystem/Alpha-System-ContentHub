import express from "express";
import { pb, pbAdmin, ITEMS_PER_PAGE } from "../config.js";
import { getUserTemplates, getProjectForOwner, getEntryForOwnerAndProject, getArchivedEntryForOwnerAndProject, getTemplateForEditAndProject, clearEntryViewLogs, logAuditEvent, getUserDocumentationHeaders, getUserDocumentationFooters, getUserChangelogHeaders, getUserChangelogFooters, getDocumentationHeaderForEditAndProject, getDocumentationFooterForEditAndProject, getChangelogHeaderForEditAndProject, getChangelogFooterForEditAndProject, hashPreviewPassword } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();

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

router.get("/", async (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects ${userId}`);
  try {
    const page = Number.parseInt(req.query.page) || 1;
    const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
    const sort = req.query.sort || "name";
    const filter = `owner = '${userId}'`;
    logger.trace(`[PROJ] Projects list filter: ${filter}`);

    const resultList = await pb.collection("projects").getList(page, perPage, {
      filter: filter,
      sort: sort,
    });
    logger.debug(`[PROJ] Fetched ${resultList.items.length} projects (page ${page}/${resultList.totalPages}) for user ${userId}`);

    logger.timeEnd(`[PROJ] GET /projects ${userId}`);
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
    logger.timeEnd(`[PROJ] GET /projects ${userId}`);
    logger.error(`[PROJ] Error fetching projects list for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/new requested by user ${userId}`);
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
  logger.info(`[PROJ] POST /projects/new attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ] POST /projects/new ${userId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ] Project creation failed for user ${userId}: Name required.`);
    logger.timeEnd(`[PROJ] POST /projects/new ${userId}`);
    return res.status(400).render("projects/new", {
      pageTitle: "Create New Project",
      currentProjectId: null,
      project: {
        name,
        description,
      },
      errors: {
        name: {
          message: "Project name is required.",
        },
      },
    });
  }

  try {
    const data = {
      name: name.trim(),
      description: description || "",
      owner: userId,
    };
    logger.debug("[PROJ] Creating project with data:", data);
    const newProject = await pb.collection("projects").create(data);
    logger.info(`[PROJ] Project created successfully: ${newProject.id} (${newProject.name}) by user ${userId}`);
    logAuditEvent(req, "PROJECT_CREATE", "projects", newProject.id, {
      name: newProject.name,
    });
    logger.timeEnd(`[PROJ] POST /projects/new ${userId}`);
    res.redirect(`/projects/${newProject.id}/documentation`);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/new ${userId}`);
    logger.error(`[PROJ] Failed to create project '${name}' for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_CREATE_FAILURE", "projects", null, {
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new", {
      pageTitle: "Create New Project",
      currentProjectId: null,
      project: {
        name,
        description,
      },
      errors: {
        general: {
          message: "Failed to create project.",
        },
      },
    });
  }
});

router.get("/:projectId", checkProjectAccess, async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId} (dashboard) requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId} ${userId}`);
  let firstSidebarEntryId = null;
  let hasPublishedKbEntries = false;

  try {
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

    try {
      logger.trace(`[PROJ] Fetching first sidebar entry for project ${projectId}`);
      const firstEntryResult = await pbAdmin.collection("entries_main").getFirstListItem(`project = '${projectId}' && show_in_project_sidebar = true && status = 'published' && type != 'roadmap' && type != 'knowledge_base'`, {
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

    const projectEntries = await pbAdmin.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && type != 'roadmap'`,
      fields: "id, views, type, created",
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
      filter: `project = '${projectId}' && type != 'roadmap'`,
      sort: "-updated",
      fields: "id, title, updated, type",
      $autoCancel: false,
    });
    logger.timeEnd(`[PROJ] FetchRecentEntries ${projectId}`);
    logger.trace(`[PROJ] Fetched ${recentEntriesResult.items.length} recent entries.`);

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

router.get("/:projectId/edit", checkProjectAccess, async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId}/edit requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId}/edit ${userId}`);
  try {
    const projectData = await pb.collection("projects").getOne(req.project.id);
    logger.debug(`[PROJ] Fetched project data for edit page: ${projectId}`);
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/edit ${userId}`);
    res.render("projects/edit", {
      pageTitle: `Edit Project: ${projectData.name}`,
      project: projectData,
      errors: null,
      message: req.query.message,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/edit ${userId}`);
    logger.error(`[PROJ] Failed to fetch project ${projectId} for edit page: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
});

router.post("/:projectId/edit", checkProjectAccess, async (req, res) => {
  const { name, description, is_publicly_viewable, password_protected, access_password, roadmap_enabled } = req.body;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.info(`[PROJ] POST /projects/${projectId}/edit attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ] POST /projects/${projectId}/edit ${userId}`);
  const errors = {};

  if (!name || name.trim() === "") {
    errors.name = {
      message: "Project name is required.",
    };
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
    logger.warn(`[PROJ] Project edit validation failed for ${projectId}:`, errors);
    try {
      const projectDataOnError = await pb.collection("projects").getOne(projectId);
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit ${userId}`);
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
    } catch (fetchError) {
      logger.error(`[PROJ] Failed to fetch project ${projectId} after edit validation error: ${fetchError.message}`);
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit ${userId}`);
      return res.status(500).render("projects/edit", {
        pageTitle: `Edit Project: ${name || "Error"}`,
        project: {
          id: projectId,
          name,
          description,
          is_publicly_viewable: isPublic,
          password_protected: requirePassword,
          roadmap_enabled: isRoadmapEnabled,
        },
        errors: {
          ...errors,
          general: {
            message: "Failed to load project data after error.",
          },
        },
      });
    }
  }

  try {
    const data = {
      name: name.trim(),
      description: description || "",
      is_publicly_viewable: isPublic,
      password_protected: requirePassword,
      roadmap_enabled: isRoadmapEnabled,
    };
    logger.debug(`[PROJ] Updating project ${projectId} with data:`, data);

    if (access_password && access_password.trim() !== "") {
      logger.info(`[PROJ] Setting/updating password for project ${projectId}.`);
      const newHash = hashPreviewPassword(access_password.trim());
      if (!newHash) {
        logger.error(`[PROJ] Failed to hash project password for ${projectId}.`);
        throw new Error("Failed to hash project password.");
      }
      data.access_password_hash = newHash;
      logAuditEvent(req, "PROJECT_PASSWORD_SET", "projects", projectId, {
        name: data.name,
      });
    } else if (!requirePassword && req.project.password_protected) {
      logger.info(`[PROJ] Disabling password for project ${projectId}.`);
      data.access_password_hash = "";
      logAuditEvent(req, "PROJECT_PASSWORD_DISABLED", "projects", projectId, {
        name: data.name,
      });
    }

    const updatedProject = await pb.collection("projects").update(projectId, data);
    logger.info(`[PROJ] Project ${projectId} updated successfully by user ${userId}.`);
    logAuditEvent(req, "PROJECT_UPDATE", "projects", projectId, {
      name: updatedProject.name,
      is_public: updatedProject.is_publicly_viewable,
      pw_protected: updatedProject.password_protected,
      roadmap_enabled: updatedProject.roadmap_enabled,
    });
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit ${userId}`);
    res.redirect(`/projects/${projectId}/edit?message=updated`);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit ${userId}`);
    logger.error(`[PROJ] Failed to update project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_UPDATE_FAILURE", "projects", projectId, {
      name: name,
      error: error?.message,
    });
    try {
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
        errors: {
          general: {
            message: "Failed to update project.",
          },
        },
      });
    } catch (fetchError) {
      logger.error(`[PROJ] Failed to fetch project ${projectId} after update error: ${fetchError.message}`);
      res.status(500).render("projects/edit", {
        pageTitle: `Edit Project: ${name || "Error"}`,
        project: {
          id: projectId,
          name,
          description,
          is_publicly_viewable: isPublic,
          password_protected: requirePassword,
          roadmap_enabled: isRoadmapEnabled,
        },
        errors: {
          general: {
            message: "Failed to update project and reload data.",
          },
        },
      });
    }
  }
});

router.post("/:projectId/delete", checkProjectAccess, async (req, res) => {
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

    const relatedCollections = ["entries_main", "entries_archived", "templates", "documentation_headers", "documentation_footers", "changelog_headers", "changelog_footers", "entries_previews"];

    for (const collectionName of relatedCollections) {
      let page = 1;
      let itemsToDelete;
      let deletedInCollection = 0;
      logger.info(`[PROJ][Delete ${projectId}] Starting deletion for collection: ${collectionName}`);
      logger.time(`[PROJ][Delete ${projectId}] Collection ${collectionName}`);
      do {
        try {
          itemsToDelete = {
            items: [],
            totalPages: 0,
          };
          logger.trace(`[PROJ][Delete ${projectId}] Fetching batch ${page} from ${collectionName}`);

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
            } else {
              logger.trace(`[PROJ][Delete ${projectId}] No related entries found for preview token cleanup.`);
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
          throw batchError;
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

async function renderEntriesList(req, res, entryType) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] Rendering entries list for type ${entryType}, project ${projectId}, user ${userId}`);
  logger.time(`[PROJ] renderEntriesList ${entryType} ${projectId}`);
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
      logger.error(`[PROJ] Invalid entry type requested: ${entryType}`);
      logger.timeEnd(`[PROJ] renderEntriesList ${entryType} ${projectId}`);
      return res.status(400).send("Invalid entry type");
  }

  try {
    const filter = `owner = '${userId}' && project = '${projectId}' && type = '${entryType}'`;
    const initialPage = 1;
    const initialSort = entryType === "roadmap" ? "+roadmap_stage" : "+title";
    logger.trace(`[PROJ] Entries list filter: ${filter}, Sort: ${initialSort}`);

    const resultList = await pb.collection("entries_main").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: listFields,
    });
    logger.debug(`[PROJ] Fetched ${resultList.items.length} ${entryType} entries (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

    let collectionsList = [];
    if (entryType !== "roadmap" && entryType !== "knowledge_base") {
      try {
        logger.trace(`[PROJ] Fetching collections list for ${entryType}, project ${projectId}`);
        const allCollectionsResult = await pbAdmin.collection("entries_main").getFullList({
          filter: `owner = '${userId}' && project = '${projectId}' && type = '${entryType}' && collection != '' && collection != null`,
          fields: "collection",
          $autoCancel: false,
        });
        collectionsList = [...new Set(allCollectionsResult.map((item) => item.collection).filter(Boolean))].sort();
        logger.trace(`[PROJ] Found ${collectionsList.length} unique collections for ${entryType}, project ${projectId}`);
      } catch (collectionError) {
        logger.warn(`[PROJ] Could not fetch collections list for project ${projectId}, type ${entryType}: Status ${collectionError?.status || "N/A"}`, collectionError.message);
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

    logger.debug(`[PROJ] Rendering view ${viewName} for project ${projectId}`);
    logger.timeEnd(`[PROJ] renderEntriesList ${entryType} ${projectId}`);
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
    logger.timeEnd(`[PROJ] renderEntriesList ${entryType} ${projectId}`);
    logger.error(`[PROJ] Error fetching ${entryType} entries for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.debug(`[PROJ] GET /projects/${projectId}/new requested by user ${userId}, type: ${preselectType}`);
  logger.time(`[PROJ] GET /projects/${projectId}/new ${userId}`);

  try {
    logger.time(`[PROJ] FetchNewEntryAssets ${projectId}`);
    const [templates, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserTemplates(userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
    logger.timeEnd(`[PROJ] FetchNewEntryAssets ${projectId}`);
    logger.trace(`[PROJ] Fetched assets for new entry page: ${templates.length} templates, ${documentationHeaders.length} doc headers, etc.`);

    logger.timeEnd(`[PROJ] GET /projects/${projectId}/new ${userId}`);
    res.render("projects/new_entry", {
      pageTitle: `New Entry - ${req.project.name}`,
      project: req.project,
      entry: {
        type: preselectType,
      },
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
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/new ${userId}`);
    logger.error(`[PROJ] Error loading new entry page for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.info(`[PROJ] POST /projects/${projectId}/new attempt by user ${userId}. Type: ${type}, Title: ${title}`);
  logger.time(`[PROJ] POST /projects/${projectId}/new ${userId}`);
  const pbErrors = {};

  const trimmedUrl = url ? url.trim() : "";

  if (trimmedUrl && trimmedUrl.length !== 15)
    pbErrors.url = {
      message: "URL (ID) must be exactly 15 characters long if provided.",
    };
  if (!title || title.trim() === "")
    pbErrors.title = {
      message: "Title is required.",
    };
  if (!type)
    pbErrors.type = {
      message: "Type is required.",
    };
  if (type !== "roadmap" && type !== "knowledge_base" && (!content || content.trim() === ""))
    pbErrors.content = {
      message: "Content is required.",
    };
  if (type === "knowledge_base" && (!content || content.trim() === ""))
    pbErrors.content = {
      message: "Answer content is required.",
    };
  if (type === "roadmap" && (!roadmap_stage || roadmap_stage.trim() === "")) {
    pbErrors.roadmap_stage = {
      message: "Roadmap Stage is required.",
    };
  }

  if (Object.keys(pbErrors).length > 0) {
    logger.warn(`[PROJ] New entry validation failed for project ${projectId}:`, pbErrors);
    try {
      logger.time(`[PROJ] FetchNewEntryAssetsOnError ${projectId}`);
      const [templates, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserTemplates(userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      logger.timeEnd(`[PROJ] FetchNewEntryAssetsOnError ${projectId}`);
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
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/new ${userId}`);
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
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    } catch (fetchError) {
      logger.timeEnd(`[PROJ] FetchNewEntryAssetsOnError ${projectId}`);
      logger.error(`[PROJ] Error fetching assets after entry creation validation failure for project ${projectId}: ${fetchError.message}`);
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
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/new ${userId}`);
      return res.status(400).render("projects/new_entry", {
        pageTitle: `New Entry - ${req.project.name}`,
        project: req.project,
        entry: submittedData,
        errors: {
          ...pbErrors,
          general: "Could not load page data.",
        },
        templates: [],
        documentationHeaders: [],
        documentationFooters: [],
        changelogHeaders: [],
        changelogFooters: [],
        entryType: type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
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
    logger.debug(`[PROJ] Attempting to create entry with provided ID: ${recordIdToUse}`);
  }

  try {
    logger.debug(`[PROJ] Creating entry in project ${projectId} with data:`, {
      title: data.title,
      type: data.type,
      status: data.status,
      id: data.id,
    });
    const newRecord = await pb.collection("entries_main").create(data);
    logger.info(`[PROJ] Entry created successfully: ${newRecord.id} (${newRecord.title}) in project ${projectId} by user ${userId}`);
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
    logger.debug(`[PROJ] Redirecting to ${redirectPath} after entry creation.`);
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/new ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/new ${userId}`);
    logger.error(`[PROJ] Failed to create entry in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      logger.warn(`[PROJ] Entry creation failed: ID ${recordIdToUse} already exists.`);
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
      logger.time(`[PROJ] FetchNewEntryAssetsOnError ${projectId}`);
      const [templates, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserTemplates(userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      logger.timeEnd(`[PROJ] FetchNewEntryAssetsOnError ${projectId}`);
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
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    } catch (fetchError) {
      logger.timeEnd(`[PROJ] FetchNewEntryAssetsOnError ${projectId}`);
      logger.error(`[PROJ] Error fetching assets after entry creation failure: ${fetchError.message}`);
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
        errors: {
          ...creationErrors,
          general: "Could not load page data.",
        },
        templates: [],
        documentationHeaders: [],
        documentationFooters: [],
        changelogHeaders: [],
        changelogFooters: [],
        entryType: type,
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    }
  }
});

router.get("/:projectId/edit/:entryId", checkProjectAccess, async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId}/edit/${entryId} requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId}/edit/${entryId} ${userId}`);

  try {
    logger.time(`[PROJ] FetchEditEntryAssets ${entryId}`);
    const [record, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getEntryForOwnerAndProject(entryId, userId, projectId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
    logger.timeEnd(`[PROJ] FetchEditEntryAssets ${entryId}`);
    logger.trace(`[PROJ] Fetched entry ${entryId} and assets for edit page.`);

    const entryDataForForm = {
      ...record,
    };
    let isEditingStaged = false;

    if (record.status === "published" && record.has_staged_changes) {
      isEditingStaged = true;
      logger.trace(`[PROJ] Editing staged changes for entry ${entryId}.`);
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
    } else {
      logger.trace(`[PROJ] Editing published/draft entry ${entryId}.`);
    }

    logger.timeEnd(`[PROJ] GET /projects/${projectId}/edit/${entryId} ${userId}`);
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
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/edit/${entryId} ${userId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ] Access denied or not found for edit entry ${entryId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ] Failed to fetch entry ${entryId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.info(`[PROJ] POST /projects/${projectId}/edit/${entryId} attempt by user ${userId}. Type: ${submittedType}, Status: ${submittedStatus}`);
  logger.time(`[PROJ] POST /projects/${projectId}/edit/${entryId} ${userId}`);

  let originalRecord;
  try {
    originalRecord = await pbAdmin.collection("entries_main").getOne(entryId);
    if (originalRecord.owner !== userId || originalRecord.project !== projectId) {
      logger.warn(`[PROJ] Forbidden attempt to edit entry ${entryId} by user ${userId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      logAuditEvent(req, "ENTRY_UPDATE_FAILURE", "entries_main", entryId, {
        projectId: projectId,
        reason: "Forbidden",
      });
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit/${entryId} ${userId}`);
      return next(err);
    }

    const pbErrors = {};
    if (submittedType === "roadmap" && (!roadmap_stage || roadmap_stage.trim() === "")) {
      pbErrors.roadmap_stage = {
        message: "Roadmap Stage is required.",
      };
    }
    if (submittedType !== "roadmap" && submittedType !== "knowledge_base" && (!content || content.trim() === "")) {
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
      logger.warn(`[PROJ] Edit entry validation failed for ${entryId}, project ${projectId}:`, pbErrors);
      logger.time(`[PROJ] FetchEditEntryAssetsOnError ${entryId}`);
      const [documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      logger.timeEnd(`[PROJ] FetchEditEntryAssetsOnError ${entryId}`);
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
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit/${entryId} ${userId}`);
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
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    }

    let updateData = {};
    const wasPublished = originalRecord.status === "published";
    const isStayingPublished = submittedStatus === "published";
    let actionType = "ENTRY_UPDATE";

    if (wasPublished && isStayingPublished) {
      actionType = "ENTRY_STAGE_CHANGES";
      logger.debug(`[PROJ] Staging changes for published entry ${entryId}.`);
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
      logger.debug(`[PROJ] Updating entry ${entryId} directly (not staging).`);
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
        logger.debug(`[PROJ] Unpublishing entry ${entryId}.`);
      } else if (!wasPublished && submittedStatus === "published") {
        actionType = "ENTRY_PUBLISH";
        logger.debug(`[PROJ] Publishing entry ${entryId}.`);
      }
    }

    const updatedRecord = await pbAdmin.collection("entries_main").update(entryId, updateData);
    logger.info(`[PROJ] Entry ${entryId} updated/staged successfully. Action: ${actionType}`);
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
    logger.debug(`[PROJ] Redirecting to ${redirectPath} after entry update.`);
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/edit/${entryId} ${userId}`);
    logger.error(`[PROJ] Failed to update/stage entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      logger.time(`[PROJ] FetchEditEntryAssetsOnError ${entryId}`);
      const [recordForRender, documentationHeaders, documentationFooters, changelogHeaders, changelogFooters] = await Promise.all([originalRecord || pbAdmin.collection("entries_main").getOne(entryId), getUserDocumentationHeaders(userId, projectId), getUserDocumentationFooters(userId, projectId), getUserChangelogHeaders(userId, projectId), getUserChangelogFooters(userId, projectId)]);
      logger.timeEnd(`[PROJ] FetchEditEntryAssetsOnError ${entryId}`);

      if (recordForRender.owner !== userId || recordForRender.project !== projectId) {
        logger.error(`[PROJ] Forbidden access detected after update error for entry ${entryId}.`);
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
        roadmapStages: ["Planned", "Next Up", "In Progress", "Done"],
      });
    } catch (fetchError) {
      logger.error(`[PROJ] Error fetching data for edit form after update failure on entry ${entryId}: ${fetchError.message}`);
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
  logger.warn(`[PROJ] POST /projects/${projectId}/delete/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ] POST /projects/${projectId}/delete/${entryId} ${userId}`);

  try {
    const entry = await getEntryForOwnerAndProject(entryId, userId, projectId);
    entryTitle = entry.title;
    entryType = entry.type;
    logger.debug(`[PROJ] Deleting entry ${entryId} (${entryTitle}) in project ${projectId}`);

    await pb.collection("entries_main").delete(entryId);
    clearEntryViewLogs(entryId);
    logAuditEvent(req, "ENTRY_DELETE", "entries_main", entryId, {
      projectId: projectId,
      title: entryTitle,
      type: entryType,
    });
    logger.info(`[PROJ] Entry ${entryId} (${entryTitle}) deleted successfully from project ${projectId} by user ${userId}.`);

    try {
      logger.debug(`[PROJ] Cleaning preview tokens for deleted entry ${entryId}.`);
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({
        filter: `entry = '${entryId}'`,
        fields: "id",
      });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
      logger.trace(`[PROJ] Cleaned ${previewTokens.length} preview tokens.`);
    } catch (previewCleanError) {
      logger.error(`[PROJ] Error cleaning preview tokens for deleted entry ${entryId}: ${previewCleanError.message}`);
    }
    let redirectPath = `/projects/${projectId}/documentation?action=deleted`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/changelogs?action=deleted`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/roadmaps?action=deleted`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base?action=deleted`;
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/delete/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/delete/${entryId} ${userId}`);
    logger.error(`[PROJ] Failed to delete entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.info(`[PROJ] POST /projects/${projectId}/archive/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ] POST /projects/${projectId}/archive/${entryId} ${userId}`);

  try {
    originalRecord = await getEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = originalRecord.type;
    logger.debug(`[PROJ] Archiving entry ${entryId} (${originalRecord.title}) in project ${projectId}`);

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
    logger.info(`[PROJ] Entry ${entryId} archived successfully as ${archivedRecord.id} in project ${projectId} by user ${userId}.`);

    logAuditEvent(req, "ENTRY_ARCHIVE", "entries_main", entryId, {
      projectId: projectId,
      title: originalRecord.title,
      type: entryType,
      archivedId: archivedRecord.id,
    });

    try {
      logger.debug(`[PROJ] Cleaning preview tokens for archived entry ${entryId}.`);
      const previewTokens = await pbAdmin.collection("entries_previews").getFullList({
        filter: `entry = '${entryId}'`,
        fields: "id",
      });
      for (const tokenRecord of previewTokens) {
        await pbAdmin.collection("entries_previews").delete(tokenRecord.id);
      }
      logger.trace(`[PROJ] Cleaned ${previewTokens.length} preview tokens.`);
    } catch (previewCleanError) {
      logger.error(`[PROJ] Error cleaning preview tokens for archived entry ${entryId}: ${previewCleanError.message}`);
    }
    let redirectPath = `/projects/${projectId}/documentation?action=archived`;
    if (entryType === "changelog") redirectPath = `/projects/${projectId}/changelogs?action=archived`;
    if (entryType === "roadmap") redirectPath = `/projects/${projectId}/roadmaps?action=archived`;
    if (entryType === "knowledge_base") redirectPath = `/projects/${projectId}/knowledge_base?action=archived`;
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/archive/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/archive/${entryId} ${userId}`);
    logger.error(`[PROJ] Failed to archive entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.debug(`[PROJ] Rendering archived list for type ${entryType}, project ${projectId}, user ${userId}`);
  logger.time(`[PROJ] renderArchivedList ${entryType} ${projectId}`);
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
      logger.error(`[PROJ] Invalid archived entry type requested: ${entryType}`);
      logger.timeEnd(`[PROJ] renderArchivedList ${entryType} ${projectId}`);
      return res.status(400).send("Invalid entry type");
  }

  try {
    const filter = `owner = '${userId}' && project = '${projectId}' && type = '${entryType}'`;
    const initialPage = 1;
    const initialSort = "-updated";
    logger.trace(`[PROJ] Archived entries list filter: ${filter}`);

    const resultList = await pbAdmin.collection("entries_archived").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: listFields,
    });
    logger.debug(`[PROJ] Fetched ${resultList.items.length} archived ${entryType} entries (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

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

    logger.debug(`[PROJ] Rendering view ${viewName} for project ${projectId}`);
    logger.timeEnd(`[PROJ] renderArchivedList ${entryType} ${projectId}`);
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
    logger.timeEnd(`[PROJ] renderArchivedList ${entryType} ${projectId}`);
    logger.error(`[PROJ] Error fetching archived ${entryType} entries for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.info(`[PROJ] POST /projects/${projectId}/unarchive/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ] POST /projects/${projectId}/unarchive/${entryId} ${userId}`);

  try {
    originalRecord = await getArchivedEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = originalRecord.type;
    logger.debug(`[PROJ] Unarchiving entry ${entryId} (${originalRecord.title}) in project ${projectId}, original ID: ${originalRecord.original_id}`);

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
    logger.info(`[PROJ] Entry ${entryId} unarchived successfully as ${newMainRecord.id} in project ${projectId} by user ${userId}.`);

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
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/unarchive/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/unarchive/${entryId} ${userId}`);
    logger.error(`[PROJ] Failed to unarchive entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      logger.error(`[PROJ] Potential ID conflict during unarchive for archived ID ${entryId}. Original ID ${originalRecord?.original_id} might exist in main table.`);
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
  logger.warn(`[PROJ] POST /projects/${projectId}/delete-archived/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ] POST /projects/${projectId}/delete-archived/${entryId} ${userId}`);

  try {
    record = await getArchivedEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = record.type;
    const idToClean = record.original_id || entryId;
    logger.debug(`[PROJ] Permanently deleting archived entry ${entryId} (${record.title}) in project ${projectId}, original ID: ${idToClean}`);

    await pbAdmin.collection("entries_archived").delete(entryId);
    clearEntryViewLogs(idToClean);
    logger.info(`[PROJ] Archived entry ${entryId} (${record.title}) permanently deleted from project ${projectId} by user ${userId}.`);
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
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/delete-archived/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/delete-archived/${entryId} ${userId}`);
    logger.error(`[PROJ] Failed to delete archived entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.debug(`[PROJ] GET /projects/${projectId}/templates requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId}/templates ${userId}`);
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";
    logger.trace(`[PROJ] Templates list filter: ${filter}`);

    const resultList = await pb.collection("templates").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[PROJ] Fetched ${resultList.items.length} templates (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

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

    logger.timeEnd(`[PROJ] GET /projects/${projectId}/templates ${userId}`);
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
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/templates ${userId}`);
    logger.error(`[PROJ] Error fetching templates for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId}/templates/new requested by user ${userId}`);
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
  logger.info(`[PROJ] POST /projects/${projectId}/templates/new attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ] POST /projects/${projectId}/templates/new ${userId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ] Template creation failed for project ${projectId}: Name required.`);
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/new ${userId}`);
    return res.status(400).render("projects/new_template", {
      pageTitle: `New Template - ${req.project.name}`,
      project: req.project,
      template: {
        name,
        content,
      },
      errors: {
        name: {
          message: "Template name is required.",
        },
      },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    logger.debug(`[PROJ] Creating template in project ${projectId} with data:`, data);
    const newTemplate = await pb.collection("templates").create(data);
    logger.info(`[PROJ] Template created successfully: ${newTemplate.id} (${newTemplate.name}) in project ${projectId} by user ${userId}`);
    logAuditEvent(req, "TEMPLATE_CREATE", "templates", newTemplate.id, {
      projectId: projectId,
      name: newTemplate.name,
    });
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/new ${userId}`);
    res.redirect(`/projects/${projectId}/templates?message=Template created successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/new ${userId}`);
    logger.error(`[PROJ] Failed to create template '${name}' in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "TEMPLATE_CREATE_FAILURE", "templates", null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    res.status(500).render("projects/new_template", {
      pageTitle: `New Template - ${req.project.name}`,
      project: req.project,
      template: {
        name,
        content,
      },
      errors: {
        general: {
          message: "Failed to create template.",
        },
      },
    });
  }
});

router.get("/:projectId/templates/edit/:templateId", checkProjectAccess, async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/${projectId}/templates/edit/${templateId} requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId}/templates/edit/${templateId} ${userId}`);

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    logger.debug(`[PROJ] Fetched template ${templateId} for edit page in project ${projectId}.`);
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    res.render("projects/edit_template", {
      pageTitle: `Edit Template - ${req.project.name}`,
      project: req.project,
      template: template,
      errors: null,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ] Access denied or not found for edit template ${templateId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ] Failed to fetch template ${templateId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.info(`[PROJ] POST /projects/${projectId}/templates/edit/${templateId} attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ] Edit template validation failed for ${templateId}, project ${projectId}: Name required.`);
    try {
      const template = await getTemplateForEditAndProject(templateId, userId, projectId);
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
      return res.status(400).render("projects/edit_template", {
        pageTitle: `Edit Template - ${req.project.name}`,
        project: req.project,
        template: {
          ...template,
          name,
          content,
        },
        errors: {
          name: {
            message: "Template name is required.",
          },
        },
      });
    } catch (fetchError) {
      logger.error(`[PROJ] Failed to fetch template ${templateId} after edit validation error: ${fetchError.message}`);
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
      return next(fetchError);
    }
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    logger.debug(`[PROJ] Updating template ${templateId} in project ${projectId} with data:`, data);
    const updatedTemplate = await pb.collection("templates").update(templateId, data);
    logger.info(`[PROJ] Template ${templateId} updated successfully in project ${projectId} by user ${userId}.`);
    logAuditEvent(req, "TEMPLATE_UPDATE", "templates", templateId, {
      projectId: projectId,
      name: updatedTemplate.name,
    });
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    res.redirect(`/projects/${projectId}/templates?message=Template updated successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    logger.error(`[PROJ] Failed to update template ${templateId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "TEMPLATE_UPDATE_FAILURE", "templates", templateId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    try {
      const template = await getTemplateForEditAndProject(templateId, userId, projectId);
      res.status(500).render("projects/edit_template", {
        pageTitle: `Edit Template - ${req.project.name}`,
        project: req.project,
        template: {
          ...template,
          name,
          content,
        },
        errors: {
          general: {
            message: "Failed to update template.",
          },
        },
      });
    } catch (fetchError) {
      logger.error(`[PROJ] Failed to fetch template ${templateId} after update error: ${fetchError.message}`);
      next(fetchError);
    }
  }
});

router.post("/:projectId/templates/delete/:templateId", checkProjectAccess, async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let templateName = templateId;
  logger.warn(`[PROJ] POST /projects/${projectId}/templates/delete/${templateId} initiated by user ${userId}.`);
  logger.time(`[PROJ] POST /projects/${projectId}/templates/delete/${templateId} ${userId}`);

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    templateName = template.name;
    logger.debug(`[PROJ] Deleting template ${templateId} (${templateName}) in project ${projectId}`);

    await pb.collection("templates").delete(templateId);
    logger.info(`[PROJ] Template ${templateId} (${templateName}) deleted successfully from project ${projectId} by user ${userId}.`);
    logAuditEvent(req, "TEMPLATE_DELETE", "templates", templateId, {
      projectId: projectId,
      name: templateName,
    });
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/delete/${templateId} ${userId}`);
    res.redirect(`/projects/${projectId}/templates?message=Template deleted successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/templates/delete/${templateId} ${userId}`);
    logger.error(`[PROJ] Failed to delete template ${templateId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.debug(`[PROJ] GET /projects/${projectId}/sidebar-order requested by user ${userId}`);
  logger.time(`[PROJ] GET /projects/${projectId}/sidebar-order ${userId}`);

  try {
    const sidebarEntries = await pb.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && owner = '${userId}' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
      sort: "+sidebar_order,+title",
      fields: "id,title,sidebar_order,type",
    });
    logger.debug(`[PROJ] Fetched ${sidebarEntries.length} entries for sidebar ordering in project ${projectId}.`);

    logger.timeEnd(`[PROJ] GET /projects/${projectId}/sidebar-order ${userId}`);
    res.render("projects/sidebar_order", {
      pageTitle: `Sidebar Order - ${req.project.name}`,
      project: req.project,
      entries: sidebarEntries,
      message: req.query.message,
      error: req.query.error,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ] GET /projects/${projectId}/sidebar-order ${userId}`);
    logger.error(`[PROJ] Error fetching entries for sidebar ordering for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.info(`[PROJ] POST /projects/${projectId}/sidebar-order attempt by user ${userId}. Count: ${entryOrder?.length}`);
  logger.time(`[PROJ] POST /projects/${projectId}/sidebar-order ${userId}`);

  if (!Array.isArray(entryOrder)) {
    logger.warn(`[PROJ] Invalid sidebar order data format for project ${projectId}. Expected array.`);
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/sidebar-order ${userId}`);
    return res.status(400).json({
      error: "Invalid data format. Expected 'entryOrder' array.",
    });
  }

  try {
    const updatePromises = entryOrder.map((entryId, index) => {
      logger.trace(`[PROJ] Updating sidebar order for entry ${entryId} to ${index}`);
      return pb
        .collection("entries_main")
        .update(
          entryId,
          {
            sidebar_order: index,
          },
          {
            $autoCancel: false,
          },
        )
        .catch((err) => {
          logger.error(`[PROJ] Failed to update sidebar order for entry ${entryId}: Status ${err?.status || "N/A"}`, err?.message || err);
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
      logger.warn(`[PROJ] Sidebar order update completed with ${errors.length} errors for project ${projectId}.`);
      logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_PARTIAL", "entries_main", null, {
        projectId: projectId,
        errors: errors,
      });
      const statusCode = errors.some((e) => e.status === 403) ? 403 : errors.some((e) => e.status >= 500) ? 500 : 400;
      logger.timeEnd(`[PROJ] POST /projects/${projectId}/sidebar-order ${userId}`);
      return res.status(statusCode).json({
        error: `Failed to update order for ${errors.length} out of ${entryOrder.length} entries.`,
        details: errors,
      });
    }

    logger.info(`[PROJ] Sidebar order updated successfully for ${entryOrder.length} entries in project ${projectId}.`);
    logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_SUCCESS", "entries_main", null, {
      projectId: projectId,
      count: entryOrder.length,
    });
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/sidebar-order ${userId}`);
    res.status(200).json({
      message: "Sidebar order updated successfully.",
    });
  } catch (error) {
    logger.timeEnd(`[PROJ] POST /projects/${projectId}/sidebar-order ${userId}`);
    logger.error(`[PROJ] Error updating sidebar order for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "SIDEBAR_ORDER_UPDATE_FAILURE", "entries_main", null, {
      projectId: projectId,
      error: error?.message,
    });
    res.status(500).json({
      error: "An unexpected error occurred while updating sidebar order.",
    });
  }
});

async function renderAssetList(req, res, assetType, collectionName, viewName) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][ASSET] Rendering ${assetType} list for project ${projectId}, user ${userId}`);
  logger.time(`[PROJ][ASSET] renderAssetList ${assetType} ${projectId}`);
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";
    logger.trace(`[PROJ][ASSET] ${assetType} list filter: ${filter}`);

    const resultList = await pb.collection(collectionName).getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[PROJ][ASSET] Fetched ${resultList.items.length} ${assetType} (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

    const assetsForView = [];
    for (const asset of resultList.items) {
      assetsForView.push({
        ...asset,
        formattedUpdated: new Date(asset.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
    }

    logger.timeEnd(`[PROJ][ASSET] renderAssetList ${assetType} ${projectId}`);
    res.render(viewName, {
      pageTitle: `${assetType} - ${req.project.name}`,
      project: req.project,
      assets: assetsForView,
      assetType: assetType,
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
    logger.timeEnd(`[PROJ][ASSET] renderAssetList ${assetType} ${projectId}`);
    logger.error(`[PROJ][ASSET] Error fetching ${assetType} for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${assetType.toUpperCase()}_LIST_FAILURE`, collectionName, null, {
      projectId: projectId,
      error: error?.message,
    });
    res.render(viewName, {
      pageTitle: `${assetType} - ${req.project.name}`,
      project: req.project,
      assets: [],
      assetType: assetType,
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: `Could not load ${assetType}.`,
      message: null,
    });
  }
}

async function renderNewAssetForm(req, res, assetType, viewName) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][ASSET] GET /projects/${projectId}/${assetType}/new requested by user ${userId}`);
  res.render(viewName, {
    pageTitle: `New ${assetType} - ${req.project.name}`,
    project: req.project,
    asset: null,
    assetType: assetType,
    errors: null,
  });
}

async function handleNewAssetPost(req, res, assetType, collectionName, redirectPath) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  logger.info(`[PROJ][ASSET] POST /projects/${projectId}/${assetType}/new attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ][ASSET] POST /new ${assetType} ${projectId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ][ASSET] New ${assetType} validation failed for project ${projectId}: Name required.`);
    logger.timeEnd(`[PROJ][ASSET] POST /new ${assetType} ${projectId}`);
    const viewName = `projects/new_${assetType.toLowerCase().replace(" ", "_")}`;
    return res.status(400).render(viewName, {
      pageTitle: `New ${assetType} - ${req.project.name}`,
      project: req.project,
      asset: {
        name,
        content,
      },
      assetType: assetType,
      errors: {
        name: {
          message: "Name is required.",
        },
      },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
    };
    logger.debug(`[PROJ][ASSET] Creating ${assetType} in project ${projectId} with data:`, data);
    const newAsset = await pb.collection(collectionName).create(data);
    logger.info(`[PROJ][ASSET] ${assetType} created successfully: ${newAsset.id} (${newAsset.name}) in project ${projectId} by user ${userId}`);
    logAuditEvent(req, `${assetType.toUpperCase()}_CREATE`, collectionName, newAsset.id, {
      projectId: projectId,
      name: newAsset.name,
    });
    logger.timeEnd(`[PROJ][ASSET] POST /new ${assetType} ${projectId}`);
    res.redirect(`${redirectPath}?message=${assetType} created successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][ASSET] POST /new ${assetType} ${projectId}`);
    logger.error(`[PROJ][ASSET] Failed to create ${assetType} '${name}' in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${assetType.toUpperCase()}_CREATE_FAILURE`, collectionName, null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    const viewName = `projects/new_${assetType.toLowerCase().replace(" ", "_")}`;
    res.status(500).render(viewName, {
      pageTitle: `New ${assetType} - ${req.project.name}`,
      project: req.project,
      asset: {
        name,
        content,
      },
      assetType: assetType,
      errors: {
        general: {
          message: `Failed to create ${assetType}.`,
        },
      },
    });
  }
}

async function renderEditAssetForm(req, res, assetType, collectionName, viewName, getAssetFunction) {
  const assetId = req.params.assetId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][ASSET] GET /projects/${projectId}/${assetType}/edit/${assetId} requested by user ${userId}`);
  logger.time(`[PROJ][ASSET] GET /edit ${assetType} ${assetId}`);

  try {
    const asset = await getAssetFunction(assetId, userId, projectId);
    logger.debug(`[PROJ][ASSET] Fetched ${assetType} ${assetId} for edit page in project ${projectId}.`);
    logger.timeEnd(`[PROJ][ASSET] GET /edit ${assetType} ${assetId}`);
    res.render(viewName, {
      pageTitle: `Edit ${assetType} - ${req.project.name}`,
      project: req.project,
      asset: asset,
      assetType: assetType,
      errors: null,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][ASSET] GET /edit ${assetType} ${assetId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ][ASSET] Access denied or not found for edit ${assetType} ${assetId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ][ASSET] Failed to fetch ${assetType} ${assetId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${assetType.toUpperCase()}_EDIT_LOAD_FAILURE`, collectionName, assetId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
}

async function handleEditAssetPost(req, res, next, assetType, collectionName, redirectPath, getAssetFunction) {
  const assetId = req.params.assetId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  logger.info(`[PROJ][ASSET] POST /projects/${projectId}/${assetType}/edit/${assetId} attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ][ASSET] POST /edit ${assetType} ${assetId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ][ASSET] Edit ${assetType} validation failed for ${assetId}, project ${projectId}: Name required.`);
    try {
      const asset = await getAssetFunction(assetId, userId, projectId);
      const viewName = `projects/edit_${assetType.toLowerCase().replace(" ", "_")}`;
      logger.timeEnd(`[PROJ][ASSET] POST /edit ${assetType} ${assetId}`);
      return res.status(400).render(viewName, {
        pageTitle: `Edit ${assetType} - ${req.project.name}`,
        project: req.project,
        asset: {
          ...asset,
          name,
          content,
        },
        assetType: assetType,
        errors: {
          name: {
            message: "Name is required.",
          },
        },
      });
    } catch (fetchError) {
      logger.error(`[PROJ][ASSET] Failed to fetch ${assetType} ${assetId} after edit validation error: ${fetchError.message}`);
      logger.timeEnd(`[PROJ][ASSET] POST /edit ${assetType} ${assetId}`);
      return next(fetchError);
    }
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    logger.debug(`[PROJ][ASSET] Updating ${assetType} ${assetId} in project ${projectId} with data:`, data);
    const updatedAsset = await pb.collection(collectionName).update(assetId, data);
    logger.info(`[PROJ][ASSET] ${assetType} ${assetId} updated successfully in project ${projectId} by user ${userId}.`);
    logAuditEvent(req, `${assetType.toUpperCase()}_UPDATE`, collectionName, assetId, {
      projectId: projectId,
      name: updatedAsset.name,
    });
    logger.timeEnd(`[PROJ][ASSET] POST /edit ${assetType} ${assetId}`);
    res.redirect(`${redirectPath}?message=${assetType} updated successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][ASSET] POST /edit ${assetType} ${assetId}`);
    logger.error(`[PROJ][ASSET] Failed to update ${assetType} ${assetId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${assetType.toUpperCase()}_UPDATE_FAILURE`, collectionName, assetId, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    try {
      const asset = await getAssetFunction(assetId, userId, projectId);
      const viewName = `projects/edit_${assetType.toLowerCase().replace(" ", "_")}`;
      res.status(500).render(viewName, {
        pageTitle: `Edit ${assetType} - ${req.project.name}`,
        project: req.project,
        asset: {
          ...asset,
          name,
          content,
        },
        assetType: assetType,
        errors: {
          general: {
            message: `Failed to update ${assetType}.`,
          },
        },
      });
    } catch (fetchError) {
      logger.error(`[PROJ][ASSET] Failed to fetch ${assetType} ${assetId} after update error: ${fetchError.message}`);
      next(fetchError);
    }
  }
}

async function handleDeleteAssetPost(req, res, next, assetType, collectionName, redirectPath, getAssetFunction) {
  const assetId = req.params.assetId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let assetName = assetId;
  logger.warn(`[PROJ][ASSET] POST /projects/${projectId}/${assetType}/delete/${assetId} initiated by user ${userId}.`);
  logger.time(`[PROJ][ASSET] POST /delete ${assetType} ${assetId}`);

  try {
    const asset = await getAssetFunction(assetId, userId, projectId);
    assetName = asset.name;
    logger.debug(`[PROJ][ASSET] Deleting ${assetType} ${assetId} (${assetName}) in project ${projectId}`);

    await pb.collection(collectionName).delete(assetId);
    logger.info(`[PROJ][ASSET] ${assetType} ${assetId} (${assetName}) deleted successfully from project ${projectId} by user ${userId}.`);
    logAuditEvent(req, `${assetType.toUpperCase()}_DELETE`, collectionName, assetId, {
      projectId: projectId,
      name: assetName,
    });
    logger.timeEnd(`[PROJ][ASSET] POST /delete ${assetType} ${assetId}`);
    res.redirect(`${redirectPath}?message=${assetType} deleted successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][ASSET] POST /delete ${assetType} ${assetId}`);
    logger.error(`[PROJ][ASSET] Failed to delete ${assetType} ${assetId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${assetType.toUpperCase()}_DELETE_FAILURE`, collectionName, assetId, {
      projectId: projectId,
      name: assetName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`${redirectPath}?error=Failed to delete ${assetType}.`);
  }
}

router.get("/:projectId/documentation_headers", checkProjectAccess, (req, res) => {
  renderAssetList(req, res, "Documentation Header", "documentation_headers", "projects/documentation_headers");
});
router.get("/:projectId/documentation_headers/new", checkProjectAccess, (req, res) => {
  renderNewAssetForm(req, res, "Documentation Header", "projects/new_documentation_header");
});
router.post("/:projectId/documentation_headers/new", checkProjectAccess, (req, res) => {
  handleNewAssetPost(req, res, "Documentation Header", "documentation_headers", `/projects/${req.params.projectId}/documentation_headers`);
});
router.get("/:projectId/documentation_headers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  renderEditAssetForm(req, res, "Documentation Header", "documentation_headers", "projects/edit_documentation_header", getDocumentationHeaderForEditAndProject);
});
router.post("/:projectId/documentation_headers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  handleEditAssetPost(req, res, next, "Documentation Header", "documentation_headers", `/projects/${req.params.projectId}/documentation_headers`, getDocumentationHeaderForEditAndProject);
});
router.post("/:projectId/documentation_headers/delete/:assetId", checkProjectAccess, (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Documentation Header", "documentation_headers", `/projects/${req.params.projectId}/documentation_headers`, getDocumentationHeaderForEditAndProject);
});

router.get("/:projectId/documentation_footers", checkProjectAccess, (req, res) => {
  renderAssetList(req, res, "Documentation Footer", "documentation_footers", "projects/documentation_footers");
});
router.get("/:projectId/documentation_footers/new", checkProjectAccess, (req, res) => {
  renderNewAssetForm(req, res, "Documentation Footer", "projects/new_documentation_footer");
});
router.post("/:projectId/documentation_footers/new", checkProjectAccess, (req, res) => {
  handleNewAssetPost(req, res, "Documentation Footer", "documentation_footers", `/projects/${req.params.projectId}/documentation_footers`);
});
router.get("/:projectId/documentation_footers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  renderEditAssetForm(req, res, "Documentation Footer", "documentation_footers", "projects/edit_documentation_footer", getDocumentationFooterForEditAndProject);
});
router.post("/:projectId/documentation_footers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  handleEditAssetPost(req, res, next, "Documentation Footer", "documentation_footers", `/projects/${req.params.projectId}/documentation_footers`, getDocumentationFooterForEditAndProject);
});
router.post("/:projectId/documentation_footers/delete/:assetId", checkProjectAccess, (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Documentation Footer", "documentation_footers", `/projects/${req.params.projectId}/documentation_footers`, getDocumentationFooterForEditAndProject);
});

router.get("/:projectId/changelog_headers", checkProjectAccess, (req, res) => {
  renderAssetList(req, res, "Changelog Header", "changelog_headers", "projects/changelog_headers");
});
router.get("/:projectId/changelog_headers/new", checkProjectAccess, (req, res) => {
  renderNewAssetForm(req, res, "Changelog Header", "projects/new_changelog_header");
});
router.post("/:projectId/changelog_headers/new", checkProjectAccess, (req, res) => {
  handleNewAssetPost(req, res, "Changelog Header", "changelog_headers", `/projects/${req.params.projectId}/changelog_headers`);
});
router.get("/:projectId/changelog_headers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  renderEditAssetForm(req, res, "Changelog Header", "changelog_headers", "projects/edit_changelog_header", getChangelogHeaderForEditAndProject);
});
router.post("/:projectId/changelog_headers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  handleEditAssetPost(req, res, next, "Changelog Header", "changelog_headers", `/projects/${req.params.projectId}/changelog_headers`, getChangelogHeaderForEditAndProject);
});
router.post("/:projectId/changelog_headers/delete/:assetId", checkProjectAccess, (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Changelog Header", "changelog_headers", `/projects/${req.params.projectId}/changelog_headers`, getChangelogHeaderForEditAndProject);
});

router.get("/:projectId/changelog_footers", checkProjectAccess, (req, res) => {
  renderAssetList(req, res, "Changelog Footer", "changelog_footers", "projects/changelog_footers");
});
router.get("/:projectId/changelog_footers/new", checkProjectAccess, (req, res) => {
  renderNewAssetForm(req, res, "Changelog Footer", "projects/new_changelog_footer");
});
router.post("/:projectId/changelog_footers/new", checkProjectAccess, (req, res) => {
  handleNewAssetPost(req, res, "Changelog Footer", "changelog_footers", `/projects/${req.params.projectId}/changelog_footers`);
});
router.get("/:projectId/changelog_footers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  renderEditAssetForm(req, res, "Changelog Footer", "changelog_footers", "projects/edit_changelog_footer", getChangelogFooterForEditAndProject);
});
router.post("/:projectId/changelog_footers/edit/:assetId", checkProjectAccess, (req, res, next) => {
  handleEditAssetPost(req, res, next, "Changelog Footer", "changelog_footers", `/projects/${req.params.projectId}/changelog_footers`, getChangelogFooterForEditAndProject);
});
router.post("/:projectId/changelog_footers/delete/:assetId", checkProjectAccess, (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Changelog Footer", "changelog_footers", `/projects/${req.params.projectId}/changelog_footers`, getChangelogFooterForEditAndProject);
});

router.get("/:projectId/audit-log", checkProjectAccess, async (req, res, next) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][AUDIT] GET /projects/${projectId}/audit-log requested by user ${userId}`);
  logger.time(`[PROJ][AUDIT] GET /projects/${projectId}/audit-log ${userId}`);
  try {
    const initialPage = 1;
    const initialSort = "-created";
    logger.warn(`[PROJ][AUDIT] Displaying GLOBAL audit log within project ${projectId} context. Schema does not support project filtering.`);

    const resultList = await pbAdmin.collection("audit_logs").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      expand: "user",
    });
    logger.debug(`[PROJ][AUDIT] Fetched ${resultList.items.length} global audit logs (page ${initialPage}/${resultList.totalPages}) for project ${projectId} view`);

    const formattedLogs = [];
    for (const log of resultList.items) {
      formattedLogs.push({
        ...log,
      });
    }

    logger.timeEnd(`[PROJ][AUDIT] GET /projects/${projectId}/audit-log ${userId}`);
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
    logger.timeEnd(`[PROJ][AUDIT] GET /projects/${projectId}/audit-log ${userId}`);
    logger.error(`[PROJ][AUDIT] Error fetching audit logs for project ${projectId} view: Status ${error?.status || "N/A"}`, error?.message || error);
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
