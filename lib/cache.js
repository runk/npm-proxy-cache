var path = require('path'),
  fs = require('fs'),
  crypto = require('crypto'),
  mkdirp = require('mkdirp');


function Cache(opts) {

  this.opts = opts || {}
  this.opts.ttl = (opts.ttl || 1800) * 1000;
  this.opts.friendlyNames = opts.friendlyNames;
  this.opts.path = opts.path || __dirname + '/../cache';

  this.locks = {};


  this.stat = function(fullpath) {
    if (!fs.existsSync(fullpath))
      return {status: Cache.NOT_FOUND};

    var stat = fs.lstatSync(fullpath);
    stat.type = path.extname(fullpath) ? 'application/octet-stream' : 'application/json';
    stat.status = (Date.now() < stat.ctime.valueOf() + this.opts.ttl)
      ? Cache.FRESH
      : Cache.EXPIRED;

    return stat;
  };


  this.meta = function(key, cb) {
    var self = this,
      fullpath = this.getPath(key).full,
      stat = this.stat(fullpath),
      maxTimeWait = 50000;

    if (stat.status === Cache.NOT_FOUND || stat.status === Cache.EXPIRED)
      return cb(null, stat);
    if (!this.locks[key])
      return cb(null, stat);

     var remainingTime = maxTimeWait;
    // wait until lock releases
    // generally when file is locked means that process is writing to file right now
    (function wait() {
      if (self.locks[key]) {
        remainingTime -= 1000;
        if (remainingTime < 0) {
          cb(new Error("Waited too long to get lock for " + key));
        }
        return setTimeout(wait, 1000);
      }

      // need to acquire new fstat, since file has been changed
      cb(null, self.stat(fullpath));
    })();
  };


  this.read = function(key) {
    var path = this.getPath(key),
      file = fs.createReadStream(path.full);
    file.on('finish', function() {
      file.close();
    });

    return file;
  };


  this.write = function(key) {
    var locks = this.locks,
      path = this.getPath(key);

    // create lock
    locks[key] = true;

    mkdirp.sync(path.dir, 0755);

    var file = fs.createWriteStream(path.full);
    file.on('finish', function() {
      // release lock
      delete(locks[key]);
      file.close();
    });

    return file;
  };


  this.getPath = function(key) {
    var file, base, chunks, dir;
    if (this.opts.friendlyNames) {
      // The key is the URL; the last part is the module name and if
      // the last version is requested, it lacks the file extension
      file = path.basename(key);
      // Cut the version suffix and file extension; only module name
      // should make the directory, make sure that there is no dot as
      // directory name coming from the first characters of the fike name
      base = file.replace(/(-\d\.\d.\d)?\.tgz/, '').replace(/\./g, '-');
    } else {
      file = crypto.createHash('md5').update(key).digest('hex')
                 .substring(0, 8) + path.extname(key);
      base = file;
    }
    // Make sure that there are always 3 nested directories to avoid
    // both file and folder at the same level (/q/q, /q/q/qq)
    chunks = base.split('').splice(0, 3);
    while (chunks.length < 3)
      chunks.push('-');
    dir = chunks.join('/');

    return {
      dir: path.join(this.opts.path, dir),
      full: path.join(this.opts.path, dir, file),
      file: file,
      rel: path.join(dir, file)
    };
  };


  this.unlink = function(key) {
    delete(this.locks[key]);
    fs.unlinkSync(this.getPath(key).full);
  };

};

Cache.NOT_FOUND = 0;
Cache.EXPIRED   = 2;
Cache.FRESH     = 4;

module.exports = Cache;
