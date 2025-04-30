import express from "express";
import { pb, ITEMS_PER_PAGE } from "../../config.js";
import { requireLogin } from "../../middleware.js";
import { getProjectForOwner, getDocumentationHeaderForEditAndProject, getDocumentationFooterForEditAndProject, getChangelogHeaderForEditAndProject, getChangelogFooterForEditAndProject, logAuditEvent } from "../../utils.js";
import { logger } from "../../logger.js";

const router = express.Router();

async function checkProjectAccess(req, res, next) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Assets] checkProjectAccess middleware for project ${projectId}, user ${userId}`);
  if (!projectId) {
    logger.warn("[PROJ][Assets] Project ID is missing in checkProjectAccess.");
    return next(new Error("Project ID is missing"));
  }
  try {
    const project = await getProjectForOwner(projectId, userId);
    if (!project) {
      logger.warn(`[PROJ][Assets] Project ${projectId} not found or access denied for user ${userId} in checkProjectAccess.`);
      const err = new Error("Project not found or access denied");
      err.status = 404;
      return next(err);
    }
    req.project = project;
    res.locals.currentProjectId = projectId;
    res.locals.currentProjectName = project.name;
    logger.debug(`[PROJ][Assets] Project access granted for project ${projectId}, user ${userId}`);
    next();
  } catch (error) {
    logger.error(`[PROJ][Assets] Error in checkProjectAccess for project ${projectId}, user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    next(error);
  }
}

router.use("/:projectId", checkProjectAccess);

async function renderAssetList(req, res, assetType, collectionName, viewName) {
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Assets] Rendering ${assetType} list for project ${projectId}, user ${userId}`);
  logger.time(`[PROJ][Assets] renderAssetList ${assetType} ${projectId}`);
  try {
    const filter = `owner = '${userId}' && project = '${projectId}'`;
    const initialPage = 1;
    const initialSort = "-updated";
    logger.trace(`[PROJ][Assets] ${assetType} list filter: ${filter}`);

    const resultList = await pb.collection(collectionName).getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[PROJ][Assets] Fetched ${resultList.items.length} ${assetType} (page ${initialPage}/${resultList.totalPages}) for project ${projectId}`);

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

    logger.timeEnd(`[PROJ][Assets] renderAssetList ${assetType} ${projectId}`);
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
    logger.timeEnd(`[PROJ][Assets] renderAssetList ${assetType} ${projectId}`);
    logger.error(`[PROJ][Assets] Error fetching ${assetType} for project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  logger.debug(`[PROJ][Assets] GET /projects/${projectId}/${assetType}/new requested by user ${userId}`);
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
  const { name, content, is_sticky, custom_css, custom_js, apply_full_width } = req.body;
  logger.info(`[PROJ][Assets] POST /projects/${projectId}/${assetType}/new attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ][Assets] POST /new ${assetType} ${projectId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ][Assets] New ${assetType} validation failed for project ${projectId}: Name required.`);
    logger.timeEnd(`[PROJ][Assets] POST /new ${assetType} ${projectId}`);
    const viewName = `projects/new_${assetType.toLowerCase().replace(/ /g, "_")}`;
    return res.status(400).render(viewName, {
      pageTitle: `New ${assetType} - ${req.project.name}`,
      project: req.project,
      asset: {
        name,
        content,
        is_sticky: is_sticky === "true",
        custom_css,
        custom_js,
        apply_full_width: apply_full_width === "true",
      },
      assetType: assetType,
      errors: { name: { message: "Name is required." } },
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      project: projectId,
      apply_full_width: apply_full_width === "true",
      custom_css: custom_css || "",
      custom_js: custom_js || "",
    };
    if (collectionName === "documentation_headers" || collectionName === "changelog_headers") {
      data.is_sticky = is_sticky === "true";
    }

    logger.debug(`[PROJ][Assets] Creating ${assetType} in project ${projectId} with data:`, data);
    const newAsset = await pb.collection(collectionName).create(data);
    logger.info(`[PROJ][Assets] ${assetType} created successfully: ${newAsset.id} (${newAsset.name}) in project ${projectId} by user ${userId}`);
    logAuditEvent(req, `${assetType.toUpperCase()}_CREATE`, collectionName, newAsset.id, {
      projectId: projectId,
      name: newAsset.name,
    });
    logger.timeEnd(`[PROJ][Assets] POST /new ${assetType} ${projectId}`);
    res.redirect(`${redirectPath}?message=${assetType} created successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][Assets] POST /new ${assetType} ${projectId}`);
    logger.error(`[PROJ][Assets] Failed to create ${assetType} '${name}' in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${assetType.toUpperCase()}_CREATE_FAILURE`, collectionName, null, {
      projectId: projectId,
      name: name,
      error: error?.message,
    });
    const viewName = `projects/new_${assetType.toLowerCase().replace(/ /g, "_")}`;
    res.status(500).render(viewName, {
      pageTitle: `New ${assetType} - ${req.project.name}`,
      project: req.project,
      asset: {
        name,
        content,
        is_sticky: is_sticky === "true",
        custom_css,
        custom_js,
        apply_full_width: apply_full_width === "true",
      },
      assetType: assetType,
      errors: { general: { message: `Failed to create ${assetType}.` } },
    });
  }
}

async function renderEditAssetForm(req, res, next, assetType, collectionName, viewName, getAssetFunction) {
  const assetId = req.params.assetId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  logger.debug(`[PROJ][Assets] GET /projects/${projectId}/${assetType}/edit/${assetId} requested by user ${userId}`);
  logger.time(`[PROJ][Assets] GET /edit ${assetType} ${assetId}`);

  try {
    const asset = await getAssetFunction(assetId, userId, projectId);
    logger.debug(`[PROJ][Assets] Fetched ${assetType} ${assetId} for edit page in project ${projectId}.`);
    logger.timeEnd(`[PROJ][Assets] GET /edit ${assetType} ${assetId}`);
    res.render(viewName, {
      pageTitle: `Edit ${assetType} - ${req.project.name}`,
      project: req.project,
      asset: asset,
      assetType: assetType,
      errors: null,
    });
  } catch (error) {
    logger.timeEnd(`[PROJ][Assets] GET /edit ${assetType} ${assetId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[PROJ][Assets] Access denied or not found for edit ${assetType} ${assetId}, project ${projectId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[PROJ][Assets] Failed to fetch ${assetType} ${assetId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
  const { name, content, is_sticky, custom_css, custom_js, apply_full_width } = req.body;
  logger.info(`[PROJ][Assets] POST /projects/${projectId}/${assetType}/edit/${assetId} attempt by user ${userId}. Name: ${name}`);
  logger.time(`[PROJ][Assets] POST /edit ${assetType} ${assetId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[PROJ][Assets] Edit ${assetType} validation failed for ${assetId}, project ${projectId}: Name required.`);
    try {
      const asset = await getAssetFunction(assetId, userId, projectId);
      const viewName = `projects/edit_${assetType.toLowerCase().replace(/ /g, "_")}`;
      logger.timeEnd(`[PROJ][Assets] POST /edit ${assetType} ${assetId}`);
      return res.status(400).render(viewName, {
        pageTitle: `Edit ${assetType} - ${req.project.name}`,
        project: req.project,
        asset: {
          ...asset,
          name,
          content,
          is_sticky: is_sticky === "true",
          custom_css,
          custom_js,
          apply_full_width: apply_full_width === "true",
        },
        assetType: assetType,
        errors: { name: { message: "Name is required." } },
      });
    } catch (fetchError) {
      logger.error(`[PROJ][Assets] Failed to fetch ${assetType} ${assetId} after edit validation error: ${fetchError.message}`);
      logger.timeEnd(`[PROJ][Assets] POST /edit ${assetType} ${assetId}`);
      return next(fetchError);
    }
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      apply_full_width: apply_full_width === "true",
      custom_css: custom_css || "",
      custom_js: custom_js || "",
    };
    if (collectionName === "documentation_headers" || collectionName === "changelog_headers") {
      data.is_sticky = is_sticky === "true";
    }

    logger.debug(`[PROJ][Assets] Updating ${assetType} ${assetId} in project ${projectId} with data:`, data);
    const updatedAsset = await pb.collection(collectionName).update(assetId, data);
    logger.info(`[PROJ][Assets] ${assetType} ${assetId} updated successfully in project ${projectId} by user ${userId}.`);
    logAuditEvent(req, `${assetType.toUpperCase()}_UPDATE`, collectionName, assetId, {
      projectId: projectId,
      name: updatedAsset.name,
    });
    logger.timeEnd(`[PROJ][Assets] POST /edit ${assetType} ${assetId}`);
    res.redirect(`${redirectPath}?message=${assetType} updated successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][Assets] POST /edit ${assetType} ${assetId}`);
    logger.error(`[PROJ][Assets] Failed to update ${assetType} ${assetId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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
      const viewName = `projects/edit_${assetType.toLowerCase().replace(/ /g, "_")}`;
      res.status(500).render(viewName, {
        pageTitle: `Edit ${assetType} - ${req.project.name}`,
        project: req.project,
        asset: {
          ...asset,
          name,
          content,
          is_sticky: is_sticky === "true",
          custom_css,
          custom_js,
          apply_full_width: apply_full_width === "true",
        },
        assetType: assetType,
        errors: { general: { message: `Failed to update ${assetType}.` } },
      });
    } catch (fetchError) {
      logger.error(`[PROJ][Assets] Failed to fetch ${assetType} ${assetId} after update error: ${fetchError.message}`);
      next(fetchError);
    }
  }
}

async function handleDeleteAssetPost(req, res, next, assetType, collectionName, redirectPath, getAssetFunction) {
  const assetId = req.params.assetId;
  const projectId = req.params.projectId;
  const userId = req.session.user.id;
  let assetName = assetId;
  logger.warn(`[PROJ][Assets] POST /projects/${projectId}/${assetType}/delete/${assetId} initiated by user ${userId}.`);
  logger.time(`[PROJ][Assets] POST /delete ${assetType} ${assetId}`);

  try {
    const asset = await getAssetFunction(assetId, userId, projectId);
    assetName = asset.name;
    logger.debug(`[PROJ][Assets] Deleting ${assetType} ${assetId} (${assetName}) in project ${projectId}`);

    await pb.collection(collectionName).delete(assetId);
    logger.info(`[PROJ][Assets] ${assetType} ${assetId} (${assetName}) deleted successfully from project ${projectId} by user ${userId}.`);
    logAuditEvent(req, `${assetType.toUpperCase()}_DELETE`, collectionName, assetId, {
      projectId: projectId,
      name: assetName,
    });
    logger.timeEnd(`[PROJ][Assets] POST /delete ${assetType} ${assetId}`);
    res.redirect(`${redirectPath}?message=${assetType} deleted successfully.`);
  } catch (error) {
    logger.timeEnd(`[PROJ][Assets] POST /delete ${assetType} ${assetId}`);
    logger.error(`[PROJ][Assets] Failed to delete ${assetType} ${assetId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
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

router.get("/:projectId/documentation_headers", (req, res) => {
  renderAssetList(req, res, "Documentation Header", "documentation_headers", "projects/documentation_headers");
});
router.get("/:projectId/documentation_headers/new", (req, res) => {
  renderNewAssetForm(req, res, "Documentation Header", "projects/new_documentation_header");
});
router.post("/:projectId/documentation_headers/new", (req, res) => {
  handleNewAssetPost(req, res, "Documentation Header", "documentation_headers", `/projects/${req.params.projectId}/documentation_headers`);
});
router.get("/:projectId/documentation_headers/edit/:assetId", (req, res, next) => {
  renderEditAssetForm(req, res, next, "Documentation Header", "documentation_headers", "projects/edit_documentation_header", getDocumentationHeaderForEditAndProject);
});
router.post("/:projectId/documentation_headers/edit/:assetId", (req, res, next) => {
  handleEditAssetPost(req, res, next, "Documentation Header", "documentation_headers", `/projects/${req.params.projectId}/documentation_headers`, getDocumentationHeaderForEditAndProject);
});
router.post("/:projectId/documentation_headers/delete/:assetId", (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Documentation Header", "documentation_headers", `/projects/${req.params.projectId}/documentation_headers`, getDocumentationHeaderForEditAndProject);
});

router.get("/:projectId/documentation_footers", (req, res) => {
  renderAssetList(req, res, "Documentation Footer", "documentation_footers", "projects/documentation_footers");
});
router.get("/:projectId/documentation_footers/new", (req, res) => {
  renderNewAssetForm(req, res, "Documentation Footer", "projects/new_documentation_footer");
});
router.post("/:projectId/documentation_footers/new", (req, res) => {
  handleNewAssetPost(req, res, "Documentation Footer", "documentation_footers", `/projects/${req.params.projectId}/documentation_footers`);
});
router.get("/:projectId/documentation_footers/edit/:assetId", (req, res, next) => {
  renderEditAssetForm(req, res, next, "Documentation Footer", "documentation_footers", "projects/edit_documentation_footer", getDocumentationFooterForEditAndProject);
});
router.post("/:projectId/documentation_footers/edit/:assetId", (req, res, next) => {
  handleEditAssetPost(req, res, next, "Documentation Footer", "documentation_footers", `/projects/${req.params.projectId}/documentation_footers`, getDocumentationFooterForEditAndProject);
});
router.post("/:projectId/documentation_footers/delete/:assetId", (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Documentation Footer", "documentation_footers", `/projects/${req.params.projectId}/documentation_footers`, getDocumentationFooterForEditAndProject);
});

router.get("/:projectId/changelog_headers", (req, res) => {
  renderAssetList(req, res, "Changelog Header", "changelog_headers", "projects/changelog_headers");
});
router.get("/:projectId/changelog_headers/new", (req, res) => {
  renderNewAssetForm(req, res, "Changelog Header", "projects/new_changelog_header");
});
router.post("/:projectId/changelog_headers/new", (req, res) => {
  handleNewAssetPost(req, res, "Changelog Header", "changelog_headers", `/projects/${req.params.projectId}/changelog_headers`);
});
router.get("/:projectId/changelog_headers/edit/:assetId", (req, res, next) => {
  renderEditAssetForm(req, res, next, "Changelog Header", "changelog_headers", "projects/edit_changelog_header", getChangelogHeaderForEditAndProject);
});
router.post("/:projectId/changelog_headers/edit/:assetId", (req, res, next) => {
  handleEditAssetPost(req, res, next, "Changelog Header", "changelog_headers", `/projects/${req.params.projectId}/changelog_headers`, getChangelogHeaderForEditAndProject);
});
router.post("/:projectId/changelog_headers/delete/:assetId", (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Changelog Header", "changelog_headers", `/projects/${req.params.projectId}/changelog_headers`, getChangelogHeaderForEditAndProject);
});

router.get("/:projectId/changelog_footers", (req, res) => {
  renderAssetList(req, res, "Changelog Footer", "changelog_footers", "projects/changelog_footers");
});
router.get("/:projectId/changelog_footers/new", (req, res) => {
  renderNewAssetForm(req, res, "Changelog Footer", "projects/new_changelog_footer");
});
router.post("/:projectId/changelog_footers/new", (req, res) => {
  handleNewAssetPost(req, res, "Changelog Footer", "changelog_footers", `/projects/${req.params.projectId}/changelog_footers`);
});
router.get("/:projectId/changelog_footers/edit/:assetId", (req, res, next) => {
  renderEditAssetForm(req, res, next, "Changelog Footer", "changelog_footers", "projects/edit_changelog_footer", getChangelogFooterForEditAndProject);
});
router.post("/:projectId/changelog_footers/edit/:assetId", (req, res, next) => {
  handleEditAssetPost(req, res, next, "Changelog Footer", "changelog_footers", `/projects/${req.params.projectId}/changelog_footers`, getChangelogFooterForEditAndProject);
});
router.post("/:projectId/changelog_footers/delete/:assetId", (req, res, next) => {
  handleDeleteAssetPost(req, res, next, "Changelog Footer", "changelog_footers", `/projects/${req.params.projectId}/changelog_footers`, getChangelogFooterForEditAndProject);
});

export default router;
