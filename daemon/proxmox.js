'use strict'
// Proxmox VE cluster data via the REST API. One call to /cluster/resources returns
// every node + VM + container with CPU/mem/status. Uses an API token (read-only
// PVEAuditor role recommended). Self-signed TLS supported via insecureTLS.

const https = require('https')
const { load } = require('./config.js')

function getJson (base, apiPath, token, insecure) {
  return new Promise((resolve, reject) => {
    const u = new URL(base)
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 8006,
      path: apiPath,
      method: 'GET',
      headers: { Authorization: 'PVEAPIToken=' + token, Accept: 'application/json' },
      rejectUnauthorized: !insecure,
      timeout: 5000
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Proxmox HTTP ' + res.statusCode))
        try { resolve(JSON.parse(data)) } catch (e) { reject(new Error('Proxmox: JSON invalide')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Proxmox: timeout')))
    req.end()
  })
}

// -> { nodes:[{name,online,cpu(0..1),mem,maxmem}], vms:[{name,vmid,running,cpu,mem,maxmem,node,kind}] }
async function fetchCluster () {
  const cfg = (load().proxmox) || {}
  if (!cfg.url || !cfg.token) throw new Error('config proxmox.url / proxmox.token manquante')
  const j = await getJson(cfg.url, '/api2/json/cluster/resources', cfg.token, cfg.insecureTLS !== false)
  const items = (j && j.data) || []
  const nodes = items.filter((r) => r.type === 'node').map((n) => ({
    name: n.node, online: n.status === 'online', cpu: n.cpu || 0, mem: n.mem || 0, maxmem: n.maxmem || 0
  }))
  const vms = items.filter((r) => r.type === 'qemu' || r.type === 'lxc').map((v) => ({
    name: v.name || (v.type + '/' + v.vmid), vmid: v.vmid, running: v.status === 'running',
    cpu: v.cpu || 0, mem: v.mem || 0, maxmem: v.maxmem || 0, node: v.node, kind: v.type,
    template: v.template === 1 || v.template === true
  }))
  const storages = items.filter((r) => r.type === 'storage').map((s) => ({
    name: s.storage, node: s.node, disk: s.disk || 0, maxdisk: s.maxdisk || 0,
    shared: s.shared === 1, status: s.status
  }))
  return { nodes, vms, storages }
}

module.exports = { fetchCluster }
