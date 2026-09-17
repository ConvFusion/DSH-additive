/**
 * Instruction-file editing for the two AGENTS files the settings page owns.
 *
 * The loading side belongs to the core plugin `@deepseek-ai/dsh-agent-instructions`
 * (enabled by `@deepseek-ai/dsh-base`): it discovers `$DSH_HOME/AGENTS.md` and,
 * along the project chain, `AGENTS.md` / `CLAUDE.md` plus the local overlays
 * `AGENTS.local.md` / `CLAUDE.local.md`. Its candidate/home knobs live in the
 * composition layer only, so no settings namespace this plugin can register
 * ever changes *which* files load. What was missing is an editing surface for
 * the content of the two files users actually maintain by hand:
 *
 *   - global  `$DSH_HOME/AGENTS.md`          (settings default `~/.dsh/AGENTS.md`)
 *   - workspace `<workspaceDir>/AGENTS.local.md`
 *
 * This module therefore only reads, bounds, and atomically writes those two
 * files. Path resolution is delegated to `@deepseek-ai/dsh-home-paths`, so the
 * Windows layout (`%USERPROFILE%\.dsh`, or `$DSH_HOME`) needs no special case.
 *
 * @module dsh-additive/instructions-store
 */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { dshHomeDisplay, resolveDshHome } from '@deepseek-ai/dsh-home-paths';
/** Filename of the workspace-level local instructions overlay. */
export const LOCAL_INSTRUCTION_FILE = 'AGENTS.local.md';
/** Filename of the single user-global instructions file under `$DSH_HOME`. */
export const GLOBAL_INSTRUCTION_FILE = 'AGENTS.md';
/**
 * Cap on one edited instruction file. `dsh-base` composes
 * `agent-instructions` with `maxBytes: 65536` for the *rendered* baseline; a
 * source file is bounded separately at 1 MiB by that plugin's
 * `maxSourceBytes` default. Editing keeps the same 1 MiB source ceiling so the
 * editor can never save something discovery would silently skip.
 */
export const MAX_INSTRUCTION_BYTES = 1024 * 1024;
export class InstructionStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'InstructionStoreError';
        this.code = code;
    }
}
/* ════════════════════════════════════════════════════════════════════════
 * Path resolution
 * ════════════════════════════════════════════════════════════════════════ */
/**
 * Resolve the user-global instruction file under the configured harness home.
 * `resolveDshHome` applies explicit config > `$DSH_HOME` > `os.homedir()/.dsh`,
 * which is exactly the location `agent-instructions` loads from.
 * @param dshHome - optional explicit harness-home override.
 * @returns the absolute global file path and its symbolic display form.
 */
export function resolveGlobalInstructionPath(dshHome) {
    const home = resolveDshHome(dshHome);
    return {
        path: join(home, GLOBAL_INSTRUCTION_FILE),
        displayPath: `${dshHomeDisplay(home)}/${GLOBAL_INSTRUCTION_FILE}`,
    };
}
/**
 * Resolve the workspace-local instruction file for one workspace directory.
 * The file name is fixed, so no caller-supplied segment ever reaches the
 * filesystem beyond the directory itself.
 * @param workspaceDir - absolute workspace directory.
 * @returns the absolute local file path.
 * @throws {InstructionStoreError} when the path is not absolute.
 */
export function resolveLocalInstructionPath(workspaceDir) {
    const trimmed = workspaceDir.trim();
    if (!isAbsolute(trimmed)) {
        throw new InstructionStoreError('not-found', `workspace directory must be an absolute path: "${workspaceDir}"`);
    }
    return join(resolve(trimmed), LOCAL_INSTRUCTION_FILE);
}
/* ════════════════════════════════════════════════════════════════════════
 * Bounded read
 * ════════════════════════════════════════════════════════════════════════ */
function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}
async function statKind(path) {
    try {
        const info = await stat(path);
        if (info.isFile())
            return 'file';
        if (info.isDirectory())
            return 'directory';
        return 'other';
    }
    catch {
        return 'absent';
    }
}
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
export async function readInstructionFile(id, path, displayPath = path) {
    const present = await statKind(path);
    if (present !== 'file') {
        if (present === 'directory') {
            throw new InstructionStoreError('not-a-directory', `"${path}" is a directory, not a file`);
        }
        // A workspace file may legitimately not exist yet (the editor offers to
        // create it), but its *workspace directory* must: creating a directory
        // implicitly would scatter empty projects on a typo. The global file is
        // exempt — the harness home may not exist before first write, and the
        // write path creates it.
        if (id !== 'global') {
            const parent = await statKind(dirname(path));
            if (parent !== 'directory') {
                throw new InstructionStoreError('not-found', `directory "${dirname(path)}" does not exist, so this workspace cannot be edited`);
            }
        }
        return {
            id,
            path,
            displayPath,
            exists: false,
            content: '',
            bytes: 0,
            sha256: null,
            mtimeMs: null,
        };
    }
    const info = await stat(path);
    if (info.size > MAX_INSTRUCTION_BYTES) {
        throw new InstructionStoreError('too-large', `"${path}" is ${info.size} bytes, above the ${MAX_INSTRUCTION_BYTES}-byte editing limit`);
    }
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_INSTRUCTION_BYTES) {
        throw new InstructionStoreError('too-large', `"${path}" is ${bytes.byteLength} bytes, above the ${MAX_INSTRUCTION_BYTES}-byte editing limit`);
    }
    const content = bytes.toString('utf8');
    return {
        id,
        path,
        displayPath,
        exists: true,
        content,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
        mtimeMs: info.mtimeMs,
    };
}
/* ════════════════════════════════════════════════════════════════════════
 * Atomic, conflict-guarded write
 * ════════════════════════════════════════════════════════════════════════ */
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
export async function writeInstructionFile(id, path, content, options = {}, displayPath = path) {
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > MAX_INSTRUCTION_BYTES) {
        throw new InstructionStoreError('too-large', `content is ${byteLength} bytes, above the ${MAX_INSTRUCTION_BYTES}-byte limit`);
    }
    const parent = dirname(path);
    const parentKind = await statKind(parent);
    if (parentKind !== 'directory') {
        if (options.requireParent === true) {
            throw new InstructionStoreError('not-found', `directory "${parent}" does not exist, so ${LOCAL_INSTRUCTION_FILE} cannot be saved there`);
        }
        await mkdir(parent, { recursive: true, mode: 0o700 });
    }
    const current = await readInstructionFile(id, path, displayPath);
    if (options.baseSha256 !== undefined && options.baseSha256 !== null) {
        if (current.sha256 !== options.baseSha256) {
            throw new InstructionStoreError('conflict', current.exists
                ? `"${path}" changed on disk after it was loaded; reload before saving`
                : `"${path}" no longer exists; reload before saving`);
        }
    }
    const temp = join(parent, `.${id === 'global' ? GLOBAL_INSTRUCTION_FILE : LOCAL_INSTRUCTION_FILE}.${process.pid}.${Date.now()}.tmp`);
    let handle;
    try {
        handle = await open(temp, 'wx', 0o644);
        await handle.writeFile(content, 'utf8');
        await handle.close();
        handle = undefined;
        await rename(temp, path);
    }
    catch (error) {
        await handle?.close().catch(() => { });
        await rm(temp, { force: true }).catch(() => { });
        throw error;
    }
    return await readInstructionFile(id, path, displayPath);
}
/* ════════════════════════════════════════════════════════════════════════
 * Workspace helpers
 * ════════════════════════════════════════════════════════════════════════ */
/**
 * Resolve the effective workspace directory for an editor request: the
 * request's explicit value wins, then the configured `workspaceDir`, then the
 * first registered workspace.
 * @param requestValue - `?workspace=` query value or request-body field.
 * @param configured - the `workspaceDir` setting.
 * @param registered - registered workspace paths, in registry order.
 * @returns the absolute directory, or `undefined` when nothing can be chosen.
 */
export function pickWorkspaceDir(requestValue, configured, registered = []) {
    for (const candidate of [requestValue, configured]) {
        const trimmed = candidate?.trim();
        if (trimmed !== undefined && trimmed.length > 0)
            return trimmed;
    }
    return registered[0];
}
/**
 * Canonicalize one workspace directory for filesystem access.
 * @param dir - candidate absolute directory.
 * @returns the realpath and whether it is currently a directory.
 */
export async function inspectWorkspaceDir(dir) {
    try {
        const canonical = await realpath(resolve(dir));
        const info = await stat(canonical);
        return { path: canonical, missingDir: !info.isDirectory() };
    }
    catch {
        return { path: resolve(dir), missingDir: true };
    }
}
//# sourceMappingURL=instructions-store.js.map