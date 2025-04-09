import { pb, POCKETBASE_URL, NODE_ENV } from "./config.js";

export function requireLogin(req, res, next) {
  if (!req.session.user || !req.session.token) {
    req.session.returnTo = req.originalUrl;
    return res.redirect("/login");
  }

  try {
    pb.authStore.save(req.session.token, req.session.user);

    if (!pb.authStore.isValid) {
      console.warn("Session token loaded but invalid. Redirecting to login.");
      pb.authStore.clear();
      req.session.destroy(() => {
        res.clearCookie("pb_auth");
        return res.redirect("/login");
      });
      return;
    }
    next();
  } catch (loadError) {
    console.error("Error processing auth state from session:", loadError);
    pb.authStore.clear();
    req.session.destroy(() => {
      res.clearCookie("pb_auth");
      return res.redirect("/login");
    });
  }
}

export function setLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.pocketbaseUrl = POCKETBASE_URL;
  res.locals.theme = req.session.theme || "light";

  const protocol = req.protocol;
  const host = req.get("host");

  if (host) {
    res.locals.baseUrl = `${protocol}://${host}`;
  } else {
    console.warn("Host header not found in request. Falling back.");
    res.locals.baseUrl = `http://localhost:${PORT}`;
  }

  if (!req.session.validPreviews) {
    req.session.validPreviews = {};
  }
  next();
}

export function handle404(req, res, next) {
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
    console.error(`[${status}] Server Error: ${err.message}\n${err.stack || "(No stack trace)"}`);
  } else if (status !== 404) {
    console.warn(`[${status}] Client Error: ${err.message}`);
  }

  if (status === 404) {
    if (req.path.startsWith("/preview/")) {
      res.render("preview/invalid", {
        pageTitle: "Invalid Preview Link",
        message: res.locals.message || "This preview link appears to be invalid or has expired.",
      });
    } else {
      res.render("errors/404", { pageTitle: "Page Not Found (404)" });
    }
  } else if (status === 403) {
    res.render("errors/403", { pageTitle: "Access Denied (403)" });
  } else {
    res.render("errors/500", { pageTitle: `Server Error (${status})` });
  }
}
