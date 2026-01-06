import { chromium, type Browser } from 'playwright'
import { PlaywrightAgent } from '@midscene/web/playwright'
import path from 'node:path'
import fs from 'node:fs'
import type { TestCase, Execution } from './types.js'

export interface RunResult {
  status: 'success' | 'failed';
  reportPath?: string;
  errorMessage?: string;
}

const runningExecutions = new Map<string, { browser: Browser, controller: AbortController }>()

export function cancelExecution(executionId: string) {
  const entry = runningExecutions.get(executionId)
  if (entry) {
    entry.controller.abort()
    entry.browser.close().catch(() => {})
    runningExecutions.delete(executionId)
    return true
  }
  return false
}

export async function runTestCase(
  testCase: TestCase,
  executionId: string,
  updateCallback: (patch: Partial<Execution>) => void
): Promise<RunResult> {
  let browser: Browser | undefined
  const controller = new AbortController()
  const { signal } = controller

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
      // Fallback: search for most recent file
      const files = fs.readdirSync(reportRoot)
        .filter(f => f.endsWith('.html'))
        .map(f => ({ name: f, time: fs.statSync(path.join(reportRoot, f)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time)
      return files.length > 0 ? files[0].name : undefined
    }

    if (!hasModel) {
      // ... existing placeholder logic
      console.warn('MidScene model not configured. Generating placeholder report.')
      updateCallback({ status: 'running', progress: 50 })
      
      const reportFileName = `${reportId}.html`
      const fallback = path.join(reportRoot, reportFileName)
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>执行报告占位</title></head><body><h2>未配置MidScene模型，展示占位报告</h2><p>请设置环境变量 MIDSCENE_MODEL_BASE_URL、MIDSCENE_MODEL_API_KEY、MIDSCENE_MODEL_NAME。</p></body></html>`
      fs.writeFileSync(fallback, html, 'utf8')
      
      // Simulate delay with cancellation support
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 1000)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Execution cancelled'))
        })
      })
      
      updateCallback({ progress: 100 })
      return {
        status: 'success', 
        reportPath: reportFileName 
      }
    }

    browser = await chromium.launch({ headless: false })
    runningExecutions.set(executionId, { browser, controller })

    const context = await browser.newContext()
    const page = await context.newPage()
    
    // Check if browser is closed unexpectedly
    browser.on('disconnected', () => {
      if (!signal.aborted) {
        controller.abort(new Error('Browser disconnected unexpectedly'))
      }
    })
    
    // Initialize Agent with report configuration
    const agentOpts = {
      generateReport: true,
      reportFileName: reportId,
    } as unknown as ConstructorParameters<typeof PlaywrightAgent>[1]
    const agent = new PlaywrightAgent(page, agentOpts)

    updateCallback({ status: 'running', progress: 0 })
    const totalSteps = testCase.steps.length
    
    for (let i = 0; i < totalSteps; i++) {
        if (signal.aborted) throw new Error('Execution cancelled')

        const step = testCase.steps[i]
        const progress = Math.round(((i) / totalSteps) * 100)
        updateCallback({ progress })

        try {
            console.log(`Executing step ${i + 1}/${totalSteps}: ${step.type || 'action'} - ${step.action}`)
            
            // Timeout wrapper for each step (e.g., 2 minutes)
            const stepTimeout = 120000
            const stepPromise = (async () => {
               if (step.type === 'query') {
                   const res = await agent.aiQuery(step.action)
                   console.log('[MidScene Query Result]', JSON.stringify(res, null, 2))
               } else if (step.type === 'assert') {
                   const res = await agent.aiAssert(step.action)
                   console.log('[MidScene Assert Result]', JSON.stringify(res, null, 2))
               } else {
                   const res = await agent.aiAction(step.action)
                   console.log('[MidScene Action Result]', JSON.stringify(res, null, 2))
               }
            })()

            await Promise.race([
                stepPromise,
                new Promise((_, reject) => {
                    const timer = setTimeout(() => reject(new Error('Step timeout (2min)')), stepTimeout)
                    signal.addEventListener('abort', () => {
                        clearTimeout(timer)
                        reject(new Error('Execution cancelled'))
                    })
                })
            ])

        } catch (stepError: unknown) {
            console.error(`Step failed: ${step.action}`, stepError)
            throw stepError
        }
    }

    updateCallback({ progress: 100 })
    
    return {
      status: 'success',
      reportPath: getFinalReportPath()
    }

  } catch (e: unknown) {
    console.error('Execution failed:', e)
    // Even on failure, try to find the report path
    let reportPath: string | undefined
    try {
        const expectedReportPath = path.join(path.resolve(process.cwd(), 'midscene_run', 'report'), `${executionId}.html`)
        if (fs.existsSync(expectedReportPath)) {
            reportPath = `${executionId}.html`
        } else {
            const reportRoot = process.env.UI_AUTOMATION_REPORT_DIR
                ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
                : path.resolve(process.cwd(), 'midscene_run', 'report')
            if (fs.existsSync(reportRoot)) {
                const files = fs.readdirSync(reportRoot)
                    .filter(f => f.endsWith('.html'))
                    .map(f => ({ name: f, time: fs.statSync(path.join(reportRoot, f)).mtime.getTime() }))
                    .sort((a, b) => b.time - a.time)
                if (files.length > 0) {
                    reportPath = files[0].name
                }
            }
        }
    } catch (reportError) {
        console.warn('Failed to resolve report path after execution error:', reportError)
    }

    return { 
        status: 'failed', 
        errorMessage: e instanceof Error ? e.message : String(e),
        reportPath
    }
  } finally {
    if (executionId) {
        runningExecutions.delete(executionId)
    }
    if (browser) {
        await browser.close().catch(() => {})
    }
  }
}
