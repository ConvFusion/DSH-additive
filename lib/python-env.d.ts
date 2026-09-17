/** Directory (under the DSH home) that holds the one-shot virtualenv. */
export declare const PYTHON_ENV_DIR = "python-env";
/**
 * The venv's python executable for a given directory. A virtualenv created
 * here with `python -m venv <dir>` places the interpreter at
 * `<dir>/bin/python` (POSIX) or `<dir>/Scripts/python.exe` (Windows).
 */
export declare function venvPythonExe(envDir: string): string;
/** Marker pair that delimits the plugin-managed block inside AGENTS.md. */
export declare const AGENTS_BLOCK_START = "<!-- dsh-additive:python-env:start -->";
export declare const AGENTS_BLOCK_END = "<!-- dsh-additive:python-env:end -->";
/** Where the resolved environment comes from. */
export type PythonEnvStatus = 'configured' | 'system' | 'missing';
/** A more specific label of the environment used for display + AGENTS.md. */
export type PythonEnvKind = 'custom-interpreter' | 'virtualenv' | 'system' | 'dsh-venv';
/** The single resolved Python environment the settings page / AGENTS.md use. */
export interface PythonEnvInfo {
    status: PythonEnvStatus;
    kind: PythonEnvKind;
    /** The interpreter/venv path to record; null when nothing is available yet. */
    path: string | null;
    /** e.g. "Python 3.12.8"; null when the interpreter could not be probed. */
    version: string | null;
    /** Human-readable summary (which env, why). */
    description: string;
}
/** The state of the DSH-managed virtualenv directory. */
export interface DshVenvStatus {
    dir: string;
    exists: boolean;
    python: string | null;
}
/** Result of a virtualenv (create-or-reuse) operation. */
export interface EnsureVenvResult {
    /** false when the venv already existed (reused), true when newly created. */
    installed: boolean;
    dir: string;
    python: string;
    version: string | null;
}
/** Result of writing the resolved environment into AGENTS.md. */
export interface PythonEnvWriteResult {
    agentsPath: string;
    displayPath: string;
    /** true when an existing managed block was replaced, false when appended. */
    replaced: boolean;
    path: string;
    kind: PythonEnvKind;
    version: string | null;
    description: string;
}
export type PythonEnvErrorCode = 'no-python' | 'venv-failed';
export declare class PythonEnvError extends Error {
    readonly code: PythonEnvErrorCode;
    constructor(code: PythonEnvErrorCode, message: string);
}
/**
 * Find a working system interpreter on PATH. `python3` is tried first, then
 * `python`; each is asked for its absolute `sys.executable`, so the returned
 * path is canonical even when the command is a symlink on PATH.
 * @returns the command, absolute executable, and version — or null when no
 * Python interpreter is available on PATH.
 */
export declare function detectSystemPython(): {
    command: string;
    executable: string;
    version: string | null;
} | null;
/** Describe the `$DSH_HOME/python-env` virtualenv without changing it. */
export declare function dshVenvStatus(): DshVenvStatus;
/**
 * Ensure the DSH-managed virtualenv exists. If it already does, it is reused
 * as-is (never recreated — the "avoid re-installing" guarantee); otherwise it
 * is created once from the best system interpreter available on PATH.
 * @returns the venv's directory and interpreter path.
 * @throws {PythonEnvError} when no system Python is available, or `venv` fails.
 */
export declare function ensureVenv(): EnsureVenvResult;
/**
 * Read-only resolution of which Python environment to use, per the
 * `pythonPath` setting. No virtualenv is created here — that is
 * {@link ensureVenv}'s job.
 *
 *   - a non-empty `pythonPath` is honoured verbatim (a directory is treated as
 *     a virtualenv, a file as a bare interpreter);
 *   - otherwise the system `python3`/`python` on PATH is preferred;
 *   - otherwise the status is `missing` and the DSH venv is the fallback that
 *     {@link ensureVenv} / the "write to AGENTS.md" action will create.
 *
 * @param config - the resolved `additive` settings section.
 * @returns the single environment to record.
 */
export declare function resolvePythonEnv(config: {
    pythonPath?: string;
}): PythonEnvInfo;
/**
 * Write (or refresh) the resolved Python environment into
 * `$DSH_HOME/AGENTS.md`. The managed block sits between the
 * `dsh-additive:python-env` markers: when the markers are present only that
 * region is replaced, so the rest of the file (including any hand-written
 * `## Python 环境` section) is left untouched; when absent the block is
 * appended. The write is delegated to the instruction store's atomic,
 * size-capped writer.
 *
 * @param info - the resolved environment to record.
 * @returns the write result (including the AGENTS.md path it targeted).
 */
export declare function writePythonEnvToAgents(info: PythonEnvInfo): Promise<PythonEnvWriteResult>;
//# sourceMappingURL=python-env.d.ts.map