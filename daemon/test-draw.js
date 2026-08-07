'use strict'
// Minimal standalone draw test: find the Flexbar, open its serial port (FlexDesigner
// MUST be closed), announce $connected, then draw a PNG to a key slot. Logs bar->host
// events. Proves the daemon can drive the bar without FlexDesigner.
//
// Usage: node test-draw.js [slot] [/dev/cu.usbmodemXXXX]

const { SerialPort } = require('serialport')
const { createCanvas } = require('@napi-rs/canvas')
const { encode, drawFrame, Decoder } = require('./protocol.js')
const { canvasToRgbPng } = require('./png.js')

const VID = '303a'
const PID = '82bf'
const SLOT = parseInt(process.argv[2] || '1', 10)
const FORCED = process.argv[3]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findPort () {
  if (FORCED) return FORCED
  for (let i = 0; i < 20; i++) {
    const list = await SerialPort.list()
    const d = list.find((p) => (p.vendorId || '').toLowerCase() === VID && (p.productId || '').toLowerCase() === PID)
    if (d) {
      let path = d.path
      if (process.platform === 'darwin') path = path.replace('/dev/tty.', '/dev/cu.') // callout = non-blocking write
      return path
    }
    if (i === 0) console.log('Flexbar pas encore là (re-énumération ?), attente…')
    await sleep(500)
  }
  throw new Error('Flexbar 303a:82bf introuvable — branchée ? FlexDesigner bien fermé ?')
}

function testPng (w, h, text) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#d29922'; ctx.font = '700 24px Arial'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2)
  return canvasToRgbPng(c) // bar needs RGB PNG (colortype 2), not RGBA
}

;(async () => {
  const path = await findPort()
  console.log('port:', path)
  const port = new SerialPort({ path, baudRate: 115200 }, (err) => {
    if (err) { console.error('OPEN ERROR:', err.message); process.exit(1) }
  })
  const dec = new Decoder((msg) => {
    const s = JSON.stringify(msg)
    console.log('RX:', s.length > 160 ? s.slice(0, 160) + '…' : s)
  })
  port.on('data', (d) => dec.push(d))
  port.on('error', (e) => console.error('PORT ERROR:', e.message))
  port.on('open', () => {
    console.log('port ouvert — envoi $connected')
    port.write(encode({ event: '$connected', data: null }))
    let n = 0
    const paint = () => {
      n++
      const png = testPng(600, 60, 'DAEMON OK ' + n)
      port.write(drawFrame(SLOT, png))
      console.log(`draw #${n} -> $plugin-${SLOT} (600x60, ${png.length}o)`)
    }
    setTimeout(paint, 700)
    const iv = setInterval(paint, 1500)
    setTimeout(() => { clearInterval(iv); console.log('fini'); port.close(() => process.exit(0)) }, 14000)
  })
})().catch((e) => { console.error(e.message); process.exit(1) })
