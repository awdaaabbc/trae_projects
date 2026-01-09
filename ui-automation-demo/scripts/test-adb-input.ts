
import { runTestCase } from '../server/runner.android';
import { TestCase } from '../server/types';
import dotenv from 'dotenv';

dotenv.config();

const testCase: TestCase = {
  id: 'test-adb-input',
  name: 'ADB Input Test',
  description: 'Test ADBKeyBoard input',
  platform: 'android',
  status: 'idle',
  steps: [
    {
      id: '1',
      action: '打开设置',
      type: 'action'
    },
    {
      id: '2',
      action: '点击搜索设置',
      type: 'action'
    },
    {
      id: '3',
      action: '输入：[ADB]你好ADBKeyBoard',
      type: 'input'
    },
    {
        id: '4',
        action: '断言：搜索框内容包含"你好"',
        type: 'assert'
    }
  ]
};

async function run() {
  console.log('Starting ADB Input Test...');
  const result = await runTestCase(testCase, 'test-adb-run-' + Date.now(), (patch) => {
    console.log('Progress:', patch.progress);
  });
  console.log('Result:', result);
}

run();
