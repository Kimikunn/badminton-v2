/**
 * Simple logger
 */
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 1;

function formatMessage(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  return `[${ts}] ${level.toUpperCase()}: ${msg}`;
}

module.exports = {
  debug: (msg) => currentLevel <= 0 && console.log(formatMessage('debug', msg)),
  info: (msg) => currentLevel <= 1 && console.log(formatMessage('info', msg)),
  warn: (msg) => currentLevel <= 2 && console.warn(formatMessage('warn', msg)),
  error: (msg) => currentLevel <= 3 && console.error(formatMessage('error', msg))
};
