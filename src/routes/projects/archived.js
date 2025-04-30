import express from "express";
import { pb, pbAdmin, ITEMS_PER_PAGE } from "../../config.js";
import { requireLogin } from "../../middleware.js";
import { getProjectForOwner, getArchivedEntryForOwnerAndProject, logAuditEvent, clearEntryViewLogs } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Archived] checkProjectAccess middleware for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[PROJ][Archived] Project ID is missing in checkProjectAccess.");
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      logger.warn(`[PROJ][Archived] Project ${projectId} not found or access denied for user ${userId} in checkProjectAccess.`);
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    logger.debug(`[PROJ][Archived] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    logger.error(`[PROJ][Archived] Error in checkProjectAccess for project ${projectId}, user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
}

router.use("/:projectId", checkProjectAccess);

async function renderArchivedList(req, res, entryType) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Archived] Rendering archived list for type ${entryType}, project ${projectId}, user ${userId}`);
  logger.time(`[PROJ][Archived] renderArchivedList ${entryType} ${projectId}`);
  let pageTitle = "";
  let viewName = "";
  let listFields = "id,title,status,type,updated,original_id,content_updated_at";

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
      logger.error(`[PROJ][Archived] Invalid archived entry type requested: ${entryType}`);
      logger.timeEnd(`[PROJ][Archived] renderArchivedList ${entryType} ${projectId}`);
      return res.status(400).send("Invalid entry type");
  }

  try {
    const filter = `owner = '${userId}' && project = '${projectId}' && type = '${entryType}'`;
    const initialPage = 1;
    const initialSort = "-content_updated_at";
    logger.trace(`[PROJ][Archived] Archived entries list filter: ${filter}`);

    const resultList = await pbAdmin.collection("entries_archived").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: listFields,
    });
    logger.debug(`[PROJ][Archived] Fetched ${resultList.items.length} archived ${entryType} entries (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

    const entriesForView = [];
    for (const entry of resultList.items) {
      entriesForView.push({
        ...entry,
        formattedUpdated: new Date(entry.content_updated_at || entry.updated).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        systemUpdatedAt: entry.updated,
      });
    }

    logger.debug(`[PROJ][Archived] Rendering view ${viewName} for project ${projectId}`);
    logger.timeEnd(`[PROJ][Archived] renderArchivedList ${entryType} ${projectId}`);
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
    logger.timeEnd(`[PROJ][Archived] renderArchivedList ${entryType} ${projectId}`);
    logger.error(`[PROJ][Archived] Error fetching archived ${entryType} entries for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      initialSort: "-content_updated_at",
      error: `Could not load archived ${entryType} entries.`,
      action: null,
    });
  }
}

router.get("/:projectId/archived_documentation", (req, res) => {
  renderArchivedList(req, res, "documentation");
});

router.get("/:projectId/archived_changelogs", (req, res) => {
  renderArchivedList(req, res, "changelog");
});

router.get("/:projectId/archived_roadmaps", (req, res) => {
  renderArchivedList(req, res, "roadmap");
});

router.get("/:projectId/archived_knowledge_base", (req, res) => {
  renderArchivedList(req, res, "knowledge_base");
});

router.post("/:projectId/unarchive/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let originalRecord;
  let entryType = "documentation";
  logger.info(`[PROJ][Archived] POST /projects/${projectId}/unarchive/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ][Archived] POST /projects/${projectId}/unarchive/${entryId} ${userId}`);

  try {
    originalRecord = await getArchivedEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = originalRecord.type;
    logger.debug(`[PROJ][Archived] Unarchiving entry ${entryId} (${originalRecord.title}) in project ${projectId}, original ID: ${originalRecord.original_id}`);

    const mainData = {
      ...originalRecord,
      custom_documentation_header: originalRecord.custom_documentation_header || null,
      custom_documentation_footer: originalRecord.custom_documentation_footer || null,
      custom_changelog_header: originalRecord.custom_changelog_header || null,
      custom_changelog_footer: originalRecord.custom_changelog_footer || null,
      roadmap_stage: originalRecord.roadmap_stage || null,
      content_updated_at: originalRecord.content_updated_at,
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
    logger.info(`[PROJ][Archived] Entry ${entryId} unarchived successfully as ${newMainRecord.id} in project ${projectId} by user ${userId}.`);

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
    logger.timeEnd(`[PROJ][Archived] POST /projects/${projectId}/unarchive/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ][Archived] POST /projects/${projectId}/unarchive/${entryId} ${userId}`);
    logger.error(`[PROJ][Archived] Failed to unarchive entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      logger.error(`[PROJ][Archived] Potential ID conflict during unarchive for archived ID ${entryId}. Original ID ${originalRecord?.original_id} might exist in main table.`);
      errorRedirectPath = errorRedirectPath.replace("unarchive_failed", "unarchive_conflict");
    }
    res.redirect(errorRedirectPath);
  }
});

router.post("/:projectId/delete-archived/:entryId", async (req, res, next) => {
  const entryId = req.params.entryId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let record;
  let entryType = "documentation";
  logger.warn(`[PROJ][Archived] POST /projects/${projectId}/delete-archived/${entryId} initiated by user ${userId}.`);
  logger.time(`[PROJ][Archived] POST /projects/${projectId}/delete-archived/${entryId} ${userId}`);

  try {
    record = await getArchivedEntryForOwnerAndProject(entryId, userId, projectId);
    entryType = record.type;
    const idToClean = record.original_id || entryId;
    logger.debug(`[PROJ][Archived] Permanently deleting archived entry ${entryId} (${record.title}) in project ${projectId}, original ID: ${idToClean}`);

    await pbAdmin.collection("entries_archived").delete(entryId);
    clearEntryViewLogs(idToClean);
    logger.info(`[PROJ][Archived] Archived entry ${entryId} (${record.title}) permanently deleted from project ${projectId} by user ${userId}.`);
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
    logger.timeEnd(`[PROJ][Archived] POST /projects/${projectId}/delete-archived/${entryId} ${userId}`);
    res.redirect(redirectPath);
  } catch (error) {
    logger.timeEnd(`[PROJ][Archived] POST /projects/${projectId}/delete-archived/${entryId} ${userId}`);
    logger.error(`[PROJ][Archived] Failed to delete archived entry ${entryId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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

export default router;
