import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SaveImageInput } from '@shared/models'
import { ASSET_HOST, ASSET_SCHEME, assetsDir } from './assetProtocol'

// Only allow a short alphanumeric extension; otherwise fall back to png.
const SAFE_EXT = /^[a-z0-9]{1,8}$/

/**
 * Writes image bytes to the per-user assets dir and returns a URL that the
 * custom protocol can serve. Filenames are random UUIDs so user-supplied names
 * can never cause collisions or path issues.
 */
export async function saveImage({ bytes, ext }: SaveImageInput): Promise<string> {
  const dir = assetsDir()
  await mkdir(dir, { recursive: true })

  const safeExt = SAFE_EXT.test(ext) ? ext : 'png'
  const fileName = `${randomUUID()}.${safeExt}`
  await writeFile(join(dir, fileName), Buffer.from(bytes))

  return `${ASSET_SCHEME}://${ASSET_HOST}/${fileName}`
}
