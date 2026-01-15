
import WebSocket from 'ws';
import fetch from 'node-fetch';

const PORT = 3002;
const WS_URL = `ws://localhost:${PORT}/ws`;
const API_URL = `http://localhost:${PORT}/api/run-raw`;

const AGENT_ID = 'simulated-agent-verify';
const PLATFORM = 'android';

async function main() {
  console.log('Starting verification script...');

  // 1. Connect to WebSocket
  const ws = new WebSocket(WS_URL);

  const connectionPromise = new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      console.log('WebSocket connected');
      // 2. Register Agent
      ws.send(JSON.stringify({
        type: 'REGISTER',
        payload: {
          id: AGENT_ID,
          platform: PLATFORM,
          deviceName: 'Simulated Verification Device',
          status: 'idle'
        }
      }));
      resolve();
    });
    ws.on('error', reject);
  });

  await connectionPromise;

  // Wait a bit for registration to process
  await new Promise(r => setTimeout(r, 1000));

  // 3. Listen for Task
  const taskPromise = new Promise((resolve, reject) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log('Received message type:', msg.type);

      if (msg.type === 'EXECUTE_TASK') {
        const { executionId, testCase } = msg.payload;
        console.log('Received execution task:', executionId);
        console.log('Steps:', JSON.stringify(testCase.steps, null, 2));

        // Verify steps
        const steps = testCase.steps;
        const queryStep = steps.find((s: any) => s.action.includes('current time'));
        const assertStep = steps.find((s: any) => s.action.includes('time is correct'));

        if (!queryStep || queryStep.type !== 'query') {
          reject(new Error(`Query step parsing failed. Got: ${JSON.stringify(queryStep)}`));
          return;
        }
        if (!assertStep || assertStep.type !== 'assert') {
          reject(new Error(`Assert step parsing failed. Got: ${JSON.stringify(assertStep)}`));
          return;
        }

        console.log('Step parsing verified successfully!');

        // Simulate completion
        ws.send(JSON.stringify({
          type: 'TASK_COMPLETED',
          payload: {
            executionId,
            result: {
              status: 'success',
              reportPath: 'dummy-report.html'
            }
          }
        }));
        
        resolve(true);
      }
    });
  });

  // 4. Send API Request
  console.log('Sending API request...');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: PLATFORM,
      targetAgentId: AGENT_ID, // Target our specific agent to avoid interference
      steps: [
        { action: 'open settings' },
        { action: '查询：current time' },
        { action: '断言：time is correct' }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  console.log('API response:', JSON.stringify(result, null, 2));

  // Wait for task verification
  await taskPromise;
  
  console.log('Verification completed successfully.');
  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
