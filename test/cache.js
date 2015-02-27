var assert = require('assert'),
  rimraf = require('rimraf'),
  fs = require('fs'),
  Cache = require('../lib/cache');

describe('cache', function() {

  var opts;
  var path = __dirname + '/cache';
  beforeEach(function() {
    opts = {path: path, ttl: 10};
  });

  before(function(done) {
    rimraf(path, done);
  });

  after(function(done) {
    rimraf(path, done);
  });


  describe('constructor()', function() {
    it('should create new instance of Cache', function() {
      var cache = new Cache(opts);
      assert(cache instanceof Cache);
    });
  });


  describe('set()', function() {
    it('should create new write stream', function() {
      var cache = new Cache(opts);
      var file = cache.write('/-/foo/bar.dat');
      file.end(new Buffer('This is a test'));
    });
  });


  describe('get()', function() {
    it('should create new read stream', function(done) {
      var cache = new Cache(opts);
      var readable = cache.read('/-/foo/bar.dat');

      readable.setEncoding('utf8');
      readable.on('data', function(data) {
        assert.equal(typeof data, 'string');
        assert.equal(data.toString(), 'This is a test');
        done();
      });

      readable.read();
    })
  });


  describe('meta()', function() {
    it('should return meta', function(done) {
      var cache = new Cache(opts);
      cache.meta('/-/foo/bar.dat', function(err, meta) {
        if (err) return done(err);
        assert.equal(meta.size, 14);
        assert.equal(meta.type, 'application/octet-stream');
        assert.equal(meta.status, Cache.FRESH);
        done();
      });
    });

    it('should return NOT_FOUND status', function(done) {
      var cache = new Cache(opts);
      cache.meta('/la/la', function(err, meta) {
        if (err) return done(err);
        assert.deepEqual(meta, {status: Cache.NOT_FOUND});
        done();
      });
    });
  });


  describe('getPath()', function() {
    it('return path info', function() {
      var cache = new Cache(opts);
      var path = cache.getPath('/foo/bar/-/../baz.tgz');
      assert.equal(path.dir, opts.path + '/f/a/7');
      assert.equal(path.file, 'fa7bf9eb.tgz');
      assert.equal(path.full, opts.path + '/f/a/7/fa7bf9eb.tgz');
      assert.equal(path.rel, 'f/a/7/fa7bf9eb.tgz');
    });

    describe ('given the friendlyNames option is set', function () {
      var cache;

      beforeEach(function() {
        opts.friendlyNames = true;
        cache = new Cache(opts);
      });

      it('uses just the module name from the URL', function () {
        var path = cache.getPath('http://registry/test');
        assert.equal(path.dir, opts.path + '/t/e/s');
        assert.equal(path.file, 'test');
        assert.equal(path.full, opts.path + '/t/e/s/test');
        assert.equal(path.rel, 't/e/s/test');
      });

      it('cuts the file extension from the module URL', function () {
        var path = cache.getPath('http://registry/test.tgz');
        assert.equal(path.dir, opts.path + '/t/e/s');
        assert.equal(path.file, 'test.tgz');
        assert.equal(path.full, opts.path + '/t/e/s/test.tgz');
        assert.equal(path.rel, 't/e/s/test.tgz');
      });

      it('cuts the version suffix from the module URL', function () {
        var path = cache.getPath('http://registry/test-1.2.3.tgz');
        assert.equal(path.dir, opts.path + '/t/e/s');
        assert.equal(path.file, 'test-1.2.3.tgz');
        assert.equal(path.full, opts.path + '/t/e/s/test-1.2.3.tgz');
        assert.equal(path.rel, 't/e/s/test-1.2.3.tgz');
      });

      it('uses hyphens instead of dots in the directory structure', function () {
        var path = cache.getPath('http://registry/te.st');
        assert.equal(path.dir, opts.path + '/t/e/-');
        assert.equal(path.file, 'te.st');
        assert.equal(path.full, opts.path + '/t/e/-/te.st');
        assert.equal(path.rel, 't/e/-/te.st');
      });

      it('uses short direcory structure for short module name', function () {
        var path = cache.getPath('http://registry/q');
        assert.equal(path.dir, opts.path + '/q/-/-');
        assert.equal(path.file, 'q');
        assert.equal(path.full, opts.path + '/q/-/-/q');
        assert.equal(path.rel, 'q/-/-/q');
      });

      it('cuts the version suffix and file extension from short module names', function () {
        var path = cache.getPath('http://registry/q-1.2.3.tgz');
        assert.equal(path.dir, opts.path + '/q/-/-');
        assert.equal(path.file, 'q-1.2.3.tgz');
        assert.equal(path.full, opts.path + '/q/-/-/q-1.2.3.tgz');
        assert.equal(path.rel, 'q/-/-/q-1.2.3.tgz');
      });
    });
  });

});
