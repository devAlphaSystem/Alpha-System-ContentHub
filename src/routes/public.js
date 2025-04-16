import express from "express";
import { marked } from "marked";
import { pbAdmin, previewPasswordLimiter, apiLimiter } from "../config.js";
import { getPublicEntryById, getDraftEntryForPreview, sanitizeHtml, hashPreviewPassword, logEntryView, logAuditEvent, calculateReadingTime } from "../utils.js";

const router = express.Router();

const customRenderer = new marked.Renderer();
const originalCodeRenderer = customRenderer.code;
customRenderer.code = function (code, language, isEscaped) {
  if (language === "mermaid") {
    return `<pre class="language-mermaid">${code}</pre>`;
  }
  return originalCodeRenderer.call(this, code, language, isEscaped);
};
function parseMarkdownWithMermaid(markdownContent) {
  if (!markdownContent) {
    return "";
  }
  const unsafeHtml = marked.parse(markdownContent, { renderer: customRenderer });
  return sanitizeHtml(unsafeHtml);
}

router.get("/project-access/:projectId/password", async (req, res, next) => {
  const projectId = req.params.projectId;
  const returnTo = req.query.returnTo || `/projects/${projectId}`;
  try {
    const project = await pbAdmin.collection("projects").getOne(projectId, { fields: "id, name" });
    res.render("projects/project_password", {
      pageTitle: `Password Required - ${project.name}`,
      projectId: projectId,
      projectName: project.name,
      error: req.query.error,
      returnTo: returnTo,
    });
  } catch (error) {
    if (error.status === 404) {
      return next();
    }
    console.error(`Error loading project password page for ${projectId}:`, error);
    next(error);
  }
});

router.post("/project-access/:projectId/password", apiLimiter, async (req, res, next) => {
  const projectId = req.params.projectId;
  const { password, returnTo } = req.body;

  if (!password) {
    const redirectQuery = returnTo ? `?error=Password is required&returnTo=${encodeURIComponent(returnTo)}` : "?error=Password is required";
    return res.redirect(`/project-access/${projectId}/password${redirectQuery}`);
  }

  try {
    const project = await pbAdmin.collection("projects").getOne(projectId, {
      fields: "id, name, password_protected, access_password_hash",
    });

    if (!project.password_protected || !project.access_password_hash) {
      logAuditEvent(req, "PROJECT_PASSWORD_FAILURE", "projects", projectId, {
        reason: "Password check attempted but not required",
      });
      const redirectQuery = returnTo ? `?error=Password not required&returnTo=${encodeURIComponent(returnTo)}` : "?error=Password not required";
      return res.redirect(`/project-access/${projectId}/password${redirectQuery}`);
    }

    const submittedHash = hashPreviewPassword(password);

    if (submittedHash === project.access_password_hash) {
      if (!req.session.validProjectPasswords) {
        req.session.validProjectPasswords = {};
      }
      req.session.validProjectPasswords[projectId] = true;
      logAuditEvent(req, "PROJECT_PASSWORD_SUCCESS", "projects", projectId, {
        name: project.name,
      });

      const redirectUrl = returnTo?.startsWith("/") ? returnTo : `/projects/${projectId}`;
      return res.redirect(redirectUrl);
    }
    logAuditEvent(req, "PROJECT_PASSWORD_FAILURE", "projects", projectId, {
      name: project.name,
      reason: "Incorrect password",
    });
    const redirectQuery = returnTo ? `?error=Incorrect password&returnTo=${encodeURIComponent(returnTo)}` : "?error=Incorrect password";
    return res.redirect(`/project-access/${projectId}/password${redirectQuery}`);
  } catch (error) {
    const redirectQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
    if (error.status === 404) {
      logAuditEvent(req, "PROJECT_PASSWORD_FAILURE", "projects", projectId, {
        reason: "Project not found during password check",
      });
      return res.redirect(`/project-access/${projectId}/password${redirectQuery ? `${redirectQuery}&` : "?"}error=Project not found`);
    }
    logAuditEvent(req, "PROJECT_PASSWORD_FAILURE", "projects", projectId, {
      error: error?.message,
    });
    console.error(`Error processing project password for ${projectId}:`, error);
    next(error);
  }
});

router.get("/view/:id", async (req, res, next) => {
  const entryId = req.params.id;
  try {
    const entry = await getPublicEntryById(entryId);
    if (!entry) return next();

    if (entry.type === "roadmap") {
      if (entry.project) {
        return res.redirect(`/roadmap/${entry.project}`);
      }
      console.warn(`Roadmap entry ${entryId} has no associated project.`);
      return next();
    }
    if (entry.type === "knowledge_base") {
      if (entry.project) {
        return res.redirect(`/kb/${entry.project}`);
      }
      console.warn(`Knowledge Base entry ${entryId} has no associated project.`);
      return next();
    }

    const project = entry.expand?.project;

    if (!project || !project.is_publicly_viewable) {
      logAuditEvent(req, "PUBLIC_VIEW_DENIED", "projects", project?.id, {
        entryId: entryId,
        reason: "Project not public",
      });
      return next();
    }

    if (project.password_protected) {
      if (!req.session.validProjectPasswords || !req.session.validProjectPasswords[project.id]) {
        logAuditEvent(req, "PROJECT_PASSWORD_REQUIRED", "projects", project.id, {
          entryId: entryId,
        });
        const returnToUrl = req.originalUrl;
        return res.redirect(`/project-access/${project.id}/password?returnTo=${encodeURIComponent(returnToUrl)}`);
      }
    }

    logEntryView(req, entryId);

    const cleanMainHtml = parseMarkdownWithMermaid(entry.content);
    const readingTime = calculateReadingTime(entry.content);

    let customHeaderHtml = null;
    let customFooterHtml = null;

    if (entry.type === "documentation") {
      if (entry.expand?.custom_documentation_header?.content) {
        customHeaderHtml = parseMarkdownWithMermaid(entry.expand.custom_documentation_header.content);
      }
      if (entry.expand?.custom_documentation_footer?.content) {
        customFooterHtml = parseMarkdownWithMermaid(entry.expand.custom_documentation_footer.content);
      }
    } else if (entry.type === "changelog") {
      if (entry.expand?.custom_changelog_header?.content) {
        customHeaderHtml = parseMarkdownWithMermaid(entry.expand.custom_changelog_header.content);
      }
      if (entry.expand?.custom_changelog_footer?.content) {
        customFooterHtml = parseMarkdownWithMermaid(entry.expand.custom_changelog_footer.content);
      }
    }

    let sidebarEntries = [];
    if (project) {
      try {
        sidebarEntries = await pbAdmin.collection("entries_main").getFullList({
          filter: `project = '${project.id}' && status = 'published' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
          sort: "+sidebar_order,+title",
          fields: "id, title, type",
          $autoCancel: false,
        });
      } catch (sidebarError) {
        console.error(`Failed to fetch sidebar entries for project ${project.id}:`, sidebarError);
      }
    }

    res.render("view", {
      entry: entry,
      project: project,
      sidebarEntries: sidebarEntries,
      contentHtml: cleanMainHtml,
      readingTime: readingTime,
      customHeaderHtml: customHeaderHtml,
      customFooterHtml: customFooterHtml,
      pageTitle: `${entry.title} - ${project ? project.name : entry.type === "changelog" ? "Changelog" : "Documentation"}`,
    });
  } catch (error) {
    console.error(`Error processing public view for entry ${entryId}:`, error);
    next(error);
  }
});

router.get("/roadmap/:projectId", async (req, res, next) => {
  const projectId = req.params.projectId;
  try {
    const project = await pbAdmin.collection("projects").getOne(projectId, {
      fields: "id, name, is_publicly_viewable, password_protected, access_password_hash, roadmap_enabled",
    });

    if (!project || !project.is_publicly_viewable || !project.roadmap_enabled) {
      logAuditEvent(req, "ROADMAP_VIEW_DENIED", "projects", projectId, {
        reason: !project ? "Project not found" : !project.is_publicly_viewable ? "Project not public" : "Roadmap disabled",
      });
      return next();
    }

    if (project.password_protected) {
      if (!req.session.validProjectPasswords || !req.session.validProjectPasswords[project.id]) {
        logAuditEvent(req, "PROJECT_PASSWORD_REQUIRED", "projects", projectId, {
          target: "Roadmap View",
        });
        const returnToUrl = req.originalUrl;
        return res.redirect(`/project-access/${project.id}/password?returnTo=${encodeURIComponent(returnToUrl)}`);
      }
    }

    const roadmapEntries = await pbAdmin.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && type = 'roadmap' && status = 'published'`,
      sort: "+created",
      fields: "id, title, content, tags, roadmap_stage",
      $autoCancel: false,
    });

    const stages = ["Planned", "Next Up", "In Progress", "Done"];
    const entriesByStage = stages.reduce((acc, stage) => {
      acc[stage] = [];
      return acc;
    }, {});

    for (const entry of roadmapEntries) {
      const stage = entry.roadmap_stage;
      if (entriesByStage[stage]) {
        entriesByStage[stage].push({
          id: entry.id,
          title: entry.title,
          tags: entry.tags
            ? entry.tags
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t)
            : [],
        });
      } else {
        console.warn(`Roadmap item ${entry.id} has unknown stage: ${stage}`);
        if (!entriesByStage.Uncategorized) entriesByStage.Uncategorized = [];
        entriesByStage.Uncategorized.push({
          id: entry.id,
          title: entry.title,
          tags: entry.tags
            ? entry.tags
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t)
            : [],
        });
      }
    }

    let sidebarEntries = [];
    try {
      sidebarEntries = await pbAdmin.collection("entries_main").getFullList({
        filter: `project = '${project.id}' && status = 'published' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
        sort: "+sidebar_order,+title",
        fields: "id, title, type",
        $autoCancel: false,
      });
    } catch (sidebarError) {
      console.error(`Failed to fetch sidebar entries for project ${project.id}:`, sidebarError);
    }

    res.render("roadmap", {
      pageTitle: `Roadmap - ${project.name}`,
      project: project,
      stages: stages,
      entriesByStage: entriesByStage,
      sidebarEntries: sidebarEntries,
    });
  } catch (error) {
    if (error.status === 404) {
      return next();
    }
    console.error(`Error processing public roadmap for project ${projectId}:`, error);
    next(error);
  }
});

router.get("/preview/:token/password", (req, res) => {
  const token = req.params.token;
  res.render("preview/password", {
    pageTitle: "Enter Password",
    token: token,
    error: req.query.error,
  });
});

router.get("/preview/:token", async (req, res, next) => {
  const token = req.params.token;
  try {
    const previewRecord = await pbAdmin.collection("entries_previews").getFirstListItem(`token = '${token}' && expires_at > @now`);

    if (previewRecord.password_hash) {
      if (!req.session.validPreviews || !req.session.validPreviews[token]) {
        return res.redirect(`/preview/${token}/password`);
      }
    }

    const entry = await getDraftEntryForPreview(previewRecord.entry);
    if (!entry) {
      return res.status(404).render("preview/invalid", {
        pageTitle: "Preview Unavailable",
        message: "The content associated with this preview link could not be found.",
      });
    }

    const entryType = entry.has_staged_changes ? entry.staged_type ?? entry.type : entry.type;
    const entryContent = entry.has_staged_changes ? entry.staged_content ?? entry.content : entry.content;
    const entryTitle = entry.has_staged_changes ? entry.staged_title ?? entry.title : entry.title;
    const entryTags = entry.has_staged_changes ? entry.staged_tags ?? entry.tags : entry.tags;

    const cleanMainHtml = parseMarkdownWithMermaid(entryContent);
    const readingTime = calculateReadingTime(entryContent);

    let headerRecordToUse = null;
    let footerRecordToUse = null;

    if (entryType === "documentation") {
      headerRecordToUse = entry.has_staged_changes ? entry.expand?.staged_documentation_header ?? entry.expand?.custom_documentation_header : entry.expand?.custom_documentation_header;
      footerRecordToUse = entry.has_staged_changes ? entry.expand?.staged_documentation_footer ?? entry.expand?.custom_documentation_footer : entry.expand?.custom_documentation_footer;
    } else if (entryType === "changelog") {
      headerRecordToUse = entry.has_staged_changes ? entry.expand?.staged_changelog_header ?? entry.expand?.custom_changelog_header : entry.expand?.custom_changelog_header;
      footerRecordToUse = entry.has_staged_changes ? entry.expand?.staged_changelog_footer ?? entry.expand?.custom_changelog_footer : entry.expand?.custom_changelog_footer;
    }

    let customHeaderHtml = null;
    if (headerRecordToUse?.content) {
      customHeaderHtml = parseMarkdownWithMermaid(headerRecordToUse.content);
    }

    let customFooterHtml = null;
    if (footerRecordToUse?.content) {
      customFooterHtml = parseMarkdownWithMermaid(footerRecordToUse.content);
    }

    let project = null;
    let sidebarEntries = [];
    if (entry.project && entry.expand?.project) {
      project = entry.expand.project;
      try {
        sidebarEntries = await pbAdmin.collection("entries_main").getFullList({
          filter: `project = '${entry.project}' && show_in_project_sidebar = true && (status = 'published' || status = 'draft') && type != 'roadmap' && type != 'knowledge_base'`,
          sort: "+sidebar_order,+title",
          fields: "id, title, type, status",
          $autoCancel: false,
        });
      } catch (sidebarError) {
        console.error(`Failed to fetch sidebar entries for preview project ${entry.project}:`, sidebarError);
      }
    }

    const entryForView = {
      ...entry,
      title: entryTitle,
      type: entryType,
      tags: entryTags,
    };

    res.render("preview/view", {
      entry: entryForView,
      project: project,
      sidebarEntries: sidebarEntries,
      contentHtml: cleanMainHtml,
      readingTime: readingTime,
      customHeaderHtml: customHeaderHtml,
      customFooterHtml: customFooterHtml,
      pageTitle: `[PREVIEW] ${entryTitle}`,
      isPreview: true,
    });
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).render("preview/invalid", {
        pageTitle: "Invalid Preview Link",
        message: "This preview link is either invalid or has expired.",
      });
    }
    console.error(`Error processing preview for token ${token}:`, error);
    next(error);
  }
});

router.post("/preview/:token", previewPasswordLimiter, async (req, res, next) => {
  const token = req.params.token;
  const { password } = req.body;
  let previewRecord;

  if (!password) {
    return res.redirect(`/preview/${token}/password?error=Password is required`);
  }

  try {
    previewRecord = await pbAdmin.collection("entries_previews").getFirstListItem(`token = '${token}' && expires_at > @now`);

    if (!previewRecord.password_hash) {
      logAuditEvent(req, "PREVIEW_PASSWORD_FAILURE", "entries_previews", previewRecord?.id, { token: token, reason: "No password hash set on token" });
      return res.status(400).redirect(`/preview/${token}/password?error=Invalid request`);
    }

    const submittedHash = hashPreviewPassword(password);
    if (submittedHash === previewRecord.password_hash) {
      if (!req.session.validPreviews) {
        req.session.validPreviews = {};
      }
      req.session.validPreviews[token] = true;
      logAuditEvent(req, "PREVIEW_PASSWORD_SUCCESS", "entries_previews", previewRecord.id, { token: token, entryId: previewRecord.entry });
      return res.redirect(`/preview/${token}`);
    }
    logAuditEvent(req, "PREVIEW_PASSWORD_FAILURE", "entries_previews", previewRecord.id, { token: token, reason: "Incorrect password submitted" });
    return res.redirect(`/preview/${token}/password?error=Incorrect password`);
  } catch (error) {
    if (error.status === 404) {
      logAuditEvent(req, "PREVIEW_PASSWORD_FAILURE", "entries_previews", previewRecord?.id, {
        token: token,
        reason: "Invalid/expired link during password check",
      });
      return res.redirect(`/preview/${token}/password?error=Invalid or expired link`);
    }
    logAuditEvent(req, "PREVIEW_PASSWORD_FAILURE", "entries_previews", previewRecord?.id, { token: token, error: error?.message });
    console.error(`Error processing password for token ${token}:`, error);
    next(error);
  }
});

router.get("/kb/:projectId", async (req, res, next) => {
  const projectId = req.params.projectId;
  try {
    const project = await pbAdmin.collection("projects").getOne(projectId, {
      fields: "id, name, is_publicly_viewable, password_protected, access_password_hash",
    });

    if (!project || !project.is_publicly_viewable) {
      logAuditEvent(req, "KB_VIEW_DENIED", "projects", projectId, {
        reason: !project ? "Project not found" : "Project not public",
      });
      return next();
    }

    if (project.password_protected) {
      if (!req.session.validProjectPasswords || !req.session.validProjectPasswords[project.id]) {
        logAuditEvent(req, "PROJECT_PASSWORD_REQUIRED", "projects", projectId, {
          target: "Knowledge Base View",
        });
        const returnToUrl = req.originalUrl;
        return res.redirect(`/project-access/${project.id}/password?returnTo=${encodeURIComponent(returnToUrl)}`);
      }
    }

    const kbEntriesRaw = await pbAdmin.collection("entries_main").getFullList({
      filter: `project = '${projectId}' && type = 'knowledge_base' && status = 'published'`,
      sort: "+title",
      fields: "id, title, content, tags",
      $autoCancel: false,
    });

    if (!kbEntriesRaw || kbEntriesRaw.length === 0) {
      logAuditEvent(req, "KB_VIEW_DENIED", "projects", projectId, {
        reason: "No published KB entries found",
      });
      return next();
    }

    const kbEntries = kbEntriesRaw.map((entry) => ({
      id: entry.id,
      question: entry.title,
      answerHtml: parseMarkdownWithMermaid(entry.content),
      tags: entry.tags
        ? entry.tags
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t)
        : [],
    }));

    let sidebarEntries = [];
    try {
      sidebarEntries = await pbAdmin.collection("entries_main").getFullList({
        filter: `project = '${project.id}' && status = 'published' && show_in_project_sidebar = true && type != 'roadmap' && type != 'knowledge_base'`,
        sort: "+sidebar_order,+title",
        fields: "id, title, type",
        $autoCancel: false,
      });
    } catch (sidebarError) {
      console.error(`Failed to fetch sidebar entries for project ${project.id}:`, sidebarError);
    }

    res.render("knowledge", {
      pageTitle: `Knowledge Base - ${project.name}`,
      project: project,
      kbEntries: kbEntries,
      sidebarEntries: sidebarEntries,
    });
  } catch (error) {
    if (error.status === 404) {
      return next();
    }
    console.error(`Error processing public knowledge base for project ${projectId}:`, error);
    next(error);
  }
});

export default router;
