import express from "express";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";
import { ITEMS_PER_PAGE } from "../config.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  logger.debug(`[FILES] GET /files requested by user ${userId}`);
  logger.time(`[FILES] GET /files ${userId}`);

  try {
    logger.timeEnd(`[FILES] GET /files ${userId}`);
    res.render("files", {
      pageTitle: "Manage Files",
      files: [],
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 1,
      },
      initialSort: "-created",
      error: req.query.error,
      message: req.query.message,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[FILES] GET /files ${userId}`);
    logger.error(`[FILES] Error rendering files page for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    res.render("files", {
      pageTitle: "Manage Files",
      files: [],
      pagination: null,
      initialSort: "-created",
      error: "Could not load the files page.",
      message: null,
      currentProjectId: null,
    });
  }
});

export default router;
