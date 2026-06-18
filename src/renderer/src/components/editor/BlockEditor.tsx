import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import Image from '@tiptap/extension-image'
import { Mathematics } from '@tiptap/extension-mathematics'
import { SlashCommand } from './SlashCommand'
import { MathPopover } from './MathPopover'
import { handleImageDrop, handleImagePaste } from './image-upload'
import { parseDocContent } from '@/lib/editor'

interface BlockEditorProps {
  /** Stored content (TipTap JSON string or legacy plain text). */
  initialContent: string
  editable: boolean
  /** Fires on every edit with the serialized JSON + flattened text. */
  onChange?: (json: string, text: string) => void
  placeholder?: string
}

type MathKind = 'inlineMath' | 'blockMath'

/** Transient state for the open math-edit popover. */
interface MathEditState {
  kind: MathKind
  pos: number
  latex: string
  top: number
  left: number
}

/**
 * The Notion-like block editor, built on TipTap.
 *
 * WHY this is self-contained: it owns the ProseMirror instance and translates
 * it to/from our simple `string` content contract, so the database/IPC layers
 * never learn about TipTap. Swapping editors later means changing only this
 * file. The parent remounts it via `key={note.id}` for a fresh per-note editor.
 *
 * StarterKit (v3) provides headings, lists, blockquote, code, marks, links,
 * undo/redo and Markdown input rules. We add Placeholder, Image, KaTeX math,
 * and our "/" slash command. Math nodes are click-to-edit via <MathPopover>.
 */
export function BlockEditor({
  initialContent,
  editable,
  onChange,
  placeholder = "begin typing data stream..."
}: BlockEditorProps): JSX.Element {
  const [mathEdit, setMathEdit] = useState<MathEditState | null>(null)
  // A stable indirection so the (created-once) math onClick handlers can always
  // reach the latest editor instance + setState without re-creating the editor.
  const openMathRef = useRef<(node: ProseMirrorNode, pos: number, kind: MathKind) => void>(() => {})

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Image,
      // `throwOnError: false` renders invalid LaTeX as red text instead of crashing.
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: { onClick: (node, pos) => openMathRef.current(node, pos, 'inlineMath') },
        blockOptions: { onClick: (node, pos) => openMathRef.current(node, pos, 'blockMath') }
      }),
      SlashCommand
    ],
    content: parseDocContent(initialContent),
    editable,
    editorProps: {
      attributes: {
        // `eyja-prose` carries our typographic styling (see styles/index.css).
        class: 'eyja-prose focus:outline-none'
      },
      // Save dropped/pasted images to disk via IPC and embed the returned URL.
      handleDrop: (view, event, _slice, moved) =>
        moved ? false : handleImageDrop(view, event as DragEvent),
      handlePaste: (view, event) => handleImagePaste(view, event as ClipboardEvent)
    },
    onUpdate: ({ editor }) => {
      onChange?.(JSON.stringify(editor.getJSON()), editor.getText())
    }
  })

  // Keep the editor's editability in sync with the prop.
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // Open the math popover at the clicked node (read-only editors ignore clicks).
  openMathRef.current = (node, pos, kind) => {
    if (!editor || !editable) return
    const coords = editor.view.coordsAtPos(pos)
    setMathEdit({ kind, pos, latex: node.attrs.latex ?? '', top: coords.bottom, left: coords.left })
  }

  const applyLatex = (latex: string): void => {
    if (!editor || !mathEdit) return
    setMathEdit({ ...mathEdit, latex })
    // NOTE: do NOT call .focus() here — that would steal focus from the popover
    // textarea after each keystroke. The update transaction applies regardless.
    if (mathEdit.kind === 'inlineMath') {
      editor.commands.updateInlineMath({ latex, pos: mathEdit.pos })
    } else {
      editor.commands.updateBlockMath({ latex, pos: mathEdit.pos })
    }
  }

  const deleteMath = (): void => {
    if (!editor || !mathEdit) return
    const chain = editor.chain().focus()
    if (mathEdit.kind === 'inlineMath') chain.deleteInlineMath({ pos: mathEdit.pos }).run()
    else chain.deleteBlockMath({ pos: mathEdit.pos }).run()
    setMathEdit(null)
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <EditorContent editor={editor} className="h-full" />

      {mathEdit && (
        <MathPopover
          latex={mathEdit.latex}
          top={mathEdit.top}
          left={mathEdit.left}
          onChange={applyLatex}
          onDelete={deleteMath}
          onClose={() => setMathEdit(null)}
        />
      )}
    </div>
  )
}
