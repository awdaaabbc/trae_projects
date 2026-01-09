import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.UI_AUTOMATION_DATA_DIR
  ? path.resolve(process.env.UI_AUTOMATION_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'automation.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize tables
export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS test_cases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      platform TEXT NOT NULL,
      steps TEXT NOT NULL, -- JSON
      status TEXT NOT NULL,
      last_run_at INTEGER,
      last_report_path TEXT
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      batch_id TEXT,
      target_agent_id TEXT,
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      report_path TEXT,
      error_message TEXT,
      file_name TEXT,
      logs TEXT, -- JSON
      agent_id TEXT,
      agent_name TEXT,
      FOREIGN KEY(case_id) REFERENCES test_cases(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_executions_case_id ON executions(case_id);
    CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at);
  `);

  // Migration: Add context column to test_cases if it doesn't exist
  try {
    const columns = db.pragma('table_info(test_cases)') as any[];
    const hasContext = columns.some(col => col.name === 'context');
    if (!hasContext) {
      db.exec('ALTER TABLE test_cases ADD COLUMN context TEXT');
      console.log('[DB] Added context column to test_cases');
    }
  } catch (err) {
    console.error('[DB] Failed to migrate test_cases schema:', err);
  }
}

export default db;
