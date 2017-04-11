var assert = require('assert'),
  fs = require('fs'),
  proxy = require('../lib/proxy'),
  http = require('http'),
  request = require('request'),
  uuid = require('uuid');

var MOCK_PORT = 0;
var APP_PORT = 32402;
var calledMock = {};

var server = http.createServer(function (req, res) {
    calledMock[req.method + req.url] = calledMock[req.method + req.url] + 1 || 1;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      name: uuid().toString()
    }));
});

before(function (beforeDone) {
  server.listen(MOCK_PORT, function(err) {
    if (err) {
      return beforeDone(err);
    }
    console.log('Mock server listening on port %s [%d]', server.address().port, process.pid);
    MOCK_PORT = server.address().port;

    require('../lib/proxy').powerup({
      port: APP_PORT,
      metadataExcluded: true,
      ttl: 1800
    });
    beforeDone();
  });
});

describe('proxy', function() {
  it('should not cache metadata requests', function(itDone) {
    performNpmRequest(function (req, res, resBody) {
      var originalBody = resBody;
      performNpmRequest(function (req, res, resBody) {
        assert.notDeepEqual(resBody, originalBody);
        assert.equal(calledMock['GET/test'], 2, 'Mock is not called twice');
        itDone();
      });
    });
  });
});

function performNpmRequest(fn) {
  request({
      baseUrl: 'http://127.0.0.1:' + APP_PORT,
      uri: '/test',
      headers: {
        accept: 'application/json',
        host: '127.0.0.1:' + MOCK_PORT
      }
  }, fn);
};
