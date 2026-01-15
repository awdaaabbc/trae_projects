import 'dotenv/config'
import exp from 'express'
import type { Request, Response, NextFunction } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Storage } from './storage.js'
import type { Execution, TestCase } from './types.js'
import { runTestCase as runWebTestCase, cancelExecution as cancelWebExecution } from './runner.js'
import {
  runTestCase as runAndroidTestCase,
  cancelExecution as cancelAndroidExecution,
} from './runner.android.js'
import {
  runTestCase as runIosTestCase,
  cancelExecution as cancelIosExecution,
  terminateApp as terminateIosApp,
} from './runner.ios.js'
import { initCron, generateDailyReport } from './cron.js'
import type { AgentToServerMessage, ServerToAgentMessage, AgentInfo } from './protocol.js'

const app = exp()

// Initialize Cron Jobs
initCron()
app.use(exp.json())

// Serve MidScene reports statically
const reportDir = process.env.UI_AUTOMATION_REPORT_DIR
  ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
  : path.resolve(process.cwd(), 'midscene_run', 'report')
app.use('/reports', exp.static(reportDir))

// Serve Frontend Static Files (Production)
const clientDist = path.join(process.cwd(), 'dist', 'client')
if (fs.existsSync(clientDist)) {
  // 1. Serve static assets
  app.use(exp.static(clientDist))
}

app.use((req, res, next) => {
  const requestId = crypto.randomUUID()
  const startedAt = Date.now()
  ;(req as Request & { requestId?: string }).requestId = requestId
  res.setHeader('x-request-id', requestId)
  res.on('finish', () => {
    const ms = Date.now() - startedAt
    const line = `${new Date().toISOString()} ${requestId} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`
    if (res.statusCode >= 500) console.error(line)
    else console.log(line)
  })
  next()
})

function normalizeReportPath(p: string | undefined) {
  if (!p) return undefined
  const base = path.basename(p)
  if (!base || base === '.' || base === path.sep) return p
  return base
}

type QueueJob = {
  exeId: string
  caseId: string
}

const MAX_CONCURRENCY = process.env.UI_AUTOMATION_MAX_CONCURRENCY
  ? Math.max(1, Number(process.env.UI_AUTOMATION_MAX_CONCURRENCY) || 5)
  : 5

const queue: QueueJob[] = []
const queuedByExeId = new Map<string, QueueJob>()
let runningCount = 0

function isCaseActive(caseId: string) {
  return Storage.listExecutions().some(
    (e) => e.caseId === caseId && (e.status === 'queued' || e.status === 'running'),
  )
}

function ensureCaseStatusAfterExecution(
  caseId: string,
  last: { status: 'done' | 'error'; reportPath?: string },
) {
  const active = isCaseActive(caseId)
  const patch: Partial<TestCase> = active
    ? { status: 'running' }
    : {
        status: last.status,
        lastRunAt: Date.now(),
        lastReportPath: last.reportPath,
      }
  Storage.updateCase(caseId, patch)
  broadcast({ type: 'testcase', payload: Storage.getCase(caseId) })
}

function appendExecutionLog(exeId: string, line: string) {
  const exe = Storage.getExecution(exeId)
  const prev = Array.isArray(exe?.logs) ? exe.logs : []
  const next = prev.length >= 200 ? prev.slice(prev.length - 199) : prev
  const logs = [...next, `${new Date().toISOString()} ${line}`]
  Storage.updateExecution(exeId, { logs })
  broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
}

function enqueue(job: QueueJob) {
  queue.push(job)
  queuedByExeId.set(job.exeId, job)
  pumpQueue()
}

function removeQueued(exeId: string) {
  const job = queuedByExeId.get(exeId)
  if (!job) return false
  queuedByExeId.delete(exeId)
  const idx = queue.findIndex((j) => j.exeId === exeId)
  if (idx >= 0) queue.splice(idx, 1)
  return true
}

function pumpQueue() {
  while (runningCount < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!
    if (!queuedByExeId.has(job.exeId)) continue
    void runJob(job)
  }
}

async function runJob(job: QueueJob) {
  const { exeId, caseId } = job
  queuedByExeId.delete(exeId)
  runningCount += 1

  try {
    const tc = Storage.getCase(caseId)
    const execution = Storage.getExecution(exeId)
    if (!tc || !execution) {
      Storage.updateExecution(exeId, {
        status: 'failed',
        progress: 100,
        errorMessage: '测试用例或执行记录不存在',
      })
      broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
      appendExecutionLog(exeId, 'failed: testcase or execution missing')
      return
    }

    Storage.updateExecution(exeId, { status: 'running', progress: 0 })
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    appendExecutionLog(exeId, 'started')

    let runner
    if (tc.platform === 'android') {
      // runner = runAndroidTestCase
      // Use remote runner for Android if enabled, or check if we have agents
      runner = (t: TestCase, e: string, cb: any) => runRemoteTestCase(t, e, cb, execution.targetAgentId)
    } else if (tc.platform === 'ios') {
      // runner = runIosTestCase
      runner = (t: TestCase, e: string, cb: any) => runRemoteTestCase(t, e, cb, execution.targetAgentId)
    } else {
      runner = runWebTestCase
    }

    const result = await runner(tc, exeId, (patch: Partial<Execution>) => {
      const normalizedPatch =
        patch.reportPath ? { ...patch, reportPath: normalizeReportPath(patch.reportPath) } : patch
      Storage.updateExecution(exeId, normalizedPatch)
      broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    })

    const finalReportPath = normalizeReportPath(result.reportPath)
    Storage.updateExecution(exeId, {
      status: result.status === 'success' ? 'success' : 'failed',
      progress: 100,
      reportPath: finalReportPath,
      errorMessage: result.errorMessage,
    })
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })

    if (finalReportPath) {
      Storage.updateCase(caseId, {
        lastRunAt: Date.now(),
        lastReportPath: finalReportPath,
      })
      broadcast({ type: 'testcase', payload: Storage.getCase(caseId) })
    }

    // 移动端执行完毕后，无论成功失败，自动尝试终止测试应用
    if (tc.platform === 'ios') {
      let bundleId = 'com.xuexiaosi.saas' // 默认：乐读test-ad

      // 尝试从 context 中获取 bundleId
      if (tc.context) {
        try {
          const ctx = JSON.parse(tc.context)
          if (ctx.bundleId) {
            bundleId = ctx.bundleId
          }
        } catch (e) {
          // ignore parsing error
        }
      }

      console.log(`[Auto-Terminate] Attempting to terminate app: ${bundleId}`)
      terminateIosApp(exeId, bundleId).catch(e => console.error(`Failed to auto-terminate app ${bundleId}:`, e))
    }

    const caseFinalStatus = result.status === 'success' ? 'done' : 'error'
    ensureCaseStatusAfterExecution(caseId, { status: caseFinalStatus, reportPath: finalReportPath })
    appendExecutionLog(exeId, caseFinalStatus === 'done' ? 'finished: success' : 'finished: failed')
  } catch (err) {
    Storage.updateExecution(exeId, {
      status: 'failed',
      errorMessage: err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err),
      progress: 100,
    })
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    ensureCaseStatusAfterExecution(caseId, { status: 'error' })
    appendExecutionLog(exeId, `failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    runningCount = Math.max(0, runningCount - 1)
    pumpQueue()
  }
}

// Basic health endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
})

// Agents API
app.get('/api/agents', (_req: Request, res: Response) => {
  const list = Array.from(agents.values())
  res.json({ data: list })
})

// Test Case APIs
app.get('/api/testcases', (_req: Request, res: Response) => {
  res.json({ data: Storage.listCases() })
})

app.post('/api/testcases', (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<TestCase> & { id?: string }
    const id = body.id || crypto.randomUUID()
    const existing = Storage.getCase(id)
    const platform =
      body.platform === 'android'
        ? 'android'
        : body.platform === 'ios'
          ? 'ios'
          : body.platform === 'web'
            ? 'web'
            : existing?.platform || 'web'
    
    const tc: TestCase = {
      id,
      name: body.name || '',
      description: body.description || '',
      platform,
      context: body.context,
      steps: Array.isArray(body.steps) ? body.steps : [],
      status: existing ? existing.status : 'idle',
      lastRunAt: existing?.lastRunAt,
      lastReportPath: existing?.lastReportPath,
    }
    Storage.saveCase(tc)
    res.json({ data: tc })
  } catch (err) {
    console.error('Failed to create test case:', err)
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: `创建测试用例失败: ${msg}` })
  }
})

app.put('/api/testcases/:id', (req: Request, res: Response) => {
  const id = req.params.id
  const tc = Storage.getCase(id)
  if (!tc) return res.status(404).json({ error: '未找到测试用例' })
  const body = req.body as Partial<TestCase>

  const updated: TestCase = {
    ...tc,
    name: body.name || tc.name,
    description: body.description || tc.description,
    platform:
      body.platform === 'android'
        ? 'android'
        : body.platform === 'web'
          ? 'web'
          : tc.platform,
    context: body.context !== undefined ? body.context : tc.context,
    steps: Array.isArray(body.steps) ? body.steps : tc.steps,
  }
  Storage.saveCase(updated)
  res.json({ data: updated })
})

// Executions APIs
app.get('/api/executions', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const pageSize = parseInt(req.query.pageSize as string) || 1000 // Default high limit for backward compatibility
    const caseId = req.query.caseId as string | undefined
    const offset = (page - 1) * pageSize
    
    const data = Storage.listExecutions(pageSize, offset, caseId)
    const total = Storage.countExecutions(caseId)
    
    res.json({ 
      data, 
      total,
      page,
      pageSize
    })
  } catch (err) {
    console.error('Failed to list executions:', err)
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: `获取执行列表失败: ${msg}` })
  }
})

app.get('/api/executions/:id', (req: Request, res: Response) => {
  const exe = Storage.getExecution(req.params.id)
  if (!exe) return res.status(404).json({ error: '未找到执行记录' })
  res.json({ data: exe })
})

app.get('/api/executions/:id/report', (req: Request, res: Response) => {
  const exe = Storage.getExecution(req.params.id)
  if (!exe) return res.status(404).json({ error: '未找到执行记录' })
  
  if (!exe.reportPath) {
    return res.status(404).json({ error: '报告尚未生成或生成失败' })
  }

  // Redirect to the static file path
  // Assumes /reports is mounted to the report directory
  res.redirect(`/reports/${exe.reportPath}`)
})

app.post('/api/run-raw', (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<TestCase> & { targetAgentId?: string }
    
    // Validate required fields
    if (!body.platform || !['web', 'android', 'ios'].includes(body.platform)) {
      return res.status(400).json({ error: 'Missing or invalid platform (web, android, ios)' })
    }
    if (!Array.isArray(body.steps) || body.steps.length === 0) {
      return res.status(400).json({ error: 'Missing or empty steps array' })
    }

    // Parse steps to identify Query/Assert
    const parsedSteps = body.steps.map((step: any) => {
      // If type is already explicitly set, trust it
      if (step.type) return step

      let action = step.action || ''
      let type = 'action'
      const lower = action.toLowerCase().trim()

      if (
        lower.startsWith('assert:') ||
        lower.startsWith('断言：') ||
        lower.startsWith('断言:') ||
        lower.startsWith('检查：') ||
        lower.startsWith('check:')
      ) {
        type = 'assert'
        action = action.replace(/^(assert|断言|检查|check)[:：]\s*/i, '')
      } else if (
        lower.startsWith('query:') ||
        lower.startsWith('查询：') ||
        lower.startsWith('查询:') ||
        lower.startsWith('ask:') ||
        lower.startsWith('询问：')
      ) {
        type = 'query'
        action = action.replace(/^(query|查询|ask|询问)[:：]\s*/i, '')
      }

      return {
        ...step,
        action,
        type,
      }
    })

    // Create a temporary test case
    const caseId = `temp-${crypto.randomUUID()}`
    const tc: TestCase = {
      id: caseId,
      name: body.name || `Dynamic Case ${new Date().toLocaleString()}`,
      description: body.description || 'Dynamic execution from API',
      platform: body.platform,
      context: body.context,
      steps: parsedSteps,
      status: 'idle'
    }
    
    // Save the temporary case so runner can find it
    // Note: We might want a cleanup strategy for these later
    Storage.saveCase(tc)
    
    // Create execution
    const exeId = Storage.generateExecutionId(tc.name)
    const createdAt = Date.now()
    const exe: Execution = {
      id: exeId,
      caseId: caseId,
      status: 'queued',
      progress: 0,
      createdAt,
      updatedAt: createdAt,
      fileName: 'dynamic-request', // Marker for dynamic requests
      targetAgentId: body.targetAgentId,
    }
    
    Storage.saveExecution(exe)
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    appendExecutionLog(exeId, 'queued (dynamic)')
    enqueue({ exeId, caseId })
    
    res.json({ 
      data: {
        executionId: exeId,
        caseId: caseId,
        execution: Storage.getExecution(exeId)
      }
    })

  } catch (err) {
    console.error('Failed to run current case:', err)
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: `执行失败: ${msg}` })
  }
})

app.post('/api/execute/:id', async (req: Request, res: Response) => {
  const id = req.params.id
  const { targetAgentId } = req.body as { targetAgentId?: string }
  const tc = Storage.getCase(id)
  if (!tc) return res.status(404).json({ error: '未找到测试用例' })

  const fileName = Storage.getCaseFilename(id)
  console.log(`Executing case: ${tc.name}, File: ${fileName}, Agent: ${targetAgentId || 'Any'}`)

  Storage.updateCase(id, { status: 'running' })
  const exeId = Storage.generateExecutionId(tc.name)
  const createdAt = Date.now()
  const exe: Execution = {
    id: exeId,
    caseId: id,
    status: 'queued',
    progress: 0,
    createdAt,
    updatedAt: createdAt,
    fileName,
    targetAgentId,
  }
  Storage.saveExecution(exe)
  broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
  appendExecutionLog(exeId, 'queued')
  enqueue({ exeId, caseId: id })
  res.json({ data: Storage.getExecution(exeId) })
})

app.post('/api/batch-execute', (req: Request, res: Response) => {
  const body = req.body as { caseIds?: unknown }
  const caseIdsRaw = body?.caseIds
  const caseIds = Array.isArray(caseIdsRaw) ? caseIdsRaw.filter((x) => typeof x === 'string') : []

  if (caseIds.length === 0) {
    return res.status(400).json({ error: 'caseIds 不能为空数组' })
  }

  const missing = caseIds.filter((id) => !Storage.getCase(id))
  if (missing.length > 0) {
    return res.status(404).json({ error: `未找到测试用例: ${missing.join(', ')}` })
  }

  const batchId = crypto.randomUUID()
  const executionsCreated: Execution[] = []

  // 辅助函数：根据平台判断是否需要添加"返回主界面"步骤
  const shouldAddReturnHome = (platform: string) => {
    return platform === 'android' || platform === 'ios'
  }

  for (const id of caseIds) {
    const tc = Storage.getCase(id)!
    
    // 如果是移动端用例，自动追加"返回主界面"步骤
    if (shouldAddReturnHome(tc.platform)) {
      // 检查最后一步是否已经是返回主界面，避免重复添加
      const lastStep = tc.steps[tc.steps.length - 1]
      const lastAction = lastStep?.action?.toLowerCase() || ''
      const isAlreadyHome = lastAction.includes('返回主界面') || lastAction.includes('回到桌面') || lastAction.includes('home') || lastAction.includes('关闭')
      
      if (!isAlreadyHome) {
        // 注意：这里我们修改的是内存中的 tc 对象，不会保存到数据库
        // Runner 会使用内存中的 steps 执行
        tc.steps = [
          ...tc.steps,
          {
            id: crypto.randomUUID(),
            type: 'action',
            action: '打开最近任务页面，清除当前应用，并返回桌面 (Auto-added by Batch Execution)',
          }
        ]
        console.log(`[Batch] Auto-appended 'Return Home' step to case ${tc.name} (${tc.id})`)
      }
    }

    const fileName = Storage.getCaseFilename(id)

    Storage.updateCase(id, { status: 'running' })
    broadcast({ type: 'testcase', payload: Storage.getCase(id) })

    const exeId = Storage.generateExecutionId(tc.name)
    const createdAt = Date.now()
    const exe: Execution = {
      id: exeId,
      caseId: id,
      batchId,
      status: 'queued',
      progress: 0,
      createdAt,
      updatedAt: createdAt,
      fileName,
    }
    Storage.saveExecution(exe)
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    appendExecutionLog(exeId, `queued: batch ${batchId}`)
    enqueue({ exeId, caseId: id })
    const saved = Storage.getExecution(exeId)
    if (saved) executionsCreated.push(saved)
  }

  res.json({
    data: {
      batchId,
      executions: executionsCreated,
    },
  })
})

app.post('/api/stop-execution/:id', (req: Request, res: Response) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ error: 'Missing execution ID' })

  const exe = Storage.getExecution(id)
  if (!exe) return res.status(404).json({ error: 'Execution not found or already finished' })

  if (removeQueued(id)) {
    Storage.updateExecution(id, { status: 'failed', errorMessage: 'Cancelled', progress: 100 })
    broadcast({ type: 'execution', payload: Storage.getExecution(id) })
    appendExecutionLog(id, 'cancelled: removed from queue')
    ensureCaseStatusAfterExecution(exe.caseId, { status: 'error' })
    return res.json({ ok: true })
  }

  const tc = exe ? Storage.getCase(exe.caseId) : undefined
  const success =
    tc?.platform === 'android'
      ? cancelRemoteExecution(id) || cancelAndroidExecution(id)
      : tc?.platform === 'ios'
        ? cancelRemoteExecution(id) || cancelIosExecution(id)
        : tc?.platform === 'web'
          ? cancelWebExecution(id)
          : cancelWebExecution(id) || cancelRemoteExecution(id)
  if (success) {
    appendExecutionLog(id, 'cancel requested')
    res.json({ ok: true })
  } else {
    res.status(404).json({ error: 'Execution not found or already finished' })
  }
})

app.delete('/api/testcases/:id', (req: Request, res: Response) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ error: 'Missing test case ID' })

  const success = Storage.deleteCase(id)
  if (success) {
    res.status(204).send()
  } else {
    res.status(404).json({ error: 'Test case not found' })
  }
})

app.post('/api/admin/reset-status', (_req: Request, res: Response) => {
  try {
    const count = Storage.resetPendingExecutions()
    broadcast({ type: 'error', payload: { message: `已强制重置 ${count} 个异常状态任务` } })
    // Also broadcast full refresh
    res.json({ data: { count } })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/admin/stop-all', (_req: Request, res: Response) => {
  try {
    const runningOrQueued = Storage.listExecutions().filter(
      (e) => e.status === 'running' || e.status === 'queued'
    )

    let count = 0
    for (const exe of runningOrQueued) {
      const id = exe.id
      let stopped = false

      // 1. Try to remove from queue first
      if (removeQueued(id)) {
        stopped = true
        appendExecutionLog(id, 'force stopped: removed from queue')
      } else {
        // 2. Try to cancel running process
        // We don't know for sure if it's web or android without checking the case, 
        // but it's safe to try both or check the case platform.
        const tc = Storage.getCase(exe.caseId)
        const isAndroid = tc?.platform === 'android'
        const isIos = tc?.platform === 'ios'
        const isWeb = tc?.platform === 'web'

        if (isAndroid) {
           if (cancelAndroidExecution(id)) stopped = true
        } else if (isIos) {
           if (cancelIosExecution(id)) stopped = true
        } else if (isWeb) {
           if (cancelWebExecution(id)) stopped = true
        } else {
           // Fallback if platform unknown
           if (cancelWebExecution(id)) stopped = true
           if (cancelAndroidExecution(id)) stopped = true
           if (cancelIosExecution(id)) stopped = true
        }
        
        if (stopped) {
           appendExecutionLog(id, 'force stopped: process cancelled')
        } else {
           appendExecutionLog(id, 'force stopped: process not found, resetting status')
        }
      }

      // 3. Force update status regardless of whether we found the process
      // This ensures no zombie "running" states remain in DB
      Storage.updateExecution(id, {
        status: 'failed',
        errorMessage: '强制停止所有任务',
        progress: 100
      })
      broadcast({ type: 'execution', payload: Storage.getExecution(id) })
      
      // Update case status
      ensureCaseStatusAfterExecution(exe.caseId, { status: 'error' })
      
      count++
    }

    res.json({ data: { count } })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/admin/trigger-daily-report', async (_req: Request, res: Response) => {
  try {
    const reportPath = await generateDailyReport()
    res.json({ data: { message: 'Daily report generated', path: reportPath } })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  const requestId = (req as Request & { requestId?: string }).requestId || '-'
  console.error(`[error] ${requestId} ${req.method} ${req.originalUrl}`, err)
  if (res.headersSent) return next(err as Error)

  const anyErr = err as { type?: unknown }
  const isJsonSyntaxError = err instanceof SyntaxError && anyErr.type === 'entity.parse.failed'
  if (isJsonSyntaxError) {
    res.status(400).json({ error: '无效的 JSON 请求体' })
    return
  }

  res.status(500).json({ error: '服务器内部错误' })
})

// WebSocket for status updates
const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

type WSMessage =
  | { type: 'execution'; payload: Execution | undefined }
  | { type: 'testcase'; payload: TestCase | undefined }
  | { type: 'error'; payload: { message: string } }

const clients = new Set<WebSocket>()
const agents = new Map<WebSocket, AgentInfo>()
// Map to track which execution is running on which agent
const executionAgentMap = new Map<string, WebSocket>()
// Map to resolve the promise when remote execution finishes
const remoteExecutionResolvers = new Map<string, (result: any) => void>()

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws)
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as AgentToServerMessage
      if (msg.type === 'REGISTER') {
        const newAgent = msg.payload
        
        // 1. Enforce ID uniqueness: Kick out any existing agent with the same ID
        // Note: We iterate to find all duplicates (though ideally there's only one)
        for (const [existingWs, info] of agents.entries()) {
          if (info.id === newAgent.id) {
            console.log(`[Register] Duplicate Agent ID ${newAgent.id} detected. Closing old connection.`)
            try {
              existingWs.close(1000, 'Duplicate Agent ID')
            } catch (e) {
              // ignore if already closed
            }
            agents.delete(existingWs)
            clients.delete(existingWs)
          }
        }

        // 2. Enforce Name uniqueness: Append suffix if name exists
        let nameCandidate = newAgent.deviceName
        let suffix = 1
        while (true) {
            const nameExists = Array.from(agents.values()).some(a => a.deviceName === nameCandidate && a.id !== newAgent.id)
            if (!nameExists) break
            nameCandidate = `${newAgent.deviceName} (${suffix++})`
        }
        if (nameCandidate !== newAgent.deviceName) {
             console.log(`[Register] Device name collision. Renaming "${newAgent.deviceName}" to "${nameCandidate}"`)
             newAgent.deviceName = nameCandidate
        }

        agents.set(ws, newAgent)
        console.log(`Agent registered: ${newAgent.deviceName} (${newAgent.platform})`)
        // Remove from broadcast clients if we want to isolate traffic, 
        // but keeping it might be useful for debugging if agents also want to receive updates?
        // For now, let's keep it in clients too so it receives broadcast if needed, 
        // but typically agents don't need UI updates.
        clients.delete(ws) 
      } else if (msg.type === 'UPDATE_EXECUTION') {
        const { executionId, patch } = msg.payload
        const normalizedPatch =
          patch.reportPath ? { ...patch, reportPath: normalizeReportPath(patch.reportPath) } : patch
        Storage.updateExecution(executionId, normalizedPatch)
        broadcast({ type: 'execution', payload: Storage.getExecution(executionId) })
      } else if (msg.type === 'TASK_COMPLETED') {
        const { executionId, result, reportContent } = msg.payload
        console.log(`[Server] Received TASK_COMPLETED for ${executionId}. Status: ${result.status}`)
        
        // Save report content if provided
        if (result.reportPath && reportContent) {
           const reportRoot = process.env.UI_AUTOMATION_REPORT_DIR
             ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
             : path.resolve(process.cwd(), 'midscene_run', 'report')
           if (!fs.existsSync(reportRoot)) {
             fs.mkdirSync(reportRoot, { recursive: true })
           }
           const finalPath = path.join(reportRoot, path.basename(result.reportPath))
           fs.writeFileSync(finalPath, reportContent, 'utf-8')
        }

        const resolver = remoteExecutionResolvers.get(executionId)
        if (resolver) {
          resolver(result)
          remoteExecutionResolvers.delete(executionId)
        }
        executionAgentMap.delete(executionId)
      }
    } catch (err) {
      // Ignore non-JSON messages (maybe ping/pong)
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    if (agents.has(ws)) {
      console.log(`Agent disconnected: ${agents.get(ws)?.deviceName}`)
      agents.delete(ws)
    }
  })
})

async function runRemoteTestCase(
  testCase: TestCase, 
  executionId: string, 
  _updateCallback: (patch: Partial<Execution>) => void,
  targetAgentId?: string
): Promise<{ status: 'success' | 'failed'; reportPath?: string; errorMessage?: string }> {
  // Find suitable agent
  let targetWs: WebSocket | undefined

  if (targetAgentId) {
    for (const [ws, info] of agents.entries()) {
      if (info.id === targetAgentId && info.platform === testCase.platform) {
        targetWs = ws
        break
      }
    }
    if (!targetWs) {
      throw new Error(`Target agent not found or not connected: ${targetAgentId}`)
    }
  } else {
    for (const [ws, info] of agents.entries()) {
      if (info.platform === testCase.platform && info.status === 'idle') {
        targetWs = ws
        break
      }
    }

    // If no idle agent, pick any matching agent (queueing is handled by agent effectively if it can run parallel, 
    // but for now let's just pick the first one)
    if (!targetWs) {
      for (const [ws, info] of agents.entries()) {
        if (info.platform === testCase.platform) {
          targetWs = ws
          break
        }
      }
    }
  }

  if (!targetWs) {
    throw new Error(`No available agent for platform: ${testCase.platform}`)
  }

  // Record the actual agent being used
  const agentInfo = agents.get(targetWs!)
  if (agentInfo) {
    _updateCallback({ 
      agentId: agentInfo.id,
      agentName: agentInfo.deviceName 
    })
  }

  return new Promise((resolve) => {
    remoteExecutionResolvers.set(executionId, resolve)
    executionAgentMap.set(executionId, targetWs!)

    const msg: ServerToAgentMessage = {
      type: 'EXECUTE_TASK',
      payload: { executionId, testCase }
    }
    targetWs!.send(JSON.stringify(msg))
  })
}

function cancelRemoteExecution(executionId: string) {
  const ws = executionAgentMap.get(executionId)
  if (ws) {
    const msg: ServerToAgentMessage = {
      type: 'CANCEL_TASK',
      payload: { executionId }
    }
    ws.send(JSON.stringify(msg))
    return true
  }
  return false
}

function broadcast(msg: WSMessage) {
  const data = JSON.stringify(msg)
  for (const client of clients) {
    try {
      client.send(data)
    } catch (err) {
      void err
    }
  }
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3002
server.listen(PORT, () => {
  // Reset any pending executions from previous runs
  const count = Storage.resetPendingExecutions()
  if (count > 0) {
    console.log(`[Startup] Reset ${count} pending executions from previous session`)
  }

  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT
  console.log(`Server listening on http://localhost:${actualPort}`)
})

// SPA Fallback (Must be after API routes)
if (fs.existsSync(clientDist)) {
  app.use((req, res, next) => {
    if (
      req.path.startsWith('/api/') || 
      req.path.startsWith('/reports/') || 
      req.path.startsWith('/ws')
    ) {
      return next()
    }
    if (req.method === 'GET' && req.accepts('html')) {
        res.sendFile(path.join(clientDist, 'index.html'))
    } else {
        next()
    }
  })
}

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err)
})
