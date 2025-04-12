import express from "express";
import authRouter from "./auth.js";
import publicRouter from "./public.js";
import entriesRouter from "./entries.js";
import templatesRouter from "./templates.js";
import headersRouter from "./headers.js";
import footersRouter from "./footers.js";
import apiRouter from "./api.js";

const router = express.Router();

router.use("/", publicRouter);
router.use("/", authRouter);
router.use("/", entriesRouter);
router.use("/templates", templatesRouter);
router.use("/headers", headersRouter);
router.use("/footers", footersRouter);

router.use("/api", apiRouter);

export default router;
