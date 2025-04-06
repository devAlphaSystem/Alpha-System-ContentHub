import "dotenv/config";
import http from "node:http";
import { app } from "./src/app.js";
import { PORT, POCKETBASE_URL, viewDb } from "./src/config.js";

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Using PocketBase instance at ${POCKETBASE_URL}`);
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

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});
