import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  runTestCase,
  cancelExecution,
  __setAndroidModuleLoaderForTest,
} from '../../dist/server/runner.android.js'

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

test('Android runner: 未配置模型时生成占位报告并返回 reportPath', async () => {
  const tmp = withTempDir('ui-automation-demo-android-report-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    UI_AUTOMATION_ANDROID_PLACEHOLDER_DELAY_MS: '0',
    MIDSCENE_MODEL_BASE_URL: '',
    MIDSCENE_MODEL_API_KEY: '',
    MIDSCENE_MODEL_NAME: '',
  })

  try {
    const patches = []
    const res = await runTestCase(
      {
        id: 'tc-1',
        name: 't',
        description: 'd',
        platform: 'android',
        steps: [],
        status: 'idle',
      },
      'exe-1',
      (p) => patches.push(p)
    )

    assert.equal(res.status, 'success')
    assert.ok(typeof res.reportPath === 'string')

    const reportAbs = path.join(tmp.dir, res.reportPath)
    assert.ok(fs.existsSync(reportAbs))
    const html = fs.readFileSync(reportAbs, 'utf8')
    assert.ok(html.includes('Android Runner'))

    assert.ok(patches.some((p) => p.status === 'running'))
    assert.ok(patches.some((p) => p.progress === 100))
  } finally {
    restoreEnv()
    tmp.cleanup()
  }
})

test('Android runner: 有模型时按步骤分发到 aiAct/aiQuery/aiAssert 并清理设备', async () => {
  const tmp = withTempDir('ui-automation-demo-android-report-')
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

  __setAndroidModuleLoaderForTest(async () => {
    class AndroidDevice {
      async connect() {
        calls.connect++
      }
      async destroy() {
        calls.destroy++
      }
    }

    class AndroidAgent {
      constructor(_device, opts) {
        const reportFileName = opts?.reportFileName
        if (reportFileName) {
          fs.writeFileSync(
            path.join(tmp.dir, `${reportFileName}.html`),
            '<!doctype html><html><body>mock</body></html>',
            'utf8'
          )
        }
      }
      async aiAct(instruction) {
        calls.aiAct.push(instruction)
      }
      async aiQuery(instruction) {
        calls.aiQuery.push(instruction)
        return { ok: true }
      }
      async aiAssert(instruction) {
        calls.aiAssert.push(instruction)
        return { ok: true }
      }
    }

    return {
      getConnectedDevices: async () => [{ udid: 'udid-1' }],
      AndroidDevice,
      AndroidAgent,
    }
  })

  try {
    const patches = []
    const res = await runTestCase(
      {
        id: 'tc-2',
        name: 't',
        description: 'd',
        platform: 'android',
        steps: [
          { id: 's1', type: 'action', action: 'do action' },
          { id: 's2', type: 'query', action: 'do query' },
          { id: 's3', type: 'assert', action: 'do assert' },
        ],
        status: 'idle',
      },
      'exe-2',
      (p) => patches.push(p)
    )

    assert.equal(res.status, 'success')
    assert.ok(typeof res.reportPath === 'string')
    assert.ok(fs.existsSync(path.join(tmp.dir, res.reportPath)))

    assert.equal(calls.connect, 1)
    assert.equal(calls.destroy, 1)
    assert.deepEqual(calls.aiAct, ['do action'])
    assert.deepEqual(calls.aiQuery, ['do query'])
    assert.deepEqual(calls.aiAssert, ['do assert'])

    assert.ok(patches.some((p) => p.status === 'running'))
    assert.ok(patches.some((p) => p.progress === 100))
  } finally {
    __setAndroidModuleLoaderForTest(undefined)
    restoreEnv()
    tmp.cleanup()
  }
})

test('Android runner: 设备列表为空时返回 failed', async () => {
  const tmp = withTempDir('ui-automation-demo-android-report-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    MIDSCENE_MODEL_BASE_URL: 'x',
    MIDSCENE_MODEL_API_KEY: 'x',
    MIDSCENE_MODEL_NAME: 'x',
  })

  __setAndroidModuleLoaderForTest(async () => {
    class AndroidDevice {
      async connect() {}
      async destroy() {}
    }
    class AndroidAgent {
      async aiAct() {}
      async aiQuery() {}
      async aiAssert() {}
    }
    return {
      getConnectedDevices: async () => [],
      AndroidDevice,
      AndroidAgent,
    }
  })

  try {
    const res = await runTestCase(
      {
        id: 'tc-3',
        name: 't',
        description: 'd',
        platform: 'android',
        steps: [{ id: 's1', type: 'action', action: 'do action' }],
        status: 'idle',
      },
      'exe-3',
      () => {}
    )
    assert.equal(res.status, 'failed')
    assert.ok(res.errorMessage?.includes('未检测到 Android 设备'))
  } finally {
    __setAndroidModuleLoaderForTest(undefined)
    restoreEnv()
    tmp.cleanup()
  }
})

test('Android runner: cancelExecution 可中止执行并触发清理', async () => {
  const tmp = withTempDir('ui-automation-demo-android-report-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    MIDSCENE_MODEL_BASE_URL: 'x',
    MIDSCENE_MODEL_API_KEY: 'x',
    MIDSCENE_MODEL_NAME: 'x',
  })

  const calls = { destroy: 0 }

  __setAndroidModuleLoaderForTest(async () => {
    class AndroidDevice {
      async connect() {}
      async destroy() {
        calls.destroy++
      }
    }

    class AndroidAgent {
      async aiAct() {
        await new Promise(() => {})
      }
      async aiQuery() {}
      async aiAssert() {}
    }

    return {
      getConnectedDevices: async () => [{ udid: 'udid-1' }],
      AndroidDevice,
      AndroidAgent,
    }
  })

  try {
    const promise = runTestCase(
      {
        id: 'tc-4',
        name: 't',
        description: 'd',
        platform: 'android',
        steps: [{ id: 's1', type: 'action', action: 'long running' }],
        status: 'idle',
      },
      'exe-4',
      () => {}
    )

    await new Promise((r) => setTimeout(r, 10))
    assert.equal(cancelExecution('exe-4'), true)
    const res = await promise

    assert.equal(res.status, 'failed')
    assert.ok(res.errorMessage?.includes('Execution cancelled'))
    assert.ok(calls.destroy >= 1)
  } finally {
    __setAndroidModuleLoaderForTest(undefined)
    restoreEnv()
    tmp.cleanup()
  }
})

test('Android runner: 报告文件缺失时回退到目录最新 html', async () => {
  const tmp = withTempDir('ui-automation-demo-android-report-')
  const restoreEnv = withEnv({
    UI_AUTOMATION_REPORT_DIR: tmp.dir,
    MIDSCENE_MODEL_BASE_URL: 'x',
    MIDSCENE_MODEL_API_KEY: 'x',
    MIDSCENE_MODEL_NAME: 'x',
  })

  __setAndroidModuleLoaderForTest(async () => {
    class AndroidDevice {
      async connect() {}
      async destroy() {}
    }

    class AndroidAgent {
      constructor() {
        fs.writeFileSync(
          path.join(tmp.dir, 'latest.html'),
          '<!doctype html><html><body>latest</body></html>',
          'utf8'
        )
      }
      async aiAct() {}
      async aiQuery() {}
      async aiAssert() {}
    }

    return {
      getConnectedDevices: async () => [{ udid: 'udid-1' }],
      AndroidDevice,
      AndroidAgent,
    }
  })

  try {
    const res = await runTestCase(
      {
        id: 'tc-5',
        name: 't',
        description: 'd',
        platform: 'android',
        steps: [],
        status: 'idle',
      },
      'exe-5',
      () => {}
    )

    assert.equal(res.status, 'success')
    assert.equal(res.reportPath, 'latest.html')
  } finally {
    __setAndroidModuleLoaderForTest(undefined)
    restoreEnv()
    tmp.cleanup()
  }
})
