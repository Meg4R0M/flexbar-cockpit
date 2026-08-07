'use strict'
// The Flexbar's on-device PNG decoder only handles RGB (PNG colortype 2), not RGBA.
// @napi-rs/canvas outputs RGBA, so we re-encode the canvas pixels as an RGB PNG.
const { PNG } = require('pngjs')

function canvasToRgbPng (canvas) {
  const w = canvas.width
  const h = canvas.height
  const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data // RGBA, w*h*4
  const png = new PNG({ width: w, height: h, colorType: 2 })
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length)
  return PNG.sync.write(png, { colorType: 2 }) // colortype 2 = RGB, drops alpha
}

module.exports = { canvasToRgbPng }
