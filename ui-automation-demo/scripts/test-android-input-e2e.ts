
import { execSync } from 'child_process';
import { runTestCase } from '../server/runner.android';
import { TestCase } from '../server/types';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

async function main() {
  console.log('=== Android Input E2E Test ===');

  // 1. Check for devices
  try {
    const devicesOutput = execSync('adb devices').toString();
    const lines = devicesOutput.split('\n').filter(l => l.trim() && !l.startsWith('List'));
    const devices = lines.map(l => l.split('\t')[0]).filter(Boolean);

    if (devices.length === 0) {
      console.warn('⚠️ No Android devices connected. Skipping E2E test.');
      console.log('To run this test, connect an Android device/emulator and enable USB debugging.');
      return;
    }
    console.log(`✓ Found device(s): ${devices.join(', ')}`);
  } catch (e) {
    console.error('❌ Error checking for devices (adb not found?):', e);
    return;
  }

  // 2. Check MidScene config
  if (!process.env.MIDSCENE_MODEL_BASE_URL || !process.env.MIDSCENE_MODEL_API_KEY) {
    console.warn('⚠️ MidScene environment variables missing. Test will likely run in placeholder mode or fail.');
    console.log('Please ensure .env has MIDSCENE_MODEL_* variables.');
  }

  // 3. Define Test Case
  const testCase: TestCase = {
    id: 'e2e-input-test',
    name: 'E2E Input Test',
    description: 'Real execution of input command',
    platform: 'android',
    status: 'idle',
    steps: [
      { 
        id: '1', 
        type: 'action', 
        action: '点击搜索或者打开任意一个输入框' // Flexible instruction
      },
      { 
        id: '2', 
        action: '输入: MidSceneTest' // The input command
      },
      {
        id: '3',
        type: 'assert',
        action: '当前界面包含文本 "MidSceneTest"'
      }
    ]
  };

  // 4. Run Test
  console.log('\nStarting execution...');
  const updateCallback = (patch: any) => {
    if (patch.status) console.log(`Status update: ${patch.status}`);
    // Logs are not passed in patch for runner.android yet, but we can verify execution flow
  };

  try {
    const result = await runTestCase(testCase, 'exec-e2e-1', updateCallback);
    
    if (result.status === 'success') {
      console.log('\n✅ E2E Test Completed Successfully!');
      if (result.reportPath) {
        console.log(`Report generated at: ${result.reportPath}`);
      }
    } else {
      console.error('\n❌ E2E Test Failed:', result.errorMessage);
    }
  } catch (err) {
    console.error('\n❌ E2E Test Exception:', err);
  }
}

main();
