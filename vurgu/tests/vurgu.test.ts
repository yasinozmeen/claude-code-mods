import { expect, test } from 'claude-code/testing'

test('a run of tool calls is one line until it is pressed open', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text', props: {}, children: ['Bash(ls)'] }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'bir' })
  await $.tool.call({ tool: 'Bash', command: 'pwd', tool_use_id: 'iki' })

  const props = { tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const head = await $.ui.mount({
    plugin: 'vurgu',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'bir',
    props: { ...props, tool_use_id: 'bir' },
  })
  expect(JSON.stringify(await head.find({ type: 'Button' }))).toContain('2 işlem · Bash ×2')
  expect(await head.find({ type: 'Text' })).toBeUndefined()

  await head.press({ key: 'run-bir' })
  expect(JSON.stringify(await head.find({ type: 'Button' }))).toContain('▾')
})

test('a colour chosen in the pane is the colour a prompt is drawn on', async ($, on) => {
  const kept = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text', props: {}, children: ['> merhaba'] }))

  const pane = await $.ui.mount({
    plugin: 'vurgu',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'vurgu',
    props: { bodyColumns: 50, scroll: { offset: 0, bodyRows: 30 } } as never,
  })
  await pane.press({ key: 'ben-bordo' })
  expect(JSON.stringify(kept.get('colors'))).toContain('"ben":"#4c1d2e"')

  const mine = await $.ui.mount({
    plugin: 'vurgu',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'merhaba', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(JSON.stringify(await mine.find({ type: 'Box' }))).toContain('#4c1d2e')

  await pane.input({ key: 'ben-hex', text: '112233' })
  expect(JSON.stringify(kept.get('colors'))).toContain('"ben":"#112233"')
})
