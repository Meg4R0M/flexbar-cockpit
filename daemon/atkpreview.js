'use strict'
// Local preview of the attack-node console layout (synthetic data).
const fs = require('fs')
const { createCanvas } = require('@napi-rs/canvas')
const { PNG } = require('pngjs')
const R = require('./render.js')

const jit = (b) => Array.from({ length: 30 }, (_, i) => Math.max(0, Math.min(1, b + Math.sin(i / 3) * 0.07 + (Math.random() * 0.05 - 0.025))))
const tiles = [
  { buf: R.scopeTile(120, { armed: true, mission: 'acme-redteam' }) },
  { buf: R.hostOverview(600, { cpu: 0.37, ram: 0.52, load: 3.1, cores: 16, temp: 61 }, { cpu: jit(0.37), ram: jit(0.52) }) },
  { buf: R.egressTile(400, { ip: '185.220.101.47', via: 'wg0', state: 'vpn' }) },
  { buf: R.sessionsTile(500, { mission: 'acme-redteam', wg: true, c2: 3, listeners: 2 }) },
  { buf: R.cryptoTile(460, { base: 'BTC', priceStr: '$81,176', changePct: 6.05, index: 0, total: 7 }) }
]
const W = 620
const rowH = 70
const H = rowH * tiles.length + 6
const c = createCanvas(W, H)
const x = c.getContext('2d')
x.fillStyle = '#05070a'; x.fillRect(0, 0, W, H)
tiles.forEach((t, i) => {
  const p = PNG.sync.read(t.buf)
  const img = x.createImageData(p.width, p.height)
  img.data.set(p.data)
  x.putImageData(img, 6, i * rowH + 5)
})
fs.writeFileSync('/tmp/atkpreview.png', c.toBuffer('image/png'))
console.log('ATK_PREVIEW_OK → /tmp/atkpreview.png')
