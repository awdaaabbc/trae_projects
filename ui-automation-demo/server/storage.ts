import type { Execution, TestCase } from './types.js'
import db, { initDB } from './db.js'

// Initialize database
initDB()

// Helper to sanitize filename (used for ID generation)
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

export const Storage = {
  reloadCases() {
    // No-op for DB implementation as every query fetches fresh data
  },

  generateExecutionId(tcName: string) {
    const base = `${sanitizeFilename(tcName)}_${formatDateWithMs(Date.now())}`
    let id = base
    let i = 0
    
    const stmt = db.prepare('SELECT 1 FROM executions WHERE id = ?')
    while (stmt.get(id)) {
      i += 1
      id = `${base}_${i}`
    }
    return id
  },

  getCaseFilename(id: string) {
    // Legacy support: return a dummy filename or null
    // Ideally, consumers shouldn't rely on this anymore.
    // But keeping it to avoid breaking changes if any.
    return `${id}.json` 
  },

  listCases(): TestCase[] {
    const rows = db.prepare('SELECT * FROM test_cases').all() as any[]
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      platform: row.platform as any,
      steps: JSON.parse(row.steps),
      status: row.status as any,
      lastRunAt: row.last_run_at || undefined,
      lastReportPath: row.last_report_path || undefined
    }))
  },

  getCase(id: string): TestCase | undefined {
    const row = db.prepare('SELECT * FROM test_cases WHERE id = ?').get(id) as any
    if (!row) return undefined
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      platform: row.platform as any,
      steps: JSON.parse(row.steps),
      status: row.status as any,
      lastRunAt: row.last_run_at || undefined,
      lastReportPath: row.last_report_path || undefined
    }
  },

  saveCase(tc: TestCase) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO test_cases (id, name, description, platform, steps, status, last_run_at, last_report_path)
      VALUES (@id, @name, @description, @platform, @steps, @status, @lastRunAt, @lastReportPath)
    `)
    stmt.run({
      id: tc.id,
      name: tc.name,
      description: tc.description,
      platform: tc.platform,
      steps: JSON.stringify(tc.steps),
      status: tc.status,
      lastRunAt: tc.lastRunAt || null,
      lastReportPath: tc.lastReportPath || null
    })
  },

  updateCase(id: string, patch: Partial<TestCase>) {
    const current = this.getCase(id)
    if (!current) return

    const updated = { ...current, ...patch }
    this.saveCase(updated)
  },

  listExecutions(limit?: number, offset?: number, caseId?: string): Execution[] {
    let query = 'SELECT id, case_id, batch_id, target_agent_id, status, progress, created_at, updated_at, report_path, error_message, file_name, agent_id, agent_name FROM executions';
    const params: any[] = [];
    
    if (caseId) {
      query += ' WHERE case_id = ?';
      params.push(caseId);
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (limit !== undefined) {
      query += ` LIMIT ${limit}`;
      if (offset !== undefined) {
        query += ` OFFSET ${offset}`;
      }
    }
    
    const rows = db.prepare(query).all(...params) as any[]
    return rows.map(row => ({
      id: row.id,
      caseId: row.case_id,
      batchId: row.batch_id || undefined,
      targetAgentId: row.target_agent_id || undefined,
      status: row.status as any,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reportPath: row.report_path || undefined,
      errorMessage: row.error_message || undefined,
      fileName: row.file_name || undefined,
      // logs: row.logs ? JSON.parse(row.logs) : undefined, // Exclude logs for list view performance
      agentId: row.agent_id || undefined,
      agentName: row.agent_name || undefined
    }))
  },

  countExecutions(caseId?: string): number {
    let query = 'SELECT COUNT(*) as count FROM executions';
    const params: any[] = [];
    
    if (caseId) {
      query += ' WHERE case_id = ?';
      params.push(caseId);
    }
    
    const result = db.prepare(query).get(...params) as { count: number };
    return result.count;
  },

  getExecution(id: string): Execution | undefined {
    const row = db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as any
    if (!row) return undefined
    return {
      id: row.id,
      caseId: row.case_id,
      batchId: row.batch_id || undefined,
      targetAgentId: row.target_agent_id || undefined,
      status: row.status as any,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reportPath: row.report_path || undefined,
      errorMessage: row.error_message || undefined,
      fileName: row.file_name || undefined,
      logs: row.logs ? JSON.parse(row.logs) : undefined,
      agentId: row.agent_id || undefined,
      agentName: row.agent_name || undefined
    }
  },

  saveExecution(exe: Execution) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO executions (id, case_id, batch_id, target_agent_id, status, progress, created_at, updated_at, report_path, error_message, file_name, logs, agent_id, agent_name)
      VALUES (@id, @caseId, @batchId, @targetAgentId, @status, @progress, @createdAt, @updatedAt, @reportPath, @errorMessage, @fileName, @logs, @agentId, @agentName)
    `)
    stmt.run({
      id: exe.id,
      caseId: exe.caseId,
      batchId: exe.batchId || null,
      targetAgentId: exe.targetAgentId || null,
      status: exe.status,
      progress: exe.progress,
      createdAt: exe.createdAt,
      updatedAt: exe.updatedAt,
      reportPath: exe.reportPath || null,
      errorMessage: exe.errorMessage || null,
      fileName: exe.fileName || null,
      logs: exe.logs ? JSON.stringify(exe.logs) : null,
      agentId: exe.agentId || null,
      agentName: exe.agentName || null
    })
  },

  updateExecution(id: string, patch: Partial<Execution>) {
    const current = this.getExecution(id)
    if (!current) return

    const updated = { ...current, ...patch, updatedAt: Date.now() }
    this.saveExecution(updated)
  },

  deleteCase(id: string): boolean {
    // Check if case exists
    const tc = this.getCase(id)
    if (!tc) return false

    // Transaction for atomic deletion
    const deleteTx = db.transaction(() => {
      // 1. Delete associated executions
      db.prepare('DELETE FROM executions WHERE case_id = ?').run(id)
      
      // 2. Delete test case
      db.prepare('DELETE FROM test_cases WHERE id = ?').run(id)
    })

    try {
      deleteTx()
      return true
    } catch (error) {
      console.error('Failed to delete case:', error)
      return false
    }
  },

  resetPendingExecutions() {
    // Find pending executions
    const pendingRows = db.prepare(`
      SELECT * FROM executions 
      WHERE status = 'running' OR status = 'queued'
    `).all() as any[]

    if (pendingRows.length === 0) return 0

    console.log(`Resetting ${pendingRows.length} pending executions...`)
    
    const updateTx = db.transaction(() => {
      const now = Date.now()
      
      // Update executions
      const updateExeStmt = db.prepare(`
        UPDATE executions 
        SET status = 'failed', progress = 100, error_message = '服务异常终止，状态已重置', updated_at = ?
        WHERE id = ?
      `)

      // Update test cases status
      const updateCaseStmt = db.prepare(`
        UPDATE test_cases 
        SET status = 'error'
        WHERE id = ? AND status = 'running'
      `)

      for (const row of pendingRows) {
        updateExeStmt.run(now, row.id)
        updateCaseStmt.run(row.case_id)
      }
    })

    try {
      updateTx()
      return pendingRows.length
    } catch (error) {
      console.error('Failed to reset pending executions:', error)
      return 0
    }
  }
}
