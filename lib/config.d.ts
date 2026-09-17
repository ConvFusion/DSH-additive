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
export interface Config {
    /** Toggle for ↑/↓ input history in the chat composer. */
    inputHistoryEnabled: boolean;
    /**
     * Absolute workspace directory whose `AGENTS.local.md` the editor targets.
     * Empty falls back to the first registered workspace reported by the host.
     */
    workspaceDir: string;
    /**
     * Optional explicit Python interpreter executable or virtualenv directory
     * to use / record. Empty means auto-detect: a system `python3` / `python`
     * on PATH is preferred; when none is found, a virtualenv is created under
     * `$DSH_HOME/python-env` (created once, reused thereafter).
     */
    pythonPath: string;
}
export declare const Config: Schema<Config>;
export declare const DEFAULT_CONFIG: Config;
//# sourceMappingURL=config.d.ts.map