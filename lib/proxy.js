'use strict';
var http = require('http'),
  net = require('net'),
  https = require('https'),
  fs = require('fs'),
  os = require('os'),
  url = require('url'),
  path = require('path'),
  request = require('request'),
  log4js = require('log4js');

var Cache = require('./cache');


// To avoid 'DEPTH_ZERO_SELF_SIGNED_CERT' error on some setups
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

exports.log = null;

exports.cache = null;

exports.opts = {};

// Port or socket path of internal MITM server.
var mitmAddress;

// Random header to prevent sending requests in a cycle
var cycleCheckHeader = 'x-npm-proxy-cache-' + Math.round(Math.random() * 10000);

exports.powerup = function(opts) {

  exports.opts = opts || {};

  var options = {
    key: fs.readFileSync(path.join(__dirname, '/../cert/dummy.key'), 'utf8'),
    cert: fs.readFileSync(path.join(__dirname, '/../cert/dummy.crt'), 'utf8')
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

  // Fake https server aka MITM
  var mitm = https.createServer(options, exports.httpHandler);

  // NOTE: for windows platform user has to specify port, since
  // it does not support unix sockets.
  if (/^win/i.test(process.platform) && !isNumeric(opts.internalPort)) {
    console.error('Error: On Windows platform you have to specify internal port,\n'
      + 'for example `--internal-port 8081`.');
    process.exit(1);
  }
  if (opts.internalPort) {
    mitmAddress = opts.internalPort;

  } else {
    mitmAddress = path.join(os.tmpdir(), 'mitm.sock');

    // Cleanup MITM socket for unix platforms
    if (fs.existsSync(mitmAddress))
      fs.unlinkSync(mitmAddress);
  }

  mitm.listen(mitmAddress);

  // start HTTP server with custom request handler callback function
  var server = http.createServer(exports.httpHandler).listen(opts.port, opts.host, function(err) {
    if (err) throw err;
    exports.log.info('Listening on %s:%s [%d]', opts.host, opts.port, process.pid);
  });

  // add handler for HTTPS (which issues a CONNECT to the proxy)
  server.addListener('connect', this.httpsHandler);
};


exports.httpHandler = function(req, res) {
  var cache = exports.cache,
    log = exports.log,
    path = url.parse(req.url).path,
    schema = req.client.pair || req.connection.encrypted ? 'https' : 'http',
    dest = schema + '://' + req.headers['host'] + path;

  if (req.headers[cycleCheckHeader]) {
    res.writeHead(502);
    res.end('Sending requests to myself. Stopping to prevent cycles.');
    return;
  }

  var params = {
    headers: {},
    rejectUnauthorized: false,
    url: dest
  };

  params.headers[cycleCheckHeader] = 1;

  // Carry following headers down to dest npm repository.
  var carryHeaders = ['authorization', 'version', 'referer', 'npm-session', 'user-agent'];
  carryHeaders.forEach(function(name) {
    params.headers[name] = req.headers[name];
  });

  if (exports.opts.proxy)
    params.proxy = exports.opts.proxy;


  // Skipping other than GET methods
  // Skipping metadata requests when configured
  if (
    req.method !== 'GET' ||
    (exports.opts.metadataExcluded && req.headers['accept'] === 'application/json')
  )
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
        cache.write(dest, r, function(err, meta) {
          if (err)
            throw err;

          respondWithCache(dest, cache, meta, res);
        });

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
    };

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
    httpVersion = request['httpVersion'];

  log.debug('  = will connect to socket (or port) "%s"', mitmAddress);

  // set up TCP connection
  var proxySocket = new net.Socket();
  proxySocket.connect(mitmAddress, function() {
    log.debug('< connected to socket (or port) "%s"', mitmAddress);
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
    log.error('< ERR: %s', err.toString());
    socketRequest.end();
  });

  socketRequest.on('error', function(err) {
    log.error('> ERR: %s', err.toString());
    proxySocket.end();
  });
};


function bypass(req, res, params) {
  var length = parseInt(req.headers['content-length']);
  var log = exports.log;

  var onEnd = function(params, res) {
    return request(params)
      .on('error', function(err) {
        log.error('bypass', err);
      })
      .pipe(res, { end: false });
  };

  if (!isFinite(length)) {
    onEnd(params, res);
    return;
  }

  var raw = new Buffer(length),
    pointer = 0;

  req.on('data', function(chunk) {
    chunk.copy(raw, pointer);
    pointer += chunk.length;
  });

  req.on('end', function() {
    params.method = req.method;
    if (raw.length > 0) {
      params.body = raw;
    }
    params.headers = {
      'Content-Type': req.headers['content-type']
    };
    onEnd(params, res);
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

function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}
