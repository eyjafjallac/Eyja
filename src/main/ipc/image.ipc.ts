import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { SaveImageInput } from '@shared/models'
import { saveImage } from '../assets/image.service'

/** Wires the `images:*` channels to the image service. */
export function registerImageIpc(): void {
  ipcMain.handle(IPC.images.save, (_event, input: SaveImageInput) => saveImage(input))
}
