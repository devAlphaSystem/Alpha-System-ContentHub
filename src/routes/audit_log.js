import express from "express";
import { pbAdmin, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res, next) => {
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
    console.error("Error fetching audit logs for page view:", error);
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
