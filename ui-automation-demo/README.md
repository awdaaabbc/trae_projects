# React + TypeScript + Vite

该模板提供了一个最小化的设置，用于在 Vite 中使用 React，支持 HMR（热模块替换）和一些 ESLint 规则。

## Getting Started / 项目启动准备

如果这是你第一次拉取本项目，请按照以下步骤进行环境准备：

### 1. 安装依赖

```bash
# 安装 Node.js 依赖
npm install

# 安装 Playwright 浏览器二进制文件 (必须)
npx playwright install
```

### 2. 环境变量配置

复制 `.env.example` 为 `.env`，并填入必要的模型配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置 `MIDSCENE_MODEL_API_KEY` 等参数以启用 AI 功能。

### 3. 启动项目

```bash
# 使用一键启动脚本
./start.sh

# 或者手动启动
npm run dev
```

---

目前，有两个官方插件可用：

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) 使用 [Babel](https://babeljs.io/) (或在 [rolldown-vite](https://vite.dev/guide/rolldown) 中使用 [oxc](https://oxc.rs)) 实现快速刷新
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) 使用 [SWC](https://swc.rs/) 实现快速刷新

## React 编译器

由于对开发和构建性能的影响，本模板默认未启用 React 编译器。如需添加，请参阅[此文档](https://react.dev/learn/react-compiler/installation)。

## 扩展 ESLint 配置

如果你正在开发生产级应用，我们建议更新配置以启用类型感知的 lint 规则：

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // 其他配置...

      // 移除 tseslint.configs.recommended 并替换为以下内容
      tseslint.configs.recommendedTypeChecked,
      // 或者使用更严格的规则
      tseslint.configs.strictTypeChecked,
      // 可选：添加样式规则
      tseslint.configs.stylisticTypeChecked,

      // 其他配置...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // 其他选项...
    },
  },
])
```

你也可以安装 [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) 和 [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) 来获取 React 特定的 lint 规则：

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // 其他配置...
      // 启用 React lint 规则
      reactX.configs['recommended-typescript'],
      // 启用 React DOM lint 规则
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // 其他选项...
    },
  },
])
```
