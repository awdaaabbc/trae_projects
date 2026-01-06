import fs from 'node:fs';
import path from 'node:path';
import db, { initDB } from '../server/db.js';
import type { TestCase, Execution } from '../server/types.js';

const DATA_DIR = process.env.UI_AUTOMATION_DATA_DIR
  ? path.resolve(process.env.UI_AUTOMATION_DATA_DIR)
  : path.resolve(process.cwd(), 'data', 'testcases');
const EXEC_DIR = process.env.UI_AUTOMATION_EXEC_DIR
  ? path.resolve(process.env.UI_AUTOMATION_EXEC_DIR)
  : path.resolve(process.cwd(), 'data', 'executions');

function loadCasesFromFiles(): TestCase[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = fs.readdirSync(DATA_DIR);
  const cases: TestCase[] = [];
  
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        const parsed = JSON.parse(content) as Partial<TestCase>;
        const tc: TestCase = {
          id: parsed.id || '',
          name: parsed.name || '',
          description: parsed.description || '',
          platform: parsed.platform === 'android' ? 'android' : parsed.platform === 'ios' ? 'ios' : 'web',
          steps: Array.isArray(parsed.steps) ? parsed.steps : [],
          status: parsed.status || 'idle',
          lastRunAt: parsed.lastRunAt,
          lastReportPath: parsed.lastReportPath,
        };
        cases.push(tc);
      } catch (err) {
        console.error(`Failed to load test case ${file}:`, err);
      }
    }
  }
  return cases;
}

function loadExecutionsFromFiles(): Execution[] {
  if (!fs.existsSync(EXEC_DIR)) return [];
  const files = fs.readdirSync(EXEC_DIR);
  const executions: Execution[] = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(path.join(EXEC_DIR, file), 'utf-8');
        const exe = JSON.parse(content) as Execution;
        executions.push(exe);
      } catch (err) {
        console.error(`Failed to load execution ${file}:`, err);
      }
    }
  }
  return executions;
}

function migrate() {
  console.log('Initializing database...');
  initDB();

  console.log('Loading data from files...');
  const cases = loadCasesFromFiles();
  const executions = loadExecutionsFromFiles();

  console.log(`Found ${cases.length} test cases and ${executions.length} executions.`);

  const caseIds = new Set(cases.map(c => c.id));
  const validExecutions = executions.filter(e => caseIds.has(e.caseId));
  const orphanedCount = executions.length - validExecutions.length;

  if (orphanedCount > 0) {
    console.warn(`Skipping ${orphanedCount} orphaned executions (case not found).`);
  }

  const insertCase = db.prepare(`
    INSERT OR REPLACE INTO test_cases (id, name, description, platform, steps, status, last_run_at, last_report_path)
    VALUES (@id, @name, @description, @platform, @steps, @status, @lastRunAt, @lastReportPath)
  `);

  const insertExecution = db.prepare(`
    INSERT OR REPLACE INTO executions (id, case_id, batch_id, target_agent_id, status, progress, created_at, updated_at, report_path, error_message, file_name, logs, agent_id, agent_name)
    VALUES (@id, @caseId, @batchId, @targetAgentId, @status, @progress, @createdAt, @updatedAt, @reportPath, @errorMessage, @fileName, @logs, @agentId, @agentName)
  `);

  const runMigration = db.transaction(() => {
    let casesMigrated = 0;
    for (const tc of cases) {
      insertCase.run({
        id: tc.id,
        name: tc.name,
        description: tc.description,
        platform: tc.platform,
        steps: JSON.stringify(tc.steps),
        status: tc.status,
        lastRunAt: tc.lastRunAt || null,
        lastReportPath: tc.lastReportPath || null
      });
      casesMigrated++;
    }
    console.log(`Migrated ${casesMigrated} test cases.`);

    let executionsMigrated = 0;
    for (const exe of validExecutions) {
      insertExecution.run({
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
      });
      executionsMigrated++;
    }
    console.log(`Migrated ${executionsMigrated} executions.`);
  });

  try {
    runMigration();
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
