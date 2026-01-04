import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  runTestCase,
  cancelExecution,
  __setIosModuleLoaderForTest,
} from '../../dist/server/runner.ios.js'

function withTempDir(prefix) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    dir: tmpRoot,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  }
}

function withEnv(patch) {
  const prev = {}
  for (const [k, v] of Object.entries(patch)) {
    prev[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('iOS runner: 未配置模型时生成占位报告并返回 reportPath', async () => {
  const tmp = withTempDir('ui-automation-demo-ios-report-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    UI_AUTOMATION_IOS_PLACEHOLDER_DELAY_MS: '0',
    MIDSCENE_MODEL_BASE_URL: '',
    MIDSCENE_MODEL_API_KEY: '',
    MIDSCENE_MODEL_NAME: '',
  })

  try {
    const patches = []
    const res = await runTestCase(
      {
        id: 'tc-ios-1',
        name: 'ios-test',
        description: 'd',
        platform: 'ios',
        steps: [],
        status: 'idle',
      },
      'exe-ios-1',
      (p) => patches.push(p)
    )

    assert.equal(res.status, 'success')
    assert.ok(typeof res.reportPath === 'string')

    const reportAbs = path.join(tmp.dir, res.reportPath)
    assert.ok(fs.existsSync(reportAbs))
    const html = fs.readFileSync(reportAbs, 'utf8')
    assert.ok(html.includes('iOS Runner'))

    assert.ok(patches.some((p) => p.status === 'running'))
    assert.ok(patches.some((p) => p.progress === 100))
  } finally {
    restoreEnv()
    tmp.cleanup()
  }
})

test('iOS runner: 有模型时按步骤分发到 aiAct/aiQuery/aiAssert 并清理设备', async () => {
  const tmp = withTempDir('ui-automation-demo-ios-report-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    MIDSCENE_MODEL_BASE_URL: 'x',
    MIDSCENE_MODEL_API_KEY: 'x',
    MIDSCENE_MODEL_NAME: 'x',
  })

  const calls = {
    connect: 0,
    destroy: 0,
    aiAct: [],
    aiQuery: [],
    aiAssert: [],
  }

  __setIosModuleLoaderForTest(async () => {
    class IOSDevice {
      async connect() {
        calls.connect++
      }
      async destroy() {
        calls.destroy++
      }
    }

    class IOSAgent {
      async aiAct(instruction) {
        calls.aiAct.push(instruction)
      }
      async aiQuery(instruction) {
        calls.aiQuery.push(instruction)
        return 'query-result'
      }
      async aiAssert(instruction) {
        calls.aiAssert.push(instruction)
      }
    }

    return { IOSDevice, IOSAgent }
  })

  try {
    const res = await runTestCase(
      {
        id: 'tc-ios-real',
        name: 't',
        description: 'd',
        platform: 'ios',
        steps: [
          { id: '1', action: 'tap button' }, // default act
          { id: '2', action: 'find text', type: 'query' },
          { id: '3', action: 'check text', type: 'assert' },
        ],
        status: 'idle',
      },
      'exe-ios-real',
      () => {}
    )

    assert.equal(res.status, 'success')
    assert.equal(calls.connect, 1)
    assert.equal(calls.destroy, 1)
    assert.deepEqual(calls.aiAct, ['tap button'])
    assert.deepEqual(calls.aiQuery, ['find text'])
    assert.deepEqual(calls.aiAssert, ['check text'])
  } finally {
    __setIosModuleLoaderForTest(undefined) // restore
    restoreEnv()
    tmp.cleanup()
  }
})

test('iOS runner: 任务取消时正确调用 destroy', async () => {
  const tmp = withTempDir('ui-automation-demo-ios-cancel-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    MIDSCENE_MODEL_BASE_URL: 'x',
    MIDSCENE_MODEL_API_KEY: 'x',
    MIDSCENE_MODEL_NAME: 'x',
  })

  let destroyed = false
  let actCalled = false

  __setIosModuleLoaderForTest(async () => {
    class IOSDevice {
      async connect() {}
      async destroy() {
        destroyed = true
      }
    }
    class IOSAgent {
      async aiAct() {
        actCalled = true
        // simulate long running task
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    return { IOSDevice, IOSAgent }
  })

  try {
    const promise = runTestCase(
      {
        id: 'tc-ios-cancel',
        name: 't',
        description: 'd',
        platform: 'ios',
        steps: [{ id: '1', action: 'long task' }],
        status: 'idle',
      },
      'exe-ios-cancel',
      () => {}
    )

    // Wait a bit for it to start
    setTimeout(() => {
      const cancelled = cancelExecution('exe-ios-cancel')
      assert.equal(cancelled, true)
    }, 100)

    const res = await promise
    assert.equal(res.status, 'failed')
    assert.ok(res.errorMessage.includes('cancelled') || res.errorMessage.includes('Aborted'))

    assert.equal(destroyed, true)
  } finally {
    __setIosModuleLoaderForTest(undefined)
    restoreEnv()
    tmp.cleanup()
  }
})
