import { logger } from "../logger.js";

export function projectModuleAccess(module) {
  const fieldMap = {
    documentation: "documentation_enabled",
    changelog: "changelog_enabled",
    roadmap: "roadmap_enabled",
    knowledge_base: "knowledge_base_enabled",
  };
  const field = fieldMap[module];
  if (!field) throw new Error(`Unknown module: ${module}`);

  return (req, res, next) => {
    if (!req.project) {
      logger.warn(`[ModuleAccess] req.project missing for module check (${module}) on path ${req.originalUrl}`);
      return res.status(404).render("errors/404");
    }
    if (req.project[field] === false) {
      logger.info(`[ModuleAccess] Blocked access to disabled module '${module}' for project ${req.project.id} on path ${req.originalUrl}`);
      return res.status(404).render("errors/404");
    }
    next();
  };
}
