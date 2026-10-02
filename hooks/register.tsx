import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MediaFilter, MediaItem, MediaSource } from '../types'
import type { HitProps } from './hit'
import {
  absolute,
  chunks,
  fit,
  hashOf,
  hrefOf,
  kindOf,
  linked,
  mediaPaths,
  namesMedia,
  pathOf,
} from './paths'

const PANE = 'medya'
const TITLE = 'Medya'
const KEEP = 60
const PAGE = 12
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

const items = atom({ plugin: 'medya-paneli', key: 'items' } as const, [])
const shown = atom({ plugin: 'medya-paneli', key: 'shown' } as const, PAGE)
const ratio = atom({ plugin: 'medya-paneli', key: 'ratio' } as const, RATIO)
const selected = atom({ plugin: 'medya-paneli', key: 'selected' } as const, null)
const filter = atom({ plugin: 'medya-paneli', key: 'filter' } as const, 'chat')

const LABEL = { image: 'resim', video: 'video', audio: 'ses', pdf: 'PDF', page: 'web sayfası' } as const
const SOURCE = { chat: 'sohbet', tool: 'araç' } as const

const busy = new Set<string>()
const place = { home: '', cwd: '' }

function clock(ms: number): string {
  const at = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${two(at.getHours())}:${two(at.getMinutes())}`
}

function short(name: string, width: number): string {
  return name.length <= width ? name : `${name.slice(0, Math.max(1, width - 1))}…`
}

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

// A PNG the terminal can draw, at most MAX_EDGE pixels a side: the picture
// itself, a PDF's first page, a frame from a video's first second, a sound's
// waveform, or Quick Look's thumbnail of a web page.
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
  } else if (item.kind !== 'page' && !item.path.toLowerCase().endsWith('.svg')) {
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
// no preview, the item as it is, its picture drawn as words.
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

async function show($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 64 })

  if (!opened.isPlaced) {
    $.ui.toast('Yeni medya hazır: görmek için /medya yaz')
  }
}

// Adds the files that exist and are media to the top of the list, newest
// first, and answers how many it added. A file a reply names is the chat's
// (the pane opens for it), one a tool made is kept for the "all" view; a file
// last written before `since` is not this call's and is left out.
async function ingest(
  $: EngineInterface,
  paths: readonly string[],
  from: MediaSource,
  since = 0,
  most = KEEP,
): Promise<number> {
  if (paths.length === 0) {
    return 0
  }

  const { home, cwd } = await located($)
  const dir = `${home}/.claude/cache/medya-paneli`
  let added = 0

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

      const id = hashOf(`${path}:${stat.mtimeMs}:${stat.size}`)
      const known = (await read($, items)).find(one => one.id === id)

      if (known !== undefined) {
        if (from === 'chat' && known.from !== 'chat') {
          const mine: MediaItem = { ...known, from: 'chat' }
          await update($, items, list => [mine, ...list.filter(one => one.id !== id)])
          added += 1
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
    } catch {
      // A path the text named that is not there is not media.
    } finally {
      busy.delete(path)
    }
  }

  if (added > 0 && from === 'chat') {
    await update($, selected, () => null)
    await show($)
  }

  return added
}

// The media a tool call made: the files its input or output names that were
// written while it ran. Web pages are left to the chat, where naming one says
// it is meant to be seen; a tool writing one is editing code.
async function capture($: EngineInterface, input: string, output: string, since: number) {
  const text = `${input}\n${output}`.slice(0, 200_000)

  if (!namesMedia(text)) {
    return
  }

  const made = mediaPaths(text)
    .filter(path => kindOf(path) !== 'page')
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

// The Finder's space-bar preview over the terminal, left running: the mod's
// own helper, or the default app where the helper is not built.
function quickLook($: EngineInterface, path: string) {
  const script = 'if [ -x "$1" ]; then nohup "$1" "$2" >/dev/null 2>&1 & else /usr/bin/open "$2"; fi'
  void ran($, ['/bin/sh', '-c', script, 'sh', `${$.plugin.root}/bin/onizle`, path])
}

// Shows one item large at the top of the pane.
async function pick($: EngineInterface, id: string) {
  await update($, selected, () => id)

  try {
    await $.ui.scroll({ in: PANE, to: 'start' })
  } catch {
    // The pane is not on screen.
  }
}

// A press on a media path in a reply: the pane opens on that file.
async function jump($: EngineInterface, href: string) {
  const path = pathOf(href)
  const item = (await read($, items)).find(one => one.path === path)

  if (item === undefined) {
    return
  }

  if (item.from !== 'chat') {
    const mine: MediaItem = { ...item, from: 'chat' }
    await update($, items, list => list.map(one => (one.id === item.id ? mine : one)))
  }

  await $.ui.open({ id: PANE, title: TITLE, columns: 64 })
  await pick($, item.id)
}

async function choose($: EngineInterface, mode: MediaFilter) {
  await update($, filter, () => mode)
  await update($, selected, () => null)
  await $.store.set('filter', mode)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'medya',
      description: 'Medya panelini aç; /medya <dosya> ekler, /medya hepsi, /medya sohbet, /medya temizle',
    })
    const kept = Number(await $.store.get('ratio'))

    if (kept > 0.2 && kept < 1) {
      await update($, ratio, () => kept)
    }

    if ((await $.store.get('filter')) === 'all') {
      await update($, filter, () => 'all')
    }

    // What an earlier version of the mod kept has no source or small copy.
    await update($, items, list =>
      list.map(one => ({ ...one, from: one.from ?? 'chat', thumb: one.thumb ?? one.preview })),
    )
    await located($)
    void rescan($)

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

  on('command.run', { command: 'medya' }, async ($, e) => {
    const args = e.args.trim()

    if (args === 'kapat') {
      await $.ui.close({ id: PANE })

      return { text: 'Medya paneli kapatıldı.' }
    }

    if (args === 'temizle') {
      await update($, items, () => [])

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

      return { text: `Resim en-boy düzeltmesi ${value} yapıldı.` }
    }

    await $.ui.open({ id: PANE, title: TITLE, columns: 64 })

    if (args === '') {
      return { text: 'Medya paneli açıldı.' }
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

    return { text: added > 0 ? 'Medya panele eklendi.' : `Gösterilemedi: ${args}` }
  })

  // A click on a picture in the pane: a small one is shown large, the large
  // one opens in the preview window.
  on('ui.message', { requestId: PANE }, async ($, e, next) => {
    const { act, id } = (e.data ?? {}) as Partial<HitProps>
    const item = (await read($, items)).find(one => one.id === id)

    if (item !== undefined && act === 'pick') {
      await pick($, item.id)
    } else if (item !== undefined && act === 'look') {
      quickLook($, item.path)
    }

    return next(e)
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
    const made = linked(reply, spelled => {
      const path = absolute(spelled, cwd, home)

      return list.some(one => one.path === path) ? hrefOf(path) : undefined
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, items)
    const mode = await read($, filter)
    const count = await read($, shown)
    const cell = await read($, ratio)
    const picked = await read($, selected)
    const chat = all.filter(one => one.from === 'chat')
    const list = mode === 'chat' ? chat : all
    const main = list.find(one => one.id === picked) ?? list[0]
    const columns = Math.max(10, e.props.bodyColumns)
    const maxRows = Math.max(6, Math.floor((e.viewport?.rows ?? 40) * 0.45))
    const across = columns >= 54 ? 3 : 2
    const wide = Math.max(4, Math.floor((columns - (across - 1)) / across))
    const tall = Math.max(3, Math.round(wide * 0.62 * cell))

    // A picture in a box of `room` by `rows` cells, the whole box hearing a
    // click: a click region fills it and the picture is drawn over that, in
    // the middle. A new box is a new picture to the terminal (another key,
    // another source), so it scales the file again instead of cropping the
    // one it placed for the old box.
    const framed = (item: MediaItem, file: string, room: number, rows: number, act: HitProps['act']) => {
      if (e.surface !== 'terminal') {
        return <Text dimColor>{item.name}</Text>
      }

      const { Client, Image } = $.ui.resolve(e)
      const size = file === '' ? { columns: room, rows } : fit(item.width, item.height, room, rows, cell)
      const hit: HitProps = { act, id: item.id, columns: room, rows: act === 'look' ? size.rows : rows }

      return (
        <Box width={room} height={hit.rows}>
          <Client key={`${act}-${item.id}`} module="./hit.tsx" props={hit} width={room} height={hit.rows} />
          <Box
            position="absolute"
            top={Math.floor((hit.rows - size.rows) / 2)}
            left={act === 'look' ? 0 : Math.floor((room - size.columns) / 2)}
          >
            {file === '' ? (
              <Text dimColor>(önizleme yok)</Text>
            ) : (
              <Image
                key={`${act}-${item.id}-${size.columns}x${size.rows}`}
                source={{ file, format: 'png', generation: size.columns * 1000 + size.rows }}
                columns={size.columns}
                rows={size.rows}
                alt={item.name}
              />
            )}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold>Medya</Text>
          <Text dimColor>
            {list.length} dosya{mode === 'chat' ? ', sohbette gönderilenler' : ', araçların ürettikleri dahil'}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button
            key="chat"
            label={`Sohbet ${chat.length}`}
            variant={mode === 'chat' ? 'primary' : 'secondary'}
            onPress={() => void choose($, 'chat')}
          />
          <Button
            key="all"
            label={`Hepsi ${all.length}`}
            variant={mode === 'all' ? 'primary' : 'secondary'}
            onPress={() => void choose($, 'all')}
          />
          <Button key="clear" label="Temizle" onPress={() => void update($, items, () => [])} />
          <Button key="close" label="Kapat" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
        {main === undefined && (
          <Box marginTop={1}>
            <Text dimColor>
              {all.length > 0
                ? `Sohbette gönderilen medya yok. Araçların ürettiği ${all.length} dosya için Hepsi'ne bas.`
                : 'Henüz medya yok. Claude bir resim, video, PDF ya da ses gönderdiğinde burada görünür.'}
            </Text>
          </Box>
        )}
        {main !== undefined && (
          <Box flexDirection="column" marginTop={1} marginBottom={1}>
            {framed(main, main.preview, columns, maxRows, 'look')}
            <Text wrap="truncate-middle">{main.name}</Text>
            <Text dimColor>
              {LABEL[main.kind]} · {clock(main.addedAt)} · {SOURCE[main.from]}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button
                key="look"
                label={main.kind === 'video' || main.kind === 'audio' ? 'Oynat' : 'Büyüt'}
                variant="primary"
                onPress={() => quickLook($, main.path)}
              />
              <Button key="open" label="Aç" onPress={() => void ran($, ['/usr/bin/open', main.path])} />
              <Button
                key="copy"
                label="Yolu kopyala"
                onPress={press => void $.ui.copy({ text: main.path, surface: press.surface })}
              />
            </Box>
          </Box>
        )}
        {main !== undefined &&
          list.length > 1 &&
          chunks(list.slice(0, count), across).map(row => (
            <Box flexDirection="row" gap={1} marginBottom={1}>
              {row.map(item => (
                <Box key={`cell-${item.id}`} flexDirection="column" width={wide}>
                  {framed(item, item.thumb, wide, tall, 'pick')}
                  <Button
                    key={`name-${item.id}`}
                    plain
                    dimColor={item.id !== main.id}
                    hover={{ dimColor: false }}
                    label={short(`${item.id === main.id ? '▸ ' : ''}${item.name}`, wide)}
                    onPress={() => void pick($, item.id)}
                  />
                </Box>
              ))}
            </Box>
          ))}
        {list.length > count && (
          <Button
            key="more"
            label={`Daha eski ${list.length - count} medyayı göster`}
            onPress={() => void update($, shown, n => n + PAGE)}
          />
        )}
      </Box>
    )
  })
}
