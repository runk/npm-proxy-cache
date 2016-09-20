var http = require('http'),
  net = require('net'),
  https = require('https'),
  fs = require('fs'),
  os = require('os'),
  url = require('url'),
  path = require('path'),
  request = require('request'),
  log4js = require('log4js'),
  hashFiles = require('hash-files'),
  childProcess = require('child_process');
  Cache = require('./cache');

// To avoid 'DEPTH_ZERO_SELF_SIGNED_CERT' error on some setups
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

exports.log = null;

exports.cache = null;

exports.opts = {};

// Port or socket path of internal MITM server.
var mitmAddress;


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

  // Fake https server aka MITM
  var mitm = https.createServer(options, exports.httpHandler);

  // NOTE: for windows platform user has to specify port, since
  // it does not support unix sockets.
  if (/^win/i.test(process.platform) && !isNumeric(opts.internalPort)) {
    console.error('Error: On Windows platform you have to specify internal port,\n'
      +'for example `--internal-port 8081`.');
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

function isTgzCacheUsable(requestPath, cachePath, urlHost) {
  var name = path.basename(requestPath),
    log = exports.log;
    
  log.debug("Start verifying tgz: " + requestPath);
  
  // check md5 sum of a file
  // Examples of names:
  //  double-ended-queue-2.1.0-0.tgz
  //  double-ended-queue-2.1.0.tgz
  //  dateformat-1.0.2-1.2.3.tgz
  //  jju-1.3.0.tgz
  var match = name.match(/(.+?)-(\d+?\.\d+?\.\d+?(?:.*?))\.tgz/);
  if (match && match[1] && match[2]) {
    log.debug("Name of plugin: " + match[1] + ", version is " + match[2]);

    var requestUrl = urlHost + "/" + match[1],
      cache = exports.cache,
      fullPath = cache.getPath(requestUrl).full;

    if (!fs.existsSync(cachePath.full)) {
      log.info("Path: " + cachePath.full + " for " + requestPath + " does not exist. It will be downloaded.");
      return false;
    }
    
    var expectedShasum;
    if (!fs.existsSync(fullPath)) {
      // TODO:
      // Possible improvement is to call the requestUrl and cache the result. This way the cachePath.full will work.
      log.info("Path: " + fullPath + " for " + requestUrl + " does not exist. ");
      try {
        // TODO:
        // Possible improvement is to execute `let content = childProcess.execSync(npm view match[1])` and save the file in the cache
        // fs.writeFileSync(fullPath, JSON.stringify(JSON.parse(content)))        
        var npmViewCommand = "npm view " + match[1] + "@" + match[2] + " dist.shasum";
        log.debug("Execute " + npmViewCommand);
        expectedShasum = (childProcess.execSync(npmViewCommand, { timeout: 10000 }) || '').toString().trim();
      } catch (err) {
        log.info("Unable to get data for " + cachePath.full + " from npm. Tgz cannot be verified, return it to the client, so it's npm will verify the shasum.")
        log.debug("Error is: ", err);

        return true;
      }  
    } else {
      var jsonData = JSON.parse(fs.readFileSync(fullPath));
      expectedShasum = jsonData && jsonData.versions && 
        jsonData.versions[match[2]] && jsonData.versions[match[2]].dist && jsonData.versions[match[2]].dist.shasum;
    }
    
    var actualShasum = hashFiles.sync({ files: [cachePath.full], noGlob: true });
    
    log.debug("Expected shasum: " + expectedShasum);
    log.debug("Actual shasum:   " + actualShasum);
    
    return expectedShasum === actualShasum;
  }
  
  return true;
}

exports.httpHandler = function(req, res) {
  var cache = exports.cache,
    log = exports.log,
    path = url.parse(req.url).path,
    schema = Boolean(req.client.pair) ? 'https' : 'http',
    urlHost = schema + '://' + req.headers['host'],
    dest = urlHost + path;
  
  log.debug("httpHandler called");
  
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
    
    var p = cache.getPath(dest),
      isTgz = require("path").extname(dest) === ".tgz";

    if ((meta.status === Cache.FRESH && !isTgz) || (isTgz && isTgzCacheUsable(dest, p, urlHost)) )
      return respondWithCache(dest, cache, meta, res);

    log.debug('Cache file:', p.rel);

    log.warn('direct', dest);

    var onResponse = function(err, response) {
      // don't save responses with codes other than 200
      if (!err && response.statusCode === 200) {
        log.debug('Write to cache: ', dest);
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
  
  var destStream = cache.read(dest);
  destStream.on('end', function() {
    log.debug('Dest stream on end: ', dest);
  });
  
  destStream.on('finish', function() {
    log.debug('Dest stream on finish: ', dest);
  });
  
  destStream.on('close', function() {
    log.debug('Dest stream on close: ', dest);
  });
  
  res.on('end', function() {
    log.debug('Res stream on end: ', dest);
  });
  
  res.on('finish', function() {
    log.debug('Res stream on finish: ', dest);
  });
  
  res.on('close', function() {
    log.debug('Res stream on close: ', dest);
  }); 
  
  return destStream.pipe(res);
}

function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n);
}
