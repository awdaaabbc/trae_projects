export type TestStep = {
    id: string
    type?: 'action' | 'query' | 'assert' | 'input'
    action: string
  }
export type TestCase = {
  id: string
  name: string
  description?: string
  platform: 'web' | 'android' | 'ios'
  context?: string
  steps: TestStep[]
  status: 'idle' | 'running' | 'done' | 'error'
  lastRunAt?: number
  lastReportPath?: string
}
export type Execution = {
  id: string
  caseId: string
  batchId?: string
  status: 'queued' | 'running' | 'success' | 'failed'
  progress: number
  createdAt: number
  updatedAt: number
  reportPath?: string
  errorMessage?: string
  fileName?: string
  logs?: string[]
  agentName?: string
}
