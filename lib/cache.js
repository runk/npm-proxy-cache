var url = require('url'),
  path = require('path'),
  fs = require('fs'),
  crypto = require('crypto'),
  mkdirp = require('mkdirp');


module.exports = function Cache(opts) {

  opts = opts || {}
  opts.ttl = opts.ttl || 1800;
  opts.path = opts.path || __dirname + '/../cache'

  this.locks = {};

  this.gc = function() {};

  this.stat = function(fullpath) {
    var stat = fs.lstatSync(fullpath);
    stat.type = path.extname(fullpath) ? 'application/octet-stream' : 'application/json';
    return stat;
  };

  this.meta = function(key, cb) {
    var self = this,
      fullpath = this.getPath(key).full;

    if (!fs.existsSync(fullpath))
      return cb(null);

    var stat = this.stat(fullpath);
    if (Date.now() > stat.ctime.valueOf() + opts.ttl * 1000)
      return cb(null);

    if (!this.locks[key])
      return cb(null, stat);

    // wait until lock is released
    (function wait() {
      if (self.locks[key])
        return setTimeout(wait, 100);

      // need to acquire new fstat, since file has been changed
      cb(null, self.stat(fullpath));
    })();
  };


  this.read = function(key) {
    var path = this.getPath(key);

    var file = fs.createReadStream(path.full);
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

    var file = crypto.createHash('md5').update(key).digest('hex').substring(0, 8) + path.extname(key);
    var dir = file.split('').splice(0, 3).join('/');

    return {
      dir: path.join(opts.path, dir),
      full: path.join(opts.path, dir, file),
      file: file,
      rel: path.join(dir, file)
    }
  };

  this.unlink = function(key) {
    fs.unlinkSync(this.getPath(key).full);
  };

};
