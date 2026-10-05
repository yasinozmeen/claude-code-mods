import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Colors, Run } from '../types'

type Who = 'ben' | 'claude'
type Row = { id: string; who: Who | 'arac'; isMid: boolean; tool: string }

const PANE = 'vurgu'
const SAID = ['SendUserFile']
const KINDS = [
  { key: 'ben', label: 'Senin mesajların' },
  { key: 'son', label: 'Claude: kapanış mesajı' },
  { key: 'ara', label: 'Claude: iş arası mesajı' },
] as const
const PALETTE = [
  { name: 'yeşil', value: '#14532d' },
  { name: 'deniz', value: '#134e4a' },
  { name: 'mavi', value: '#1e3a5f' },
  { name: 'lacivert', value: '#1e1b4b' },
  { name: 'mor', value: '#3f2d63' },
  { name: 'bordo', value: '#4c1d2e' },
  { name: 'kahve', value: '#4a3410' },
  { name: 'zeytin', value: '#3a3f17' },
  { name: 'gri', value: '#2f3338' },
] as const
const DEFAULTS: Colors = { ben: '#14532d', son: '#1e3a5f', ara: '#3f2d63' }
// The background of each kind of message, chosen in the pane.
const colors = atom({ plugin: 'vurgu', key: 'colors' } as const, DEFAULTS)
// The reply texts written mid-work, a tool call after them.
const ara = atom({ plugin: 'vurgu', key: 'ara' } as const, [] as string[])
// The reply text drawn last in this turn; a tool call after it makes it mid-work.
const latest = { id: '' }
// The reply texts already drawn once.
const seen = new Set<string>()
// The runs of tool calls, each drawn as one line, and the runs opened out.
const runs = atom({ plugin: 'vurgu', key: 'runs' } as const, [] as Run[])
const open = atom({ plugin: 'vurgu', key: 'open' } as const, [] as string[])
// True once something other than a tool call was drawn: the next call starts a run.
const live = { isBroken: true }
// The session's prompts, reply texts and tool calls in transcript order,
// read from its stored transcript: what was written before the mod loaded.
async function ordered($: EngineInterface): Promise<Row[]> {
  try {
    const argv = ['/usr/bin/python3', `${$.plugin.root}/bin/sira.py`, await $.session.id()]
    const out = await $.process.run(argv, { timeoutMs: 15_000 })

    return out.stdout
      .split('\n')
      .filter(line => line.length > 2)
      .map(line => {
        const [mark = '', id = '', tool = ''] = line.split(' ')
        const who = mark === 'b' ? ('ben' as const) : mark === 't' ? ('arac' as const) : ('claude' as const)
        // A file sent to the person (`s`) counts as something Claude said.

        return { id, who, isMid: mark === 'a', tool }
      })
  } catch {
    return []
  }
}

// The tool calls of the transcript gathered into runs: calls with no prompt
// and no reply text between them.
function gathered(rows: Row[]): Run[] {
  const made: Run[] = []
  let isOpen = false

  for (const row of rows) {
    if (row.who !== 'arac') {
      isOpen = false
    } else if (isOpen) {
      made.at(-1)?.ids.push(row.id)
      made.at(-1)?.tools.push(row.tool)
    } else {
      made.push({ ids: [row.id], tools: [row.tool] })
      isOpen = true
    }
  }

  return made
}

// What a run says of itself in one line: how many calls, of which tools.
function summed(run: Run): string {
  const counts = new Map<string, number>()

  for (const tool of run.tools) {
    counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }

  const parts = [...counts].map(([tool, count]) => (count > 1 ? `${tool} ×${count}` : tool))

  return `${run.ids.length} işlem · ${parts.join(', ')}`
}

// Sets one kind's colour, kept across sessions; anything but `#rrggbb` or ''
// is not a colour and changes nothing.
async function paint($: EngineInterface, kind: keyof Colors, value: string) {
  const spelled = value.trim().toLowerCase()
  const hex = spelled === '' || spelled.startsWith('#') ? spelled : `#${spelled}`

  if (hex !== '' && !/^#[0-9a-f]{6}$/.test(hex)) {
    $.ui.toast('Renk #rrggbb biçiminde olmalı, örneğin #14532d')

    return
  }

  await update($, colors, now => ({ ...now, [kind]: hex }))
  await $.store.set('colors', await read($, colors))
}

// What a tool call is about, in a few words: its own description, or the
// first line of what it was given.
function about(tool: string, input: unknown): string {
  const given = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const said = [given.description, given.command, given.file_path, given.pattern, given.prompt, given.url]
  const first = said.find(one => typeof one === 'string' && one.trim() !== '')
  const line = typeof first === 'string' ? (first.trim().split('\n')[0] ?? '') : ''

  return line === '' ? tool : `${tool} · ${line.length > 90 ? `${line.slice(0, 90)}…` : line}`
}

// A prompt as the person reads it: the tags the engine wraps pasted text in
// are its own bookkeeping, and so are the blank lines they leave.
function shownText(text: string): string {
  return text
    .replace(/<\/?pasted_content[^>]*>[ \t]*\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function toggle($: EngineInterface, head: string) {
  await update($, open, list => (list.includes(head) ? list.filter(one => one !== head) : [...list, head].slice(-200)))
}

export const register: Register = on => {
  // The runs made before the mod loaded, from the transcript.
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'vurgu', description: 'Mesaj renklerini seçme panelini aç; /vurgu kapat kapatır' })
    const kept = await $.store.get('colors')

    if (typeof kept === 'object' && kept !== null) {
      await update($, colors, () => ({ ...DEFAULTS, ...(kept as Partial<Colors>) }))
    }

    const rows = await ordered($)
    await update($, runs, () => gathered(rows).slice(-400))
    await update($, ara, () => rows.filter(row => row.isMid).map(row => row.id).slice(-600))

    return started
  })

  on('command.run', { command: 'vurgu' }, async ($, e) => {
    if (e.args.trim() === 'kapat') {
      await $.ui.close({ id: PANE })

      return { text: 'Renk paneli kapatıldı.' }
    }

    await $.ui.open({ id: PANE, title: 'Vurgu renkleri', columns: 50 })

    return { text: 'Renk paneli açıldı.' }
  })

  // The colours, each kind with the palette, a field for any other colour
  // and a sample line: a choice shows there and in the chat at once.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>Renk paneli yalnızca terminalde çizilir.</Text>
    }

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const now = await read($, colors)

    return (
      <Box flexDirection="column" rowGap={1}>
        {KINDS.map(kind => (
          <Box flexDirection="column">
            <Text bold>{kind.label}</Text>
            <Box flexDirection="row" width="100%" paddingX={1} {...(now[kind.key] === '' ? {} : { backgroundColor: now[kind.key] })}>
              <Text>{kind.key === 'ben' ? '❯ Örnek mesaj böyle görünür' : '⏺ Örnek mesaj böyle görünür'}</Text>
            </Box>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {PALETTE.map(tone => (
                <Box flexDirection="row">
                  <Text backgroundColor={tone.value}>{'  '}</Text>
                  <Button
                    key={`${kind.key}-${tone.name}`}
                    label={now[kind.key] === tone.value ? `[${tone.name}]` : tone.name}
                    plain
                    onPress={() => paint($, kind.key, tone.value)}
                  />
                </Box>
              ))}
              <Button
                key={`${kind.key}-yok`}
                label={now[kind.key] === '' ? '[renksiz]' : 'renksiz'}
                plain
                dimColor
                onPress={() => paint($, kind.key, '')}
              />
            </Box>
            <Input
              key={`${kind.key}-hex`}
              label="Başka renk"
              placeholder={now[kind.key] === '' ? '#rrggbb' : now[kind.key]}
              submitLabel="Uygula"
              onSubmit={value => paint($, kind.key, value)}
            />
          </Box>
        ))}
        <Text dimColor>Seçim hemen uygulanır ve hatırlanır. Kapatmak için: /vurgu kapat</Text>
      </Box>
    )
  })

  on('prompt.submit', ($, e, next) => {
    live.isBroken = true
    latest.id = ''

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const mid = latest.id

    if (mid !== '' && !(await read($, ara)).includes(mid)) {
      await update($, ara, list => [...list, mid].slice(-600))
    }

    // A file sent to the person is something said, not work: it is never
    // folded, and the calls after it start a run of their own.
    if (SAID.includes(e.tool)) {
      live.isBroken = true

      return next(e)
    }

    // The call joins the run before it, or starts one after a reply's text.
    const startsRun = live.isBroken
    live.isBroken = false
    await update($, runs, list => {
      const last = list.at(-1)

      if (list.some(run => run.ids.includes(e.tool_use_id))) {
        return list
      }

      if (startsRun || last === undefined) {
        return [...list, { ids: [e.tool_use_id], tools: [e.tool] }].slice(-400)
      }

      return [...list.slice(0, -1), { ids: [...last.ids, e.tool_use_id], tools: [...last.tools, e.tool] }]
    })

    return next(e)
  })

  // A run of tool calls is one dim line, pressed to open out and to fold
  // again; a call still running, or one that failed, shows as the engine
  // draws it.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const run = (await read($, runs)).find(one => one.ids.includes(e.requestId))

    if (e.surface !== 'terminal' || run === undefined) {
      return next(e)
    }

    const head = run.ids[0] ?? ''
    const isOpen = (await read($, open)).includes(head)
    const isShown = isOpen || e.props.isRunning || e.props.isErrored
    const { Box, Button } = $.ui.resolve(e)

    if (e.requestId !== head) {
      if (!isShown) {
        return <Box />
      }

      // Opened out, each call has a line of its own that folds the run again,
      // so the one at hand does, not only the run's first far above.
      return isOpen ? (
        <Box flexDirection="column">
          <Button key={`fold-${e.requestId}`} label={`▾ ${about(e.props.tool, e.props.input)}`} plain dimColor onPress={() => toggle($, head)} />
          {await next(e)}
        </Box>
      ) : (
        next(e)
      )
    }

    const label = `${isOpen ? '▾' : '▸'} ${summed(run)}`

    const fold = <Button key={`run-${head}`} label={label} plain dimColor onPress={() => toggle($, head)} />

    if (!isShown) {
      return <Box>{fold}</Box>
    }

    return (
      <Box flexDirection="column">
        {fold}
        {await next(e)}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const run = (await read($, runs)).find(one => one.ids.includes(e.requestId))

    if (e.surface !== 'terminal' || run === undefined) {
      return next(e)
    }

    const isOpen = (await read($, open)).includes(run.ids[0] ?? '')
    const { Box } = $.ui.resolve(e)

    return isOpen || e.props.isErrored ? next(e) : <Box />
  })

  // A prompt and a reply's text are drawn on the colour chosen for their
  // kind. The engine's own row may not be set inside a coloured box, so the
  // mod draws the row; a kind left without a colour stays the engine's.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const tone = (await read($, colors)).ben

    if (e.surface !== 'terminal' || tone === '' || e.props.task !== undefined || e.props.from !== undefined) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" width="100%" backgroundColor={tone} paddingX={1}>
        <Text bold>❯ </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text>{shownText(e.props.text)}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {

    // A text seen for the first time is new in this turn: it ends the run of
    // tool calls before it. A row drawn again (a colour changed, the window
    // scrolled) says nothing new.
    if (!seen.has(e.requestId)) {
      seen.add(e.requestId)
      live.isBroken = true
      latest.id = e.requestId
    }

    const now = await read($, colors)
    const tone = (await read($, ara)).includes(e.requestId) ? now.ara : now.son

    if (e.surface !== 'terminal' || tone === '') {
      return next(e)
    }

    const { Box, Markdown, Text } = $.ui.resolve(e)
    const drawn = await next(e)
    // Another mod's drawing (Vitrin's, with its pressable paths) is kept and
    // set on the colour; the engine's own is drawn again here.
    const isMods = typeof drawn === 'object' && drawn !== null && 'type' in drawn && drawn.type === 'Box'

    return (
      <Box flexDirection="row" width="100%" backgroundColor={tone} paddingX={1}>
        {isMods ? (
          drawn
        ) : (
          <Box flexDirection="row" flexGrow={1} flexShrink={1}>
            <Text>{e.props.isFirstOfReply ? '⏺ ' : '  '}</Text>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Markdown text={e.props.text} />
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
