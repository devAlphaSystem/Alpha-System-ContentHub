import cron from "node-cron";
import { pbAdmin } from "./config.js";

const BATCH_SIZE = 200;

async function cleanupOrphanedPreviews() {
  console.log(`[CRON] Running cleanup for orphaned preview tokens at ${new Date().toISOString()}...`);
  let deletedOrphanCount = 0;
  let page = 1;
  let totalPages = 1;
  const validEntryIds = new Set();

  try {
    console.log("[CRON] Fetching all valid entry IDs...");
    const allEntries = await pbAdmin.collection("entries_main").getFullList({
      fields: "id",
      $autoCancel: false,
    });
    allEntries.forEach((entry) => validEntryIds.add(entry.id));
    console.log(`[CRON] Found ${validEntryIds.size} valid entry IDs.`);

    do {
      const resultList = await pbAdmin.collection("entries_previews").getList(page, BATCH_SIZE, {
        fields: "id,entry",
        $autoCancel: false,
      });

      totalPages = resultList.totalPages;
      const orphansInBatch = [];

      if (resultList.items.length > 0) {
        for (const item of resultList.items) {
          if (!item.entry || !validEntryIds.has(item.entry)) {
            orphansInBatch.push(item.id);
          }
        }

        if (orphansInBatch.length > 0) {
          console.log(`[CRON] Found ${orphansInBatch.length} orphaned tokens (page ${page}/${totalPages}). Deleting batch...`);
          const deletePromises = orphansInBatch.map((id) => pbAdmin.collection("entries_previews").delete(id));
          await Promise.all(deletePromises);
          deletedOrphanCount += orphansInBatch.length;
          console.log("[CRON] Orphan batch deleted.");
        } else {
          console.log(`[CRON] No orphaned tokens found on page ${page}.`); // Optional
        }
      }

      page++;
    } while (page <= totalPages);

    if (deletedOrphanCount > 0) {
      console.log(`[CRON] Orphan cleanup finished. Deleted ${deletedOrphanCount} orphaned preview tokens.`);
    } else {
      console.log("[CRON] Orphan cleanup finished. No orphaned preview tokens found to delete.");
    }
  } catch (error) {
    console.error("[CRON] Error during orphaned preview token cleanup:", error);
    if (error?.data) {
      console.error("[CRON] PocketBase Error Data:", error.data);
    }
  }
}

async function cleanupExpiredPreviews() {
  console.log(`[CRON] Running cleanup for expired preview tokens at ${new Date().toISOString()}...`);
  let deletedExpiredCount = 0;
  let page = 1;
  let totalPages = 1;

  try {
    const nowISO = new Date().toISOString().replace("T", " ");

    do {
      const resultList = await pbAdmin.collection("entries_previews").getList(page, BATCH_SIZE, {
        filter: `expires_at < "${nowISO}"`,
        fields: "id",
        $autoCancel: false,
      });

      totalPages = resultList.totalPages;

      if (resultList.items.length > 0) {
        console.log(`[CRON] Found ${resultList.items.length} expired tokens (page ${page}/${totalPages}). Deleting batch...`);
        const deletePromises = resultList.items.map((item) => pbAdmin.collection("entries_previews").delete(item.id));
        await Promise.all(deletePromises);
        deletedExpiredCount += resultList.items.length;
        console.log("[CRON] Expired batch deleted.");
      } else {
        console.log(`[CRON] No expired tokens found on page ${page}.`); // Optional
      }

      page++;
    } while (page <= totalPages);

    if (deletedExpiredCount > 0) {
      console.log(`[CRON] Expiration cleanup finished. Deleted ${deletedExpiredCount} expired preview tokens.`);
    } else {
      console.log("[CRON] Expiration cleanup finished. No expired preview tokens found to delete.");
    }
  } catch (error) {
    console.error("[CRON] Error during expired preview token cleanup:", error);
    if (error?.data) {
      console.error("[CRON] PocketBase Error Data:", error.data);
    }
  }
}

export function initializeCronJobs() {
  console.log("[CRON] Initializing cron jobs...");

  cron.schedule(
    "0 * * * *",
    async () => {
      console.log(`[CRON] Hourly cleanup cycle starting at ${new Date().toISOString()}`);
      await cleanupOrphanedPreviews();
      await cleanupExpiredPreviews();
      console.log(`[CRON] Hourly cleanup cycle finished at ${new Date().toISOString()}`);
    },
    {
      scheduled: true,
      timezone: "America/Sao_Paulo",
    },
  );

  console.log("[CRON] Scheduled combined cleanup job for minute 0 of every hour (America/Sao_Paulo).");
}
