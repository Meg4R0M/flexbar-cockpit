'use strict'
// Widgets for the Flexbar cluster cockpit. Returns RGB PNG (colortype 2) buffers.
// Colour emoji: Skia needs the emoji font explicitly registered (installing the
// package isn't enough) — see EMOJI below. Falls back to a coloured dot if absent.
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')
const { canvasToRgbPng } = require('./png.js')

const C = {
  bg: '#0b0e14', divider: '#1e2733', label: '#5c6b7a', text: '#c9d1d9',
  ok: '#3fb950', warn: '#d29922', crit: '#f85149', idle: '#484f58', accent: '#1f6feb'
}
const lvl = (l) => C[l] || C.text
const band = (v, w, c) => (v >= c ? 'crit' : v >= w ? 'warn' : 'ok')

// Register a colour-emoji font if we can find one (Linux paths first, then fc-list).
let EMOJI = false
;(function registerEmoji () {
  const fs = require('fs')
  const cands = [
    '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
    '/usr/share/fonts/noto/NotoColorEmoji.ttf',
    '/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf'
  ]
  for (const p of cands) { try { if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, 'Emoji'); EMOJI = true; return } } catch (e) {} }
  try {
    const p = require('child_process').execSync('fc-list | grep -i emoji | head -1 | cut -d: -f1', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (p) { GlobalFonts.registerFromPath(p, 'Emoji'); EMOJI = true }
  } catch (e) {}
})()

// UI font: Orbitron (chosen, techno/cockpit look). Registered from ./fonts if present,
// else falls back to Arial/Liberation. Accented glyphs Orbitron lacks fall back too.
let UIFONT = 'Arial'
;(function registerUi () {
  const fs = require('fs')
  for (const p of [require('path').join(__dirname, 'fonts', 'Orbitron.ttf'), '/opt/flexbar-daemon/fonts/Orbitron.ttf']) {
    try { if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, 'Orbitron'); UIFONT = 'Orbitron, Arial'; return } } catch (e) {}
  }
})()

function fit (ctx, text, maxWidth, px) {
  ctx.font = '700 ' + px + 'px ' + UIFONT
  while (px > 8 && ctx.measureText(text).width > maxWidth) { px--; ctx.font = '700 ' + px + 'px ' + UIFONT }
  if (ctx.measureText(text).width > maxWidth) {
    let s = text
    while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
    text = s + '…'
  }
  return { text, px }
}

function gbStr (bytes) {
  const g = bytes / 1073741824
  return g >= 1024 ? (g / 1024).toFixed(1) + ' To' : Math.round(g) + ' Go'
}

// Draw an emoji glyph (colour, intrinsic — ignores fillStyle). Returns true if drawn.
function icon (ctx, ch, x, yMid, size) {
  if (!EMOJI || !ch) return false
  const f = ctx.font; const a = ctx.textAlign; const b = ctx.textBaseline
  ctx.font = size + 'px Emoji'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(ch, x, yMid)
  ctx.font = f; ctx.textAlign = a; ctx.textBaseline = b
  return true
}

function newCanvas (width) {
  const canvas = createCanvas(width, 60)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, width, 60)
  return { canvas, ctx }
}

// Leading glyph (emoji, or coloured dot fallback) + a small label. Returns text x.
function labelWith (ctx, x, iconCh, color, text) {
  let tx = x + 10
  if (icon(ctx, iconCh, x + 6, 16, 14)) { tx = x + 27 } else {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + 12, 16, 3.5, 0, Math.PI * 2); ctx.fill(); tx = x + 22
  }
  ctx.fillStyle = C.label; ctx.font = '600 10px ' + UIFONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(text, tx, 16)
}

// Faint background area sparkline. hist = values 0..1.
function drawSpark (ctx, x0, w, hist, color) {
  if (!hist || hist.length < 2) return
  const top = 21; const bot = 57; const n = hist.length
  const px = (i) => x0 + w * (i / (n - 1))
  const py = (v) => bot - (bot - top) * Math.max(0, Math.min(1, v))
  ctx.save()
  ctx.beginPath(); ctx.moveTo(px(0), py(hist[0]))
  for (let i = 1; i < n; i++) ctx.lineTo(px(i), py(hist[i]))
  ctx.lineTo(px(n - 1), bot); ctx.lineTo(px(0), bot); ctx.closePath()
  ctx.globalAlpha = 0.16; ctx.fillStyle = color; ctx.fill()
  ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.strokeStyle = color
  ctx.beginPath(); ctx.moveTo(px(0), py(hist[0]))
  for (let i = 1; i < n; i++) ctx.lineTo(px(i), py(hist[i]))
  ctx.stroke()
  ctx.restore()
}

// Slot 0 — brand: shield emoji + wordmark.
function brandTile (width) {
  const { canvas, ctx } = newCanvas(width)
  ctx.fillStyle = C.accent; ctx.fillRect(0, 0, width, 3)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const hasIcon = icon(ctx, '🛡', width / 2 - 13, 22, 26)
  const f = fit(ctx, 'HUMANIX', width - 10, hasIcon ? 14 : 19)
  ctx.fillStyle = C.text; ctx.font = '700 ' + f.px + 'px ' + UIFONT; ctx.fillText(f.text, width / 2, hasIcon ? 47 : 26)
  if (!hasIcon) { ctx.fillStyle = C.accent; ctx.font = '600 10px ' + UIFONT; ctx.fillText('SOC COCKPIT', width / 2, 45) }
  return canvasToRgbPng(canvas)
}

// A row of labelled tiles. Each: {icon?, label, value, level, spark?:[0..1]}.
function tilesPng (width, tiles) {
  const { canvas, ctx } = newCanvas(width)
  const n = Math.max(1, tiles.length)
  const tw = width / n
  tiles.forEach((t, i) => {
    const x = i * tw; const cx = x + tw / 2; const col = lvl(t.level)
    if (t.spark) drawSpark(ctx, x + 6, tw - 12, t.spark, col)
    if (i > 0) {
      ctx.strokeStyle = C.divider; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 8); ctx.lineTo(Math.round(x) + 0.5, 52); ctx.stroke()
    }
    labelWith(ctx, x, t.icon, col, String(t.label).toUpperCase().slice(0, 12))
    ctx.fillStyle = col; ctx.font = '700 22px ' + UIFONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(t.value), cx, 41)
  })
  return canvasToRgbPng(canvas)
}

// Slot 1 — cluster summary. cl = { nodes, vms (filtered) }, hist = {cpu:[],ram:[]}.
function clusterOverview (width, cl, hist) {
  const nodesUp = cl.nodes.filter((n) => n.online).length
  const vmsRun = cl.vms.filter((v) => v.running).length
  const cpuPct = Math.round(100 * (cl.nodes.reduce((s, n) => s + (n.cpu || 0), 0) / Math.max(1, cl.nodes.length)))
  const memUsed = cl.nodes.reduce((s, n) => s + (n.mem || 0), 0)
  const memTot = cl.nodes.reduce((s, n) => s + (n.maxmem || 0), 0)
  const ramPct = memTot ? Math.round(100 * memUsed / memTot) : 0
  return tilesPng(width, [
    { icon: '🖥', label: 'NODES', value: nodesUp + '/' + cl.nodes.length, level: nodesUp < cl.nodes.length ? 'crit' : 'ok' },
    { icon: '📦', label: 'VMS', value: vmsRun + '/' + cl.vms.length, level: 'ok' },
    { icon: '⚙', label: 'CPU', value: cpuPct + '%', level: band(cpuPct, 70, 90), spark: hist && hist.cpu },
    { icon: '🧠', label: 'RAM', value: ramPct + '%', level: band(ramPct, 75, 92), spark: hist && hist.ram }
  ])
}

// Slot 2 — alerts. alerts = [{sev:'crit'|'warn', text}]. Rotates through them.
function alertsTile (width, alerts, idx) {
  const { canvas, ctx } = newCanvas(width)
  const has = alerts.length > 0
  const worst = alerts.some((a) => a.sev === 'crit') ? 'crit' : has ? 'warn' : 'ok'
  labelWith(ctx, 0, has ? '🚨' : '✅', has ? lvl(worst) : C.ok, 'ALERTES' + (has ? ' ' + alerts.length : ''))
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (!has) {
    ctx.fillStyle = C.ok; ctx.font = '700 22px ' + UIFONT; ctx.fillText('OK', width / 2, 41)
  } else {
    const a = alerts[idx % alerts.length]
    const f = fit(ctx, a.text, width - 20, 20)
    ctx.fillStyle = lvl(a.sev); ctx.font = '700 ' + f.px + 'px ' + UIFONT; ctx.fillText(f.text, width / 2, 41)
  }
  return canvasToRgbPng(canvas)
}

// Slot 3 — one guest (VM/CT): kind emoji + i/N + name + CPU/RAM.
function resourceLine (width, r) {
  const { canvas, ctx } = newCanvas(width)
  const cpu = Math.round(100 * (r.cpu || 0))
  const ram = r.maxmem ? Math.round(100 * r.mem / r.maxmem) : 0
  const up = r.running
  let tx = 10
  if (icon(ctx, r.kind === 'lxc' ? '🐧' : '🖥', 8, 14, 13)) tx = 27
  ctx.fillStyle = C.label; ctx.font = '600 10px ' + UIFONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText((r.kind || 'vm').toUpperCase() + (r.total ? '  ' + (r.index + 1) + '/' + r.total : ''), tx, 14)
  const f = fit(ctx, r.name || '—', width - 135, 18)
  ctx.fillStyle = up ? C.text : C.idle; ctx.font = '700 ' + f.px + 'px ' + UIFONT; ctx.fillText(f.text, 10, 39)
  ctx.textAlign = 'right'
  ctx.fillStyle = up ? lvl(band(cpu, 70, 90)) : C.idle; ctx.font = '700 15px ' + UIFONT
  ctx.fillText(up ? 'CPU ' + cpu + '%' : 'STOPPÉ', width - 10, 22)
  ctx.fillStyle = up ? lvl(band(ram, 75, 92)) : C.idle
  ctx.fillText(up ? 'RAM ' + ram + '%' : '—', width - 10, 42)
  return canvasToRgbPng(canvas)
}

// Ticker crypto (repli de la tuile alertes) — symbole + prix + variation 24h.
function cryptoTile (width, c) {
  const { canvas, ctx } = newCanvas(width)
  const up = (c.changePct || 0) >= 0
  const col = up ? C.ok : C.crit
  let tx = 10
  if (icon(ctx, '🪙', 8, 14, 13)) tx = 27
  ctx.fillStyle = C.label; ctx.font = '600 10px ' + UIFONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText('CRYPTO' + (c.total ? '  ' + (c.index + 1) + '/' + c.total : ''), tx, 14)
  // symbole + /USDT discret
  ctx.fillStyle = C.text; ctx.font = '700 22px ' + UIFONT
  ctx.fillText(c.base || '—', 10, 39)
  const bw = ctx.measureText(c.base || '—').width
  ctx.fillStyle = C.label; ctx.font = '600 11px ' + UIFONT
  ctx.fillText('/USDT', 15 + bw, 41)
  // prix (droite, haut)
  ctx.textAlign = 'right'
  ctx.fillStyle = C.text; ctx.font = '700 18px ' + UIFONT
  ctx.fillText(c.priceStr || '—', width - 10, 22)
  // variation 24h (droite, bas) + triangle vectoriel coloré
  ctx.fillStyle = col; ctx.font = '700 15px ' + UIFONT
  const chg = (up ? '+' : '') + (c.changePct != null ? c.changePct.toFixed(2) : '0.00') + '%'
  ctx.fillText(chg, width - 10, 43)
  const cw = ctx.measureText(chg).width
  const px = width - 10 - cw - 9; const py = 43; const s = 5
  ctx.beginPath()
  if (up) { ctx.moveTo(px, py - s); ctx.lineTo(px - s, py + s); ctx.lineTo(px + s, py + s) } else { ctx.moveTo(px, py + s); ctx.lineTo(px - s, py - s); ctx.lineTo(px + s, py - s) }
  ctx.closePath(); ctx.fill()
  return canvasToRgbPng(canvas)
}

// Slot 4 — free disk + usage gauge, aggregated across the cluster. d = {free,total}.
function diskTile (width, d) {
  const { canvas, ctx } = newCanvas(width)
  if (!d || !d.total) {
    ctx.fillStyle = C.idle; ctx.font = '700 16px ' + UIFONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('DISK —', width / 2, 30)
    return canvasToRgbPng(canvas)
  }
  const pct = Math.round(100 * (d.total - d.free) / d.total)
  const col = lvl(band(pct, 80, 92))
  labelWith(ctx, 0, '💾', col, 'DISK CLUSTER')
  ctx.fillStyle = col; ctx.font = '600 10px ' + UIFONT; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
  ctx.fillText(pct + '% util.', width - 12, 16)
  ctx.fillStyle = col; ctx.font = '700 20px ' + UIFONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(gbStr(d.free) + ' libre', width / 2, 34)
  const gx = 12; const gw = width - 24; const gy = 50; const gh = 6
  ctx.fillStyle = C.divider; ctx.fillRect(gx, gy, gw, gh)
  ctx.fillStyle = col; ctx.fillRect(gx, gy, gw * Math.max(0.02, pct / 100), gh)
  return canvasToRgbPng(canvas)
}

module.exports = { brandTile, tilesPng, clusterOverview, alertsTile, resourceLine, cryptoTile, diskTile }
