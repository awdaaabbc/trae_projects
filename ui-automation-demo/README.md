# UI Automation Demo

> 基于 MidScene AI、Playwright 和 ADB 的智能化 UI 自动化测试平台。

## 📖 项目简介

本项目是一个轻量级、智能化的 UI 自动化测试平台。通过集成 MidScene AI，实现了通过自然语言指令编写和执行测试用例。支持 **Web** 和 **Android** 两个平台的自动化测试，并提供可视化的测试报告和实时状态监控。

### 核心特性

- **🤖 AI 驱动**：使用自然语言（如 "点击搜索框", "输入 content"）编写测试步骤，降低自动化门槛。
- **🌐 多端支持**：
  - **Web 端**：基于 Playwright，支持主流浏览器自动化。
  - **📱 Android 端**：基于 ADB 和 MidScene，支持安卓真机/模拟器自动化。
- **🚀 批量执行**：支持多用例批量排队执行，内置并发控制（默认最大 5 并发）。
- **📊 可视化报告**：生成详细的 HTML 测试报告，包含步骤截图、视频回放和 AI 分析。
- **⚡️ 实时监控**：
  - WebSocket 实时推送任务状态和进度。
  - 支持 **一键停止** 所有运行中任务。
  - 服务器启动自动状态修复，防止“僵尸”任务。

---

## 🛠 快速开始

### 1. 环境准备

- **Node.js**: >= 18.0.0
- **Playwright**: 用于 Web 自动化
- **Android SDK (ADB)**: 用于 Android 自动化 (需配置环境变量 `ANDROID_HOME` 或确保 `adb` 在 PATH 中)

### 2. 安装依赖

```bash
# 安装项目依赖
npm install

# 安装 Playwright 浏览器
npx playwright install
```

### 3. 配置环境

复制 `.env.example` 为 `.env` 并配置 AI 模型密钥：

```bash
cp .env.example .env
```

在 `.env` 中填入你的 `MIDSCENE_MODEL_API_KEY`。

### 4. 启动项目

推荐使用一键启动脚本，自动编译后端并同时启动前后端服务：

```bash
./start.sh
```

或者手动启动：

```bash
# 终端 1: 启动后端
npm run dev:server

# 终端 2: 启动前端
npm run dev:frontend
```

访问地址：`http://localhost:5173`

---

## 📖 使用指南

### 1. 创建测试用例
- 点击左上角 **"新建用例"**。
- 选择平台：**Web** 或 **Android**。
- 输入用例名称和描述。
- **编写步骤**：使用自然语言描述操作。
  - Web 示例：`打开 https://www.saucedemo.com/` -> `输入 standard_user 到 用户名输入框`
  - Android 示例：`打开 App 乐读` -> `点击 搜索框` -> `输入 物理`

### 2. 执行测试
- **单条执行**：在用例列表中点击 "执行" 按钮。
- **批量执行**：勾选多个用例，点击顶部的 "批量执行" 按钮。系统将自动加入队列并按顺序执行。

### 3. 查看结果
- **实时状态**：列表中的状态图标和进度条会实时更新。
- **测试报告**：执行完成后，点击 "查看报告" 链接打开详细的 HTML 报告。

### 4. 任务管理
- **停止任务**：点击左侧菜单栏顶部的 🔴 **停止按钮**，可一键终止所有正在运行和排队的任务。
- **状态重置**：如果服务异常重启，系统会在启动时自动检测并修复异常状态的任务；也可以点击左侧菜单栏的 **强制重置** 按钮手动修复。

---

## 📂 项目结构

```
.
├── data/               # 数据存储 (JSON)
│   ├── executions/     # 执行记录
│   └── testcases/      # 测试用例定义
├── docs/               # 项目文档
├── server/             # 后端服务 (Express)
│   ├── index.ts        # 入口 & API 定义
│   ├── runner.ts       # Web 执行器
│   ├── runner.android.ts # Android 执行器
│   └── storage.ts      # 数据持久化
├── src/                # 前端应用 (React)
├── start.sh            # 一键启动脚本
├── gitpush.sh          # 一键提交脚本
└── demo.ts             # 脚本调试入口
```

## ⌨️ 常用脚本

- `./start.sh`: 启动开发环境（前后端）。
- `./gitpush.sh`: 一键提交代码（自动暂存修改，排除 `data/` 目录）。
- `npm run test`: 运行后端单元测试。
