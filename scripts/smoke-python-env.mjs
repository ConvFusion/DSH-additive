/**
 * Executable checks for the Python-environment routes.
 *
 * Runs against an isolated DSH_HOME so it never touches the real
 * ~/.dsh/python-env or ~/.dsh/AGENTS.md. Run after `npm run build:host`:
 *
 *   node scripts/smoke-python-env.mjs
 */
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const tmp = await mkdtemp(join(tmpdir(), 'dsh-additive-pyenv-'))
const home = join(tmp, 'home')
await mkdir(home, { recursive: true })
process.env.DSH_HOME = home

const pyenv = await import('../lib/python-env.js')
const { handlePythonEnvRequest } = await import('../lib/index.js')

let checks = 0
let failures = 0

function check(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function fakeRes() {
  const state = { status: 0, body: null, headers: {} }
  return {
    state,
    res: {
      statusCode: 0,
      setHeader: (k, v) => {
        state.headers[k] = v
      },
      end(payload) {
        state.status = this.statusCode
        state.body = payload
      },
    },
  }
}

function fakeReq(url, method = 'GET') {
  const req = Readable.from([])
  req.url = url
  req.method = method
  return req
}

async function call(url, method = 'GET', config = { inputHistoryEnabled: false, workspaceDir: '', pythonPath: '' }) {
  const { res, state } = fakeRes()
  const ctx = {
    get: (name) => (name === 'workspaceRegistry' ? { list: () => [] } : undefined),
    logger: { info: () => {}, warn: (m) => console.log('  [warn] ' + m) },
  }
  await handlePythonEnvRequest(fakeReq(url, method), res, () => config, ctx)
  return { status: state.status, json: state.body === null ? null : JSON.parse(state.body) }
}

console.log('resolve: missing + DSH venv not yet created (empty pythonPath)')
{
  const r = await call('/dsh-additive/python-env')
  check('GET 200', r.status === 200, JSON.stringify(r.json))
  // Either 'system' (a system python exists on this machine) or 'missing' —
  // both are legitimate; assert the response shape holds either way.
  check('status is a known value', ['system', 'configured', 'missing'].includes(r.json.info.status), r.json.info.status)
  check('venv reported not created yet', r.json.venv.exists === false, JSON.stringify(r.json.venv))
  check('needsInstall consistent', r.json.needsInstall === (r.json.info.status === 'missing' && !r.json.venv.exists))
}

console.log('resolve: configured interpreter path')
{
  const r = await call('/dsh-additive/python-env', 'GET', {
    inputHistoryEnabled: false,
    workspaceDir: '',
    pythonPath: '/usr/bin/python3',
  })
  check('configured status', r.json.info.status === 'configured', r.json.info.status)
  check('configured path echoes the input', r.json.info.path === '/usr/bin/python3', r.json.info.path)
  check('not missing → no install needed', r.json.needsInstall === false)
}

console.log('write AGENTS.md: records the resolved interpreter (system here, venv if none)')
{
  const r = await call('/dsh-additive/python-env/agents', 'POST', {
    inputHistoryEnabled: false,
    workspaceDir: '',
    pythonPath: '',
  })
  check('agents write 200', r.status === 200, JSON.stringify(r))
  check('replaced flag present', typeof r.json.replaced === 'boolean')
  const agentsPath = join(home, 'AGENTS.md')
  const content = await readFile(agentsPath, 'utf8')
  check('AGENTS.md created with markers', content.includes(pyenv.AGENTS_BLOCK_START) && content.includes(pyenv.AGENTS_BLOCK_END))
  // Whatever environment resolved (system or DSH venv), its interpreter path
  // must be recorded verbatim in the block.
  check('records the resolved interpreter path', content.includes(r.json.path), `path=${r.json.path}`)
  check('section titled "## Python 环境"', content.includes('## Python 环境'))
}

console.log('idempotent second write replaces, not appends')
{
  const before = await readFile(join(home, 'AGENTS.md'), 'utf8')
  const r = await call('/dsh-additive/python-env/agents', 'POST')
  check('second write 200', r.status === 200)
  check('replaced=true on second write', r.json.replaced === true)
  const after = await readFile(join(home, 'AGENTS.md'), 'utf8')
  check('no duplicate marker block', after.split(pyenv.AGENTS_BLOCK_START).length === 2, `start count=${after.split(pyenv.AGENTS_BLOCK_START).length - 1}`)
  void before
}

console.log('user content outside the managed block survives')
{
  const agentsPath = join(home, 'AGENTS.md')
  const existing = await readFile(agentsPath, 'utf8')
  const userLine = '# 手工写的其它小节（应保留）\n'
  await (await import('node:fs/promises')).writeFile(agentsPath, existing + '\n' + userLine)
  await call('/dsh-additive/python-env/agents', 'POST')
  const after = await readFile(agentsPath, 'utf8')
  check('user line preserved', after.includes(userLine.trim()))
  check('still exactly one managed block', after.split(pyenv.AGENTS_BLOCK_START).length === 2)
}

console.log('install route reports reuse (no re-install)')
{
  const r1 = await call('/dsh-additive/python-env/install', 'POST')
  const r2 = await call('/dsh-additive/python-env/install', 'POST')
  check('first install 200', r1.status === 200)
  check('second install reuses (installed=false)', r2.json.installed === false, JSON.stringify(r2.json))
  check('same interpreter path both times', r1.json.python === r2.json.python, `${r1.json.python} vs ${r2.json.python}`)
}

console.log('configured-but-absent path is honoured verbatim (not auto-corrected)')
{
  const r = await call('/dsh-additive/python-env', 'GET', {
    inputHistoryEnabled: false,
    workspaceDir: '',
    pythonPath: '/definitely/not/a/real/python',
  })
  check('configured status for absent path', r.json.info.status === 'configured', r.json.info.status)
  check('path echoed verbatim', r.json.info.path === '/definitely/not/a/real/python', r.json.info.path)
}

console.log('ensureVenv is idempotent at the function level')
{
  const a = pyenv.ensureVenv()
  const b = pyenv.ensureVenv()
  check('first ensure returns a result', a.python.length > 0)
  check('second ensure reuses (installed=false)', b.installed === false)
  check('both point at the same interpreter', a.python === b.python, `${a.python} vs ${b.python}`)
}

await rm(tmp, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exitCode = 1
