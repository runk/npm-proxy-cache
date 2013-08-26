/*

strict-ssl
proxy
https-proxy
*/

var http = require('http');
var net = require('net');



var https = require('https');
var fs = require('fs');
var request = require('request');
var url = require('url');

var options = {
  key: fs.readFileSync('cert/dummy.key', 'utf8'),
  cert: fs.readFileSync('cert/dummy.crt', 'utf8'),
  debug: false
};

function debug() {
  if (!options.debug)
    return
  console.log.apply(console, arguments);
}

var handler = function(req, res) {
  var path = url.parse(req.url).path;

  debug('Request received: %s', path);

  var params = {
    url: 'https://registry.npmjs.org' + path,
    rejectUnauthorized: false
  };

  var filepath = __dirname + '/cache/' + path.replace(/\//g, '-');

  if (fs.existsSync(filepath)) {
    debug('Returning cache for %s', path);
    var file = fs.createReadStream(filepath);
    return file.pipe(res);
  }

  debug('Fetching %s directly', path);
  var file = fs.createWriteStream(filepath);
  file.on('finish', function() {
    file.close();
  });

  var r = request(params);
  r.pipe(file);
  r.pipe(res);

}

https.createServer(options, handler).listen(8081);


(function() {

  var port = 8080; // default port if none on command line

  debug('server listening on %s:%s', 'localhost', port);

  // start HTTP server with custom request handler callback function
  var server = http.createServer(handler).listen(port);

  // add handler for HTTPS (which issues a CONNECT to the proxy)
  server.addListener('connect', function(request, socketRequest, bodyhead){
    var url = request['url'];
    var httpVersion = request['httpVersion'];
    var hostport = ['localhost', 8081]

    debug('  = will connect to %s:%s', hostport[0], hostport[1]);

    // set up TCP connection
    var proxySocket = new net.Socket();
    proxySocket.connect(
      parseInt( hostport[1] ), hostport[0],
      function() {
        debug('  < connected to %s/%s', hostport[0], hostport[1]);
        debug('  > writing head of length %d', bodyhead.length);

        proxySocket.write( bodyhead );

        // tell the caller the connection was successfully established
        socketRequest.write("HTTP/" + httpVersion + " 200 Connection established\r\n\r\n");
      }
    );

    proxySocket.on('data', function(chunk) {
      debug('  < data length = %d', chunk.length);
      socketRequest.write( chunk );
    });

    proxySocket.on('end', function() {
      debug('  < end');
      socketRequest.end();
    });

    socketRequest.on('data', function(chunk) {
      debug('  > data length = %d', chunk.length);
      proxySocket.write(chunk);
    });

    socketRequest.on('end', function() {
      debug('  > end');
      proxySocket.end();
    });

    proxySocket.on('error', function(err) {
      socketRequest.write( "HTTP/" + httpVersion + " 500 Connection error\r\n\r\n" );
      debug('  < ERR: %s', err);
      socketRequest.end();
    });

    socketRequest.on('error', function(err) {
      debug('  > ERR: %s', err);
      proxySocket.end();
    });
  }); // HTTPS connect listener

})();
