import "dotenv/config";

const LOG_LEVELS = {
  NONE: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  TRACE: 5,
};

const configuredLevelName = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const configuredLevel = LOG_LEVELS[configuredLevelName] !== undefined ? LOG_LEVELS[configuredLevelName] : LOG_LEVELS.INFO;

const timers = {};

function log(level, ...args) {
  if (level <= configuredLevel) {
    const timestamp = new Date().toISOString();
    const levelName = Object.keys(LOG_LEVELS).find((key) => LOG_LEVELS[key] === level);
    console.log(`[${timestamp}] [${levelName}]`, ...args);
  }
}

export const logger = {
  error: (...args) => log(LOG_LEVELS.ERROR, ...args),
  warn: (...args) => log(LOG_LEVELS.WARN, ...args),
  info: (...args) => log(LOG_LEVELS.INFO, ...args),
  debug: (...args) => log(LOG_LEVELS.DEBUG, ...args),
  trace: (...args) => log(LOG_LEVELS.TRACE, ...args),

  time: (label) => {
    if (configuredLevel >= LOG_LEVELS.DEBUG) {
      timers[label] = Date.now();
    }
  },

  timeEnd: (label) => {
    if (configuredLevel >= LOG_LEVELS.DEBUG && timers[label] !== undefined) {
      const duration = Date.now() - timers[label];
      log(LOG_LEVELS.DEBUG, `${label}: ${duration}ms`);
      delete timers[label];
    }
  },

  getConfiguredLevel: () => configuredLevelName,
};

logger.info(`Logger initialized with level: ${logger.getConfiguredLevel()}`);
