import express from "express";
import { requireLogin } from "../middleware.js";
import { logger } from "../logger.js";

import indexProjectRouter from "./projects/index.js";
import projectRouter from "./projects/project.js";
import entriesRouter from "./projects/entries.js";
import archivedRouter from "./projects/archived.js";
import templatesRouter from "./projects/templates.js";
import assetsRouter from "./projects/assets.js";
import sidebarRouter from "./projects/sidebar.js";

const router = express.Router();

logger.debug("Configuring project routes.");

router.use("/", requireLogin, indexProjectRouter);
logger.trace("Index project routes configured.");

router.use("/", requireLogin, projectRouter);
logger.trace("Specific project routes configured.");

router.use("/", requireLogin, entriesRouter);
logger.trace("Project entries routes configured.");

router.use("/", requireLogin, archivedRouter);
logger.trace("Project archived entries routes configured.");

router.use("/", requireLogin, templatesRouter);
logger.trace("Project templates routes configured.");

router.use("/", requireLogin, assetsRouter);
logger.trace("Project assets routes configured.");

router.use("/", requireLogin, sidebarRouter);
logger.trace("Project sidebar routes configured.");

logger.debug("Project routes configuration complete.");

export default router;
