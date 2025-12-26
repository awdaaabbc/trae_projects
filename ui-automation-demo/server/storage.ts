
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
        const tc = JSON.parse(content) as TestCase
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

// Save case to disk
function persistCase(tc: TestCase) {
  const existingFile = caseFileById[tc.id]
  const existingPath = existingFile ? path.join(DATA_DIR, existingFile) : null
  const hasExisting = !!existingPath && fs.existsSync(existingPath)

  const fileName =
    hasExisting
      ? existingFile
      : `${sanitizeFilename(tc.name)}_${formatDate(Date.now())}_${tc.id.substring(0, 8)}.json`

  const filePath = path.join(DATA_DIR, fileName)
  fs.writeFileSync(filePath, JSON.stringify(tc, null, 2), 'utf-8')
  caseFileById[tc.id] = fileName
}

// Save execution to disk
function persistExecution(exe: Execution) {
  const filePath = path.join(EXEC_DIR, `${exe.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(exe, null, 2), 'utf-8')
}

loadCases()
loadExecutions()

export const Storage = {
  listCases(): TestCase[] {
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
}
