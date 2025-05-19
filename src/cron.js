import cron from "node-cron";
import PocketBase from "pocketbase";
import { POCKETBASE_URL, POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD } from "./config.js";
import { checkAppVersion } from "./utils.js";
import { logger } from "./logger.js";

const BATCH_SIZE = 200;
let pbCronAdmin = null;

async function initializeCronAdminClient() {
  if (pbCronAdmin?.authStore.isValid) {
    logger.trace("[CRON] Cron Admin Client is valid.");
    return pbCronAdmin;
  }
  logger.info("[CRON] Initializing/Re-initializing Cron Admin Client...");
  const client = new PocketBase(POCKETBASE_URL);
  client.autoCancellation(false);
  try {
    await client.collection("_superusers").authWithPassword(POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD);
    logger.info("[CRON] Cron PocketBase Admin client authenticated successfully.");
    pbCronAdmin = client;
    return pbCronAdmin;
  } catch (adminAuthError) {
    logger.error("[CRON] FATAL ERROR: Cron PocketBase Admin authentication failed:", adminAuthError?.message || adminAuthError);
    if (adminAuthError?.data) {
      logger.error("[CRON] PocketBase Error Data:", adminAuthError.data);
    }
    pbCronAdmin = null;
    return null;
  }
}

async function cleanupOrphanedPreviews() {
  logger.time("[CRON] cleanupOrphanedPreviews");
  const pbAdminForCron = await initializeCronAdminClient();
  if (!pbAdminForCron) {
    logger.error("[CRON] Cannot run cleanupOrphanedPreviews: Admin client not available.");
    logger.timeEnd("[CRON] cleanupOrphanedPreviews");
    return;
  }

  logger.info(`[CRON] Running cleanup for orphaned preview tokens at ${new Date().toISOString()}...`);
  let deletedOrphanCount = 0;
  let page = 1;
  let totalPages = 1;
  const validEntryIds = new Set();

  try {
    logger.debug("[CRON] Fetching all valid entry IDs...");
    logger.time("[CRON] FetchAllEntries");
    const allEntries = await pbAdminForCron.collection("entries_main").getFullList({
      fields: "id",
      $autoCancel: false,
    });
    logger.timeEnd("[CRON] FetchAllEntries");

    for (const entry of allEntries) {
      validEntryIds.add(entry.id);
    }
    logger.info(`[CRON] Found ${validEntryIds.size} valid entry IDs.`);

    do {
      logger.time(`[CRON] OrphanPage ${page}`);
      const resultList = await pbAdminForCron.collection("entries_previews").getList(page, BATCH_SIZE, {
        fields: "id,entry",
        $autoCancel: false,
      });

      totalPages = resultList.totalPages;
      const orphansInBatch = [];

      if (resultList.items.length > 0) {
        logger.trace(`[CRON] Processing ${resultList.items.length} preview items on page ${page}.`);
        for (const item of resultList.items) {
          if (!item.entry || !validEntryIds.has(item.entry)) {
            orphansInBatch.push(item.id);
          }
        }

        if (orphansInBatch.length > 0) {
          logger.debug(`[CRON] Found ${orphansInBatch.length} orphaned tokens (page ${page}/${totalPages}). Deleting batch...`);
          const deletePromises = [];
          for (const id of orphansInBatch) {
            deletePromises.push(pbAdminForCron.collection("entries_previews").delete(id));
          }
          await Promise.all(deletePromises);
          deletedOrphanCount += orphansInBatch.length;
          logger.debug("[CRON] Orphan batch deleted.");
        } else {
          logger.debug(`[CRON] No orphaned tokens found on page ${page}.`);
        }
      }
      logger.timeEnd(`[CRON] OrphanPage ${page}`);
      page++;
    } while (page <= totalPages);

    if (deletedOrphanCount > 0) {
      logger.info(`[CRON] Orphan cleanup finished. Deleted ${deletedOrphanCount} orphaned preview tokens.`);
    } else {
      logger.info("[CRON] Orphan cleanup finished. No orphaned preview tokens found to delete.");
    }
  } catch (error) {
    logger.error("[CRON] Error during orphaned preview token cleanup:", error?.message || error);
    if (error?.data) {
      logger.error("[CRON] PocketBase Error Data:", error.data);
    }
    if (error?.status === 401 || error?.status === 403) {
      logger.warn("[CRON] Auth error during orphan cleanup. Forcing re-auth on next run.");
      pbCronAdmin = null;
    }
  } finally {
    logger.timeEnd("[CRON] cleanupOrphanedPreviews");
  }
}

async function cleanupExpiredPreviews() {
  logger.time("[CRON] cleanupExpiredPreviews");
  const pbAdminForCron = await initializeCronAdminClient();
  if (!pbAdminForCron) {
    logger.error("[CRON] Cannot run cleanupExpiredPreviews: Admin client not available.");
    logger.timeEnd("[CRON] cleanupExpiredPreviews");
    return;
  }

  logger.info(`[CRON] Running cleanup for expired preview tokens at ${new Date().toISOString()}...`);
  let deletedExpiredCount = 0;
  let page = 1;
  let totalPages = 1;

  try {
    const nowISO = new Date().toISOString().replace("T", " ");
    logger.debug(`[CRON] Checking for previews expired before ${nowISO}`);

    do {
      logger.time(`[CRON] ExpiredPage ${page}`);
      const resultList = await pbAdminForCron.collection("entries_previews").getList(page, BATCH_SIZE, {
        filter: `expires_at < "${nowISO}"`,
        fields: "id",
        $autoCancel: false,
      });

      totalPages = resultList.totalPages;

      if (resultList.items.length > 0) {
        logger.debug(`[CRON] Found ${resultList.items.length} expired tokens (page ${page}/${totalPages}). Deleting batch...`);
        const deletePromises = [];
        for (const item of resultList.items) {
          deletePromises.push(pbAdminForCron.collection("entries_previews").delete(item.id));
        }
        await Promise.all(deletePromises);
        deletedExpiredCount += resultList.items.length;
        logger.debug("[CRON] Expired batch deleted.");
      } else {
        logger.debug(`[CRON] No expired tokens found on page ${page}.`);
      }
      logger.timeEnd(`[CRON] ExpiredPage ${page}`);
      page++;
    } while (page <= totalPages);

    if (deletedExpiredCount > 0) {
      logger.info(`[CRON] Expiration cleanup finished. Deleted ${deletedExpiredCount} expired preview tokens.`);
    } else {
      logger.info("[CRON] Expiration cleanup finished. No expired preview tokens found to delete.");
    }
  } catch (error) {
    logger.error("[CRON] Error during expired preview token cleanup:", error?.message || error);
    if (error?.data) {
      logger.error("[CRON] PocketBase Error Data:", error.data);
    }
    if (error?.status === 401 || error?.status === 403) {
      logger.warn("[CRON] Auth error during expired cleanup. Forcing re-auth on next run.");
      pbCronAdmin = null;
    }
  } finally {
    logger.timeEnd("[CRON] cleanupExpiredPreviews");
  }
}

let versionInfoCache = {
  updateAvailable: false,
  latestVersion: null,
  currentVersion: null,
  timestamp: 0,
};

export function getVersionInfoCache() {
  return versionInfoCache;
}

export function initializeCronJobs(appVersion) {
  logger.info("[CRON] Initializing cron jobs...");
  cron.schedule(
    "0 */6 * * *",
    async () => {
      logger.info(`[CRON] Version check cycle starting at ${new Date().toISOString()}`);
      try {
        const info = await checkAppVersion(appVersion);
        versionInfoCache = {
          ...info,
          timestamp: Date.now(),
        };
        logger.info(`[CRON] Version check complete. Update available: ${info.updateAvailable ? "YES" : "NO"}. Latest: ${info.latestVersion}`);
      } catch (err) {
        logger.error("[CRON] Version check failed:", err?.message || err);
      }
    },
    {
      scheduled: true,
      timezone: "America/Sao_Paulo",
    },
  );

  cron.schedule(
    "0 * * * *",
    async () => {
      logger.info(`[CRON] Hourly cleanup cycle starting at ${new Date().toISOString()}`);
      await cleanupOrphanedPreviews();
      await cleanupExpiredPreviews();
      logger.info(`[CRON] Hourly cleanup cycle finished at ${new Date().toISOString()}`);
    },
    {
      scheduled: true,
      timezone: "America/Sao_Paulo",
    },
  );

  logger.info("[CRON] Scheduled combined cleanup job for minute 0 of every hour (America/Sao_Paulo).");
  logger.info("[CRON] Scheduled version check job for every 30 minutes (America/Sao_Paulo).");
}
