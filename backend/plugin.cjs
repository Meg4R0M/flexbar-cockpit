'use strict'

// SOC Bar — FlexDesigner v1 plugin.
// Renders a live status strip to the Flexbar and gives a haptic-confirmed
// touch action. Local metrics work out of the box; SOC feeds are read from
// socbar.config.json (see README).

const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const { plugin, logger, pluginPath } = require('@eniac/flexdesigner')
const { cpuPercent, memPercent, loadAvg, diskPercent, socFeed, checkMonitor, hostLabel, listUsbDevices, topProcesses } = require('./collectors.cjs')
const { renderDashboard, renderLabel, renderUsb, renderAgenda, renderProcs } = require('./render.cjs')

const DASHBOARD_CID = 'com.meg4r0m.socbar.dashboard'
const UPTIME_CID = 'com.meg4r0m.socbar.uptime'
const ACTION_CID = 'com.meg4r0m.socbar.action'
const BAR_HEIGHT = 60
const REFRESH_MS = 1500
const MONITOR_MS = 20000

// Used when socbar.config.json has no monitors[]
const DEFAULT_MONITORS = [
  { label: 'CYBER', emoji: '⚔️🛡️', url: 'https://humanix-cybersecurity.fr', warnMs: 800, timeoutMs: 5000 },
  { label: 'ACADEMIE', emoji: '🦊🎓', url: 'https://humanix-academie.fr', warnMs: 800, timeoutMs: 5000 }
]

const USB_CID = 'com.meg4r0m.socbar.usb'
const USB_MS = 8000
const HIST_CAP = 40
const PING_HIST_CAP = 30
const AGENDA_CID = 'com.meg4r0m.socbar.agenda'
const AGENDA_MS = 60000
const AGENDA_SCRIPT = path.join(__dirname, 'agenda.jxa.js')
const DASH_VIEW_MS = 15000 // auto-revert the dashboard drill-down to overview

const state = {
  serialNumber: null,
  keys: {}, // cid -> last-seen key object
  monitors: [], // last uptime results, cid com.meg4r0m.socbar.uptime
  usb: { devices: [], changedAt: 0, selectedIndex: 0 }, // cid com.meg4r0m.socbar.usb
  agenda: { state: 'init' }, // next calendar event, cid com.meg4r0m.socbar.agenda
  dashView: 'overview', // dashboard drill-down: 'overview' | 'cpu' | 'ram'
  dashViewUntil: 0,
  history: { cpu: [], ram: [], load: [], disk: [] }, // rolling metric history for sparklines
  pingHistory: {}, // label -> rolling ping ms history
  config: { feeds: [] }
}

function pushHist (arr, value, cap) {
  arr.push(value)
  if (arr.length > cap) arr.shift()
  return arr
}

function loadConfig () {
  const candidates = [
    path.resolve(pluginPath || __dirname, 'socbar.config.json'),
    path.resolve(__dirname, '..', 'socbar.config.json')
  ]
  for (const file of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'))
      logger.info('SOC Bar config loaded from ' + file)
      return cfg
    } catch (_) { /* try next */ }
  }
  logger.warn('SOC Bar: no socbar.config.json found, local metrics only')
  return { feeds: [] }
}

function band (v, warn, crit) {
  return v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok'
}

async function buildTiles () {
  const cpu = cpuPercent()
  const mem = await memPercent()
  const load = loadAvg()
  const disk = await diskPercent()

  pushHist(state.history.cpu, cpu, HIST_CAP)
  pushHist(state.history.ram, mem, HIST_CAP)
  pushHist(state.history.load, load.value, HIST_CAP)
  pushHist(state.history.disk, disk, HIST_CAP)

  const tiles = [
    { label: 'CPU', value: cpu + '%', level: band(cpu, 70, 90), history: state.history.cpu.slice(), emoji: '🧠' },
    { label: 'RAM', value: mem + '%', level: band(mem, 75, 92), history: state.history.ram.slice(), emoji: '🐏' },
    { label: 'LOAD', value: load.value.toFixed(2), level: band(load.ratio * 100, 70, 100), history: state.history.load.slice(), emoji: '📊' },
    { label: 'DISK', value: disk + '%', level: band(disk, 80, 92), history: state.history.disk.slice(), emoji: '💾' }
  ]

  const feeds = (state.config.feeds || []).filter((f) => f && f.enabled !== false)
  if (feeds.length) {
    const results = await Promise.all(feeds.map(socFeed))
    for (const r of results) tiles.push(r)
  }
  return tiles
}

function getMonitors () {
  const m = state.config.monitors
  const list = Array.isArray(m) && m.length ? m : DEFAULT_MONITORS
  return list.filter((x) => x && x.enabled !== false && x.url)
}

async function checkAllMonitors () {
  const monitors = getMonitors()
  if (!monitors.length) {
    state.monitors = []
    return
  }
  try {
    state.monitors = await Promise.all(monitors.map(checkMonitor))
    for (const r of state.monitors) {
      if (typeof r.ms === 'number') {
        const h = state.pingHistory[r.label] || (state.pingHistory[r.label] = [])
        pushHist(h, r.ms, PING_HIST_CAP)
      }
    }
    logger.info('uptime: ' + state.monitors.map((r) => r.label + '=' + r.value).join(' '))
  } catch (err) {
    logger.error('uptime check error: ' + (err && err.stack ? err.stack : err))
  }
  renderTick()
}

function uptimeTiles () {
  const base = state.monitors && state.monitors.length
    ? state.monitors
    : getMonitors().map((m) => ({ label: m.label || hostLabel(m.url), value: '…', level: 'idle', emoji: m.emoji }))
  return base.map((t) => ({
    label: t.label, // name stays at top; emoji is drawn as a prefix to the value
    value: t.value,
    level: t.level,
    emoji: t.emoji,
    history: (state.pingHistory[t.label] || []).slice()
  }))
}

async function pollUsb () {
  let list
  try {
    list = await listUsbDevices()
  } catch (err) {
    logger.error('usb scan error: ' + (err && err.stack ? err.stack : err))
    return
  }
  const prev = state.usb.devices
  const prevSigs = new Set(prev.map((d) => d.sig))
  const currSigs = new Set(list.map((d) => d.sig))
  const added = list.filter((d) => !prevSigs.has(d.sig))
  const removed = prev.filter((d) => !currSigs.has(d.sig))

  if (prev.length && (added.length || removed.length)) {
    state.usb.changedAt = Date.now()
    logger.info('usb change: +[' + added.map((d) => d.name).join(', ') + '] -[' + removed.map((d) => d.name).join(', ') + ']')
    if (state.serialNumber) {
      plugin.sendControlCommand(state.serialNumber, 'hapic.click')
      for (const d of added.slice(0, 2)) {
        plugin.showFlexbarSnackbarMessage(state.serialNumber, ('USB+ ' + d.name).slice(0, 64), 'success', 'usb', 2500)
      }
      for (const d of removed.slice(0, 2)) {
        plugin.showFlexbarSnackbarMessage(state.serialNumber, ('USB- ' + d.name).slice(0, 64), 'warning', 'usb', 2500)
      }
    }
  }
  if (!prev.length && list.length) {
    logger.info('usb inventory (' + list.length + '): ' + list.map((d) => d.name).join(', '))
  }
  state.usb.devices = list
  renderTick()
}

function usbModel () {
  const devices = state.usb.devices
  const total = devices.length
  const index = total ? (((state.usb.selectedIndex % total) + total) % total) : 0
  return {
    count: total,
    name: total ? devices[index].name : '—',
    vendor: total ? devices[index].vendor : '',
    index,
    total,
    changed: Date.now() - state.usb.changedAt < 6000
  }
}

function fetchAgenda () {
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', AGENDA_SCRIPT], { timeout: 30000 }, (err, stdout) => {
      const raw = String(stdout || '').trim()
      if (!raw) {
        state.agenda = { state: 'error' }
        logger.error('agenda fetch error: ' + (err && err.message ? err.message : 'no output'))
        renderTick()
        return resolve()
      }
      try {
        const j = JSON.parse(raw.split('\n').pop())
        if (j.ok) {
          const m = String(j.start).match(/(\d+)-(\d+)-(\d+)[ T](\d+):(\d+)/)
          const startISO = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString() : null
          state.agenda = { state: 'ok', title: j.title, startISO, allDay: !!j.allDay, calendar: j.calendar }
        } else if (j.none) state.agenda = { state: 'none' }
        else if (j.noaccess) state.agenda = { state: 'noaccess', status: j.status }
        else state.agenda = { state: 'error' }
        logger.info('agenda: ' + JSON.stringify(state.agenda))
      } catch (e) {
        state.agenda = { state: 'error' }
        logger.error('agenda parse error: ' + e.message)
      }
      renderTick()
      resolve()
    })
  })
}

function agendaModel () {
  const a = state.agenda
  if (!a || a.state === 'init') return { state: 'init' }
  if (a.state !== 'ok') return { state: a.state }
  const start = new Date(a.startISO)
  const diffMin = Math.round((start.getTime() - Date.now()) / 60000)
  let relative
  if (a.allDay) relative = start.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })
  else if (diffMin <= 0) relative = 'maintenant'
  else if (diffMin < 60) relative = 'dans ' + diffMin + ' min'
  else if (diffMin < 1440) relative = 'dans ' + Math.round(diffMin / 60) + ' h'
  else relative = 'dans ' + Math.round(diffMin / 1440) + ' j'
  const hh = String(start.getHours()).padStart(2, '0') + ':' + String(start.getMinutes()).padStart(2, '0')
  const level = (!a.allDay && diffMin >= 0 && diffMin <= 15) ? 'warn' : 'ok'
  return { state: 'ok', time: a.allDay ? 'JOUR' : hh, title: a.title || '(sans titre)', relative, level }
}

let timer = null
let monitorTimer = null
let usbTimer = null
let agendaTimer = null
let frame = 0
function startLoop () {
  if (!timer) {
    timer = setInterval(renderTick, REFRESH_MS)
    renderTick()
  }
  if (!monitorTimer) {
    monitorTimer = setInterval(checkAllMonitors, MONITOR_MS)
    checkAllMonitors()
  }
  if (!usbTimer) {
    usbTimer = setInterval(pollUsb, USB_MS)
    pollUsb()
  }
  if (!agendaTimer) {
    agendaTimer = setInterval(fetchAgenda, AGENDA_MS)
    fetchAgenda()
  }
}

async function renderTick () {
  if (!state.serialNumber) return

  const dash = state.keys[DASHBOARD_CID]
  if (dash) {
    try {
      if (state.dashView !== 'overview' && Date.now() > state.dashViewUntil) state.dashView = 'overview'
      let png
      if (state.dashView === 'overview') {
        png = renderDashboard(dash.width || 600, BAR_HEIGHT, await buildTiles())
      } else {
        const procs = await topProcesses()
        const metric = state.dashView === 'cpu' ? 'CPU' : 'RAM'
        png = renderProcs(dash.width || 600, BAR_HEIGHT, metric, state.dashView === 'cpu' ? procs.cpu : procs.ram)
      }
      await plugin.draw(state.serialNumber, dash, 'base64', png)
      frame++
      if (frame === 1 || frame % 20 === 0) {
        logger.info('drew dashboard frame #' + frame + ' (view=' + state.dashView + ')')
      }
    } catch (err) {
      logger.error('dashboard render error: ' + (err && err.stack ? err.stack : err))
    }
  }

  const up = state.keys[UPTIME_CID]
  if (up) {
    try {
      await plugin.draw(state.serialNumber, up, 'base64', renderDashboard(up.width || 400, BAR_HEIGHT, uptimeTiles()))
    } catch (err) {
      logger.error('uptime render error: ' + (err && err.stack ? err.stack : err))
    }
  }

  const usb = state.keys[USB_CID]
  if (usb) {
    try {
      await plugin.draw(state.serialNumber, usb, 'base64', renderUsb(usb.width || 500, BAR_HEIGHT, usbModel()))
    } catch (err) {
      logger.error('usb render error: ' + (err && err.stack ? err.stack : err))
    }
  }

  const agenda = state.keys[AGENDA_CID]
  if (agenda) {
    try {
      await plugin.draw(state.serialNumber, agenda, 'base64', renderAgenda(agenda.width || 460, BAR_HEIGHT, agendaModel()))
    } catch (err) {
      logger.error('agenda render error: ' + (err && err.stack ? err.stack : err))
    }
  }
}

plugin.on('device.status', (devices) => {
  for (const d of devices) {
    if (d.status === 'connected') {
      state.serialNumber = d.serialNumber
      plugin.setDeviceConfig(d.serialNumber, {
        brightness: 90,
        vibrate: 'full',
        autoSleep: true,
        deviceName: 'SOC Bar'
      })
    }
  }
})

plugin.on('plugin.alive', (payload) => {
  state.serialNumber = payload.serialNumber
  logger.info('alive: sn=' + payload.serialNumber + ' keys=[' + payload.keys.map((k) => k.cid).join(', ') + ']')
  for (const key of payload.keys) {
    state.keys[key.cid] = key
    if (key.cid === ACTION_CID) {
      plugin.draw(state.serialNumber, key, 'base64', renderLabel(key.width || 120, BAR_HEIGHT, 'REFRESH', 'ok'))
    }
  }
  startLoop()
})

plugin.on('plugin.data', async (payload) => {
  const key = payload.data.key
  const sn = payload.serialNumber
  if (key.cid === DASHBOARD_CID) {
    // tap cycles: overview -> CPU top5 -> RAM top5 -> overview
    state.dashView = state.dashView === 'overview' ? 'cpu' : state.dashView === 'cpu' ? 'ram' : 'overview'
    state.dashViewUntil = Date.now() + DASH_VIEW_MS
    try {
      await plugin.sendControlCommand(sn, 'hapic.click')
      if (state.dashView !== 'overview') await topProcesses()
      await renderTick()
    } catch (err) {
      logger.error('dashboard action error: ' + (err && err.stack ? err.stack : err))
    }
    return { status: 'success' }
  }
  if (key.cid === USB_CID) {
    // tap cycles to the next device (wraps around)
    const total = state.usb.devices.length
    if (total) state.usb.selectedIndex = (state.usb.selectedIndex + 1) % total
    try {
      await plugin.sendControlCommand(sn, 'hapic.click')
      await renderTick()
    } catch (err) {
      logger.error('usb action error: ' + (err && err.stack ? err.stack : err))
    }
    return { status: 'success' }
  }
  if (key.cid === UPTIME_CID) {
    try {
      await plugin.sendControlCommand(sn, 'hapic.click')
      await checkAllMonitors()
      plugin.showFlexbarSnackbarMessage(sn, 'Uptime recheck', 'info', 'refresh', 800)
    } catch (err) {
      logger.error('uptime action error: ' + (err && err.stack ? err.stack : err))
    }
    return { status: 'success' }
  }
  if (key.cid === AGENDA_CID) {
    try {
      await plugin.sendControlCommand(sn, 'hapic.click')
      await fetchAgenda()
    } catch (err) {
      logger.error('agenda action error: ' + (err && err.stack ? err.stack : err))
    }
    return { status: 'success' }
  }
  if (key.cid === ACTION_CID) {
    try {
      await plugin.sendControlCommand(sn, 'hapic.click') // tactile confirmation
      await renderTick()
      plugin.showFlexbarSnackbarMessage(sn, 'SOC refresh', 'success', 'refresh', 800)
    } catch (err) {
      logger.error('action error: ' + (err && err.stack ? err.stack : err))
    }
    return { status: 'success' }
  }
})

state.config = loadConfig()
plugin.start()
logger.info('SOC Bar plugin started on node ' + process.version + ' (fetch=' + (typeof fetch !== 'undefined') + ')')
