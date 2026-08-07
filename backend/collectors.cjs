'use strict'

// Data collectors for the SOC bar.
// Local metrics use only Node built-ins (always available).
// SOC feeds are config-driven HTTP calls that degrade gracefully when unreachable.

const os = require('os')
const { execFile } = require('child_process')

// --- CPU usage needs a delta between two snapshots of the cumulative timers ---
let lastCpu = snapshotCpu()

function snapshotCpu () {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t
    idle += cpu.times.idle
  }
  return { idle, total }
}

function cpuPercent () {
  const now = snapshotCpu()
  const idleDelta = now.idle - lastCpu.idle
  const totalDelta = now.total - lastCpu.total
  lastCpu = now
  if (totalDelta <= 0) return 0
  return clampPct(Math.round((1 - idleDelta / totalDelta) * 100))
}

// macOS os.freemem() counts only truly-free pages, so (total - free) reports ~99%
// even when Activity Monitor shows far less (macOS keeps free pages minimal and
// reclaims cache on demand). We replicate Activity Monitor's "Memory Used" =
// App (anonymous - purgeable) + Wired + Compressed, read from vm_stat, cached 2s.
let memCache = { pct: null, ts: 0 }
const MEM_TTL_MS = 2000

function runVmStat () {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/vm_stat', { timeout: 2000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

async function macMemPercent () {
  const out = await runVmStat()
  const pageSize = Number((out.match(/page size of (\d+) bytes/) || [])[1]) || 4096
  const field = (name) => {
    const m = out.match(new RegExp(name + ':\\s+(\\d+)\\.'))
    return m ? Number(m[1]) : 0
  }
  const usedBytes =
    (Math.max(0, field('Anonymous pages') - field('Pages purgeable')) +
      field('Pages wired down') +
      field('Pages occupied by compressor')) * pageSize
  return clampPct(Math.round((usedBytes / os.totalmem()) * 100))
}

function osMemPercent () {
  const total = os.totalmem()
  return clampPct(Math.round(((total - os.freemem()) / total) * 100))
}

async function memPercent () {
  const now = Date.now()
  if (memCache.pct != null && now - memCache.ts < MEM_TTL_MS) return memCache.pct
  let pct
  try {
    pct = process.platform === 'darwin' ? await macMemPercent() : osMemPercent()
  } catch (_) {
    pct = osMemPercent()
  }
  memCache = { pct, ts: now }
  return pct
}

function loadAvg () {
  const [l1] = os.loadavg()
  const cores = os.cpus().length || 1
  return { value: l1, ratio: l1 / cores }
}

function clampPct (v) {
  return Math.max(0, Math.min(100, v))
}

// --- Config-driven SOC feed -------------------------------------------------
// feed: { label, url, token?, headerName?, countPath?, warn?, crit?, timeoutMs?, enabled? }
// Returns a tile: { label, value, level }
async function socFeed (feed) {
  const label = (feed && feed.label) || '—'
  if (!feed || !feed.url) return { label, value: '—', level: 'idle', emoji: feed && feed.emoji }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), feed.timeoutMs || 2500)
  try {
    const headers = { Accept: 'application/json' }
    if (feed.token) headers[feed.headerName || 'Authorization'] = feed.token
    const res = await fetch(feed.url, { headers, signal: controller.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const count = extractCount(await res.json(), feed.countPath)
    return { label, value: formatCount(count), level: levelFor(count, feed), emoji: feed.emoji }
  } catch (err) {
    return { label, value: '×', level: 'crit', emoji: feed.emoji, error: String(err && err.message ? err.message : err) }
  } finally {
    clearTimeout(timer)
  }
}

// Pull a count out of an arbitrary JSON body:
//  - countPath "a.b.c" walks the object; if it lands on an array, use its length
//  - otherwise fall back to array length / .count / .total / the raw number
function extractCount (body, countPath) {
  if (countPath) {
    const v = countPath.split('.').reduce((o, k) => (o == null ? o : o[k]), body)
    return Array.isArray(v) ? v.length : Number(v)
  }
  if (Array.isArray(body)) return body.length
  if (body && typeof body.count === 'number') return body.count
  if (body && typeof body.total === 'number') return body.total
  return Number(body)
}

function formatCount (n) {
  if (!Number.isFinite(Number(n))) return '—'
  n = Number(n)
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function levelFor (count, feed) {
  const n = Number(count)
  if (!Number.isFinite(n)) return 'idle'
  const warn = feed.warn != null ? feed.warn : 1
  const crit = feed.crit != null ? feed.crit : 5
  if (n >= crit) return 'crit'
  if (n >= warn) return 'warn'
  return 'ok'
}

// --- Uptime monitor ---------------------------------------------------------
// Short label derived from the host when none is configured.
function hostLabel (url) {
  try {
    return new URL(url).hostname.split('.')[0].toUpperCase().slice(0, 12)
  } catch (_) {
    return '—'
  }
}

// monitor: { label?, url, warnMs?, timeoutMs?, enabled? }
// Returns a tile: { label, value, level, up, ms, status }
async function checkMonitor (monitor) {
  const label = monitor.label || hostLabel(monitor.url)
  const warnMs = monitor.warnMs != null ? monitor.warnMs : 800
  const timeoutMs = monitor.timeoutMs != null ? monitor.timeoutMs : 5000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const t0 = performance.now()
  try {
    const res = await fetch(monitor.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'SOCBar-Monitor/0.1', Accept: '*/*' }
    })
    const ms = Math.round(performance.now() - t0)
    let level
    if (res.status >= 500) level = 'crit' // server up but erroring
    else if (res.status >= 400 || ms >= warnMs) level = 'warn'
    else level = 'ok'
    return { label, value: ms + 'ms', level, up: res.status < 500, ms, status: res.status, emoji: monitor.emoji }
  } catch (err) {
    const timedOut = err && err.name === 'AbortError'
    return { label, value: timedOut ? 'T/O' : 'DOWN', level: 'crit', up: false, ms: null, status: 0, emoji: monitor.emoji }
  } finally {
    clearTimeout(timer)
  }
}

// --- Disk usage -------------------------------------------------------------
// On macOS the real free space lives on the Data volume; / is the sealed system
// volume. df's Capacity column matches Finder's "used".
let diskCache = { pct: null, ts: 0 }
const DISK_TTL_MS = 15000
const DISK_TARGET = process.platform === 'darwin' ? '/System/Volumes/Data' : '/'

function runDf () {
  return new Promise((resolve, reject) => {
    execFile('/bin/df', ['-kP', DISK_TARGET], { timeout: 3000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

async function diskPercent () {
  const now = Date.now()
  if (diskCache.pct != null && now - diskCache.ts < DISK_TTL_MS) return diskCache.pct
  let pct = diskCache.pct || 0
  try {
    const line = (await runDf()).trim().split('\n').pop()
    const cap = line.split(/\s+/).find((c) => /^\d+%$/.test(c))
    if (cap) pct = clampPct(parseInt(cap, 10))
  } catch (_) { /* keep last known value */ }
  diskCache = { pct, ts: now }
  return pct
}

// --- Top processes by CPU / RAM (macOS) ------------------------------------
let procCache = { cpu: [], ram: [], ts: 0 }
const PROC_TTL_MS = 2000

function runPs (args) {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', args, { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

function parseProcs (out) {
  return String(out).trim().split('\n').slice(1) // drop the header row
    .map((line) => {
      const m = line.trim().match(/^([\d.]+)\s+(.+)$/)
      if (!m) return null
      return { pct: parseFloat(m[1]), name: m[2].trim().replace(/^com\.apple\./, '') }
    })
    .filter(Boolean)
    .slice(0, 5)
}

async function topProcesses () {
  const now = Date.now()
  if (now - procCache.ts < PROC_TTL_MS) return procCache
  try {
    const [cpuOut, ramOut] = await Promise.all([
      runPs(['-A', '-c', '-o', 'pcpu,comm', '-r']), // sorted by CPU
      runPs(['-A', '-c', '-o', 'pmem,comm', '-m']) //  sorted by memory
    ])
    procCache = { cpu: parseProcs(cpuOut), ram: parseProcs(ramOut), ts: now }
  } catch (_) { /* keep last known value */ }
  return procCache
}

// --- USB device inventory (macOS) ------------------------------------------
// system_profiler SPUSBDataType returns an empty set on some Apple Silicon
// machines, so we parse ioreg's IOUSBHostDevice nodes instead.
function runIoreg () {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/sbin/ioreg',
      ['-rc', 'IOUSBHostDevice', '-l', '-w', '0'],
      { timeout: 6000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

// Skip hubs, root controllers and bus nodes — keep real peripherals.
const SKIP_USB = /hub|bus$|host controller|root/i

function toHexId (raw) {
  const n = Number(raw)
  return Number.isFinite(n) ? '0x' + (n & 0xffff).toString(16).padStart(4, '0') : ''
}

async function listUsbDevices () {
  if (process.platform !== 'darwin') return []
  let out
  try {
    out = await runIoreg()
  } catch (_) {
    return []
  }

  const devices = []
  const seen = new Set()
  let cur = null

  const flush = () => {
    if (cur) {
      const name = cur.name || cur.headerName
      if (name && !SKIP_USB.test(name)) {
        const sig = [name, cur.vendorId, cur.productId, cur.serial].join('|')
        if (!seen.has(sig)) {
          seen.add(sig)
          devices.push({ name, vendor: cur.vendor, vendorId: cur.vendorId, productId: cur.productId, serial: cur.serial, sig })
        }
      }
    }
    cur = null
  }

  for (const line of out.split('\n')) {
    // Each USB peripheral is an IOUSBHostDevice node; its name is in the header.
    if (line.includes('<class IOUSBHostDevice')) {
      flush()
      const hm = line.match(/\+-o\s+(.+?)@[0-9a-fx]+/i)
      cur = { name: '', headerName: hm ? hm[1].trim() : '', vendor: '', vendorId: '', productId: '', serial: '' }
      continue
    }
    if (!cur) continue
    const m = line.match(/"([^"]+)"\s*=\s*(.+?)\s*$/)
    if (!m) continue
    const key = m[1]
    const val = m[2]
    const str = val.startsWith('"') ? val.slice(1, -1) : val
    if (key === 'USB Product Name') cur.name = str
    else if (key === 'USB Vendor Name') cur.vendor = str
    else if (key === 'USB Serial Number') cur.serial = str
    else if (key === 'idVendor') cur.vendorId = toHexId(val)
    else if (key === 'idProduct') cur.productId = toHexId(val)
  }
  flush()
  return devices
}

module.exports = { cpuPercent, memPercent, loadAvg, diskPercent, socFeed, checkMonitor, hostLabel, listUsbDevices, topProcesses }
