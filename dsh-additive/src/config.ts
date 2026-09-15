/**
 * Plugin configuration for dsh-additive.
 *
 * Host-persisted fields (Settings → Additive, ~/.dsh/settings.yaml):
 *   - inputHistoryEnabled  ↑/↓ history navigation in the chat composer
 *   - workspaceDir         workspace (project) directory whose AGENTS.local.md
 *                          the settings editor reads and writes
 *
 * The logo image URL and brand name are NOT host-persisted: they live in the
 * browser's localStorage (see the client's brandStore) so they behave like
 * the input-history records — client-local, restored from localStorage on
 * every page load. The uploaded image bytes themselves are stored on the
 * host disk (see ./logo-store.ts) and served at /dsh-additive/logo.
 *
 * The instructions editor (see ./instructions-store.ts) persists nothing but
 * workspaceDir here: both edited files already live in the filesystem, at
 * `<workspaceDir>/AGENTS.local.md` and `$DSH_HOME/AGENTS.md`.
 */
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Toggle for ↑/↓ input history in the chat composer. */
  inputHistoryEnabled: boolean
  /**
   * Absolute workspace directory whose `AGENTS.local.md` the editor targets.
   * Empty falls back to the first registered workspace reported by the host.
   */
  workspaceDir: string
}

export const Config: Schema<Config> = Schema.object({
  inputHistoryEnabled: Schema.boolean().default(false).description(
    'Enable ↑/↓ history navigation in the chat composer, similar to a shell/readline prompt. ' +
    'When enabled, pressing ↑ at the start of the input fills the previous user message; ' +
    'pressing ↓ while browsing history moves forward and restores your draft once you pass the latest entry.',
  ),
  workspaceDir: Schema.string().default('').description(
    'Absolute path of the workspace (project) directory whose AGENTS.local.md the settings editor ' +
    'edits. Leave empty to follow the first registered workspace. Only that one file is ever read ' +
    'or written; the global $DSH_HOME/AGENTS.md editor follows the resolved harness home.',
  ),
})

export const DEFAULT_CONFIG: Config = {
  inputHistoryEnabled: false,
  workspaceDir: '',
}
