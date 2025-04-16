import crypto from "node:crypto";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { pb, pbAdmin, viewDb, IP_HASH_SALT, VIEW_TIMEFRAME_HOURS, AVERAGE_WPM } from "./config.js";

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

export async function getProjectForOwner(projectId, userId) {
  try {
    const project = await pb.collection("projects").getOne(projectId);
    if (project.owner !== userId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return project;
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to fetch project ${projectId} for owner ${userId}:`, error);
    }
    throw error;
  }
}

export async function getPublicEntryById(id) {
  try {
    const record = await pbAdmin.collection("entries_main").getFirstListItem(`id = '${id}' && status = 'published'`, {
      expand: "project,custom_documentation_header,custom_documentation_footer,custom_changelog_header,custom_changelog_footer",
    });
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
    const record = await pbAdmin.collection("entries_main").getOne(id, {
      expand: "project,custom_documentation_header,custom_documentation_footer,custom_changelog_header,custom_changelog_footer,staged_documentation_header,staged_documentation_footer,staged_changelog_header,staged_changelog_footer",
    });
    return record;
  } catch (error) {
    if (error.status !== 404) {
      console.error(`Failed to fetch entry ${id} for preview:`, error);
    }
    return null;
  }
}

export async function getUserTemplates(userId, projectId) {
  const filterParts = [`owner = '${userId}'`];
  if (projectId) {
    filterParts.push(`project = '${projectId}'`);
  }
  const filter = filterParts.join(" && ");
  const fields = "id,name";

  try {
    const templates = await pb.collection("templates").getFullList({
      sort: "name",
      filter: filter,
      fields: fields,
      $autoCancel: false,
    });
    return templates;
  } catch (error) {
    console.error(`Error fetching templates for user ${userId}, project ${projectId}:`, error);
    throw error;
  }
}

export async function getTemplateForEditAndProject(templateId, userId, projectId) {
  try {
    const template = await pb.collection("templates").getOne(templateId);
    if (template.owner !== userId || template.project !== projectId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return template;
  } catch (error) {
    console.error(`Failed to fetch template ${templateId} for edit in project ${projectId}:`, error);
    throw error;
  }
}

export async function getEntryForOwnerAndProject(entryId, userId, projectId) {
  try {
    const record = await pb.collection("entries_main").getOne(entryId, {
      expand: "custom_documentation_header,custom_documentation_footer,custom_changelog_header,custom_changelog_footer,staged_documentation_header,staged_documentation_footer,staged_changelog_header,staged_changelog_footer",
    });
    if (record.owner !== userId || record.project !== projectId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return record;
  } catch (error) {
    console.error(`Failed to fetch entry ${entryId} for owner ${userId} in project ${projectId}:`, error);
    throw error;
  }
}

export async function getArchivedEntryForOwnerAndProject(entryId, userId, projectId) {
  try {
    const record = await pbAdmin.collection("entries_archived").getOne(entryId);
    if (record.owner !== userId || record.project !== projectId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return record;
  } catch (error) {
    console.error(`Failed to fetch archived entry ${entryId} for owner ${userId} in project ${projectId}:`, error);
    throw error;
  }
}

async function getProjectAssets(collectionName, userId, projectId) {
  const filterParts = [`owner = '${userId}'`];
  if (projectId) {
    filterParts.push(`project = '${projectId}'`);
  }
  const filter = filterParts.join(" && ");
  try {
    const assets = await pb.collection(collectionName).getFullList({
      filter: filter,
      sort: "name",
      fields: "id,name",
      $autoCancel: false,
    });
    return assets;
  } catch (error) {
    console.error(`Error fetching ${collectionName} for user ${userId}, project ${projectId}:`, error);
    return [];
  }
}

async function getProjectAssetForEdit(collectionName, assetId, userId, projectId) {
  try {
    const asset = await pb.collection(collectionName).getOne(assetId);
    if (asset.owner !== userId || asset.project !== projectId) {
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    return asset;
  } catch (error) {
    console.error(`Failed to fetch ${collectionName} ${assetId} for edit in project ${projectId}:`, error);
    throw error;
  }
}

export async function getUserDocumentationHeaders(userId, projectId) {
  return getProjectAssets("documentation_headers", userId, projectId);
}

export async function getUserDocumentationFooters(userId, projectId) {
  return getProjectAssets("documentation_footers", userId, projectId);
}

export async function getUserChangelogHeaders(userId, projectId) {
  return getProjectAssets("changelog_headers", userId, projectId);
}

export async function getUserChangelogFooters(userId, projectId) {
  return getProjectAssets("changelog_footers", userId, projectId);
}

export async function getDocumentationHeaderForEditAndProject(headerId, userId, projectId) {
  return getProjectAssetForEdit("documentation_headers", headerId, userId, projectId);
}

export async function getDocumentationFooterForEditAndProject(footerId, userId, projectId) {
  return getProjectAssetForEdit("documentation_footers", footerId, userId, projectId);
}

export async function getChangelogHeaderForEditAndProject(headerId, userId, projectId) {
  return getProjectAssetForEdit("changelog_headers", headerId, userId, projectId);
}

export async function getChangelogFooterForEditAndProject(footerId, userId, projectId) {
  return getProjectAssetForEdit("changelog_footers", footerId, userId, projectId);
}

export function logEntryView(req, entryId) {
  if (req && req.query.from_admin === "1") {
    return;
  }

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
    const allowedSystemActions = ["PREVIEW_PASSWORD_SUCCESS", "PREVIEW_PASSWORD_FAILURE", "PROJECT_PASSWORD_SUCCESS", "PROJECT_PASSWORD_FAILURE"];
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
