'use strict'
// Flexbar — console opérateur de nœud d'attaque (headless, NixOS). Sans FlexDesigner.
// Slots : 0 scope · 1 vitals hôte · 2 egress/VPN · 3 mission+tunnels · 4 crypto.
// --demo = données fictives (pas besoin du nœud). Config : socbar-daemon.config.json.

const { Flexbar } = require('./flexbar.js')
const { scopeTile, nodesOverview, egressTile, sessionsTile, cryptoTile } = require('./render.js')
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
const localNom = (cfg.node && cfg.node.nom) || 'atk1'
let nodesC = [{ nom: localNom, cpu: 0, ram: 0, online: true }] // [local, ...pairs]
const histByNode = {} // { nom: { cpu: [0..1], ram: [0..1] } }
let egressC = { ip: null, via: null, ok: false }
let scopeC = { armed: false, mission: null }
let sessC = { wg: false, c2: 0, listeners: 0 }
let rotIdx = 0
let lastRot = 0

function pushHist (nom, cpu, ram) {
  const h = histByNode[nom] || (histByNode[nom] = { cpu: [], ram: [] })
  h.cpu.push(cpu || 0); if (h.cpu.length > HIST) h.cpu.shift()
  h.ram.push(ram || 0); if (h.ram.length > HIST) h.ram.shift()
}

function demo () {
  const t = Date.now() / 1000
  nodesC = [
    { nom: 'atk1', cpu: Math.max(0, 0.32 + 0.18 * Math.sin(t / 4)), ram: 0.52 + 0.05 * Math.sin(t / 7), online: true },
    { nom: 'atk2', cpu: Math.max(0, 0.21 + 0.12 * Math.sin(t / 5)), ram: 0.44 + 0.05 * Math.cos(t / 6), online: true }
  ]
  nodesC.forEach((n) => pushHist(n.nom, n.cpu, n.ram))
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
    if (DEMO) { demo(); return }
    const h = atk.host(); sessC = atk.sessions()
    nodesC[0] = { nom: localNom, cpu: h.cpu, ram: h.ram, online: true }
    pushHist(localNom, h.cpu, h.ram)
  } catch (e) { console.log('[poll]', e.message) }
}
// Poll lent : egress (requête HTTP pour l'IP publique).
function pollEgress () {
  if (DEMO) return
  atk.egress().then((e) => { egressC = e }).catch((e) => console.log('[egress]', e.message))
}
// Poll moyen : scope/mission (appel API hx-console).
function pollScope () {
  if (DEMO) return
  atk.scope().then((s) => { scopeC = s }).catch((e) => console.log('[scope]', e.message))
}
// Poll moyen : vitals des nœuds pairs (node_exporter :9100, lecture seule).
function pollPeers () {
  if (DEMO) return
  atk.peers().then((ps) => {
    nodesC = [nodesC[0], ...ps]
    ps.forEach((p) => pushHist(p.nom, p.cpu, p.ram))
  }).catch((e) => console.log('[peers]', e.message))
}

function paint () {
  try {
    bar.draw(S.scope.i, scopeTile(S.scope.w, scopeC))
    bar.draw(S.host.i, nodesOverview(S.host.w, nodesC, histByNode))
    // État egress : tunnel ? sinon LEAK si une mission est armée, sinon LAN (neutre).
    const vpnIf = (cfg.egress && cfg.egress.vpnInterface) || null
    const tun = egressC.via && /^(wg|tun|tailscale|nebula|proton|mullvad|zt)/i.test(egressC.via)
    const onVpn = vpnIf ? (egressC.via === vpnIf) : tun
    const estate = onVpn ? 'vpn' : (scopeC.armed ? 'leak' : 'lan')
    bar.draw(S.egress.i, egressTile(S.egress.w, { ip: egressC.ip, via: egressC.via, state: estate }))
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
if (!DEMO) {
  pollEgress(); setInterval(pollEgress, egressMs)
  pollScope(); setInterval(pollScope, (cfg.scope && cfg.scope.refreshMs) || 15000)
  pollPeers(); setInterval(pollPeers, (cfg.node && cfg.node.refreshMs) || 5000)
}
if (cryptoOn) { const pc = () => fetchCrypto().catch((e) => console.log('[crypto]', e.message)); pc(); setInterval(pc, cryptoMs) }

bar.run()
const iv = setInterval(() => { if (bar.ready) { try { paint() } catch (e) { console.log('[loop]', e.message) } } }, refreshMs)
process.on('SIGINT', () => { clearInterval(iv); process.exit(0) })
console.log('[atk] démarrage' + (DEMO ? ' (démo)' : '') +
  ` — refresh ${refreshMs}ms, slots scope=${S.scope.i} host=${S.host.i} egress=${S.egress.i} sessions=${S.sessions.i} crypto=${S.crypto.i}`)
