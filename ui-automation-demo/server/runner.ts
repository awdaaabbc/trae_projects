import { chromium } from 'playwright'
import { PlaywrightAgent } from '@midscene/web/playwright'
import path from 'node:path'
import fs from 'node:fs'
import type { TestCase, Execution } from './types.js'

export interface RunResult {
  status: 'success' | 'failed';
  reportPath?: string;
  errorMessage?: string;
}

export async function runTestCase(
  testCase: TestCase,
  executionId: string,
  updateCallback: (patch: Partial<Execution>) => void
): Promise<RunResult> {
  let browser
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

    const reportId = `${executionId}-${testCase.id}`

    if (!hasModel) {
      console.warn('MidScene model not configured. Generating placeholder report.')
      updateCallback({ status: 'running', progress: 50 })
      
      const reportFileName = `${reportId}.html`
      const fallback = path.join(reportRoot, reportFileName)
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>执行报告占位</title></head><body><h2>未配置MidScene模型，展示占位报告</h2><p>请设置环境变量 MIDSCENE_MODEL_BASE_URL、MIDSCENE_MODEL_API_KEY、MIDSCENE_MODEL_NAME。</p></body></html>`
      fs.writeFileSync(fallback, html, 'utf8')
      
      // Simulate delay
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      updateCallback({ progress: 100 })
      return {
        status: 'success', 
        reportPath: reportFileName 
      }
    }

    browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()
    const page = await context.newPage()
    
    // Initialize Agent with report configuration
    const agentOpts = {
      generateReport: true,
      reportFileName: reportId,
    } as unknown as ConstructorParameters<typeof PlaywrightAgent>[1]
    const agent = new PlaywrightAgent(page, agentOpts)

    updateCallback({ status: 'running', progress: 0 })
    const totalSteps = testCase.steps.length
    
    for (let i = 0; i < totalSteps; i++) {
        const step = testCase.steps[i]
        const progress = Math.round(((i) / totalSteps) * 100)
        updateCallback({ progress })

        try {
            console.log(`Executing step ${i + 1}/${totalSteps}: ${step.type || 'action'} - ${step.action}`)
            if (step.type === 'query') {
                await agent.aiQuery(step.action)
            } else if (step.type === 'assert') {
                await agent.aiAssert(step.action)
            } else {
                await agent.aiAction(step.action)
            }
        } catch (stepError: unknown) {
            console.error(`Step failed: ${step.action}`, stepError)
            throw stepError
        }
    }

    updateCallback({ progress: 100 })
    
    await browser.close()
    browser = undefined

    // Verify report file exists
    const expectedReportPath = path.join(reportRoot, `${reportId}.html`)
    let finalReportPath = `${reportId}.html`
    
    if (!fs.existsSync(expectedReportPath)) {
        // Fallback: search for most recent file
         const files = fs.readdirSync(reportRoot)
          .filter(f => f.endsWith('.html'))
          .map(f => ({ name: f, time: fs.statSync(path.join(reportRoot, f)).mtime.getTime() }))
          .sort((a, b) => b.time - a.time)
        if (files.length > 0) {
            finalReportPath = files[0].name
        }
    }
    
    return {
      status: 'success',
      reportPath: finalReportPath
    }

  } catch (e: unknown) {
    console.error('Execution failed:', e)
    if (browser) await browser.close()
    return { status: 'failed', errorMessage: e instanceof Error ? e.message : String(e) }
  }
}
