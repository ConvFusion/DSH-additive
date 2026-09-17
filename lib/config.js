/**
 * Plugin configuration for dsh-additive.
 *
 * Host-persisted fields (Settings → Additive, ~/.dsh/settings.yaml):
 *   - inputHistoryEnabled  ↑/↓ history navigation in the chat composer
 *   - workspaceDir         workspace (project) directory whose AGENTS.local.md
 *                          the settings editor reads and writes
 *   - pythonPath           optional explicit Python interpreter / venv directory;
 *                          empty → auto-detect system Python, else install a
 *                          virtualenv at $DSH_HOME/python-env (see ./python-env.ts)
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
 *
 * The Python-env setting (see ./python-env.ts) persists only the optional
 * `pythonPath`. The resolved environment is computed on the host (detect the
 * system interpreter, or create the one-shot `$DSH_HOME/python-env` venv) and
 * is what gets recorded / written into `$DSH_HOME/AGENTS.md`.
 */
import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
    inputHistoryEnabled: Schema.boolean().default(false).description('Enable ↑/↓ history navigation in the chat composer, similar to a shell/readline prompt. ' +
        'When enabled, pressing ↑ at the start of the input fills the previous user message; ' +
        'pressing ↓ while browsing history moves forward and restores your draft once you pass the latest entry.'),
    workspaceDir: Schema.string().default('').description('Absolute path of the workspace (project) directory whose AGENTS.local.md the settings editor ' +
        'edits. Leave empty to follow the first registered workspace. Only that one file is ever read ' +
        'or written; the global $DSH_HOME/AGENTS.md editor follows the resolved harness home.'),
    pythonPath: Schema.string().default('').description('Optional explicit Python interpreter executable or virtualenv directory. Leave empty to ' +
        'auto-detect: a system python3/python on PATH is recorded; when none is available a virtualenv ' +
        'is created under $DSH_HOME/python-env (created once and reused).'),
});
export const DEFAULT_CONFIG = {
    inputHistoryEnabled: false,
    workspaceDir: '',
    pythonPath: '',
};
//# sourceMappingURL=config.js.map