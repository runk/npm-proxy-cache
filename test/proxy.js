'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

describe('proxy', function() {
  const calledMock = {};
  let cachePath;
  let mockPort;
  let proxy;
  let proxyPort;
  let secureMockPort;

  const server = http.createServer(function(req, res) {
    const key = req.method + req.url;
    calledMock[key] = (calledMock[key] || 0) + 1;

    const chunks = [];
    req.on('data', function(chunk) {
      chunks.push(chunk);
    });
    req.on('end', function() {
      if (req.url === '/missing') {
        res.writeHead(404);
        res.end('missing');
        return;
      }

      if (req.method === 'POST') {
        res.writeHead(201, {
          'content-type': 'text/plain',
          'x-upstream': 'true'
        });
        res.end(Buffer.concat(chunks));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ random: Math.random() }));
    });
  });
  const secureServer = https.createServer({
    key: fs.readFileSync(path.join(__dirname, '../cert/dummy.key')),
    cert: fs.readFileSync(path.join(__dirname, '../cert/dummy.crt'))
  }, function(req, res) {
    calledMock[req.method + req.url] = (calledMock[req.method + req.url] || 0) + 1;
    res.end('secure response');
  });

  before(async function() {
    cachePath = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-proxy-cache-test-'));
    await Promise.all([listen(server), listen(secureServer)]);
    mockPort = server.address().port;
    secureMockPort = secureServer.address().port;

    proxy = require('../lib/proxy').powerup({
      host: '127.0.0.1',
      port: 0,
      storage: cachePath,
      metadataExcluded: true,
      ttl: 1800
    });
    await Promise.all([
      listening(proxy.httpServer),
      listening(proxy.httpsServer)
    ]);
    proxyPort = proxy.httpServer.address().port;
  });

  after(async function() {
    await Promise.all([
      close(proxy && proxy.httpServer),
      close(proxy && proxy.httpsServer),
      close(server),
      close(secureServer)
    ]);
    fs.rmSync(cachePath, { recursive: true, force: true });
  });

  it('should not cache metadata requests', async function() {
    const first = await performRequest({
      path: '/metadata',
      headers: { accept: 'application/json' }
    });
    const second = await performRequest({
      path: '/metadata',
      headers: { accept: 'application/json' }
    });

    assert.notEqual(second.body, first.body);
    assert.equal(calledMock['GET/metadata'], 2);
  });

  it('should cache successful GET requests', async function() {
    const first = await performRequest({ path: '/package.tgz' });
    const second = await performRequest({ path: '/package.tgz' });

    assert.equal(second.body, first.body);
    assert.equal(second.headers['x-cache-hit'], 'true');
    assert.equal(calledMock['GET/package.tgz'], 1);
  });

  it('should forward chunked request bodies and upstream response metadata', async function() {
    const response = await performRequest({
      method: 'POST',
      path: '/publish',
      body: 'published body',
      headers: { 'content-type': 'text/plain' }
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.headers['x-upstream'], 'true');
    assert.equal(response.body, 'published body');
    assert.equal(calledMock['POST/publish'], 1);
  });

  it('should accept absolute-form proxy URLs', async function() {
    const response = await performRequest({
      path: 'http://127.0.0.1:' + mockPort + '/absolute',
      headers: { accept: 'application/json' }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(calledMock['GET/absolute'], 1);
  });

  it('should proxy HTTPS CONNECT requests through the MITM server', async function() {
    const response = await performHttpsRequest('/secure');

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'secure response');
    assert.equal(calledMock['GET/secure'], 1);
  });

  it('should not cache non-successful responses', async function() {
    const first = await performRequest({ path: '/missing' });
    const second = await performRequest({ path: '/missing' });

    assert.match(first.body, /Status 404 returned/);
    assert.match(second.body, /Status 404 returned/);
    assert.equal(first.statusCode, 502);
    assert.equal(second.statusCode, 502);
    assert.equal(calledMock['GET/missing'], 2);
  });

  function performRequest(options) {
    return new Promise(function(resolve, reject) {
      const headers = Object.assign({
        host: '127.0.0.1:' + mockPort
      }, options.headers);
      const req = http.request({
        hostname: '127.0.0.1',
        port: proxyPort,
        method: options.method || 'GET',
        path: options.path,
        headers: headers
      }, function(res) {
        const chunks = [];
        res.on('data', function(chunk) {
          chunks.push(chunk);
        });
        res.on('end', function() {
          resolve({
            body: Buffer.concat(chunks).toString(),
            headers: res.headers,
            statusCode: res.statusCode
          });
        });
      });
      req.on('error', reject);
      if (options.body)
        req.write(options.body);
      req.end();
    });
  }

  function performHttpsRequest(requestPath) {
    return new Promise(function(resolve, reject) {
      const agent = new HttpsProxyAgent('http://127.0.0.1:' + proxyPort);
      const req = https.request({
        hostname: '127.0.0.1',
        port: secureMockPort,
        path: requestPath,
        agent: agent,
        rejectUnauthorized: false
      }, function(res) {
        const chunks = [];
        res.on('data', function(chunk) {
          chunks.push(chunk);
        });
        res.on('end', function() {
          resolve({
            body: Buffer.concat(chunks).toString(),
            statusCode: res.statusCode
          });
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
});

function listen(server) {
  return new Promise(function(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function() {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function listening(server) {
  if (server.listening)
    return Promise.resolve();
  return new Promise(function(resolve, reject) {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

function close(server) {
  if (!server || !server.listening)
    return Promise.resolve();
  return new Promise(function(resolve, reject) {
    server.close(function(err) {
      if (err)
        reject(err);
      else
        resolve();
    });
  });
}
