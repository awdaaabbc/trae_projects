import type { TestCase, Execution } from './types.js'

export type AgentInfo = {
  id: string
  platform: 'ios' | 'android'
  deviceName: string
  status: 'idle' | 'busy'
}

export type ServerToAgentMessage =
  | { type: 'EXECUTE_TASK'; payload: { executionId: string; testCase: TestCase } }
  | { type: 'CANCEL_TASK'; payload: { executionId: string } }

export type AgentToServerMessage =
  | { type: 'REGISTER'; payload: AgentInfo }
  | { type: 'UPDATE_EXECUTION'; payload: { executionId: string; patch: Partial<Execution> } }
  | { type: 'APPEND_LOG'; payload: { executionId: string; log: string } }
  | { type: 'TASK_COMPLETED'; payload: { executionId: string; result: { status: 'success' | 'failed'; reportPath?: string; errorMessage?: string }; reportContent?: string } }
