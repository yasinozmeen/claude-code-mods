import type { ClientModule } from 'claude-code'

export type HitProps = { columns: number; rows: number }

export type HitPost =
  | { kind: 'size'; columns: number; rows: number }
  | { kind: 'click'; x: number; y: number }

// The empty region over the pane's picture: it says how large it is, and
// posts each click as a point from 0 to 1 across and down.
const Hit: ClientModule<HitProps, HitProps> = (props, surface) => {
  const { Box } = surface.elements
  const known = surface.state

  if (known === undefined || known.columns !== props.columns || known.rows !== props.rows) {
    surface.setState({ columns: props.columns, rows: props.rows })
    surface.post({ kind: 'size', columns: props.columns, rows: props.rows })
  }

  surface.onPointer(event => {
    const isInside = event.x >= 0 && event.y >= 0 && event.x < props.columns && event.y < props.rows

    if (event.type === 'up' && isInside) {
      surface.post({
        kind: 'click',
        x: (event.fine?.x ?? event.x + 0.5) / props.columns,
        y: (event.fine?.y ?? event.y + 0.5) / props.rows,
      })
    }
  })

  return <Box width={props.columns} height={props.rows} />
}

export default Hit
