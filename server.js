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

if (!process.env.SESSION_SECRET || !process.env.IP_HASH_SALT) {
  console.error("FATAL ERROR: SESSION_SECRET and IP_HASH_SALT must be defined in .env");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const pb = new PocketBase(process.env.POCKETBASE_URL);

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
  if (!ip || !salt) {
    return null;
  }
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

async function getAllEntries(req) {
  if (req.session?.token) {
    pb.authStore.loadFromCookie(`pb_auth=${req.session.token}`);
  } else {
    pb.authStore.clear();
  }
  try {
    const records = await pb.collection("entries").getFullList({ sort: "-created" });
    return records;
  } catch (error) {
    console.error("Failed to fetch entries:", error);
    if (error.status === 403 || error.status === 401) {
      console.warn("Auth error fetching entries.");
      return [];
    }
    return [];
  }
}

async function getEntryById(id) {
  pb.authStore.clear();
  try {
    const record = await pb.collection("entries").getOne(id);
    return record;
  } catch (error) {
    console.error(`Failed to fetch entry ${id}:`, error);
    return null;
  }
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect("/login");
  }
  pb.authStore.loadFromCookie(`pb_auth=${req.session.token}`);
  next();
}

app.get("/view/:id", async (req, res) => {
  const entryId = req.params.id;
  const ipAddress = getIP(req);
  const hashedIP = hashIP(ipAddress, process.env.IP_HASH_SALT);

  try {
    const entry = await getEntryById(entryId);
    if (!entry) {
      return res.status(404).render("404", { message: "Entry not found" });
    }

    if (hashedIP) {
      const timeframeHours = 24;
      const timeLimit = Math.floor(Date.now() / 1000) - timeframeHours * 60 * 60;

      const checkQuery = `
        SELECT id FROM view_logs
        WHERE entry_id = ? AND ip_address = ? AND viewed_at > ?
        LIMIT 1
      `;

      viewDb.get(checkQuery, [entryId, hashedIP, timeLimit], async (err, row) => {
        if (err) {
          console.error("Error checking view logs:", err.message);
        } else if (!row) {
          const insertQuery = `
            INSERT INTO view_logs (entry_id, ip_address, viewed_at)
            VALUES (?, ?, ?)
          `;
          const nowTimestamp = Math.floor(Date.now() / 1000);

          viewDb.run(insertQuery, [entryId, hashedIP, nowTimestamp], (insertErr) => {
            if (insertErr) {
              console.error("Error inserting view log:", insertErr.message);
            } else {
              pb.collection("entries")
                .update(entryId, { "views+": 1 })
                .then(() => {
                  /* Log success !? */
                })
                .catch((pbUpdateError) => {
                  console.error(`Failed to increment PocketBase view count for entry ${entryId}:`, pbUpdateError);
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
    console.error(`Error fetching entry ${entryId} for view:`, error);
    if (error.status === 404) {
      return res.status(404).render("404", { message: "Entry not found" });
    }
    res.status(500).send("Error loading page");
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
    if (err) return next(err);
    res.redirect("/login");
  });
});

app.get("/", requireLogin, async (req, res) => {
  const entries = await getAllEntries(req);
  const entriesWithViewUrl = entries.map((entry) => ({
    ...entry,
    viewUrl: `/view/${entry.id}`,
  }));
  res.render("index", { entries: entriesWithViewUrl, pageTitle: "Dashboard" });
});

app.get("/new", requireLogin, (req, res) => {
  res.render("new", { entry: null, errors: null, pageTitle: "Create New Entry" });
});

app.post("/new", requireLogin, async (req, res) => {
  const { title, type, domain, content } = req.body;
  const data = { title, type, domain, content, views: 0 };
  try {
    await pb.collection("entries").create(data);
    res.redirect("/");
  } catch (error) {
    console.error("Failed to create entry:", error);
    const pbErrors = error?.data?.data || {};
    res.status(400).render("new", { entry: data, errors: pbErrors, pageTitle: "Create New Entry" });
  }
});

app.get("/edit/:id", requireLogin, async (req, res) => {
  try {
    const record = await pb.collection("entries").getOne(req.params.id);
    res.render("edit", { entry: record, errors: null, pageTitle: "Edit Entry" });
  } catch (error) {
    console.error(`Failed to fetch entry ${req.params.id} for edit:`, error);
    if (error.status === 404) return res.status(404).send("Entry not found");
    res.status(500).send("Error loading entry for editing");
  }
});

app.post("/edit/:id", requireLogin, async (req, res) => {
  const { title, type, domain, content } = req.body;
  const data = { title, type, domain, content };
  try {
    await pb.collection("entries").update(req.params.id, data);
    res.redirect("/");
  } catch (error) {
    console.error(`Failed to update entry ${req.params.id}:`, error);
    const pbErrors = error?.data?.data || {};
    try {
      const originalEntry = await pb.collection("entries").getOne(req.params.id);
      const entryForRender = { ...originalEntry, ...data };
      res.status(400).render("edit", { entry: entryForRender, errors: pbErrors, pageTitle: "Edit Entry" });
    } catch (fetchError) {
      res.status(500).send("Error processing update request.");
    }
  }
});

app.post("/delete/:id", requireLogin, async (req, res) => {
  const entryId = req.params.id;
  try {
    await pb.collection("entries").delete(entryId);
    viewDb.run("DELETE FROM view_logs WHERE entry_id = ?", [entryId], (delErr) => {
      if (delErr) console.error(`Error cleaning view logs for ${entryId}:`, delErr.message);
    });
    res.redirect("/");
  } catch (error) {
    console.error(`Failed to delete entry ${entryId}:`, error);
    res.redirect("/?error=delete_failed");
  }
});

app.get("/api/entries", requireLogin, async (req, res) => {
  try {
    const records = await pb.collection("entries").getFullList({
      sort: "-created",
    });

    const entriesWithViewUrl = records.map((entry) => ({
      ...entry,
      viewUrl: `/view/${entry.id}`,
      formattedUpdated: new Date(entry.updated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    }));

    res.json(entriesWithViewUrl);
  } catch (error) {
    console.error("API Error fetching entries:", error);
    if (error.status === 403 || error.status === 401) {
      return res.status(error.status).json({ error: "Unauthorized" });
    }
    res.status(500).json({ error: "Failed to fetch entries" });
  }
});

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

  if (status === 404) {
    res.render("404", { pageTitle: "Page Not Found (404)" });
  } else {
    console.error(`[${status}] Error: ${err.message}\n${err.stack || ""}`);
    res.render("500", { pageTitle: `Server Error (${status})` });
  }
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
