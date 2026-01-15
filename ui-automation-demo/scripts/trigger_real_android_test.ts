
import fetch from 'node-fetch';

const API_URL = 'http://localhost:3002/api/run-raw';

async function main() {
  console.log('Triggering Real Android Test...');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'android',
      // No targetAgentId -> auto-select
      steps: [
        { action: '打开设置' },
        { action: '查询：当前的电量是多少' }, // Query
        { action: '断言：设置页面已打开' }   // Assert
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  console.log('Test triggered successfully!');
  console.log('Execution ID:', result.data.executionId);
  console.log('Monitor the Agent terminal for progress...');
}

main().catch(console.error);
