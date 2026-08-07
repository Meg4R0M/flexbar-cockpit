'use strict'
const fs = require('fs')
const path = require('path')

// Loads socbar-daemon.config.json (or $SOCBAR_CONFIG). Returns {} if absent.
function load () {
  const candidates = [process.env.SOCBAR_CONFIG, path.join(__dirname, 'socbar-daemon.config.json')].filter(Boolean)
  for (const f of candidates) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (_) { /* next */ }
  }
  return {}
}

module.exports = { load }
