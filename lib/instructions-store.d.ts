/** Filename of the workspace-level local instructions overlay. */
export declare const LOCAL_INSTRUCTION_FILE = "AGENTS.local.md";
/** Filename of the single user-global instructions file under `$DSH_HOME`. */
export declare const GLOBAL_INSTRUCTION_FILE = "AGENTS.md";
/**
 * Cap on one edited instruction file. `dsh-base` composes
 * `agent-instructions` with `maxBytes: 65536` for the *rendered* baseline; a
 * source file is bounded separately at 1 MiB by that plugin's
 * `maxSourceBytes` default. Editing keeps the same 1 MiB source ceiling so the
 * editor can never save something discovery would silently skip.
 */
export declare const MAX_INSTRUCTION_BYTES: number;
export type InstructionFileId = 'global' | 'local';
/** One instruction file, its resolved location, and its current content. */
export interface InstructionFileSnapshot {
    id: InstructionFileId;
    /** Absolute path on the host — shown verbatim in the settings page. */
    path: string;
    /**
     * Symbolic form for the global file (`~/.dsh/AGENTS.md` / `$DSH_HOME/AGENTS.md`);
     * equal to `path` for the workspace file.
     */
    displayPath: string;
    /** Whether the file exists on disk right now. */
    exists: boolean;
    /** Current UTF-8 content (empty for a missing file). */
    content: string;
    /** UTF-8 byte length of `content`. */
    bytes: number;
    /** SHA-256 of the current bytes, or `null` when the file is absent. */
    sha256: string | null;
    /** Last modification time in epoch ms, or `null` when the file is absent. */
    mtimeMs: number | null;
}
/** One registered workspace the settings page can target. */
export interface WorkspaceSummary {
    id: string;
    title: string;
    path: string;
    /** The directory named by the registry is gone or is no longer a directory. */
    missingDir: boolean;
}
export type InstructionStoreErrorCode = 'not-found' | 'not-a-directory' | 'too-large' | 'conflict' | 'invalid-content';
export declare class InstructionStoreError extends Error {
    readonly code: InstructionStoreErrorCode;
    constructor(code: InstructionStoreErrorCode, message: string);
}
/**
 * Resolve the user-global instruction file under the configured harness home.
 * `resolveDshHome` applies explicit config > `$DSH_HOME` > `os.homedir()/.dsh`,
 * which is exactly the location `agent-instructions` loads from.
 * @param dshHome - optional explicit harness-home override.
 * @returns the absolute global file path and its symbolic display form.
 */
export declare function resolveGlobalInstructionPath(dshHome?: string): {
    path: string;
    displayPath: string;
};
/**
 * Resolve the workspace-local instruction file for one workspace directory.
 * The file name is fixed, so no caller-supplied segment ever reaches the
 * filesystem beyond the directory itself.
 * @param workspaceDir - absolute workspace directory.
 * @returns the absolute local file path.
 * @throws {InstructionStoreError} when the path is not absolute.
 */
export declare function resolveLocalInstructionPath(workspaceDir: string): string;
/**
 * Read one instruction file under the byte cap.
 *
 * A missing `AGENTS.local.md` in an existing workspace directory is a normal
 * state (the editor offers to create it), so absence yields an empty snapshot.
 * A missing *workspace directory* is an error: creating it implicitly would
 * scatter empty projects on a typo.
 *
 * @param id - which of the two files to read.
 * @param path - absolute file path from {@link resolveGlobalInstructionPath} / {@link resolveLocalInstructionPath}.
 * @param displayPath - symbolic path for the global file; defaults to `path`.
 * @returns the current snapshot.
 * @throws {InstructionStoreError} when the containing directory is wrong, or
 * the file exists but exceeds {@link MAX_INSTRUCTION_BYTES}.
 */
export declare function readInstructionFile(id: InstructionFileId, path: string, displayPath?: string): Promise<InstructionFileSnapshot>;
/**
 * Replace one instruction file atomically, refusing to clobber an external
 * edit the caller never saw.
 *
 * The commit is a same-directory temp file plus `rename`, so the core loader
 * observes either the previous or the next complete content — never a partial
 * write, and never a symlink swapped underneath it. `mode: 0o644` matches the
 * umask-derived permissions the loader's own `AGENTS.md` files carry.
 *
 * @param id - which of the two files to write.
 * @param path - absolute file path.
 * @param content - the complete next content.
 * @param options - `baseSha256` is the hash the caller read (`null`/omitted
 * skips the guard); `requireParent` rejects instead of creating a missing
 * directory (used for the workspace file).
 * @param displayPath - symbolic path for the global file.
 * @returns the refreshed snapshot.
 * @throws {InstructionStoreError} on size, directory, or conflict failures.
 */
export declare function writeInstructionFile(id: InstructionFileId, path: string, content: string, options?: {
    baseSha256?: string | null;
    requireParent?: boolean;
}, displayPath?: string): Promise<InstructionFileSnapshot>;
/**
 * Resolve the effective workspace directory for an editor request: the
 * request's explicit value wins, then the configured `workspaceDir`, then the
 * first registered workspace.
 * @param requestValue - `?workspace=` query value or request-body field.
 * @param configured - the `workspaceDir` setting.
 * @param registered - registered workspace paths, in registry order.
 * @returns the absolute directory, or `undefined` when nothing can be chosen.
 */
export declare function pickWorkspaceDir(requestValue: string | null | undefined, configured: string | null | undefined, registered?: readonly string[]): string | undefined;
/**
 * Canonicalize one workspace directory for filesystem access.
 * @param dir - candidate absolute directory.
 * @returns the realpath and whether it is currently a directory.
 */
export declare function inspectWorkspaceDir(dir: string): Promise<{
    path: string;
    missingDir: boolean;
}>;
//# sourceMappingURL=instructions-store.d.ts.map