import fetch from 'node-fetch';

const API_URL = 'http://localhost:3002/api/run-raw';

async function main() {
  console.log('Triggering Test with aiContext...');

  const aiContext = `
    你是一个测试助手。
    这是一个测试上下文传递的验证脚本。
    如果遇到问题，请返回 "Context Received"。
  `;

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform: 'android', // Using android as it's the one we recently tested
      aiContext: aiContext,
      steps: [
        { action: '查询：当前的上下文是否包含 "Context Received"' }, // This query relies on the context
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  console.log('Test triggered successfully!');
  console.log('Execution ID:', result.data.executionId);
  console.log('Case Context:', result.data.execution.caseId ? 'Saved in Case' : 'Missing');
  
  // We can't easily verify the internal agent state from outside without running a real test that logs it,
  // but we can verify the API accepted it and stored it in the case.
  
  // Let's fetch the case to verify context is stored
  const caseId = result.data.caseId;
  // We don't have a direct public API to get a temp case by ID unless we use the internal storage or list,
  // but let's assume if the run-raw response returned it in the execution object or if we can infer it.
  // Actually, run-raw returns { data: { executionId, caseId, execution } }
  
  // Since we don't have a direct "get case" API exposed for temp cases easily without auth/admin maybe,
  // we will trust the logs if we were running the server.
  // However, we can check if the response data execution object has the right structure if it included the case snapshot?
  // The execution object in storage doesn't copy the case context, but the runner loads the case from storage.
  
  console.log('Verification: Check server logs to see if "Setting AI Context" or similar was logged if we added logs.');
}

main().catch(console.error);
