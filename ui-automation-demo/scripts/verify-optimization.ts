import { Storage } from '../server/storage.js';
import { initDB } from '../server/db.js';

initDB();

console.log('--- Verifying Optimization ---');

// 0. Create Test Case
const caseId = 'test-case-opt';
Storage.saveCase({
  id: caseId,
  name: 'Opt Test',
  description: 'desc',
  platform: 'web',
  steps: [],
  status: 'idle'
});

// 1. Create a dummy execution with logs
const id = Storage.generateExecutionId('OptimizationTest');
const exe = {
  id,
  caseId: caseId,
  status: 'success' as const,
  progress: 100,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  logs: ['Log line 1', 'Log line 2']
};
Storage.saveExecution(exe);

// 2. Test listExecutions (should NOT have logs)
const list = Storage.listExecutions();
const foundInList = list.find(e => e.id === id);

if (foundInList) {
  if (foundInList.logs === undefined) {
    console.log('✓ listExecutions: Logs are excluded (Correct)');
  } else {
    console.error('✗ listExecutions: Logs are present (Incorrect)');
  }
} else {
  console.error('✗ Execution not found in list');
}

// 3. Test getExecution (should HAVE logs)
const details = Storage.getExecution(id);
if (details) {
  if (details.logs && details.logs.length === 2) {
    console.log('✓ getExecution: Logs are present (Correct)');
  } else {
    console.error('✗ getExecution: Logs are missing or incorrect');
  }
} else {
  console.error('✗ Execution details not found');
}

// Cleanup
// Storage.deleteCase('test-case-opt'); // Need case to delete? 
// Just leave it or manually delete via DB if needed.
