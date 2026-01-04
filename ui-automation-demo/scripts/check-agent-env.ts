
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import dotenv from 'dotenv'

const execAsync = promisify(exec)

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

function log(color: string, msg: string) {
  console.log(`${color}${msg}${COLORS.reset}`)
}

async function checkServerConnection(url: string): Promise<boolean> {
  // Convert ws/wss to http/https for health check
  const httpUrl = url.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '/api/testcases')
  
  return new Promise((resolve) => {
    const req = http.get(httpUrl, (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            resolve(true)
        } else {
            resolve(false)
        }
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
        req.destroy()
        resolve(false)
    })
  })
}

async function checkWDA(host: string, port: number): Promise<boolean> {
  const url = `http://${host}:${port}/status`
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
            resolve(true)
        } else {
            resolve(false)
        }
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
        req.destroy()
        resolve(false)
    })
  })
}

async function checkADB(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('adb devices')
    const lines = stdout.trim().split('\n')
    // First line is "List of devices attached", check if there are subsequent lines that are not empty
    return lines.length > 1 && lines[1].trim().length > 0
  } catch (e) {
    return false
  }
}

async function main() {
  console.log('\n🔍 Starting Agent Environment Check...\n')
  
  // Load .env
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
      log(COLORS.green, '✅ .env file found')
      dotenv.config()
  } else {
      log(COLORS.yellow, '⚠️  .env file not found. Using process.env only.')
  }

  let allGood = true

  // 1. Check Server Connection
  const serverUrl = process.env.SERVER_URL || 'ws://localhost:3002/ws'
  log(COLORS.cyan, `\n[1] Checking Server Connection (${serverUrl})...`)
  const serverConnected = await checkServerConnection(serverUrl)
  if (serverConnected) {
      log(COLORS.green, '✅ Server is reachable')
  } else {
      log(COLORS.red, '❌ Server is NOT reachable. Is the backend running?')
      allGood = false
  }

  // 2. Check MidScene Config
  log(COLORS.cyan, `\n[2] Checking MidScene Configuration...`)
  const midSceneKeys = [
      'MIDSCENE_MODEL_BASE_URL',
      'MIDSCENE_MODEL_API_KEY',
      'MIDSCENE_MODEL_NAME'
  ]
  
  // Debug: print what we see (masked)
  console.log('   Loaded Environment Variables (MidScene related):')
  Object.keys(process.env).filter(k => k.startsWith('MIDSCENE_')).forEach(k => {
      const val = process.env[k]
      const masked = val ? (val.length > 10 ? val.slice(0, 4) + '***' + val.slice(-4) : '***') : '(empty)'
      console.log(`   - ${k}: ${masked}`)
  })

  const missingKeys = midSceneKeys.filter(k => !process.env[k])
  if (missingKeys.length === 0) {
      log(COLORS.green, '✅ MidScene API keys are configured')
  } else {
      log(COLORS.red, `❌ Missing MidScene keys: ${missingKeys.join(', ')}`)
      log(COLORS.yellow, '   Agent will run in "Placeholder Mode" (no AI execution).')
      // This is a soft fail, so maybe not setting allGood = false unless strict
  }

  // 3. Platform Specific Checks
  const platform = process.env.AGENT_PLATFORM || 'ios'
  log(COLORS.cyan, `\n[3] Checking Platform Dependencies (Target: ${platform})...`)
  
  if (platform === 'ios') {
      const wdaHost = process.env.WDA_HOST || 'localhost'
      const wdaPort = Number(process.env.WDA_PORT) || 8100
      log(COLORS.cyan, `   Checking WDA at http://${wdaHost}:${wdaPort}/status ...`)
      const wdaOk = await checkWDA(wdaHost, wdaPort)
      if (wdaOk) {
          log(COLORS.green, '✅ WebDriverAgent is running')
      } else {
          log(COLORS.red, '❌ WebDriverAgent is NOT responding.')
          log(COLORS.yellow, '   Please ensure WDA is running on your iPhone/Simulator via Xcode.')
          allGood = false
      }
  } else if (platform === 'android') {
      log(COLORS.cyan, '   Checking ADB connection...')
      const adbOk = await checkADB()
      if (adbOk) {
          log(COLORS.green, '✅ Android device connected via ADB')
      } else {
          log(COLORS.red, '❌ No Android device found via ADB.')
          log(COLORS.yellow, '   Please connect a device and enable USB Debugging.')
          allGood = false
      }
  }

  console.log('\n' + '-'.repeat(30) + '\n')
  if (allGood) {
      log(COLORS.green, '🎉 Environment looks good! You can start the agent.')
      console.log(`   Run: AGENT_PLATFORM=${platform} npm run agent:${platform}`)
  } else {
      log(COLORS.red, '💥 Please fix the issues above before starting the agent.')
  }
}

main().catch(console.error)
