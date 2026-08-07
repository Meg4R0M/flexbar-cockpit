'use strict'
// Render a sample of the cockpit text in each candidate font, stacked, to compare.
const fs = require('fs')
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const DIR = '/opt/flexbar-daemon/fonts/'
const cands = [
  { label: 'Actuel (Liberation / Arial)', fam: 'Arial' },
  { label: 'Orbitron', file: 'Orbitron.ttf', fam: 'Orbitron' },
  { label: 'Chakra Petch', file: 'ChakraPetch.ttf', fam: 'ChakraPetch' },
  { label: 'Rajdhani', file: 'Rajdhani.ttf', fam: 'Rajdhani' },
  { label: 'Michroma', file: 'Michroma.ttf', fam: 'Michroma' },
  { label: 'Aldrich', file: 'Aldrich.ttf', fam: 'Aldrich' }
]
const avail = []
for (const c of cands) {
  if (!c.file) { avail.push(c); continue }
  try {
    if (fs.existsSync(DIR + c.file) && fs.statSync(DIR + c.file).size > 5000) {
      GlobalFonts.registerFromPath(DIR + c.file, c.fam); avail.push(c)
    } else { console.log('skip', c.label, '(absent/trop petit)') }
  } catch (e) { console.log('skip', c.label, e.message) }
}
const W = 760
const rowH = 68
const H = rowH * avail.length + 6
const cv = createCanvas(W, H)
const x = cv.getContext('2d')
x.fillStyle = '#0b0e14'; x.fillRect(0, 0, W, H)
avail.forEach((c, i) => {
  const y = i * rowH + 6
  x.fillStyle = '#5c6b7a'; x.font = '600 11px Arial'; x.textAlign = 'left'; x.textBaseline = 'top'
  x.fillText(c.label, 12, y + 4)
  const my = y + rowH / 2 + 8
  x.textBaseline = 'middle'
  x.fillStyle = '#c9d1d9'; x.font = '22px ' + c.fam; x.fillText('HUMANIX', 12, my)
  x.fillStyle = '#c9d1d9'; x.font = '18px ' + c.fam; x.fillText('NODES 2/2', 300, my)
  x.fillStyle = '#3fb950'; x.font = '22px ' + c.fam; x.fillText('CPU 46%', 470, my)
  x.fillStyle = '#3fb950'; x.font = '22px ' + c.fam; x.fillText('1.8 To', 630, my)
  x.strokeStyle = '#1e2733'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, y + rowH); x.lineTo(W, y + rowH); x.stroke()
})
fs.writeFileSync('/tmp/fontcompare.png', cv.toBuffer('image/png'))
console.log('FONTCOMPARE_OK rows=' + avail.length)
