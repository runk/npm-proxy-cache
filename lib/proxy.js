var http = require('http'),
  net = require('net'),
  https = require('https'),
  fs = require('fs'),
  os = require('os'),
  request = require('request'),
  url = require('url'),
  log4js = require('log4js');
  Cache = require('./cache');


// socket path for system mitm https server
var mitmSocketPath = os.tmpdir() + '/mitm.sock';


exports.log = null;

exports.cache = null;

exports.opts = {};


exports.powerup = function(opts) {

  exports.opts = opts || {};

  var options = {
    key: fs.readFileSync(__dirname + '/../cert/dummy.key', 'utf8'),
    cert: fs.readFileSync(__dirname + '/../cert/dummy.crt', 'utf8')
  };

  this.cache = new Cache({
    path: opts.storage, ttl: opts.ttl, friendlyNames: opts.friendlyNames
  });

  this.log = log4js.getLogger('proxy');
  this.log.setLevel(opts.verbose ? 'DEBUG' : 'INFO');
  if (opts.logPath) {
	log4js.loadAppender('file');
	log4js.addAppender(log4js.appenders.file(opts.logPath), 'proxy');
  }

  // make sure there's no previously created socket
  if (fs.existsSync(mitmSocketPath))
    fs.unlinkSync(mitmSocketPath);

  // fake https server, MITM if you want
  https.createServer(options, this.handler).listen(mitmSocketPath);

  // start HTTP server with custom request handler callback function
  var server = http.createServer(this.handler).listen(opts.port, opts.host, function(err) {
    if (err) throw err;
    exports.log.info('Listening on %s:%s [%d]', opts.host, opts.port, process.pid);
  });

  // add handler for HTTPS (which issues a CONNECT to the proxy)
  server.addListener('connect', this.httpsHandler);
};


exports.handler = function(req, res) {
  var cache = exports.cache,
    log = exports.log,
    path = url.parse(req.url).path,
    schema = Boolean(req.client.pair) ? 'https' : 'http',
    dest = schema + '://' + req.headers['host'] + path;

  var params = {
    url: dest,
    rejectUnauthorized: false
  };

  if (exports.opts.proxy)
    params.proxy = exports.opts.proxy;

  // Skipping other than GET methods
  if (req.method !== 'GET')
    return bypass(req, res, params);

  cache.meta(dest, function(err, meta) {
    if (err)
      throw err;

    if (meta.status === Cache.FRESH)
      return respondWithCache(dest, cache, meta, res);

    var p = cache.getPath(dest);
    log.debug('Cache file:', p.rel);

    log.warn('direct', dest);

    var onResponse = function(err, response) {
      // don't save responses with codes other than 200
      if (!err && response.statusCode === 200) {
        var file = cache.write(dest);
        r.pipe(file);
        r.pipe(res, {end: false});

      } else {
        // serve expired cache if user wants so
        if (exports.opts.expired && meta.status === Cache.EXPIRED)
          return respondWithCache(dest, cache, meta, res);

        log.error('An error occcured: "%s", status code "%s"',
          err ? err.message : 'Unknown',
          response ? response.statusCode : 0
        );

        // clean old cache
        if (meta.status !== Cache.NOT_FOUND)
          cache.unlink(dest);

        res.end(err ? err.toString() : 'Status ' + response.statusCode + ' returned');
      }
    }

    var r = request(params);
    r.on('response', onResponse.bind(null, null));
    r.on('error', onResponse.bind(null));
    r.on('end', function() {
      log.debug('end');
    });
  });
};


exports.httpsHandler = function(request, socketRequest, bodyhead) {
  var log = exports.log,
    url = request['url'],
    httpVersion = request['httpVersion'];

  log.debug('  = will connect to socket "%s"', mitmSocketPath);

  // set up TCP connection
  var proxySocket = new net.Socket();
  proxySocket.connect(mitmSocketPath, function() {
    log.debug('< connected to socket "%s"', mitmSocketPath);
    log.debug('> writing head of length %d', bodyhead.length);

    proxySocket.write(bodyhead);

    // tell the caller the connection was successfully established
    socketRequest.write('HTTP/' + httpVersion + ' 200 Connection established\r\n\r\n');
  });

  proxySocket.on('data', function(chunk) {
    log.debug('< data length = %d', chunk.length);
    socketRequest.write(chunk);
  });

  proxySocket.on('end', function() {
    log.debug('< end');
    socketRequest.end();
  });

  socketRequest.on('data', function(chunk) {
    log.debug('> data length = %d', chunk.length);
    proxySocket.write(chunk);
  });

  socketRequest.on('end', function() {
    log.debug('> end');
    proxySocket.end();
  });

  proxySocket.on('error', function(err) {
    socketRequest.write('HTTP/' + httpVersion + ' 500 Connection error\r\n\r\n');
    log.error('< ERR: %s', err);
    socketRequest.end();
  });

  socketRequest.on('error', function(err) {
    log.error('> ERR: %s', err);
    proxySocket.end();
  });
};


function bypass(req, res, params) {
  var length = parseInt(req.headers['content-length']);

  if (isNaN(length) || !isFinite(length))
    throw new Error('Content-Length header not found or invalid');

  var raw = new Buffer(length),
    pointer = 0;

  req.on('data', function(chunk) {
    chunk.copy(raw, pointer);
    pointer += chunk.length;
  });

  req.on('end', function() {
    params.method = req.method;
    params.body = raw;
    params.headers = {
      'Content-Type': req.headers['content-type']
    };
    return request(params).pipe(res);
  });
}


function respondWithCache(dest, cache, meta, res) {
  var log = exports.log;
  log.info('cache', dest);
  log.debug('size: %s, type: "%s", ctime: %d', meta.size, meta.type, meta.ctime.valueOf());
  res.setHeader('Content-Length', meta.size);
  res.setHeader('Content-Type', meta.type);
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Cache-Hit', 'true');
  return cache.read(dest).pipe(res);
}
