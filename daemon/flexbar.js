'use strict'
// Connection manager for the Flexbar over serial (no FlexDesigner).
// Auto-detects the device (VID/PID), uses the callout node on macOS, auto-reconnects,
// decodes bar->host events, and exposes draw(slot, rgbPng).

const { SerialPort } = require('serialport')
const { encode, drawFrame, Decoder } = require('./protocol.js')

const VID = '303a'
const PID = '82bf'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Flexbar {
  constructor ({ onEvent, onReady, baudRate = 115200, serialPath } = {}) {
    this.onEvent = onEvent || (() => {})
    this.onReady = onReady || (() => {})
    this.baudRate = baudRate
    this.forcedPath = serialPath || null
    this.port = null
    this.ready = false
  }

  async findPath () {
    if (this.forcedPath) return this.forcedPath
    for (let i = 0; i < 40; i++) {
      const list = await SerialPort.list()
      const d = list.find((p) => (p.vendorId || '').toLowerCase() === VID && (p.productId || '').toLowerCase() === PID)
      if (d) return process.platform === 'darwin' ? d.path.replace('/dev/tty.', '/dev/cu.') : d.path
      // LXC/Linux fallback: udev metadata (VID/PID) is often absent in a container,
      // so pick the first CDC-ACM device (the Flexbar is normally the only one).
      if (process.platform === 'linux') {
        try {
          const acm = require('fs').readdirSync('/dev').filter((f) => /^ttyACM\d+$/.test(f)).sort()
          if (acm.length) return '/dev/' + acm[0]
        } catch (_) { /* /dev unreadable */ }
      }
      await sleep(500)
    }
    throw new Error('Flexbar introuvable (VID/PID 303a:82bf ni /dev/ttyACM*) — passthrough OK ?')
  }

  draw (slot, pngBuf) {
    if (this.ready && this.port && this.port.writable) {
      this.port.write(drawFrame(slot, pngBuf))
    }
  }

  // Connect once and wire handlers; resolves when open.
  async _open () {
    const path = await this.findPath()
    await new Promise((res, rej) => {
      this.port = new SerialPort({ path, baudRate: this.baudRate }, (e) => (e ? rej(e) : res()))
    })
    const dec = new Decoder((msg) => this.onEvent(msg))
    this.port.on('data', (d) => dec.push(d))
    this.port.once('close', () => { this.ready = false })
    this.port.on('error', () => {})
    this.port.write(encode({ event: '$connected', data: null }))
    this.ready = true
    return path
  }

  // Run forever: (re)connect on drop.
  async run () {
    for (;;) {
      try {
        const path = await this._open()
        console.log('[flexbar] connecté sur', path)
        this.onReady()
        while (this.ready) await sleep(500) // wait until the port drops
        console.log('[flexbar] déconnecté, reconnexion…')
      } catch (e) {
        console.log('[flexbar] erreur:', e.message, '— retry 2s')
      }
      try { if (this.port) this.port.close(() => {}) } catch (_) {}
      this.ready = false
      await sleep(2000)
    }
  }
}

module.exports = { Flexbar }
