# 部署与使用指南

本指南介绍如何将 UI 自动化测试平台部署到公司内部环境，以及团队成员如何接入测试。

## 架构说明

系统分为两部分：
1.  **Server (服务端)**：运行在 Docker 容器中，提供 Web 界面、任务调度、数据存储。
2.  **Agent (执行端)**：运行在测试人员的本地电脑上，连接真实的 Android/iOS 设备，执行测试任务。

## 一、服务端部署 (运维/负责人)

服务端只需部署一份，供全员访问。

### 1. 构建 Docker 镜像

在项目根目录下运行：

```bash
docker build -t ui-automation-server .
```

### 2. 启动容器

启动时需要设置必要的环境变量（主要是 AI 模型的配置）。

```bash
docker run -d \
  --name automation-server \
  -p 3002:3002 \
  -e MIDSCENE_MODEL_BASE_URL="https://ark.cn-beijing.volces.com/api/v3" \
  -e MIDSCENE_MODEL_API_KEY="your-api-key" \
  -e MIDSCENE_MODEL_NAME="ep-20251226164616-zvvk9" \
  -e MIDSCENE_MODEL_FAMILY="vlm-ui-tars-doubao" \
  -e MIDSCENE_PLANNING_MODEL_BASE_URL="https://ark.cn-beijing.volces.com/api/v3" \
  -e MIDSCENE_PLANNING_MODEL_API_KEY="your-api-key" \
  -e MIDSCENE_PLANNING_MODEL_NAME="ep-20251218203810-5nwz8" \
  -e MIDSCENE_PLANNING_MODEL_FAMILY="doubao-vision" \
  ui-automation-server
```

启动后，公司内网用户可以通过 `http://服务器IP:3002` 访问 Web 界面。

---

## 二、接入本地测试设备 (团队成员)

任何想用自己电脑连接手机进行测试的成员，请按以下步骤操作。

### 1. 准备工作
*   拉取项目代码：`git clone <repo-url>`
*   安装 Node.js (v18+)
*   安装依赖：`npm install`

### 2. 连接手机
*   **Android**: 通过 USB 连接，确保开启 USB 调试，运行 `adb devices` 能看到设备。
*   **iOS**: 确保安装了 Xcode 和必要的驱动 (参考 Appium/WDA 配置)。

### 3. 启动 Agent

设置 `SERVER_URL` 指向公司服务器地址，然后启动对应平台的 Agent。

**Linux/Mac:**
```bash
# 替换为实际的服务器 IP
export SERVER_URL="ws://192.168.1.100:3002/ws"

# 启动 Android Agent
npm run agent:android

# 或启动 iOS Agent
npm run agent:ios
```

**Windows (PowerShell):**
```powershell
$env:SERVER_URL="ws://192.168.1.100:3002/ws"
npm run agent:android
```

### 4. 开始测试
Agent 启动后会显示 `Connected to server`。
此时在 Web 界面 (http://192.168.1.100:3002) 上运行测试用例，任务会自动分发到你的手机上执行。

## 三、开发与调试

如果是开发人员进行二次开发：
1.  启动本地开发环境：`npm run dev`
2.  本地 Agent 连接本地开发服务器（默认配置）：
    ```bash
    npm run agent:android
    ```
