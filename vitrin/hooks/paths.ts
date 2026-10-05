import type { MediaKind } from '../types'

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'avif', 'svg']
const VIDEO = ['mp4', 'mov', 'm4v', 'webm', 'mkv']
const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const PAGE = ['html', 'htm']
const DOC = ['md', 'markdown']
// Longest first, so `.html` is not read as `.htm` and `.jpeg` as `.jpg`.
const EXT = [...IMAGE, ...VIDEO, ...AUDIO, ...PAGE, ...DOC, 'pdf']
  .sort((a, b) => b.length - a.length)
  .join('|')

const ENDS = new RegExp(`\\.(${EXT})$`, 'i')
const BACKTICK = /`([^`\n]+)`/g
const LINK = /\]\(([^)\n]+)\)/g
const QUOTED = /"([^"\n]+)"|'([^'\n]+)'/g
const FENCE = /(```[\s\S]*?(?:```|$))/
const BARE = new RegExp(`(?:file://)?[^\\s\`"'<>()\\[\\]{}|,;:*?]+\\.(?:${EXT})(?![\\p{L}\\p{N}_])`, 'giu')

export function kindOf(path: string): MediaKind | undefined {
  const ext = ENDS.exec(path)?.[1]?.toLowerCase()

  if (ext === undefined) {
    return undefined
  }

  if (ext === 'pdf') {
    return 'pdf'
  }

  if (PAGE.includes(ext)) {
    return 'page'
  }

  if (DOC.includes(ext)) {
    return 'doc'
  }

  if (AUDIO.includes(ext)) {
    return 'audio'
  }

  return VIDEO.includes(ext) ? 'video' : 'image'
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

// The media file paths a reply's text names, in the order written, as written
// but for a `file://` prefix and percent escapes; web links are left out.
export function mediaPaths(text: string): string[] {
  const found: string[] = []
  const take = (raw: string) => {
    const spelled = raw.trim()

    if (/^https?:/i.test(spelled) || !ENDS.test(spelled)) {
      return
    }

    const path = spelled.startsWith('file://') ? decoded(spelled.slice(7)) : spelled

    if (!found.includes(path)) {
      found.push(path)
    }
  }

  for (const match of text.matchAll(BACKTICK)) {
    take(match[1] ?? '')
  }

  for (const match of text.matchAll(LINK)) {
    take(match[1] ?? '')
  }

  for (const match of text.matchAll(QUOTED)) {
    take(match[1] ?? match[2] ?? '')
  }

  // A path already taken whole (one with spaces, in backticks) is not taken
  // again in pieces; a web link's tail is not a file.
  const rest = text.replace(BACKTICK, ' ').replace(LINK, ' ').replace(QUOTED, ' ').replace(/https?:\/\/\S+/gi, ' ')

  for (const match of rest.matchAll(BARE)) {
    take(match[0])
  }

  return found
}

export function absolute(path: string, cwd: string, home: string): string {
  if (path === '~' || path.startsWith('~/')) {
    return home + path.slice(1)
  }

  return path.startsWith('/') ? path : `${cwd}/${path.replace(/^\.\//, '')}`
}

export function hashOf(text: string): string {
  let hash = 0x811c9dc5

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function namesMedia(text: string): boolean {
  return new RegExp(`\\.(?:${EXT})(?![\\p{L}\\p{N}_])`, 'iu').test(text)
}

export function hrefOf(path: string): string {
  return `file://${encodeURI(path)}`
}

// The path a `file:` link leads to, however the surface spelled the link.
export function pathOf(href: string): string {
  return decoded(href.replace(/^file:\/\//, ''))
}

// A reply's markdown with each media path `hrefFor` knows turned into a link
// to it, and those links; code fences and paths inside a longer code span are
// left as written.
export function linked(
  text: string,
  hrefFor: (spelled: string) => string | undefined,
): { text: string; links: string[] } {
  const links: string[] = []
  const parts = text.split(FENCE).map((part, index) => {
    const names = mediaPaths(part)
      .filter(name => part.includes(name) && hrefFor(name) !== undefined)
      .sort((a, b) => b.length - a.length)

    if (index % 2 === 1 || names.length === 0) {
      return part
    }

    const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const named = new RegExp(
      `(?<![^\\s\`("'\\[])(\\]\\()?(\`)?(${escaped})(\`)?(?![\\p{L}\\p{N}_/])`,
      'gu',
    )

    return part.replace(named, (whole, target, open, name: string, close) => {
      const href = hrefFor(name)

      if (href === undefined || (open === undefined) !== (close === undefined)) {
        return whole
      }

      links.push(href)

      if (target !== undefined) {
        return `](${href}`
      }

      return open === undefined ? `[${name}](${href})` : `[\`${name}\`](${href})`
    })
  })

  return { text: parts.join(''), links: [...new Set(links)] }
}
