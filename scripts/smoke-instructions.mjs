/**
 * Executable checks for the instruction-file store and its HTTP routes.
 *
 * Runs against an isolated `DSH_HOME` and a throwaway workspace directory, so
 * it never touches the real ~/.dsh/AGENTS.md. Run after `npm run build:host`:
 *
 *   node scripts/smoke-instructions.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const tmp = await mkdtemp(join(tmpdir(), 'dsh-additive-smoke-'))
const home = join(tmp, 'home')
const workspace = join(tmp, 'workspace')
await (await import('node:fs/promises')).mkdir(workspace, { recursive: true })
process.env.DSH_HOME = home

const store = await import('../lib/instructions-store.js')
const { handleInstructionsRequest } = await import('../lib/index.js')

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

function fakeReq(url, method = 'GET', body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.url = url
  req.method = method
  return req
}

async function call(url, method = 'GET', body) {
  const { res, state } = fakeRes()
  const ctx = {
    get: (name) => (name === 'workspaceRegistry' ? { list: () => [{ id: 'w1', title: 'demo', path: workspace }] } : undefined),
    logger: { info: () => {}, warn: () => {} },
  }
  await handleInstructionsRequest(fakeReq(url, method, body), res, () => ({ inputHistoryEnabled: false, workspaceDir: '' }), ctx)
  return { status: state.status, json: state.body === null ? null : JSON.parse(state.body) }
}

console.log('paths')
const globalPath = store.resolveGlobalInstructionPath()
check('global path honours $DSH_HOME', globalPath.path === join(home, 'AGENTS.md'), globalPath.path)
check('global display is symbolic', globalPath.displayPath === '$DSH_HOME/AGENTS.md', globalPath.displayPath)
check(
  'local path is <dir>/AGENTS.local.md',
  store.resolveLocalInstructionPath(workspace) === join(workspace, 'AGENTS.local.md'),
)
let threw = false
try {
  store.resolveLocalInstructionPath('relative/dir')
} catch (error) {
  threw = error.code === 'not-found'
}
check('relative workspace dir is rejected', threw)

console.log('happy path (global + local)')
let responded = await call('/dsh-additive/instructions')
check('GET 200', responded.status === 200, JSON.stringify(responded.json))
check('global not present yet', responded.json.target.global.exists === false)
check('workspace resolved from registry', responded.json.workspaceDir === workspace)
check('local not present yet', responded.json.target.local.exists === false)

responded = await call('/dsh-additive/instructions/global', 'POST', {
  content: '# global\n',
  baseSha256: null,
})
check('global write 200', responded.status === 200, JSON.stringify(responded.json))
check('global bytes', responded.json.target.global.bytes === 9)
check('file created on disk', (await readFile(globalPath.path, 'utf8')) === '# global\n')

responded = await call('/dsh-additive/instructions/local', 'POST', {
  content: '# local\n',
  baseSha256: null,
})
check('local write 200', responded.status === 200, JSON.stringify(responded.json))
check('local file created', (await readFile(join(workspace, 'AGENTS.local.md'), 'utf8')) === '# local\n')

console.log('hash guard')
responded = await call('/dsh-additive/instructions/global', 'POST', {
  content: '# stale\n',
  baseSha256: 'deadbeef',
})
check('stale hash is 409', responded.status === 409, JSON.stringify(responded.json))
check('disk content untouched', (await readFile(globalPath.path, 'utf8')) === '# global\n')

const fresh = await call('/dsh-additive/instructions')
responded = await call('/dsh-additive/instructions/global', 'POST', {
  content: '# global v2\n',
  baseSha256: fresh.json.target.global.sha256,
})
check('fresh hash is accepted', responded.status === 200, JSON.stringify(responded.json))
check('disk content replaced', (await readFile(globalPath.path, 'utf8')) === '# global v2\n')

console.log('limits and validation')
responded = await call('/dsh-additive/instructions/global', 'POST', {
  content: 'x'.repeat(store.MAX_INSTRUCTION_BYTES + 1),
  baseSha256: null,
})
check('oversize write is 413', responded.status === 413, JSON.stringify(responded.json))

responded = await call('/dsh-additive/instructions/global', 'POST', { content: 42 })
check('non-string content is 400', responded.status === 400, JSON.stringify(responded.json))

responded = await call('/dsh-additive/instructions/global', 'DELETE')
check('wrong method is 405', responded.status === 405)

responded = await call('/dsh-additive/instructions/workspaces')
check('workspace list has the registry entry', responded.json.workspaces?.[0]?.path === workspace)

console.log('path boundary')
const handcrafted = await call(`/dsh-additive/instructions?workspace=${encodeURIComponent('/definitely/not/here')}`)
check('unknown workspace dir is 404', handcrafted.status === 404, JSON.stringify(handcrafted.json))
check('nothing was created for it', (await readFile(join('/definitely', 'not', 'here'), 'utf8').catch(() => null)) === null)

// A workspace path that ends in a separator must still target exactly one file.
await writeFile(join(workspace, 'unrelated.md'), 'keep me\n')
responded = await call('/dsh-additive/instructions/local', 'POST', {
  content: '# local v2\n',
  baseSha256: null,
  workspace,
})
check('write with explicit workspace', responded.status === 200, JSON.stringify(responded.json))
check('sibling file untouched', (await readFile(join(workspace, 'unrelated.md'), 'utf8')) === 'keep me\n')

await rm(tmp, { recursive: true, force: true })

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) process.exitCode = 1
