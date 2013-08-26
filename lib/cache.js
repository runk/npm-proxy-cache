var url = require('url'),
  path = require('path'),
  fs = require('fs'),
  mkdirp = require('mkdirp');


module.exports = function Cache(opts) {

  opts = opts || {}
  opts.ttl = opts.ttl || 1800;
  opts.path = opts.path || __dirname + '/../cache'


  this.gc = function() {};


  this.has = function(key) {
    var fullpath = this.getPath(key).full;
    if (!fs.existsSync(fullpath))
      return false;

    var ctime = fs.lstatSync(fullpath).ctime.valueOf();
    if (Date.now() > ctime + opts.ttl * 1000)
      return false;

    return true;
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
    var path = this.getPath(key);

    mkdirp.sync(path.dir, 0755);

    var file = fs.createWriteStream(path.full);
    file.on('finish', function() {
      file.close();
    });

    return file;
  };


  this.getPath = function(key) {
    var query = url.parse(key).path.split('/').filter(function(chunk) {
      return (!chunk || /\.\./.test(chunk)) ? false : true;
    }).join('/');

    return {
      dir: path.join(opts.path, path.dirname(query)),
      file: path.basename(query),
      full: path.join(opts.path, query)
    }
  };

};
