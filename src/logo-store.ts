/**
 * Logo file storage on the DSH host disk.
 *
 * Layout (under the DSH home, e.g. ~/.dsh):
 *   dsh-additive/logo.<ext>     — the uploaded image bytes (one at a time)
 *   dsh-additive/logo.meta.json — { mediaType, size, updatedAt }
 *
 * The browser never writes to disk: the host validates (allowed image types
 * by magic-byte sniffing, size cap) and persists; the served path
 * `/dsh-additive/logo` is what the browser stores (in localStorage) as the
 * logo URL.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Maximum upload size: 2 MiB is plenty for a logo and bounds request buffering. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

export interface LogoMeta {
  mediaType: string
  size: number
  /** Epoch ms of the last successful upload — used as a cache-bust version. */
  updatedAt: number
  /** sha256 of the stored bytes (hex) — lets callers detect content changes. */
  sha256: string
}

export interface LogoStore {
  dir: string
  upload(bytes: Uint8Array, declaredMediaType: string | null): Promise<LogoMeta>
  read(): Promise<{ bytes: Uint8Array; meta: LogoMeta } | null>
  remove(): Promise<boolean>
}

const EXT_BY_MEDIA: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

/**
 * Sniff the actual image type from the leading bytes. Returns a media type
 * from EXT_BY_MEDIA, or null when the bytes are not a recognizable image.
 * SVG is sniffed structurally (and must not contain a <script> tag).
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const b = bytes
  // Check each signature against the bytes actually present (PNG/JPEG/GIF
  // signatures are shorter than the WEBP/AVIF boxes).
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return 'image/gif'
  }
  // WEBP: "RIFF" .... "WEBP"
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return 'image/webp'
  }
  // AVIF/HEIF: ftyp box at 4, brand avif/avis at 8
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return sniffSvg(b)
}

function sniffSvg(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.slice(0, Math.min(bytes.length, 4096))).toString('utf8')
  if (!/<svg[\s>]/i.test(head)) return null
  // Refuse scripts in stored SVG (it is served same-origin; <img> would not
  // execute it, but we do not want an executable document on disk).
  if (/<script/i.test(head)) return null
  return 'image/svg+xml'
}

function mediaByExt(ext: string): string | null {
  for (const [media, e] of Object.entries(EXT_BY_MEDIA)) if (e === ext) return media
  return null
}

export async function createLogoStore(): Promise<LogoStore> {
  const dir = dshHomePath('dsh-additive')
  await mkdir(dir, { recursive: true })

  const metaPath = join(dir, 'logo.meta.json')

  async function findCurrentFile(): Promise<string | null> {
    let meta: LogoMeta | null = null
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8')) as LogoMeta
    } catch {
      return null
    }
    if (!meta || typeof meta.mediaType !== 'string') return null
    const ext = EXT_BY_MEDIA[meta.mediaType]
    if (!ext) return null
    const p = join(dir, `logo.${ext}`)
    try {
      await stat(p)
      return p
    } catch {
      return null
    }
  }

  return {
    dir,
    async upload(bytes: Uint8Array, declaredMediaType: string | null): Promise<LogoMeta> {
      if (bytes.length === 0) throw new LogoStoreError('empty-body', 'upload body is empty')
      if (bytes.length > MAX_LOGO_BYTES) {
        throw new LogoStoreError('too-large', `logo exceeds ${MAX_LOGO_BYTES} bytes`)
      }
      const sniffed = sniffImageType(bytes)
      if (sniffed === null) {
        throw new LogoStoreError('not-an-image', 'bytes are not a recognized image type')
      }
      // A declared type, when present, must agree with the sniffed type.
      if (declaredMediaType && declaredMediaType !== sniffed) {
        throw new LogoStoreError(
          'type-mismatch',
          `declared ${declaredMediaType} but content is ${sniffed}`,
        )
      }
      const ext = EXT_BY_MEDIA[sniffed]!
      const target = join(dir, `logo.${ext}`)
      const meta: LogoMeta = {
        mediaType: sniffed,
        size: bytes.length,
        updatedAt: Date.now(),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
      await writeFile(target, bytes)
      await writeFile(metaPath, JSON.stringify(meta, null, 2))
      // Drop any stale logo.<ext> from a previous upload of a different
      // type. (Never touch logo.meta.json — it starts with "logo." too.)
      for (const name of await readdir(dir)) {
        if (
          name.startsWith('logo.') &&
          name !== 'logo.meta.json' &&
          name !== `logo.${ext}`
        ) {
          await rm(join(dir, name), { force: true })
        }
      }
      return meta
    },

    async read(): Promise<{ bytes: Uint8Array; meta: LogoMeta } | null> {
      const file = await findCurrentFile()
      if (!file) return null
      const meta = JSON.parse(await readFile(metaPath, 'utf8')) as LogoMeta
      const bytes = new Uint8Array(await readFile(file))
      return { bytes, meta }
    },

    async remove(): Promise<boolean> {
      let removed = false
      for (const name of await readdir(dir)) {
        if (name.startsWith('logo.')) {
          await rm(join(dir, name), { force: true })
          removed = true
        }
      }
      return removed
    },
  }
}

export class LogoStoreError extends Error {
  code: 'empty-body' | 'too-large' | 'not-an-image' | 'type-mismatch'
  constructor(code: LogoStoreError['code'], message: string) {
    super(message)
    this.name = 'LogoStoreError'
    this.code = code
  }
}

/** Served path (browser stores this + a ?v= cache-bust in localStorage). */
export const LOGO_SERVED_PATH = '/dsh-additive/logo'

/** Resolve the media type of a stored logo's file extension (fallback for GET). */
export function mediaTypeByExt(ext: string): string | null {
  return mediaByExt(ext)
}
