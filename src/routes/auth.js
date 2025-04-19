import express from "express";
import { pb, loginLimiter, NODE_ENV } from "../config.js";
import { logAuditEvent } from "../utils.js";
import { logger } from "../logger.js";

const router = express.Router();

router.get("/login", (req, res) => {
  logger.debug("GET /login route accessed.");
  if (req.session.user) {
    logger.debug("User already logged in, redirecting from /login to /");
    return res.redirect("/");
  }
  res.render("login", {
    error: null,
    pageTitle: "Login",
  });
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  logger.info(`POST /login attempt for email: ${email}`);

  if (!email || !password) {
    logger.warn("Login attempt failed: Email or password missing.");
    return res.status(400).render("login", {
      error: "Email and password are required.",
      pageTitle: "Login",
    });
  }

  try {
    logger.time(`[AUTH] pb.authWithPassword ${email}`);
    const authData = await pb.collection("users").authWithPassword(email, password);
    logger.timeEnd(`[AUTH] pb.authWithPassword ${email}`);
    logger.info(`User ${email} successfully authenticated.`);

    req.session.regenerate((err) => {
      if (err) {
        logger.error(`Session regeneration failed for ${email}: ${err.message}`);
        pb.authStore.clear();
        logAuditEvent(req, "LOGIN_FAILURE", "users", null, {
          email: email,
          reason: "Session regeneration failed",
          error: err?.message,
        });
        return res.status(500).render("login", {
          error: "Login failed due to a server issue. Please try again.",
          pageTitle: "Login",
        });
      }

      req.session.user = authData.record;
      req.session.token = authData.token;
      logger.debug(`Session regenerated and populated for user ${authData.record.id}`);

      const cookie = pb.authStore.exportToCookie({
        secure: NODE_ENV === "production",
        httpOnly: true,
        sameSite: "Lax",
      });
      res.setHeader("Set-Cookie", cookie);
      logger.trace("Auth cookie set in response header.");

      logAuditEvent(req, "LOGIN_SUCCESS", "users", authData.record.id, {
        email: email,
      });

      const returnTo = req.session.returnTo || "/";
      logger.debug(`Redirecting user ${authData.record.id} to ${returnTo}`);
      req.session.returnTo = undefined;
      res.redirect(returnTo);
    });
  } catch (error) {
    logger.timeEnd(`[AUTH] pb.authWithPassword ${email}`);
    logger.warn(`Login failed for email ${email}: Status ${error.status || "N/A"} - ${error.message}`);
    let errorMessage = "Login failed. Please check your credentials.";
    if (error.status === 400) {
      errorMessage = "Invalid email or password.";
    }
    logAuditEvent(req, "LOGIN_FAILURE", "users", null, {
      email: email,
      reason: errorMessage,
      status: error.status,
    });
    res.clearCookie("pb_auth");
    res.status(401).render("login", {
      error: errorMessage,
      pageTitle: "Login",
    });
  }
});

router.get("/logout", (req, res, next) => {
  const userId = req.session?.user?.id;
  logger.info(`GET /logout requested by user ${userId || "Unknown"}`);
  pb.authStore.clear();
  res.clearCookie("pb_auth");

  req.session.destroy((err) => {
    if (err) {
      logger.error(`Error destroying session for user ${userId}: ${err.message}`);
      logAuditEvent(req, "LOGOUT_FAILURE", "users", userId, {
        error: err?.message,
      });
      return res.redirect("/login");
    }
    logger.info(`User ${userId} logged out successfully.`);
    logAuditEvent(req, "LOGOUT_SUCCESS", "users", userId);
    res.redirect("/login");
  });
});

export default router;
