import type { ClientModule } from 'claude-code'

export type HitProps = { act: 'pick' | 'look'; id: string; columns: number; rows: number }

// An empty region that hears a click, laid over a picture: a left click
// released inside it is posted to the hooks module.
const Hit: ClientModule<HitProps> = (props, surface) => {
  const { Box } = surface.elements

  surface.onPointer(event => {
    const isInside = event.x >= 0 && event.y >= 0 && event.x < props.columns && event.y < props.rows

    if (event.type === 'up' && event.button === 'left' && isInside) {
      surface.post({ act: props.act, id: props.id })
    }
  })

  return <Box width={props.columns} height={props.rows} />
}

export default Hit
