/**
 * Python-environment resolution + one-shot virtualenv install for dsh-additive.
 *
 * The Settings → Additive page exposes a single optional `pythonPath` field
 * (an interpreter executable or a virtualenv directory). Resolution order:
 *
 *   1. user-configured `pythonPath` (an interpreter, or a venv directory)
 *   2. the system `python3` / `python` found on PATH
 *   3. a DSH-managed virtualenv at `$DSH_HOME/python-env/` (created once)
 *
 * Step 3 is the "never re-install" guarantee: the venv is created only when it
 * does not already exist, and a `write` into AGENTS.md that still finds no
 * resolvable interpreter triggers exactly one `ensure` (idempotent).
 *
 * The resolved environment is what gets recorded / written into
 * `$DSH_HOME/AGENTS.md` (see {@link writePythonEnvToAgents}) so the agent knows
 * which interpreter to use. The block is wrapped in HTML-comment markers so a
 * later save replaces only its own region and never clobbers user content.
 *
 * @module dsh-additive/python-env
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  dshHomePath,
  expandHomePath,
} from '@deepseek-ai/dsh-home-paths'
import {
  resolveGlobalInstructionPath,
  writeInstructionFile,
  type InstructionFileSnapshot,
} from './instructions-store.js'

/** Directory (under the DSH home) that holds the one-shot virtualenv. */
export const PYTHON_ENV_DIR = 'python-env'

/**
 * The venv's python executable for a given directory. A virtualenv created
 * here with `python -m venv <dir>` places the interpreter at
 * `<dir>/bin/python` (POSIX) or `<dir>/Scripts/python.exe` (Windows).
 */
export function venvPythonExe(envDir: string): string {
  return process.platform === 'win32'
    ? join(envDir, 'Scripts', 'python.exe')
    : join(envDir, 'bin', 'python')
}

/** Marker pair that delimits the plugin-managed block inside AGENTS.md. */
export const AGENTS_BLOCK_START = '<!-- dsh-additive:python-env:start -->'
export const AGENTS_BLOCK_END = '<!-- dsh-additive:python-env:end -->'

/** Where the resolved environment comes from. */
export type PythonEnvStatus = 'configured' | 'system' | 'missing'
/** A more specific label of the environment used for display + AGENTS.md. */
export type PythonEnvKind =
  | 'custom-interpreter'
  | 'virtualenv'
  | 'system'
  | 'dsh-venv'

/** The single resolved Python environment the settings page / AGENTS.md use. */
export interface PythonEnvInfo {
  status: PythonEnvStatus
  kind: PythonEnvKind
  /** The interpreter/venv path to record; null when nothing is available yet. */
  path: string | null
  /** e.g. "Python 3.12.8"; null when the interpreter could not be probed. */
  version: string | null
  /** Human-readable summary (which env, why). */
  description: string
}

/** The state of the DSH-managed virtualenv directory. */
export interface DshVenvStatus {
  dir: string
  exists: boolean
  python: string | null
}

/** Result of a virtualenv (create-or-reuse) operation. */
export interface EnsureVenvResult {
  /** false when the venv already existed (reused), true when newly created. */
  installed: boolean
  dir: string
  python: string
  version: string | null
}

/** Result of writing the resolved environment into AGENTS.md. */
export interface PythonEnvWriteResult {
  agentsPath: string
  displayPath: string
  /** true when an existing managed block was replaced, false when appended. */
  replaced: boolean
  path: string
  kind: PythonEnvKind
  version: string | null
  description: string
}

export type PythonEnvErrorCode = 'no-python' | 'venv-failed'

export class PythonEnvError extends Error {
  readonly code: PythonEnvErrorCode
  constructor(code: PythonEnvErrorCode, message: string) {
    super(message)
    this.name = 'PythonEnvError'
    this.code = code
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Interpreter probing
 * ════════════════════════════════════════════════════════════════════════ */

function pythonVersion(exe: string): string | null {
  const r = spawnSync(exe, ['--version'], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''} ${r.stderr ?? ''}`.trim()
  return out ? out : null
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Find a working system interpreter on PATH. `python3` is tried first, then
 * `python`; each is asked for its absolute `sys.executable`, so the returned
 * path is canonical even when the command is a symlink on PATH.
 * @returns the command, absolute executable, and version — or null when no
 * Python interpreter is available on PATH.
 */
export function detectSystemPython():
  | { command: string; executable: string; version: string | null }
  | null {
  for (const command of ['python3', 'python']) {
    const r = spawnSync(command, ['-c', 'import sys; sys.stdout.write(sys.executable)'], {
      encoding: 'utf8',
    })
    if (r.status !== 0) continue
    const executable = (r.stdout ?? '').trim()
    if (executable && existsSync(executable)) {
      return { command, executable, version: pythonVersion(executable) }
    }
  }
  return null
}

/* ════════════════════════════════════════════════════════════════════════
 * DSH-managed virtualenv
 * ════════════════════════════════════════════════════════════════════════ */

/** Describe the `$DSH_HOME/python-env` virtualenv without changing it. */
export function dshVenvStatus(): DshVenvStatus {
  const dir = dshHomePath(PYTHON_ENV_DIR)
  const py = venvPythonExe(dir)
  const exists = existsSync(py)
  return { dir, exists, python: exists ? py : null }
}

/**
 * Ensure the DSH-managed virtualenv exists. If it already does, it is reused
 * as-is (never recreated — the "avoid re-installing" guarantee); otherwise it
 * is created once from the best system interpreter available on PATH.
 * @returns the venv's directory and interpreter path.
 * @throws {PythonEnvError} when no system Python is available, or `venv` fails.
 */
export function ensureVenv(): EnsureVenvResult {
  const status = dshVenvStatus()
  if (status.exists && status.python) {
    return {
      installed: false,
      dir: status.dir,
      python: status.python,
      version: pythonVersion(status.python),
    }
  }
  const sys = detectSystemPython()
  if (!sys) {
    throw new PythonEnvError(
      'no-python',
      `未在本机检测到可用的 Python，无法在 ${status.dir} 创建虚拟环境。` +
        `请安装 Python 或在设置的「Python 路径」中填写已有解释器/虚拟环境。`,
    )
  }
  const r = spawnSync(sys.executable, ['-m', 'venv', status.dir], {
    encoding: 'utf8',
    env: { ...process.env, VIRTUAL_ENV: '', PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (r.status !== 0 || !existsSync(venvPythonExe(status.dir))) {
    throw new PythonEnvError(
      'venv-failed',
      `创建虚拟环境失败（${sys.command} → ${status.dir}）：${(r.stderr || r.stdout || '').trim() || 'unknown'}`,
    )
  }
  const py = venvPythonExe(status.dir)
  return { installed: true, dir: status.dir, python: py, version: pythonVersion(py) }
}

/* ════════════════════════════════════════════════════════════════════════
 * Resolution
 * ════════════════════════════════════════════════════════════════════════ */

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
export function resolvePythonEnv(config: { pythonPath?: string }): PythonEnvInfo {
  const configured = (config.pythonPath ?? '').trim()
  if (configured.length > 0) {
    const expanded = expandHomePath(configured)
    const dir = isDirectory(expanded)
    const py = dir ? venvPythonExe(expanded) : expanded
    const version = existsSync(py) ? pythonVersion(py) : null
    const description = dir
      ? '用户指定的虚拟环境目录'
      : existsSync(expanded)
        ? '用户指定的 Python 解释器'
        : '用户指定路径（当前不存在）'
    return {
      status: 'configured',
      kind: dir ? 'virtualenv' : 'custom-interpreter',
      path: py,
      version,
      description,
    }
  }

  const sys = detectSystemPython()
  if (sys) {
    return {
      status: 'system',
      kind: 'system',
      path: sys.executable,
      version: sys.version,
      description: `本机系统 Python（${sys.command}）`,
    }
  }

  return {
    status: 'missing',
    kind: 'dsh-venv',
    path: null,
    version: null,
    description: '未检测到 Python，需自动安装虚拟环境',
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * Writing the resolved environment into AGENTS.md
 * ════════════════════════════════════════════════════════════════════════ */

/** A neutral run example per environment kind (each bash command is a new shell). */
function runExample(info: PythonEnvInfo): string[] {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin'
  switch (info.kind) {
    case 'dsh-venv':
    case 'virtualenv': {
      const dir = info.path ? join(info.path, '..') : dshHomePath(PYTHON_ENV_DIR)
      // For a venv directory, `path` is its interpreter; activate from the env.
      const activate = process.platform === 'win32' ? join(dir, 'Scripts', 'activate.bat') : join(dir, bin, 'activate')
      return [
        `# 激活 DSH 虚拟环境并运行`,
        `source "${activate}" && python your_script.py`,
      ]
    }
    case 'system':
    case 'custom-interpreter':
    default:
      return [`${info.path ?? 'python'} your_script.py`]
  }
}

function buildAgentsBlock(info: PythonEnvInfo): string {
  const lines: string[] = [
    AGENTS_BLOCK_START,
    '## Python 环境',
    '',
    '- 使用以下 Python 环境（由 **DSH Additive → 设置 → Python 环境** 自动生成与管理，' +
      '标记块 `<!-- dsh-additive:python-env:* -->` 内的内容由插件维护，请勿手工修改）：',
    `  - 路径：\`${info.path ?? '（未解析，需先自动安装）'}\``,
  ]
  if (info.version) lines.push(`  - 版本：${info.version}`)
  lines.push(`  - 说明：${info.description}`)
  lines.push('- 运行示例（每条 bash 命令都是独立 shell，激活与运行要放在同一条命令里）：')
  lines.push('  ```bash')
  for (const ex of runExample(info)) lines.push(`  ${ex}`)
  lines.push('  ```')
  lines.push('')
  lines.push(AGENTS_BLOCK_END)
  return lines.join('\n')
}

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
export async function writePythonEnvToAgents(
  info: PythonEnvInfo,
): Promise<PythonEnvWriteResult> {
  const { path, displayPath } = resolveGlobalInstructionPath()
  const block = buildAgentsBlock(info)

  let current = ''
  if (existsSync(path)) {
    try {
      current = await readFile(path, 'utf8')
    } catch {
      current = ''
    }
  }

  let next: string
  let replaced = false
  const startIdx = current.indexOf(AGENTS_BLOCK_START)
  const endIdx = current.indexOf(AGENTS_BLOCK_END)
  if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
    const after = current.slice(endIdx + AGENTS_BLOCK_END.length)
    const glue = after.length > 0 ? '\n' : ''
    next = current.slice(0, startIdx) + block + glue + after
    replaced = true
  } else {
    const prefix = current.length > 0 ? (current.endsWith('\n') ? current : `${current}\n`) : ''
    next = prefix + '\n' + block
  }

  const snapshot: InstructionFileSnapshot = await writeInstructionFile(
    'global',
    path,
    next,
    { baseSha256: null },
    displayPath,
  )
  return {
    agentsPath: snapshot.path,
    displayPath: snapshot.displayPath,
    replaced,
    path: info.path ?? '',
    kind: info.kind,
    version: info.version,
    description: info.description,
  }
}
