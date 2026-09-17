import { Config, DEFAULT_CONFIG } from './config.js';
import { createLogoStore, LogoStoreError, LOGO_SERVED_PATH, MAX_LOGO_BYTES, } from './logo-store.js';
import { inspectWorkspaceDir, InstructionStoreError, MAX_INSTRUCTION_BYTES, pickWorkspaceDir, readInstructionFile, resolveGlobalInstructionPath, resolveLocalInstructionPath, writeInstructionFile, } from './instructions-store.js';
import { dshVenvStatus, ensureVenv, PythonEnvError, resolvePythonEnv, writePythonEnvToAgents, } from './python-env.js';
export const name = 'dsh-additive';
export { Config };
export function apply(ctx, entry = {}) {
    const merged = { ...DEFAULT_CONFIG, ...entry };
    // Settings plane: schema defaults < composition (cordis.patch.yml) < user
    // document (~/.dsh/settings.yaml). The browser reads the same namespace
    // through the settings mirror.
    //
    // DSH 0.1.5-rc.1 removed installSettingsSection/settingsNamespace from
    // @deepseek-ai/dsh-settings; the equivalent is the SettingsProvider service's
    // installSection, reached through ctx.inject(["settings"], ...).
    let source = () => merged;
    ctx.inject(['settings'], (settingsCtx) => {
        const settings = settingsCtx.settings;
        settings.installSection(ctx, 'additive', Config, merged, {
            setSource: (get) => {
                source = get;
            },
            onChange: () => {
                void source;
            },
        });
    });
    void registerRoutes(ctx, () => source());
    ctx.logger?.info('[additive] 插件已加载：设置项「Additive」已注册（历史开关 + Logo 上传 + AGENTS 指令文件编辑）');
}
/* ════════════════════════════════════════════════════════════════════════
 * Web routes
 *
 * One prefix registration serves every `/dsh-additive/*` resource: the same
 * origin and auth as the page, so the settings UI needs no extra transport.
 * ════════════════════════════════════════════════════════════════════════ */
async function registerRoutes(ctx, readConfig) {
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function') {
        ctx.logger?.info('[additive] webServer 服务不可用（非 Web 组合），跳过 logo/指令路由');
        return;
    }
    const store = await createLogoStore();
    webServer.register({
        kind: 'prefix',
        path: '/dsh-additive',
        handler: (req, res) => {
            const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';
            if (pathname.startsWith('/dsh-additive/python-env')) {
                void handlePythonEnvRequest(req, res, readConfig, ctx).catch((error) => {
                    ctx.logger?.warn(`[additive] Python 环境请求处理失败: ${String(error)}`);
                    sendJson(res, 500, { ok: false, error: 'internal' });
                });
                return;
            }
            if (pathname.startsWith('/dsh-additive/instructions')) {
                void handleInstructionsRequest(req, res, readConfig, ctx).catch((error) => {
                    ctx.logger?.warn(`[additive] 指令文件请求处理失败: ${String(error)}`);
                    sendJson(res, 500, { ok: false, error: 'internal' });
                });
                return;
            }
            void handleLogoRequest(req, res, store, ctx.logger);
        },
    });
    ctx.logger?.info(`[additive] logo 本地存储已就绪（${store.dir}），路由 ${LOGO_SERVED_PATH}、/dsh-additive/instructions* 与 /dsh-additive/python-env* 已注册`);
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(payload));
    res.end(payload);
}
/** Route handler (exported for tests). Dispatches on method + pathname. */
export async function handleLogoRequest(req, res, store, logger) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    // Only the single /dsh-additive/logo resource is handled here.
    if (pathname !== '/dsh-additive/logo') {
        sendJson(res, 404, { ok: false, error: 'not-found' });
        return;
    }
    const method = req.method ?? 'GET';
    try {
        if (method === 'POST') {
            const { bytes, mediaType } = await readUploadBody(req);
            const meta = await store.upload(bytes, mediaType);
            logger?.info(`[additive] logo 已上传: ${meta.mediaType}, ${meta.size}B`);
            sendJson(res, 200, {
                ok: true,
                url: LOGO_SERVED_PATH,
                mediaType: meta.mediaType,
                size: meta.size,
                version: meta.updatedAt,
                sha256: meta.sha256,
            });
        }
        else if (method === 'GET') {
            const current = await store.read();
            if (!current) {
                sendJson(res, 404, { ok: false, error: 'no-logo' });
                return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', current.meta.mediaType);
            // Content changes on upload; the client also appends ?v=<updatedAt>.
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Additive-Logo-Version', String(current.meta.updatedAt));
            res.setHeader('Content-Length', String(current.bytes.length));
            res.end(Buffer.from(current.bytes));
        }
        else if (method === 'DELETE') {
            const removed = await store.remove();
            logger?.info(`[additive] logo 已删除: ${removed ? '是' : '（本来就不存在）'}`);
            sendJson(res, 200, { ok: true, removed });
        }
        else {
            sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
        }
    }
    catch (error) {
        if (error instanceof LogoStoreError) {
            const status = error.code === 'too-large'
                ? 413
                : error.code === 'type-mismatch' ||
                    error.code === 'not-an-image' ||
                    error.code === 'empty-body'
                    ? 415
                    : 400;
            sendJson(res, status, { ok: false, error: error.code, message: error.message });
            return;
        }
        logger?.warn(`[additive] logo 请求处理失败: ${String(error)}`);
        sendJson(res, 500, { ok: false, error: 'internal' });
    }
}
async function readJsonBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        // Content is capped at 1 MiB in the store; allow JSON escaping overhead.
        if (total > MAX_INSTRUCTION_BYTES * 2 + 64 * 1024) {
            throw new InstructionStoreError('too-large', 'request body exceeds the instruction-file limit');
        }
        chunks.push(Buffer.from(chunk));
    }
    if (total === 0)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new InstructionStoreError('invalid-content', 'request body is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new InstructionStoreError('invalid-content', 'request body must be a JSON object');
    }
    return parsed;
}
function optionalString(value) {
    return typeof value === 'string' ? value : undefined;
}
/** Read the registry as plain summaries; an absent registry yields an empty list. */
async function listWorkspaces(ctx) {
    const registry = ctx.get('workspaceRegistry');
    if (!registry || typeof registry.list !== 'function')
        return [];
    let entities;
    try {
        entities = registry.list();
    }
    catch (error) {
        ctx.logger?.warn(`[additive] 工作区列表读取失败: ${String(error)}`);
        return [];
    }
    const summaries = [];
    for (const entity of entities) {
        const path = optionalString(entity.path);
        if (path === undefined)
            continue;
        const id = optionalString(entity.id) ?? path;
        if (summaries.some((entry) => entry.id === id || entry.path === path))
            continue;
        const { missingDir } = await inspectWorkspaceDir(path);
        summaries.push({ id, title: optionalString(entity.title) ?? path, path, missingDir });
    }
    return summaries;
}
/**
 * Resolve both editable targets for one request.
 * @returns the global and workspace snapshots, the effective workspace
 * directory, and the workspace list for the picker.
 */
async function loadInstructionTargets(ctx, config, requestedWorkspace) {
    const globalPath = resolveGlobalInstructionPath();
    const workspaces = await listWorkspaces(ctx);
    const workspaceDir = pickWorkspaceDir(requestedWorkspace, config.workspaceDir, workspaces.map((entry) => entry.path));
    const global = await readInstructionFile('global', globalPath.path, globalPath.displayPath);
    let local = null;
    if (workspaceDir !== undefined && workspaceDir.length > 0) {
        const canonical = await inspectWorkspaceDir(workspaceDir);
        local = await readInstructionFile('local', resolveLocalInstructionPath(canonical.path));
    }
    return { target: { global, local }, workspaceDir, workspaces };
}
async function writeTarget(ctx, config, id, requestedWorkspace, body) {
    const content = body['content'];
    if (typeof content !== 'string') {
        throw new InstructionStoreError('invalid-content', 'body.content must be a string');
    }
    const baseSha256 = body['baseSha256'];
    if (baseSha256 !== undefined && baseSha256 !== null && typeof baseSha256 !== 'string') {
        throw new InstructionStoreError('invalid-content', 'body.baseSha256 must be a string or null');
    }
    const guard = typeof baseSha256 === 'string' ? baseSha256 : null;
    if (id === 'global') {
        const globalPath = resolveGlobalInstructionPath();
        return await writeInstructionFile('global', globalPath.path, content, { baseSha256: guard }, globalPath.displayPath);
    }
    const requested = requestedWorkspace ?? optionalString(body['workspace']);
    const workspaces = await listWorkspaces(ctx);
    const workspaceDir = pickWorkspaceDir(requested, config.workspaceDir, workspaces.map((entry) => entry.path));
    if (workspaceDir === undefined || workspaceDir.length === 0) {
        throw new InstructionStoreError('not-found', 'no workspace directory selected; pick a workspace in Settings → Additive first');
    }
    const canonical = await inspectWorkspaceDir(workspaceDir);
    if (canonical.missingDir) {
        throw new InstructionStoreError('not-found', `workspace directory "${canonical.path}" does not exist`);
    }
    return await writeInstructionFile('local', resolveLocalInstructionPath(canonical.path), content, { baseSha256: guard, requireParent: true });
}
/** Route handler for `/dsh-additive/instructions*` (exported for tests). */
export async function handleInstructionsRequest(req, res, readConfig, ctx) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    const config = readConfig();
    try {
        if (pathname === '/dsh-additive/instructions/workspaces') {
            if (method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            sendJson(res, 200, { ok: true, workspaces: await listWorkspaces(ctx) });
            return;
        }
        if (pathname === '/dsh-additive/instructions') {
            if (method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            const requested = url.searchParams.get('workspace') ?? undefined;
            const loaded = await loadInstructionTargets(ctx, config, requested);
            sendJson(res, 200, {
                ok: true,
                target: loaded.target,
                workspaceDir: loaded.workspaceDir ?? null,
                configuredWorkspaceDir: config.workspaceDir,
                workspaces: loaded.workspaces,
            });
            return;
        }
        if (pathname === '/dsh-additive/instructions/global') {
            if (method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            const body = await readJsonBody(req);
            const snapshot = await writeTarget(ctx, config, 'global', undefined, body);
            ctx.logger?.info(`[additive] 全局指令文件已写入: ${snapshot.path} (${snapshot.bytes}B)`);
            sendJson(res, 200, { ok: true, target: { global: snapshot } });
            return;
        }
        if (pathname === '/dsh-additive/instructions/local') {
            if (method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            const body = await readJsonBody(req);
            const requested = url.searchParams.get('workspace') ?? undefined;
            const snapshot = await writeTarget(ctx, config, 'local', requested, body);
            ctx.logger?.info(`[additive] 工作区指令文件已写入: ${snapshot.path} (${snapshot.bytes}B)`);
            sendJson(res, 200, { ok: true, target: { local: snapshot } });
            return;
        }
        sendJson(res, 404, { ok: false, error: 'not-found' });
    }
    catch (error) {
        if (error instanceof InstructionStoreError) {
            const status = error.code === 'not-found'
                ? 404
                : error.code === 'conflict'
                    ? 409
                    : error.code === 'too-large'
                        ? 413
                        : error.code === 'not-a-directory'
                            ? 400
                            : 400;
            sendJson(res, status, { ok: false, error: error.code, message: error.message });
            return;
        }
        ctx.logger?.warn(`[additive] 指令文件请求失败: ${String(error)}`);
        sendJson(res, 500, { ok: false, error: 'internal' });
    }
}
/* ════════════════════════════════════════════════════════════════════════
 * Python-environment routes (Settings → Additive → Python 环境)
 *
 *   GET  /dsh-additive/python-env              — read-only resolution:
 *                                                config.pythonPath > system > DSH venv
 *   POST /dsh-additive/python-env/install      — create-or-reuse the one-shot
 *                                                $DSH_HOME/python-env venv
 *   POST /dsh-additive/python-env/agents       — resolve (installing the venv
 *                                                if nothing resolvable exists)
 *                                                and write the managed block
 *                                                into $DSH_HOME/AGENTS.md
 *
 * The venv is created only when missing, so repeated actions never re-install
 * Python. All host-side logic lives in ./python-env.ts.
 * ════════════════════════════════════════════════════════════════════════ */
/** Route handler for `/dsh-additive/python-env*` (exported for tests). */
export async function handlePythonEnvRequest(req, res, readConfig, ctx) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    const config = readConfig();
    try {
        if (pathname === '/dsh-additive/python-env') {
            if (method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            const info = resolvePythonEnv(config);
            const venv = dshVenvStatus();
            // A `missing` status with no existing DSH venv is the "needs install" case.
            const needsInstall = info.status === 'missing' && !venv.exists;
            sendJson(res, 200, {
                ok: true,
                info,
                venv,
                needsInstall,
                pythonPath: config.pythonPath,
            });
            return;
        }
        if (pathname === '/dsh-additive/python-env/install') {
            if (method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            const ensured = ensureVenv();
            ctx.logger?.info(`[additive] Python 虚拟环境${ensured.installed ? '已创建' : '已存在'}: ${ensured.python}`);
            sendJson(res, 200, { ok: true, ...ensured });
            return;
        }
        if (pathname === '/dsh-additive/python-env/agents') {
            if (method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
                return;
            }
            // Resolve; when nothing is resolvable, install the one-shot DSH venv so
            // the recorded environment is always a usable path.
            let info = resolvePythonEnv(config);
            if (info.status === 'missing') {
                const ensured = ensureVenv();
                info = {
                    status: 'configured',
                    kind: 'dsh-venv',
                    path: ensured.python,
                    version: ensured.version,
                    description: `DSH 自动安装的虚拟环境（${ensured.installed ? '已创建' : '已存在'}）`,
                };
            }
            const result = await writePythonEnvToAgents(info);
            ctx.logger?.info(`[additive] Python 环境已写入 ${result.displayPath}（${result.replaced ? '替换标记块' : '追加标记块'}）→ ${result.path}`);
            sendJson(res, 200, { ok: true, ...result });
            return;
        }
        sendJson(res, 404, { ok: false, error: 'not-found' });
    }
    catch (error) {
        if (error instanceof PythonEnvError) {
            sendJson(res, 400, { ok: false, error: error.code, message: error.message });
            return;
        }
        ctx.logger?.warn(`[additive] Python 环境请求失败: ${String(error)}`);
        sendJson(res, 500, { ok: false, error: 'internal' });
    }
}
/** Buffer the request body with a hard size cap; capture its content type. */
async function readUploadBody(req) {
    const mediaType = (req.headers['content-type'] ?? '').split(';')[0]?.trim() || null;
    const chunks = [];
    let total = 0;
    try {
        for await (const chunk of req) {
            total += chunk.length;
            if (total > MAX_LOGO_BYTES + 64 * 1024) {
                // Stop buffering well past the cap — the store will reject it.
                throw new LogoStoreError('too-large', `logo exceeds ${MAX_LOGO_BYTES} bytes`);
            }
            chunks.push(Buffer.from(chunk));
        }
    }
    catch (error) {
        if (error instanceof LogoStoreError)
            throw error;
        throw new LogoStoreError('empty-body', 'unreadable request body');
    }
    return { bytes: new Uint8Array(Buffer.concat(chunks)), mediaType };
}
//# sourceMappingURL=index.js.map