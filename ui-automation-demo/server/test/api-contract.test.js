import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

function startServer() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-automation-demo-'))
  const dataDir = path.join(tmpRoot, 'data', 'testcases')
  const execDir = path.join(tmpRoot, 'data', 'executions')
  const reportDir = path.join(tmpRoot, 'reports')
  fs.mkdirSync(reportDir, { recursive: true })

  const child = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: '0',
      MIDSCENE_MODEL_BASE_URL: '',
      MIDSCENE_MODEL_API_KEY: '',
      MIDSCENE_MODEL_NAME: '',
      UI_AUTOMATION_DATA_DIR: dataDir,
      UI_AUTOMATION_EXEC_DIR: execDir,
      UI_AUTOMATION_REPORT_DIR: reportDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (buf) => {
    output += buf.toString()
  })
  child.stderr.on('data', (buf) => {
    output += buf.toString()
  })

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`启动超时\n${output}`))
    }, 8000)

    const timer = setInterval(() => {
      const m = output.match(/Server listening on http:\/\/localhost:(\d+)/)
      if (m) {
        clearTimeout(timeout)
        clearInterval(timer)
        resolve(Number(m[1]))
      }
    }, 50)

    child.once('exit', (code) => {
      clearTimeout(timeout)
      clearInterval(timer)
      reject(new Error(`进程提前退出 code=${code}\n${output}`))
    })
  })

  return {
    child,
    ready,
    stop: async () => {
      child.kill('SIGTERM')
      await new Promise((resolve) => child.once('exit', resolve))
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    },
  }
}

async function waitFor(fn, timeoutMs = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const val = await fn()
    if (val) return val
    await new Promise((r) => setTimeout(r, 150))
  }
  return null
}

test('创建用例/执行用例/查看报告：接口契约与流程联调', async () => {
  const srv = startServer()
  const port = await srv.ready
  const base = `http://localhost:${port}`

  try {
    const createRes = await fetch(`${base}/api/testcases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '联调创建用例',
        description: '用于接口契约回归测试',
        steps: [{ id: 's1', type: 'action', action: '打开 https://example.com' }],
      }),
    })
    assert.equal(createRes.status, 200)
    const created = await createRes.json()
    assert.ok(created && created.data && typeof created.data.id === 'string')

    const caseId = created.data.id

    const executeRes = await fetch(`${base}/api/execute/${caseId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    assert.equal(executeRes.status, 200)
    const exeStart = await executeRes.json()
    assert.ok(exeStart && exeStart.data && typeof exeStart.data.id === 'string')

    const exeId = exeStart.data.id

    const finalExe = await waitFor(async () => {
      const exRes = await fetch(`${base}/api/executions`)
      const exJson = await exRes.json()
      const list = Array.isArray(exJson?.data) ? exJson.data : []
      const exe = list.find((e) => e.id === exeId)
      if (!exe) return null
      if (exe.status === 'success' || exe.status === 'failed') return exe
      return null
    })

    assert.ok(finalExe, '执行未在超时窗口内结束')
    assert.ok(finalExe.reportPath, '执行结束后应返回 reportPath')

    const reportRes = await fetch(`${base}/reports/${finalExe.reportPath}`)
    assert.equal(reportRes.status, 200)
    const html = await reportRes.text()
    assert.ok(html.startsWith('<!doctype html>') || html.startsWith('<!DOCTYPE html>'))
  } finally {
    await srv.stop()
  }
})

test(
  '并发创建用例：返回唯一 id 且可全部检索',
  { timeout: 30000 },
  async () => {
    const srv = startServer()
    const port = await srv.ready
    const base = `http://localhost:${port}`
    const prefix = `并发创建-${Date.now()}`

    try {
      const n = 80
      const results = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          fetch(`${base}/api/testcases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${prefix}-${i}`,
              description: '并发一致性测试',
              steps: [{ id: 's1', type: 'action', action: '打开 https://example.com' }],
            }),
          }).then(async (res) => {
            assert.equal(res.status, 200)
            const json = await res.json()
            assert.ok(json?.data?.id)
            return json.data.id
          })
        )
      )

      assert.equal(new Set(results).size, results.length, '并发创建返回的 id 应全部唯一')

      const listRes = await fetch(`${base}/api/testcases`)
      assert.equal(listRes.status, 200)
      const listJson = await listRes.json()
      const list = Array.isArray(listJson?.data) ? listJson.data : []
      const found = new Set(list.map((tc) => tc.id))
      for (const id of results) {
        assert.ok(found.has(id), `用例列表中应包含新建用例 ${id}`)
      }
    } finally {
      await srv.stop()
    }
  }
)

test(
  '并发执行用例：生成多条 execution 且报告可访问',
  { timeout: 30000 },
  async () => {
    const srv = startServer()
    const port = await srv.ready
    const base = `http://localhost:${port}`

    try {
      const createRes = await fetch(`${base}/api/testcases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `并发执行-${Date.now()}`,
          description: '并发执行一致性测试',
          steps: [{ id: 's1', type: 'action', action: '打开 https://example.com' }],
        }),
      })
      assert.equal(createRes.status, 200)
      const created = await createRes.json()
      const caseId = created?.data?.id
      assert.ok(typeof caseId === 'string')

      const m = 6
      const exeIds = await Promise.all(
        Array.from({ length: m }, async () => {
          const executeRes = await fetch(`${base}/api/execute/${caseId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
          assert.equal(executeRes.status, 200)
          const exeStart = await executeRes.json()
          assert.ok(typeof exeStart?.data?.id === 'string')
          return exeStart.data.id
        })
      )
      assert.equal(new Set(exeIds).size, exeIds.length, '并发执行返回的 execution id 应全部唯一')

      const finalExecutions = await waitFor(async () => {
        const exRes = await fetch(`${base}/api/executions`)
        assert.equal(exRes.status, 200)
        const exJson = await exRes.json()
        const list = Array.isArray(exJson?.data) ? exJson.data : []
        const done = list.filter(
          (e) => exeIds.includes(e.id) && (e.status === 'success' || e.status === 'failed')
        )
        if (done.length !== m) return null
        return done
      }, 20000)

      assert.ok(finalExecutions, '并发执行未在超时窗口内全部结束')

      for (const exe of finalExecutions) {
        assert.ok(exe.reportPath, `执行 ${exe.id} 结束后应返回 reportPath`)
        const reportRes = await fetch(`${base}/reports/${exe.reportPath}`)
        assert.equal(reportRes.status, 200)
      }

      const casesRes = await fetch(`${base}/api/testcases`)
      assert.equal(casesRes.status, 200)
      const casesJson = await casesRes.json()
      const cases = Array.isArray(casesJson?.data) ? casesJson.data : []
      const tc = cases.find((c) => c.id === caseId)
      assert.ok(tc, '用例列表应包含被执行的用例')
      assert.equal(tc.status, 'done')
      assert.ok(exeIds.some((id) => tc.lastReportPath?.includes(id)), 'lastReportPath 应对应某次执行')
    } finally {
      await srv.stop()
    }
  }
)

test(
  '大数据量：批量创建用例接口耗时与可检索性',
  { timeout: 60000 },
  async () => {
    const srv = startServer()
    const port = await srv.ready
    const base = `http://localhost:${port}`
    const prefix = `perf-${Date.now()}`

    try {
      const total = 300
      const batch = 30
      const t0 = Date.now()

      for (let i = 0; i < total; i += batch) {
        const chunk = Array.from({ length: Math.min(batch, total - i) }, (_, j) => i + j)
        await Promise.all(
          chunk.map((idx) =>
            fetch(`${base}/api/testcases`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `${prefix}-${idx}`,
                description: '性能联调压测',
                steps: [{ id: 's1', type: 'action', action: '打开 https://example.com' }],
              }),
            }).then((res) => assert.equal(res.status, 200))
          )
        )
      }

      const ms = Date.now() - t0
      assert.ok(ms < 20000, `批量创建 ${total} 条用例耗时过长：${ms}ms`)

      const listRes = await fetch(`${base}/api/testcases`)
      assert.equal(listRes.status, 200)
      const listJson = await listRes.json()
      const list = Array.isArray(listJson?.data) ? listJson.data : []
      const cnt = list.filter((tc) => typeof tc?.name === 'string' && tc.name.startsWith(prefix)).length
      assert.equal(cnt, total, '批量创建后应可检索到全部用例')
    } finally {
      await srv.stop()
    }
  }
)
