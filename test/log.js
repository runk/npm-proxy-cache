var assert = require('assert'),
  Log = require('../lib/log');

describe('log', function() {

  describe('constructor()', function() {
    it('should create new instance of Log', function() {
      var log = new Log({ level: Log.DEBUG });
      assert(log instanceof Log);
    });
  });

  describe('log()', function() {
    it('should call logger fn', function(done) {
      var logger = function(arg1, arg2) {
        assert.equal(arg1, 'This %s test');
        assert.equal(arg2, 'is a');
        done();
      }
      var log = new Log({ level: Log.DEBUG, logger: logger });
      log.log(Log.DEBUG, ['This %s test', 'is a']);
    });
  });

  describe('info()', function() {
    it('should call logger fn either', function(done) {
      var logger = function(arg1, arg2) {
        assert.equal(arg1, 'This %s test');
        assert.equal(arg2, 'is a');
        done();
      }
      var log = new Log({ level: Log.DEBUG, logger: logger });
      log.info('This %s test', 'is a');
    });
  });

});
