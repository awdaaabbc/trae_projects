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
  Checkbox,
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
  AppleOutlined,
  AndroidOutlined,
  GlobalOutlined,
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
  platform: 'web' | 'android' | 'ios'
  steps: TestStep[]
  status: 'idle' | 'running' | 'done' | 'error'
  lastRunAt?: number
  lastReportPath?: string
}
type Execution = {
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
    platform: 'web' as 'web' | 'android' | 'ios',
    stepsText: '',
  })
  
  const isValid = useMemo(() => {
    return creating.name.trim() && creating.stepsText.trim()
  }, [creating.name, creating.stepsText])
  
  // UI state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false)
  const [batchTab, setBatchTab] = useState<'select' | 'status'>('select')
  const [batchSearch, setBatchSearch] = useState('')
  const [batchPlatform, setBatchPlatform] = useState<'all' | 'web' | 'android' | 'ios'>('all')
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null)
  const [logModal, setLogModal] = useState<{ open: boolean; exeId: string | null }>({
    open: false,
    exeId: null,
  })
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

  const filteredBatchCases = useMemo(() => {
    const kw = batchSearch.trim().toLowerCase()
    return cases.filter((c) => {
      if (batchPlatform !== 'all' && c.platform !== batchPlatform) return false
      if (!kw) return true
      const hay = `${c.name} ${c.description || ''}`.toLowerCase()
      return hay.includes(kw)
    })
  }, [cases, batchSearch, batchPlatform])

  const currentBatchExecutions = useMemo(() => {
    if (!currentBatchId) return []
    return executions
      .filter((e) => e.batchId === currentBatchId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [executions, currentBatchId])

  const logExecution = useMemo(() => {
    if (!logModal.exeId) return null
    return executions.find((e) => e.id === logModal.exeId) || null
  }, [executions, logModal.exeId])

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

  async function batchExecute(caseIds: string[]) {
    setBatchSubmitting(true)
    try {
      const res = await api<{ batchId: string; executions: Execution[] }>('/api/batch-execute', {
        method: 'POST',
        body: JSON.stringify({ caseIds }),
      })
      setCurrentBatchId(res.data.batchId)
      setBatchTab('status')
      setExecutions((prev) => {
        const byId = new Map(prev.map((e) => [e.id, e]))
        for (const exe of res.data.executions) byId.set(exe.id, exe)
        return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt)
      })
      messageApi.success(`批量任务已提交（${caseIds.length}条）`)
    } catch (e) {
      messageApi.error('批量执行失败: ' + (e instanceof Error ? e.message : '未知错误'))
    } finally {
      setBatchSubmitting(false)
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

  async function resetStatus() {
    try {
      const res = await api<{ count: number }>('/api/admin/reset-status', { method: 'POST' })
      if (res.data.count > 0) {
        messageApi.success(`状态已重置，修复了 ${res.data.count} 个异常任务`)
      } else {
        messageApi.info('状态正常，无需修复')
      }
      refreshData()
    } catch (e) {
      messageApi.error('重置失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  async function stopAllExecutions() {
    try {
      const res = await api<{ count: number }>('/api/admin/stop-all', { method: 'POST' })
      if (res.data.count > 0) {
        messageApi.success(`已停止 ${res.data.count} 个正在运行的任务`)
      } else {
        messageApi.info('当前没有正在运行的任务')
      }
      refreshData()
    } catch (e) {
      messageApi.error('一键停止失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  // UI Handlers
  const handleCreateClick = () => {
    setSelectedCase(null)
    setCreating({ id: '', name: '', description: '', platform: 'web', stepsText: '' })
    setIsModalOpen(true)
  }

  const handleBatchClick = () => {
    setIsBatchModalOpen(true)
    setBatchTab('select')
    setBatchSearch('')
    setBatchPlatform('all')
    setBatchSelected(new Set())
    setCurrentBatchId(null)
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <Popconfirm
              title="确定要停止所有任务吗？"
              description="这将强制终止所有正在运行和排队中的任务。"
              onConfirm={stopAllExecutions}
              okText="停止"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button danger icon={<StopOutlined />} title="一键停止所有任务" />
            </Popconfirm>
            <Button icon={<SyncOutlined />} onClick={resetStatus} title="强制重置状态" />
            <Button icon={<PlayCircleOutlined />} onClick={handleBatchClick}>批量执行</Button>
            <Button type="primary" shape="circle" icon={<PlusOutlined />} onClick={handleCreateClick} />
          </div>
        </div>
        <div style={{ height: 'calc(100vh - 65px)', overflowY: 'auto' }}>
          <Menu
            mode="inline"
            selectedKeys={selectedCase ? [selectedCase] : []}
            items={cases.map(c => ({
              key: c.id,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                    {c.platform === 'android' ? <AndroidOutlined style={{ marginRight: 4, color: '#3ddc84' }} /> : 
                     c.platform === 'ios' ? <AppleOutlined style={{ marginRight: 4, color: '#000' }} /> :
                     <GlobalOutlined style={{ marginRight: 4, color: '#1890ff' }} />}
                    {c.name}
                  </span>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Title level={2} style={{ margin: 0 }}>{selected.name}</Title>
                  <Text type="secondary">{selected.description || '暂无描述'}</Text>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {getStatusTag(selected.status)}
                      <Text type="secondary"><ClockCircleOutlined /> 上次运行: {formatTime(selected.lastRunAt)}</Text>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
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
                </div>
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
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <Badge count={index + 1} style={{ backgroundColor: '#1890ff' }} />
                                  {item.type === 'query' && <Tag color="blue">查询</Tag>}
                                  {item.type === 'assert' && <Tag color="orange">断言</Tag>}
                                  <Text>{item.action}</Text>
                                </div>
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
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <span>执行ID: {item.id}</span>
                                  {item.fileName && <Tag color="default" style={{ fontSize: '12px' }}>{item.fileName}</Tag>}
                                </div>
                              }
                              description={
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <Text type="secondary">{formatTime(item.updatedAt)}</Text>
                                  {item.status === 'running' && <Progress percent={item.progress} size="small" style={{ width: 140 }} />}
                                  {item.errorMessage && <Text type="danger">{item.errorMessage}</Text>}
                                </div>
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
            </div>
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
        okButtonProps={{ disabled: !isValid }}
      >
        <Form layout="vertical">
          <Form.Item label="用例名称" required>
            <Input
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              placeholder="请输入测试用例名称"
              status={!creating.name.trim() ? 'error' : ''}
            />
          </Form.Item>
          <Form.Item label="用例描述">
            <TextArea
              value={creating.description}
              onChange={(e) => setCreating({ ...creating, description: e.target.value })}
              placeholder="简要描述测试场景"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>
          <Form.Item label="平台类型" required>
            <Select
              value={creating.platform}
              onChange={(val) => setCreating({ ...creating, platform: val })}
              options={[
                { label: 'Web', value: 'web' },
                { label: 'Android', value: 'android' },
                { label: 'iOS', value: 'ios' },
              ]}
            />
          </Form.Item>
          <Form.Item label="测试步骤（每行一步）" required tooltip="支持普通指令、'查询: xxx'、'断言: xxx'">
            <TextArea
              value={creating.stepsText}
              onChange={(e) => setCreating({ ...creating, stepsText: e.target.value })}
              placeholder={`示例：
打开 https://www.baidu.com
输入框输入 "MidScene"
点击搜索按钮
断言: 搜索结果包含官网链接`}
              autoSize={{ minRows: 6, maxRows: 12 }}
              status={!creating.stepsText.trim() ? 'error' : ''}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量执行"
        open={isBatchModalOpen}
        onCancel={() => setIsBatchModalOpen(false)}
        width={860}
        footer={[
          <Button key="close" onClick={() => setIsBatchModalOpen(false)}>
            关闭
          </Button>,
          <Button
            key="run"
            type="primary"
            loading={batchSubmitting}
            disabled={batchSelected.size === 0 || batchSubmitting}
            onClick={() => {
              Modal.confirm({
                title: '确认批量执行',
                content: `将执行 ${batchSelected.size} 条用例，是否继续？`,
                okText: '执行',
                cancelText: '取消',
                onOk: () => batchExecute(Array.from(batchSelected)),
              })
            }}
          >
            开始执行
          </Button>,
        ]}
      >
        <Tabs
          activeKey={batchTab}
          onChange={(k) => setBatchTab(k as 'select' | 'status')}
          items={[
            {
              key: 'select',
              label: '用例选择',
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    <Input
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                      placeholder="按名称/描述过滤"
                      style={{ width: 260 }}
                    />
                    <Select
                      value={batchPlatform}
                      onChange={(v) => setBatchPlatform(v)}
                      options={[
                        { value: 'all', label: '全部平台' },
                        { value: 'web', label: 'Web' },
                        { value: 'android', label: 'Android' },
                        { value: 'ios', label: 'iOS' },
                      ]}
                      style={{ width: 140 }}
                    />
                    <Button
                      onClick={() => {
                        setBatchSelected((prev) => {
                          const next = new Set(prev)
                          for (const c of filteredBatchCases) {
                            if (c.status !== 'running') next.add(c.id)
                          }
                          return next
                        })
                      }}
                    >
                      全选(过滤结果)
                    </Button>
                    <Button onClick={() => setBatchSelected(new Set())}>清空选择</Button>
                    <Tag color="blue">已选 {batchSelected.size} 条</Tag>
                  </div>

                  <List
                    dataSource={filteredBatchCases}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    renderItem={(item) => {
                      const checked = batchSelected.has(item.id)
                      const disabled = item.status === 'running'
                      return (
                        <List.Item
                          actions={[
                            <Tag key="platform" color={item.platform === 'android' ? 'purple' : item.platform === 'ios' ? 'black' : 'geekblue'}>
                              {item.platform.toUpperCase()}
                            </Tag>,
                            getStatusTag(item.status),
                          ]}
                        >
                          <Space style={{ width: '100%' }}>
                            <Checkbox
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => {
                                const nextChecked = e.target.checked
                                setBatchSelected((prev) => {
                                  const next = new Set(prev)
                                  if (nextChecked) next.add(item.id)
                                  else next.delete(item.id)
                                  return next
                                })
                              }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <Text strong style={{ maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {item.name}
                              </Text>
                              <Text type="secondary" style={{ maxWidth: 560, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {item.description || '-'}
                              </Text>
                            </div>
                          </Space>
                        </List.Item>
                      )
                    }}
                    locale={{ emptyText: <Empty description="暂无可选用例" /> }}
                  />
                </div>
              ),
            },
            {
              key: 'status',
              label: '执行状态',
              children: currentBatchId ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    <Tag color="blue">Batch ID: {currentBatchId}</Tag>
                    <Button
                      onClick={() => {
                        setCurrentBatchId(null)
                        setBatchTab('select')
                      }}
                    >
                      新建批量
                    </Button>
                  </div>
                  <List
                    dataSource={currentBatchExecutions}
                    renderItem={(item) => {
                      const tc = cases.find((c) => c.id === item.caseId)
                      const canStop = item.status === 'running' || item.status === 'queued'
                      return (
                        <List.Item
                          actions={[
                            canStop ? (
                              <Button key="stop" danger icon={<StopOutlined />} onClick={() => stopExecution(item.id)}>
                                停止
                              </Button>
                            ) : null,
                            <Button
                              key="logs"
                              onClick={() => setLogModal({ open: true, exeId: item.id })}
                              disabled={!item.logs || item.logs.length === 0}
                            >
                              查看日志
                            </Button>,
                            item.reportPath ? (
                              <Button
                                key="report"
                                type="link"
                                onClick={() => window.open(getReportUrl(item.reportPath!), '_blank')}
                              >
                                查看报告
                              </Button>
                            ) : null,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={getStatusTag(item.status)}
                            title={
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <span style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {tc?.name || item.caseId}
                                </span>
                                <Tag color="default" style={{ fontSize: '12px' }}>
                                  {item.id}
                                </Tag>
                              </div>
                            }
                            description={
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <Text type="secondary">{formatTime(item.updatedAt)}</Text>
                                {(item.status === 'running' || item.status === 'queued') && (
                                  <Progress percent={item.progress} size="small" style={{ width: 220 }} />
                                )}
                                {item.errorMessage && <Text type="danger">{item.errorMessage}</Text>}
                              </div>
                            }
                          />
                        </List.Item>
                      )
                    }}
                    locale={{ emptyText: <Empty description="暂无批量执行记录" /> }}
                  />
                </div>
              ) : (
                <Empty description="暂无批量执行任务" />
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        title="执行日志"
        open={logModal.open}
        onCancel={() => setLogModal({ open: false, exeId: null })}
        footer={[
          <Button key="close" onClick={() => setLogModal({ open: false, exeId: null })}>
            关闭
          </Button>,
        ]}
        width={900}
      >
        <Card variant="borderless" style={{ background: '#0b1020' }}>
          <pre style={{ margin: 0, color: '#e6edf3', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {(logExecution?.logs || []).join('\n') || '暂无日志'}
          </pre>
        </Card>
      </Modal>
    </Layout>
  )
}

export default App
