/**
 * dsh-additive — host half.
 *
 * Registers:
 *   - the `additive` settings namespace (inputHistoryEnabled, workspaceDir;
 *     logo/brand references live in the browser's localStorage and need no
 *     host persistence)
 *   - same-origin web routes for the local logo image:
 *       POST   /dsh-additive/logo  — upload (validated, written to disk)
 *       GET    /dsh-additive/logo  — serve the stored image
 *       DELETE /dsh-additive/logo  — remove the stored image
 *   - same-origin web routes for editing the two AGENTS instruction files:
 *       GET  /dsh-additive/instructions             — global + workspace file snapshots
 *       GET  /dsh-additive/instructions/workspaces  — registered workspaces for the picker
 *       POST /dsh-additive/instructions/global      — write $DSH_HOME/AGENTS.md
 *       POST /dsh-additive/instructions/local       — write <workspace>/AGENTS.local.md
 *   - same-origin web routes for the Python environment (see ./python-env.ts):
 *       GET  /dsh-additive/python-env               — resolve the env (config > system > DSH venv)
 *       POST /dsh-additive/python-env/install       — create-or-reuse the $DSH_HOME/python-env venv
 *       POST /dsh-additive/python-env/agents        — (re)write the managed block into AGENTS.md
 *
 * The image bytes live under the DSH home (e.g. ~/.dsh/dsh-additive/); the
 * browser only ever sees the served path. The instruction editor touches
 * exactly two existing files (see ./instructions-store.ts) and nothing else;
 * the Python-env surface records one managed block into $DSH_HOME/AGENTS.md.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Context } from '@deepseek-ai/cordis';
import { Config, type Config as ConfigShape } from './config.js';
import { type LogoStore } from './logo-store.js';
export declare const name = "dsh-additive";
export { Config };
export declare const inject: string[];
export declare function apply(ctx: Context, entry?: Partial<ConfigShape>): void;
/** Route handler (exported for tests). Dispatches on method + pathname. */
export declare function handleLogoRequest(req: IncomingMessage, res: ServerResponse, store: LogoStore, logger: {
    info: (m: string) => void;
    warn: (m: string) => void;
} | undefined): Promise<void>;
interface InstructionsHostContext {
    get(name: string): unknown;
    logger?: {
        info: (m: string) => void;
        warn: (m: string) => void;
    };
}
/** Route handler for `/dsh-additive/instructions*` (exported for tests). */
export declare function handleInstructionsRequest(req: IncomingMessage, res: ServerResponse, readConfig: () => ConfigShape, ctx: InstructionsHostContext): Promise<void>;
/** Route handler for `/dsh-additive/python-env*` (exported for tests). */
export declare function handlePythonEnvRequest(req: IncomingMessage, res: ServerResponse, readConfig: () => ConfigShape, ctx: InstructionsHostContext): Promise<void>;
//# sourceMappingURL=index.d.ts.map