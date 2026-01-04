
import type { Execution, TestCase } from './types.js'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.UI_AUTOMATION_DATA_DIR
  ? path.resolve(process.env.UI_AUTOMATION_DATA_DIR)
  : path.resolve(process.cwd(), 'data', 'testcases')
const EXEC_DIR = process.env.UI_AUTOMATION_EXEC_DIR
  ? path.resolve(process.env.UI_AUTOMATION_EXEC_DIR)
  : path.resolve(process.cwd(), 'data', 'executions')
const cases: Record<string, TestCase> = {}
const executions: Record<string, Execution> = {}
const caseFileById: Record<string, string> = {}

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}
if (!fs.existsSync(EXEC_DIR)) {
  fs.mkdirSync(EXEC_DIR, { recursive: true })
}

// Load cases from disk
function loadCases() {
  const files = fs.readdirSync(DATA_DIR)
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')
        const parsed = JSON.parse(content) as Partial<TestCase>
        const tc: TestCase = {
          id: parsed.id || '',
          name: parsed.name || '',
          description: parsed.description || '',
          platform: parsed.platform === 'android' ? 'android' : parsed.platform === 'ios' ? 'ios' : 'web',
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          status: parsed.status || 'idle',
          lastRunAt: parsed.lastRunAt,
          lastReportPath: parsed.lastReportPath,
        }
        cases[tc.id] = tc
        caseFileById[tc.id] = file
      } catch (err) {
        console.error(`Failed to load test case ${file}:`, err)
      }
    }
  }
}

// Load executions from disk
function loadExecutions() {
  if (!fs.existsSync(EXEC_DIR)) return
  const files = fs.readdirSync(EXEC_DIR)
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(path.join(EXEC_DIR, file), 'utf-8')
        const exe = JSON.parse(content) as Execution
        executions[exe.id] = exe
      } catch (err) {
        console.error(`Failed to load execution ${file}:`, err)
      }
    }
  }
}

// Helper to sanitize filename
function sanitizeFilename(name: string) {
  return name.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_').substring(0, 50)
}

// Helper to format date
function formatDate(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}_${d.getHours().toString().padStart(2, '0')}${d.getMinutes().toString().padStart(2, '0')}${d.getSeconds().toString().padStart(2, '0')}`
}

function formatDateWithMs(ts: number) {
  const d = new Date(ts)
  const base = formatDate(ts)
  const ms = d.getMilliseconds().toString().padStart(3, '0')
  return `${base}${ms}`
}

// Save case to disk
function persistCase(tc: TestCase) {
  const sanitizedName = sanitizeFilename(tc.name)
  const existingFile = caseFileById[tc.id]
  
  let fileNameToUse = existingFile
  
  if (existingFile) {
     const prefix = `${sanitizedName}_`
     if (!existingFile.startsWith(prefix)) {
        // Name changed, trigger rename
        const newFileName = `${sanitizedName}_${formatDate(Date.now())}_${tc.id.substring(0, 8)}.json`
        const oldPath = path.join(DATA_DIR, existingFile)
        const newPath = path.join(DATA_DIR, newFileName)
        try {
           if (fs.existsSync(oldPath)) {
              fs.renameSync(oldPath, newPath)
              fileNameToUse = newFileName
              caseFileById[tc.id] = newFileName
           }
        } catch(e) {
           console.error('Rename failed', e)
        }
     }
  } else {
     // New file
     fileNameToUse = `${sanitizedName}_${formatDate(Date.now())}_${tc.id.substring(0, 8)}.json`
     caseFileById[tc.id] = fileNameToUse
  }

  const filePath = path.join(DATA_DIR, fileNameToUse)
  fs.writeFileSync(filePath, JSON.stringify(tc, null, 2), 'utf-8')
}

// Save execution to disk
function persistExecution(exe: Execution) {
  const filePath = path.join(EXEC_DIR, `${exe.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(exe, null, 2), 'utf-8')
}

loadCases()
loadExecutions()

// Reload cases from disk
function reloadCases() {
  // Clear current memory cache
  for (const id in cases) delete cases[id]
  for (const id in caseFileById) delete caseFileById[id]
  loadCases()
}

export const Storage = {
  reloadCases, // Export reload function
  generateExecutionId(tcName: string) {
    const base = `${sanitizeFilename(tcName)}_${formatDateWithMs(Date.now())}`
    let id = base
    let i = 0
    while (executions[id]) {
      i += 1
      id = `${base}_${i}`
    }
    return id
  },
  getCaseFilename(id: string) {
    return caseFileById[id]
  },
  listCases(): TestCase[] {
    reloadCases() // Ensure we always return fresh data from disk
    return Object.values(cases)
  },
  getCase(id: string): TestCase | undefined {
    return cases[id]
  },
  saveCase(tc: TestCase) {
    cases[tc.id] = tc
    persistCase(tc)
  },
  updateCase(id: string, patch: Partial<TestCase>) {
    const cur = cases[id]
    if (!cur) return
    const updated = { ...cur, ...patch }
    cases[id] = updated
    persistCase(updated)
  },
  listExecutions(): Execution[] {
    return Object.values(executions).sort((a, b) => b.createdAt - a.createdAt)
  },
  getExecution(id: string): Execution | undefined {
    return executions[id]
  },
  saveExecution(exe: Execution) {
    executions[exe.id] = exe
    persistExecution(exe)
  },
  updateExecution(id: string, patch: Partial<Execution>) {
    const cur = executions[id]
    if (!cur) return
    const updated = { ...cur, ...patch, updatedAt: Date.now() }
    executions[id] = updated
    persistExecution(updated)
  },
  deleteCase(id: string): boolean {
    const tc = cases[id]
    if (!tc) return false

    // 1. Delete Test Case File
    const fileName = caseFileById[id]
    if (fileName) {
      const filePath = path.join(DATA_DIR, fileName)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
      delete caseFileById[id]
    }
    delete cases[id]

    // 2. Delete Associated Executions
    Object.keys(executions).forEach(exeId => {
      const exe = executions[exeId]
      if (exe.caseId === id) {
        const exePath = path.join(EXEC_DIR, `${exeId}.json`)
        if (fs.existsSync(exePath)) {
          fs.unlinkSync(exePath)
        }
        delete executions[exeId]
      }
    })

    return true
  },
  resetPendingExecutions() {
    const pending = Object.values(executions).filter(
      (e) => e.status === 'running' || e.status === 'queued'
    )
    if (pending.length === 0) return 0

    console.log(`Resetting ${pending.length} pending executions...`)
    for (const exe of pending) {
      const updated: Execution = {
        ...exe,
        status: 'failed',
        progress: 100,
        errorMessage: '服务异常终止，状态已重置',
        updatedAt: Date.now(),
      }
      executions[exe.id] = updated
      persistExecution(updated)

      // Also update the test case status
       const tc = cases[exe.caseId]
       if (tc && tc.status === 'running') {
          const updatedTc = { ...tc, status: 'error' as const }
          cases[tc.id] = updatedTc
          persistCase(updatedTc)
       }
    }
    return pending.length
  }
}
