'use strict'
// Diagnostic: log what the bar reports (its layout via new_page) and draw a labelled
// "SLOT N" to every slot to see which regions light up. Run with the service stopped.
const { SerialPort } = require('serialport')
const { createCanvas } = require('@napi-rs/canvas')
const { encode, drawFrame, Decoder } = require('./protocol.js')
const { canvasToRgbPng } = require('./png.js')

function png (w, text) {
  const c = createCanvas(w, 60)
  const x = c.getContext('2d')
  x.fillStyle = '#001018'; x.fillRect(0, 0, w, 60)
  x.fillStyle = '#00e5ff'; x.font = '700 26px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(text, w / 2, 31)
  return canvasToRgbPng(c)
}

const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200 }, (e) => { if (e) { console.log('OPEN_ERR', e.message); process.exit(1) } })
let drew = false
function drawAll (keys) {
  if (drew) return
  drew = true
  keys.forEach((k, i) => port.write(drawFrame(i, png(k.width || 400, 'SLOT ' + i))))
  console.log('DREW ' + keys.length + ' slots')
}
const dec = new Decoder((m) => {
  if (m && m.$cid === 'com.eniac.sys.new_page' && Array.isArray(m.data)) {
    console.log('LAYOUT ' + m.data.length + ' keys: ' + m.data.map((k, i) => '#' + i + ':' + String(k.cid || '').split('.').pop() + '/w' + k.width).join('  '))
    drawAll(m.data)
  } else {
    console.log('RX ' + JSON.stringify(m).slice(0, 110))
  }
})
port.on('data', (d) => dec.push(d))
port.on('open', () => {
  console.log('OPEN — envoi $connected')
  port.write(encode({ event: '$connected', data: null }))
  setTimeout(() => {
    if (!drew) {
      console.log('pas de new_page reçu → dessin fallback slots 0..5')
      ;[120, 600, 400, 500, 460, 200].forEach((w, i) => port.write(drawFrame(i, png(w, 'SLOT ' + i))))
    }
  }, 2500)
})
setTimeout(() => { console.log('END'); port.close(() => process.exit(0)) }, 12000)
