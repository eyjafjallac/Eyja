import type { Editor, Range } from '@tiptap/core'
import {
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  Minus,
  Quote,
  Sigma,
  Superscript,
  Type,
  type LucideIcon
} from 'lucide-react'
import { pickAndInsertImages } from './image-upload'

/**
 * One entry in the "/" menu. `command` receives the editor and the range of the
 * typed "/query" so it can delete the trigger text and apply the block.
 *
 * Adding a new block type to the menu = adding one object here. The menu UI and
 * the editor extension stay untouched.
 */
export interface SlashCommandItem {
  title: string
  description: string
  icon: LucideIcon
  /** Keywords (besides the title) that should match this item. */
  keywords?: string[]
  command: (props: { editor: Editor; range: Range }) => void
}

export const SLASH_COMMAND_ITEMS: SlashCommandItem[] = [
  {
    title: 'Text',
    description: 'Plain paragraph',
    icon: Type,
    keywords: ['paragraph', 'p'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run()
  },
  {
    title: 'Heading 1',
    description: 'Large section heading',
    icon: Heading1,
    keywords: ['h1', 'title'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
  },
  {
    title: 'Heading 2',
    description: 'Medium section heading',
    icon: Heading2,
    keywords: ['h2', 'subtitle'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
  },
  {
    title: 'Heading 3',
    description: 'Small section heading',
    icon: Heading3,
    keywords: ['h3'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    icon: List,
    keywords: ['ul', 'unordered', 'point'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run()
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    icon: ListOrdered,
    keywords: ['ol', 'ordered'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run()
  },
  {
    title: 'Quote',
    description: 'Blockquote',
    icon: Quote,
    keywords: ['blockquote', 'citation'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run()
  },
  {
    title: 'Code Block',
    description: 'Formatted code',
    icon: Code,
    keywords: ['pre', 'snippet'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    icon: Minus,
    keywords: ['hr', 'line', 'separator'],
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run()
  },
  {
    title: 'Image',
    description: 'Upload an image',
    icon: ImageIcon,
    keywords: ['picture', 'photo', 'media', 'upload'],
    command: ({ editor, range }) => {
      // Remove the "/" trigger, then open the native picker (async).
      editor.chain().focus().deleteRange(range).run()
      pickAndInsertImages(editor)
    }
  },
  {
    title: 'Inline Math',
    description: 'Inline LaTeX, e.g. $$x^2$$',
    icon: Superscript,
    keywords: ['latex', 'equation', 'formula', 'katex'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertInlineMath({ latex: 'x^2' }).run()
  },
  {
    title: 'Math Block',
    description: 'Block LaTeX equation',
    icon: Sigma,
    keywords: ['latex', 'equation', 'formula', 'katex', 'display'],
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).insertBlockMath({ latex: 'E = mc^2' }).run()
  }
]

/** Filter the menu by the text typed after "/". */
export function getSlashCommandItems(query: string): SlashCommandItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMAND_ITEMS
  return SLASH_COMMAND_ITEMS.filter((item) => {
    const haystack = [item.title, ...(item.keywords ?? [])].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}
