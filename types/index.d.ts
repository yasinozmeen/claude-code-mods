export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'page'

// Where the mod learnt of a file: named in a reply, or made by a tool call.
export type MediaSource = 'chat' | 'tool'

export type MediaFilter = 'chat' | 'all'

export type MediaItem = {
  id: string
  path: string
  name: string
  kind: MediaKind
  from: MediaSource
  preview: string
  thumb: string
  width: number
  height: number
  addedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    vitrin: {
      items: MediaItem[]
      ratio: number
      filter: MediaFilter
      isReady: boolean
    }
  }
}
