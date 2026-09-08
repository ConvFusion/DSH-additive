/**
 * Plugin configuration for dsh-additive.
 *
 * Host-persisted field (Settings → Additive, ~/.dsh/settings.yaml):
 *   - inputHistoryEnabled  ↑/↓ history navigation in the chat composer
 *
 * The logo image URL and brand name are NOT host-persisted: they live in the
 * browser's localStorage (see the client's brandStore) so they behave like
 * the input-history records — client-local, restored from localStorage on
 * every page load. The uploaded image bytes themselves are stored on the
 * host disk (see ./logo-store.ts) and served at /dsh-additive/logo.
 */
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Toggle for ↑/↓ input history in the chat composer. */
  inputHistoryEnabled: boolean
}

export const Config: Schema<Config> = Schema.object({
  inputHistoryEnabled: Schema.boolean().default(false).description(
    'Enable ↑/↓ history navigation in the chat composer, similar to a shell/readline prompt. ' +
    'When enabled, pressing ↑ at the start of the input fills the previous user message; ' +
    'pressing ↓ while browsing history moves forward and restores your draft once you pass the latest entry.',
  ),
})

export const DEFAULT_CONFIG: Config = {
  inputHistoryEnabled: false,
}
