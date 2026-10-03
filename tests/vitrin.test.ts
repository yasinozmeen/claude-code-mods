import { expect, mock, test } from 'claude-code/testing'

import { absolute, hrefOf, kindOf, linked, mediaPaths, pathOf } from '../hooks/paths'

const PANE = {
  plugin: 'vitrin',
  component: 'Pane',
  requestId: 'vitrin',
  props: {
    title: 'Vitrin',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
  viewport: { columns: 200, rows: 50, isFullscreen: true },
} as const

test('a reply\'s media paths are found, web links and other files are not', () => {
  const text = [
    'Ekran görüntüsü: `/tmp/çıktı klasörü/ekran 1.png` ve /Users/x/video.mp4.',
    '[rapor](file:///tmp/a%20b.pdf), ~/resim.JPG, out/grafik.webp',
    'https://example.com/logo.png ve notlar.txt, `/tmp/çıktı klasörü/ekran 1.png`',
  ].join('\n')

  expect(mediaPaths(text)).toEqual([
    '/tmp/çıktı klasörü/ekran 1.png',
    '/tmp/a b.pdf',
    '/Users/x/video.mp4',
    '~/resim.JPG',
    'out/grafik.webp',
  ])
  expect(kindOf('/a/b.MOV')).toBe('video')
  expect(kindOf('/a/b.txt')).toBeUndefined()
  expect(kindOf('/a/PLAN.md')).toBe('doc')
  expect(mediaPaths('bak: `notlar/plan.md` ve rapor.mdx')).toEqual(['notlar/plan.md'])
  expect(absolute('~/a.png', '/work', '/Users/x')).toBe('/Users/x/a.png')
  expect(absolute('out/a.png', '/work', '/Users/x')).toBe('/work/out/a.png')
})

test('a known path in a reply becomes a link, code is left alone', () => {
  const known = (path: string) => (path === '/tmp/a b.png' || path === 'out/c.png' ? hrefOf(`/x/${path}`) : undefined)
  const made = linked(
    'Bak: `/tmp/a b.png` ve out/c.png, ama `ffmpeg -i out/c.png` ve /baska/out/c.png değil.\n```\nout/c.png\n```',
    known,
  )

  expect(made.text).toBe(
    'Bak: [`/tmp/a b.png`](file:///x//tmp/a%20b.png) ve [out/c.png](file:///x/out/c.png), ama `ffmpeg -i out/c.png` ve /baska/out/c.png değil.\n```\nout/c.png\n```',
  )
  expect(made.links).toEqual(['file:///x//tmp/a%20b.png', 'file:///x/out/c.png'])
  expect(pathOf('file:///tmp/a%20b.png')).toBe('/tmp/a b.png')
})

test('media reaches the page behind the pane; its buttons and a pressed path act', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  const opened: string[] = []
  const posts: { route: string; body: Record<string, unknown> }[] = []
  const commands: string[][] = []
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'oturum' }))
  on('session.messages', () => ({ value: [] }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 5000, isLink: false } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_, e) => {
    commands.push([...e.argv])

    return {
      value: {
        exitCode: 0,
        stdout: '  pixelWidth: 800\n  pixelHeight: 400\n',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  // The bridge: it listens, a button of the page is pressed, a frame comes,
  // and it stays up until the test lets it go.
  let stop = () => {}
  const stopped = new Promise<void>(resolve => (stop = resolve))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'READY 4321\nACT {"act":"filter","mode":"all"}\n' }
    yield { stream: 'stdout' as const, text: 'F /tmp/kare/f1.png 1\n' }
    await stopped

    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', (_, e) => {
    posts.push({ route: new URL(e.url).pathname, body: JSON.parse(e.init?.body ?? '{}') })

    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.blit', () => ({ value: {} }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('tool.call', () => ({ result: {}, text: 'wrote /tmp/arac.png and /tmp/sayfa.html' }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Client' })).toBeDefined()

  for (const args of ['/tmp/bir.png', '"/tmp/iki.png"', '/tmp/notlar.txt']) {
    await $.command.run({
      command: 'vitrin',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    })
  }

  // A file a tool wrote is kept, marked as the tool's; a web page it wrote is not.
  await $.tool.call({ tool: 'Bash', command: 'make /tmp/arac.png' })

  // A reply naming a file the pane holds is drawn with the path pressable,
  // and the press asks the page to show that file.
  const reply = await $.ui.mount({
    plugin: 'vitrin',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'İlk resim: `/tmp/bir.png`', isFirstOfReply: true },
  })
  expect(await reply.find({ type: 'Markdown' })).toBeDefined()
  await reply.press({ key: 'reply', link: { href: 'file:///tmp/bir.png' } })

  // The page was told the whole list, the filter its own button chose, and
  // which file to show.
  expect(opened).toContain('vitrin')
  const last = posts.filter(one => one.route === '/items').at(-1)?.body as {
    items: { id: string; name: string; from: string }[]
    filter: string
    pick: string
  }
  expect(last.filter).toBe('all')
  expect(last.items.map(one => `${one.name}:${one.from}`)).toEqual(['arac.png:tool', 'iki.png:chat', 'bir.png:chat'])
  expect(last.pick).toBe(last.items.find(one => one.name === 'bir.png')?.id)

  // A click in the pane is played into the page.
  await ui.pointer({ type: 'up', x: 30, y: 20, button: 'left', in: 'hit' })
  expect(posts.some(one => one.route === '/input' && one.body.kind === 'up')).toBe(true)

  // So is a key, once the region has the keyboard.
  await ui.key({ key: 'right', in: 'hit' })
  expect(posts.some(one => one.route === '/input' && one.body.kind === 'key' && one.body.key === 'right')).toBe(true)
  expect(await ui.find({ type: 'Image' })).toBeDefined()

  // Cleared, the reply's path is still pressable, and the press brings the
  // file back into the pane.
  await $.command.run({
    command: 'vitrin',
    args: 'temizle',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
  const again = await $.ui.mount({
    plugin: 'vitrin',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'İlk resim: `/tmp/bir.png`', isFirstOfReply: true },
  })
  await again.press({ key: 'reply', link: { href: 'file:///tmp/bir.png' } })
  const back = posts.filter(one => one.route === '/items').at(-1)?.body as { items: { name: string }[]; pick: string }
  expect(back.items.map(one => one.name)).toEqual(['bir.png'])
  expect(back.pick).not.toBe('')

  stop()
  await $.command.run({
    command: 'vitrin',
    args: 'kapat',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
})
