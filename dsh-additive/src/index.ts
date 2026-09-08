/**
 * dsh-additive — host half.
 *
 * Registers:
 *   - the `additive` settings namespace (currently: the inputHistoryEnabled
 *     toggle; logo/brand references live in the browser's localStorage and
 *     need no host persistence)
 *   - same-origin web routes for the local logo image:
 *       POST   /dsh-additive/logo  — upload (validated, written to disk)
 *       GET    /dsh-additive/logo  — serve the stored image
 *       DELETE /dsh-additive/logo  — remove the stored image
 *
 * The image bytes live under the DSH home (e.g. ~/.dsh/dsh-additive/); the
 * browser only ever sees the served path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, DEFAULT_CONFIG, type Config as ConfigShape } from './config.js'
import {
  createLogoStore,
  LogoStoreError,
  LOGO_SERVED_PATH,
  MAX_LOGO_BYTES,
  type LogoStore,
} from './logo-store.js'

export const name = 'dsh-additive'
export { Config }

export const inject = ['settings']

export function apply(ctx: Context, entry: Partial<ConfigShape> = {}): void {
  const merged: ConfigShape = { ...DEFAULT_CONFIG, ...entry }

  // Settings plane: schema defaults < composition (cordis.patch.yml) < user
  // document (~/.dsh/settings.yaml). The browser reads the same namespace
  // through the settings mirror.
  let source: () => ConfigShape = () => merged
  installSettingsSection(ctx, settingsNamespace('additive'), Config, merged, {
    setSource: (get) => {
      source = get
    },
    onChange: () => {
      void source
    },
  })

  void registerLogoRoutes(ctx)

  ctx.logger?.info(
    '[additive] 插件已加载：设置项「Additive」已注册（历史开关 + Logo 本地存储/上传）',
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * Logo file routes
 * ════════════════════════════════════════════════════════════════════════ */

async function registerLogoRoutes(ctx: Context): Promise<void> {
  const webServer = ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.info('[additive] webServer 服务不可用（非 Web 组合），跳过 logo 路由')
    return
  }
  const store = await createLogoStore()

  webServer.register({
    kind: 'prefix',
    path: '/dsh-additive',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void handleLogoRequest(req, res, store, ctx.logger)
    },
  })
  ctx.logger?.info(
    `[additive] logo 本地存储已就绪（${store.dir}），路由 ${LOGO_SERVED_PATH} 已注册`,
  )
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(payload))
  res.end(payload)
}

/** Route handler (exported for tests). Dispatches on method + pathname. */
export async function handleLogoRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: LogoStore,
  logger: { info: (m: string) => void; warn: (m: string) => void } | undefined,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'

  // Only the single /dsh-additive/logo resource is handled here.
  if (pathname !== '/dsh-additive/logo') {
    sendJson(res, 404, { ok: false, error: 'not-found' })
    return
  }

  const method = req.method ?? 'GET'
  try {
    if (method === 'POST') {
      const { bytes, mediaType } = await readUploadBody(req)
      const meta = await store.upload(bytes, mediaType)
      logger?.info(`[additive] logo 已上传: ${meta.mediaType}, ${meta.size}B`)
      sendJson(res, 200, {
        ok: true,
        url: LOGO_SERVED_PATH,
        mediaType: meta.mediaType,
        size: meta.size,
        version: meta.updatedAt,
        sha256: meta.sha256,
      })
    } else if (method === 'GET') {
      const current = await store.read()
      if (!current) {
        sendJson(res, 404, { ok: false, error: 'no-logo' })
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', current.meta.mediaType)
      // Content changes on upload; the client also appends ?v=<updatedAt>.
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Additive-Logo-Version', String(current.meta.updatedAt))
      res.setHeader('Content-Length', String(current.bytes.length))
      res.end(Buffer.from(current.bytes))
    } else if (method === 'DELETE') {
      const removed = await store.remove()
      logger?.info(`[additive] logo 已删除: ${removed ? '是' : '（本来就不存在）'}`)
      sendJson(res, 200, { ok: true, removed })
    } else {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
    }
  } catch (error) {
    if (error instanceof LogoStoreError) {
      const status =
        error.code === 'too-large'
          ? 413
          : error.code === 'type-mismatch' ||
              error.code === 'not-an-image' ||
              error.code === 'empty-body'
            ? 415
            : 400
      sendJson(res, status, { ok: false, error: error.code, message: error.message })
      return
    }
    logger?.warn(`[additive] logo 请求处理失败: ${String(error)}`)
    sendJson(res, 500, { ok: false, error: 'internal' })
  }
}

/** Buffer the request body with a hard size cap; capture its content type. */
async function readUploadBody(
  req: IncomingMessage,
): Promise<{ bytes: Uint8Array; mediaType: string | null }> {
  const mediaType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() || null
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of req) {
      total += (chunk as Buffer).length
      if (total > MAX_LOGO_BYTES + 64 * 1024) {
        // Stop buffering well past the cap — the store will reject it.
        throw new LogoStoreError('too-large', `logo exceeds ${MAX_LOGO_BYTES} bytes`)
      }
      chunks.push(Buffer.from(chunk as Uint8Array))
    }
  } catch (error) {
    if (error instanceof LogoStoreError) throw error
    throw new LogoStoreError('empty-body', 'unreadable request body')
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), mediaType }
}
