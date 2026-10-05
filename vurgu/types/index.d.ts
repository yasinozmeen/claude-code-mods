// A run of tool calls with no text between them: drawn as one line.
export type Run = { ids: string[]; tools: string[] }

// The background of each kind of message, as `#rrggbb`; '' leaves the kind
// as the engine draws it. `ben` is the person's prompt, `son` the text that
// closes a reply, `ara` a text written mid-work.
export type Colors = { ben: string; son: string; ara: string }

declare module 'claude-code' {
  interface PluginState {
    vurgu: { runs: Run[]; open: string[]; ara: string[]; colors: Colors }
  }
}
