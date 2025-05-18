import express from "express";
import authRouter from "./auth.js";
import publicRouter from "./public.js";
import dashboardRouter from "./dashboard.js";
import projectsRouter from "./projects.js";
import auditLogRouter from "./audit_log.js";
import settingsRouter from "./settings.js";
import apiRouter from "./api.js";
import searchRouter from "./search.js";
import filesRouter from "./files.js";
import headersRouter from "./headers.js";
import footersRouter from "./footers.js";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";

const router = express.Router();
logger.debug("Configuring main application routes.");

router.use("/", publicRouter);
logger.trace("Public routes configured.");
router.use("/", authRouter);
logger.trace("Auth routes configured.");

router.use("/", dashboardRouter);
logger.trace("Global dashboard routes configured (requires login).");

router.use("/projects", projectsRouter);
logger.trace("Project routes configured (requires login).");

router.use("/headers", requireLogin, headersRouter);
logger.trace("Global headers routes configured.");
router.use("/footers", requireLogin, footersRouter);
logger.trace("Global footers routes configured.");

router.use("/files", requireLogin, filesRouter);
logger.trace("Files routes configured (requires login).");
router.use("/audit-log", requireLogin, auditLogRouter);
logger.trace("Global audit log routes configured (requires login).");
router.use("/settings", requireLogin, settingsRouter);
logger.trace("Settings routes configured (requires login).");
router.use("/search", requireLogin, searchRouter);
logger.trace("Search routes configured (requires login).");
router.use("/api", apiRouter);
logger.trace("API routes configured.");

logger.debug("Main application routes configuration complete.");
export default router;
