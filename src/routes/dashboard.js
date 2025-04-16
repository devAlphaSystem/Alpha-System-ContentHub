import express from "express";
import { pb, pbAdmin } from "../config.js";
import { requireLogin } from "../middleware.js";
import { logAuditEvent } from "../utils.js";

const router = express.Router();

router.get("/", requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const pageTitle = "Dashboard";

  try {
    const projectsResult = await pb.collection("projects").getFullList({
      filter: `owner = '${userId}'`,
      sort: "-updated",
      fields: "id, name, updated",
      $autoCancel: false,
    });
    const totalProjects = projectsResult.length;
    const recentlyUpdatedProjects = projectsResult.slice(0, 5).map((p) => ({
      ...p,
      formattedUpdated: new Date(p.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    const allEntries = await pb.collection("entries_main").getFullList({
      filter: `owner = '${userId}'`,
      fields: "id, status, has_staged_changes, views, title, project, type, created",
      sort: "-views",
      expand: "project",
      $autoCancel: false,
    });

    let totalEntries = 0;
    let publishedCount = 0;
    let draftCount = 0;
    let stagedCount = 0;
    let totalViews = 0;
    let documentationCount = 0;
    let changelogCount = 0;
    let activityData = [];
    const activityMap = new Map();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    for (const entry of allEntries) {
      totalEntries++;
      totalViews += entry.views || 0;

      if (entry.status === "published") {
        publishedCount++;
        if (entry.has_staged_changes) {
          stagedCount++;
        }
      } else if (entry.status === "draft") {
        draftCount++;
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

    activityData = Array.from(activityMap.entries())
      .map(([date, count]) => ({ x: date, y: count }))
      .sort((a, b) => new Date(a.x) - new Date(b.x));

    const topViewedEntries = allEntries.slice(0, 5).map((e) => ({
      id: e.id,
      title: e.title,
      views: e.views || 0,
      projectId: e.project,
      projectName: e.expand?.project?.name || `Project ID: ${e.project}`,
      type: e.type,
    }));

    const metrics = {
      totalProjects: totalProjects,
      totalEntries: totalEntries,
      publishedCount: publishedCount,
      draftCount: draftCount,
      stagedCount: stagedCount,
      totalViews: totalViews,
      documentationCount: documentationCount,
      changelogCount: changelogCount,
      recentlyUpdatedProjects: recentlyUpdatedProjects,
      topViewedEntries: topViewedEntries,
      activityData: activityData,
    };

    res.render("index", {
      pageTitle: pageTitle,
      metrics: metrics,
      error: null,
    });
  } catch (error) {
    console.error("Error fetching global dashboard data:", error);
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
