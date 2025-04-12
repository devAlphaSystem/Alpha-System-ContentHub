import express from "express";
import { marked } from "marked";
import { pbAdmin, previewPasswordLimiter } from "../config.js";
import { getPublicEntryById, getDraftEntryForPreview, sanitizeHtml, hashPreviewPassword, logEntryView, logAuditEvent, calculateReadingTime } from "../utils.js";

const router = express.Router();

router.get("/view/:id", async (req, res, next) => {
  const entryId = req.params.id;
  try {
    const entry = await getPublicEntryById(entryId);
    if (!entry) return next();
    logEntryView(req, entryId);

    const unsafeMainHtml = marked.parse(entry.content || "");
    const cleanMainHtml = sanitizeHtml(unsafeMainHtml);
    const readingTime = calculateReadingTime(entry.content);

    let customHeaderHtml = null;
    if (entry.expand?.custom_header?.content) {
      const unsafeHeaderHtml = marked.parse(entry.expand.custom_header.content);
      customHeaderHtml = sanitizeHtml(unsafeHeaderHtml);
    }

    let customFooterHtml = null;
    if (entry.expand?.custom_footer?.content) {
      const unsafeFooterHtml = marked.parse(entry.expand.custom_footer.content);
      customFooterHtml = sanitizeHtml(unsafeFooterHtml);
    }

    res.render("view", {
      entry: entry,
      contentHtml: cleanMainHtml,
      readingTime: readingTime,
      customHeaderHtml: customHeaderHtml,
      customFooterHtml: customFooterHtml,
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

    const unsafeMainHtml = marked.parse(entry.content || "");
    const cleanMainHtml = sanitizeHtml(unsafeMainHtml);
    const readingTime = calculateReadingTime(entry.content);

    const headerRecordToUse = entry.expand?.staged_custom_header || entry.expand?.custom_header;
    const footerRecordToUse = entry.expand?.staged_custom_footer || entry.expand?.custom_footer;

    let customHeaderHtml = null;
    if (headerRecordToUse?.content) {
      const unsafeHeaderHtml = marked.parse(headerRecordToUse.content);
      customHeaderHtml = sanitizeHtml(unsafeHeaderHtml);
    }

    let customFooterHtml = null;
    if (footerRecordToUse?.content) {
      const unsafeFooterHtml = marked.parse(footerRecordToUse.content);
      customFooterHtml = sanitizeHtml(unsafeFooterHtml);
    }

    res.render("preview/view", {
      entry: entry,
      contentHtml: cleanMainHtml,
      readingTime: readingTime,
      customHeaderHtml: customHeaderHtml,
      customFooterHtml: customFooterHtml,
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
      logAuditEvent(req, "PREVIEW_PASSWORD_FAILURE", "entries_previews", previewRecord?.id, { token: token, reason: "Invalid/expired link during password check" });
      return res.redirect(`/preview/${token}/password?error=Invalid or expired link`);
    }
    logAuditEvent(req, "PREVIEW_PASSWORD_FAILURE", "entries_previews", previewRecord?.id, { token: token, error: error?.message });
    console.error(`Error processing password for token ${token}:`, error);
    next(error);
  }
});

export default router;
