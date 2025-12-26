import exp from 'express'
import type { Request, Response, NextFunction } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import { Storage } from './storage.js'
import type { Execution, TestCase } from './types.js'
import { runTestCase, cancelExecution } from './runner.js'

dotenv.config()

const app = exp()
app.use(exp.json())

// Serve MidScene reports statically
const reportDir = process.env.UI_AUTOMATION_REPORT_DIR
  ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
  : path.resolve(process.cwd(), 'midscene_run', 'report')
app.use('/reports', exp.static(reportDir))

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

// Basic health endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true })
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
    
    const tc: TestCase = {
      id,
      name: body.name || '',
      description: body.description || '',
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
    steps: Array.isArray(body.steps) ? body.steps : tc.steps,
  }
  Storage.saveCase(updated)
  res.json({ data: updated })
})

// Executions APIs
app.get('/api/executions', (_req: Request, res: Response) => {
  try {
    res.json({ data: Storage.listExecutions() })
  } catch (err) {
    console.error('Failed to list executions:', err)
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: `获取执行列表失败: ${msg}` })
  }
})

app.post('/api/execute/:id', async (req: Request, res: Response) => {
  const id = req.params.id
  const tc = Storage.getCase(id)
  if (!tc) return res.status(404).json({ error: '未找到测试用例' })
  Storage.updateCase(id, { status: 'running' })
  const exeId = `exe-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const createdAt = Date.now()
  const exe: Execution = {
    id: exeId,
    caseId: id,
    status: 'queued',
    progress: 0,
    createdAt,
    updatedAt: createdAt,
  }
  Storage.saveExecution(exe)
  broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
  ;(async () => {
    const result = await runTestCase(tc, exeId, (patch) => {
      const normalizedPatch =
        patch.reportPath ? { ...patch, reportPath: normalizeReportPath(patch.reportPath) } : patch
      Storage.updateExecution(exeId, normalizedPatch)
      if (normalizedPatch.reportPath) {
        Storage.updateCase(id, {
          lastRunAt: Date.now(),
          lastReportPath: normalizedPatch.reportPath,
        })
      }
      broadcast({
        type: 'execution',
        payload: Storage.getExecution(exeId),
      })
    })
    const finalReportPath = normalizeReportPath(result.reportPath)
    Storage.updateExecution(exeId, {
      status: result.status === 'success' ? 'success' : 'failed',
      progress: 100,
      reportPath: finalReportPath,
      errorMessage: result.errorMessage,
    })
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    Storage.updateCase(id, {
      status: result.status === 'success' ? 'done' : 'error',
      lastRunAt: Date.now(),
      lastReportPath: finalReportPath,
    })
    broadcast({ type: 'testcase', payload: Storage.getCase(id) })
  })().catch((err) => {
    Storage.updateExecution(exeId, { status: 'failed', errorMessage: String(err), progress: 100 })
    broadcast({ type: 'execution', payload: Storage.getExecution(exeId) })
    Storage.updateCase(id, { status: 'error' })
    broadcast({ type: 'testcase', payload: Storage.getCase(id) })
  })
  res.json({ data: Storage.getExecution(exeId) })
})

app.post('/api/stop-execution/:id', (req: Request, res: Response) => {
  const id = req.params.id
  if (!id) return res.status(400).json({ error: 'Missing execution ID' })
  
  const success = cancelExecution(id)
  if (success) {
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
wss.on('connection', (ws: WebSocket) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

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
  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : PORT
  console.log(`Server listening on http://localhost:${actualPort}`)
})

process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err)
})
