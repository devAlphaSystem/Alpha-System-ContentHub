import express from "express";
import { pbAdmin, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin, requireAdmin } from "../middleware.js";
import { logger } from "../logger.js";

const router = express.Router();

router.get("/", requireLogin, requireAdmin, async (req, res, next) => {
  const userId = req.session.user.id;
  logger.debug(`[AUDIT] GET /audit-log (global) requested by user ${userId}`);
  logger.time(`[AUDIT] GET /audit-log ${userId}`);
  try {
    const initialPage = 1;
    const initialSort = "-created";

    const resultList = await pbAdmin.collection("audit_logs").getList(initialPage, ITEMS_PER_PAGE, {
      sort: initialSort,
      expand: "user",
    });
    logger.debug(`[AUDIT] Fetched ${resultList.items.length} global audit logs (page ${initialPage}/${resultList.totalPages})`);

    const formattedLogs = [];
    for (const log of resultList.items) {
      formattedLogs.push({
        ...log,
      });
    }

    logger.timeEnd(`[AUDIT] GET /audit-log ${userId}`);
    res.render("audit-log", {
      logs: formattedLogs,
      pageTitle: "Global Audit Log",
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      initialSort: initialSort,
      error: null,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[AUDIT] GET /audit-log ${userId}`);
    logger.error(`[AUDIT] Error fetching global audit logs for page view: Status ${error?.status || "N/A"}`, error?.message || error);
    res.render("audit-log", {
      logs: [],
      pageTitle: "Global Audit Log",
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-created",
      error: "Could not load audit logs.",
      currentProjectId: null,
    });
  }
});

export default router;
