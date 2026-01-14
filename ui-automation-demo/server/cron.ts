
import cron from 'node-cron'
import fs from 'node:fs'
import path from 'node:path'
import { Storage } from './storage.js'
import type { Execution } from './types.js'

// Ensure reports directory exists
const REPORT_DIR = process.env.UI_AUTOMATION_REPORT_DIR
  ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
  : path.resolve(process.cwd(), 'midscene_run', 'report')

const DAILY_REPORT_DIR = path.join(REPORT_DIR, 'daily')

if (!fs.existsSync(DAILY_REPORT_DIR)) {
  fs.mkdirSync(DAILY_REPORT_DIR, { recursive: true })
}

export function initCron() {
  console.log('[Cron] Initializing daily report job (09:30 every day)...')
  
  // Schedule task at 09:30 AM
  cron.schedule('30 9 * * *', () => {
    console.log('[Cron] Triggering daily report generation...')
    generateDailyReport()
  })
}

export async function generateDailyReport() {
  try {
    const now = new Date()
    // Set time to today 09:30 for consistent range if manually triggered, 
    // or just use current execution time as end time.
    // Let's use exact 24h window ending now.
    const endTime = now.getTime()
    const startTime = endTime - 24 * 60 * 60 * 1000
    
    console.log(`[Cron] Generating report for window: ${new Date(startTime).toISOString()} - ${new Date(endTime).toISOString()}`)

    // Fetch recent executions (assume < 10000 per day)
    const allExecutions = Storage.listExecutions(10000)
    
    // Filter for time window and status
    const dailyExecutions = allExecutions.filter(e => e.createdAt >= startTime && e.createdAt <= endTime)
    const failures = dailyExecutions.filter(e => e.status === 'failed')
    const successCount = dailyExecutions.filter(e => e.status === 'success').length
    const totalCount = dailyExecutions.length
    
    // Generate HTML
    const dateStr = now.toISOString().split('T')[0]
    const html = generateHtmlReport(dateStr, failures, totalCount, successCount, startTime, endTime)
    
    const fileName = `daily-report-${dateStr}.html`
    const filePath = path.join(DAILY_REPORT_DIR, fileName)
    
    fs.writeFileSync(filePath, html)
    console.log(`[Cron] Daily report generated: ${filePath}`)
    
    return filePath
  } catch (err) {
    console.error('[Cron] Failed to generate daily report:', err)
  }
}

function generateHtmlReport(
  dateStr: string, 
  failures: Execution[], 
  total: number, 
  success: number,
  start: number,
  end: number
): string {
  const failureList = failures.map(f => {
    const tc = Storage.getCase(f.caseId)
    const caseName = tc ? tc.name : 'Unknown Case'
    const errorMsg = f.errorMessage || 'No error message'
    const reportLink = f.reportPath ? `../${f.reportPath}` : '#'
    const time = new Date(f.createdAt).toLocaleString()
    
    return `
      <tr class="failure-row">
        <td>${time}</td>
        <td><strong>${caseName}</strong></td>
        <td class="error-msg">${errorMsg}</td>
        <td><a href="${reportLink}" target="_blank">View Report</a></td>
      </tr>
    `
  }).join('')

  const emptyState = failures.length === 0 
    ? '<tr><td colspan="4" style="text-align:center; padding: 20px;">🎉 No failures in the last 24 hours!</td></tr>'
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Automation Daily Report - ${dateStr}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; }
    .summary { display: flex; gap: 20px; margin-bottom: 30px; background: #f5f5f5; padding: 15px; border-radius: 8px; }
    .card { flex: 1; text-align: center; }
    .card .num { font-size: 24px; font-weight: bold; display: block; }
    .card.danger .num { color: #d93025; }
    .card.success .num { color: #188038; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
    th { background-color: #f9f9f9; }
    .error-msg { color: #d93025; font-family: monospace; font-size: 0.9em; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .footer { margin-top: 40px; font-size: 0.8em; color: #888; text-align: center; }
  </style>
</head>
<body>
  <h1>📅 Daily Automation Report</h1>
  <p>Period: ${new Date(start).toLocaleString()} - ${new Date(end).toLocaleString()}</p>
  
  <div class="summary">
    <div class="card">
      <span class="num">${total}</span>
      <span class="label">Total Runs</span>
    </div>
    <div class="card success">
      <span class="num">${success}</span>
      <span class="label">Success</span>
    </div>
    <div class="card danger">
      <span class="num">${failures.length}</span>
      <span class="label">Failures</span>
    </div>
    <div class="card">
      <span class="num">${total > 0 ? ((success / total) * 100).toFixed(1) : 0}%</span>
      <span class="label">Pass Rate</span>
    </div>
  </div>

  <h2>🔴 Failure Details</h2>
  <table>
    <thead>
      <tr>
        <th>Time</th>
        <th>Case Name</th>
        <th>Error</th>
        <th>Report</th>
      </tr>
    </thead>
    <tbody>
      ${failureList}
      ${emptyState}
    </tbody>
  </table>

  <div class="footer">
    Generated automatically by UI Automation Service
  </div>
</body>
</html>
  `
}
