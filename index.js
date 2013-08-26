var http = require('http'),
  net = require('net'),
  https = require('https'),
  fs = require('fs'),
  request = require('request'),
  url = require('url');

var Cache = require('./lib/cache'),
  Log = require('./lib/log');


var options = {
  key: fs.readFileSync('cert/dummy.key', 'utf8'),
  cert: fs.readFileSync('cert/dummy.crt', 'utf8')
};

var cache = new Cache({
  path: __dirname + '/cache',
  ttl: 1800
});

var log = new Log({level: Log.DEBUG });



var handler = function(req, res) {
  var path = url.parse(req.url).path;

  log.debug('Request received: %s', path);

  var params = {
    url: 'https://registry.npmjs.org' + path,
    rejectUnauthorized: false
  };


  if (cache.has(path)) {
    log.debug('Returning cache for %s', path);
    return cache.read(path).pipe(res);
  }

  log.debug('Fetching %s directly', path);
  var file = cache.write(path);

  var r = request(params);
  r.pipe(file);
  r.pipe(res);
}

https.createServer(options, handler).listen(8081);


var port = 8080; // default port if none on command line

log.debug('server listening on %s:%s', 'localhost', port);

// start HTTP server with custom request handler callback function
var server = http.createServer(handler).listen(port);

// add handler for HTTPS (which issues a CONNECT to the proxy)
server.addListener('connect', function(request, socketRequest, bodyhead) {
  var url = request['url'];
  var httpVersion = request['httpVersion'];
  var hostport = ['localhost', 8081]

  log.debug('  = will connect to %s:%s', hostport[0], hostport[1]);

  // set up TCP connection
  var proxySocket = new net.Socket();
  proxySocket.connect(
    parseInt( hostport[1] ), hostport[0],
    function() {
      log.debug('  < connected to %s:%s', hostport[0], hostport[1]);
      log.debug('  > writing head of length %d', bodyhead.length);

      proxySocket.write( bodyhead );

      // tell the caller the connection was successfully established
      socketRequest.write("HTTP/" + httpVersion + " 200 Connection established\r\n\r\n");
    }
  );

  proxySocket.on('data', function(chunk) {
    log.debug('  < data length = %d', chunk.length);
    socketRequest.write( chunk );
  });

  proxySocket.on('end', function() {
    log.debug('  < end');
    socketRequest.end();
  });

  socketRequest.on('data', function(chunk) {
    log.debug('  > data length = %d', chunk.length);
    proxySocket.write(chunk);
  });

  socketRequest.on('end', function() {
    log.debug('  > end');
    proxySocket.end();
  });

  proxySocket.on('error', function(err) {
    socketRequest.write( "HTTP/" + httpVersion + " 500 Connection error\r\n\r\n" );
    log.debug('  < ERR: %s', err);
    socketRequest.end();
  });

  socketRequest.on('error', function(err) {
    log.debug('  > ERR: %s', err);
    proxySocket.end();
  });
}); // HTTPS connect listener

