import type { ClientModule } from 'claude-code'

export type HitProps = { columns: number; rows: number }

export type HitPost =
  | { kind: 'size'; columns: number; rows: number }
  | { kind: 'click'; x: number; y: number; isHeld: boolean }
  | { kind: 'held'; isHeld: boolean }

// What the region remembers between calls: its size, and whether ctrl or alt
// was down at the last pointer event.
type HitState = HitProps & { isHeld: boolean }

// The empty region over the pane's picture: it says how large it is, posts
// each click as a point from 0 to 1 across and down, and says when ctrl or
// alt goes down or up while the pointer is over it (cmd never arrives: the
// terminal keeps it).
const Hit: ClientModule<HitProps, HitState> = (props, surface) => {
  const { Box } = surface.elements
  const known = surface.state

  if (known === undefined || known.columns !== props.columns || known.rows !== props.rows) {
    surface.setState({ columns: props.columns, rows: props.rows, isHeld: known?.isHeld ?? false })
    surface.post({ kind: 'size', columns: props.columns, rows: props.rows })
  }

  surface.onPointer(event => {
    const isInside = event.x >= 0 && event.y >= 0 && event.x < props.columns && event.y < props.rows

    const isHeld = event.ctrl === true || event.alt === true

    if (event.type === 'up' && isInside) {
      surface.post({
        kind: 'click',
        x: (event.fine?.x ?? event.x + 0.5) / props.columns,
        y: (event.fine?.y ?? event.y + 0.5) / props.rows,
        isHeld,
      })
    } else if (event.type !== 'leave' && isHeld !== (surface.state?.isHeld ?? false)) {
      surface.setState({ columns: props.columns, rows: props.rows, isHeld })
      surface.post({ kind: 'held', isHeld })
    }
  })

  return <Box width={props.columns} height={props.rows} />
}

export default Hit
