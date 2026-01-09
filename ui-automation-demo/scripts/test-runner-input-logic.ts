
import { runTestCase, __setAndroidModuleLoaderForTest } from '../server/runner.android';
import { TestCase } from '../server/types';
import fs from 'fs';
import path from 'path';

// Setup mock environment
process.env.MIDSCENE_MODEL_BASE_URL = 'mock_url';
process.env.MIDSCENE_MODEL_API_KEY = 'mock_key';
process.env.MIDSCENE_MODEL_NAME = 'mock_model';
const MOCK_REPORT_DIR = path.resolve('./mock-reports');
process.env.UI_AUTOMATION_REPORT_DIR = MOCK_REPORT_DIR;

// Ensure report dir exists
if (!fs.existsSync(MOCK_REPORT_DIR)) {
  fs.mkdirSync(MOCK_REPORT_DIR, { recursive: true });
}

const callLog: string[] = [];

const mockAgent = {
  aiAct: async (instruction: string) => {
    callLog.push(`aiAct: ${instruction}`);
    return {};
  },
  aiQuery: async (instruction: string) => {
    callLog.push(`aiQuery: ${instruction}`);
    return {};
  },
  aiAssert: async (instruction: string) => {
    callLog.push(`aiAssert: ${instruction}`);
    return {};
  },
  aiInput: async (options: { value: string }) => {
    callLog.push(`aiInput: ${options.value}`);
    return {};
  }
};

const mockDevice = {
  connect: async () => { callLog.push('device.connect'); },
  destroy: async () => { callLog.push('device.destroy'); }
};

const mockModule = {
  getConnectedDevices: async () => [{ udid: 'mock-device-123' }],
  AndroidDevice: class {
    constructor(udid: string) { callLog.push(`new AndroidDevice(${udid})`); }
    connect = mockDevice.connect;
    destroy = mockDevice.destroy;
  },
  AndroidAgent: class {
    constructor(device: any, opts: any) { callLog.push(`new AndroidAgent`); }
    aiAct = mockAgent.aiAct;
    aiQuery = mockAgent.aiQuery;
    aiAssert = mockAgent.aiAssert;
    aiInput = mockAgent.aiInput;
  }
};

// Override loader
__setAndroidModuleLoaderForTest(async () => mockModule as any);

async function runTest() {
  console.log('--- Starting Input Logic Test ---');
  
  const testCase: TestCase = {
    id: 'test-input-logic',
    name: 'Input Logic Test',
    description: 'Testing input parsing',
    platform: 'android',
    status: 'idle',
    steps: [
      { id: '1', type: 'input', action: 'Hello World' }, // Explicit type
      { id: '2', action: '输入: 123456' },               // Implicit type via regex (Chinese colon)
      { id: '3', action: 'input: password123' },         // Implicit type via regex (English colon)
      { id: '4', action: '输入：Full Width Colon' },     // Implicit type via regex (Full width colon)
      { id: '5', type: 'action', action: 'Click button' } // Normal action
    ]
  };

  const updateCallback = (patch: any) => {
    // console.log('Update:', patch.status, patch.currentStepId);
  };

  try {
    await runTestCase(testCase, 'exec-test-1', updateCallback);
    
    console.log('--- Execution Log ---');
    console.log(callLog.join('\n'));

    // Verification
    const expectedCalls = [
      'aiInput: Hello World',
      'aiInput: 123456',
      'aiInput: password123',
      'aiInput: Full Width Colon',
      'aiAct: Click button'
    ];

    let success = true;
    for (const expected of expectedCalls) {
      if (!callLog.includes(expected)) {
        console.error(`❌ MISSING CALL: ${expected}`);
        success = false;
      } else {
        console.log(`✅ FOUND CALL: ${expected}`);
      }
    }

    if (success) {
      console.log('\n✅ TEST PASSED: All input variants handled correctly.');
    } else {
      console.error('\n❌ TEST FAILED: Missing expected calls.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ TEST FAILED with error:', error);
    process.exit(1);
  } finally {
    // Cleanup
    if (fs.existsSync(MOCK_REPORT_DIR)) {
      fs.rmSync(MOCK_REPORT_DIR, { recursive: true, force: true });
    }
  }
}

runTest();
