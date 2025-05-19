import express from "express";
import { pb, ITEMS_PER_PAGE } from "../../config.js";
import { getProjectForOwner, getTemplateForEditAndProject, logAuditEvent } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Templates] checkProjectAccess middleware for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[PROJ][Templates] Project ID is missing in checkProjectAccess.");
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      logger.warn(`[PROJ][Templates] Project ${projectId} not found or access denied for user ${userId} in checkProjectAccess.`);
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    logger.debug(`[PROJ][Templates] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    logger.error(`[PROJ][Templates] Error in checkProjectAccess for project ${projectId}, user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
}

router.use("/:projectId/templates", checkProjectAccess);

router.get("/:projectId/templates", async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Templates] GET /projects/${projectId}/templates requested by user ${userId}`);
  logger.time(`[PROJ][Templates] GET /projects/${projectId}/templates ${userId}`);
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";
    logger.trace(`[PROJ][Templates] Templates list filter: ${filter}`);

    const resultList = await pb.collection("templates").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[PROJ][Templates] Fetched ${resultList.items.length} templates (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

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

    logger.timeEnd(`[PROJ][Templates] GET /projects/${projectId}/templates ${userId}`);
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
    logger.timeEnd(`[PROJ][Templates] GET /projects/${projectId}/templates ${userId}`);
    logger.error(`[PROJ][Templates] Error fetching templates for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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

router.get("/:projectId/templates/new", (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Templates] GET /projects/${projectId}/templates/new requested by user ${userId}`);
  res.render("projects/new_template", {
    pageTitle: `New Template - ${req.project.name}`,
    project: req.project,
    template: null,
    errors: null,
  });
});

router.post("/:projectId/templates/new", async (req, res) => {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  logger.info(`[PROJ][Templates] POST /projects/${projectId}/templates/new attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ][Templates] POST /projects/${projectId}/templates/new ${userId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ][Templates] Template creation failed for project ${projectId}: Name required.`);
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/new ${userId}`);
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
    logger.debug(`[PROJ][Templates] Creating template in project ${projectId} with data:`, data);
    const newTemplate = await pb.collection("templates").create(data);
    logger.info(`[PROJ][Templates] Template created successfully: ${newTemplate.id} (${newTemplate.name}) in project ${projectId} by user ${userId}`);
    logAuditEvent(req, "TEMPLATE_CREATE", "templates", newTemplate.id, {
      projectId: projectId,
      name: newTemplate.name,
    });
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/new ${userId}`);
    res.redirect(`/projects/${projectId}/templates?message=Template created successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/new ${userId}`);
    logger.error(`[PROJ][Templates] Failed to create template '${name}' in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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

router.get("/:projectId/templates/edit/:templateId", async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Templates] GET /projects/${projectId}/templates/edit/${templateId} requested by user ${userId}`);
  logger.time(`[PROJ][Templates] GET /projects/${projectId}/templates/edit/${templateId} ${userId}`);

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    logger.debug(`[PROJ][Templates] Fetched template ${templateId} for edit page in project ${projectId}.`);
    logger.timeEnd(`[PROJ][Templates] GET /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    res.render("projects/edit_template", {
      pageTitle: `Edit Template - ${req.project.name}`,
      project: req.project,
      template: template,
      errors: null,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Templates] GET /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ][Templates] Access denied or not found for edit template ${templateId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ][Templates] Failed to fetch template ${templateId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "TEMPLATE_EDIT_LOAD_FAILURE", "templates", templateId, {
      projectId: projectId,
      error: error?.message,
    });
    next(error);
  }
});

router.post("/:projectId/templates/edit/:templateId", async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  const { name, content } = req.body;
  logger.info(`[PROJ][Templates] POST /projects/${projectId}/templates/edit/${templateId} attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ][Templates] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ][Templates] Edit template validation failed for ${templateId}, project ${projectId}: Name required.`);
    try {
      const template = await getTemplateForEditAndProject(templateId, userId, projectId);
      logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
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
      logger.error(`[PROJ][Templates] Failed to fetch template ${templateId} after edit validation error: ${fetchError.message}`);
      logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
      return next(fetchError);
    }
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
    };
    logger.debug(`[PROJ][Templates] Updating template ${templateId} in project ${projectId} with data:`, data);
    const updatedTemplate = await pb.collection("templates").update(templateId, data);
    logger.info(`[PROJ][Templates] Template ${templateId} updated successfully in project ${projectId} by user ${userId}.`);
    logAuditEvent(req, "TEMPLATE_UPDATE", "templates", templateId, {
      projectId: projectId,
      name: updatedTemplate.name,
    });
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    res.redirect(`/projects/${projectId}/templates?message=Template updated successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/edit/${templateId} ${userId}`);
    logger.error(`[PROJ][Templates] Failed to update template ${templateId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      logger.error(`[PROJ][Templates] Failed to fetch template ${templateId} after update error: ${fetchError.message}`);
      next(fetchError);
    }
  }
});

router.post("/:projectId/templates/delete/:templateId", async (req, res, next) => {
  const templateId = req.params.templateId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let templateName = templateId;
  logger.warn(`[PROJ][Templates] POST /projects/${projectId}/templates/delete/${templateId} initiated by user ${userId}.`);
  logger.time(`[PROJ][Templates] POST /projects/${projectId}/templates/delete/${templateId} ${userId}`);

  try {
    const template = await getTemplateForEditAndProject(templateId, userId, projectId);
    templateName = template.name;
    logger.debug(`[PROJ][Templates] Deleting template ${templateId} (${templateName}) in project ${projectId}`);

    await pb.collection("templates").delete(templateId);
    logger.info(`[PROJ][Templates] Template ${templateId} (${templateName}) deleted successfully from project ${projectId} by user ${userId}.`);
    logAuditEvent(req, "TEMPLATE_DELETE", "templates", templateId, {
      projectId: projectId,
      name: templateName,
    });
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/delete/${templateId} ${userId}`);
    res.redirect(`/projects/${projectId}/templates?message=Template deleted successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][Templates] POST /projects/${projectId}/templates/delete/${templateId} ${userId}`);
    logger.error(`[PROJ][Templates] Failed to delete template ${templateId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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

export default router;
