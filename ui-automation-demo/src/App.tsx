import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Layout,
  Menu,
  Button,
  Typography,
  Card,
  Space,
  Tag,
  Tabs,
  List,
  Modal,
  Form,
  Input,
  Select,
  message,
  Progress,
  Empty,
  Badge,
  Popconfirm,
} from 'antd'
import {
  PlusOutlined,
  PlayCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  RocketOutlined,
  StopOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import './App.css'

const { Sider, Content } = Layout
const { Title, Text } = Typography
const { TextArea } = Input

type TestStep = {
  id: string
  type?: 'action' | 'query' | 'assert'
  action: string
}
type TestCase = {
  id: string
  name: string
  description?: string
  platform: 'web' | 'android'
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
  fileName?: string
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
  
  // Form state
  const [creating, setCreating] = useState({
    id: '',
    name: '',
    description: '',
    platform: 'web' as 'web' | 'android',
    stepsText: '',
  })
  
  // UI state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()
  const wsRef = useRef<WebSocket | null>(null)

  // Initial Data Load & WebSocket
  async function refreshData() {
    try {
      const [cs, ex] = await Promise.all([
        api<TestCase[]>('/api/testcases'),
        api<Execution[]>('/api/executions'),
      ])
      setCases(cs.data)
      setExecutions(ex.data)
    } catch (e) {
      console.error('Failed to refresh data', e)
    }
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

  // Derived state
  const selected = useMemo(
    () => cases.find((c) => c.id === selectedCase) || null,
    [cases, selectedCase],
  )

  // Sync selection to form state
  useEffect(() => {
    if (selected) {
      // Only sync if we switched to a different case to avoid overwriting user edits during refresh
      // Note: We only overwrite if we are NOT currently creating a new one (which implies selectedCase is null)
      if (creating.id !== selected.id) {
        setCreating({
          id: selected.id,
          name: selected.name,
          description: selected.description || '',
          platform: selected.platform || 'web',
          stepsText: selected.steps.map((s) => {
            if (s.type === 'query') return `查询: ${s.action}`
            if (s.type === 'assert') return `断言: ${s.action}`
            return s.action
          }).join('\n'),
        })
      }
    } else {
      // If no selection, reset form only if it has an ID (meaning it was editing something)
      // If it has no ID, user might be typing a new case, so don't clear blindly unless we explicitly want to
      if (creating.id) {
        setCreating({ id: '', name: '', description: '', platform: 'web', stepsText: '' })
      }
    }
  }, [selected, creating.id])

  // Actions
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
        // Update
        await api<TestCase>(`/api/testcases/${creating.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: creating.name,
            description: creating.description,
            platform: creating.platform,
            steps,
          }),
        })
        setCases((prev) =>
          prev.map((c) =>
            c.id === creating.id
              ? {
                  ...c,
                  name: creating.name,
                  description: creating.description,
                  platform: creating.platform,
                  steps,
                }
              : c,
          ),
        )
        messageApi.success('修改保存成功')
      } else {
        // Create
        const res = await api<TestCase>('/api/testcases', {
          method: 'POST',
          body: JSON.stringify({
            name: creating.name,
            description: creating.description,
            platform: creating.platform,
            steps,
          }),
        })
        setCases((prev) => [res.data, ...prev])
        setSelectedCase(res.data.id)
        messageApi.success('创建成功')
      }
      setIsModalOpen(false)
    } catch (err: unknown) {
      console.error(err)
      messageApi.error('操作失败: ' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  async function executeCase(id: string) {
    try {
      await api<Execution>(`/api/execute/${id}`, { method: 'POST' })
      messageApi.info('任务已开始执行')
      refreshData()
    } catch (e) {
      messageApi.error('执行失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  async function stopExecution(id: string) {
    try {
      await api(`/api/stop-execution/${id}`, { method: 'POST' })
      messageApi.info('已发送停止指令')
    } catch (e) {
      messageApi.error('停止失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  async function deleteCase(id: string) {
    try {
      await api(`/api/testcases/${id}`, { method: 'DELETE' })
      messageApi.success('测试用例已删除')
      setSelectedCase(null)
      refreshData()
    } catch (e) {
      messageApi.error('删除失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  // UI Handlers
  const handleCreateClick = () => {
    setSelectedCase(null)
    setCreating({ id: '', name: '', description: '', platform: 'web', stepsText: '' })
    setIsModalOpen(true)
  }

  const handleEditClick = () => {
    // State is already synced via useEffect
    setIsModalOpen(true)
  }

  // Render Helpers
  const getReportUrl = (path: string) => {
    // Ensure we only use the filename, stripping any directory path
    const filename = path.split(/[/\\]/).pop() || path
    return `/reports/${filename}`
  }

  const getStatusTag = (status: string) => {
    switch (status) {
      case 'done':
      case 'success':
        return <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
      case 'failed':
      case 'error':
        return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>
      case 'running':
        return <Tag icon={<SyncOutlined spin />} color="processing">执行中</Tag>
      case 'queued':
        return <Tag icon={<ClockCircleOutlined />} color="default">排队中</Tag>
      default:
        return <Tag color="default">{status}</Tag>
    }
  }

  return (
    <Layout style={{ height: '100vh' }}>
      {contextHolder}
      <Sider width={300} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Title level={4} style={{ margin: 0, fontSize: '18px' }}><RocketOutlined /> UI 自动化</Title>
          <Button type="primary" shape="circle" icon={<PlusOutlined />} onClick={handleCreateClick} />
        </div>
        <div style={{ height: 'calc(100vh - 65px)', overflowY: 'auto' }}>
          <Menu
            mode="inline"
            selectedKeys={selectedCase ? [selectedCase] : []}
            items={cases.map(c => ({
              key: c.id,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{c.name}</span>
                  {getStatusTag(c.status)}
                </div>
              ),
              onClick: () => setSelectedCase(c.id)
            }))}
            style={{ border: 'none' }}
          />
        </div>
      </Sider>
      
      <Layout>
        <Content style={{ padding: '24px', overflowY: 'auto', background: '#fff' }}>
          {selected ? (
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Title level={2} style={{ margin: 0 }}>{selected.name}</Title>
                  <Text type="secondary">{selected.description || '暂无描述'}</Text>
                  <div style={{ marginTop: 8 }}>
                    <Space>
                      {getStatusTag(selected.status)}
                      <Text type="secondary"><ClockCircleOutlined /> 上次运行: {formatTime(selected.lastRunAt)}</Text>
                    </Space>
                  </div>
                </div>
                <Space>
                  <Button icon={<EditOutlined />} onClick={handleEditClick} disabled={selected.status === 'running'}>编辑用例</Button>
                  <Popconfirm
                    title="删除测试用例"
                    description="确定要删除这个测试用例吗？此操作不可恢复。"
                    onConfirm={() => deleteCase(selected.id)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    disabled={selected.status === 'running'}
                  >
                    <Button danger icon={<DeleteOutlined />} disabled={selected.status === 'running'}>删除</Button>
                  </Popconfirm>
                  {selected.status === 'running' ? (
                    <Button 
                      danger 
                      icon={<StopOutlined />} 
                      onClick={() => {
                        const runningExe = executions.find(e => e.caseId === selected.id && (e.status === 'running' || e.status === 'queued'))
                        if (runningExe) {
                          stopExecution(runningExe.id)
                        } else {
                          messageApi.error('未找到正在运行的执行记录')
                        }
                      }}
                    >
                      停止执行
                    </Button>
                  ) : (
                    <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => executeCase(selected.id)}>
                      执行测试
                    </Button>
                  )}
                </Space>
              </div>

              <Tabs
                items={[
                  {
                    key: 'steps',
                    label: <span><FileTextOutlined /> 测试步骤</span>,
                    children: (
                      <Card variant="borderless" style={{ background: '#f9f9f9' }}>
                         <List
                            dataSource={selected.steps}
                            renderItem={(item, index) => (
                              <List.Item>
                                <Space>
                                  <Badge count={index + 1} style={{ backgroundColor: '#1890ff' }} />
                                  {item.type === 'query' && <Tag color="blue">查询</Tag>}
                                  {item.type === 'assert' && <Tag color="orange">断言</Tag>}
                                  <Text>{item.action}</Text>
                                </Space>
                              </List.Item>
                            )}
                          />
                      </Card>
                    )
                  },
                  {
                    key: 'history',
                    label: <span><HistoryOutlined /> 执行记录</span>,
                    children: (
                      <List
                        dataSource={executions.filter(e => e.caseId === selected.id)}
                        renderItem={item => (
                          <List.Item
                            actions={[
                              item.reportPath ? (
                                <Button type="link" onClick={() => window.open(getReportUrl(item.reportPath!), '_blank')}>
                                  查看报告
                                </Button>
                              ) : item.status === 'failed' ? (
                                <Text type="danger">生成失败</Text>
                              ) : (
                                <Text type="secondary">报告生成中</Text>
                              )
                            ]}
                          >
                            <List.Item.Meta
                              avatar={getStatusTag(item.status)}
                              title={
                                <Space>
                                  <span>执行ID: {item.id}</span>
                                  {item.fileName && <Tag color="default" style={{ fontSize: '12px' }}>{item.fileName}</Tag>}
                                </Space>
                              }
                              description={
                                <Space direction="vertical" size={0}>
                                  <Text type="secondary">{formatTime(item.updatedAt)}</Text>
                                  {item.status === 'running' && <Progress percent={item.progress} size="small" style={{ width: 140 }} />}
                                  {item.errorMessage && <Text type="danger">{item.errorMessage}</Text>}
                                </Space>
                              }
                            />
                          </List.Item>
                        )}
                        locale={{ emptyText: <Empty description="暂无执行记录" /> }}
                      />
                    )
                  }
                ]}
              />
            </Space>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="请在左侧选择一个测试用例，或创建新用例"
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateClick}>创建新用例</Button>
              </Empty>
            </div>
          )}
        </Content>
      </Layout>

      {/* Create/Edit Modal */}
      <Modal
        title={creating.id ? "编辑测试用例" : "创建测试用例"}
        open={isModalOpen}
        onOk={createCase}
        onCancel={() => setIsModalOpen(false)}
        width={600}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="用例名称" required>
            <Input
              value={creating.name}
              onChange={(e) => setCreating(s => ({ ...s, name: e.target.value }))}
              placeholder="请输入用例名称"
            />
          </Form.Item>
          <Form.Item label="用例描述">
            <TextArea
              value={creating.description}
              onChange={(e) => setCreating(s => ({ ...s, description: e.target.value }))}
              placeholder="请输入用例描述"
              rows={2}
            />
          </Form.Item>
          <Form.Item label="平台选择" required>
            <Select
              value={creating.platform}
              onChange={(platform) => setCreating((s) => ({ ...s, platform }))}
              options={[
                { value: 'web', label: 'Web' },
                { value: 'android', label: 'Android' },
              ]}
            />
          </Form.Item>
          <Form.Item label="测试步骤" help="每行一条。支持前缀 '查询:' 或 '断言:'">
            <TextArea
              value={creating.stepsText}
              onChange={(e) => setCreating(s => ({ ...s, stepsText: e.target.value }))}
              placeholder={`打开 https://www.saucedemo.com/\n在 Username 输入 standard_user\n断言: 登录按钮存在\n查询: 页面上的价格列表`}
              rows={8}
              style={{ fontFamily: 'monospace' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  )
}

export default App
