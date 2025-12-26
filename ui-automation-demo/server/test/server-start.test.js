import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..', '..')

test('后端编译产物可正常启动', async () => {
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const onData = (buf) => {
    output += buf.toString()
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`启动超时\n${output}`))
    }, 5000)

    const onExit = (code) => {
      clearTimeout(timeout)
      reject(new Error(`进程提前退出 code=${code}\n${output}`))
    }

    child.once('exit', onExit)

    const timer = setInterval(() => {
      if (output.includes('Server listening on')) {
        clearTimeout(timeout)
        clearInterval(timer)
        child.off('exit', onExit)
        resolve(undefined)
      }
    }, 50)
  }).finally(() => {
    child.kill('SIGTERM')
  })

  assert.ok(true)
})
