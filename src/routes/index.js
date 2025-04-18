import express from "express";
import authRouter from "./auth.js";
import publicRouter from "./public.js";
import dashboardRouter from "./dashboard.js";
import projectsRouter from "./projects.js";
import auditLogRouter from "./audit_log.js";
import apiRouter from "./api.js";
import searchRouter from "./search.js";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";

const router = express.Router();
logger.debug("Configuring main application routes.");

router.use("/", publicRouter);
logger.trace("Public routes configured.");
router.use("/", authRouter);
logger.trace("Auth routes configured.");

router.use("/", requireLogin, dashboardRouter);
logger.trace("Global dashboard routes configured (requires login).");
router.use("/projects", requireLogin, projectsRouter);
logger.trace("Project routes configured (requires login).");
router.use("/audit-log", requireLogin, auditLogRouter);
logger.trace("Global audit log routes configured (requires login).");
router.use("/search", requireLogin, searchRouter);
logger.trace("Search routes configured (requires login).");
router.use("/api", apiRouter);
logger.trace("API routes configured.");

logger.debug("Main application routes configuration complete.");
export default router;
