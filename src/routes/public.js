import express from "express";
import { marked } from "marked";
import { pbAdmin, previewPasswordLimiter } from "../config.js";
import { getPublicEntryById, getDraftEntryForPreview, sanitizeHtml, hashPreviewPassword, logEntryView } from "../utils.js";

const router = express.Router();

router.get("/view/:id", async (req, res, next) => {
  const entryId = req.params.id;
  try {
    const entry = await getPublicEntryById(entryId);
    if (!entry) return next();
    logEntryView(req, entryId);
    const unsafeHtml = marked.parse(entry.content || "");
    const cleanHtml = sanitizeHtml(unsafeHtml);
    res.render("view", {
      entry: entry,
      contentHtml: cleanHtml,
      pageTitle: `${entry.title} - ${entry.type === "changelog" ? "Changelog" : "Documentation"}`,
    });
  } catch (error) {
    console.error(`Error processing public view for entry ${entryId}:`, error);
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

    const unsafeHtml = marked.parse(entry.content || "");
    const cleanHtml = sanitizeHtml(unsafeHtml);
    res.render("preview/view", {
      entry: entry,
      contentHtml: cleanHtml,
      pageTitle: `[PREVIEW] ${entry.title}`,
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

  if (!password) {
    return res.redirect(`/preview/${token}/password?error=Password is required`);
  }

  try {
    const previewRecord = await pbAdmin.collection("entries_previews").getFirstListItem(`token = '${token}' && expires_at > @now`);

    if (!previewRecord.password_hash) {
      return res.status(400).redirect(`/preview/${token}/password?error=Invalid request`);
    }

    const submittedHash = hashPreviewPassword(password);
    if (submittedHash === previewRecord.password_hash) {
      if (!req.session.validPreviews) req.session.validPreviews = {};
      req.session.validPreviews[token] = true;
      return res.redirect(`/preview/${token}`);
    }
    return res.redirect(`/preview/${token}/password?error=Incorrect password`);
  } catch (error) {
    if (error.status === 404) {
      return res.redirect(`/preview/${token}/password?error=Invalid or expired link`);
    }
    console.error(`Error processing password for token ${token}:`, error);
    next(error);
  }
});

export default router;
