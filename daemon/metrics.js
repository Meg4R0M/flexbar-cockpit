'use strict'
// Shared cluster-metric logic (single source of truth for daemon.js + realshot.js).
// Key insight: a NON-shared storage (e.g. lvmthin `chiffre`) exists once PER NODE with
// its own usage — dedup by name would hide the busy one. So key = name (shared) or
// name@node (local).

const shortNode = (n) => String(n || '').replace(/^humanix-/, '')
const storeKey = (s) => (s.shared ? s.name : s.name + '@' + s.node)

// Alerts derived from cluster state: offline nodes + near-full storages.
function computeAlerts (cl) {
  const a = []
  cl.nodes.filter((n) => !n.online).forEach((n) => a.push({ sev: 'crit', text: 'NOEUD ' + shortNode(n.name) + ' HS' }))
  const seen = new Set()
  ;(cl.storages || []).forEach((s) => {
    if (!s.maxdisk || seen.has(storeKey(s))) return
    seen.add(storeKey(s))
    const pct = Math.round(100 * s.disk / s.maxdisk)
    const label = s.shared ? s.name : s.name + '/' + shortNode(s.node)
    if (pct >= 90) a.push({ sev: 'crit', text: 'STOCK ' + label + ' ' + pct + '%' })
    else if (pct >= 80) a.push({ sev: 'warn', text: 'STOCK ' + label + ' ' + pct + '%' })
  })
  return a
}

// Aggregate free/total across all distinct physical storages (shared counted once).
function clusterDisk (storages) {
  const seen = new Set()
  let disk = 0
  let maxdisk = 0
  ;(storages || []).forEach((s) => {
    if (!s.maxdisk || seen.has(storeKey(s))) return
    seen.add(storeKey(s))
    disk += s.disk
    maxdisk += s.maxdisk
  })
  return maxdisk ? { free: maxdisk - disk, total: maxdisk } : null
}

module.exports = { computeAlerts, clusterDisk, shortNode }
