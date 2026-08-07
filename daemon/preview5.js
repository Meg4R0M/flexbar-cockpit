'use strict'
// Local preview: render the 5 slots and stack them into one PNG to eyeball the layout.
const fs = require('fs')
const { createCanvas } = require('@napi-rs/canvas')
const { PNG } = require('pngjs')
const R = require('./render.js')

const cl = {
  nodes: [
    { name: 'pve1', online: true, cpu: 0.34, mem: 20e9, maxmem: 64e9 },
    { name: 'pve2', online: true, cpu: 0.58, mem: 38e9, maxmem: 64e9 }
  ],
  vms: [
    { name: 'dc01', kind: 'qemu', running: true, cpu: 0.42, mem: 5.2e9, maxmem: 8e9, template: false },
    { name: 'app-01', kind: 'lxc', running: true, cpu: 0.2, mem: 12e9, maxmem: 16e9, template: false },
    { name: 'vm-test', kind: 'qemu', running: false, cpu: 0, mem: 0, maxmem: 4e9, template: false },
    { name: 'debian12-tmpl', kind: 'qemu', running: false, cpu: 0, mem: 0, maxmem: 2e9, template: true }
  ]
}
const realVms = cl.vms.filter((v) => !v.template)
const alerts = [{ sev: 'crit', text: 'STOCK backup 96%' }, { sev: 'warn', text: 'STOCK local 82%' }]
const store = { free: 520e9, total: 1e12 }
const jit = (b) => Array.from({ length: 30 }, (_, i) => Math.max(0, Math.min(1, b + Math.sin(i / 3) * 0.08 + (Math.random() * 0.05 - 0.025))))
const hist = { cpu: jit(0.46), ram: jit(0.45) }

const tiles = [
  { w: 120, buf: R.brandTile(120) },
  { w: 600, buf: R.clusterOverview(600, { nodes: cl.nodes, vms: realVms }, hist) },
  { w: 400, buf: R.alertsTile(400, alerts, 0) },
  { w: 500, buf: R.resourceLine(500, { ...realVms[0], index: 0, total: realVms.length }) },
  { w: 460, buf: R.diskTile(460, store) }
]

const W = 620
const rowH = 70
const c = createCanvas(W, rowH * tiles.length)
const x = c.getContext('2d')
x.fillStyle = '#05070a'
x.fillRect(0, 0, W, rowH * tiles.length)
tiles.forEach((t, i) => {
  const p = PNG.sync.read(t.buf) // pngjs normalises to RGBA
  const img = x.createImageData(p.width, p.height)
  img.data.set(p.data)
  x.putImageData(img, 6, i * rowH + 5)
})
fs.writeFileSync('/tmp/preview5.png', c.toBuffer('image/png'))
console.log('PREVIEW_OK /tmp/preview5.png')
