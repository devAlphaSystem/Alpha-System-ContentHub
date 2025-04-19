import express from "express";
import path from "node:path";
import session from "express-session";
import fs from "node:fs";
import { configuredHelmet, sessionStore, BASE_DIR, SESSION_SECRET, NODE_ENV } from "./config.js";
import { setLocals, handle404, handleErrors } from "./middleware.js";
import mainRouter from "./routes/index.js";
import { logger } from "./logger.js";

let appVersion = "unknown";
try {
  const packageJsonPath = path.join(BASE_DIR, "package.json");
  const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonContent);
  appVersion = packageJson.version;
  logger.info(`Application version loaded: ${appVersion}`);
} catch (error) {
  logger.error(`Failed to load application version from package.json: ${error.message}`);
}

const app = express();

app.locals.appVersion = appVersion;

app.set("view engine", "ejs");
app.set("views", path.join(BASE_DIR, "views"));
app.set("trust proxy", 1);
logger.debug("View engine and views path configured.");

app.use(express.static(path.join(BASE_DIR, "public")));
logger.debug("Static files middleware configured.");

app.use(configuredHelmet);
logger.debug("Helmet security middleware configured.");
app.use(
  express.urlencoded({
    extended: true,
  }),
);
app.use(express.json());
logger.debug("Body parsing middleware configured.");

app.use(
  session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: NODE_ENV === "production",
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);
logger.info(`Session middleware configured with secure cookie: ${NODE_ENV === "production"}.`);

app.use(setLocals);
logger.debug("setLocals middleware configured.");

app.use("/", mainRouter);
logger.debug("Main router configured.");

app.use(handle404);
logger.debug("404 handler middleware configured.");
app.use(handleErrors);
logger.debug("Error handling middleware configured.");

export { app };
