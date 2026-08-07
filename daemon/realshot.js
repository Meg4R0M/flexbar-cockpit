'use strict'
// Diagnostic: fetch the REAL cluster and composite the 5 slots to /tmp/realshot.png,
// so we can eyeball exactly what the bar is showing. Uses the same logic as daemon.js.
const fs = require('fs')
const { createCanvas } = require('@napi-rs/canvas')
const { PNG } = require('pngjs')
const R = require('./render.js')
const { fetchCluster } = require('./proxmox.js')
const { computeAlerts, clusterDisk } = require('./metrics.js')

;(async () => {
  const cl = await fetchCluster()
  const realVms = cl.vms.filter((v) => !v.template)
  const alerts = computeAlerts(cl)
  const store = clusterDisk(cl.storages)
  const vm = realVms[0]
  // synthetic history so the sparklines are visible in this single snapshot
  const cpuFrac = cl.nodes.reduce((s, n) => s + (n.cpu || 0), 0) / Math.max(1, cl.nodes.length)
  const memU = cl.nodes.reduce((s, n) => s + (n.mem || 0), 0)
  const memT = cl.nodes.reduce((s, n) => s + (n.maxmem || 0), 0)
  const jit = (b) => Array.from({ length: 30 }, (_, i) => Math.max(0, Math.min(1, b + Math.sin(i / 3) * 0.06 + (Math.random() * 0.05 - 0.025))))
  const hist = { cpu: jit(cpuFrac), ram: jit(memT ? memU / memT : 0) }
  const tiles = [
    R.brandTile(120),
    R.clusterOverview(600, { nodes: cl.nodes, vms: realVms }, hist),
    R.alertsTile(400, alerts, 0),
    vm ? R.resourceLine(500, { ...vm, index: 0, total: realVms.length }) : R.resourceLine(500, { kind: 'vm', name: 'aucune VM', index: 0, total: 0 }),
    R.diskTile(460, store)
  ]
  const W = 620
  const rowH = 70
  const c = createCanvas(W, rowH * tiles.length)
  const x = c.getContext('2d')
  x.fillStyle = '#05070a'
  x.fillRect(0, 0, W, rowH * tiles.length)
  tiles.forEach((buf, i) => {
    const p = PNG.sync.read(buf)
    const img = x.createImageData(p.width, p.height)
    img.data.set(p.data)
    x.putImageData(img, 6, i * rowH + 5)
  })
  fs.writeFileSync('/tmp/realshot.png', c.toBuffer('image/png'))
  console.log('REALSHOT_OK vms=' + realVms.length + ' templates=' + (cl.vms.length - realVms.length) +
    ' alerts=' + alerts.length + ' storages=' + (cl.storages || []).length +
    ' disk=' + (store ? (store.free / 1e9).toFixed(0) + '/' + (store.total / 1e9).toFixed(0) + 'GB libre' : '-'))
})().catch((e) => { console.log('REALSHOT_ERR', e.message) })
