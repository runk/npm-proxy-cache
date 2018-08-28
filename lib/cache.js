'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const mkdirp = require('mkdirp');
const mv = require('mv');

function Cache(opts) {
  this.opts = opts || {};
  this.opts.ttl = (opts.ttl || 1800) * 1000;
  this.opts.friendlyNames = opts.friendlyNames;
  this.opts.path = opts.path || path.join(__dirname, '/../cache');

  this.locks = {};
  const nop = function() {};

  this.stat = function(fullpath) {
    if (!fs.existsSync(fullpath))
      return {status: Cache.NOT_FOUND};

    const stat = fs.lstatSync(fullpath);
    stat.type = path.extname(fullpath) ? 'application/octet-stream' : 'application/json';
    stat.status = (Date.now() < stat.ctime.valueOf() + this.opts.ttl)
      ? Cache.FRESH
      : Cache.EXPIRED;

    return stat;
  };


  this.meta = function(key, cb) {
    const self = this;
    const fullpath = this.getPath(key).full;
    const stat = this.stat(fullpath);

    if (stat.status === Cache.NOT_FOUND || stat.status === Cache.EXPIRED)
      return cb(null, stat);

    if (!this.locks[key])
      return cb(null, stat);

    // wait until lock releases
    // generally when file is locked means that process is writing to file right now
    (function wait() {
      if (self.locks[key])
        return setTimeout(wait, 100);

      // need to acquire new fstat, since file has been changed
      cb(null, self.stat(fullpath));
    })();
  };


  this.read = function(key) {
    const pathInfo = this.getPath(key);
    const file = fs.createReadStream(pathInfo.full);

    file.on('finish', function() {
      file.close(nop);
    });

    return file;
  };


  this.write = function(key, readStream, cb) {
    const locks = this.locks;
    const pathInfo = this.getPath(key);
    const self = this;

    // Create a lock
    locks[key] = true;

    mkdirp.sync(pathInfo.dir, 511); // 511 is decimal equvivalent of 0777

    // On top of locking mechanism, doing write to a temp location, and
    // when it's finish moving the data file to its final destination.
    const tmpPath = path.join(os.tmpdir(), pathInfo.file + '-' + Math.round(Math.random() * 1e9).toString(36));

    const writeStream = fs.createWriteStream(tmpPath);
    readStream.pipe(writeStream);

    writeStream.on('finish', function() {
      writeStream.close(nop);

      // Release the lock, move data file to final destination.
      delete (locks[key]);
      mv(tmpPath, pathInfo.full, function(err) {
        if (err) { return cb(err); }
        self.meta(key, cb);
      });
    });
  };


  this.getPath = function(key) {
    let file;
    let base;

    if (this.opts.friendlyNames) {
      // The key is the URL; the last part is the module name and if
      // the last version is requested, it lacks the file extension
      file = path.basename(key);
      // Cut the version suffix and file extension; only module name
      // should make the directory, make sure that there is no dot as
      // directory name coming from the first characters of the file name
      base = file.replace(/(-\d\.\d.\d)?\.tgz/, '').replace(/\./g, '-');
    } else {
      file = crypto.createHash('md5').update(key).digest('hex')
        .substring(0, 8) + path.extname(key);

      base = file;
    }
    // Make sure that there are always 3 nested directories to avoid
    // both file and folder at the same level (/q/q, /q/q/qq)
    const chunks = base.split('').splice(0, 3);
    while (chunks.length < 3)
      chunks.push('-');
    const dir = chunks.join('/');

    return {
      dir: path.join(this.opts.path, dir),
      full: path.join(this.opts.path, dir, file),
      file: file,
      rel: path.join(dir, file)
    };
  };


  this.unlink = function(key) {
    delete (this.locks[key]);
    fs.unlinkSync(this.getPath(key).full);
  };

}

Cache.NOT_FOUND = 0;
Cache.EXPIRED = 2;
Cache.FRESH = 4;

module.exports = Cache;
