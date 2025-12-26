import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type TestStep = {
  id: string
  type?: 'action' | 'query' | 'assert'
  action: string
}
type TestCase = {
  id: string
  name: string
  description?: string
  steps: TestStep[]
  status: 'idle' | 'running' | 'done' | 'error'
  lastRunAt?: number
  lastReportPath?: string
}
type Execution = {
  id: string
  caseId: string
  status: 'queued' | 'running' | 'success' | 'failed'
  progress: number
  createdAt: number
  updatedAt: number
  reportPath?: string
  errorMessage?: string
}

async function api<T>(url: string, init?: RequestInit) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    if (import.meta.env.DEV) {
      console.debug('[api]', init?.method || 'GET', url)
    }
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...init,
    })

    const text = await res.text()
    let json: unknown
    try {
      json = text ? (JSON.parse(text) as unknown) : null
    } catch {
      throw new Error(
        `接口返回非 JSON（HTTP ${res.status}）。响应片段：${text.slice(0, 200) || '(空)'}`
      )
    }

    if (!res.ok) {
      const msg =
        typeof json === 'object' &&
        json &&
        'error' in json &&
        typeof (json as { error?: unknown }).error === 'string'
          ? (json as { error: string }).error
          : `HTTP ${res.status}`
      throw new Error(msg)
    }

    return json as { data: T }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试')
    }
    throw err instanceof Error ? err : new Error('网络异常，请检查服务是否启动')
  } finally {
    clearTimeout(timeoutId)
  }
}

function formatTime(ts?: number) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
}

function App() {
  const [cases, setCases] = useState<TestCase[]>([])
  const [executions, setExecutions] = useState<Execution[]>([])
  const [selectedCase, setSelectedCase] = useState<string | null>(null)
  const [creating, setCreating] = useState({
    id: '',
    name: '',
    description: '',
    stepsText: '',
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [message])

  async function refreshData() {
    const [cs, ex] = await Promise.all([
      api<TestCase[]>('/api/testcases'),
      api<Execution[]>('/api/executions'),
    ])
    setCases(cs.data)
    setExecutions(ex.data)
  }

  useEffect(() => {
    refreshData()
    const interval = setInterval(() => {
      refreshData()
    }, 5000)
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
    )
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type?: string; payload?: unknown }
      if (msg.type === 'execution') {
        const exe = msg.payload as Execution | undefined
        if (!exe) return
        setExecutions((prev) => {
          const idx = prev.findIndex((e) => e.id === exe.id)
          if (idx >= 0) {
            const next = prev.slice()
            next[idx] = exe
            return next
          }
          return [exe, ...prev]
        })
      } else if (msg.type === 'testcase') {
        const tc = msg.payload as TestCase | undefined
        if (!tc) return
        setCases((prev) => prev.map((c) => (c.id === tc.id ? tc : c)))
      }
    }
    wsRef.current = ws
    return () => {
      ws.close()
      wsRef.current = null
      clearInterval(interval)
    }
  }, [])

  const selected = useMemo(
    () => cases.find((c) => c.id === selectedCase) || null,
    [cases, selectedCase],
  )

  useEffect(() => {
    if (selected) {
      // Only sync if we switched to a different case to avoid overwriting user edits during refresh
      if (creating.id !== selected.id) {
        setCreating({
          id: selected.id,
          name: selected.name,
          description: selected.description || '',
          stepsText: selected.steps.map((s) => {
            if (s.type === 'query') return `查询: ${s.action}`
            if (s.type === 'assert') return `断言: ${s.action}`
            return s.action
          }).join('\n'),
        })
      }
    } else {
      if (creating.id) {
        setCreating({ id: '', name: '', description: '', stepsText: '' })
      }
    }
  }, [selected, creating.id])

  async function createCase() {
    try {
      const steps: TestStep[] = creating.stepsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s, i) => {
          let type: TestStep['type'] = 'action'
          let action = s

          if (s.startsWith('查询:') || s.startsWith('查询：')) {
            type = 'query'
            action = s.substring(3).trim()
          } else if (s.startsWith('断言:') || s.startsWith('断言：')) {
            type = 'assert'
            action = s.substring(3).trim()
          }

          return { id: `u${Date.now()}-${i}`, type, action }
        })

      if (creating.id) {
        // Update existing case
        await api<TestCase>(`/api/testcases/${creating.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: creating.name,
            description: creating.description,
            steps,
          }),
        })
        setCases((prev) =>
          prev.map((c) =>
            c.id === creating.id
              ? { ...c, name: creating.name, description: creating.description, steps }
              : c,
          ),
        )
        setMessage({ type: 'success', text: '修改保存成功' })
      } else {
        // Create new case
        const res = await api<TestCase>('/api/testcases', {
          method: 'POST',
          body: JSON.stringify({
            name: creating.name,
            description: creating.description,
            steps,
          }),
        })
        setCases((prev) => [res.data, ...prev])
        setSelectedCase(res.data.id)
        setMessage({ type: 'success', text: '创建成功' })
      }
    } catch (err: unknown) {
      console.error(err)
      setMessage({
        type: 'error',
        text: '操作失败: ' + (err instanceof Error ? err.message : '未知错误'),
      })
    }
  }

  async function executeCase(id: string) {
    await api<Execution>(`/api/execute/${id}`, { method: 'POST' })
    refreshData()
  }

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
      <div>
        <h2>测试用例管理</h2>
        <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          {message && (
            <div
              style={{
                marginBottom: 8,
                padding: '8px 12px',
                borderRadius: 4,
                background: message.type === 'success' ? '#f6ffed' : '#fff2f0',
                border: `1px solid ${message.type === 'success' ? '#b7eb8f' : '#ffccc7'}`,
                color: message.type === 'success' ? '#52c41a' : '#ff4d4f',
              }}
            >
              {message.text}
            </div>
          )}
          <input
            placeholder="用例名称"
            value={creating.name}
            onChange={(e) => setCreating((s) => ({ ...s, name: e.target.value }))}
            style={{ width: '100%', marginBottom: 8, padding: 8 }}
          />
          <textarea
            placeholder="用例描述"
            value={creating.description}
            onChange={(e) => setCreating((s) => ({ ...s, description: e.target.value }))}
            style={{ width: '100%', marginBottom: 8, padding: 8 }}
            rows={2}
          />
          <textarea
            placeholder="测试步骤，每行一条。支持前缀 '查询:' 或 '断言:' 来指定模式。\n例如：\n打开 https://www.saucedemo.com/\n在 Username 输入 standard_user\n断言: 登录按钮存在\n查询: 页面上的价格列表"
            value={creating.stepsText}
            onChange={(e) => setCreating((s) => ({ ...s, stepsText: e.target.value }))}
            style={{ width: '100%', marginBottom: 8, padding: 8 }}
            rows={6}
          />
          <button onClick={createCase} style={{ padding: '8px 12px' }}>
            {creating.id ? '保存修改' : '创建测试用例'}
          </button>
          {creating.id && (
            <button
              onClick={() => {
                setSelectedCase(null)
                setCreating({ id: '', name: '', description: '', stepsText: '' })
              }}
              style={{ padding: '8px 12px', marginLeft: 8, background: '#f5f5f5', border: '1px solid #ddd' }}
            >
              取消编辑
            </button>
          )}
        </div>

        <h3>用例列表</h3>
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
          {cases.map((c) => (
            <div
              key={c.id}
              onClick={() => setSelectedCase(c.id)}
              style={{
                padding: 8,
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                background: selectedCase === c.id ? '#f6ffed' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: '#666' }}>
                状态：{c.status}，最后执行：{formatTime(c.lastRunAt)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2>执行控制</h2>
        {selected ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>{selected.name}</strong>
              <div style={{ fontSize: 12, color: '#666' }}>{selected.description}</div>
            </div>
            <button onClick={() => executeCase(selected.id)} style={{ padding: '8px 12px' }}>
              执行测试用例
            </button>
          </div>
        ) : (
          <div style={{ color: '#999', marginBottom: 12 }}>请选择左侧用例</div>
        )}

        <div style={{ marginBottom: 12 }}>
          <h3>执行状态</h3>
          <div>
            {executions.slice(0, 5).map((e) => (
              <div key={e.id} style={{ marginBottom: 6 }}>
                <span>#{e.id} - {e.status}</span>
                <div style={{ height: 6, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${e.progress}%`, height: 6, background: e.status === 'failed' ? '#ff4d4f' : '#52c41a' }} />
                </div>
                {e.errorMessage && <div style={{ color: '#ff4d4f', fontSize: 12 }}>{e.errorMessage}</div>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>{selected ? '历史报告' : '最近报告'}</h2>
          <div>
            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #eee', borderRadius: 8 }}>
              {(selected ? executions.filter((e) => e.caseId === selected.id) : executions).map(
                (e) => (
                  <div key={e.id} style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {formatTime(e.updatedAt)} · {e.status}
                    </div>
                    {e.reportPath ? (
                      <button
                        style={{ marginTop: 6, padding: '4px 8px' }}
                        onClick={() => window.open(`/reports/${e.reportPath}`, '_blank')}
                      >
                        查看报告
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: '#999' }}>报告生成中</span>
                    )}
                  </div>
                ),
              )}
              {selected && executions.filter((e) => e.caseId === selected.id).length === 0 && (
                <div style={{ padding: 16, color: '#999', textAlign: 'center' }}>暂无历史报告</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
