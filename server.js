import "dotenv/config";
import express from "express";
import path from "node:path";
import PocketBase from "pocketbase";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import fs from "node:fs";
import sqlite3 from "sqlite3";
import crypto from "node:crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// =============================================================================
// ENVIRONMENT VARIABLE CHECK
// =============================================================================
if (!process.env.SESSION_SECRET || !process.env.IP_HASH_SALT || !process.env.POCKETBASE_ADMIN_EMAIL || !process.env.POCKETBASE_ADMIN_PASSWORD || !process.env.POCKETBASE_URL) {
  console.error("FATAL ERROR: SESSION_SECRET, IP_HASH_SALT, POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD, and POCKETBASE_URL must be defined in .env");
  process.exit(1);
}

// =============================================================================
// CONSTANTS & APP SETUP
// =============================================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

// =============================================================================
// POCKETBASE SETUP
// =============================================================================
const pb = new PocketBase(process.env.POCKETBASE_URL);
const pbAdmin = new PocketBase(process.env.POCKETBASE_URL);

(async () => {
  try {
    await pbAdmin.admins.authWithPassword(process.env.POCKETBASE_ADMIN_EMAIL, process.env.POCKETBASE_ADMIN_PASSWORD);
    console.log("PocketBase Admin client authenticated successfully.");
  } catch (adminAuthError) {
    console.error("FATAL ERROR: PocketBase Admin authentication failed:", adminAuthError);
    process.exit(1);
  }
})();

// =============================================================================
// DATABASE SETUP (Session & View Tracking)
// =============================================================================
const dbDir = path.join(__dirname, "db");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const SQLiteStore = connectSqlite3(session);
const sessionStore = new SQLiteStore({ db: "sessions.db", dir: dbDir });

const viewDbPath = path.join(dbDir, "view_tracking.db");
const viewDb = new sqlite3.Database(viewDbPath, (err) => {
  if (err) {
    console.error("Error opening view tracking database:", err.message);
  } else {
    viewDb.run("CREATE TABLE IF NOT EXISTS view_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, ip_address TEXT NOT NULL, viewed_at INTEGER NOT NULL)", (err) => {
      if (err) console.error("Error creating view_logs table:", err.message);
      else {
        viewDb.run("CREATE INDEX IF NOT EXISTS idx_view_logs_entry_ip_time ON view_logs (entry_id, ip_address, viewed_at)", (indexErr) => {
          if (indexErr) console.error("Error creating index:", indexErr.message);
        });
      }
    });
  }
});

// =============================================================================
// EXPRESS APP CONFIGURATION
// =============================================================================
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// =============================================================================
// MIDDLEWARE
// =============================================================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", process.env.POCKETBASE_URL],
        connectSrc: ["'self'", process.env.POCKETBASE_URL],
        formAction: ["'self'"],
      },
    },
  }),
);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.pocketbaseUrl = process.env.POCKETBASE_URL;
  res.locals.theme = req.session.theme || "light";
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function getIP(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    const ips = forwarded.split(",");
    return ips[0].trim();
  }

  return req.ip || req.socket?.remoteAddress;
}

function hashIP(ip, salt) {
  if (!ip || !salt) return null;

  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

async function getPublicEntryById(id) {
  const tempPb = new PocketBase(process.env.POCKETBASE_URL);
  tempPb.authStore.clear();

  try {
    const record = await tempPb.collection("entries").getOne(id);

    if (record && record.status === "published") {
      return record;
    }

    return null;
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to fetch public entry ${id}:`, error);
    }

    return null;
  }
}

function requireLogin(req, res, next) {
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

// =============================================================================
// ROUTE DEFINITIONS
// =============================================================================

// --- Public Routes ---
app.get("/view/:id", async (req, res, next) => {
  const entryId = req.params.id;
  const ipAddress = getIP(req);
  const hashedIP = hashIP(ipAddress, process.env.IP_HASH_SALT);

  try {
    const entry = await getPublicEntryById(entryId);

    if (!entry) {
      return next();
    }

    if (hashedIP) {
      const timeframeHours = 24;
      const timeLimit = Math.floor(Date.now() / 1000) - timeframeHours * 60 * 60;
      const checkQuery = "SELECT id FROM view_logs WHERE entry_id = ? AND ip_address = ? AND viewed_at > ? LIMIT 1";

      viewDb.get(checkQuery, [entryId, hashedIP, timeLimit], async (err, row) => {
        if (err) console.error("Error checking view logs:", err.message);
        else if (!row) {
          const insertQuery = "INSERT INTO view_logs (entry_id, ip_address, viewed_at) VALUES (?, ?, ?)";
          const nowTimestamp = Math.floor(Date.now() / 1000);
          viewDb.run(insertQuery, [entryId, hashedIP, nowTimestamp], (insertErr) => {
            if (insertErr) console.error("Error inserting view log:", insertErr.message);
            else {
              pbAdmin
                .collection("entries")
                .update(entryId, { "views+": 1 })
                .catch((pbUpdateError) => {
                  if (pbUpdateError?.status !== 404) {
                    console.error(`Failed to increment PocketBase view count for entry ${entryId} using Admin client:`, pbUpdateError);
                  }
                });
            }
          });
        }
      });
    } else {
      console.warn("Could not determine or hash IP address for view tracking.");
    }

    const unsafeHtml = marked.parse(entry.content || "");
    const window = new JSDOM("").window;
    const purify = DOMPurify(window);
    const cleanHtml = purify.sanitize(unsafeHtml);

    res.render("view", { entry, contentHtml: cleanHtml });
  } catch (error) {
    console.error(`Error processing public view for entry ${entryId}:`, error);

    next(error);
  }
});

// --- Authentication Routes ---
app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");

  res.render("login", { error: null, pageTitle: "Login" });
});

app.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).render("login", {
      error: "Email and password are required.",
      pageTitle: "Login",
    });
  }

  try {
    const authData = await pb.collection("users").authWithPassword(email, password);

    req.session.regenerate((err) => {
      if (err) {
        console.error("Session regeneration failed:", err);

        pb.authStore.clear();

        return res.status(500).render("login", {
          error: "Login failed due to a server issue. Please try again.",
          pageTitle: "Login",
        });
      }

      req.session.user = authData.record;
      req.session.token = authData.token;

      const cookie = pb.authStore.exportToCookie({
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "Lax",
      });

      res.setHeader("Set-Cookie", cookie);

      const returnTo = req.session.returnTo || "/";

      req.session.returnTo = undefined;
      res.redirect(returnTo);
    });
  } catch (error) {
    console.error("Login failed:", error);

    let errorMessage = "Login failed. Please check your credentials.";

    if (error.status === 400) errorMessage = "Invalid email or password.";

    res.clearCookie("pb_auth");
    res.status(401).render("login", { error: errorMessage, pageTitle: "Login" });
  }
});

app.get("/logout", (req, res, next) => {
  pb.authStore.clear();
  res.clearCookie("pb_auth");
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return next(err);
    }

    res.redirect("/login");
  });
});

// --- Protected Routes (Require Login) ---
app.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const entries = await pb.collection("entries").getFullList({ sort: "-created", filter: filter });

    const entriesWithViewUrl = entries.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.id}`,
    }));

    res.render("index", { entries: entriesWithViewUrl, pageTitle: "Dashboard" });
  } catch (error) {
    console.error("Error fetching user entries for dashboard:", error);

    next(error);
  }
});

// --- Entry CRUD Routes ---
app.get("/new", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;

    const templates = await pb.collection("templates").getFullList({
      sort: "name",
      filter: filter,
      fields: "id,name",
    });

    res.render("new", {
      entry: null,
      errors: null,
      templates: templates,
      pageTitle: "Create New Entry",
    });
  } catch (error) {
    console.error("Error fetching templates for new entry page:", error);

    res.render("new", {
      entry: null,
      errors: { general: "Could not load templates." },
      templates: [],
      pageTitle: "Create New Entry",
    });
  }
});

app.post("/new", requireLogin, async (req, res) => {
  const { title, type, domain, content, status, tags } = req.body;

  const data = {
    title,
    type,
    domain,
    content,
    status: status || "draft",
    tags: tags || "",
    views: 0,
    owner: req.session.user.id,
  };

  try {
    await pb.collection("entries").create(data);

    res.redirect("/");
  } catch (error) {
    console.error("Failed to create entry:", error);

    const pbErrors = error?.data?.data || {};

    try {
      const userId = req.session.user.id;
      const filter = `owner = '${userId}'`;
      const templates = await pb.collection("templates").getFullList({ sort: "name", filter: filter, fields: "id,name" });

      res.status(400).render("new", {
        entry: data,
        errors: pbErrors,
        templates: templates,
        pageTitle: "Create New Entry",
      });
    } catch (templateError) {
      console.error("Error fetching templates after entry creation failure:", templateError);

      res.status(400).render("new", {
        entry: data,
        errors: pbErrors,
        templates: [],
        pageTitle: "Create New Entry",
      });
    }
  }
});

app.get("/edit/:id", requireLogin, async (req, res, next) => {
  try {
    const entryId = req.params.id;
    const userId = req.session.user.id;
    const record = await pb.collection("entries").getOne(entryId);

    if (record.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    res.render("edit", { entry: record, errors: null, pageTitle: "Edit Entry" });
  } catch (error) {
    console.error(`Failed to fetch entry ${req.params.id} for edit:`, error);

    if (error.status === 404) {
      const err = new Error("Not Found");
      err.status = 404;
      return next(err);
    }

    next(error);
  }
});

app.post("/edit/:id", requireLogin, async (req, res, next) => {
  const { title, type, domain, content, status, tags } = req.body;

  const data = {
    title,
    type,
    domain,
    content,
    status: status || "draft",
    tags: tags || "",
  };

  const entryId = req.params.id;

  try {
    const record = await pb.collection("entries").getOne(entryId);

    if (record.owner !== req.session.user.id) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    await pb.collection("entries").update(entryId, data);

    res.redirect("/");
  } catch (error) {
    console.error(`Failed to update entry ${entryId}:`, error);

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const pbErrors = error?.data?.data || {};

    try {
      const originalEntry = await pb.collection("entries").getOne(entryId);
      const entryForRender = { ...originalEntry, ...data };

      res.status(400).render("edit", {
        entry: entryForRender,
        errors: pbErrors,
        pageTitle: "Edit Entry",
      });
    } catch (fetchError) {
      console.error(`Error fetching original entry ${entryId} after update failure:`, fetchError);

      next(fetchError);
    }
  }
});

app.post("/delete/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;

  try {
    const record = await pb.collection("entries").getOne(entryId);

    if (record.owner !== req.session.user.id) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    await pb.collection("entries").delete(entryId);

    viewDb.run("DELETE FROM view_logs WHERE entry_id = ?", [entryId], (delErr) => {
      if (delErr) console.error(`Error cleaning view logs for ${entryId}:`, delErr.message);
    });

    res.redirect("/");
  } catch (error) {
    console.error(`Failed to delete entry ${entryId}:`, error);

    if (error.status === 404 || error.status === 403) {
      return next(error);
    }

    res.redirect("/?error=delete_failed");
  }
});

// --- Template CRUD Routes ---
app.get("/templates", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;

    const templates = await pb.collection("templates").getFullList({
      sort: "name",
      filter: filter,
    });

    res.render("templates/index", {
      templates: templates,
      pageTitle: "Manage Templates",
      message: req.query.message,
    });
  } catch (error) {
    console.error("Error fetching templates:", error);

    next(error);
  }
});

app.get("/templates/new", requireLogin, (req, res) => {
  res.render("templates/new", {
    template: null,
    errors: null,
    pageTitle: "Create New Template",
  });
});

app.post("/templates/new", requireLogin, async (req, res, next) => {
  const { name, content } = req.body;

  const data = {
    name,
    content,
    owner: req.session.user.id,
  };

  try {
    await pb.collection("templates").create(data);

    res.redirect("/templates?message=Template created successfully");
  } catch (error) {
    console.error("Failed to create template:", error);

    const pbErrors = error?.data?.data || {};

    res.status(400).render("templates/new", {
      template: data,
      errors: pbErrors,
      pageTitle: "Create New Template",
    });
  }
});

app.get("/templates/edit/:id", requireLogin, async (req, res, next) => {
  try {
    const templateId = req.params.id;
    const userId = req.session.user.id;
    const template = await pb.collection("templates").getOne(templateId);

    if (template.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    res.render("templates/edit", {
      template: template,
      errors: null,
      pageTitle: "Edit Template",
    });
  } catch (error) {
    console.error(`Failed to fetch template ${req.params.id} for edit:`, error);

    if (error.status === 404) {
      const err = new Error("Not Found");
      err.status = 404;
      return next(err);
    }

    next(error);
  }
});

app.post("/templates/edit/:id", requireLogin, async (req, res, next) => {
  const { name, content } = req.body;
  const data = { name, content };
  const templateId = req.params.id;

  try {
    const template = await pb.collection("templates").getOne(templateId);

    if (template.owner !== req.session.user.id) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    await pb.collection("templates").update(templateId, data);

    res.redirect("/templates?message=Template updated successfully");
  } catch (error) {
    console.error(`Failed to update template ${templateId}:`, error);

    if (error.status === 403 || error.status === 404) {
      return next(error);
    }

    const pbErrors = error?.data?.data || {};

    try {
      const originalTemplate = await pb.collection("templates").getOne(templateId);
      const templateForRender = { ...originalTemplate, ...data };

      res.status(400).render("templates/edit", {
        template: templateForRender,
        errors: pbErrors,
        pageTitle: "Edit Template",
      });
    } catch (fetchError) {
      console.error(`Error fetching original template ${templateId} after update failure:`, fetchError);

      next(fetchError);
    }
  }
});

app.post("/templates/delete/:id", requireLogin, async (req, res, next) => {
  const templateId = req.params.id;

  try {
    const template = await pb.collection("templates").getOne(templateId);

    if (template.owner !== req.session.user.id) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }

    await pb.collection("templates").delete(templateId);

    res.redirect("/templates?message=Template deleted successfully");
  } catch (error) {
    console.error(`Failed to delete template ${templateId}:`, error);

    if (error.status === 404 || error.status === 403) {
      return next(error);
    }

    res.redirect("/templates?message=Error deleting template");
  }
});

// --- API Routes ---
app.use("/api", apiLimiter);

app.get("/api/entries", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const records = await pb.collection("entries").getFullList({ sort: "-created", filter: filter });

    const entriesWithViewUrl = records.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.id}`,
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    }));

    res.json(entriesWithViewUrl);
  } catch (error) {
    console.error("API Error fetching user entries:", error);

    next(error);
  }
});

app.post("/api/entries/bulk-action", requireLogin, async (req, res, next) => {
  const { action, ids } = req.body;
  const userId = req.session.user.id;

  if (!action || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Invalid request: 'action' and 'ids' array are required." });
  }

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      try {
        const record = await pb.collection("entries").getOne(id, { fields: "owner" });

        if (record.owner !== userId) {
          throw Object.assign(new Error("Forbidden"), { status: 403 });
        }

        if (action === "publish" || action === "draft") {
          const newStatus = action === "publish" ? "published" : "draft";
          await pb.collection("entries").update(id, { status: newStatus });
          return { id, status: "fulfilled", action };
        }

        if (action === "delete") {
          await pb.collection("entries").delete(id);

          viewDb.run("DELETE FROM view_logs WHERE entry_id = ?", [id], (delErr) => {
            if (delErr) console.error(`Error cleaning view logs for deleted entry ${id}:`, delErr.message);
          });

          return { id, status: "fulfilled", action };
        }

        throw new Error(`Unsupported bulk action: ${action}`);
      } catch (error) {
        console.warn(`Bulk action '${action}' failed for entry ${id} by user ${userId}: ${error.status} ${error.message}`);

        return {
          id,
          status: "rejected",
          action,
          reason: error.message,
          statusCode: error.status || 500,
        };
      }
    }),
  );

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected");

  if (rejected.length === 0) {
    res.status(200).json({
      message: `Successfully performed action '${action}' on ${fulfilled} entries.`,
    });
  } else if (fulfilled > 0) {
    res.status(207).json({
      message: `Action '${action}' completed with some errors. ${fulfilled} succeeded, ${rejected.length} failed.`,
      errors: rejected.map((r) => ({
        id: r.value.id,
        reason: r.value.reason,
        status: r.value.statusCode,
      })),
    });
  } else {
    const firstErrorCode = rejected[0]?.value?.statusCode || 500;

    res.status(firstErrorCode).json({
      error: `Failed to perform action '${action}' on any selected entries.`,
      errors: rejected.map((r) => ({
        id: r.value.id,
        reason: r.value.reason,
        status: r.value.statusCode,
      })),
    });
  }
});

app.get("/api/templates/:id", requireLogin, async (req, res, next) => {
  try {
    const templateId = req.params.id;
    const userId = req.session.user.id;

    const template = await pb.collection("templates").getOne(templateId, {
      fields: "content, owner",
    });

    if (template.owner !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json({ content: template.content });
  } catch (error) {
    console.error(`API Error fetching template ${req.params.id}:`, error);

    if (error.status === 404 || error.status === 403) {
      return res.status(error.status).json({ error: error.message });
    }

    res.status(500).json({ error: "Failed to fetch template content" });
  }
});

app.post("/api/set-theme", requireLogin, (req, res) => {
  const { theme } = req.body;

  if (theme === "light" || theme === "dark") {
    req.session.theme = theme;
    res.status(200).json({ message: `Theme preference updated to ${theme}` });
  } else {
    res.status(400).json({ error: "Invalid theme value provided." });
  }
});

// =============================================================================
// ERROR HANDLING MIDDLEWARE (Must be last)
// =============================================================================
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = process.env.NODE_ENV !== "production" ? err : {};

  const status = err.status || 500;

  res.status(status);

  if (status >= 500) console.error(`[${status}] Server Error: ${err.message}\n${err.stack || "(No stack trace)"}`);
  else if (status !== 404) console.warn(`[${status}] Client Error: ${err.message}`);

  if (status === 404) res.render("404", { pageTitle: "Page Not Found (404)" });
  else if (status === 403) res.render("403", { pageTitle: "Access Denied (403)" });
  else res.render("500", { pageTitle: `Server Error (${status})` });
});

// =============================================================================
// SERVER STARTUP & SHUTDOWN
// =============================================================================
const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Using PocketBase instance at ${process.env.POCKETBASE_URL}`);
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing databases and server.");
  server.close(() => {
    console.log("HTTP server closed.");
    viewDb.close((err) => {
      if (err) console.error("Error closing view tracking DB", err.message);
      else console.log("View tracking database connection closed.");
      process.exit(0);
    });
  });
});
