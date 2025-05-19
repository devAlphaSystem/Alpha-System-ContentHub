import express from "express";
import multer from "multer";
import { pb, pbAdmin, ITEMS_PER_PAGE, getSettings } from "../../config.js";
import { requireLogin } from "../../middleware.js";
import { logAuditEvent } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/json") {
      cb(null, true);
    } else {
      logger.warn(`Project import file upload rejected. Field: ${file.fieldname}, Filename: ${file.originalname}, Mimetype: ${file.mimetype}`);
      cb(new Error("Invalid file type. Only .json files are allowed."));
    }
  },
});

router.get("/", requireLogin, async (req, res) => {
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

router.get("/new", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/new requested by user ${userId}`);
  res.render("projects/new", {
    pageTitle: "Create New Project",
    currentProjectId: null,
    project: null,
    errors: null,
  });
});

router.post("/new", requireLogin, async (req, res) => {
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
    const settings = getSettings();
    const data = {
      name: name.trim(),
      description: description || "",
      owner: userId,
      view_tracking_enabled: settings.enableProjectViewTrackingDefault,
      view_time_tracking_enabled: settings.enableProjectTimeTrackingDefault,
      roadmap_enabled: false,
      is_publicly_viewable: false,
      password_protected: false,
      use_full_width_content: settings.enableProjectFullWidthDefault,
    };
    logger.debug("[PROJ] Creating project with data:", data);
    const newProject = await pb.collection("projects").create(data);
    logger.info(`[PROJ] Project created successfully: ${newProject.id} (${newProject.name}) by user ${userId}`);
    logAuditEvent(req, "PROJECT_CREATE", "projects", newProject.id, {
      name: newProject.name,
    });
    logger.timeEnd(`[PROJ] POST /projects/new ${userId}`);
    res.redirect(`/projects/${newProject.id}/`);
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

router.get("/import", requireLogin, (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[PROJ] GET /projects/import requested by user ${userId}`);
  res.render("projects/import", {
    pageTitle: "Import Project",
    currentProjectId: null,
    error: req.query.error,
    message: req.query.message,
  });
});

router.post("/import", requireLogin, upload.single("projectFile"), async (req, res, next) => {
  const userId = req.session.user.id;
  logger.info(`[PROJ] POST /projects/import attempt by user ${userId}.`);
  logger.time(`[PROJ] Import ${userId}`);

  if (!req.file) {
    logger.warn("[PROJ] Import failed: No file uploaded.");
    logger.timeEnd(`[PROJ] Import ${userId}`);
    return res.redirect("/projects/import?error=No project file uploaded.");
  }

  let importData;
  try {
    importData = JSON.parse(req.file.buffer.toString("utf8"));
    logger.debug("[PROJ] Successfully parsed uploaded JSON file.");

    if (!importData.project || !importData.project.id || !importData.project.name || !importData.related_data || !importData.export_metadata) {
      throw new Error("Invalid project export file structure, missing project data, ID, or name.");
    }
    logger.info(`[PROJ] Importing project: ${importData.project.name} (Original ID: ${importData.project.id})`);
  } catch (parseError) {
    logger.error(`[PROJ] Import failed: Error parsing JSON file. ${parseError.message}`);
    logger.timeEnd(`[PROJ] Import ${userId}`);
    logAuditEvent(req, "PROJECT_IMPORT_FAILURE", null, null, {
      reason: "Invalid JSON file",
      error: parseError.message,
    });
    return res.redirect("/projects/import?error=Invalid project file format.");
  }

  const originalProjectId = importData.project.id;
  const importProjectData = importData.project;
  let targetProjectId = null;
  const idMap = {};

  try {
    const newProjectData = {
      ...importProjectData,
      owner: userId,
      id: undefined,
    };
    newProjectData.created = undefined;
    newProjectData.updated = undefined;
    newProjectData.collectionId = undefined;
    newProjectData.collectionName = undefined;
    newProjectData.expand = undefined;

    logger.debug("[PROJ][Import] Creating new project record.");
    const createdProject = await pb.collection("projects").create(newProjectData);
    targetProjectId = createdProject.id;
    idMap[originalProjectId] = targetProjectId;
    logger.info(`[PROJ][Import] Created new project ${targetProjectId} ("${createdProject.name}").`);
    logAuditEvent(req, "PROJECT_IMPORT_CREATE_STARTED", "projects", targetProjectId, { originalProjectId: originalProjectId, name: createdProject.name });

    const relatedCollections = ["templates", "documentation_headers", "documentation_footers", "changelog_headers", "changelog_footers", "entries_main", "entries_archived"];

    for (const collectionName of relatedCollections) {
      const recordsToImport = importData.related_data[collectionName] || [];
      logger.debug(`[PROJ][Import ${targetProjectId}] Processing ${recordsToImport.length} records for ${collectionName}`);
      logger.time(`[PROJ][Import ${targetProjectId}] Import ${collectionName}`);

      for (const record of recordsToImport) {
        const originalRecordId = record.id;
        const newRecordData = {
          ...record,
          owner: userId,
          project: targetProjectId,
          id: undefined,
        };
        newRecordData.created = undefined;
        newRecordData.updated = undefined;
        newRecordData.collectionId = undefined;
        newRecordData.collectionName = undefined;
        newRecordData.expand = undefined;

        if (collectionName === "entries_main") {
          newRecordData.custom_documentation_header = null;
          newRecordData.custom_documentation_footer = null;
          newRecordData.custom_changelog_header = null;
          newRecordData.custom_changelog_footer = null;
          newRecordData.staged_documentation_header = null;
          newRecordData.staged_documentation_footer = null;
          newRecordData.staged_changelog_header = null;
          newRecordData.staged_changelog_footer = null;
        }

        try {
          const createdRecord = await pb.collection(collectionName).create(newRecordData);
          const actualDbId = createdRecord.id;
          idMap[originalRecordId] = actualDbId;
          logger.trace(`[PROJ][Import ${targetProjectId}] Created new record in ${collectionName}: ${originalRecordId} -> ${actualDbId}`);
        } catch (itemError) {
          logger.error(`[PROJ][Import ${targetProjectId}] Failed to create record in ${collectionName} (Original ID: ${originalRecordId}): ${itemError.message}`, itemError?.data);
          logAuditEvent(req, "PROJECT_IMPORT_ITEM_CREATE_FAILURE", collectionName, null, {
            projectId: targetProjectId,
            originalId: originalRecordId,
            error: itemError.message,
          });
        }
      }
      logger.timeEnd(`[PROJ][Import ${targetProjectId}] Import ${collectionName}`);
    }

    logger.debug(`[PROJ][Import ${targetProjectId}] Starting second pass to update relations in entries_main. ID Map size: ${Object.keys(idMap).length}`);
    logger.time(`[PROJ][Import ${targetProjectId}] Update Relations`);
    const mainEntriesToUpdate = importData.related_data.entries_main || [];
    for (const originalEntry of mainEntriesToUpdate) {
      const actualEntryIdInDb = idMap[originalEntry.id];
      if (!actualEntryIdInDb) {
        logger.warn(`[PROJ][Import ${targetProjectId}] Could not find actual DB ID for original entry ${originalEntry.id} during relation update. Skipping.`);
        continue;
      }

      const relationUpdates = {};
      const relationFields = ["custom_documentation_header", "custom_documentation_footer", "custom_changelog_header", "custom_changelog_footer", "staged_documentation_header", "staged_documentation_footer", "staged_changelog_header", "staged_changelog_footer"];

      let needsUpdate = false;
      for (const field of relationFields) {
        const originalRelatedId = originalEntry[field];
        if (originalRelatedId) {
          const actualRelatedIdInDb = idMap[originalRelatedId];
          if (actualRelatedIdInDb) {
            relationUpdates[field] = actualRelatedIdInDb;
            needsUpdate = true;
            logger.trace(`[PROJ][Import ${targetProjectId}] Mapping relation ${field} for entry ${actualEntryIdInDb}: ${originalRelatedId} -> ${actualRelatedIdInDb}`);
          } else {
            logger.warn(`[PROJ][Import ${targetProjectId}] Could not find actual DB ID for related record ${originalRelatedId} (field: ${field}) for entry ${actualEntryIdInDb}. Setting relation to null.`);
            relationUpdates[field] = null;
            needsUpdate = true;
          }
        } else {
          if (originalEntry.hasOwnProperty(field)) {
            relationUpdates[field] = null;
          }
        }
      }

      if (needsUpdate) {
        try {
          await pb.collection("entries_main").update(actualEntryIdInDb, relationUpdates);
          logger.trace(`[PROJ][Import ${targetProjectId}] Updated relations for entry ${actualEntryIdInDb}.`);
        } catch (updateError) {
          logger.error(`[PROJ][Import ${targetProjectId}] Failed to update relations for entry ${actualEntryIdInDb}: ${updateError.message}`, updateError?.data);
          logAuditEvent(req, "PROJECT_IMPORT_RELATION_FAILURE", "entries_main", actualEntryIdInDb, {
            projectId: targetProjectId,
            originalId: originalEntry.id,
            error: updateError.message,
          });
        }
      }
    }
    logger.timeEnd(`[PROJ][Import ${targetProjectId}] Update Relations`);

    logAuditEvent(req, "PROJECT_IMPORT_SUCCESS", "projects", targetProjectId, {
      originalProjectId: originalProjectId,
      name: importData.project.name,
      isNew: true,
      merged: false,
    });
    logger.info(`[PROJ] Project import completed successfully. New project ID: ${targetProjectId}.`);
    logger.timeEnd(`[PROJ] Import ${userId}`);
    res.redirect(`/projects/${targetProjectId}?message=Project imported successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ] Import ${userId}`);
    logger.error(`[PROJ] Project import failed: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "PROJECT_IMPORT_FAILURE", null, null, {
      reason: "Processing error",
      error: error.message,
    });

    if (targetProjectId) {
      logger.warn(`[PROJ][Import] Attempting cleanup of partially imported new project ${targetProjectId}`);
      try {
        await pbAdmin.collection("projects").delete(targetProjectId);
        logger.info(`[PROJ][Import] Cleaned up partially created project record ${targetProjectId}.`);
      } catch (cleanupError) {
        logger.error(`[PROJ][Import] Failed to cleanup partially created project ${targetProjectId}: ${cleanupError.message}`);
        logAuditEvent(req, "PROJECT_IMPORT_CLEANUP_FAILURE", "projects", targetProjectId, { error: cleanupError.message });
      }
    }
    res.redirect(`/projects/import?error=Failed to import project: ${error.message}`);
  }
});

export default router;
