/**
 * dsh-additive — browser half (single self-contained bundle).
 *
 * Three pieces of behaviour, all gated behind the `additive` settings namespace:
 *
 *  1. A new Settings section called "Additive" where the user can configure
 *     the custom logo URL, custom brand wordmark, and toggle input history.
 *
 *  2. Conditional slot registrations for `sidebar.brand.mark` /
 *     `sidebar.brand.name` / `conversation.hero.brand.mark` — registered only
 *     when the matching config field is non-empty, so leaving a field blank
 *     falls through to the official DeepSeek brand. Slots are re-registered
 *     live when the user saves a new value (no reload required).
 *
 *  3. ↑/↓ history navigation for the chat composer, gated by
 *     `inputHistoryEnabled`. Uses DOM capture on the composer textarea and
 *     the React-18-safe value-setter hack; handles IME composition, trigger
 *     menus (slash commands), multi-line caret positions, and per-textarea
 *     stack isolation.
 *
 * NOTE: All cross-plugin services are reached through the cordis inject
 * face — this file never value-imports another @deepseek-ai/* package.
 * (The empty-name wordmark is a local re-render of the official "deepseek"
 * lettering paths, without the HARNESS pill the official component bakes
 * into its SVG — see DeepSeekWordmark.)
 * React is the only allowed peer import (jsx-runtime is a platform external).
 */
import React from 'react'
import DEFAULT_LOGO_B64 from '../../assets/dsh-launcher-logo.png'

/* ════════════════════════════════════════════════════════════════════════
 * Built-in default brand — this plugin ships together with DSH Launcher, so
 * the default identity is DSH Launcher (logo bundled into this file as
 * base64). Brand name defaults to EMPTY: the sidebar keeps the official
 * DeepSeek wordmark, and only the version badge is branded "Launcher".
 * Custom values from localStorage override.
 * ════════════════════════════════════════════════════════════════════════ */

const DEFAULT_LOGO_URI = `data:image/png;base64,${DEFAULT_LOGO_B64}`
const DEFAULT_BRAND_NAME = '' // empty → keep the official DeepSeek wordmark
const DEFAULT_BRAND_VERSION = 'Launcher'

/* ════════════════════════════════════════════════════════════════════════
 * Structural types (mirrors of the dsh client contracts — no value imports)
 * ════════════════════════════════════════════════════════════════════════ */

/** Host-persisted config (settings document, mirrored to the browser). */
interface InputHistoryConfig {
  inputHistoryEnabled: boolean
}

/** Client-local brand state (browser localStorage). */
interface BrandState {
  logoUrl: string
  brandName: string
  brandVersion: string
}

interface ScopeSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: InputHistoryConfig | undefined
  base: unknown
  user: unknown
  revision: number | undefined
  writable: boolean
  mode: 'host' | 'memory'
}

interface SettingsScope {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

interface DescribeSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  view:
    | {
        writable: boolean
        hasDocument: boolean
        namespaces: ReadonlyArray<{
          ns: string
          secrets: ReadonlyArray<{ path: string[]; set: boolean }>
        }>
      }
    | undefined
  error: string | null
}

interface DescribeFace {
  getSnapshot(): DescribeSnapshot
  subscribe(listener: () => void): () => void
}

interface SlotRegisterOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  inject?: () => Record<string, unknown>
  priority?: number
}

interface SlotsService {
  inject(key: string, fn: () => Iterable<unknown> | unknown): unknown
  register(opts: SlotRegisterOptions, component: unknown): () => void
  entries(key: string): Array<{ options: Record<string, unknown> }>
  entriesOfSlot(key: string): Array<unknown>
  spec(key: string): { kind: string; scope: string } | undefined
  subscribe(key: string, fn: () => void): () => void
  getVersion(key: string): number
}

export const inject = ['slots', 'settingsScope']

/* ════════════════════════════════════════════════════════════════════════
 * apply
 * ════════════════════════════════════════════════════════════════════════ */

export function apply(ctx: {
  slots: SlotsService
  settingsScope: {
    bind(spec: { namespace: string }): SettingsScope
    describe(): DescribeFace
  }
}): void {
  const scope = ctx.settingsScope.bind({ namespace: 'additive' })
  const brand = createBrandStore()

  // ── Settings page: "Additive" ────────────────────────────────────────
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'additive',
        order: 50,
        label: () => 'Additive',
        inject: () => ({ scope, brand }),
      },
      AdditiveSettingsSection as unknown as React.ComponentType<unknown>,
    ),
  )

  // ── Live sync: logo slots (localStorage) + history wiring (settings) ─
  syncLogoSlots(ctx.slots, brand)
  syncHistoryWiring(scope)
}

/* ════════════════════════════════════════════════════════════════════════
 * Config readers
 * ════════════════════════════════════════════════════════════════════════ */

function readHistoryConfig(scope: SettingsScope): InputHistoryConfig {
  const snap = scope.getSnapshot()
  if (snap.status !== 'ready' || !snap.value) {
    return { inputHistoryEnabled: false }
  }
  return { inputHistoryEnabled: !!snap.value.inputHistoryEnabled }
}

/* ════════════════════════════════════════════════════════════════════════
 * Brand store — localStorage (client-local, like the input-history records)
 *
 * The logo URL + brand name persist in the browser's localStorage, restored
 * on every page load. The uploaded image bytes themselves live on the host
 * disk and are referenced by the served path /dsh-additive/logo (with a
 * ?v=<updatedAt> cache-bust appended at upload time).
 * ════════════════════════════════════════════════════════════════════════ */

const BRAND_KEYS = {
  logoUrl: 'dsh-additive:brand.logoUrl',
  brandName: 'dsh-additive:brand.brandName',
  brandVersion: 'dsh-additive:brand.version',
} as const

export interface BrandStore {
  get(): BrandState
  set(field: keyof BrandState, value: string): void
  subscribe(listener: () => void): () => void
}

/** localStorage with an in-memory fallback (private mode / storage disabled). */
function storageGet(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return (memoryStore.get(key) as string | undefined) ?? ''
  }
}
function storageSet(key: string, value: string): void {
  if (value === '') {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* fall through */
    }
    memoryStore.delete(key)
    return
  }
  try {
    window.localStorage.setItem(key, value)
  } catch {
    memoryStore.set(key, value)
  }
}
const memoryStore = new Map<string, string>()

function createBrandStore(): BrandStore {
  const listeners = new Set<() => void>()
  const get = (): BrandState => ({
    logoUrl: storageGet(BRAND_KEYS.logoUrl).trim(),
    brandName: storageGet(BRAND_KEYS.brandName).trim(),
    brandVersion: storageGet(BRAND_KEYS.brandVersion).trim(),
  })
  const notify = (): void => {
    for (const fn of [...listeners]) {
      try {
        fn()
      } catch {
        /* listener errors must not break the store */
      }
    }
  }
  const onStorageEvent = (e: StorageEvent): void => {
    if (
      e.key === BRAND_KEYS.logoUrl ||
      e.key === BRAND_KEYS.brandName ||
      e.key === BRAND_KEYS.brandVersion
    )
      notify()
  }
  window.addEventListener('storage', onStorageEvent)
  return {
    get,
    set(field, value) {
      storageSet(BRAND_KEYS[field], value.trim())
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Resolve the brand actually shown: user overrides from localStorage first,
 * then built-in defaults. The brand name intentionally stays empty by
 * default (keeps the official DeepSeek wordmark); the badge always resolves
 * to a non-empty value ("Launcher").
 */
function effectiveBrand(state: BrandState): BrandState {
  return {
    logoUrl: state.logoUrl.trim() || DEFAULT_LOGO_URI,
    // Empty by default on purpose: the name slot then renders the official
    // DeepSeek wordmark (see CustomName).
    brandName: state.brandName.trim() || DEFAULT_BRAND_NAME,
    brandVersion: state.brandVersion.trim() || DEFAULT_BRAND_VERSION,
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Settings page component
 * ════════════════════════════════════════════════════════════════════════ */

const STYLES = {
  page: { display: 'flex', flexDirection: 'column' as const, gap: 12, padding: '2px 0' },
  header: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  title: { margin: 0, fontSize: 15, fontWeight: 700 },
  subtitle: { fontSize: 12, color: '#656d76' },
  group: { border: '1px solid #d0d7de', borderRadius: 8, background: '#fff' },
  groupHead: {
    padding: '8px 12px',
    borderBottom: '1px solid #eaeef2',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
  },
  groupTitle: { fontSize: 13, fontWeight: 700 },
  groupNote: { fontSize: 11, color: '#656d76' },
  groupBody: { padding: '4px 12px 10px' },
  row: {
    display: 'grid',
    gridTemplateColumns: '200px 1fr',
    gap: 10,
    padding: '6px 0',
    alignItems: 'start',
  },
  label: { fontSize: 12, paddingTop: 3, display: 'flex', alignItems: 'center', gap: 5 },
  hint: { fontSize: 11, color: '#8c959f', marginTop: 3 },
  input: {
    boxSizing: 'border-box' as const,
    width: '100%',
    maxWidth: 420,
    border: '1px solid #d0d7de',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 12,
    background: '#fff',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  } as React.CSSProperties,
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingTop: 3,
    fontSize: 12,
  },
  metaLine: { fontSize: 11, color: '#656d76' } as React.CSSProperties,
}

interface SectionProps {
  close: () => void
  scope: SettingsScope
  brand: BrandStore
}

/** Reactive host settings snapshot (inputHistoryEnabled). */
function useHistoryConfig(scope: SettingsScope): InputHistoryConfig {
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => scope.subscribe(force), [scope])
  return readHistoryConfig(scope)
}

/** Reactive localStorage brand state. */
function useBrand(brand: BrandStore): BrandState {
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => brand.subscribe(force), [brand])
  return brand.get()
}

function AdditiveSettingsSection(props: SectionProps): React.ReactElement {
  const { scope, brand } = props
  const history = useHistoryConfig(scope)
  const brandState = useBrand(brand)
  const [uploadError, setUploadError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  const isLocalLogo = brandState.logoUrl.startsWith('/dsh-additive/logo')

  const onUploadFile = async (file: File): Promise<void> => {
    setUploadError(null)
    if (!file.type.startsWith('image/')) {
      setUploadError('仅支持图片文件（PNG / JPG / WebP / GIF / SVG / AVIF）')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('图片超过 2MB 限制，请压缩后再上传')
      return
    }
    setUploading(true)
    try {
      const res = await fetch('/dsh-additive/logo', { method: 'POST', body: file })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        url?: string
        version?: number
        message?: string
      } | null
      if (!res.ok || !data?.ok || !data.url || typeof data.version !== 'number') {
        throw new Error(data?.message || `上传失败（HTTP ${res.status}）`)
      }
      // ?v= cache-bust so the <img> refetches after every re-upload.
      brand.set('logoUrl', `${data.url}?v=${data.version}`)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const onDeleteLogo = async (): Promise<void> => {
    setUploadError(null)
    try {
      await fetch(brandState.logoUrl, { method: 'DELETE' }).catch(() => {})
      brand.set('logoUrl', '')
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={STYLES.page}>
      <div style={STYLES.header}>
        <h2 style={STYLES.title}>Additive（DSH便捷功能扩展）</h2>
      </div>

      {/* ── Logo & Brand ─────────────────────────────────────────── */}
      <div style={STYLES.group}>
        <div style={STYLES.groupHead}>
          <span style={STYLES.groupTitle}>品牌自定义</span>
        </div>
        <div style={STYLES.groupBody}>
          {/* Upload local image */}
          <div style={STYLES.row}>
            <div style={STYLES.label}>上传本地图片</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void onUploadFile(f)
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  style={{
                    border: '1px solid #8250df',
                    background: uploading ? '#c2a4f0' : '#8250df',
                    color: '#fff',
                    borderRadius: 6,
                    padding: '3px 10px',
                    fontSize: 12,
                    cursor: uploading ? 'default' : 'pointer',
                  }}
                >
                  {uploading ? '上传中…' : isLocalLogo ? '重新上传' : '上传图片'}
                </button>
                {isLocalLogo && (
                  <button
                    type="button"
                    onClick={() => void onDeleteLogo()}
                    style={{
                      border: '1px solid #d0d7de',
                      background: '#fff',
                      color: '#cf222e',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    删除本地图片
                  </button>
                )}
              </div>
              <div style={STYLES.hint}>
                {isLocalLogo
                  ? '当前 Logo 来自本机图片（磁盘存储，路径 /dsh-additive/logo）。'
                  : '支持 PNG / JPG / WebP / GIF / SVG / AVIF，≤ 2MB。'}
              </div>
              {uploadError && (
                <div style={{ fontSize: 11, color: '#cf222e', marginTop: 3 }}>{uploadError}</div>
              )}
            </div>
          </div>

          <TextFieldRow
            label="品牌名称"
            hint="显示在 Logo 旁边的文字；留空 = 保留 DeepSeek 标识。"
            value={brandState.brandName}
            placeholder="MyBrand"
            onChange={(v) => brand.set('brandName', v)}
          />
          <TextFieldRow
            label="版本号（徽章）"
            hint="显示在品牌名后的深色徽章；留空 = Launcher。"
            value={brandState.brandVersion}
            placeholder="Launcher"
            onChange={(v) => brand.set('brandVersion', v)}
          />
          {(() => {
            const eff = effectiveBrand(brandState)
            return (
              <>
                <div style={{ ...STYLES.row, alignItems: 'center' }}>
                  <div style={STYLES.label}>预览</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LogoPreview logoUrl={eff.logoUrl} brandName={eff.brandName} version={eff.brandVersion} />
                  </div>
                </div>
                <div style={{ ...STYLES.metaLine, marginTop: 4 }}>
                  当前显示：{eff.brandName ? `“${eff.brandName}”` : 'DeepSeek 标识（默认）'} ·{' '}
                  徽章“{eff.brandVersion}”（品牌配置存于浏览器 localStorage）
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* ── Input History ────────────────────────────────────────── */}
      <div style={STYLES.group}>
        <div style={STYLES.groupHead}>
          <span style={STYLES.groupTitle}>输入框历史回溯</span>
        </div>
        <div style={STYLES.groupBody}>
          <div style={STYLES.row}>
            <div style={STYLES.label}>启用 ↑/↓ 历史</div>
            <label style={STYLES.checkRow}>
              <input
                type="checkbox"
                checked={history.inputHistoryEnabled}
                onChange={(e) => scope.set('inputHistoryEnabled', e.target.checked)}
              />
              <span>{history.inputHistoryEnabled ? '已启用' : '已关闭'}</span>
            </label>
          </div>
          {history.inputHistoryEnabled && (
            <div style={{ ...STYLES.metaLine, marginTop: 4 }}>
              提示：历史消息记录保存在前端内存中，刷新页面后清空（v0.1 不做持久化）。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TextFieldRow(props: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}): React.ReactElement {
  const { label, hint, value, placeholder, onChange } = props
  const [draft, setDraft] = React.useState(value)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setDraft(value), [value])
  const changed = draft.trim() !== (value ?? '').trim()
  const save = async (): Promise<void> => {
    if (!changed || busy) return
    setBusy(true)
    try {
      await onChange(draft.trim())
    } finally {
      setBusy(false)
    }
  }
  const reset = (): void => setDraft(value)
  return (
    <div style={STYLES.row}>
      <div style={STYLES.label}>
        {changed && <span title="有未保存的修改" style={{ color: '#0969da' }}>●</span>}
        <span>{label}</span>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            style={STYLES.input}
            type="text"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') reset()
            }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={!changed || busy}
            style={{
              border: '1px solid #0969da',
              background: changed ? '#0969da' : '#94c7f4',
              color: '#fff',
              borderRadius: 6,
              padding: '3px 10px',
              fontSize: 12,
              cursor: changed && !busy ? 'pointer' : 'default',
            }}
          >
            {busy ? '保存中…' : '保存'}
          </button>
          {changed && (
            <button
              type="button"
              onClick={reset}
              style={{
                border: '1px solid #d0d7de',
                background: '#fff',
                borderRadius: 6,
                padding: '3px 8px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              重置
            </button>
          )}
        </div>
        {hint && <div style={STYLES.hint}>{hint}</div>}
      </div>
    </div>
  )
}

function LogoPreview(props: { logoUrl: string; brandName: string; version?: string }): React.ReactElement {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        border: '1px dashed #d0d7de',
        borderRadius: 8,
        background: '#f6f8fa',
        minHeight: 36,
      }}
    >
      {props.logoUrl ? (
        <img
          src={props.logoUrl}
          width={24}
          height={24}
          alt="logo preview"
          style={{ borderRadius: 4, objectFit: 'contain', display: 'block' }}
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.opacity = '0.3'
          }}
        />
      ) : (
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            background: '#d0d7de',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: '#fff',
          }}
          title="留空 → 使用官方 Logo"
        >
          D
        </span>
      )}
      {props.brandName.trim() ? (
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.04em' }}>
          {props.brandName.trim()}
        </span>
      ) : (
        <DeepSeekWordmark size={16} />
      )}
      {props.version ? <VersionBadge version={props.version} /> : null}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
 * Logo slot synchronisation
 *
 * Registers sidebar.brand.mark / sidebar.brand.name /
 * conversation.hero.brand.mark only when the matching config field is
 * non-empty. Subscriptions re-run on every settings change: disposing the
 * old registration lets the official brand win again (falls through to
 * the fish/wordmark fallback) whenever the user clears a field.
 * ════════════════════════════════════════════════════════════════════════ */

interface BrandMarkProps {
  size: number
  className?: string
}

interface BrandNameProps {
  children?: never
}

function CustomMark(logoUrl: string): React.FC<BrandMarkProps> {
  return function CustomMarkImpl({ size, className }: BrandMarkProps) {
    const [failed, setFailed] = React.useState(false)
    if (failed) {
      // Broken image (e.g. the local file was removed): show a neutral
      // placeholder instead of a broken-image glyph.
      return (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            border: '1px dashed #d0d7de',
            background: '#f6f8fa',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(8, size * 0.4),
            color: '#8c959f',
          }}
          title="Logo 加载失败"
        >
          !
        </span>
      )
    }
    return (
      <img
        src={logoUrl}
        width={size}
        height={size}
        className={className}
        alt="custom logo"
        style={{
          borderRadius: 4,
          objectFit: 'contain',
          display: 'block',
        }}
        onError={() => setFailed(true)}
      />
    )
  }
}

/**
 * Small dark pill badge in the native "HARNESS" wordmark-badge style
 * (deep background, light code-font text, tight padding, rounded corners).
 */
function VersionBadge(props: { version: string }): React.ReactElement {
  return (
    <span
      title={`版本 ${props.version}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        flex: 'none',
        height: 14,
        padding: '0 5px',
        borderRadius: 3,
        background: 'var(--dsw-alias-label-primary, #1a1d21)',
        color: 'var(--dsw-alias-label-primary-inverted, #ffffff)',
        fontFamily:
          'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: '0.08em',
        lineHeight: '14px',
        whiteSpace: 'nowrap',
      }}
    >
      {props.version}
    </span>
  )
}

/**
 * "deepseek" lettering only — the 9 character paths extracted from the
 * official `BrandWordmark` artwork (dsh-web-frontend 0.1.2-rc.1, viewBox
 * region x∈[26,122]). The official component bakes the HARNESS pill into the
 * same SVG and exposes no prop to hide it, so an EMPTY brand name renders
 * this wordmark plus the plugin's own version badge; a custom name renders
 * plain text instead. Tinted with `currentColor`, exactly like the official.
 */
const WORDMARK_PATHS = [
  'M68.416 18.2447H67.0501V16.1272H68.416C69.2619 16.1272 70.1166 15.9163 70.6671 15.3304C71.2181 14.7444 71.426 13.8455 71.426 12.9471C71.426 12.0487 71.2268 11.1498 70.6671 10.5643C70.1083 9.97831 69.2619 9.76744 68.416 9.76744C67.5701 9.76744 66.7154 9.97831 66.1639 10.5643C65.6129 11.1503 65.4049 12.0487 65.4049 12.9471V21.6435H63.009V7.6582H65.4049V8.54883H65.8442C65.8918 8.49393 65.9394 8.44728 65.9875 8.40064C66.5871 7.85353 67.5049 7.6582 68.4072 7.6582C69.8212 7.6582 71.2341 8.00998 72.1607 8.98662C73.0868 9.96325 73.4143 11.4632 73.4143 12.9558C73.4143 14.4485 73.0785 15.9406 72.1607 16.925C71.2424 17.9094 69.8212 18.2457 68.416 18.2457V18.2447Z',
  'M31.9551 8.03497H33.3204V10.1525H31.9551C31.1087 10.1525 30.2545 10.3633 29.7035 10.9493C29.1525 11.5353 28.945 12.4342 28.945 13.3326C28.945 14.231 29.1447 15.1294 29.7035 15.7154C30.2623 16.3014 31.1087 16.5122 31.9551 16.5122C32.8015 16.5122 33.6562 16.3014 34.2072 15.7154C34.7582 15.1294 34.9657 14.231 34.9657 13.3326V4.62842H37.3611V18.6219H34.9657V17.7313H34.5264C34.4783 17.7857 34.4307 17.8329 34.3826 17.8795C33.7835 18.4261 32.8652 18.6219 31.9629 18.6219C30.5494 18.6219 29.136 18.2707 28.2099 17.294C27.2838 16.3174 26.9563 14.817 26.9563 13.3248C26.9563 11.8327 27.2916 10.34 28.2099 9.35561C29.136 8.37898 30.5494 8.03497 31.9551 8.03497Z',
  'M49.3786 13.1431V13.9948H42.9984V12.2996H47.2305C47.1348 11.6825 46.9113 11.1043 46.5119 10.682C45.9371 10.0727 45.0503 9.85409 44.1723 9.85409C43.2943 9.85409 42.4076 10.0727 41.8328 10.682C41.258 11.2913 41.05 12.2213 41.05 13.1435C41.05 14.0658 41.2575 15.003 41.8328 15.6046C42.4076 16.2061 43.2939 16.433 44.1723 16.433C45.0508 16.433 45.9371 16.2143 46.5119 15.6046C46.5916 15.5186 46.6635 15.4248 46.7354 15.331H49.0992C48.8918 16.0657 48.5643 16.7299 48.0691 17.2454C47.111 18.2531 45.6339 18.6205 44.1723 18.6205C42.7108 18.6205 41.2337 18.2609 40.2755 17.2454C39.3174 16.2299 38.9661 14.6828 38.9661 13.1435C38.9661 11.6043 39.3096 10.0494 40.2755 9.04168C41.242 8.03396 42.7108 7.66663 44.1723 7.66663C45.6339 7.66663 47.111 8.02618 48.0691 9.04168C49.0351 10.0572 49.3786 11.6043 49.3786 13.1435V13.1431Z',
  'M61.4045 13.1431V13.9948H55.0243V12.2996H59.2564C59.1602 11.6825 58.9372 11.1043 58.5378 10.682C57.963 10.0727 57.0762 9.85409 56.1982 9.85409C55.3202 9.85409 54.4335 10.0727 53.8587 10.682C53.2839 11.2913 53.0759 12.2213 53.0759 13.1435C53.0759 14.0658 53.2834 15.003 53.8587 15.6046C54.4335 16.2061 55.3202 16.433 56.1982 16.433C57.0762 16.433 57.963 16.2143 58.5378 15.6046C58.6179 15.5186 58.6894 15.4248 58.7608 15.331H61.1251C60.9171 16.0657 60.5897 16.7299 60.0945 17.2454C59.1364 18.2531 57.6593 18.6205 56.1982 18.6205C54.7372 18.6205 53.2596 18.2609 52.3014 17.2454C51.3432 16.2299 50.9919 14.6828 50.9919 13.1435C50.9919 11.6043 51.3355 10.0494 52.3014 9.04168C53.2678 8.03396 54.7367 7.66663 56.1982 7.66663C57.6598 7.66663 59.1364 8.02618 60.0945 9.04168C61.061 10.0572 61.4045 11.6043 61.4045 13.1435V13.1431Z',
  'M80.242 18.6214C81.7035 18.6214 83.1801 18.4105 84.1383 17.809C85.0965 17.2075 85.4482 16.2931 85.4482 15.3869C85.4482 14.4807 85.1042 13.5585 84.1383 12.9647C83.1801 12.371 81.703 12.1518 80.242 12.1518C79.6186 12.1518 79.0438 12.0658 78.6366 11.8394C78.2294 11.6047 78.0778 11.2534 78.0778 10.9017C78.0778 10.5499 78.2216 10.1908 78.6366 9.9639C79.0438 9.72921 79.6749 9.65147 80.2973 9.65147C80.9198 9.65147 81.5509 9.73747 81.9591 9.9639C82.3663 10.1986 82.5179 10.5499 82.5179 10.9017H84.9531C84.9531 9.99499 84.6421 9.07327 83.7719 8.47951C82.9017 7.88576 81.5679 7.66663 80.2424 7.66663C78.9169 7.66663 77.5837 7.8775 76.713 8.47951C75.8427 9.08104 75.5308 9.99499 75.5308 10.9017C75.5308 11.8083 75.8423 12.73 76.713 13.3238C77.5832 13.9176 78.9165 14.1367 80.2424 14.1367C80.929 14.1367 81.688 14.2227 82.1428 14.4491C82.5985 14.676 82.7579 15.0351 82.7579 15.3869C82.7579 15.7387 82.5985 16.0977 82.1428 16.3246C81.688 16.5511 80.9931 16.6371 80.3066 16.6371C79.62 16.6371 78.9169 16.5511 78.4694 16.3246C78.0224 16.0982 77.8543 15.7387 77.8543 15.3869H75.0435C75.0435 16.2935 75.3865 17.2153 76.3534 17.809C77.3194 18.4028 78.7809 18.6214 80.2424 18.6214H80.242Z',
  'M97.4733 13.1431V13.9948H91.0932V12.2996H95.3252C95.23 11.6825 95.006 11.1043 94.6071 10.682C94.0313 10.0727 93.1456 9.85409 92.2666 9.85409C91.3876 9.85409 90.5018 10.0727 89.927 10.682C89.3522 11.2913 89.1452 12.2213 89.1452 13.1435C89.1452 14.0658 89.3522 15.003 89.927 15.6046C90.5018 16.2061 91.3886 16.433 92.2666 16.433C93.1446 16.433 94.0313 16.2143 94.6071 15.6046C94.6863 15.5186 94.7587 15.4248 94.8301 15.331H97.1935C96.9855 16.0657 96.6585 16.7299 96.1639 17.2454C95.2057 18.2531 93.7281 18.6205 92.2666 18.6205C90.805 18.6205 89.3284 18.2609 88.3703 17.2454C87.4121 16.2299 87.0613 14.6828 87.0613 13.1435C87.0613 11.6043 87.4043 10.0494 88.3703 9.04168C89.3367 8.03396 90.806 7.66663 92.2666 7.66663C93.7272 7.66663 95.2057 8.02618 96.1639 9.04168C97.1298 10.0572 97.4729 11.6043 97.4729 13.1435L97.4733 13.1431Z',
  'M109.499 13.1431V13.9948H103.119V12.2996H107.351C107.256 11.6825 107.032 11.1043 106.632 10.682C106.057 10.0727 105.172 9.85409 104.293 9.85409C103.414 9.85409 102.528 10.0727 101.953 10.682C101.378 11.2913 101.17 12.2213 101.17 13.1435C101.17 14.0658 101.378 15.003 101.953 15.6046C102.528 16.2061 103.415 16.433 104.293 16.433C105.171 16.433 106.057 16.2143 106.632 15.6046C106.712 15.5186 106.784 15.4248 106.856 15.331H109.22C109.012 16.0657 108.685 16.7299 108.19 17.2454C107.231 18.2531 105.754 18.6205 104.293 18.6205C102.831 18.6205 101.355 18.2609 100.396 17.2454C99.4382 16.2299 99.0864 14.6828 99.0864 13.1435C99.0864 11.6043 99.4295 10.0494 100.396 9.04168C101.362 8.03396 102.832 7.66663 104.293 7.66663C105.754 7.66663 107.231 8.02618 108.19 9.04168C109.156 10.0572 109.499 11.6043 109.499 13.1435V13.1431Z',
  'M113.5 4.62817H111.104V18.6217H113.5V4.62817Z',
  'M117.589 12.8154L121.517 18.6208H118.554L114.625 12.8154L118.554 8.15088H121.517L117.589 12.8154Z',
] as const

/** The official "deepseek" lettering without the HARNESS pill. */
function DeepSeekWordmark(props: { size?: number; className?: string }): React.ReactElement {
  const size = props.size ?? 24
  return (
    <svg
      width={(size * 96) / 24}
      height={size}
      viewBox="26 0 96 24"
      fill="none"
      aria-hidden="true"
      className={props.className}
      style={{ flex: 'none', display: 'inline-block', verticalAlign: 'middle' }}
    >
      {WORDMARK_PATHS.map((d) => (
        <path key={d.slice(0, 20)} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}

function CustomName(name: string, version: string): React.FC<BrandNameProps> {
  return function CustomNameImpl() {
    const trimmed = name.trim()
    return (
      <>
        {trimmed ? (
          <span
            style={{
              letterSpacing: '0.04em',
              fontSize: 18,
              fontWeight: 600,
              lineHeight: '24px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {trimmed}
          </span>
        ) : (
          // Empty brand name → keep the official DeepSeek lettering (no
          // HARNESS pill — that region belongs to our version badge).
          <DeepSeekWordmark size={24} />
        )}
        {version ? <VersionBadge version={version} /> : null}
      </>
    )
  }
}

/**
 * Bind one "register a slot only while the relevant config field is
 * non-empty" lifecycle under a slot declaration. `slots.inject` waits until
 * the declaring entry (sidebar / conversation) has declared the slot, so we
 * never race the boot order. Inside, we subscribe to the settings scope and
 * (re)register / dispose on every change; the disposer returned from the
 * inject callback is collected when the plugin's fiber unloads, so nothing
 * leaks.
 *
 * PRIORITY: boot-path packages register with priority 0 by default, and the
 * slot core throws when two entries share a priority on a single slot. The
 * official brand registers these slots at priority 0, so we pass an explicit
 * negative priority — the slot core renders the LOWEST priority first, which
 * makes our override win while the official brand stays as the fallback once
 * our registration is disposed (config cleared).
 */
const BRAND_OVERRIDE_PRIORITY = -1

function bindConditionalSlot(
  slots: SlotsService,
  slotName: string,
  brand: BrandStore,
  makeComponent: (state: BrandState) => React.ComponentType<unknown>,
): void {
  slots.inject(slotName, () => {
    let dispose: (() => void) | null = null
    const sync = (): void => {
      dispose?.()
      dispose = null
      // Built-in defaults keep both fields non-empty, so the registrations
      // are normally always active; the check stays for safety.
      const state = effectiveBrand(brand.get())
      // logoUrl drives the mark slots; the name slot is driven by brandVersion
      // (the badge always resolves to a value, default "Launcher") — the name
      // TEXT may be empty, in which case the official DeepSeek wordmark
      // renders next to the badge.
      const field = slotName === 'sidebar.brand.name' ? state.brandVersion : state.logoUrl
      if (field.trim() !== '') {
        dispose = slots.register(
          { name: slotName, priority: BRAND_OVERRIDE_PRIORITY },
          makeComponent(state),
        )
      }
    }
    const unsub = brand.subscribe(sync)
    sync()
    return () => {
      unsub()
      dispose?.()
      dispose = null
    }
  })
}

function syncLogoSlots(slots: SlotsService, brand: BrandStore): void {
  bindConditionalSlot(slots, 'sidebar.brand.mark', brand, (s) =>
    CustomMark(s.logoUrl) as unknown as React.ComponentType<unknown>)
  bindConditionalSlot(slots, 'conversation.hero.brand.mark', brand, (s) =>
    CustomMark(s.logoUrl) as unknown as React.ComponentType<unknown>)
  bindConditionalSlot(slots, 'sidebar.brand.name', brand, (s) =>
    CustomName(s.brandName, s.brandVersion) as unknown as React.ComponentType<unknown>)

  // Explicit HMR teardown hook (module reload replaces the fiber; without
  // this the old registrations would outlive the plugin bundle).
  ;(globalThis as { __additiveLogoSync?: () => void }).__additiveLogoSync = () => {
    // Slot registrations ride the fiber lifetime; a full plugin reload goes
    // through the loader's teardown which disposes the fiber. This hook is a
    // no-op safety net for hot reloads of just the client bundle.
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Input History (↑/↓ shell-style navigation in the composer)
 *
 * Implementation: DOM-level keydown interception on the composer input
 * (capture phase). The composer surface is either a <textarea> (older DSH
 * builds) or a Lexical contenteditable [data-composer-input] (DSH 0.1.2+);
 * both are handled through the ComposerSurface abstraction. History stack
 * is maintained PER INPUT ELEMENT (effectively per conversation in the
 * single-pane Web shell today). Writes go through the native value setter
 * (textarea) or the browser's insertText path (contenteditable) so the
 * editor's own state stays in sync.
 *
 * Guard rails (so we never steal keys that belong to native or other UX):
 *   - modifier keys (Shift/Ctrl/Meta/Alt) → pass
 *   - IME composition (compositionstart/end) → pass
 *   - trigger menu open (`[data-composer-card] [role=listbox]` exists) → pass
 *   - ↑: only when caret at position 0 (first char, no selection)
 *   - ↓: only while browsing history (pointer !== -1) AND caret at end
 *   - programmatic writes are tagged with a flag so we don't mis-detect
 *     them as "user edited while browsing history"
 * ════════════════════════════════════════════════════════════════════════ */

interface HistoryState {
  /** User-sent messages, oldest → newest; stack[stack.length-1] is latest. */
  stack: string[]
  /** Current browsing pointer; -1 means "not browsing" (plain input mode). */
  pointer: number
}

/** The composer input element + how to read/write it. */
type InputKind = 'textarea' | 'contenteditable'
interface ComposerSurface {
  el: HTMLElement
  kind: InputKind
}

const HISTORY_KEY = '__dshAdditiveHistory'
const PROGRAMMATIC_FLAG = '__dshAdditiveProgrammatic'

function getState(textarea: HTMLElement): HistoryState {
  const w = textarea as unknown as {
    [HISTORY_KEY]?: HistoryState
  }
  if (!w[HISTORY_KEY]) {
    w[HISTORY_KEY] = { stack: [], pointer: -1 }
  }
  return w[HISTORY_KEY]!
}

/**
 * Write a value into the composer surface.
 *
 * - textarea: native value setter (avoids React 18's value property trap) +
 *   synthetic input event + caret to end.
 * - contenteditable (DSH 0.1.2+ Lexical editor): route the write through the
 *   browser's native text-insertion path (select-all + execCommand
 *   insertText) so the editor's internal model stays in sync — this goes
 *   through a real beforeinput/input round-trip, exactly like user typing.
 *   Falls back to a raw DOM write + synthetic input event when
 *   execCommand is unavailable.
 *
 * The surface is tagged PROGRAMMATIC_FLAG around the write so the input
 * listener below doesn't treat our own write as "user edited while
 * browsing history".
 */
function setSurfaceText(el: HTMLElement, kind: InputKind, value: string): void {
  const tagged = el as unknown as { [key: string]: boolean }
  if (kind === 'textarea') {
    const ta = el as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    if (!setter) {
      ta.value = value
    } else {
      setter.call(ta, value)
    }
    tagged[PROGRAMMATIC_FLAG] = true
    el.dispatchEvent(new Event('input', { bubbles: true }))
    ta.setSelectionRange(value.length, value.length)
    queueMicrotask(() => {
      tagged[PROGRAMMATIC_FLAG] = false
    })
    return
  }

  // ── contenteditable ──────────────────────────────────────────────────
  const sel = window.getSelection()
  if (sel) {
    tagged[PROGRAMMATIC_FLAG] = true // before the command: it fires input synchronously
    let done = false
    try {
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
      if (value === '') {
        // CLEAR: use the dedicated delete command. insertText('') is a
        // NO-OP in some browsers (returns true, deletes nothing) — the
        // "↓ past newest clears the input" path depended on it.
        done = document.execCommand('delete')
        if (done && (el.textContent ?? '').trim() !== '') done = false
        if (!done) {
          done = document.execCommand('insertText', false, '')
          if (done && (el.textContent ?? '').trim() !== '') done = false
        }
      } else {
        done = document.execCommand('insertText', false, value)
      }
    } catch {
      done = false
    }
    if (!done) {
      // Fallback: raw DOM write + synthetic input event.
      el.textContent = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      try {
        const r = document.createRange()
        r.selectNodeContents(el)
        r.collapse(false)
        sel.removeAllRanges()
        sel.addRange(r)
      } catch {
        /* selection unavailable */
      }
    }
    queueMicrotask(() => {
      tagged[PROGRAMMATIC_FLAG] = false
    })
    return
  }

  // No selection API (shouldn't happen in browsers): raw write.
  tagged[PROGRAMMATIC_FLAG] = true
  el.textContent = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  queueMicrotask(() => {
    tagged[PROGRAMMATIC_FLAG] = false
  })
}

/** Read the current text of a composer surface. */
function getSurfaceText(el: HTMLElement, kind: InputKind): string {
  if (kind === 'textarea') return (el as HTMLTextAreaElement).value
  return el.innerText ?? el.textContent ?? ''
}

/** True when the caret sits at the very start of the surface content. */
function caretAtStart(el: HTMLElement, kind: InputKind): boolean {
  if (kind === 'textarea') {
    const ta = el as HTMLTextAreaElement
    return ta.selectionStart === 0 && ta.selectionEnd === 0
  }
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    // No established caret (focus without selection): "at start" only when
    // the editor is empty — otherwise leave the key to the browser.
    return (el.textContent ?? '').trim() === ''
  }
  if (!sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return false
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().trim() === ''
}

/** True when the caret sits at the very end of the surface content. */
function caretAtEnd(el: HTMLElement, kind: InputKind): boolean {
  if (kind === 'textarea') {
    const ta = el as HTMLTextAreaElement
    return ta.selectionStart === ta.selectionEnd && ta.selectionStart === ta.value.length
  }
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    return (el.textContent ?? '').trim() === ''
  }
  if (!sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!el.contains(range.endContainer)) return false
  const post = range.cloneRange()
  post.selectNodeContents(el)
  post.setStart(range.endContainer, range.endOffset)
  return post.toString().trim() === ''
}

/**
 * Find the active composer input. The surface changed between DSH versions:
 * older builds render a <textarea> inside [data-composer-card]; 0.1.2+
 * renders a Lexical contenteditable ([data-composer-input], role=textbox).
 * Strategy:
 *   1. The focused element, when it is (or contains) the composer input.
 *   2. [data-composer-card] textarea (legacy) / [data-composer-input] (new).
 *   3. Last visible textarea in the document (final fallback).
 */
function findComposerInput(): ComposerSurface | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('[data-composer-card]')) {
    if (active instanceof HTMLTextAreaElement) return { el: active, kind: 'textarea' }
    if (active.isContentEditable) {
      const ce =
        (active.matches('[data-composer-input]') ? active : null) ??
        (active.closest('[data-composer-input]') as HTMLElement | null)
      if (ce) return { el: ce, kind: 'contenteditable' }
    }
  }
  const legacy = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (legacy) return { el: legacy, kind: 'textarea' }
  const lexical = document.querySelector<HTMLElement>('[data-composer-card] [data-composer-input]')
  if (lexical) return { el: lexical, kind: 'contenteditable' }
  // Fallback: last visible textarea.
  const all = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'))
  for (let i = all.length - 1; i >= 0; i--) {
    const el = all[i]
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0 && !el.disabled) return { el, kind: 'textarea' }
  }
  return null
}

function isComposing(el: HTMLElement): boolean {
  // The native isComposing flag is set during IME candidate selection; we
  // also check a data attribute set by compositionstart/end listeners to
  // be robust across browser implementations.
  if (el.dataset.additiveComposing === '1') return true
  return false
}

function isTriggerMenuOpen(): boolean {
  if (typeof document === 'undefined') return false
  // The slash-command / @-mention menu renders a role=listbox inside the
  // composer card when open.
  return document.querySelector('[data-composer-card] [role="listbox"]') !== null
}

/** Push a message onto the stack (avoid exact duplicates at the tail). */
function pushMessage(state: HistoryState, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  // Skip if the same text is already at the very top (mimics HISTCONTROL=ignoredups).
  if (state.stack.length > 0 && state.stack[state.stack.length - 1] === trimmed) return
  // Cap stack to keep memory bounded.
  if (state.stack.length >= 200) state.stack.shift()
  state.stack.push(trimmed)
  state.pointer = -1
}

function navigate(state: HistoryState, dir: 'up' | 'down', surface: ComposerSurface): void {
  const { el, kind } = surface
  if (dir === 'up') {
    if (state.stack.length === 0) return
    if (state.pointer === -1) {
      state.pointer = state.stack.length - 1
    } else if (state.pointer > 0) {
      state.pointer -= 1
    } else {
      // Already at oldest entry; stay there (terminal bell behaviour is optional).
      return
    }
    setSurfaceText(el, kind, state.stack[state.pointer])
  } else {
    // dir === 'down'
    if (state.pointer === -1) return // not browsing; let native behaviour happen
    if (state.pointer < state.stack.length - 1) {
      state.pointer += 1
      setSurfaceText(el, kind, state.stack[state.pointer])
    } else {
      // Moved past the newest entry: clear the input — the user is starting
      // a new message (per product spec: 翻到底再按 ↓ = 清空输入框).
      state.pointer = -1
      setSurfaceText(el, kind, '')
    }
  }
}

function syncHistoryWiring(scope: SettingsScope): void {
  if (typeof document === 'undefined') return

  let enabled = readHistoryConfig(scope).inputHistoryEnabled

  // Cached reference to the composer surface so we don't re-query DOM on every event.
  let surface: ComposerSurface | null = null
  // DOM listeners (bound once; they short-circuit when disabled or missing surface).
  let bound = false
  let unsubScope: (() => void) | null = null

  // ── decision trace (exposed on globalThis.__additiveDebug) ─────────────
  let lastKeydown: { key: string; reason: string } | null = null
  let lastEnter: { textLen: number; cleared: boolean; pushed: boolean; stackLength: number } | null = null

  const refreshSurface = (): ComposerSurface | null => {
    const next = findComposerInput()
    // Identity: same element AND same kind.
    if (!next || !(next.el === surface?.el && next.kind === surface?.kind)) {
      surface = next
    }
    return surface
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!enabled) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') lastKeydown = { key: e.key, reason: 'disabled' }
      return
    }
    const surf = refreshSurface()
    if (!surf) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') lastKeydown = { key: e.key, reason: 'no-surface' }
      return
    }
    const { el, kind } = surf
    // The keydown target may be the surface element itself (textarea) or a
    // descendant (contenteditable with nested text/element nodes).
    const t = e.target
    if (!(t instanceof Node) || (t !== el && !el.contains(t))) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter') lastKeydown = { key: e.key, reason: 'target-mismatch' }
      return
    }
    // Never steal chords or IME.
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.isComposing || isComposing(el)) return
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') return
    if (isTriggerMenuOpen()) {
      lastKeydown = { key: e.key, reason: 'menu-open' }
      return
    }
    // The Lexical editor is not editable while the composer is in the "inert"
    // hero phase (no session yet) — don't intercept there.
    if (kind === 'contenteditable' && !el.isContentEditable) {
      lastKeydown = { key: e.key, reason: 'inert' }
      return
    }

    const state = getState(el)

    if (e.key === 'Enter') {
      // Capture send to push history. At capture time the text is still in
      // the surface, so we snapshot it here. A macrotask (setTimeout 0) is
      // guaranteed to observe the cleared surface after a successful send.
      // We deliberately do NOT preventDefault — the composer's own handler
      // must still run.
      const text = getSurfaceText(el, kind)
      if (!text.trim()) {
        lastKeydown = { key: 'Enter', reason: 'empty' }
        return
      }
      lastKeydown = { key: 'Enter', reason: 'enter:snapshot' }
      window.setTimeout(() => {
        if (!el.isConnected) return
        // Push only if the send actually cleared the draft; a blocked /
        // rejected / validation-failed send leaves the text in place.
        const cleared = getSurfaceText(el, kind).trim() !== text.trim()
        const before = state.stack.length
        if (cleared) pushMessage(state, text)
        lastEnter = { textLen: text.trim().length, cleared, pushed: state.stack.length > before, stackLength: state.stack.length }
      }, 0)
      return
    }

    let dir: 'up' | 'down' | null = null
    let reason = ''
    if (e.key === 'ArrowUp') {
      // While browsing history, ↑ keeps walking older regardless of caret
      // position (the caret sits at the end after each fill); the
      // caret-at-start guard only gates ENTERING history from plain input.
      if (state.pointer !== -1) dir = 'up'
      else if (state.stack.length === 0) reason = 'stack-empty'
      else if (caretAtStart(el, kind)) dir = 'up'
      else reason = 'caret-not-at-start'
    } else {
      if (state.pointer === -1) reason = 'not-browsing'
      else if (caretAtEnd(el, kind)) dir = 'down'
      else reason = 'caret-not-at-end'
    }

    if (!dir) {
      lastKeydown = { key: e.key, reason }
      return
    }
    lastKeydown = { key: e.key, reason: 'handled' }
    e.preventDefault()
    e.stopPropagation()
    navigate(state, dir, surf)
  }

  const onInput = (e: Event): void => {
    if (!enabled) return
    const t = e.target
    if (!(t instanceof HTMLElement)) return
    if ((t as unknown as { [key: string]: boolean })[PROGRAMMATIC_FLAG]) return
    if (!surface || t !== surface.el) return
    const state = getState(t)
    if (state.pointer === -1) return
    // User edited content while browsing history: exit history mode; the
    // edited content stays in the input for continued editing / sending.
    // (Compare trimmed: contenteditable innerText may carry a trailing
    // newline the stored text doesn't have.)
    const current = state.stack[state.pointer]
    if (getSurfaceText(t, surface.kind).trim() !== current) {
      state.pointer = -1
    }
  }

  const onCompositionStart = (e: Event): void => {
    const el = e.target
    if (el instanceof HTMLElement) el.dataset.additiveComposing = '1'
  }
  const onCompositionEnd = (e: Event): void => {
    const el = e.target
    if (el instanceof HTMLElement) el.dataset.additiveComposing = '0'
  }
  const onFocusIn = (): void => {
    refreshSurface()
  }

  // Periodic surface refresh (composer may be unmounted/remounted by React
  // during conversation switches) via a cheap focusin/MutationObserver
  // combo.
  const observer = new MutationObserver(() => {
    refreshSurface()
  })

  const bind = (): void => {
    if (bound) return
    bound = true
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('input', onInput, true)
    document.addEventListener('compositionstart', onCompositionStart, true)
    document.addEventListener('compositionend', onCompositionEnd, true)
    document.addEventListener('focusin', onFocusIn, true)
    observer.observe(document.body, { childList: true, subtree: true })
    refreshSurface()
  }

  const unbind = (): void => {
    if (!bound) return
    bound = false
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('compositionstart', onCompositionStart, true)
    document.removeEventListener('compositionend', onCompositionEnd, true)
    document.removeEventListener('focusin', onFocusIn, true)
    observer.disconnect()
    surface = null
  }

  const reconcile = (): void => {
    enabled = readHistoryConfig(scope).inputHistoryEnabled
    if (enabled) bind()
    else unbind()
  }

  unsubScope = scope.subscribe(reconcile)
  reconcile()

  ;(globalThis as { __additiveHistorySync?: () => void }).__additiveHistorySync = () => {
    unbind()
    unsubScope?.()
    observer.disconnect()
  }

  // Live debug handle for the GUI devtools console.
  //   __additiveDebug → { enabled, bound, inputKind, hasInput, stackLength,
  //     triggerMenuOpen, value, lastKeydown:{key,reason}, lastEnter:{...} }
  // lastKeydown.reason ∈ disabled|no-surface|target-mismatch|menu-open|inert|
  //   empty|enter:snapshot|stack-empty|caret-not-at-start|not-browsing|
  //   caret-not-at-end|handled
  ;(globalThis as { __additiveDebug?: Record<string, unknown> }).__additiveDebug = {
    get enabled(): boolean {
      return enabled
    },
    get bound(): boolean {
      return bound
    },
    get inputKind(): InputKind | null {
      return surface ? surface.kind : null
    },
    get hasInput(): boolean {
      return findComposerInput() !== null
    },
    get stackLength(): number {
      return surface ? getState(surface.el).stack.length : 0
    },
    get triggerMenuOpen(): boolean {
      return isTriggerMenuOpen()
    },
    get value(): string | null {
      return surface ? getSurfaceText(surface.el, surface.kind) : null
    },
    get lastKeydown(): { key: string; reason: string } | null {
      return lastKeydown
    },
    get lastEnter(): { textLen: number; cleared: boolean; pushed: boolean; stackLength: number } | null {
      return lastEnter
    },
  }
}
