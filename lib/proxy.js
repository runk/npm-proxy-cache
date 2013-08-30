var http = require('http'),
  net = require('net'),
  https = require('https'),
  fs = require('fs'),
  request = require('request'),
  url = require('url'),
  log4js = require('log4js');
  Cache = require('./cache');


module.exports.log = null;

module.exports.cache = null;


module.exports.powerup = function(opts) {

  var options = {
    key: fs.readFileSync(__dirname + '/../cert/dummy.key', 'utf8'),
    cert: fs.readFileSync(__dirname + '/../cert/dummy.crt', 'utf8')
  };

  this.cache = new Cache({ path: opts.storage, ttl: opts.ttl });

  this.log = log4js.getLogger('proxy');
  this.log.setLevel(opts.verbose ? 'DEBUG' : 'INFO');

  // fake https server, MITM if you want
  https.createServer(options, this.handler).listen(8081);

  // start HTTP server with custom request handler callback function
  var server = http.createServer(this.handler).listen(opts.port, opts.host, function(err) {
    if (err) throw err;
    module.exports.log.info('Listening on %s:%s [%d]', opts.host, opts.port, process.pid);
  });

  // add handler for HTTPS (which issues a CONNECT to the proxy)
  server.addListener('connect', this.httpsHandler);
};


module.exports.handler = function(req, res) {
  var cache = module.exports.cache,
    log = module.exports.log,
    path = url.parse(req.url).path,
    schema = Boolean(req.client.pair) ? 'https' : 'http',
    dest = schema + '://' + req.headers['host'] + path;

  var params = {
    url: dest,
    rejectUnauthorized: false
  };

  // skip other than GET methods
  // TODO: pass orig params!
  if (req.method !== 'GET')
    return request(params).pipe(res);


  cache.meta(dest, function(err, meta) {
    if (err) throw err;

    if (meta) {
      log.info('cache', dest);
      log.debug('size: %s, type: "%s", ctime: %d', meta.size, meta.type, meta.ctime.valueOf());
      res.setHeader('Content-Length', meta.size);
      res.setHeader('Content-Type', meta.type);
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Cache-Hit', 'true');
      return cache.read(dest).pipe(res);
    }

    var p = cache.getPath(dest);
    log.debug('Cache file:', p.rel);

    log.warn('direct', dest);

    var file = cache.write(dest);
    var r = request(params, function(err, response) {
      // don't save responses with codes other than 200
      if (err || response.statusCode !== 200) {
        log.error('An error occcured: "%s", status code "%s"',
          err ? err.message : 'Unknown',
          response ? response.statusCode : 0
        );
        cache.unlink(dest);
      }
    });

    r.pipe(file);
    r.pipe(res);
  });
};


module.exports.httpsHandler = function(request, socketRequest, bodyhead) {
  var log = module.exports.log,
    url = request['url'],
    httpVersion = request['httpVersion'],
    hostport = ['localhost', 8081];

  log.debug('  = will connect to %s:%s', hostport[0], hostport[1]);

  // set up TCP connection
  var proxySocket = new net.Socket();
  proxySocket.connect(hostport[1], hostport[0], function() {
    log.debug('< connected to %s:%s', hostport[0], hostport[1]);
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
