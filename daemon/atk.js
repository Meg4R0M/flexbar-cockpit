'use strict'
// Collecteurs « nœud d'attaque » (NixOS), tous robustes : ne lèvent jamais, renvoient
// des valeurs partielles/par défaut en cas d'erreur. Spécificités du nœud = config.
//   cfg.node     { tempZone }
//   cfg.egress   { vpnInterface, probeUrl, refreshMs }
//   cfg.scope    { missionFile, nftSet, armedCmd }
//   cfg.sessions { c2Cmd, listenCmd }

const os = require('os')
const fs = require('fs')
const https = require('https')
const { execSync } = require('child_process')
const { load } = require('./config.js')

function cfg () { try { return load() } catch (_) { return {} } }
function sh (cmd) {
  try { return execSync(cmd, { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch (_) { return '' }
}

// ---------- Vitals hôte ----------
let prevCpu = null
function cpuSample () {
  try {
    const first = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0]
    const p = first.trim().split(/\s+/).slice(1).map(Number)
    return { idle: p[3] + (p[4] || 0), total: p.reduce((a, b) => a + b, 0) }
  } catch (_) { return null }
}
function host () {
  const c = cfg()
  let cpu = 0
  const s = cpuSample()
  if (s && prevCpu && s.total > prevCpu.total) {
    cpu = Math.max(0, Math.min(1, 1 - (s.idle - prevCpu.idle) / (s.total - prevCpu.total)))
  }
  if (s) prevCpu = s
  let ram = 0
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8')
    const tot = +((/MemTotal:\s+(\d+)/.exec(mi) || [])[1])
    const avail = +((/MemAvailable:\s+(\d+)/.exec(mi) || [])[1])
    if (tot) ram = Math.max(0, Math.min(1, 1 - avail / tot))
  } catch (_) {}
  let temp = null
  const zone = (c.node && c.node.tempZone) || '/sys/class/thermal/thermal_zone0/temp'
  try { const t = +fs.readFileSync(zone, 'utf8'); if (t) temp = t > 1000 ? t / 1000 : t } catch (_) {}
  return { cpu, ram, load: os.loadavg()[0], cores: os.cpus().length || 8, temp }
}

// ---------- Egress / VPN ----------
let egressC = { ip: null, via: null, ok: false }
function defaultIface () {
  const m = /\bdev\s+(\S+)/.exec(sh('ip route get 1.1.1.1 2>/dev/null'))
  return m ? m[1] : null
}
function fetchIp (url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url)
      const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, timeout: 5000, headers: { 'User-Agent': 'flexbar' } }, (r) => {
        let d = ''; r.on('data', (c) => { d += c }); r.on('end', () => resolve(((d || '').trim().split('\n')[0]) || null))
      })
      req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null) })
    } catch (_) { resolve(null) }
  })
}
async function egress () {
  const c = cfg().egress || {}
  const via = defaultIface() // interface de la route par défaut (ex. lan0, wg0…)
  let ip = egressC.ip
  if (c.probeUrl !== false) ip = (await fetchIp(c.probeUrl || 'https://api.ipify.org')) || ip
  egressC = { ip, via } // l'état vpn/leak/lan est décidé par le démon (connaît le scope)
  return egressC
}
function egressCached () { return egressC }

// ---------- Scope / mission (API HX-Platform hx-console) ----------
// Armé = une mission au statut « in_progress » existe (scope-firewall actif). Sinon LIBRE.
let scopeC = { armed: false, mission: null }
function getJson (url, headers) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url)
      const lib = u.protocol === 'http:' ? require('http') : https
      const req = lib.get({ hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, timeout: 4000, headers }, (r) => {
        let d = ''
        r.on('data', (c) => { d += c })
        r.on('end', () => {
          if (r.statusCode !== 200) return reject(new Error('hx-console HTTP ' + r.statusCode))
          try { resolve(JSON.parse(d)) } catch (e) { reject(new Error('hx-console: JSON invalide')) }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('hx-console: timeout')))
    } catch (e) { reject(e) }
  })
}
async function scope () {
  const c = cfg().scope || {}
  if (!c.apiUrl) { scopeC = { armed: false, mission: null }; return scopeC }
  const headers = { Accept: 'application/json' }
  if (c.apiKey) headers[c.headerName || 'X-API-Key'] = c.apiKey
  const active = c.activeStatus || 'in_progress'
  try {
    const j = await getJson(c.apiUrl.replace(/\/$/, '') + (c.path || '/api/missions/'), headers)
    const arr = Array.isArray(j) ? j : (j.missions || j.data || [])
    const m = arr.find((x) => (x.status || x.statut) === active)
    scopeC = { armed: !!m, mission: m ? (m.nom || m.name || m.id || null) : null }
  } catch (e) {
    scopeC = { armed: scopeC.armed, mission: scopeC.mission, error: e.message } // garde le dernier état connu
  }
  return scopeC
}
function scopeCached () { return scopeC }

// ---------- Sessions / tunnels ----------
let sessC = { wg: false, c2: 0, listeners: 0 }
function sessions () {
  const c = cfg().sessions || {}
  const wg = sh('wg show interfaces 2>/dev/null').length > 0
  const lo = sh(c.listenCmd || 'ss -H -tln 2>/dev/null')
  const listeners = lo ? lo.split('\n').filter(Boolean).length : 0
  let c2 = 0
  if (c.c2Cmd) c2 = parseInt(sh(c.c2Cmd), 10) || 0
  sessC = { wg, c2, listeners }
  return sessC
}
function sessionsCached () { return sessC }

module.exports = { host, egress, egressCached, scope, scopeCached, sessions, sessionsCached }
