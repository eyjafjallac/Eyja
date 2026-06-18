import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'
import { SlashCommandMenu, type SlashCommandMenuRef } from './SlashCommandMenu'
import { getSlashCommandItems, type SlashCommandItem } from './slash-command-items'

/**
 * The "/" slash command extension.
 *
 * It glues three pieces together:
 *  1. `@tiptap/suggestion` detects the "/" trigger and the query after it.
 *  2. `getSlashCommandItems(query)` supplies the filtered command list.
 *  3. A `ReactRenderer` mounts <SlashCommandMenu> as a floating popup.
 *
 * The popup is positioned manually from the caret rect (no tippy/floating-ui
 * dependency) and flips above the caret when there's no room below.
 */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: '/',
        // Only trigger at the start of an empty block or after whitespace, like Notion.
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => getSlashCommandItems(query),
        // The selected item's own command performs the edit.
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: createSuggestionRenderer
      })
    ]
  }
})

/** Builds the lifecycle object the suggestion utility drives. */
function createSuggestionRenderer(): ReturnType<NonNullable<SuggestionOptions['render']>> {
  let component: ReactRenderer<SlashCommandMenuRef> | null = null
  let popup: HTMLDivElement | null = null

  const reposition = (getRect?: (() => DOMRect | null) | null): void => {
    if (!popup || !getRect) return
    const rect = getRect()
    if (!rect) return

    const menuHeight = popup.offsetHeight
    const spaceBelow = window.innerHeight - rect.bottom
    // Flip above the caret if the menu wouldn't fit below it.
    const top = spaceBelow < menuHeight + 12 ? rect.top - menuHeight - 6 : rect.bottom + 6

    popup.style.left = `${rect.left}px`
    popup.style.top = `${Math.max(8, top)}px`
  }

  return {
    onStart: (props) => {
      component = new ReactRenderer(SlashCommandMenu, { props, editor: props.editor })
      popup = document.createElement('div')
      popup.style.position = 'fixed'
      popup.style.zIndex = '50'
      popup.appendChild(component.element)
      document.body.appendChild(popup)
      reposition(props.clientRect)
    },

    onUpdate: (props) => {
      component?.updateProps(props)
      reposition(props.clientRect)
    },

    onKeyDown: (props) => {
      if (props.event.key === 'Escape') return true
      return component?.ref?.onKeyDown(props.event) ?? false
    },

    onExit: () => {
      popup?.remove()
      component?.destroy()
      popup = null
      component = null
    }
  }
}
