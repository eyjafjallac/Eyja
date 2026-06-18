import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Image handling for the block editor.
 *
 * The flow respects context isolation: the renderer only reads the file bytes,
 * then hands them to the main process (`window.api.images.save`), which writes
 * them to disk and returns an `eyja-asset://` URL. We insert an image node
 * pointing at that URL — the bytes never live in the document/DB.
 */

/** Keep only image files from a FileList. */
function imageFilesFrom(list: FileList | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((file) => file.type.startsWith('image/'))
}

/** Derive a safe-ish extension from the MIME type or filename. */
function extensionOf(file: File): string {
  const fromMime = file.type.split('/')[1]
  const fromName = file.name.includes('.') ? file.name.split('.').pop() : undefined
  return (fromMime || fromName || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Persist each file via IPC, then insert all resulting image nodes in a single
 * transaction starting at `pos` (so ordering is preserved even for multi-drop).
 */
async function insertImages(view: EditorView, files: File[], pos: number): Promise<void> {
  const imageType = view.state.schema.nodes.image
  if (!imageType) return

  const nodes = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const src = await window.api.images.save({ bytes, ext: extensionOf(file) })
      return imageType.create({ src })
    })
  )

  const tr = view.state.tr
  let insertAt = pos
  for (const node of nodes) {
    tr.insert(insertAt, node)
    insertAt += node.nodeSize
  }
  view.dispatch(tr)
}

/**
 * ProseMirror `handleDrop`. Returns true when we handled an image drop so the
 * editor doesn't also try to insert the file as text.
 */
export function handleImageDrop(view: EditorView, event: DragEvent): boolean {
  const files = imageFilesFrom(event.dataTransfer?.files)
  if (files.length === 0) return false

  event.preventDefault()
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
  const pos = coords?.pos ?? view.state.selection.from
  void insertImages(view, files, pos)
  return true
}

/** ProseMirror `handlePaste` for pasted image data. */
export function handleImagePaste(view: EditorView, event: ClipboardEvent): boolean {
  const files = imageFilesFrom(event.clipboardData?.files)
  if (files.length === 0) return false

  event.preventDefault()
  void insertImages(view, files, view.state.selection.from)
  return true
}

/** Opens a native file picker and inserts the chosen image(s). Used by "/image". */
export function pickAndInsertImages(editor: Editor): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = (): void => {
    const files = imageFilesFrom(input.files)
    if (files.length > 0) {
      void insertImages(editor.view, files, editor.state.selection.from)
    }
  }
  input.click()
}
