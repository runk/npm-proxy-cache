'use strict';
const http = require('http');
const net = require('net');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');
const Cache = require('./cache');
const getLogger = require('./logger');


exports.log = null;

exports.cache = null;

exports.opts = {};

// Port or socket path of internal MITM server.
let mitmAddress;

// Random header to prevent sending requests in a cycle
const cycleCheckHeader = 'x-npm-proxy-cache-' + Math.round(Math.random() * 10000);

exports.powerup = function(opts) {

  exports.opts = opts || {};
  opts = exports.opts;

  const options = {
    key: fs.readFileSync(path.join(__dirname, '/../cert/dummy.key'), 'utf8'),
    cert: fs.readFileSync(path.join(__dirname, '/../cert/dummy.crt'), 'utf8')
  };

  this.cache = new Cache({
    path: opts.storage, ttl: opts.ttl, friendlyNames: opts.friendlyNames
  });


  this.log = getLogger(opts);

  // Fake https server aka MITM
  const mitm = https.createServer(options, exports.httpHandler);

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
    mitmAddress = path.join(os.tmpdir(), 'npm-proxy-cache-mitm-' + process.pid + '.sock');

    // Cleanup MITM socket for unix platforms
    if (fs.existsSync(mitmAddress))
      fs.unlinkSync(mitmAddress);
  }

  mitm.listen(mitmAddress);

  // start HTTP server with custom request handler callback function
  const server = http.createServer(exports.httpHandler).listen(opts.port, opts.host, function(err) {
    if (err) throw err;
    const address = server.address();
    exports.log.info('Listening on %s:%s [%d]', address.address, address.port, process.pid);
  });

  // add handler for HTTPS (which issues a CONNECT to the proxy)
  server.addListener('connect', this.httpsHandler);

  return { httpsServer: mitm, httpServer: server };
};


exports.httpHandler = function(req, res) {
  const cache = exports.cache,
    log = exports.log,
    dest = getDestination(req);

  if (!dest) {
    res.writeHead(400);
    res.end('A valid Host header is required.');
    return;
  }

  if (req.headers[cycleCheckHeader]) {
    res.writeHead(502);
    res.end('Sending requests to myself. Stopping to prevent cycles.');
    return;
  }

  const params = {
    headers: {},
    url: dest
  };

  params.headers[cycleCheckHeader] = 1;

  // Carry following headers down to dest npm repository.
  const carryHeaders = ['authorization', 'version', 'referer', 'npm-session', 'user-agent'];
  carryHeaders.forEach(function(name) {
    params.headers[name] = req.headers[name];
  });

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

    const p = cache.getPath(dest);
    log.debug('Cache file:', p.rel);

    log.warn('direct', dest);

    const onResponse = function(err, response) {
      // don't save responses with codes other than 200
      if (!err && response.statusCode === 200) {
        cache.write(dest, response, function(err, meta) {
          if (err) {
            log.error('Unable to cache response:', err);
            res.writeHead(502);
            res.end(err.toString());
            return;
          }

          respondWithCache(dest, cache, meta, res);
        });

      } else {
        // serve expired cache if user wants so
        if (exports.opts.expired && meta.status === Cache.EXPIRED) {
          if (response)
            response.resume();
          return respondWithCache(dest, cache, meta, res);
        }

        log.error('An error occurred: "%s", status code "%s"',
          err ? err.message : 'Unknown',
          response ? response.statusCode : 0
        );

        // clean old cache
        if (meta.status !== Cache.NOT_FOUND)
          cache.unlink(dest);

        if (response)
          response.resume();
        res.writeHead(502);
        res.end(err ? err.toString() : 'Status ' + response.statusCode + ' returned');
      }
    };

    const upstream = requestUpstream(params, null, onResponse.bind(null, null));
    upstream.on('error', onResponse.bind(null));
  });
};


exports.httpsHandler = function(request, socketRequest, bodyhead) {
  const log = exports.log,
    httpVersion = request['httpVersion'];

  log.debug('  = will connect to socket (or port) "%s"', mitmAddress);

  // set up TCP connection
  const proxySocket = new net.Socket();
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
  const log = exports.log;
  params.method = req.method;
  params.headers = Object.assign({}, req.headers, params.headers);
  delete params.headers['proxy-connection'];

  const upstream = requestUpstream(params, req, function(response) {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('error', function(err) {
    log.error('bypass', err);
    if (!res.headersSent)
      res.writeHead(502);
    res.end(err.toString());
  });
}

function requestUpstream(params, source, onResponse) {
  const target = new URL(params.url);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = {};

  Object.keys(params.headers).forEach(function(name) {
    if (params.headers[name] !== undefined)
      headers[name] = params.headers[name];
  });

  const options = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: target.pathname + target.search,
    method: params.method || 'GET',
    headers: headers,
    rejectUnauthorized: false
  };

  if (exports.opts.proxy)
    options.agent = new HttpsProxyAgent(exports.opts.proxy);

  const upstream = transport.request(options, onResponse);
  if (source)
    source.pipe(upstream);
  else
    upstream.end();
  return upstream;
}

function getDestination(req) {
  try {
    if (/^https?:\/\//i.test(req.url))
      return new URL(req.url).toString();
    if (!req.headers.host)
      return null;

    const schema = req.socket.encrypted ? 'https' : 'http';
    return new URL(req.url, schema + '://' + req.headers.host).toString();
  } catch {
    return null;
  }
}


function respondWithCache(dest, cache, meta, res) {
  const log = exports.log;
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
