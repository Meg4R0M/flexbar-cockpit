'use strict'
// Crypto tickers via a public exchange API (Binance /ticker/24hr — pas de clé requise).
// Renvoie prix + variation 24h. Mise en cache : le démon rafraîchit sur son propre
// intervalle (lent), la boucle de dessin lit le cache.

const https = require('https')
const { load } = require('./config.js')

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT', 'SOLUSDT', 'VETUSDT']
let cache = []

function cfg () {
  try { return load().crypto || {} } catch (_) { return {} }
}

// Format lisible selon l'ordre de grandeur.
function fmtPrice (p) {
  if (!isFinite(p)) return '—'
  if (p >= 1000) return '$' + Math.round(p).toLocaleString('en-US')
  if (p >= 1) return '$' + p.toFixed(2)
  if (p >= 0.01) return '$' + p.toFixed(4)
  return '$' + p.toPrecision(3)
}

function getJson (host, apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: host, path: apiPath, timeout: 6000, headers: { 'User-Agent': 'flexbar-cockpit' } }, (r) => {
      let d = ''
      r.on('data', (c) => { d += c })
      r.on('end', () => {
        if (r.statusCode !== 200) return reject(new Error('crypto HTTP ' + r.statusCode))
        try { resolve(JSON.parse(d)) } catch (e) { reject(new Error('crypto: JSON invalide')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('crypto: timeout')))
  })
}

// -> [{ symbol, base, price, priceStr, changePct }]
async function fetchCrypto () {
  const c = cfg()
  const symbols = (c.symbols && c.symbols.length) ? c.symbols : DEFAULT_SYMBOLS
  const host = c.host || 'api.binance.com'
  const path = '/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symbols))
  const arr = await getJson(host, path)
  const bySym = {}
  ;(Array.isArray(arr) ? arr : []).forEach((x) => { bySym[x.symbol] = x })
  const coins = symbols.map((s) => {
    const x = bySym[s]
    if (!x) return null
    const price = +x.lastPrice
    return { symbol: s, base: s.replace(/USDT$/, ''), price, priceStr: fmtPrice(price), changePct: +x.priceChangePercent }
  }).filter(Boolean)
  if (coins.length) cache = coins // ne pas écraser un bon cache par un vide
  return coins
}

function getCached () { return cache }

module.exports = { fetchCrypto, getCached, DEFAULT_SYMBOLS }
