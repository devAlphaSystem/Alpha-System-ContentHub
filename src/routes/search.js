import express from "express";
import { pb, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { logAuditEvent } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const searchQuery = req.query.q || "";
  const pageTitle = searchQuery ? `Search Results for "${searchQuery}"` : "Search";
  const page = Number.parseInt(req.query.page) || 1;
  const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;
  logger.debug(`[SEARCH] GET /search requested by user ${userId}. Query: "${searchQuery}", Page: ${page}`);
  logger.time(`[SEARCH] GET /search ${userId} "${searchQuery}"`);

  if (!searchQuery.trim()) {
    logger.debug("[SEARCH] No search query provided.");
    logger.timeEnd(`[SEARCH] GET /search ${userId} "${searchQuery}"`);
    return res.render("search_results", {
      pageTitle: pageTitle,
      searchQuery: searchQuery,
      results: [],
      pagination: null,
      error: "Please enter a search term.",
      currentProjectId: null,
    });
  }

  try {
    const escapedSearch = searchQuery.trim().replace(/'/g, "''");
    const filterParts = [`owner = '${userId}'`, `(title ~ '${escapedSearch}' || collection ~ '${escapedSearch}' || tags ~ '${escapedSearch}')`];
    const filter = filterParts.join(" && ");
    logger.trace(`[SEARCH] Search filter: ${filter}`);

    const resultList = await pb.collection("entries_main").getList(page, perPage, {
      filter: filter,
      sort: "-updated",
      fields: "id,title,type,project,updated,status,collection,tags,expand",
      expand: "project",
    });
    logger.debug(`[SEARCH] Found ${resultList.totalItems} results for query "${searchQuery}" (page ${page}/${resultList.totalPages})`);

    const searchResults = resultList.items.map((entry) => ({
      ...entry,
      projectName: entry.expand?.project?.name || "Unknown Project",
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      editUrl: `/projects/${entry.project}/edit/${entry.id}`,
      projectUrl: `/projects/${entry.project}`,
    }));

    logAuditEvent(req, "GLOBAL_SEARCH", null, null, {
      query: searchQuery,
      resultsCount: resultList.totalItems,
    });

    logger.timeEnd(`[SEARCH] GET /search ${userId} "${searchQuery}"`);
    res.render("search_results", {
      pageTitle: pageTitle,
      searchQuery: searchQuery,
      results: searchResults,
      pagination: {
        page: resultList.page,
        perPage: resultList.perPage,
        totalItems: resultList.totalItems,
        totalPages: resultList.totalPages,
      },
      error: null,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[SEARCH] GET /search ${userId} "${searchQuery}"`);
    logger.error(`[SEARCH] Error performing global search for query "${searchQuery}": Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "GLOBAL_SEARCH_FAILURE", null, null, {
      query: searchQuery,
      error: error?.message,
    });
    res.render("search_results", {
      pageTitle: pageTitle,
      searchQuery: searchQuery,
      results: [],
      pagination: null,
      error: "An error occurred during the search.",
      currentProjectId: null,
    });
  }
});

export default router;
