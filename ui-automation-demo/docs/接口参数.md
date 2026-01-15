### 直接传入测试脚本进行执行，无需预先创建测试用例 ID。

- **接口地址**: `http://10.25.234.41:3002/api/run-raw`
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
        "fileName": "测试用例名称_日期_时间戳",
        ...
      }
    }
  }
  ```

### 根据执行 ID 查询当前状态、进度和结果。

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

###  获取执行报告 (跳转)

当执行完成后，可以直接调用此接口跳转到生成的 HTML 报告页面。

- **接口地址**: `/api/executions/:id/report`
- **请求方式**: `GET`
- **响应**: 
  - 成功: `302 Found` (重定向到 `/reports/xxxx.html`)
  - 失败: `404 Not Found` (报告未生成，会生成一个站位)



