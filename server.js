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

if (!process.env.SESSION_SECRET || !process.env.IP_HASH_SALT || !process.env.POCKETBASE_ADMIN_EMAIL || !process.env.POCKETBASE_ADMIN_PASSWORD) {
  console.error("FATAL ERROR: SESSION_SECRET, IP_HASH_SALT, POCKETBASE_ADMIN_EMAIL, and POCKETBASE_ADMIN_PASSWORD must be defined in .env");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const pb = new PocketBase(process.env.POCKETBASE_URL);
const pbAdmin = new PocketBase(process.env.POCKETBASE_URL);

(async () => {
  try {
    await pbAdmin.admins.authWithPassword(process.env.POCKETBASE_ADMIN_EMAIL, process.env.POCKETBASE_ADMIN_PASSWORD);
    console.log("PocketBase Admin client authenticated successfully.");
    pbAdmin.autoRefreshThreshold = 30 * 60;
  } catch (adminAuthError) {
    console.error("FATAL ERROR: PocketBase Admin authentication failed:", adminAuthError);
    process.exit(1);
  }
})();

const dbDir = path.join(__dirname, "db");
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir);
}

const SQLiteStore = connectSqlite3(session);
const sessionStore = new SQLiteStore({ db: "sessions.db", dir: dbDir });

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

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.pocketbaseUrl = process.env.POCKETBASE_URL;
  next();
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
    return record;
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
    pb.authStore.loadFromCookie(req.session.token);
  } catch (loadError) {
    console.error("Error loading auth state from session token:", loadError);
    req.session.destroy(() => {
      res.clearCookie("pb_auth");
      return res.redirect("/login");
    });
    return;
  }
  if (!pb.authStore.isValid) {
    console.warn("Session token loaded but invalid. Redirecting to login.");
    req.session.destroy(() => {
      res.clearCookie("pb_auth");
      return res.redirect("/login");
    });
    return;
  }
  next();
}

app.get("/view/:id", async (req, res, next) => {
  const entryId = req.params.id;
  const ipAddress = getIP(req);
  const hashedIP = hashIP(ipAddress, process.env.IP_HASH_SALT);
  try {
    const entry = await getPublicEntryById(entryId);
    if (!entry) {
      const err = new Error("Not Found");
      err.status = 404;
      return next(err);
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
    const contentHtml = marked.parse(entry.content || "");
    res.render("view", { entry, contentHtml });
  } catch (error) {
    console.error(`Error processing public view for entry ${entryId}:`, error);
    next(error);
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null, pageTitle: "Login" });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).render("login", { error: "Email and password are required.", pageTitle: "Login" });
  }
  try {
    const authData = await pb.collection("users").authWithPassword(email, password);
    req.session.user = authData.record;
    const cookie = pb.authStore.exportToCookie({
      secure: process.env.NODE_ENV === "production",
      httpOnly: false,
      sameSite: "Lax",
    });
    res.setHeader("Set-Cookie", cookie);
    req.session.token = cookie;
    const returnTo = req.session.returnTo || "/";
    req.session.returnTo = undefined;
    res.redirect(returnTo);
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

app.get("/", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const entries = await pb.collection("entries").getFullList({
      sort: "-created",
      filter: filter,
    });
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

app.get("/new", requireLogin, (req, res) => {
  res.render("new", { entry: null, errors: null, pageTitle: "Create New Entry" });
});

app.post("/new", requireLogin, async (req, res) => {
  const { title, type, domain, content } = req.body;
  const data = { title, type, domain, content, views: 0, owner: req.session.user.id };
  try {
    await pb.collection("entries").create(data);
    res.redirect("/");
  } catch (error) {
    console.error("Failed to create entry:", error);
    const pbErrors = error?.data?.data || {};
    res.status(400).render("new", { entry: data, errors: pbErrors, pageTitle: "Create New Entry" });
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
  const { title, type, domain, content } = req.body;
  const data = { title, type, domain, content };
  const entryId = req.params.id;
  try {
    await pb.collection("entries").update(entryId, data);
    res.redirect("/");
  } catch (error) {
    console.error(`Failed to update entry ${entryId}:`, error);
    if (error.status === 403) {
      return next(error);
    }
    const pbErrors = error?.data?.data || {};
    try {
      const originalEntry = await pb.collection("entries").getOne(entryId);
      const entryForRender = { ...originalEntry, ...data };
      res.status(400).render("edit", { entry: entryForRender, errors: pbErrors, pageTitle: "Edit Entry" });
    } catch (fetchError) {
      console.error(`Error fetching original entry ${entryId} after update failure:`, fetchError);
      next(fetchError);
    }
  }
});

app.post("/delete/:id", requireLogin, async (req, res, next) => {
  const entryId = req.params.id;
  try {
    await pb.collection("entries").delete(entryId);
    viewDb.run("DELETE FROM view_logs WHERE entry_id = ?", [entryId], (delErr) => {
      if (delErr) console.error(`Error cleaning view logs for ${entryId}:`, delErr.message);
    });
    res.redirect("/");
  } catch (error) {
    console.error(`Failed to delete entry ${entryId}:`, error);
    if (error.status === 404) {
      const err = new Error("Not Found");
      err.status = 404;
      return next(err);
    }
    if (error.status === 403) {
      const err = new Error("Forbidden");
      err.status = 403;
      return next(err);
    }
    res.redirect("/?error=delete_failed");
  }
});

app.get("/api/entries", requireLogin, async (req, res, next) => {
  try {
    const userId = req.session.user.id;
    const filter = `owner = '${userId}'`;
    const records = await pb.collection("entries").getFullList({ sort: "-created", filter: filter });
    const entriesWithViewUrl = records.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.id}`,
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    }));
    res.json(entriesWithViewUrl);
  } catch (error) {
    console.error("API Error fetching user entries:", error);
    next(error);
  }
});

app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

app.use((err, req, res) => {
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Using PocketBase instance at ${process.env.POCKETBASE_URL}`);
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing databases.");
  viewDb.close((err) => {
    if (err) console.error("Error closing view tracking DB", err.message);
    else console.log("View tracking database connection closed.");
    process.exit(0);
  });
});
