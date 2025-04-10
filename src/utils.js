import crypto from "node:crypto";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { pb, pbAdmin, viewDb, IP_HASH_SALT, VIEW_TIMEFRAME_HOURS, AVERAGE_WPM } from "./config.js";

const window = new JSDOM("").window;
const purify = DOMPurify(window);

const DEFAULT_TEMPLATES = [
  {
    name: "Basic Changelog Entry",
    content: "### ✨ New Features\n\n*   Description of a new feature.\n\n### 🐛 Bug Fixes\n\n*   Description of a bug fix.\n\n###  verbeterungen Improvements\n\n*   Description of an improvement.",
  },
  {
    name: "API Documentation Section",
    content: `## Endpoint: \`/api/v1/resource\`\n\n**Method:** \`GET\`\n\n**Description:** Retrieves a list of resources.\n\n**Parameters:**\n\n| Name     | Type   | Description                |\n| :------- | :----- | :------------------------- |\n| \`limit\`  | number | *Optional*. Max items per page. |\n| \`offset\` | number | *Optional*. Items to skip.    |\n\n**Response:**\n\n\`\`\`json\n{\n  "data": [\n    { "id": "...", "name": "..." }\n  ],\n  "pagination": { ... }\n}\n\`\`\``,
  },
  {
    name: "Simple Documentation Page",
    content: "# Getting Started\n\nWelcome to the documentation!\n\n## Installation\n\nInstructions on how to install...\n\n## Configuration\n\nDetails about configuration options...",
  },
];

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
  const filter = `owner = '${userId}'`;
  const fields = "id,name";

  try {
    let templates = await pb.collection("templates").getFullList({
      sort: "name",
      filter: filter,
      fields: fields,
      $autoCancel: false,
    });

    if (templates.length === 0) {
      console.log(`No templates found for user ${userId}. Creating defaults...`);
      const creationPromises = DEFAULT_TEMPLATES.map((templateData) => {
        const dataToCreate = {
          ...templateData,
          owner: userId,
        };
        return pb.collection("templates").create(dataToCreate);
      });

      try {
        const createdTemplates = await Promise.all(creationPromises);
        console.log(`Successfully created ${createdTemplates.length} default templates for user ${userId}.`);
        templates = createdTemplates.map((t) => ({ id: t.id, name: t.name }));
        templates.sort((a, b) => a.name.localeCompare(b.name));
      } catch (creationError) {
        console.error(`Error creating default templates for user ${userId}:`, creationError);
        return [];
      }
    }

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

export async function logAuditEvent(req, action, targetCollection, targetRecord, details) {
  if (!action) {
    console.error("Audit log attempt failed: Action is required.");
    return;
  }

  let userId = null;
  let ipAddress = null;

  if (req?.session?.user) {
    userId = req.session.user.id;
  }

  if (req) {
    ipAddress = getIP(req);
  }

  if (!userId && action !== "SYSTEM_ADMIN_AUTH" && action !== "POCKETBASE_ADMIN_AUTH_SUCCESS") {
    const allowedSystemActions = ["PREVIEW_PASSWORD_SUCCESS", "PREVIEW_PASSWORD_FAILURE"];
    if (!allowedSystemActions.includes(action)) {
      console.warn(`Audit log for action '${action}' is missing user ID.`);
    }
  }

  const logData = {
    user: userId,
    action: action,
    target_collection: targetCollection || null,
    target_record: targetRecord || null,
    ip_address: ipAddress,
    details: details || null,
  };

  try {
    await pbAdmin.collection("audit_logs").create(logData);
  } catch (error) {
    console.error(`Failed to write audit log for action '${action}':`, error?.message || error);
    if (error?.data?.data) {
      console.error("Audit Log Error Details:", error.data.data);
    }
  }
}

export function calculateReadingTime(text, wpm = AVERAGE_WPM) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return 0;
  }

  const words = text.trim().split(/\s+/).length;
  if (words === 0) {
    return 0;
  }

  const minutes = words / wpm;
  return Math.max(1, Math.ceil(minutes));
}
