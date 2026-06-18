import type { JSONContent } from '@tiptap/core'

/**
 * Helpers that bridge the stored `note.content` string and TipTap.
 *
 * `note.content` holds a serialized TipTap JSON document. But notes created
 * before the editor existed contain plain text. These helpers tolerate both so
 * we never need a destructive data migration.
 */

/**
 * Turn the stored string into something TipTap's `content` option accepts.
 *  - Empty            -> '' (empty document, shows the placeholder)
 *  - Valid TipTap JSON -> the parsed doc object
 *  - Anything else     -> the raw string (rendered as a plain paragraph)
 */
export function parseDocContent(content: string): JSONContent | string {
  if (!content) return ''
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as JSONContent
    }
  } catch {
    // Not JSON — it's legacy plain text.
  }
  return content
}

/** Flatten a document's text for word counts, search, etc. */
export function extractText(content: string): string {
  const doc = parseDocContent(content)
  if (typeof doc === 'string') return doc

  let text = ''
  const walk = (node?: JSONContent): void => {
    if (!node) return
    if (node.text) text += node.text
    if (node.content) {
      for (const child of node.content) {
        walk(child)
        // Treat block boundaries as spaces so words don't run together.
        text += ' '
      }
    }
  }
  walk(doc)
  return text
}

/** Word count derived from the document's plain text. */
export function countWords(content: string): number {
  const words = extractText(content).trim().match(/\S+/g)
  return words ? words.length : 0
}
