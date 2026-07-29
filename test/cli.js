'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

describe('CLI', function() {
  it('should display help with the current Commander API', function() {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../bin/npm-proxy-cache'),
      '--help'
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: npm-proxy-cache \[options\]/);
    assert.match(result.stdout, /--internal-port <port>/);
  });
});
