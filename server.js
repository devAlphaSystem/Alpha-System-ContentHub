import "dotenv/config";
import http from "node:http";
import { app } from "./src/app.js";
import { PORT, POCKETBASE_URL, viewDb } from "./src/config.js";
import { initializeCronJobs } from "./src/cron.js";
import { logger } from "./src/logger.js";

const server = http.createServer(app);
logger.debug("HTTP server created.");

initializeCronJobs(app.locals.appVersion);

server.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  logger.info(`Using PocketBase instance at ${POCKETBASE_URL}`);
  logger.info(`Logging level set to: ${logger.getConfiguredLevel()}`);
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing databases and server.");
  server.close(() => {
    logger.info("HTTP server closed.");
    viewDb.close((err) => {
      if (err) {
        logger.error("Error closing view tracking DB", err.message);
      } else {
        logger.info("View tracking database connection closed.");
      }
      logger.info("Exiting process.");
      process.exit(0);
    });
  });
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});
