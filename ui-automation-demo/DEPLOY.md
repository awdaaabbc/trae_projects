# 部署指南 (Deployment Guide)

本指南介绍如何将 UI Automation Demo 项目部署到新的机器上，并连接真机进行 Android/iOS 自动化测试。

## 1. 环境准备 (Prerequisites)

在目标机器上，你需要安装以下软件：

### 通用依赖
- **Node.js**: 推荐 v18 或更高版本。
- **Git**: 用于拉取代码。
- **npm** 或 **pnpm**: 包管理工具。

### Android 自动化依赖 (如果需要跑 Android)
- **Java Development Kit (JDK)**: 推荐 JDK 11 或 17。
- **Android SDK**:
  - 确保安装了 `Android SDK Platform-Tools` (包含 `adb`)。
  - 配置环境变量 `ANDROID_HOME` 指向 SDK 路径。
  - 将 `platform-tools` 添加到系统 `PATH` 中。
- **验证**: 在终端运行 `adb devices` 应能列出已连接的设备。

### iOS 自动化依赖 (如果需要跑 iOS，仅限 Mac)
- **Xcode**: 从 App Store 安装。
- **Xcode Command Line Tools**: 运行 `xcode-select --install`。
- **libimobiledevice**: 运行 `brew install libimobiledevice`。
- **ios-deploy**: 运行 `brew install ios-deploy`。

## 2. 获取代码与安装依赖

```bash
# 1. 拉取代码
git clone <你的仓库地址>
cd trae_projects

# 2. 安装根目录依赖
npm install

# 3. 进入项目目录并安装依赖
cd ui-automation-demo
npm install
```

## 3. 配置项目

复制示例配置文件并进行修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入必要的配置：

```ini
# 后端端口 (默认 3002)
PORT=3002

# MidScene AI 配置 (必须配置，否则无法进行 AI 规划)
MIDSCENE_PLANNING_MODEL_API_KEY="your-api-key-here"
MIDSCENE_PLANNING_MODEL_BASE_URL="https://ark.cn-beijing.volces.com/api/v3" # 或其他 OpenAI 兼容接口
MIDSCENE_PLANNING_MODEL_NAME="your-model-name"
MIDSCENE_PLANNING_MODEL_FAMILY="doubao-vision" # 或其他模型家族

# 可选：自定义数据存储路径
# UI_AUTOMATION_DATA_DIR=./data/testcases
# UI_AUTOMATION_REPORT_DIR=./midscene_run/report
```

## 4. 启动服务

你需要启动两个服务：**Web 服务** (提供界面和控制中心) 和 **Agent 服务** (连接真机执行任务)。建议在两个不同的终端窗口中运行。

### 终端 1: 启动 Web 服务 (Server + Frontend)

开发模式（推荐调试使用）：
```bash
npm run dev
```
此时可以通过浏览器访问 `http://localhost:5173` (前端) 和 `http://localhost:3002` (后端)。

### 终端 2: 启动设备 Agent

根据你要连接的设备类型启动对应的 Agent。Agent 会自动连接到本地运行的 Server。

**启动 Android Agent:**
```bash
npm run agent:android
```

**启动 iOS Agent:**
```bash
npm run agent:ios
```

> **注意**: 启动 Agent 前，请确保手机已通过 USB 连接到电脑，并开启了“开发者模式”和“USB 调试”。

## 5. 验证部署

1. 打开浏览器访问前端页面 (通常是 `http://localhost:5173`)。
2. 确保终端 2 中的 Agent 显示 `Connected to server` 和 `Agent registered`。
3. 在页面上创建一个新的测试用例，选择对应的平台 (Android/iOS)。
4. 点击运行，系统会将任务分发给已连接的 Agent 执行。
