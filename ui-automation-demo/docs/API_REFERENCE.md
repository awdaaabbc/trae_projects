# 自动化测试执行接口文档

本文档描述了如何通过 RESTful API 调用自动化测试服务执行测试用例。

## 1. 概述

服务提供了一组 HTTP 接口用于触发测试执行和查询执行状态。
- **基础 URL**: `http://<server-ip>:3002` (默认端口 3002)
- **数据格式**: JSON

## 2. 接口列表

### 2.1 执行单个测试用例

触发指定 ID 的测试用例执行。

- **接口地址**: `/api/execute/:id`
- **请求方式**: `POST`
- **URL 参数**:
  - `id` (string, 必填): 测试用例的唯一标识符 (Case ID)

- **请求体 (JSON)**:
  ```json
  {
    "targetAgentId": "optional-agent-id"
  }
  ```
  - `targetAgentId` (string, 选填): 指定执行该用例的 Agent ID。如果不填，系统将自动分配空闲的 Agent。

- **响应示例**:
  ```json
  {
    "data": {
      "id": "exe-1766730070485-xxxx",
      "caseId": "case-123",
      "status": "queued",
      "progress": 0,
      "createdAt": 1766730070485,
      "updatedAt": 1766730070485,
      "fileName": "test_case_file.json",
      "targetAgentId": "optional-agent-id"
    }
  }
  ```

### 2.2 执行动态测试用例 (Raw Script)

直接传入测试脚本进行执行，无需预先创建测试用例 ID。

- **接口地址**: `/api/run-raw`
- **请求方式**: `POST`
- **请求体 (JSON)**:
  ```json
  {
    "platform": "web", // 必填: web, android, ios
    "steps": [         // 必填: 测试步骤数组
      {
        "action": "open https://www.google.com"
      },
      {
        "action": "type 'search box', 'hello world'"
      }
    ],
    "name": "My Dynamic Test",       // 选填
    "description": "Run via API",    // 选填
    "context": "Context info...",    // 选填
    "targetAgentId": "agent-123"     // 选填
  }
  ```

- **响应示例**:
  ```json
  {
    "data": {
      "executionId": "exe-1766730070485-xxxx", // 用于查询状态
      "caseId": "temp-uuid-xxxx",              // 临时生成的用例 ID
      "execution": {
        "id": "exe-1766730070485-xxxx",
        "status": "queued",
        "fileName": "dynamic-request",
        ...
      }
    }
  }
  ```

### 2.3 批量执行测试用例

一次性触发多个测试用例。

- **接口地址**: `/api/batch-execute`
- **请求方式**: `POST`

- **请求体 (JSON)**:
  ```json
  {
    "caseIds": ["case-id-1", "case-id-2"]
  }
  ```
  - `caseIds` (Array<string>, 必填): 需要执行的测试用例 ID 列表。

- **响应示例**:
  ```json
  {
    "data": {
      "batchId": "batch-uuid-xxxx",
      "executions": [
        {
          "id": "exe-1...",
          "caseId": "case-id-1",
          "status": "queued",
          ...
        },
        {
          "id": "exe-2...",
          "caseId": "case-id-2",
          "status": "queued",
          ...
        }
      ]
    }
  }
  ```

### 2.4 查询执行状态详情

根据执行 ID 查询当前状态、进度和结果。

- **接口地址**: `/api/executions/:id`
- **请求方式**: `GET`
- **URL 参数**:
  - `id` (string, 必填): 执行记录 ID (Execution ID，由执行接口返回)

- **响应示例**:
  ```json
  {
    "data": {
      "id": "exe-1766730070485-xxxx",
      "caseId": "case-123",
      "status": "success",  // 状态: queued, running, success, failed
      "progress": 100,
      "logs": [
        "2025-01-15T10:00:00.000Z queued",
        "2025-01-15T10:00:05.000Z started",
        "2025-01-15T10:01:00.000Z finished: success"
      ],
      "reportPath": "exe-1766730070485-xxxx.html", // 测试报告相对路径
      "errorMessage": null
    }
  }
  ```

### 2.5 获取执行报告 (跳转)

当执行完成后，可以直接调用此接口跳转到生成的 HTML 报告页面。

- **接口地址**: `/api/executions/:id/report`
- **请求方式**: `GET`
- **响应**: 
  - 成功: `302 Found` (重定向到 `/reports/xxxx.html`)
  - 失败: `404 Not Found` (报告未生成)

### 2.6 获取所有测试用例列表

获取系统中可用的测试用例，以便获取 `caseId`。

- **接口地址**: `/api/testcases`
- **请求方式**: `GET`

- **响应示例**:
  ```json
  {
    "data": [
      {
        "id": "case-123",
        "name": "登录功能测试",
        "platform": "web", // web, android, ios
        "description": "测试用户登录流程",
        "status": "done"
      },
      ...
    ]
  }
  ```

## 3. 调用流程建议

1. **获取用例 ID**: 调用 `GET /api/testcases` 获取需要执行的用例 ID。
2. **触发执行**: 调用 `POST /api/execute/:id` 或批量接口，获取返回的 `executionId` (即响应中的 `data.id`)。
3. **轮询状态**: 定时 (如每 2-5 秒) 调用 `GET /api/executions/:executionId`。
4. **获取结果**:
   - 当 `status` 变为 `success` 或 `failed` 时，停止轮询。
   - **查看报告**: 
     - 方式一 (推荐): 直接访问 `GET /api/executions/:executionId/report`，系统会自动跳转到报告页面。
     - 方式二 (手动拼接): 获取状态响应中的 `reportPath`，拼接 URL `http://<server-ip>:3002/reports/<reportPath>`。
   - 如果 `status` 为 `failed`，查看 `errorMessage` 获取失败原因。
