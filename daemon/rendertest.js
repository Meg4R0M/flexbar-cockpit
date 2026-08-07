'use strict'
// Diagnostic: render a widget in THIS environment and save it, to check fonts/canvas.
const fs = require('fs')
const { clusterOverview } = require('./render.js')
const cl = {
  nodes: [{ name: 'pve1', online: true, cpu: 0.34, mem: 20e9, maxmem: 64e9 }, { name: 'pve2', online: true, cpu: 0.58, mem: 38e9, maxmem: 64e9 }],
  vms: [{ name: 'goad', running: true, cpu: 0.4, mem: 5e9, maxmem: 8e9 }, { name: 'x', running: false, cpu: 0, mem: 0, maxmem: 4e9 }]
}
try {
  const a = clusterOverview(600, cl)
  fs.writeFileSync('/tmp/rt.png', a)
  console.log('RENDER_OK bytes=' + a.length)
} catch (e) {
  console.log('RENDER_ERR ' + (e.stack || e))
}
try {
  const { execSync } = require('child_process')
  console.log('fc-list count: ' + execSync('fc-list 2>/dev/null | wc -l').toString().trim())
} catch (e) {
  console.log('fc-list: absent (fontconfig non installé)')
}
