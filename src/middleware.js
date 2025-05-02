import { pb, POCKETBASE_URL, NODE_ENV, PORT, getSettings } from "./config.js";
import { logAuditEvent } from "./utils.js";
import { logger } from "./logger.js";

export function requireAdmin(req, res, next) {
  logger.trace(`requireAdmin middleware check for path: ${req.originalUrl}`);
  if (!req.session.user || req.session.user.isAdmin !== true) {
    logger.warn(`Admin access denied for user ${req.session.user?.id || "Unknown"} to path: ${req.originalUrl}. isAdmin flag: ${req.session.user?.isAdmin ?? "Not set/Not logged in"}`);
    logAuditEvent(req, "ADMIN_ACCESS_DENIED", null, null, { path: req.originalUrl });

    if (req.originalUrl.startsWith("/api/")) {
      return res.status(403).json({ error: "Forbidden: Administrator access required." });
    }
    const err = new Error("Forbidden: Administrator access required.");
    err.status = 403;
    return next(err);
  }

  logger.trace(`requireAdmin: Admin access granted for user ${req.session.user.id}. Proceeding.`);
  next();
}

export function requireLogin(req, res, next) {
  logger.trace(`requireLogin middleware check for path: ${req.originalUrl}`);
  if (!req.session.user || !req.session.token) {
    logger.debug(`requireLogin: No user/token in session. Redirecting to login. Path: ${req.originalUrl}`);
    req.session.returnTo = req.originalUrl;
    return res.redirect("/login");
  }

  try {
    pb.authStore.save(req.session.token, req.session.user);

    if (!pb.authStore.isValid) {
      logger.warn(`requireLogin: Session token loaded but invalid for user ${req.session.user.id}. Redirecting to login.`);
      pb.authStore.clear();
      req.session.destroy((err) => {
        if (err) {
          logger.error(`requireLogin: Error destroying session after invalid token: ${err.message}`);
        }
        res.clearCookie("pb_auth");
        return res.redirect("/login");
      });
      return;
    }
    logger.trace(`requireLogin: Session token valid for user ${req.session.user.id}. Proceeding.`);
    next();
  } catch (loadError) {
    logger.error(`requireLogin: Error processing auth state from session for user ${req.session.user?.id}: ${loadError.message}`);
    pb.authStore.clear();
    req.session.destroy((err) => {
      if (err) {
        logger.error(`requireLogin: Error destroying session after load error: ${err.message}`);
      }
      res.clearCookie("pb_auth");
      return res.redirect("/login");
    });
  }
}

export function setLocals(req, res, next) {
  logger.trace(`setLocals middleware for path: ${req.path}`);
  const settings = getSettings();
  res.locals.user = req.session.user || null;
  res.locals.pocketbaseUrl = POCKETBASE_URL;
  res.locals.theme = req.session.theme || "light";
  res.locals.currentPath = req.path;
  res.locals.appVersion = req.app.locals.appVersion;
  res.locals.enableAuditLog = settings.enableAuditLog;
  res.locals.enableGlobalSearch = settings.enableGlobalSearch;

  const protocol = req.protocol;
  const host = req.get("host");

  if (host) {
    res.locals.baseUrl = `${protocol}://${host}`;
  } else {
    logger.warn("Host header not found in request. Falling back to localhost.");
    res.locals.baseUrl = `http://localhost:${PORT}`;
  }

  if (!req.session.validPreviews) {
    req.session.validPreviews = {};
  }
  if (!req.session.validProjectPasswords) {
    req.session.validProjectPasswords = {};
  }
  logger.trace("setLocals finished.");
  next();
}

export function handle404(req, res, next) {
  logger.debug(`handle404 triggered for path: ${req.originalUrl}`);
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
}

export function handleErrors(err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = NODE_ENV !== "production" ? err : {};

  const status = err.status || 500;
  res.status(status);

  if (status >= 500) {
    logger.error(`[${status}] Server Error: ${err.message}\nPath: ${req.originalUrl}\nStack: ${err.stack || "(No stack trace)"}`);
  } else if (status !== 404) {
    logger.warn(`[${status}] Client Error: ${err.message} Path: ${req.originalUrl}`);
  } else {
    logger.debug(`[404] Not Found: Path: ${req.originalUrl}`);
  }

  const defaultTitle = status === 404 ? "Page Not Found (404)" : status === 403 ? "Access Denied (403)" : `Server Error (${status})`;
  res.locals.pageTitle = res.locals.pageTitle || defaultTitle;

  if (status === 404) {
    if (req.path.startsWith("/preview/")) {
      logger.debug(`Rendering 404 as preview/invalid for path: ${req.path}`);
      res.render("preview/invalid", {
        pageTitle: "Invalid Preview Link",
        message: res.locals.message || "This preview link appears to be invalid or has expired.",
      });
    } else {
      logger.debug(`Rendering 404 as errors/404 for path: ${req.path}`);
      res.render("errors/404");
    }
  } else if (status === 403) {
    logger.debug(`Rendering 403 as errors/403 for path: ${req.path}`);
    res.render("errors/403");
  } else {
    logger.debug(`Rendering 500 as errors/500 for path: ${req.path}`);
    res.render("errors/500");
  }
}
