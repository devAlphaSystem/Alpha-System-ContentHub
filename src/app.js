import express from "express";
import path from "node:path";
import session from "express-session";
import fs from "node:fs";
import { configuredHelmet, sessionStore, BASE_DIR, SESSION_SECRET, NODE_ENV } from "./config.js";
import { setLocals, handle404, handleErrors } from "./middleware.js";
import mainRouter from "./routes/index.js";

const packageJsonPath = "./package.json";
const packageJsonContent = fs.readFileSync(packageJsonPath, "utf8");
const packageJson = JSON.parse(packageJsonContent);

const app = express();

app.locals.appVersion = packageJson.version;

app.set("view engine", "ejs");
app.set("views", path.join(BASE_DIR, "views"));
app.set("trust proxy", 1);

app.use(express.static(path.join(BASE_DIR, "public")));

app.use(configuredHelmet);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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

app.use(setLocals);

app.use("/", mainRouter);

app.use(handle404);
app.use(handleErrors);

export { app };
