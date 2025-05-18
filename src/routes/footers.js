import express from "express";
import { pb, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { getFooterForEdit, logAuditEvent } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();

const assetConfig = {
  type: "Footer",
  collectionName: "footers",
  listView: "global/footers_list",
  newView: "global/new_footer",
  editView: "global/edit_footer",
  redirectPath: "/footers",
  getAssetFunction: getFooterForEdit,
};

async function renderAssetList(req, res) {
  const { type, collectionName, listView } = assetConfig;
  const userId = req.session.user.id;
  logger.debug(`[GLOBAL][Assets] Rendering global ${type} list for user ${userId}`);
  logger.time(`[GLOBAL][Assets] renderAssetList ${type} ${userId}`);
  try {
    const filter = `owner = '${userId}'`;
    const initialPage = 1;
    const initialSort = "-updated";
    logger.trace(`[GLOBAL][Assets] Global ${type} list filter: ${filter}`);

    const resultList = await pb.collection(collectionName).getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      filter: filter,
      fields: "id,name,updated",
    });
    logger.debug(`[GLOBAL][Assets] Fetched ${resultList.items.length} global ${type}s (page ${initialPage}/${resultList.totalPages}) for user ${userId}`);

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

    logger.timeEnd(`[GLOBAL][Assets] renderAssetList ${type} ${userId}`);
    res.render(listView, {
      pageTitle: `Global ${type}s`,
      assets: assetsForView,
      assetType: type,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      message: req.query.message,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[GLOBAL][Assets] renderAssetList ${type} ${userId}`);
    logger.error(`[GLOBAL][Assets] Error fetching global ${type}s for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `${type.toUpperCase()}_LIST_FAILURE`, collectionName, null, {
      error: error?.message,
    });
    res.render(listView, {
      pageTitle: `Global ${type}s`,
      assets: [],
      assetType: type,
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: `Could not load global ${type}s.`,
      message: null,
      currentProjectId: null,
    });
  }
}

async function renderNewAssetForm(req, res) {
  const { type, newView } = assetConfig;
  const userId = req.session.user.id;
  logger.debug(`[GLOBAL][Assets] GET /${type.toLowerCase()}s/new requested by user ${userId}`);
  res.render(newView, {
    pageTitle: `New Global ${type}`,
    asset: null,
    assetType: type,
    errors: null,
    currentProjectId: null,
  });
}

async function handleNewAssetPost(req, res) {
  const { type, collectionName, newView, redirectPath } = assetConfig;
  const userId = req.session.user.id;
  const { name, content, custom_css, custom_js, apply_full_width } = req.body;
  logger.info(`[GLOBAL][Assets] POST /${type.toLowerCase()}s/new attempt by user ${userId}. Name: ${name}`);
  logger.time(`[GLOBAL][Assets] POST /new ${type} ${userId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[GLOBAL][Assets] New ${type} validation failed for user ${userId}: Name required.`);
    logger.timeEnd(`[GLOBAL][Assets] POST /new ${type} ${userId}`);
    return res.status(400).render(newView, {
      pageTitle: `New Global ${type}`,
      asset: {
        name,
        content,
        custom_css,
        custom_js,
        apply_full_width: apply_full_width === "true",
      },
      assetType: type,
      errors: { name: { message: "Name is required." } },
      currentProjectId: null,
    });
  }

  try {
    const data = {
      name: name.trim(),
      content: content || "",
      owner: userId,
      apply_full_width: apply_full_width === "true",
      custom_css: custom_css || "",
      custom_js: custom_js || "",
    };

    logger.debug(`[GLOBAL][Assets] Creating global ${type} for user ${userId} with data:`, data);
    const newAsset = await pb.collection(collectionName).create(data);
    logger.info(`[GLOBAL][Assets] Global ${type} created successfully: ${newAsset.id} (${newAsset.name}) by user ${userId}`);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_CREATE`, collectionName, newAsset.id, {
      name: newAsset.name,
    });
    logger.timeEnd(`[GLOBAL][Assets] POST /new ${type} ${userId}`);
    res.redirect(`${redirectPath}?message=Global ${type} created successfully.`);
  } catch (error) {
    logger.timeEnd(`[GLOBAL][Assets] POST /new ${type} ${userId}`);
    logger.error(`[GLOBAL][Assets] Failed to create global ${type} '${name}' for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_CREATE_FAILURE`, collectionName, null, {
      name: name,
      error: error?.message,
    });
    res.status(500).render(newView, {
      pageTitle: `New Global ${type}`,
      asset: {
        name,
        content,
        custom_css,
        custom_js,
        apply_full_width: apply_full_width === "true",
      },
      assetType: type,
      errors: { general: { message: `Failed to create global ${type}.` } },
      currentProjectId: null,
    });
  }
}

async function renderEditAssetForm(req, res, next) {
  const { type, collectionName, editView, getAssetFunction } = assetConfig;
  const assetId = req.params.assetId;
  const userId = req.session.user.id;
  logger.debug(`[GLOBAL][Assets] GET /${type.toLowerCase()}s/edit/${assetId} requested by user ${userId}`);
  logger.time(`[GLOBAL][Assets] GET /edit ${type} ${assetId}`);

  try {
    const asset = await getAssetFunction(assetId, userId);
    logger.debug(`[GLOBAL][Assets] Fetched global ${type} ${assetId} for edit page by user ${userId}.`);
    logger.timeEnd(`[GLOBAL][Assets] GET /edit ${type} ${assetId}`);
    res.render(editView, {
      pageTitle: `Edit Global ${type}`,
      asset: asset,
      assetType: type,
      errors: null,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[GLOBAL][Assets] GET /edit ${type} ${assetId}`);
    if (error.status === 403 || error.status === 404) {
      logger.warn(`[GLOBAL][Assets] Access denied or not found for edit global ${type} ${assetId} by user ${userId}. Status: ${error.status}`);
      return next(error);
    }
    logger.error(`[GLOBAL][Assets] Failed to fetch global ${type} ${assetId} for edit by user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_EDIT_LOAD_FAILURE`, collectionName, assetId, {
      error: error?.message,
    });
    next(error);
  }
}

async function handleEditAssetPost(req, res, next) {
  const { type, collectionName, editView, redirectPath, getAssetFunction } = assetConfig;
  const assetId = req.params.assetId;
  const userId = req.session.user.id;
  const { name, content, custom_css, custom_js, apply_full_width } = req.body;
  logger.info(`[GLOBAL][Assets] POST /${type.toLowerCase()}s/edit/${assetId} attempt by user ${userId}. Name: ${name}`);
  logger.time(`[GLOBAL][Assets] POST /edit ${type} ${assetId}`);

  if (!name || name.trim() === "") {
    logger.warn(`[GLOBAL][Assets] Edit ${type} validation failed for ${assetId}, user ${userId}: Name required.`);
    try {
      const asset = await getAssetFunction(assetId, userId);
      logger.timeEnd(`[GLOBAL][Assets] POST /edit ${type} ${assetId}`);
      return res.status(400).render(editView, {
        pageTitle: `Edit Global ${type}`,
        asset: {
          ...asset,
          name,
          content,
          custom_css,
          custom_js,
          apply_full_width: apply_full_width === "true",
        },
        assetType: type,
        errors: { name: { message: "Name is required." } },
        currentProjectId: null,
      });
    } catch (fetchError) {
      logger.error(`[GLOBAL][Assets] Failed to fetch ${type} ${assetId} after edit validation error: ${fetchError.message}`);
      logger.timeEnd(`[GLOBAL][Assets] POST /edit ${type} ${assetId}`);
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

    logger.debug(`[GLOBAL][Assets] Updating global ${type} ${assetId} for user ${userId} with data:`, data);
    const updatedAsset = await pb.collection(collectionName).update(assetId, data);
    logger.info(`[GLOBAL][Assets] Global ${type} ${assetId} updated successfully by user ${userId}.`);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_UPDATE`, collectionName, assetId, {
      name: updatedAsset.name,
    });
    logger.timeEnd(`[GLOBAL][Assets] POST /edit ${type} ${assetId}`);
    res.redirect(`${redirectPath}?message=Global ${type} updated successfully.`);
  } catch (error) {
    logger.timeEnd(`[GLOBAL][Assets] POST /edit ${type} ${assetId}`);
    logger.error(`[GLOBAL][Assets] Failed to update global ${type} ${assetId} for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_UPDATE_FAILURE`, collectionName, assetId, {
      name: name,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    try {
      const asset = await getAssetFunction(assetId, userId);
      res.status(500).render(editView, {
        pageTitle: `Edit Global ${type}`,
        asset: {
          ...asset,
          name,
          content,
          custom_css,
          custom_js,
          apply_full_width: apply_full_width === "true",
        },
        assetType: type,
        errors: { general: { message: `Failed to update global ${type}.` } },
        currentProjectId: null,
      });
    } catch (fetchError) {
      logger.error(`[GLOBAL][Assets] Failed to fetch ${type} ${assetId} after update error: ${fetchError.message}`);
      next(fetchError);
    }
  }
}

async function handleDeleteAssetPost(req, res, next) {
  const { type, collectionName, redirectPath, getAssetFunction } = assetConfig;
  const assetId = req.params.assetId;
  const userId = req.session.user.id;
  let assetName = assetId;
  logger.warn(`[GLOBAL][Assets] POST /${type.toLowerCase()}s/delete/${assetId} initiated by user ${userId}.`);
  logger.time(`[GLOBAL][Assets] POST /delete ${type} ${assetId}`);

  try {
    const asset = await getAssetFunction(assetId, userId);
    assetName = asset.name;
    logger.debug(`[GLOBAL][Assets] Deleting global ${type} ${assetId} (${assetName}) by user ${userId}`);

    await pb.collection(collectionName).delete(assetId);
    logger.info(`[GLOBAL][Assets] Global ${type} ${assetId} (${assetName}) deleted successfully by user ${userId}.`);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_DELETE`, collectionName, assetId, {
      name: assetName,
    });
    logger.timeEnd(`[GLOBAL][Assets] POST /delete ${type} ${assetId}`);
    res.redirect(`${redirectPath}?message=Global ${type} deleted successfully.`);
  } catch (error) {
    logger.timeEnd(`[GLOBAL][Assets] POST /delete ${type} ${assetId}`);
    logger.error(`[GLOBAL][Assets] Failed to delete global ${type} ${assetId} by user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, `GLOBAL_${type.toUpperCase()}_DELETE_FAILURE`, collectionName, assetId, {
      name: assetName,
      error: error?.message,
    });
    if (error.status === 403 || error.status === 404) {
      return next(error);
    }
    res.redirect(`${redirectPath}?error=Failed to delete global ${type}.`);
  }
}

router.get("/", renderAssetList);
router.get("/new", renderNewAssetForm);
router.post("/new", handleNewAssetPost);
router.get("/edit/:assetId", renderEditAssetForm);
router.post("/edit/:assetId", handleEditAssetPost);
router.post("/delete/:assetId", handleDeleteAssetPost);

export default router;
