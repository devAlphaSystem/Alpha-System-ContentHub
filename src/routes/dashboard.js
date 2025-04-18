import express from "express";
import { pb, pbAdmin } from "../config.js";
import { requireLogin } from "../middleware.js";
import { logAuditEvent } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const pageTitle = "Dashboard";
  logger.debug(`[DASH] GET / (global dashboard) requested by user ${userId}`);
  logger.time(`[DASH] GET / ${userId}`);

  try {
    logger.time(`[DASH] FetchProjects ${userId}`);
    const projectsResult = await pb.collection("projects").getFullList({
      filter: `owner = '${userId}'`,
      sort: "-updated",
      fields: "id, name, updated",
      $autoCancel: false,
    });
    logger.timeEnd(`[DASH] FetchProjects ${userId}`);
    const totalProjects = projectsResult.length;
    const recentlyUpdatedProjects = projectsResult.slice(0, 5).map((p) => ({
      ...p,
      formattedUpdated: new Date(p.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));
    logger.debug(`[DASH] Found ${totalProjects} projects for user ${userId}.`);

    logger.time(`[DASH] FetchAllEntries ${userId}`);
    const allEntries = await pb.collection("entries_main").getFullList({
      filter: `owner = '${userId}'`,
      fields: "id, status, has_staged_changes, views, title, project, type, created",
      sort: "-views",
      expand: "project",
      $autoCancel: false,
    });
    logger.timeEnd(`[DASH] FetchAllEntries ${userId}`);
    logger.debug(`[DASH] Found ${allEntries.length} total entries for user ${userId}.`);

    let totalEntriesDocsCl = 0;
    let publishedCountDocsCl = 0;
    let draftCount = 0;
    let stagedCount = 0;
    let totalViewsDocsCl = 0;
    let documentationCount = 0;
    let changelogCount = 0;
    let activityData = [];
    const activityMap = new Map();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const entry of allEntries) {
      const isDocOrCl = entry.type === "documentation" || entry.type === "changelog";

      if (isDocOrCl) {
        totalEntriesDocsCl++;
        totalViewsDocsCl += entry.views || 0;

        if (entry.status === "published") {
          publishedCountDocsCl++;
          if (entry.has_staged_changes) {
            stagedCount++;
          }
        } else if (entry.status === "draft") {
          draftCount++;
        }
      } else if (entry.status === "draft") {
        draftCount++;
      } else if (entry.status === "published" && entry.has_staged_changes) {
        stagedCount++;
      }

      if (entry.type === "documentation") {
        documentationCount++;
      } else if (entry.type === "changelog") {
        changelogCount++;
      }

      const createdDate = new Date(entry.created);
      if (createdDate >= thirtyDaysAgo) {
        const dateString = createdDate.toISOString().split("T")[0];
        activityMap.set(dateString, (activityMap.get(dateString) || 0) + 1);
      }
    }
    logger.trace("[DASH] Calculated entry counts and views.");

    activityData = Array.from(activityMap.entries())
      .map(([date, count]) => ({ x: date, y: count }))
      .sort((a, b) => new Date(a.x) - new Date(b.x));
    logger.trace(`[DASH] Processed ${activityData.length} days of activity data.`);

    const topViewedEntriesDocsCl = allEntries
      .filter((e) => e.type === "documentation" || e.type === "changelog")
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        title: e.title,
        views: e.views || 0,
        projectId: e.project,
        projectName: e.expand?.project?.name || `Project ID: ${e.project}`,
        type: e.type,
      }));
    logger.trace(`[DASH] Determined top ${topViewedEntriesDocsCl.length} viewed entries.`);

    const metrics = {
      totalProjects: totalProjects,
      totalEntries: totalEntriesDocsCl,
      publishedCount: publishedCountDocsCl,
      draftCount: draftCount,
      stagedCount: stagedCount,
      totalViews: totalViewsDocsCl,
      documentationCount: documentationCount,
      changelogCount: changelogCount,
      recentlyUpdatedProjects: recentlyUpdatedProjects,
      topViewedEntries: topViewedEntriesDocsCl,
      activityData: activityData,
    };

    logger.debug(`[DASH] Rendering global dashboard for user ${userId}.`);
    logger.timeEnd(`[DASH] GET / ${userId}`);
    res.render("index", {
      pageTitle: pageTitle,
      metrics: metrics,
      error: null,
    });
  } catch (error) {
    logger.timeEnd(`[DASH] GET / ${userId}`);
    logger.error(`[DASH] Error fetching global dashboard data for user ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    logAuditEvent(req, "DASHBOARD_LOAD_FAILURE", null, null, {
      error: error?.message,
    });
    res.render("index", {
      pageTitle: pageTitle,
      metrics: null,
      error: "Could not load dashboard data.",
    });
  }
});

export default router;
