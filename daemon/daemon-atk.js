'use strict'
// Flexbar — console opérateur de nœud d'attaque (headless, NixOS). Sans FlexDesigner.
// Slots : 0 scope · 1 vitals hôte · 2 egress/VPN · 3 mission+tunnels · 4 crypto.
// --demo = données fictives (pas besoin du nœud). Config : socbar-daemon.config.json.

const { Flexbar } = require('./flexbar.js')
const { scopeTile, hostOverview, egressTile, sessionsTile, cryptoTile } = require('./render.js')
const atk = require('./atk.js')
const { fetchCrypto, getCached: cryptoCached } = require('./crypto.js')
const { load } = require('./config.js')

const cfg = load()
const DEMO = process.argv.includes('--demo')
const refreshMs = cfg.refreshMs || 3000
const rotateMs = cfg.detailRotateMs || 3000
const sl = cfg.slots || {}
const S = {
  scope: { i: sl.scope != null ? sl.scope : 0, w: sl.scopeW || 120 },
  host: { i: sl.host != null ? sl.host : 1, w: sl.hostW || 600 },
  egress: { i: sl.egress != null ? sl.egress : 2, w: sl.egressW || 400 },
  sessions: { i: sl.sessions != null ? sl.sessions : 3, w: sl.sessionsW || 500 },
  crypto: { i: sl.crypto != null ? sl.crypto : 4, w: sl.cryptoW || 460 }
}
const cryptoOn = !cfg.crypto || cfg.crypto.enabled !== false
const cryptoMs = (cfg.crypto && cfg.crypto.refreshMs) || 45000
const egressMs = (cfg.egress && cfg.egress.refreshMs) || 30000

const HIST = 40
const histCpu = []
const histRam = []
let hostC = { cpu: 0, ram: 0, load: 0, cores: 8, temp: null }
let egressC = { ip: null, via: null, ok: false }
let scopeC = { armed: false, mission: null }
let sessC = { wg: false, c2: 0, listeners: 0 }
let rotIdx = 0
let lastRot = 0

function demo () {
  const t = Date.now() / 1000
  hostC = { cpu: Math.max(0, 0.32 + 0.18 * Math.sin(t / 4)), ram: 0.52 + 0.05 * Math.sin(t / 7), load: 3.1, cores: 16, temp: 61 }
  egressC = { ip: '185.220.101.47', via: 'wg0', ok: true }
  scopeC = { armed: true, mission: 'acme-redteam' }
  sessC = { wg: true, c2: 3, listeners: 2 }
}

const bar = new Flexbar({
  serialPath: cfg.serialPath,
  onEvent: (m) => { if (m && m.evt === 'click') console.log('[tap]', m.key && m.key.cid) },
  onReady: () => console.log('[atk] barre prête' + (DEMO ? ' (démo)' : ''))
})

// Poll rapide (cheap) : vitals + scope + sessions.
function pollFast () {
  try {
    if (DEMO) demo()
    else { hostC = atk.host(); scopeC = atk.scope(); sessC = atk.sessions() }
    histCpu.push(hostC.cpu || 0); if (histCpu.length > HIST) histCpu.shift()
    histRam.push(hostC.ram || 0); if (histRam.length > HIST) histRam.shift()
  } catch (e) { console.log('[poll]', e.message) }
}
// Poll lent : egress (fait une requête HTTP pour l'IP publique).
function pollEgress () {
  if (DEMO) return
  atk.egress().then((e) => { egressC = e }).catch((e) => console.log('[egress]', e.message))
}

function paint () {
  try {
    bar.draw(S.scope.i, scopeTile(S.scope.w, scopeC))
    bar.draw(S.host.i, hostOverview(S.host.w, hostC, { cpu: histCpu, ram: histRam }))
    bar.draw(S.egress.i, egressTile(S.egress.w, egressC))
    bar.draw(S.sessions.i, sessionsTile(S.sessions.w, { ...sessC, mission: scopeC.mission }))
    const coins = cryptoOn ? cryptoCached() : []
    if (coins.length) {
      if (Date.now() - lastRot >= rotateMs) { rotIdx++; lastRot = Date.now() }
      bar.draw(S.crypto.i, cryptoTile(S.crypto.w, { ...coins[rotIdx % coins.length], index: rotIdx % coins.length, total: coins.length }))
    }
  } catch (e) { console.log('[paint]', e.stack || e.message) }
}

pollFast()
setInterval(pollFast, Math.min(refreshMs, 3000))
if (!DEMO) { pollEgress(); setInterval(pollEgress, egressMs) }
if (cryptoOn) { const pc = () => fetchCrypto().catch((e) => console.log('[crypto]', e.message)); pc(); setInterval(pc, cryptoMs) }

bar.run()
const iv = setInterval(() => { if (bar.ready) { try { paint() } catch (e) { console.log('[loop]', e.message) } } }, refreshMs)
process.on('SIGINT', () => { clearInterval(iv); process.exit(0) })
console.log('[atk] démarrage' + (DEMO ? ' (démo)' : '') +
  ` — refresh ${refreshMs}ms, slots scope=${S.scope.i} host=${S.host.i} egress=${S.egress.i} sessions=${S.sessions.i} crypto=${S.crypto.i}`)
