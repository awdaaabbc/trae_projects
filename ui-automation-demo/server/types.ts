export interface TestCase {
  id: string;
  name: string;
  description: string;
  platform: 'web' | 'android' | 'ios';
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
  batchId?: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  progress: number;
  createdAt: number;
  updatedAt: number;
  reportPath?: string;
  errorMessage?: string;
  fileName?: string;
  logs?: string[];
}
