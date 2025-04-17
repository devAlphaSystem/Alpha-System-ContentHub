import express from "express";
import { pb, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const searchQuery = req.query.q || "";
  const pageTitle = searchQuery ? `Search Results for "${searchQuery}"` : "Search";
  const page = Number.parseInt(req.query.page) || 1;
  const perPage = Number.parseInt(req.query.perPage) || ITEMS_PER_PAGE;

  if (!searchQuery.trim()) {
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

    const resultList = await pb.collection("entries_main").getList(page, perPage, {
      filter: filter,
      sort: "-updated",
      fields: "id,title,type,project,updated,status,collection,tags,expand",
      expand: "project",
    });

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
    console.error("Error performing global search:", error);
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
