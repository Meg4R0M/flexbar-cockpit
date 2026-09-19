'use strict'
// Local preview: fetch real tickers and stack each cryptoTile into one PNG.
const fs = require('fs')
const { createCanvas } = require('@napi-rs/canvas')
const { PNG } = require('pngjs')
const R = require('./render.js')
const { fetchCrypto } = require('./crypto.js')

;(async () => {
  const coins = await fetchCrypto()
  const W = 520
  const rowH = 66
  const H = rowH * coins.length + 6
  const c = createCanvas(W, H)
  const x = c.getContext('2d')
  x.fillStyle = '#05070a'; x.fillRect(0, 0, W, H)
  coins.forEach((coin, i) => {
    const buf = R.cryptoTile(500, { ...coin, index: i, total: coins.length })
    const p = PNG.sync.read(buf)
    const img = x.createImageData(p.width, p.height)
    img.data.set(p.data)
    x.putImageData(img, 6, i * rowH + 5)
  })
  fs.writeFileSync('/tmp/cryptopreview.png', c.toBuffer('image/png'))
  console.log('CRYPTO_PREVIEW_OK coins=' + coins.length + ' → /tmp/cryptopreview.png')
})().catch((e) => console.log('ERR', e.message))
