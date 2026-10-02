import { expect, mock, test } from 'claude-code/testing'

import { absolute, fit, hrefOf, kindOf, linked, mediaPaths, pathOf } from '../hooks/paths'

const PANE = {
  plugin: 'medya-paneli',
  component: 'Pane',
  requestId: 'medya',
  props: {
    title: 'Medya',
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
    'https://example.com/logo.png ve notlar.md, `/tmp/çıktı klasörü/ekran 1.png`',
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
  expect(absolute('~/a.png', '/work', '/Users/x')).toBe('/Users/x/a.png')
  expect(absolute('out/a.png', '/work', '/Users/x')).toBe('/work/out/a.png')
})

test('a picture keeps its shape inside the pane', () => {
  expect(fit(800, 400, 60, 30, 0.5)).toEqual({ columns: 60, rows: 15 })
  expect(fit(400, 1600, 60, 30, 0.5)).toEqual({ columns: 15, rows: 30 })
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

test('the pane shows the newest large and a grid; a press picks, a filter narrows', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  const opened: string[] = []
  on('env.get', () => ({ value: '/Users/x' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 10, mtimeMs: 5000, isLink: false } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '  pixelWidth: 800\n  pixelHeight: 400\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('ui.scroll', () => ({}))
  on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'Text', props: {}, children: ['engine'] }))
  on('tool.call', () => ({ result: {}, text: 'wrote /tmp/arac.png and /tmp/sayfa.html' }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()

  for (const args of ['/tmp/bir.png', '"/tmp/iki.png"', '/tmp/notlar.txt']) {
    await $.command.run({
      command: 'medya',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 200 },
    })
  }

  // One large picture and a small one per file.
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(3)
  expect(opened).toContain('medya')
  expect(await ui.find({ type: 'Text', text: 'iki.png' })).toBeDefined()

  // A file a tool wrote is kept for the "all" view only; a web page is not.
  await $.tool.call({ tool: 'Bash', command: 'make /tmp/arac.png' })
  await ui.press({ key: 'chat' })
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(3)
  await ui.press({ key: 'all' })
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(4)
  expect(await ui.find({ type: 'Text', text: 'arac.png' })).toBeDefined()

  // A reply naming a file the pane holds is drawn with the path pressable,
  // and the press shows that file large; another reply is the engine's own.
  const reply = await $.ui.mount({
    plugin: 'medya-paneli',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'İlk resim: `/tmp/bir.png`', isFirstOfReply: true },
  })
  const drawn = await reply.find({ type: 'Markdown' })
  expect(drawn).toBeDefined()
  await reply.press({ key: 'reply', link: { href: 'file:///tmp/bir.png' } })
  expect(await ui.find({ type: 'Button', text: /▸ bir\.png/ })).toBeDefined()

  // A click anywhere in a small picture's box shows that file large.
  await ui.press({ key: 'all' })
  const boxes = (await ui.findAll({ type: 'Client' })).filter(one => /^pick-/.test(one.key ?? ''))
  expect(boxes).toHaveLength(3)
  await ui.pointer({ type: 'up', x: 1, y: 1, button: 'left', in: boxes[0]?.key ?? '' })
  expect(await ui.find({ type: 'Button', text: /▸ arac\.png/ })).toBeDefined()

  await ui.press({ key: 'clear' })
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(0)
})
