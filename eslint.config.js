'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['cache/**', 'node_modules/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js', 'bin/npm-proxy-cache'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: Object.assign({}, globals.node, globals.mocha)
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none' }],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'always']
    }
  }
];
