
import 'dotenv/config'
import { spawn } from 'child_process'
import path from 'path'

const SERVER = (process.env.SERVER_URL || 'http://localhost:3002').replace('/ws', '')
const AGENT_ID_1 = 'agent-test-001'
const AGENT_ID_2 = 'agent-test-002'

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function startAgent(id: string, name: string) {
  console.log(`Starting Agent ${id} (${name})...`)
  const agentProcess = spawn('npm', ['run', 'agent:ios'], {
    env: {
      ...process.env,
      AGENT_ID: id,
      AGENT_DEVICE_NAME: name,
      // Disable colors to make log parsing easier if needed, though we just need it running
      FORCE_COLOR: '0'
    },
    stdio: 'ignore', // Run in background, we don't need its output
    detached: true   // Allow it to run independently
  })
  agentProcess.unref()
  return agentProcess
}

async function getAgents() {
  const res = await fetch(`${SERVER}/api/agents`)
  const data = await res.json() as { data: any[] }
  return data.data
}

async function main() {
  console.log('=== Verifying Targeted Dispatch ===\n')

  // 1. Start two distinct agents
  await startAgent(AGENT_ID_1, 'Device A')
  await startAgent(AGENT_ID_2, 'Device B')

  console.log('Waiting for agents to connect...')
  await sleep(5000)

  // 2. Verify agents are online
  const agents = await getAgents()
  const agent1 = agents.find(a => a.id === AGENT_ID_1)
  const agent2 = agents.find(a => a.id === AGENT_ID_2)

  if (!agent1 || !agent2) {
    console.error('Failed: Agents did not connect successfully.')
    console.log('Online agents:', agents.map(a => `${a.id} (${a.deviceName})`))
    return
  }
  console.log('✓ Both agents connected successfully.')

  // 3. Get a test case
  const casesRes = await fetch(`${SERVER}/api/testcases`)
  const casesData = await casesRes.json() as { data: any[] }
  const iosCase = casesData.data.find((c: any) => c.platform === 'ios')

  if (!iosCase) {
    console.error('Failed: No iOS test case found. Please create one first.')
    return
  }

  // 4. Dispatch task to Agent 1 specifically
  console.log(`\nDispatching task to Agent 1 (${AGENT_ID_1})...`)
  const run1 = await fetch(`${SERVER}/api/execute/${iosCase.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetAgentId: AGENT_ID_1 })
  })
  const run1Data = await run1.json()
  
  if (run1Data.data.targetAgentId === AGENT_ID_1 && run1Data.data.agentId === AGENT_ID_1) {
    console.log(`✓ Task correctly assigned to Agent 1. Execution ID: ${run1Data.data.id}`)
  } else {
    console.error('✗ Task dispatch failed for Agent 1', run1Data)
  }

  // 5. Dispatch task to Agent 2 specifically
  console.log(`\nDispatching task to Agent 2 (${AGENT_ID_2})...`)
  const run2 = await fetch(`${SERVER}/api/execute/${iosCase.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetAgentId: AGENT_ID_2 })
  })
  const run2Data = await run2.json()

  if (run2Data.data.targetAgentId === AGENT_ID_2 && run2Data.data.agentId === AGENT_ID_2) {
    console.log(`✓ Task correctly assigned to Agent 2. Execution ID: ${run2Data.data.id}`)
  } else {
    console.error('✗ Task dispatch failed for Agent 2', run2Data)
  }

  console.log('\n=== Verification Complete ===')
  console.log('You can check the web UI to see the execution records with correct agent names.')
  
  // Note: We are not killing the agents automatically here to let you verify in UI.
  // You might want to manually kill them later using `pkill -f "agent:ios"` or similar.
}

main().catch(console.error)
