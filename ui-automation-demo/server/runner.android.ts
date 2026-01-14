import path from 'node:path'
import fs from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { TestCase, Execution } from './types.js'

const execAsync = promisify(exec)

export async function inputViaADBKeyboard(udid: string, text: string) {
  console.log(`[Android Runner] Attempting to input via ADBKeyBoard: "${text}"`)
  let originalIME: string | null = null;
  
  try {
    // 1. Check if ADBKeyBoard is installed
    const { stdout: listPackages } = await execAsync(`adb -s ${udid} shell pm list packages com.android.adbkeyboard`)
    if (!listPackages.includes('com.android.adbkeyboard')) {
      // 优化点：这里可以扩展为自动下载 APK 并安装
      console.warn('[Android Runner] ADBKeyBoard not found. Please install it for better Chinese support.')
      throw new Error('ADBKeyBoard not installed')
    }

    // 2. Get current IME to restore later
    try {
        const { stdout: currentIME } = await execAsync(`adb -s ${udid} shell settings get secure default_input_method`)
        originalIME = currentIME.trim();
    } catch (e) {
        console.warn('[Android Runner] Failed to get current IME, skipping restore step.');
    }

    // 3. Enable and Set IME
    // 优化点：检查是否已经启用，避免重复操作
    await execAsync(`adb -s ${udid} shell ime enable com.android.adbkeyboard/.AdbIME`)
    await execAsync(`adb -s ${udid} shell ime set com.android.adbkeyboard/.AdbIME`)

    // 4. Input Text (Base64 for safety)
    const b64 = Buffer.from(text).toString('base64')
    await execAsync(`adb -s ${udid} shell am broadcast -a ADB_INPUT_B64 --es msg "${b64}"`)
    
    // Give it a moment to process
    await new Promise(r => setTimeout(r, 500));

    console.log('[Android Runner] ADBKeyBoard input successful')
  } catch (err) {
    console.error('[Android Runner] ADBKeyBoard input failed:', err)
    throw err
  } finally {
      // 5. Restore original IME (Optimization: User Experience)
      if (originalIME && originalIME !== 'com.android.adbkeyboard/.AdbIME') {
          try {
            await execAsync(`adb -s ${udid} shell ime set ${originalIME}`)
          } catch (e) {
            console.warn(`[Android Runner] Failed to restore IME to ${originalIME}`);
          }
      }
  }
}

export async function inputViaAdbShell(udid: string, text: string) {
    // Only works for ASCII
    if (/[^\x00-\x7F]/.test(text)) {
        throw new Error('Text contains non-ASCII characters, skipping adb shell input');
    }
    console.log(`[Android Runner] Attempting fallback to adb shell input text`)
    // Escape special characters for shell
    const escapedText = text.replace(/([\\"`$])/g, '\\$1').replace(/ /g, '%s');
    await execAsync(`adb -s ${udid} shell input text "${escapedText}"`);
}

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
    scrollDown: (distance?: number) => Promise<void>
    scrollUp: (distance?: number) => Promise<void>
    scrollLeft: (distance?: number) => Promise<void>
    scrollRight: (distance?: number) => Promise<void>
    scroll: (deltaX: number, deltaY: number, duration?: number) => Promise<void>
  }
  AndroidAgent: new (
    device: unknown,
    opts: { generateReport?: boolean; reportFileName?: string }
  ) => {
    aiAct: (instruction: string) => Promise<unknown>
    aiQuery: (instruction: string) => Promise<unknown>
    aiAssert: (instruction: string) => Promise<unknown>
    aiInput: (options: { value: string }) => Promise<unknown>
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

    // Monkey patch aiInput to force ADBKeyBoard usage globally
    // This catches inputs triggered by aiAct (e.g. "Enter 6.68") that we don't intercept manually
    const originalAiInput = agent.aiInput.bind(agent)
    agent.aiInput = async (options: { value: string }) => {
      console.log(`[Android Runner] Intercepted aiInput call for value: "${options.value}"`)
      try {
        await inputViaADBKeyboard(devices[0].udid, options.value)
        return { status: 'success', description: 'Executed input via ADBKeyBoard (Global Patch)' }
      } catch (adbError) {
        console.warn('[Android Runner] ADBKeyBoard input failed in global patch, falling back to original aiInput:', adbError)
        return originalAiInput(options)
      }
    }

    updateCallback({ status: 'running', progress: 0 })
    const totalSteps = testCase.steps.length

    for (let i = 0; i < totalSteps; i++) {
      if (signal.aborted) throw new Error('Execution cancelled')

      const step = testCase.steps[i]
      const progress = Math.round((i / totalSteps) * 100)
      updateCallback({ progress })

      const stepTimeout = process.env.UI_AUTOMATION_STEP_TIMEOUT ? Number(process.env.UI_AUTOMATION_STEP_TIMEOUT) : 300000
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

        // Handle explicit input type or natural language input instruction
        // Example: "输入：输入5" -> "Input: Input 5"
        // Updated Regex: Allow optional colon and optional space, e.g. "输入123", "input 123"
        const inputMatch = step.action.match(/^(?:输入|input)(?:[:：]\s*|\s*)(.+)$/i)
        if (step.type === 'input' || inputMatch) {
          let value = inputMatch ? inputMatch[1] : step.action
          
          // Check for [ADB] prefix (optional now, but kept for compatibility)
          const adbMatch = value.match(/^\[ADB\]\s*(.+)$/i)
          if (adbMatch) {
             value = adbMatch[1]
          }

          // Default to ADBKeyBoard for all inputs as requested
          let inputSuccess = false;

          // Strategy 1: ADBKeyBoard (Best for Chinese)
          try {
             await inputViaADBKeyboard(devices[0].udid, value)
             console.log('[MidScene Input Result] { status: "success", description: "Executed input via ADBKeyBoard" }')
             inputSuccess = true;
             return
          } catch (adbError) {
             console.warn('[Android Runner] ADBKeyBoard input failed:', adbError)
          }

          // Strategy 2: ADB Shell Input (Fallback for English only)
          if (!inputSuccess) {
            try {
               await inputViaAdbShell(devices[0].udid, value)
               console.log('[MidScene Input Result] { status: "success", description: "Executed input via ADB Shell" }')
               inputSuccess = true;
               return
            } catch (shellError) {
               console.warn('[Android Runner] ADB Shell input failed/skipped:', shellError)
            }
          }

          // Strategy 3: Midscene aiInput (Final Fallback - Clipboard/AI)
          console.log(`[Android Runner] All native input methods failed. Falling back to aiInput with value: "${value}"`)
          const res = await agent.aiInput({ value })
          console.log('[MidScene Input Result]', JSON.stringify(res, null, 2))
          return
        }

        // Handle scroll/swipe commands using MidScene's native device methods
        // Supports: "scroll down", "swipe left", "next page", "scroll down 500", etc.
        const scrollAction = step.action.toLowerCase()
        const isScroll = /scroll|swipe|滑动|翻页|page/i.test(scrollAction)
        
        if (isScroll) {
           let direction = ''
           let distance: number | undefined = undefined
           
           // Extract parameters
           // Match "scroll down 500" or "swipe left 0.5"
           const paramMatch = step.action.match(/(?:scroll|swipe|滑动)\s*(up|down|left|right|上|下|左|右)\s*(\d+(?:\.\d+)?)?/i)
           if (paramMatch) {
              const dir = paramMatch[1].toLowerCase()
              const val = paramMatch[2]
              if (val) distance = Number(val)
              
              if (['up', '上'].includes(dir)) direction = 'up'
              else if (['down', '下'].includes(dir)) direction = 'down'
              else if (['left', '左'].includes(dir)) direction = 'left'
              else if (['right', '右'].includes(dir)) direction = 'right'
           } else {
              // Handle aliases
              if (/next page|下一页|left/i.test(scrollAction)) direction = 'right' // Swipe Left -> Scroll Right
              else if (/prev page|previous page|上一页|right/i.test(scrollAction)) direction = 'left' // Swipe Right -> Scroll Left
              else if (/down|bottom/i.test(scrollAction)) direction = 'down'
              else if (/up|top/i.test(scrollAction)) direction = 'up'
           }

           if (direction) {
              console.log(`[Android Runner] Executing native scroll/swipe: direction=${direction}, distance=${distance ?? 'default'}`)
              try {
                if (direction === 'down') await device.scrollDown(distance)
                else if (direction === 'up') await device.scrollUp(distance)
                else if (direction === 'right') await device.scrollRight(distance) // Scroll to right (content moves left)
                else if (direction === 'left') await device.scrollLeft(distance)   // Scroll to left (content moves right)
                
                // Force a context refresh after scroll
                // Optimization: Removed redundant aiQuery. The next aiAct/aiAssert will automatically refresh the context.
                // try {
                //   await agent.aiQuery('check page status')
                // } catch {}

                console.log(`[MidScene Action Result] { status: "success", description: "Executed native scroll ${direction}" }`)
                return
              } catch (e) {
                console.error('[Android Runner] Native scroll failed:', e)
                // Fallback to aiAct if native scroll fails
              }
           }
        }

        const res = await agent.aiAct(step.action)
        console.log('[MidScene Action Result]', JSON.stringify(res, null, 2))
      })()

      await Promise.race([
        stepPromise,
        new Promise((_, reject) => {
          const timeoutMinutes = (stepTimeout / 60000).toFixed(1)
          const timer = setTimeout(() => reject(new Error(`Step timeout (${timeoutMinutes}min)`)), stepTimeout)
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
    return { status: 'failed', errorMessage: e instanceof Error ? `${e.message}\n${e.stack || ''}` : String(e), reportPath }
  } finally {
    runningExecutions.delete(executionId)
    if (cleanup) await cleanup().catch(() => {})
  }
}
