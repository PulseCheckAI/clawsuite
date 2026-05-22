// Pure OPML parser. Regex-based, no new dependency (same ethos as feed.ts).
// folder = the title/text of the nearest ancestor <outline> that has no xmlUrl.

export interface OpmlFeed {
  label: string
  url: string
  folder: string | null
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return m ? decode(m[1]).trim() : null
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseOpml(xml: string): OpmlFeed[] {
  if (!xml || typeof xml !== 'string') return []
  const feeds: OpmlFeed[] = []
  const seen = new Set<string>()
  const folderStack: string[] = []

  // Walk every <outline ...> token (self-closing or opening) plus </outline>,
  // in document order, tracking folder nesting via a stack.
  const tokenRe = /<outline\b[^>]*\/?>|<\/outline>/gi
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(xml)) !== null) {
    const token = m[0]
    if (token === '</outline>') {
      folderStack.pop()
      continue
    }
    const selfClosing = /\/>\s*$/.test(token)
    const url = attr(token, 'xmlUrl')
    const label = attr(token, 'title') ?? attr(token, 'text') ?? '(untitled)'
    if (url) {
      if (!seen.has(url)) {
        seen.add(url)
        feeds.push({
          label,
          url,
          folder: folderStack.length
            ? folderStack[folderStack.length - 1]
            : null,
        })
      }
      if (!selfClosing) folderStack.push(label)
    } else {
      if (!selfClosing) folderStack.push(label)
    }
  }
  return feeds
}
