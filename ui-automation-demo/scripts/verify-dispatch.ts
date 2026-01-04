
import 'dotenv/config'

const SERVER = (process.env.SERVER_URL || 'http://localhost:3002').replace('/ws', '')

async function main() {
  console.log(`Checking Server at ${SERVER}...`)

  // 1. 获取在线 Agent 列表
  const agentsRes = await fetch(`${SERVER}/api/agents`)
  const agentsData = await agentsRes.json() as { data: any[] }
  const agents = agentsData.data

  console.log('\n=== Online Agents ===')
  if (agents.length === 0) {
    console.log('No agents connected.')
    return
  }
  agents.forEach(a => {
    console.log(`- ID: ${a.id}, Device: ${a.deviceName}, Status: ${a.status}`)
  })

  // 2. 获取 iOS 测试用例
  const casesRes = await fetch(`${SERVER}/api/testcases`)
  const casesData = await casesRes.json() as { data: any[] }
  const iosCases = casesData.data.filter((c: any) => c.platform === 'ios')

  if (iosCases.length === 0) {
    console.log('\nNo iOS test cases found. Please create one first.')
    return
  }

  const targetCase = iosCases[0]
  
  // 3. 模拟分发测试
  // 我们尝试分发给列表中的最后一个 Agent (假设是你新启动的那个)
  const targetAgent = agents[agents.length - 1]

  console.log(`\n=== Dispatch Test ===`)
  console.log(`Task: ${targetCase.name} (${targetCase.id})`)
  console.log(`Target Agent: ${targetAgent.id}`)

  const runRes = await fetch(`${SERVER}/api/execute/${targetCase.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetAgentId: targetAgent.id })
  })

  const runData = await runRes.json()
  console.log('\nResponse:', JSON.stringify(runData, null, 2))
}

main().catch(console.error)
