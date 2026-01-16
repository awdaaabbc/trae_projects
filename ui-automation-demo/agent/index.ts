import WebSocket from 'ws'
import 'dotenv/config'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as androidRunner from '../server/runner.android.js'
import * as iosRunner from '../server/runner.ios.js'
import type { ServerToAgentMessage, AgentToServerMessage, AgentInfo } from '../server/protocol.js'

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3002/ws'
const AGENT_PLATFORM = (process.env.AGENT_PLATFORM as 'ios' | 'android') || 'ios'
// Support both AGENT_NAME and AGENT_DEVICE_NAME, default to hostname
const AGENT_DEVICE_NAME = process.env.AGENT_NAME || process.env.AGENT_DEVICE_NAME || os.hostname()
const AGENT_ID = process.env.AGENT_ID || `agent-${Math.random().toString(36).slice(2, 9)}`

const runner = AGENT_PLATFORM === 'android' ? androidRunner : iosRunner
const { runTestCase, cancelExecution } = runner

console.log(`Starting Agent...`)
console.log(`Server: ${SERVER_URL}`)
console.log(`Platform: ${AGENT_PLATFORM}`)
console.log(`Device: ${AGENT_DEVICE_NAME}`)
console.log(`Agent ID: ${AGENT_ID}`)

let ws: WebSocket | null = null
let reconnectTimer: NodeJS.Timeout | null = null

function connect() {
  ws = new WebSocket(SERVER_URL)

  ws.on('open', () => {
    console.log('Connected to server')
    const registerMsg: AgentToServerMessage = {
      type: 'REGISTER',
      payload: {
        id: AGENT_ID,
        platform: AGENT_PLATFORM,
        deviceName: AGENT_DEVICE_NAME,
        status: 'idle',
      },
    }
    ws?.send(JSON.stringify(registerMsg))
  })

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ServerToAgentMessage
      console.log('Received message:', msg.type)

      if (msg.type === 'EXECUTE_TASK') {
        const { executionId, testCase } = msg.payload
        console.log(`Executing task ${executionId} for case ${testCase.id}`)

        // Update status to busy? 
        // Ideally we should tell server we are busy, but server handles distribution.
        
        try {
          const result = await runTestCase(testCase, executionId, (patch) => {
          const updateMsg: AgentToServerMessage = {
            type: 'UPDATE_EXECUTION',
            payload: { executionId, patch },
          }
          ws?.send(JSON.stringify(updateMsg))
        }, (log) => {
          const logMsg: AgentToServerMessage = {
            type: 'APPEND_LOG',
            payload: { executionId, log },
          }
          ws?.send(JSON.stringify(logMsg))
        })

          let reportContent: string | undefined
          if (result.reportPath) {
             // Try to read report content
             // runner.ios.ts uses process.env.UI_AUTOMATION_REPORT_DIR or defaults to midscene_run/report
             const reportRoot = process.env.UI_AUTOMATION_REPORT_DIR
                ? path.resolve(process.env.UI_AUTOMATION_REPORT_DIR)
                : path.resolve(process.cwd(), 'midscene_run', 'report')
             
             const fullPath = path.join(reportRoot, result.reportPath)
             if (fs.existsSync(fullPath)) {
                reportContent = fs.readFileSync(fullPath, 'utf-8')
             }
          }

          const completeMsg: AgentToServerMessage = {
            type: 'TASK_COMPLETED',
            payload: { executionId, result, reportContent },
          }
          console.log(`[Agent] Task ${executionId} completed. Status: ${result.status}. Sending result to server...`)
          ws?.send(JSON.stringify(completeMsg))

        } catch (err) {
          console.error('Execution error:', err)
          const errorMsg: AgentToServerMessage = {
            type: 'TASK_COMPLETED',
            payload: { 
                executionId, 
                result: { status: 'failed', errorMessage: String(err) } 
            },
          }
          ws?.send(JSON.stringify(errorMsg))
        }

      } else if (msg.type === 'CANCEL_TASK') {
        const { executionId } = msg.payload
        console.log(`Cancelling task ${executionId}`)
        cancelExecution(executionId)
      }
    } catch (err) {
      console.error('Failed to handle message:', err)
    }
  })

  ws.on('close', () => {
    console.log('Disconnected from server')
    scheduleReconnect()
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err)
    ws?.close()
  })
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    console.log('Reconnecting...')
    connect()
  }, 3000)
}

connect()
