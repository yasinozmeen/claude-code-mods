import type { ClientModule } from 'claude-code'

export type HitProps = { columns: number; rows: number }

// A pointer post's `mods` is a bit set: 1 alt, 2 ctrl (cmd and shift never
// arrive: the terminal keeps them, shift for selecting text).
export type HitPost =
  | { kind: 'size'; columns: number; rows: number }
  | { kind: 'down' | 'move' | 'up'; x: number; y: number; mods: number }
  | { kind: 'held'; mods: number }
  | { kind: 'at'; x: number; y: number }
  | { kind: 'key'; key: string }

// What the region remembers between calls: its size, the modifier keys down
// at the last pointer event, and the cell the pointer was last said to be at.
type HitState = HitProps & { mods: number; cx?: number; cy?: number }

// The empty region over the pane's picture. It says how large it is, posts
// the pointer's presses and drags as points from 0 to 1 across and down,
// says when a modifier goes down or up while the pointer is over it and
// where the pointer rests (the wheel has no place of its own), and,
// once a click has given it the keyboard, posts the keys pressed.
const Hit: ClientModule<HitProps, HitState> = (props, surface) => {
  const { Box } = surface.elements
  const known = surface.state

  if (known === undefined || known.columns !== props.columns || known.rows !== props.rows) {
    surface.setState({ columns: props.columns, rows: props.rows, mods: known?.mods ?? 0 })
    surface.post({ kind: 'size', columns: props.columns, rows: props.rows })
  }

  surface.onPointer(event => {
    const mods = (event.alt === true ? 1 : 0) | (event.ctrl === true ? 2 : 0)
    const isInside = event.x >= 0 && event.y >= 0 && event.x < props.columns && event.y < props.rows
    const at = (cell: number, fine: number | undefined, cells: number) =>
      Math.max(0, Math.min(1, (fine ?? cell + 0.5) / cells))
    const point = { x: at(event.x, event.fine?.x, props.columns), y: at(event.y, event.fine?.y, props.rows), mods }

    if (event.type === 'down' && isInside) {
      surface.post({ kind: 'down', ...point })
    } else if (event.type === 'up') {
      surface.post({ kind: 'up', ...point })
    } else if (event.type === 'move' && event.button !== undefined) {
      surface.post({ kind: 'move', ...point })
    } else if (event.type === 'move' && mods !== (surface.state?.mods ?? 0)) {
      surface.setState({ ...surface.state, columns: props.columns, rows: props.rows, mods })
      surface.post({ kind: 'held', mods })
    } else if (event.type === 'move' && isInside) {
      const was = surface.state

      // Said a few cells apart, not at every cell crossed.
      if (was?.cx === undefined || was.cy === undefined || Math.abs(event.x - was.cx) > 2 || event.y !== was.cy) {
        surface.setState({ columns: props.columns, rows: props.rows, mods, cx: event.x, cy: event.y })
        surface.post({ kind: 'at', x: point.x, y: point.y })
      }
    }
  })

  surface.onKey(event => {
    surface.post({ kind: 'key', key: event.key })
  })

  return <Box width={props.columns} height={props.rows} />
}

export default Hit
