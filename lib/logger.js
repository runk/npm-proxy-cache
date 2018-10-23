'use strict';
const log4js = require('log4js');

module.exports = function(opts) {
  const appenders = { stdout: { type: 'stdout' } };
  if (opts.logPath) {
    appenders.file = { type: 'file', filename: opts.logPath };
  };

  const categories = {
    default: {
      appenders: Object.keys(appenders),
      level: opts.verbose ? 'debug' : 'info'
    }
  };

  log4js.configure({ appenders, categories });
  return log4js.getLogger();
}
