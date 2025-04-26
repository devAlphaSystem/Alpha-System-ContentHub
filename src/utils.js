import crypto from "node:crypto";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { pb, pbAdmin, viewDb, IP_HASH_SALT, VIEW_TIMEFRAME_HOURS, AVERAGE_WPM, getSettings } from "./config.js";
import { logger } from "./logger.js";
import fetch from "node-fetch";

const window = new JSDOM("").window;
const purify = DOMPurify(window);

export function getIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  let ip = null;
  if (forwarded) {
    const ips = String(forwarded).split(",");
    ip = ips[0].trim();
  } else {
    ip = req.ip || req.socket?.remoteAddress || null;
  }
  logger.trace(`getIP determined IP: ${ip}`);
  return ip;
}

export function hashIP(ip) {
  if (!ip || !IP_HASH_SALT) {
    logger.trace("hashIP: No IP or salt provided, returning null.");
    return null;
  }
  const hash = crypto.createHmac("sha256", IP_HASH_SALT).update(ip).digest("hex");
  logger.trace(`hashIP: Hashed ${ip} to ${hash}`);
  return hash;
}

export function hashPreviewPassword(password) {
  if (!password || !IP_HASH_SALT) {
    logger.error("Attempted to hash password without password or salt.");
    return null;
  }
  const hash = crypto.createHmac("sha256", IP_HASH_SALT).update(password).digest("hex");
  logger.trace("hashPreviewPassword: Hashed password.");
  return hash;
}

export function sanitizeHtml(unsafeHtml) {
  logger.trace("Sanitizing HTML content.");
  return purify.sanitize(unsafeHtml, { USE_PROFILES: { html: true } });
}

export async function getProjectForOwner(projectId, userId) {
  logger.debug(`Fetching project ${projectId} for owner ${userId}.`);
  logger.time(`[UTIL] getProjectForOwner ${projectId}`);
  try {
    const project = await pb.collection("projects").getOne(projectId);
    if (project.owner !== userId) {
      logger.warn(`Forbidden access attempt: User ${userId} tried to access project ${projectId} owned by ${project.owner}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    logger.timeEnd(`[UTIL] getProjectForOwner ${projectId}`);
    logger.trace(`Project ${projectId} fetched successfully for owner ${userId}.`);
    return project;
  } catch (error) {
    logger.timeEnd(`[UTIL] getProjectForOwner ${projectId}`);
    if (error.status !== 404 && error.status !== 403) {
      logger.error(`Failed to fetch project ${projectId} for owner ${userId}: Status ${error?.status || "N/A"}`, error?.message || error);
    } else if (error.status === 404) {
      logger.debug(`Project ${projectId} not found for owner ${userId}.`);
    }
    throw error;
  }
}

export async function getPublicEntryById(id) {
  logger.debug(`Fetching public entry ${id}.`);
  logger.time(`[UTIL] getPublicEntryById ${id}`);
  try {
    const record = await pbAdmin.collection("entries_main").getFirstListItem(`id = '${id}' && status = 'published'`, {
      expand: "project,custom_documentation_header,custom_documentation_footer,custom_changelog_header,custom_changelog_footer",
    });
    logger.timeEnd(`[UTIL] getPublicEntryById ${id}`);
    logger.trace(`Public entry ${id} fetched successfully.`);
    return record;
  } catch (error) {
    logger.timeEnd(`[UTIL] getPublicEntryById ${id}`);
    if (error.status === 404) {
      logger.debug(`Public entry ${id} not found (404).`);
      return null;
    }
    logger.error(`Failed to fetch public entry ${id}: Status ${error?.status || "N/A"}`, error?.message || error);
    if (error?.data) {
      logger.error("PocketBase Error Data:", error.data);
    }
    throw error;
  }
}

export async function getDraftEntryForPreview(id) {
  logger.debug(`Fetching entry ${id} for preview.`);
  logger.time(`[UTIL] getDraftEntryForPreview ${id}`);
  try {
    const record = await pbAdmin.collection("entries_main").getOne(id, {
      expand: "project,custom_documentation_header,custom_documentation_footer,custom_changelog_header,custom_changelog_footer,staged_documentation_header,staged_documentation_footer,staged_changelog_header,staged_changelog_footer",
    });
    logger.timeEnd(`[UTIL] getDraftEntryForPreview ${id}`);
    logger.trace(`Entry ${id} for preview fetched successfully.`);
    return record;
  } catch (error) {
    logger.timeEnd(`[UTIL] getDraftEntryForPreview ${id}`);
    if (error.status === 404) {
      logger.debug(`Entry ${id} for preview not found (404).`);
      return null;
    }
    logger.error(`Failed to fetch entry ${id} for preview: Status ${error?.status || "N/A"}`, error?.message || error);
    if (error?.data) {
      logger.error("PocketBase Error Data:", error.data);
    }
    throw error;
  }
}

export async function getUserTemplates(userId, projectId) {
  const filterParts = [`owner = '${userId}'`];
  if (projectId) {
    filterParts.push(`project = '${projectId}'`);
  }
  const filter = filterParts.join(" && ");
  const fields = "id,name";
  logger.debug(`Fetching templates for user ${userId}, project ${projectId || "N/A"} with filter: ${filter}`);
  logger.time(`[UTIL] getUserTemplates ${userId} ${projectId || "N/A"}`);

  try {
    const templates = await pb.collection("templates").getFullList({
      sort: "name",
      filter: filter,
      fields: fields,
      $autoCancel: false,
    });
    logger.timeEnd(`[UTIL] getUserTemplates ${userId} ${projectId || "N/A"}`);
    logger.trace(`Fetched ${templates.length} templates for user ${userId}, project ${projectId || "N/A"}.`);
    return templates;
  } catch (error) {
    logger.timeEnd(`[UTIL] getUserTemplates ${userId} ${projectId || "N/A"}`);
    logger.error(`Error fetching templates for user ${userId}, project ${projectId || "N/A"}: Status ${error?.status || "N/A"}`, error?.message || error);
    throw error;
  }
}

export async function getTemplateForEditAndProject(templateId, userId, projectId) {
  logger.debug(`Fetching template ${templateId} for edit by user ${userId} in project ${projectId}.`);
  logger.time(`[UTIL] getTemplateForEditAndProject ${templateId}`);
  try {
    const template = await pb.collection("templates").getOne(templateId);
    if (template.owner !== userId || template.project !== projectId) {
      logger.warn(`Forbidden access attempt: User ${userId} tried to edit template ${templateId} (Owner: ${template.owner}, Project: ${template.project}) in project ${projectId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    logger.timeEnd(`[UTIL] getTemplateForEditAndProject ${templateId}`);
    logger.trace(`Template ${templateId} fetched successfully for edit by user ${userId}.`);
    return template;
  } catch (error) {
    logger.timeEnd(`[UTIL] getTemplateForEditAndProject ${templateId}`);
    if (error.status !== 404 && error.status !== 403) {
      logger.error(`Failed to fetch template ${templateId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    } else if (error.status === 404) {
      logger.debug(`Template ${templateId} not found for edit.`);
    }
    throw error;
  }
}

export async function getEntryForOwnerAndProject(entryId, userId, projectId) {
  logger.debug(`Fetching entry ${entryId} for owner ${userId} in project ${projectId}.`);
  logger.time(`[UTIL] getEntryForOwnerAndProject ${entryId}`);
  try {
    const record = await pb.collection("entries_main").getOne(entryId, {
      expand: "custom_documentation_header,custom_documentation_footer,custom_changelog_header,custom_changelog_footer,staged_documentation_header,staged_documentation_footer,staged_changelog_header,staged_changelog_footer",
    });
    if (record.owner !== userId || record.project !== projectId) {
      logger.warn(`Forbidden access attempt: User ${userId} tried to access entry ${entryId} (Owner: ${record.owner}, Project: ${record.project}) in project ${projectId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    logger.timeEnd(`[UTIL] getEntryForOwnerAndProject ${entryId}`);
    logger.trace(`Entry ${entryId} fetched successfully for owner ${userId} in project ${projectId}.`);
    return record;
  } catch (error) {
    logger.timeEnd(`[UTIL] getEntryForOwnerAndProject ${entryId}`);
    if (error.status !== 404 && error.status !== 403) {
      logger.error(`Failed to fetch entry ${entryId} for owner ${userId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    } else if (error.status === 404) {
      logger.debug(`Entry ${entryId} not found for owner ${userId}.`);
    }
    throw error;
  }
}

export async function getArchivedEntryForOwnerAndProject(entryId, userId, projectId) {
  logger.debug(`Fetching archived entry ${entryId} for owner ${userId} in project ${projectId}.`);
  logger.time(`[UTIL] getArchivedEntryForOwnerAndProject ${entryId}`);
  try {
    const record = await pbAdmin.collection("entries_archived").getOne(entryId);
    if (record.owner !== userId || record.project !== projectId) {
      logger.warn(`Forbidden access attempt: User ${userId} tried to access archived entry ${entryId} (Owner: ${record.owner}, Project: ${record.project}) in project ${projectId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    logger.timeEnd(`[UTIL] getArchivedEntryForOwnerAndProject ${entryId}`);
    logger.trace(`Archived entry ${entryId} fetched successfully for owner ${userId} in project ${projectId}.`);
    return record;
  } catch (error) {
    logger.timeEnd(`[UTIL] getArchivedEntryForOwnerAndProject ${entryId}`);
    if (error.status !== 404 && error.status !== 403) {
      logger.error(`Failed to fetch archived entry ${entryId} for owner ${userId} in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    } else if (error.status === 404) {
      logger.debug(`Archived entry ${entryId} not found for owner ${userId}.`);
    }
    throw error;
  }
}

async function getProjectAssets(collectionName, userId, projectId) {
  const filterParts = [`owner = '${userId}'`];
  if (projectId) {
    filterParts.push(`project = '${projectId}'`);
  }
  const filter = filterParts.join(" && ");
  logger.debug(`Fetching ${collectionName} for user ${userId}, project ${projectId || "N/A"} with filter: ${filter}`);
  logger.time(`[UTIL] getProjectAssets ${collectionName} ${userId} ${projectId || "N/A"}`);
  try {
    const assets = await pb.collection(collectionName).getFullList({
      filter: filter,
      sort: "name",
      fields: "id,name",
      $autoCancel: false,
    });
    logger.timeEnd(`[UTIL] getProjectAssets ${collectionName} ${userId} ${projectId || "N/A"}`);
    logger.trace(`Fetched ${assets.length} ${collectionName} for user ${userId}, project ${projectId || "N/A"}.`);
    return assets;
  } catch (error) {
    logger.timeEnd(`[UTIL] getProjectAssets ${collectionName} ${userId} ${projectId || "N/A"}`);
    logger.error(`Error fetching ${collectionName} for user ${userId}, project ${projectId || "N/A"}: Status ${error?.status || "N/A"}`, error?.message || error);
    return [];
  }
}

async function getProjectAssetForEdit(collectionName, assetId, userId, projectId) {
  logger.debug(`Fetching ${collectionName} ${assetId} for edit by user ${userId} in project ${projectId}.`);
  logger.time(`[UTIL] getProjectAssetForEdit ${collectionName} ${assetId}`);
  try {
    const asset = await pb.collection(collectionName).getOne(assetId);
    if (asset.owner !== userId || asset.project !== projectId) {
      logger.warn(`Forbidden access attempt: User ${userId} tried to edit ${collectionName} ${assetId} (Owner: ${asset.owner}, Project: ${asset.project}) in project ${projectId}.`);
      const err = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    logger.timeEnd(`[UTIL] getProjectAssetForEdit ${collectionName} ${assetId}`);
    logger.trace(`${collectionName} ${assetId} fetched successfully for edit by user ${userId}.`);
    return asset;
  } catch (error) {
    logger.timeEnd(`[UTIL] getProjectAssetForEdit ${collectionName} ${assetId}`);
    if (error.status !== 404 && error.status !== 403) {
      logger.error(`Failed to fetch ${collectionName} ${assetId} for edit in project ${projectId}: Status ${error?.status || "N/A"}`, error?.message || error);
    } else if (error.status === 404) {
      logger.debug(`${collectionName} ${assetId} not found for edit.`);
    }
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
    logger.trace(`View log skipped for entry ${entryId} (from_admin=1).`);
    return;
  }

  const userAgent = req.headers["user-agent"] || "";
  const settings = getSettings();
  const botUserAgents = settings.botUserAgents || [];
  const lowerCaseUserAgent = userAgent.toLowerCase();

  for (const botIdentifier of botUserAgents) {
    if (lowerCaseUserAgent.includes(botIdentifier)) {
      logger.trace(`View log skipped for entry ${entryId} due to bot user agent match: ${botIdentifier}. UA: ${userAgent}`);
      return;
    }
  }

  const ipAddress = getIP(req);
  const hashedIP = hashIP(ipAddress);

  if (!entryId) {
    logger.warn("Attempted to log view without entryId.");
    return;
  }

  if (hashedIP) {
    const timeLimit = Math.floor(Date.now() / 1000) - VIEW_TIMEFRAME_HOURS * 60 * 60;
    const checkQuery = "SELECT id FROM view_logs WHERE entry_id = ? AND ip_address = ? AND viewed_at > ? LIMIT 1";
    logger.trace(`Checking view log for entry ${entryId}, IP hash ${hashedIP}, time limit ${timeLimit}.`);

    viewDb.get(checkQuery, [entryId, hashedIP, timeLimit], (err, row) => {
      if (err) {
        logger.error("Error checking view logs:", err.message);
      } else if (!row) {
        logger.debug(`No recent view found for entry ${entryId}, IP hash ${hashedIP}. Logging new view.`);
        const insertQuery = "INSERT INTO view_logs (entry_id, ip_address, viewed_at) VALUES (?, ?, ?)";
        const nowTimestamp = Math.floor(Date.now() / 1000);

        viewDb.run(insertQuery, [entryId, hashedIP, nowTimestamp], (insertErr) => {
          if (insertErr) {
            logger.error("Error inserting view log:", insertErr.message);
          } else {
            logger.trace(`View log inserted for entry ${entryId}.`);
            pbAdmin
              .collection("entries_main")
              .update(entryId, {
                "views+": 1,
              })
              .then(() => {
                logger.trace(`Incremented PocketBase view count for entry ${entryId}.`);
              })
              .catch((pbUpdateError) => {
                if (pbUpdateError?.status !== 404) {
                  logger.error(`Failed to increment PocketBase view count for entry ${entryId} using Admin client: Status ${pbUpdateError?.status || "N/A"}`, pbUpdateError?.message || pbUpdateError);
                } else {
                  logger.warn(`Attempted to increment view count for non-existent entry ${entryId}.`);
                }
              });
          }
        });
      } else {
        logger.trace(`Recent view already logged for entry ${entryId}, IP hash ${hashedIP}. Skipping.`);
      }
    });
  } else {
    logger.warn("Could not determine or hash IP address for view tracking.");
  }
}

export function clearEntryViewLogs(entryId) {
  if (!entryId) {
    logger.warn("Attempted to clear view logs without entryId.");
    return;
  }
  logger.info(`Clearing view logs for entry ${entryId}.`);
  viewDb.run("DELETE FROM view_logs WHERE entry_id = ?", [entryId], (delErr) => {
    if (delErr) {
      logger.error(`Error cleaning view logs for entry ${entryId}:`, delErr.message);
    } else {
      logger.debug(`Successfully cleared view logs for entry ${entryId}.`);
    }
  });
}

export async function logAuditEvent(req, action, targetCollection, targetRecord, details) {
  const settings = getSettings();
  if (!settings.enableAuditLog) {
    logger.trace(`Audit logging disabled. Skipping log for action: ${action}`);
    return;
  }

  if (!action) {
    logger.error("Audit log attempt failed: Action is required.");
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
      logger.warn(`Audit log for action '${action}' is missing user ID.`);
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

  logger.info(`AUDIT: User=${userId || "System/Anon"} Action=${action} Target=${targetCollection || "N/A"}:${targetRecord || "N/A"} IP=${ipAddress || "N/A"}`, details ? `Details=${JSON.stringify(details)}` : "");

  try {
    await pbAdmin.collection("audit_logs").create(logData);
    logger.trace(`Audit log successfully written for action '${action}'.`);
  } catch (error) {
    logger.error(`Failed to write audit log for action '${action}': Status ${error?.status || "N/A"}`, error?.message || error);
    if (error?.data?.data) {
      logger.error("Audit Log Error Details:", error.data.data);
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
  const readingTime = Math.max(1, Math.ceil(minutes));
  logger.trace(`Calculated reading time: ${readingTime} min for ${words} words.`);
  return readingTime;
}

const GITHUB_REPO_URL = "https://api.github.com/repos/devAlphaSystem/Alpha-System-ContentHub/commits";
let latestVersionCache = {
  version: null,
  code: null,
  timestamp: 0,
};
const CACHE_DURATION_MS = 60 * 60 * 1000;

async function fetchLatestCommitVersion() {
  const now = Date.now();
  if (latestVersionCache.version && now - latestVersionCache.timestamp < CACHE_DURATION_MS) {
    logger.trace("[UTIL] Using cached latest version from GitHub.");
    return {
      version: latestVersionCache.version,
      code: latestVersionCache.code,
    };
  }

  logger.debug("[UTIL] Fetching latest commit version from GitHub...");
  logger.time("[UTIL] fetchLatestCommitVersion");
  try {
    const response = await fetch(GITHUB_REPO_URL, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }

    const commits = await response.json();
    if (!Array.isArray(commits) || commits.length === 0) {
      throw new Error("No commits found in the repository.");
    }

    const versionRegex = /Version\s+(\d+\.\d+)(?:\s+Code\s+(\d+))?/i;
    for (const commitData of commits) {
      const message = commitData?.commit?.message;
      if (message) {
        const match = message.match(versionRegex);
        if (match) {
          const version = match[1];
          const code = match[2] ? Number.parseInt(match[2], 10) : null;
          logger.info(`[UTIL] Found latest version in commit: Version ${version}${code ? ` Code ${code}` : ""}`);
          latestVersionCache = { version, code, timestamp: now };
          logger.timeEnd("[UTIL] fetchLatestCommitVersion");
          return { version, code };
        }
      }
    }

    logger.warn("[UTIL] No commit message found matching the version pattern.");
    logger.timeEnd("[UTIL] fetchLatestCommitVersion");
    return { version: null, code: null };
  } catch (error) {
    logger.error(`[UTIL] Failed to fetch or parse latest commit version: ${error.message}`);
    logger.timeEnd("[UTIL] fetchLatestCommitVersion");
    return { version: null, code: null };
  }
}

function parseVersionString(versionStr) {
  if (!versionStr) return null;
  const mainParts = versionStr.split("-");
  const versionParts = mainParts[0].split(".");
  const codePart = mainParts.length > 1 ? mainParts[1] : null;

  return {
    major: Number.parseInt(versionParts[0], 10) || 0,
    minor: Number.parseInt(versionParts[1], 10) || 0,
    code: codePart !== null ? Number.parseInt(codePart, 10) : 0,
  };
}

export async function checkAppVersion(currentVersionStr) {
  logger.debug("[UTIL] Checking application version against latest commit.");

  if (!currentVersionStr || currentVersionStr === "unknown") {
    logger.warn("[UTIL] Current version string not provided to checkAppVersion. Cannot compare.");
    return { updateAvailable: false };
  }

  const currentVersion = parseVersionString(currentVersionStr);

  const latestCommitInfo = await fetchLatestCommitVersion();
  const latestVersionStr = latestCommitInfo.version;
  const latestCode = latestCommitInfo.code;

  if (!latestVersionStr || !currentVersion || latestCode === null) {
    logger.warn("[UTIL] Could not compare versions - missing data (current, latest version string, or latest code).");
    return { updateAvailable: false };
  }

  const latestVersionParts = latestVersionStr.split(".");
  const latestMajor = Number.parseInt(latestVersionParts[0], 10) || 0;
  const latestMinor = Number.parseInt(latestVersionParts[1], 10) || 0;

  let updateAvailable = false;
  const latestVersionDisplay = `Version ${latestVersionStr}${latestCode !== null ? ` Code ${latestCode}` : ""}`;
  const currentVersionDisplay = `Version ${currentVersion.major}.${currentVersion.minor}${currentVersion.code !== 0 ? ` Code ${currentVersion.code}` : ""}`;

  if (latestMajor > currentVersion.major) {
    updateAvailable = true;
  } else if (latestMajor === currentVersion.major && latestMinor > currentVersion.minor) {
    updateAvailable = true;
  } else if (latestMajor === currentVersion.major && latestMinor === currentVersion.minor && latestCode > currentVersion.code) {
    updateAvailable = true;
  }

  logger.debug(`[UTIL] Version check: Current=${currentVersionDisplay}, Latest=${latestVersionDisplay}, Update Available=${updateAvailable}`);
  return {
    updateAvailable,
    latestVersion: latestVersionDisplay,
    currentVersion: currentVersionDisplay,
  };
}
