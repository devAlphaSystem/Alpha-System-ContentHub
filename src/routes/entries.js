import express from "express";
import { pb, ITEMS_PER_PAGE } from "../config.js";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const statusFilter = req.query.status || "all";
  logger.debug(`[ENTRIES_GLOBAL] GET /entries requested by user ${userId} with status filter: ${statusFilter}`);
  logger.time(`[ENTRIES_GLOBAL] GET /entries ${userId} ${statusFilter}`);

  let pageTitle = "All Entries";
  if (statusFilter === "published") {
    pageTitle = "Published Entries";
  } else if (statusFilter === "draft") {
    pageTitle = "Draft Entries";
  } else if (statusFilter === "staged") {
    pageTitle = "Entries with Staged Changes";
  }

  try {
    const initialPage = 1;
    const initialSort = "-updated";

    const filterParts = [`owner = '${userId}'`, `type != 'sidebar_header'`];

    if (statusFilter === "published") {
      filterParts.push(`status = 'published' && (has_staged_changes = false || has_staged_changes = null)`);
    } else if (statusFilter === "draft") {
      filterParts.push(`status = 'draft'`);
    } else if (statusFilter === "staged") {
      filterParts.push(`status = 'published' && has_staged_changes = true`);
    }

    const combinedFilter = filterParts.join(" && ");
    logger.trace(`[ENTRIES_GLOBAL] Initial entries filter: ${combinedFilter}`);

    const [entriesResultList, projectsList] = await Promise.all([
      pb.collection("entries_main").getList(initialPage, ITEMS_PER_PAGE, {
        sort: initialSort,
        filter: combinedFilter,
        fields: "id,title,type,project,updated,status,collection,tags,has_staged_changes,expand",
        expand: "project",
      }),
      pb.collection("projects").getFullList({
        filter: `owner = '${userId}'`,
        sort: "name",
        fields: "id,name",
      }),
    ]);

    logger.debug(`[ENTRIES_GLOBAL] Fetched ${entriesResultList.items.length} entries (page ${initialPage}/${entriesResultList.totalPages}) and ${projectsList.length} projects.`);

    const entriesForView = entriesResultList.items.map((entry) => ({
      ...entry,
      projectName: entry.expand?.project?.name || "N/A",
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      editUrl: entry.project ? `/projects/${entry.project}/edit/${entry.id}` : "#",
      viewUrl: entry.project && entry.status === "published" && entry.type !== "roadmap" && entry.type !== "knowledge_base" ? `/view/${entry.id}?from_admin=1` : null,
    }));

    logger.timeEnd(`[ENTRIES_GLOBAL] GET /entries ${userId} ${statusFilter}`);
    res.render("global_list", {
      pageTitle: pageTitle,
      entries: entriesForView,
      projects: projectsList,
      statusFilter: statusFilter,
      pagination: {
        page: entriesResultList.page,
        perPage: entriesResultList.perPage,
        totalItems: entriesResultList.totalItems,
        totalPages: entriesResultList.totalPages,
      },
      initialSort: initialSort,
      error: req.query.error,
      currentProjectId: null,
    });
  } catch (error) {
    logger.timeEnd(`[ENTRIES_GLOBAL] GET /entries ${userId} ${statusFilter}`);
    logger.error(`[ENTRIES_GLOBAL] Error fetching global entries list: Status ${error?.status || "N/A"}`, error?.message || error);
    res.render("global_list", {
      pageTitle: pageTitle,
      entries: [],
      projects: [],
      statusFilter: statusFilter,
      pagination: {
        page: 1,
        perPage: ITEMS_PER_PAGE,
        totalItems: 0,
        totalPages: 0,
      },
      initialSort: "-updated",
      error: "Could not load entries list.",
      currentProjectId: null,
    });
  }
});

export default router;
