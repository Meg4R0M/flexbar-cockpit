'use strict'
const { fetchCluster } = require('./proxmox.js')
fetchCluster().then((c) => {
  console.log('name         node   used / total          used%  shared status')
  c.storages.forEach((s) => console.log(
    String(s.name).padEnd(12), String(s.node || '').padEnd(6),
    ((s.disk / 1e9).toFixed(1) + ' / ' + (s.maxdisk / 1e9).toFixed(1) + ' GB').padEnd(20),
    (s.maxdisk ? Math.round(100 * s.disk / s.maxdisk) : 0) + '%',
    s.shared ? 'shared' : '      ', s.status || ''
  ))
}).catch((e) => console.log('ERR', e.message))
