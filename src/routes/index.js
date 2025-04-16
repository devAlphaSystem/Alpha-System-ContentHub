import express from "express";
import authRouter from "./auth.js";
import publicRouter from "./public.js";
import dashboardRouter from "./dashboard.js";
import projectsRouter from "./projects.js";
import auditLogRouter from "./audit_log.js";
import apiRouter from "./api.js";
import { requireLogin } from "../middleware.js";

const router = express.Router();

router.use("/", publicRouter);
router.use("/", authRouter);

router.use("/", requireLogin, dashboardRouter);
router.use("/projects", requireLogin, projectsRouter);
router.use("/audit-log", requireLogin, auditLogRouter);

router.use("/api", apiRouter);

export default router;
