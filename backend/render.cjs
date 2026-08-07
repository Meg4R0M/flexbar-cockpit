'use strict'

// Canvas rendering for the Flexbar. Logical draw height is 60px; width follows
// the placed key. Output is a PNG data URL fed to plugin.draw(..., 'base64').

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas')

// Color emoji only render when an emoji font is registered explicitly.
let EMOJI_FONT = null
try {
  if (GlobalFonts.registerFromPath('/System/Library/Fonts/Apple Color Emoji.ttc', 'FlexEmoji')) {
    EMOJI_FONT = 'FlexEmoji'
  }
} catch (_) {
  EMOJI_FONT = null
}

const COLORS = {
  bg: '#0b0e14',
  divider: '#1e2733',
  label: '#5c6b7a',
  text: '#c9d1d9',
  ok: '#3fb950',
  warn: '#d29922',
  crit: '#f85149',
  idle: '#484f58'
}

function levelColor (level) {
  return COLORS[level] || COLORS.text
}

// Subtle background graph of recent values inside (x, y, w, h).
function drawSparkline (ctx, x, y, w, h, data, color) {
  if (!data || data.length < 2) return
  let min = Math.min(...data)
  let max = Math.max(...data)
  if (max - min < 1e-6) { min -= 1; max += 1 } // flat series -> centered line
  const range = max - min
  const n = data.length
  const px = (i) => x + (i / (n - 1)) * w
  const py = (v) => y + h - ((v - min) / range) * h

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  for (let i = 0; i < n; i++) ctx.lineTo(px(i), py(data[i]))
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
  ctx.globalAlpha = 0.15
  ctx.fillStyle = color
  ctx.fill()

  ctx.globalAlpha = 0.5
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(px(0), py(data[0]))
  for (let i = 1; i < n; i++) ctx.lineTo(px(i), py(data[i]))
  ctx.stroke()
  ctx.restore()
}

// Draw the tile value centered, optionally prefixed by a color emoji.
function drawValue (ctx, cx, y, emoji, value, color) {
  const valueFont = '700 22px Arial'
  const emojiSize = 19
  const gap = 6
  ctx.textBaseline = 'middle'

  ctx.font = valueFont
  const valueW = ctx.measureText(value).width
  let emojiW = 0
  const hasEmoji = emoji && EMOJI_FONT
  if (hasEmoji) {
    ctx.font = emojiSize + 'px FlexEmoji'
    emojiW = ctx.measureText(emoji).width
  }
  let x = cx - (emojiW + (hasEmoji ? gap : 0) + valueW) / 2
  ctx.textAlign = 'left'

  if (hasEmoji) {
    ctx.font = emojiSize + 'px FlexEmoji'
    ctx.fillText(emoji, x, y)
    x += emojiW + gap
  }
  ctx.font = valueFont
  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ctx.fillText(value, x + 0.6, y + 1)
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}

// tiles: [{ label, value, level, history?, emoji? }]
function renderDashboard (width, height, tiles) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)

  const n = Math.max(1, tiles.length)
  const tileW = width / n

  tiles.forEach((tile, i) => {
    const x = i * tileW
    const cx = x + tileW / 2
    const color = levelColor(tile.level)

    if (tile.history && tile.history.length > 1) {
      drawSparkline(ctx, x + 3, 9, tileW - 6, height - 15, tile.history, color)
    }

    if (i > 0) {
      ctx.strokeStyle = COLORS.divider
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, 8)
      ctx.lineTo(Math.round(x) + 0.5, height - 8)
      ctx.stroke()
    }

    // top-left: status dot + label
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x + 12, 16, 3.5, 0, Math.PI * 2)
    ctx.fill()
    if (tile.label) {
      ctx.fillStyle = COLORS.label
      ctx.font = '600 10px Arial'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(tile.label).toUpperCase().slice(0, 12), x + 22, 16)
    }

    // value (centered), optionally prefixed by a color emoji
    drawValue(ctx, cx, 41, tile.emoji, String(tile.value), color)
  })

  return canvas.toDataURL('image/png')
}

// Centered glyph/text, used for the action button.
function renderLabel (width, height, text, level) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = levelColor(level || 'text')
  ctx.font = '700 20px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(text), width / 2, height / 2 + 1)
  return canvas.toDataURL('image/png')
}

// Shrink font until text fits maxWidth, then ellipsize as a last resort.
function fitText (ctx, text, maxWidth, startPx, minPx) {
  let size = startPx
  ctx.font = '700 ' + size + 'px Arial'
  while (size > minPx && ctx.measureText(text).width > maxWidth) {
    size -= 1
    ctx.font = '700 ' + size + 'px Arial'
  }
  if (ctx.measureText(text).width > maxWidth) {
    let t = text
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
    text = t + '…'
  }
  return { text, size }
}

// USB key: left = count, right = selected device name (navigated with arrows).
// model: { count, name, index, total, changed }
function renderUsb (width, height, model) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)

  const leftW = Math.min(96, Math.round(width * 0.26))
  const countColor = model.changed ? COLORS.warn : model.count ? COLORS.ok : COLORS.idle

  if (EMOJI_FONT) {
    ctx.font = '12px FlexEmoji'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('🔌', 6, 15)
  } else {
    ctx.fillStyle = countColor
    ctx.beginPath()
    ctx.arc(12, 16, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = COLORS.label
  ctx.font = '600 10px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('USB', 24, 15)
  ctx.fillStyle = countColor
  ctx.font = '700 22px Arial'
  ctx.textAlign = 'center'
  ctx.fillText(String(model.count), leftW / 2, 41)

  ctx.strokeStyle = COLORS.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(leftW + 0.5, 8)
  ctx.lineTo(leftW + 0.5, height - 8)
  ctx.stroke()

  const rx = leftW + 10
  const rw = width - leftW - 20
  ctx.fillStyle = COLORS.label
  ctx.font = '600 10px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(model.total ? 'DEVICE ' + (model.index + 1) + '/' + model.total : 'DEVICE', rx, 15)

  ctx.fillStyle = model.count ? COLORS.text : COLORS.idle
  const fitted = fitText(ctx, model.name || '—', rw, 18, 11)
  ctx.font = '700 ' + fitted.size + 'px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(fitted.text, rx, 40)

  return canvas.toDataURL('image/png')
}

// Agenda key: left = time, right = title + relative. model:
//   { state:'ok', time, title, relative, level } | { state:'none'|'noaccess'|'init'|'error' }
function renderAgenda (width, height, m) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)

  if (m.state !== 'ok') {
    const msg = m.state === 'noaccess' ? 'Autoriser Calendrier'
      : m.state === 'none' ? 'Aucun évènement'
      : m.state === 'error' ? 'Agenda indispo'
      : '…'
    let x = 12
    if (EMOJI_FONT) {
      ctx.font = '15px FlexEmoji'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText('📅', x, height / 2)
      x += 26
    }
    ctx.fillStyle = m.state === 'noaccess' ? COLORS.warn : COLORS.idle
    ctx.font = '700 15px Arial'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(msg, x, height / 2)
    return canvas.toDataURL('image/png')
  }

  const leftW = Math.min(100, Math.round(width * 0.24))
  const color = levelColor(m.level)

  if (EMOJI_FONT) {
    ctx.font = '12px FlexEmoji'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('📅', 8, 15)
  }
  ctx.fillStyle = color
  ctx.font = '700 20px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(m.time, leftW / 2, 41)

  ctx.strokeStyle = COLORS.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(leftW + 0.5, 8)
  ctx.lineTo(leftW + 0.5, height - 8)
  ctx.stroke()

  const rx = leftW + 10
  const rw = width - leftW - 20
  ctx.fillStyle = COLORS.text
  const fit = fitText(ctx, m.title, rw, 16, 11)
  ctx.font = '700 ' + fit.size + 'px Arial'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(fit.text, rx, 22)

  ctx.fillStyle = color
  ctx.font = '600 11px Arial'
  ctx.fillText(m.relative, rx, 43)

  return canvas.toDataURL('image/png')
}

function procLevel (metric, pct) {
  if (metric === 'CPU') return pct >= 80 ? 'crit' : pct >= 40 ? 'warn' : 'ok'
  return pct >= 20 ? 'crit' : pct >= 8 ? 'warn' : 'ok' // RAM = % of total
}

function fmtPct (pct) {
  return pct < 10 ? pct.toFixed(1) : String(Math.round(pct))
}

// Dashboard drill-down: top-5 processes for a metric.
// metric: 'CPU' | 'RAM' ; procs: [{ name, pct }]
function renderProcs (width, height, metric, procs) {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.bg
  ctx.fillRect(0, 0, width, height)

  const badgeW = 58
  if (EMOJI_FONT) {
    ctx.font = '14px FlexEmoji'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(metric === 'CPU' ? '🧠' : '🐏', badgeW / 2, 16)
  }
  ctx.fillStyle = COLORS.text
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 13px Arial'
  ctx.fillText(metric, badgeW / 2, 33)
  ctx.fillStyle = COLORS.label
  ctx.font = '600 9px Arial'
  ctx.fillText('TOP 5', badgeW / 2, 46)

  ctx.strokeStyle = COLORS.divider
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(badgeW + 0.5, 8)
  ctx.lineTo(badgeW + 0.5, height - 8)
  ctx.stroke()

  const list = procs || []
  const n = 5
  const tileW = (width - badgeW) / n
  for (let i = 0; i < n; i++) {
    const x = badgeW + i * tileW
    if (i > 0) {
      ctx.strokeStyle = COLORS.divider
      ctx.beginPath()
      ctx.moveTo(Math.round(x) + 0.5, 12)
      ctx.lineTo(Math.round(x) + 0.5, height - 12)
      ctx.stroke()
    }
    const p = list[i]
    if (!p) continue
    const cx = x + tileW / 2
    ctx.fillStyle = COLORS.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const fit = fitText(ctx, p.name, tileW - 8, 11, 8)
    ctx.font = '600 ' + fit.size + 'px Arial'
    ctx.fillText(fit.text, cx, 18)
    ctx.fillStyle = levelColor(procLevel(metric, p.pct))
    ctx.font = '700 18px Arial'
    ctx.fillText(fmtPct(p.pct) + '%', cx, 40)
  }
  return canvas.toDataURL('image/png')
}

module.exports = { renderDashboard, renderLabel, renderUsb, renderAgenda, renderProcs }
