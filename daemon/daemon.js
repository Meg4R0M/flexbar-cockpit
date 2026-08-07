'use strict'
// Flexbar cluster daemon (headless, no FlexDesigner). Draws a Proxmox cluster/VM
// cockpit across the bar's 5 keys. Config in socbar-daemon.config.json (see .example).
// Use --demo for synthetic data (no Proxmox needed) to validate the bar.
//
// Layout (5 slots): 0 brand · 1 cluster stats · 2 alerts · 3 VMs (no templates) · 4 free disk

const { Flexbar } = require('./flexbar.js')
const { brandTile, clusterOverview, alertsTile, resourceLine, diskTile } = require('./render.js')
const { computeAlerts, clusterDisk } = require('./metrics.js')
const { load } = require('./config.js')

const cfg = load()
const DEMO = process.argv.includes('--demo')
const refreshMs = cfg.refreshMs || 3000
const rotateMs = cfg.detailRotateMs || 3000
const sl = cfg.slots || {}
// index = key position on the bar; w = that key's pixel width (SOC Bar profile).
const S = {
  brand: { i: sl.brand != null ? sl.brand : 0, w: sl.brandW || 120 },
  overview: { i: sl.overview != null ? sl.overview : 1, w: sl.overviewW || 600 },
  alerts: { i: sl.alerts != null ? sl.alerts : 2, w: sl.alertsW || 400 },
  vms: { i: sl.vms != null ? sl.vms : 3, w: sl.vmsW || 500 },
  disk: { i: sl.disk != null ? sl.disk : 4, w: sl.diskW || 460 }
}

function demoCluster (t) {
  const j = (b, a) => Math.max(0, Math.min(1, b + a * Math.sin(t / 3) + (Math.random() * a - a / 2)))
  return {
    nodes: [
      { name: 'pve1', online: true, cpu: j(0.3, 0.2), maxmem: 64e9, mem: 20e9 },
      { name: 'pve2', online: true, cpu: j(0.55, 0.25), maxmem: 64e9, mem: 38e9 }
    ],
    vms: [
      { name: 'dc01', kind: 'qemu', running: true, cpu: j(0.4, 0.2), maxmem: 8e9, mem: 5.2e9, template: false },
      { name: 'app-01', kind: 'lxc', running: true, cpu: j(0.2, 0.1), maxmem: 16e9, mem: 12e9, template: false },
      { name: 'db-01', kind: 'qemu', running: true, cpu: j(0.15, 0.1), maxmem: 8e9, mem: 6.1e9, template: false },
      { name: 'vm-test', kind: 'qemu', running: false, cpu: 0, maxmem: 4e9, mem: 0, template: false },
      { name: 'debian12-tmpl', kind: 'qemu', running: false, cpu: 0, maxmem: 2e9, mem: 0, template: true }
    ],
    storages: [
      { name: 'chiffre', disk: 480e9, maxdisk: 1e12 },
      { name: 'local', disk: 12e9, maxdisk: 100e9 },
      { name: 'backup', disk: 88e9, maxdisk: 92e9 }
    ]
  }
}

async function getCluster (t) {
  if (DEMO) return demoCluster(t)
  return require('./proxmox.js').fetchCluster()
}

let tick = 0
let rotIdx = 0
let lastRot = 0
const HIST = 40 // ~2 min d'historique à refresh 3s
const histCpu = []
const histRam = []

const bar = new Flexbar({
  serialPath: cfg.serialPath, // ex. "/dev/ttyACM0" en LXC (bypass auto-détect)
  onEvent: (msg) => {
    if (msg && msg.evt === 'click') console.log('[tap]', msg.key && msg.key.cid)
  },
  onReady: () => console.log('[daemon] barre prête — dessin' + (DEMO ? ' (démo)' : ' (Proxmox)'))
})

async function paint () {
  tick++
  let cl
  try {
    cl = await getCluster(tick)
  } catch (e) {
    console.log('[data]', e.message)
    return
  }
  try {
    const realVms = cl.vms.filter((v) => !v.template)
    const alerts = computeAlerts(cl)
    const store = clusterDisk(cl.storages)
    if (Date.now() - lastRot >= rotateMs) { rotIdx++; lastRot = Date.now() }

    // Rolling history (0..1) for the CPU/RAM sparklines.
    const cpuFrac = cl.nodes.reduce((s, n) => s + (n.cpu || 0), 0) / Math.max(1, cl.nodes.length)
    const memU = cl.nodes.reduce((s, n) => s + (n.mem || 0), 0)
    const memT = cl.nodes.reduce((s, n) => s + (n.maxmem || 0), 0)
    histCpu.push(cpuFrac); if (histCpu.length > HIST) histCpu.shift()
    histRam.push(memT ? memU / memT : 0); if (histRam.length > HIST) histRam.shift()

    bar.draw(S.brand.i, brandTile(S.brand.w))
    bar.draw(S.overview.i, clusterOverview(S.overview.w, { nodes: cl.nodes, vms: realVms }, { cpu: histCpu, ram: histRam }))
    bar.draw(S.alerts.i, alertsTile(S.alerts.w, alerts, rotIdx))
    if (realVms.length) {
      const vm = realVms[rotIdx % realVms.length]
      bar.draw(S.vms.i, resourceLine(S.vms.w, {
        kind: vm.kind, name: vm.name, cpu: vm.cpu, mem: vm.mem, maxmem: vm.maxmem,
        running: vm.running, index: rotIdx % realVms.length, total: realVms.length
      }))
    } else {
      bar.draw(S.vms.i, resourceLine(S.vms.w, { kind: 'vm', name: 'aucune VM', index: 0, total: 0 }))
    }
    bar.draw(S.disk.i, diskTile(S.disk.w, store))
  } catch (e) {
    console.log('[paint]', e.stack || e.message) // ne JAMAIS avaler en silence (bug polices 2026-08)
  }
}

bar.run()
const iv = setInterval(() => { if (bar.ready) paint().catch((e) => console.log('[loop]', e.message)) }, refreshMs)
process.on('SIGINT', () => { clearInterval(iv); process.exit(0) })
console.log('[daemon] démarrage' + (DEMO ? ' (démo)' : '') +
  ` — refresh ${refreshMs}ms, slots brand=${S.brand.i} stats=${S.overview.i} alertes=${S.alerts.i} vms=${S.vms.i} disk=${S.disk.i}`)
