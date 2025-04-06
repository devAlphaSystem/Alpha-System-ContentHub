import crypto from "node:crypto";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { pb, pbAdmin, viewDb, IP_HASH_SALT, VIEW_TIMEFRAME_HOURS } from "./config.js";

const window = new JSDOM("").window;
const purify = DOMPurify(window);

export function getIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ips = String(forwarded).split(",");
    return ips[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

export function hashIP(ip) {
  if (!ip || !IP_HASH_SALT) return null;
  return crypto.createHmac("sha256", IP_HASH_SALT).update(ip).digest("hex");
}

export function hashPreviewPassword(password) {
  if (!password || !IP_HASH_SALT) {
    console.error("Attempted to hash password without password or salt.");
    return null;
  }
  return crypto.createHmac("sha256", IP_HASH_SALT).update(password).digest("hex");
}

export function sanitizeHtml(unsafeHtml) {
  return purify.sanitize(unsafeHtml);
}

export async function getPublicEntryById(id) {
  try {
    const record = await pbAdmin.collection("entries_main").getFirstListItem(`id = '${id}' && status = 'published'`);
    return record;
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to fetch public entry ${id}:`, error);
    }
    return null;
  }
}

export async function getDraftEntryForPreview(id) {
  try {
    const record = await pbAdmin.collection("entries_main").getOne(id);
    return record;
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to fetch entry ${id} for preview:`, error);
    }
    return null;
  }
}

export async function getUserTemplates(userId) {
  try {
    const filter = `owner = '${userId}'`;
    const templates = await pb.collection("templates").getFullList({
      sort: "name",
      filter: filter,
      fields: "id,name",
    });
    return templates;
  } catch (error) {
    console.error(`Error fetching templates for user ${userId}:`, error);
    throw error;
  }
}

export async function getTemplateForEdit(templateId, userId) {
  try {
    const template = await pb.collection("templates").getOne(templateId);
    if (template.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return template;
  } catch (error) {
    console.error(`Failed to fetch template ${templateId} for edit:`, error);
    throw error;
  }
}

export async function getEntryForOwner(entryId, userId) {
  try {
    const record = await pb.collection("entries_main").getOne(entryId);
    if (record.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return record;
  } catch (error) {
    console.error(`Failed to fetch entry ${entryId} for owner ${userId}:`, error);
    throw error;
  }
}

export async function getArchivedEntryForOwner(entryId, userId) {
  try {
    const record = await pbAdmin.collection("entries_archived").getOne(entryId);
    if (record.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return record;
  } catch (error) {
    console.error(`Failed to fetch archived entry ${entryId} for owner ${userId}:`, error);
    throw error;
  }
}

export function logEntryView(req, entryId) {
  const ipAddress = getIP(req);
  const hashedIP = hashIP(ipAddress);

  if (!entryId) {
    console.warn("Attempted to log view without entryId.");
    return;
  }

  if (hashedIP) {
    const timeLimit = Math.floor(Date.now() / 1000) - VIEW_TIMEFRAME_HOURS * 60 * 60;
    const checkQuery = "SELECT id FROM view_logs WHERE entry_id = ? AND ip_address = ? AND viewed_at > ? LIMIT 1";

    viewDb.get(checkQuery, [entryId, hashedIP, timeLimit], (err, row) => {
      if (err) {
        console.error("Error checking view logs:", err.message);
      } else if (!row) {
        const insertQuery = "INSERT INTO view_logs (entry_id, ip_address, viewed_at) VALUES (?, ?, ?)";
        const nowTimestamp = Math.floor(Date.now() / 1000);

        viewDb.run(insertQuery, [entryId, hashedIP, nowTimestamp], (insertErr) => {
          if (insertErr) {
            console.error("Error inserting view log:", insertErr.message);
          } else {
            pbAdmin
              .collection("entries_main")
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
}

export function clearEntryViewLogs(entryId) {
  if (!entryId) return;
  viewDb.run("DELETE FROM view_logs WHERE entry_id = ?", [entryId], (delErr) => {
    if (delErr) {
      console.error(`Error cleaning view logs for entry ${entryId}:`, delErr.message);
    }
  });
}
