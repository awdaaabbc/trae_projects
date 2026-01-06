import path from 'node:path'
import fs from 'node:fs'
import type { TestCase, Execution } from './types.js'

export interface RunResult {
  status: 'success' | 'failed';
  reportPath?: string;
  errorMessage?: string;
}

type AndroidModule = {
  getConnectedDevices: () => Promise<Array<{ udid: string }>>
  AndroidDevice: new (udid: string) => {
    connect: () => Promise<void>
    destroy: () => Promise<void>
  }
  AndroidAgent: new (
    device: unknown,
    opts: { generateReport?: boolean; reportFileName?: string }
  ) => {
    aiAct: (instruction: string) => Promise<unknown>
    aiQuery: (instruction: string) => Promise<unknown>
    aiAssert: (instruction: string) => Promise<unknown>
  }
}

const defaultAndroidModuleLoader = () =>
  import('@midscene/android') as unknown as Promise<AndroidModule>
let androidModuleLoader: () => Promise<AndroidModule> = defaultAndroidModuleLoader

export function __setAndroidModuleLoaderForTest(loader?: () => Promise<AndroidModule>) {
  androidModuleLoader = loader ?? defaultAndroidModuleLoader
}
// 
const runningExecutions = new Map<
  string,
  { controller: AbortController; cleanup?: () => Promise<void> }
>()

export function cancelExecution(executionId: string) {
  const entry = runningExecutions.get(executionId)
  if (!entry) return false

  entry.controller.abort()
  const cleanup = entry.cleanup
  runningExecutions.delete(executionId)
  if (cleanup) cleanup().catch(() => {})
  return true
}

export async function runTestCase(
  testCase: TestCase,
  executionId: string,
  updateCallback: (patch: Partial<Execution>) => void
): Promise<RunResult> {
  const controller = new AbortController()
  const { signal } = controller
  let cleanup: (() => Promise<void>) | undefined

  try {
    const hasModel =
      !!process.env.MIDSCENE_MODEL_BASE_URL &&
      !!process.env.MIDSCENE_MODEL_API_KEY &&
      !!process.env.MIDSCENE_MODEL_NAME

    const reportRoot = process.env.UI_AUTOMATION_REPORT_DIR
      ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
      : path.resolve(process.cwd(), 'midscene_run', 'report')
    if (!fs.existsSync(reportRoot)) {
      fs.mkdirSync(reportRoot, { recursive: true })
    }

    const reportId = executionId

    const getFinalReportPath = () => {
      const expectedReportPath = path.join(reportRoot, `${reportId}.html`)
      if (fs.existsSync(expectedReportPath)) {
        return `${reportId}.html`
      }
      const files = fs
        .readdirSync(reportRoot)
        .filter((f) => f.endsWith('.html'))
        .map((f) => ({ name: f, time: fs.statSync(path.join(reportRoot, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time)
      return files.length > 0 ? files[0].name : undefined
    }

    if (!hasModel) {
      updateCallback({ status: 'running', progress: 50 })

      const reportFileName = `${reportId}.html`
      const fallback = path.join(reportRoot, reportFileName)
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Android 执行报告占位</title></head><body><h2>Android Runner：未配置 MidScene 模型，展示占位报告</h2><p>请设置环境变量 MIDSCENE_MODEL_BASE_URL、MIDSCENE_MODEL_API_KEY、MIDSCENE_MODEL_NAME。</p></body></html>`
      fs.writeFileSync(fallback, html, 'utf8')

      const placeholderDelayMsRaw = process.env.UI_AUTOMATION_ANDROID_PLACEHOLDER_DELAY_MS
      const placeholderDelayMs =
        placeholderDelayMsRaw && Number.isFinite(Number(placeholderDelayMsRaw))
          ? Number(placeholderDelayMsRaw)
          : 1000

      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, placeholderDelayMs)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Execution cancelled'))
        })
      })

      updateCallback({ progress: 100 })
      return { status: 'success', reportPath: reportFileName }
    }

    const mod = await androidModuleLoader()
    const devices = await mod.getConnectedDevices()
    if (devices.length === 0) {
      throw new Error('未检测到 Android 设备，请检查 USB 或无线连接')
    }

    const device = new mod.AndroidDevice(devices[0].udid)
    await device.connect()
    cleanup = async () => {
      await device.destroy()
    }

    runningExecutions.set(executionId, {
      controller,
      cleanup,
    })

    signal.addEventListener('abort', () => {
      device.destroy().catch(() => {})
    })

    const agent = new mod.AndroidAgent(device, {
      generateReport: true,
      reportFileName: reportId,
    })

    updateCallback({ status: 'running', progress: 0 })
    const totalSteps = testCase.steps.length

    for (let i = 0; i < totalSteps; i++) {
      if (signal.aborted) throw new Error('Execution cancelled')

      const step = testCase.steps[i]
      const progress = Math.round((i / totalSteps) * 100)
      updateCallback({ progress })

      const stepTimeout = 120000
      const stepPromise = (async () => {
        if (step.type === 'query') {
          const res = await agent.aiQuery(step.action)
          console.log('[MidScene Query Result]', JSON.stringify(res, null, 2))
          return
        }
        if (step.type === 'assert') {
          const res = await agent.aiAssert(step.action)
          console.log('[MidScene Assert Result]', JSON.stringify(res, null, 2))
          return
        }
        const res = await agent.aiAct(step.action)
        console.log('[MidScene Action Result]', JSON.stringify(res, null, 2))
      })()

      await Promise.race([
        stepPromise,
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Step timeout (2min)')), stepTimeout)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Error('Execution cancelled'))
          })
        }),
      ])
    }

    updateCallback({ progress: 100 })

    return { status: 'success', reportPath: getFinalReportPath() }
  } catch (e: unknown) {
    console.error('Execution failed:', e)
    // Even on failure, try to find the report path
    let reportPath: string | undefined
    try {
      const reportRoot = process.env.UI_AUTOMATION_REPORT_DIR
        ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
        : path.resolve(process.cwd(), 'midscene_run', 'report')
      if (fs.existsSync(reportRoot)) {
        const expectedReportPath = path.join(reportRoot, `${executionId}.html`)
        if (fs.existsSync(expectedReportPath)) {
          reportPath = `${executionId}.html`
        } else {
          const files = fs
            .readdirSync(reportRoot)
            .filter((f) => f.endsWith('.html'))
            .map((f) => ({ name: f, time: fs.statSync(path.join(reportRoot, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time)
          if (files.length > 0) {
            reportPath = files[0].name
          }
        }
      }
    } catch (reportError) {
      console.warn('Failed to resolve report path after execution error:', reportError)
    }
    return { status: 'failed', errorMessage: e instanceof Error ? e.message : String(e), reportPath }
  } finally {
    runningExecutions.delete(executionId)
    if (cleanup) await cleanup().catch(() => {})
  }
}
