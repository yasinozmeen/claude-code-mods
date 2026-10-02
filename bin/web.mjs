// The web view behind the "medya-web" pane: a headless browser draws the
// gallery page, each frame it paints is written as a PNG the terminal reads,
// and the clicks and wheel the pane hears are played back into the page.
//
//   node web.mjs <frame directory>
//
// stdout, one line each: `READY <port>` once the bridge listens, `F <file>
// <seq>` per frame, `LOG <text>` for the rest. It ends with its parent.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frames = process.argv[2] ?? path.join(os.tmpdir(), 'medya-web')
const ROTATE = 16
const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', mp4: 'video/mp4', m4v: 'video/mp4',
  mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
  aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', pdf: 'application/pdf', html: 'text/html',
  htm: 'text/html',
}

const say = line => process.stdout.write(`${line}\n`)
const state = { items: [], filter: 'chat', version: 0, width: 576, height: 900, scale: 2 }
const listeners = new Set()
let browser
let socket
let nextId = 1
let seq = 0
const waiting = new Map()

fs.mkdirSync(frames, { recursive: true })

function send(method, params = {}) {
  if (socket?.readyState !== 1) {
    return Promise.resolve(undefined)
  }

  const id = nextId++
  socket.send(JSON.stringify({ id, method, params }))

  return new Promise(resolve => waiting.set(id, resolve))
}

function changed() {
  state.version += 1

  for (const res of listeners) {
    res.write(`data: ${state.version}\n\n`)
  }
}

// The page is laid out in terminal points and drawn at `scale` device pixels
// a point: the viewport is that many pixels and the page zooms itself, since a
// screencast frame is the viewport's own size whatever the device scale.
async function resize() {
  await send('Emulation.setDeviceMetricsOverride', {
    width: Math.round(state.width * state.scale),
    height: Math.round(state.height * state.scale),
    deviceScaleFactor: 1,
    mobile: false,
  })
  await send('Runtime.evaluate', { expression: `document.documentElement.style.zoom = ${state.scale}` })
  await send('Page.stopScreencast')
  await send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
}

function body(req) {
  return new Promise(resolve => {
    let text = ''
    req.on('data', piece => (text += piece))
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'))
      } catch {
        resolve({})
      }
    })
  })
}

// One of the listed files, or its preview: whole, or the byte range a player
// asks for. Nothing else on disk is served.
function serve(req, res, url) {
  const item = state.items.find(one => one.id === url.searchParams.get('id'))
  const which = url.searchParams.get('as')
  const file = item === undefined ? '' : which === 'thumb' ? item.thumb : which === 'preview' ? item.preview : item.path

  if (file === '' || !fs.existsSync(file)) {
    res.writeHead(404).end()

    return
  }

  const size = fs.statSync(file).size
  const type = TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')

  if (range === null) {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' })
    fs.createReadStream(file).pipe(res)

    return
  }

  const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1])
  const end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1
  res.writeHead(206, {
    'content-type': type,
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${size}`,
    'accept-ranges': 'bytes',
  })
  fs.createReadStream(file, { start, end }).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(fs.readFileSync(path.join(here, 'web.html')))
  } else if (req.method === 'GET' && url.pathname === '/items') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ items: state.items, filter: state.filter }))
  } else if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    res.write(`data: ${state.version}\n\n`)
    listeners.add(res)
    req.on('close', () => listeners.delete(res))
  } else if (req.method === 'GET' && url.pathname === '/file') {
    serve(req, res, url)
  } else if (req.method === 'POST' && url.pathname === '/items') {
    const sent = await body(req)
    state.items = Array.isArray(sent.items) ? sent.items : []
    state.filter = sent.filter === 'all' ? 'all' : 'chat'
    changed()
    res.writeHead(204).end()
  } else if (req.method === 'POST' && url.pathname === '/size') {
    const sent = await body(req)
    const width = Math.round(Number(sent.width))
    const height = Math.round(Number(sent.height))

    if (width > 50 && height > 50) {
      state.width = width
      state.height = height
    }

    // Asked again at the same size, the page is still sent afresh: a pane
    // opened anew has no frame yet.
    await resize()
    res.writeHead(204).end()
  } else if (req.method === 'POST' && url.pathname === '/input') {
    const sent = await body(req)
    fs.appendFileSync(path.join(frames, 'input.log'), `${new Date().toISOString()} ${JSON.stringify(sent)}\n`)
    const x = Math.round(Number(sent.x) * state.width * state.scale)
    const y = Math.round(Number(sent.y) * state.height * state.scale)

    if (sent.kind === 'click') {
      const press = { x, y, button: 'left', clickCount: 1 }
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press })
    } else if (sent.kind === 'wheel') {
      await send('Runtime.evaluate', { expression: `nudge(${Number(sent.dy) || 0})` })
    }

    res.writeHead(204).end()
  } else if (req.method === 'POST' && url.pathname === '/quit') {
    res.writeHead(204).end()
    stop()
  } else {
    res.writeHead(404).end()
  }
})

function stop() {
  try {
    browser?.kill('SIGKILL')
  } catch {
    // Already gone.
  }

  process.exit(0)
}

async function start(port) {
  const binary = BROWSERS.find(one => fs.existsSync(one))

  if (binary === undefined) {
    say('LOG no Chromium-based browser found')
    stop()
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'medya-web-'))
  browser = spawn(binary, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ])
  browser.on('exit', stop)

  const debug = await new Promise(resolve => {
    let text = ''
    browser.stderr.on('data', piece => {
      text += piece
      const found = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text)

      if (found !== null) {
        resolve(found[1])
      }
    })
  })
  const pages = await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json()
  const page = pages.find(one => one.type === 'page')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)

    if (message.id !== undefined) {
      waiting.get(message.id)?.(message.result)
      waiting.delete(message.id)
    } else if (message.method === 'Page.screencastFrame') {
      void send('Page.screencastFrameAck', { sessionId: message.params.sessionId })
      seq += 1
      const file = path.join(frames, `f${seq % ROTATE}.png`)
      // Written beside and moved in, so the terminal never reads half a frame.
      fs.writeFileSync(`${file}.tmp`, Buffer.from(message.params.data, 'base64'))
      fs.renameSync(`${file}.tmp`, file)
      say(`F ${file} ${seq}`)
    }
  })
  await new Promise(resolve => socket.addEventListener('open', resolve))
  await send('Page.enable')
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/?zoom=${state.scale}` })
  await resize()
  say(`READY ${port}`)
}

process.on('SIGTERM', stop)
process.on('SIGINT', stop)
// The parent closing the pipe is the parent going away.
process.stdout.on('error', stop)
server.listen(0, '127.0.0.1', () => void start(server.address().port))
