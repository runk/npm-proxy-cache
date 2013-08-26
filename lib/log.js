
var self = module.exports;

module.exports = function Log(opts) {

  opts = opts || {};
  opts.level = opts.level || self.DEBUG;
  opts.logger = opts.logger || console.log;

  this.log = function(level, args) {
    if (level < opts.level)
      return;

    opts.logger.apply(opts.logger, args);
  };

  this.debug = function() { this.log(self.DEBUG, arguments); };
  this.info  = function() { this.log(self.INFO, arguments); };
  this.warn  = function() { this.log(self.WARN, arguments); };
  this.error = function() { this.log(self.ERROR, arguments); };
  this.fatal = function() { this.log(self.FATAL, arguments); };

};

module.exports.DEBUG = 2;
module.exports.INFO  = 4;
module.exports.WARN  = 8;
module.exports.ERROR = 16;
module.exports.FATAL = 32;
