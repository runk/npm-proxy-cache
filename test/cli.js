'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

describe('CLI', function() {
  const cli = path.join(__dirname, '../bin/npm-proxy-cache');

  it('should display help with the native argument parser', function() {
    const result = spawnSync(process.execPath, [
      cli,
      '--help'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: npm-proxy-cache \[options\]/);
    assert.match(result.stdout, /--internal-port <port>/);
  });

  it('should display the package version', function() {
    const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), require('../package.json').version);
  });

  it('should reject invalid numeric options', function() {
    const result = spawnSync(process.execPath, [cli, '--port', 'invalid'], { encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--port must be a non-negative integer/);
  });
});
