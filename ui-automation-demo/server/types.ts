export interface TestCase {
  id: string;
  name: string;
  description: string;
  steps: Array<{
    id: string;
    action: string;
    type?: 'action' | 'query' | 'assert';
  }>;
  status: 'idle' | 'running' | 'done' | 'error';
  lastRunAt?: number;
  lastReportPath?: string;
}

export interface Execution {
  id: string;
  caseId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  progress: number;
  createdAt: number;
  updatedAt: number;
  reportPath?: string;
  errorMessage?: string;
}
