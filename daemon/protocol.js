'use strict'
// Flexbar serial protocol codec — reverse-engineered, see ../PROTOCOL.md
//
// Host -> Bar frame:
//   MAGIC(32) + header[8*u32 LE: 4096,1,1,0, payloadLen, payloadLen, 0, 8]
//   + inner: aafcfdfe + u32(jsonLen) + u32(binLen) + u32(16+jsonLen+binLen) + JSON + binary
// Bar -> Host frame:
//   MAGIC(32) + header[8*u32 LE: 64, seq, seq, 0, payloadLen, payloadLen, 0, 0] + JSON (direct)

const MAGIC = Buffer.from('5a0000a5a9c4d1f22c8f3e6d10f7bdac43de9c5a2fc3b7e1d2b5e8348c7a2d9f', 'hex')
const INNER = Buffer.from('aafcfdfe', 'hex')

function u32 (n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

// Encode a host->bar message: a JSON command + optional trailing binary (e.g. PNG).
function encode (jsonObjOrStr, bin = Buffer.alloc(0)) {
  const json = typeof jsonObjOrStr === 'string' ? jsonObjOrStr : JSON.stringify(jsonObjOrStr)
  const jsonBuf = Buffer.from(json, 'utf8')
  const inner = Buffer.concat([
    INNER,
    u32(jsonBuf.length),
    u32(bin.length),
    u32(16 + jsonBuf.length + bin.length),
    jsonBuf,
    bin
  ])
  const payloadLen = inner.length
  const header = Buffer.concat([
    u32(4096), u32(1), u32(1), u32(0), u32(payloadLen), u32(payloadLen), u32(0), u32(8)
  ])
  return Buffer.concat([MAGIC, header, inner])
}

// Draw a PNG to plugin key slot N.
function drawFrame (pluginIndex, pngBuffer) {
  return encode({ event: '$plugin-' + pluginIndex, data: { $cmd: 'draw' } }, pngBuffer)
}

// Incremental decoder for bar->host frames (payload is direct JSON).
class Decoder {
  constructor (onMessage) {
    this.buf = Buffer.alloc(0)
    this.onMessage = onMessage
  }

  push (chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      const i = this.buf.indexOf(MAGIC)
      if (i < 0) {
        if (this.buf.length > (1 << 20)) this.buf = this.buf.subarray(-64)
        break
      }
      if (this.buf.length < i + 64) break // need full header
      const header = this.buf.subarray(i + 32, i + 64)
      const payloadLen = header.readUInt32LE(16) // field[4]
      const end = i + 64 + payloadLen
      if (this.buf.length < end) break // need full payload
      const payload = this.buf.subarray(i + 64, end)
      this.buf = this.buf.subarray(end)
      const js = payload.indexOf(0x7b) // '{'
      if (js >= 0) {
        try { this.onMessage(JSON.parse(payload.subarray(js).toString('utf8'))) } catch (_) {}
      }
    }
  }
}

module.exports = { MAGIC, encode, drawFrame, Decoder }
