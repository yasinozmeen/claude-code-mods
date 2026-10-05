import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MediaFilter, MediaItem, MediaSource } from '../types'
import type { HitPost, HitProps } from './hit'
import { absolute, hashOf, hrefOf, kindOf, linked, mediaPaths, namesMedia, pathOf } from './paths'

const PANE = 'vitrin'
const TITLE = 'Vitrin'
const KEEP = 60
const MAX_EDGE = 1600
const THUMB_EDGE = 480
// A cell's width over its height; Ghostty's default font is close to this.
const RATIO = 0.47
// How long before a tool call began a file may have been written and still
// count as that call's own.
const FRESH_MS = 2000
const PER_CALL = 8
// The longest reply the mod redraws to make its paths pressable.
const REPLY_MAX = 9000
// The columns the pane asks for (a width the person dragged wins); the points
// a column is wide when the page is laid out, the pixels a wheel step moves
// it, and where node may be.
const COLUMNS = 64
const CELL_POINTS = 9
const WHEEL_PIXELS = 48
const NODES = ['node', '/opt/homebrew/opt/node@22/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node']

const items = atom({ plugin: 'vitrin', key: 'items' } as const, [])
const ratio = atom({ plugin: 'vitrin', key: 'ratio' } as const, RATIO)
const filter = atom({ plugin: 'vitrin', key: 'filter' } as const, 'chat')
const isReady = atom({ plugin: 'vitrin', key: 'isReady' } as const, false)

// What a button of the page asks the mod to do.
type Act = { act?: string; id?: string; mode?: string; text?: string }

const busy = new Set<string>()
// Every file the pane has held this session: a reply's path to one stays a
// link after the list is cleared, and a press brings the file back.
const named = new Set<string>()
// Paths a reply named that were not files when looked for; forgotten when
// new files are taken in, since one of them may be there by then.
const absent = new Set<string>()
const place = { home: '', cwd: '' }
// The bridge as this module knows it: its port once it listens, the newest
// frame, the pane's size in cells, the key the picture is drawn under, and
// a file the page has yet to be told to show.
const web = { x: 0.5, y: 0, port: 0, isStarting: false, file: '', seq: 0, columns: 0, rows: 0, key: 'view', pick: '' }

// Every string a tool call's input holds, a few levels down.
function strings(value: unknown, depth = 3): string[] {
  if (typeof value === 'string') {
    return [value]
  }

  if (depth === 0 || value === null || typeof value !== 'object') {
    return []
  }

  return Object.values(value).flatMap(one => strings(one, depth - 1))
}

async function ran($: EngineInterface, argv: string[], timeoutMs = 60_000) {
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch {
    return undefined
  }
}

async function located($: EngineInterface) {
  place.home = (await $.env.get('HOME')) ?? ''
  place.cwd = await $.session.cwd()

  return place
}

async function sizeOf($: EngineInterface, file: string) {
  const out = await ran($, ['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', file])
  const width = Number(/pixelWidth:\s*(\d+)/.exec(out?.stdout ?? '')?.[1] ?? 0)
  const height = Number(/pixelHeight:\s*(\d+)/.exec(out?.stdout ?? '')?.[1] ?? 0)

  return width > 0 && height > 0 ? { width, height } : undefined
}

// Quick Look's thumbnail of the file, moved to `preview`: what draws an SVG
// and anything sips cannot read.
async function thumbnail($: EngineInterface, source: string, preview: string, dir: string) {
  await ran($, ['/usr/bin/qlmanage', '-t', '-s', String(MAX_EDGE), '-o', dir, source])
  const made = `${dir}/${source.slice(source.lastIndexOf('/') + 1)}.png`

  if (await $.fs.exists(made)) {
    await ran($, ['/bin/mv', '-f', made, preview])
  }
}

// A PNG of the file, at most MAX_EDGE pixels a side: the picture itself, a
// PDF's first page, a frame from a video's first second, a sound's waveform,
// or Quick Look's thumbnail of a web page or a markdown file.
async function previewOf($: EngineInterface, item: MediaItem, dir: string) {
  if (await $.fs.exists(item.preview)) {
    return
  }

  await ran($, ['/bin/mkdir', '-p', dir])

  if (item.kind === 'video' || item.kind === 'audio') {
    const scale = `scale='min(${MAX_EDGE},iw)':-2`
    const wave = 'showwavespic=s=1200x300:colors=0x8ab4f8'
    const takes =
      item.kind === 'audio'
        ? [['-i', item.path, '-filter_complex', wave]]
        : [['-ss', '1'], []].map(seek => [...seek, '-i', item.path, '-vf', scale])

    for (const ffmpeg of ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
      for (const take of takes) {
        await ran($, [ffmpeg, '-y', '-v', 'error', ...take, '-frames:v', '1', item.preview])

        if (await $.fs.exists(item.preview)) {
          return
        }
      }
    }

    if (item.kind === 'audio') {
      return
    }
  } else if (item.kind !== 'page' && item.kind !== 'doc' && !item.path.toLowerCase().endsWith('.svg')) {
    const size = await sizeOf($, item.path)
    const isLarge = size === undefined || Math.max(size.width, size.height) > MAX_EDGE
    const resize = isLarge ? ['-Z', String(MAX_EDGE)] : []
    const argv = ['/usr/bin/sips', '-s', 'format', 'png', ...resize, item.path]
    await ran($, [...argv, '--out', item.preview])

    if (await $.fs.exists(item.preview)) {
      return
    }
  }

  await thumbnail($, item.path, item.preview, dir)
}

// The item with its preview's size and a small copy of it for the grid; with
// no preview, the item as it is, its card drawn empty.
async function sized($: EngineInterface, item: MediaItem, dir: string): Promise<MediaItem> {
  await previewOf($, item, dir)
  const size = await sizeOf($, item.preview)

  if (size === undefined) {
    return { ...item, preview: '', thumb: '' }
  }

  if (Math.max(size.width, size.height) <= THUMB_EDGE) {
    return { ...item, ...size, thumb: item.preview }
  }

  const argv = ['/usr/bin/sips', '-Z', String(THUMB_EDGE), item.preview, '--out', item.thumb]
  await ran($, argv)
  const hasThumb = await $.fs.exists(item.thumb)

  return { ...item, ...size, thumb: hasThumb ? item.thumb : item.preview }
}

// One request to the bridge; nothing is said when it is not up.
async function tell($: EngineInterface, route: string, data: unknown) {
  if (web.port === 0) {
    return
  }

  try {
    await $.http.fetch(`http://127.0.0.1:${web.port}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    // The bridge went away; the stream's end resets the rest.
  }
}

// The list as the page shows it, and with `pick` the file it shows large. A
// pick made while the bridge is down is kept for when it is up.
async function sync($: EngineInterface, pick = '') {
  if (pick !== '') {
    web.pick = pick
  }

  if (web.port === 0) {
    return
  }

  const sent = { items: await read($, items), filter: await read($, filter), pick: web.pick }
  web.pick = ''
  await tell($, 'items', sent)
}

// The page's size for the pane's cells: laid out in points, a cell
// CELL_POINTS wide and as tall as the cell ratio makes it.
async function measure($: EngineInterface) {
  if (web.columns > 0) {
    const cell = await read($, ratio)
    await tell($, 'size', { width: web.columns * CELL_POINTS, height: (web.rows * CELL_POINTS) / cell })
  }
}

// The Finder's space-bar preview over the terminal, left running: the mod's
// own helper, or the default app where the helper is not built.
function quickLook($: EngineInterface, path: string) {
  const script = 'if [ -x "$1" ]; then nohup "$1" "$2" >/dev/null 2>&1 & else /usr/bin/open "$2"; fi'
  void ran($, ['/bin/sh', '-c', script, 'sh', `${$.plugin.root}/bin/onizle`, path])
}

async function choose($: EngineInterface, mode: MediaFilter) {
  await update($, filter, () => mode)
  await $.store.set('filter', mode)
  await sync($)
}

async function clear($: EngineInterface) {
  await update($, items, () => [])
  await sync($)
}

// A button pressed in the page: what the browser cannot do itself.
async function act($: EngineInterface, sent: Act) {
  if (sent.act === 'clear') {
    await clear($)

    return
  }

  if (sent.act === 'filter') {
    await choose($, sent.mode === 'all' ? 'all' : 'chat')

    return
  }

  // Text selected in a document: cmd+C stays with the terminal, so letting
  // go of the selection is what copies it.
  if (sent.act === 'text') {
    if (typeof sent.text === 'string' && sent.text !== '') {
      await $.ui.copy({ text: sent.text.slice(0, 200_000) })
      $.ui.toast('Seçim kopyalandı')
    }

    return
  }

  const item = (await read($, items)).find(one => one.id === sent.id)

  if (item === undefined) {
    return
  }

  if (sent.act === 'look') {
    quickLook($, item.path)
  } else if (sent.act === 'open') {
    await ran($, ['/usr/bin/open', item.path])
  } else if (sent.act === 'copy') {
    await $.ui.copy({ text: item.path })
  } else if (sent.act === 'reveal') {
    await ran($, ['/usr/bin/open', '-R', item.path])
  } else if (sent.act === 'remove') {
    // Out of the list alone: the file is the person's and stays where it is.
    await update($, items, list => list.filter(one => one.id !== item.id))
    await sync($)
  }
}

// Runs the bridge for as long as the module lives and the pane is open: each
// frame the browser paints replaces the picture in the pane, with no redraw.
async function stream($: EngineInterface) {
  if (web.isStarting || web.port !== 0) {
    return
  }

  web.isStarting = true
  const { home } = await located($)
  const dir = `${home}/.claude/cache/vitrin/kare-${hashOf(await $.session.id())}`

  for (const node of NODES) {
    try {
      let rest = ''

      for await (const piece of $.process.spawn({ argv: [node, `${$.plugin.root}/bin/bridge.mjs`, dir] })) {
        if (piece.stream !== 'stdout') {
          continue
        }

        const lines = `${rest}${piece.text}`.split('\n')
        rest = lines.pop() ?? ''
        // Only the newest of the frames that came together is worth drawing.
        const frame = lines.findLast(line => line.startsWith('F '))

        for (const line of lines) {
          if (line.startsWith('READY ')) {
            web.port = Number(line.slice(6))
            await measure($)
            await sync($)
          } else if (line.startsWith('ACT ')) {
            await act($, JSON.parse(line.slice(4)) as Act)
          }
        }

        if (frame !== undefined) {
          const [, file = '', seq = '0'] = frame.split(' ')
          web.file = file
          web.seq = Number(seq)

          if (await read($, isReady)) {
            await $.ui.blit({ requestId: PANE, key: web.key, source: { file, format: 'png', generation: web.seq } })
          } else {
            await update($, isReady, () => true)
          }
        }
      }

      break
    } catch {
      // This node is not there; the next may be.
    }
  }

  web.port = 0
  web.isStarting = false

  try {
    await update($, isReady, () => false)
  } catch {
    // The module is being unloaded: there is no pane left to tell.
  }
}

// Opens the pane and starts the page behind it; where the terminal is too
// narrow for a pane nobody asked for, a toast says how to open it.
// Whether the session draws in a terminal. The pane is a picture only a
// terminal shows, so in the desktop app and the other surfaces the mod keeps
// still: it takes nothing in and opens nothing.
async function inTerminal($: EngineInterface): Promise<boolean> {
  return (await $.session.surfaces()).includes('terminal')
}

async function show($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })

  if (opened.isPlaced) {
    void stream($)
  } else {
    $.ui.toast('Yeni medya hazır: görmek için /vitrin yaz')
  }
}

// Adds the files that exist and are media to the top of the list, newest
// first, and answers how many it added. A file a reply names is the chat's
// (the pane opens on it), one a tool made is kept for the "all" view; a file
// last written before `since` is not this call's and is left out.
async function ingest(
  $: EngineInterface,
  paths: readonly string[],
  from: MediaSource,
  since = 0,
  most = KEEP,
): Promise<number> {
  if (paths.length === 0 || !(await inTerminal($))) {
    return 0
  }

  const { home, cwd } = await located($)
  const dir = `${home}/.claude/cache/vitrin`
  let added = 0
  let newest = ''

  for (const spelled of paths) {
    const path = absolute(spelled, cwd, home)
    const kind = kindOf(path)

    if (kind === undefined || busy.has(path) || added >= most) {
      continue
    }

    busy.add(path)

    try {
      const stat = await $.fs.stat(path)

      if (stat.kind !== 'file' || stat.mtimeMs < since) {
        continue
      }

      named.add(path)
      absent.clear()
      const id = hashOf(`${path}:${stat.mtimeMs}:${stat.size}`)
      const known = (await read($, items)).find(one => one.id === id)

      if (known !== undefined) {
        if (from === 'chat' && known.from !== 'chat') {
          const mine: MediaItem = { ...known, from: 'chat' }
          await update($, items, list => [mine, ...list.filter(one => one.id !== id)])
          added += 1
          newest = id
        }

        continue
      }

      const item = await sized(
        $,
        {
          id,
          path,
          name: path.slice(path.lastIndexOf('/') + 1),
          kind,
          from,
          preview: `${dir}/${id}.png`,
          thumb: `${dir}/${id}-k.png`,
          width: 0,
          height: 0,
          addedAt: await $.clock.now(),
        },
        dir,
      )
      await update($, items, list => {
        // A file the chat named stays the chat's when a tool writes it again.
        const wasChat = list.some(one => one.path === path && one.from === 'chat')
        const next: MediaItem = wasChat ? { ...item, from: 'chat' } : item

        return [next, ...list.filter(one => one.path !== path)].slice(0, KEEP)
      })
      added += 1
      newest = id
    } catch {
      // A path the text named that is not there is not media.
    } finally {
      busy.delete(path)
    }
  }

  if (added > 0 && from === 'chat') {
    await sync($, newest)
    await show($)
  } else if (added > 0) {
    await sync($)
  }

  return added
}

// The media a tool call made: the files its input or output names that were
// written while it ran. Web pages and markdown are left to the chat, where
// naming one says it is meant to be seen; a tool writing one is editing code
// or notes.
async function capture($: EngineInterface, input: string, output: string, since: number) {
  const text = `${input}\n${output}`.slice(0, 200_000)

  if (!namesMedia(text)) {
    return
  }

  const made = mediaPaths(text)
    .filter(path => !['page', 'doc'].includes(kindOf(path) ?? ''))
    .slice(0, 40)
  await ingest($, made, 'tool', since - FRESH_MS, PER_CALL)
}

// The media the newest reply names: what a load or reload of the mod missed.
async function rescan($: EngineInterface) {
  try {
    const last = (await $.session.messages()).findLast(one => one.role === 'assistant' && one.text !== '')

    if (last !== undefined) {
      await ingest($, mediaPaths(last.text), 'chat')
    }
  } catch {
    // No transcript to read yet.
  }
}

// A press on a media path in a reply: the pane opens on that file.
async function jump($: EngineInterface, href: string) {
  const path = pathOf(href)
  const item = (await read($, items)).find(one => one.path === path)

  if (!(await inTerminal($))) {
    return
  }

  if (item === undefined) {
    // Cleared from the list since the reply named it: taken in again.
    await ingest($, [path], 'chat')

    return
  }

  if (item.from !== 'chat') {
    const mine: MediaItem = { ...item, from: 'chat' }
    await update($, items, list => list.map(one => (one.id === item.id ? mine : one)))
  }

  await sync($, item.id)
  await show($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vitrin',
      description: 'Medya panelini aç; /vitrin <dosya> ekler, /vitrin hepsi, /vitrin sohbet, /vitrin temizle, /vitrin kapat',
    })
    const kept = Number(await $.store.get('ratio'))

    if (kept > 0.2 && kept < 1) {
      await update($, ratio, () => kept)
    }

    if ((await $.store.get('filter')) === 'all') {
      await update($, filter, () => 'all')
    }

    await located($)
    await update($, isReady, () => false)
    void rescan($)

    // A reload ends the bridge with the old module; an open pane wants it back.
    if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
      void stream($)
    }

    return next(e)
  })

  on('session.append', { door: 'response' }, ($, e, next) => {
    if (e.agentId === undefined) {
      const text = e.message.content
        .map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .join('\n')
      void ingest($, mediaPaths(text), 'chat')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const since = await $.clock.now()
    const done = await next(e)

    if (e.tool === 'SendUserFile' && e.agentId === undefined) {
      void ingest($, e.files, 'chat')
    } else {
      void capture($, strings(e).join('\n'), done.text ?? '', since)
    }

    return done
  })

  on('command.run', { command: 'vitrin' }, async ($, e) => {
    const args = e.args.trim()

    if (!(await inTerminal($))) {
      return { text: 'Vitrin yalnızca terminalde çalışır.' }
    }

    if (args === 'kapat') {
      await $.ui.close({ id: PANE })

      return { text: 'Vitrin kapatıldı.' }
    }

    if (args === 'temizle') {
      await clear($)

      return { text: 'Medya listesi boşaltıldı.' }
    }

    const cell = /^oran\s+([\d.]+)$/.exec(args)

    if (cell !== null) {
      const value = Number(cell[1])

      if (!(value > 0.2 && value < 1)) {
        return { text: 'Oran 0.2 ile 1 arasında olmalı (varsayılan 0.47).' }
      }

      await update($, ratio, () => value)
      await $.store.set('ratio', value)
      await measure($)

      return { text: `Sayfanın en-boy düzeltmesi ${value} yapıldı.` }
    }

    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    void stream($)

    if (args === '') {
      return { text: 'Vitrin açıldı.' }
    }

    if (args === 'hepsi') {
      await choose($, 'all')

      return { text: 'Araçların ürettikleri dahil bütün medya gösteriliyor.' }
    }

    if (args === 'sohbet') {
      await choose($, 'chat')

      return { text: 'Yalnızca sohbette gönderilen medya gösteriliyor.' }
    }

    const added = await ingest($, [args.replace(/^["']|["']$/g, '')], 'chat')

    return { text: added > 0 ? 'Medya vitrine eklendi.' : `Gösterilemedi: ${args}` }
  })

  // The pane's region said its size, or heard a click: both go to the page.
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const sent = e.data as HitPost | undefined

    if (sent?.kind === 'size') {
      web.columns = sent.columns
      web.rows = sent.rows
      await measure($)
    } else if (sent !== undefined) {
      if ('x' in sent) {
        web.x = sent.x
        web.y = sent.y
      }

      // Where the pointer rests is kept for the wheel; the page is not told.
      if (sent.kind !== 'at') {
        await tell($, 'input', sent)
      }
    }

    return next(e)
  })

  // The wheel over the pane moves the page, not the pane: the pane's own
  // window has nowhere to go. The page is told where the pointer is, since
  // a document shown in it scrolls on its own under the pointer.
  on('ui.scroll', { requestId: PANE }, ($, e) => {
    void tell($, 'input', { kind: 'wheel', dy: e.by * WHEEL_PIXELS, x: web.x, y: web.y })

    return {}
  })

  // A closed pane needs no browser behind it.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    void tell($, 'quit', {})

    return closed
  })

  // The pane is one picture, the page as the browser last painted it, under
  // an empty region that hears the pointer.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const hasFrame = await read($, isReady)
    const columns = Math.max(10, e.props.bodyColumns)
    const rows = Math.max(5, e.props.scroll.bodyRows || (e.viewport?.rows ?? 40) - 8)

    if (e.surface !== 'terminal') {
      return <Text dimColor>Vitrin yalnızca terminalde çizilir.</Text>
    }

    const { Client, Image } = $.ui.resolve(e)
    const region: HitProps = { columns, rows }
    // A new size is a new picture to the terminal: under the old key it
    // keeps the old box and crops or shrinks every frame that follows.
    web.key = `view-${columns}x${rows}`

    return (
      <Box width={columns} height={rows}>
        {hasFrame && web.file !== '' ? (
          <Image
            key={web.key}
            source={{ file: web.file, format: 'png', generation: web.seq }}
            columns={Math.min(255, columns)}
            rows={Math.min(255, rows)}
            alt="Vitrin"
          />
        ) : (
          <Text dimColor>Vitrin başlatılıyor…</Text>
        )}
        <Box position="absolute" top={0} left={0}>
          <Client key="hit" module="./hit.tsx" props={region} width={columns} height={rows} />
        </Box>
      </Box>
    )
  })

  // A reply that names media the pane holds is drawn with those paths as
  // links: a click shows the file in the pane. Every other reply is the
  // engine's own drawing.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const reply = e.props.text

    if (e.surface !== 'terminal' || reply.length > REPLY_MAX || !namesMedia(reply)) {
      return next(e)
    }

    const list = await read($, items)
    const { home, cwd } = place.home === '' ? await located($) : place

    // A file the pane never held (named before the mod loaded, or cleared
    // in an earlier session) is pressable too, as long as it is still there.
    for (const spelled of mediaPaths(reply).slice(0, 40)) {
      const path = absolute(spelled, cwd, home)

      if (!named.has(path) && !absent.has(path)) {
        ;((await $.fs.exists(path)) ? named : absent).add(path)
      }
    }

    const made = linked(reply, spelled => {
      const path = absolute(spelled, cwd, home)

      return named.has(path) || list.some(one => one.path === path) ? hrefOf(path) : undefined
    })

    if (made.links.length === 0) {
      return next(e)
    }

    const { Box, Markdown, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Text>{e.props.isFirstOfReply ? '⏺ ' : '  '}</Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Markdown
            key="reply"
            text={made.text}
            pressableLinks={made.links}
            onLinkPress={link => void jump($, link.href)}
          />
        </Box>
      </Box>
    )
  })
}
