export interface TestCase {
  id: string;
  name: string;
  description: string;
  platform: 'web' | 'android' | 'ios';
  context?: string;
  steps: Array<{
    id: string;
    action: string;
    type?: 'action' | 'query' | 'assert' | 'input';
  }>;
  status: 'idle' | 'running' | 'done' | 'error';
  lastRunAt?: number;
  lastReportPath?: string;
}

export interface Execution {
  id: string;
  caseId: string;
  batchId?: string;
  targetAgentId?: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  progress: number;
  createdAt: number;
  updatedAt: number;
  reportPath?: string;
  errorMessage?: string;
  fileName?: string;
  logs?: string[];
  agentId?: string;
  agentName?: string;
}
