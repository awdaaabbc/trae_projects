# UI 设计规范文档 (UI Design Specifications)

## 1. 设计概述 (Design Overview)

本设计规范旨在为 **UI 自动化测试平台** 提供统一、现代化且高效的用户界面标准。基于 **Ant Design 5.0** 设计体系，采用清晰的层级结构和简洁的视觉风格，提升用户操作效率与体验。

### 1.1 设计原则
- **清晰 (Clarity)**: 核心任务优先，信息层级分明，避免视觉干扰。
- **高效 (Efficiency)**: 优化交互流程，减少点击次数，支持快捷操作。
- **一致 (Consistency)**: 遵循统一的视觉语言和交互模式，降低学习成本。
- **反馈 (Feedback)**: 及时、明确的操作反馈，确保用户掌控系统状态。

---

## 2. 色彩系统 (Color System)

采用 Ant Design 默认色彩算法，确保无障碍阅读与视觉舒适度。

### 2.1 品牌色 (Primary Color)
- **Primary Blue**: `#1677ff`
  - 用于：主按钮、选中状态、链接、关键强调。

### 2.2 功能色 (Functional Colors)
- **Success (成功)**: `#52c41a` - 用于执行成功、通过状态。
- **Warning (警告)**: `#faad14` - 用于非阻塞性提示。
- **Error (错误)**: `#ff4d4f` - 用于执行失败、系统错误、删除操作。
- **Info (信息)**: `#1677ff` - 用于普通提示信息。

### 2.3 中性色 (Neutral Colors)
- **Text Primary**: `rgba(0, 0, 0, 0.88)` - 主要文字。
- **Text Secondary**: `rgba(0, 0, 0, 0.45)` - 次要文字、描述。
- **Border**: `#d9d9d9` - 边框颜色。
- **Background**: `#f5f5f5` - 页面背景。
- **Container**: `#ffffff` - 卡片、内容区域背景。

---

## 3. 排版系统 (Typography)

使用系统默认字体栈，确保跨平台最佳渲染效果。

### 3.1 字体栈 (Font Stack)
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

### 3.2 字号层级 (Type Scale)
- **Level 1 Title**: `38px` - 极少使用。
- **Level 2 Title**: `30px` - 页面主标题。
- **Level 3 Title**: `24px` - 模块标题。
- **Level 4 Title**: `20px` - 区域标题。
- **Body Text**: `14px` - 标准正文。
- **Small Text**: `12px` - 辅助说明。

---

## 4. 布局与栅格 (Layout & Grid)

### 4.1 框架结构
- **Sidebar (侧边栏)**: 固定宽度 `300px`，用于导航与一级列表。
- **Content (内容区)**: 自适应宽度，内部采用弹性布局。
- **Spacing (间距)**: 基于 `8px` 网格系统 (8, 16, 24, 32, 48)。

### 4.2 响应式策略
- 虽然系统主要针对桌面端，但布局应支持弹性伸缩。
- 内容区域在小屏幕下应保持可滚动，避免布局错乱。

---

## 5. 组件规范 (Component Specs)

### 5.1 按钮 (Buttons)
- **Primary**: 用于页面主要行动点（如"执行测试"、"新建"）。
- **Default**: 用于次要操作（如"编辑"、"取消"）。
- **Link**: 用于表格内操作或跳转。
- **Icon Button**: 用于工具栏快捷操作。

### 5.2 状态标签 (Tags/Badges)
- **Done/Success**: 绿色 Tag + 勾选图标。
- **Failed/Error**: 红色 Tag + 叉号图标。
- **Running**: 蓝色 Tag + 旋转图标。
- **Queued**: 灰色 Tag + 时钟图标。

### 5.3 列表与表格 (Lists & Tables)
- 列表项高度舒适，支持 Hover 高亮。
- 关键信息（名称）加粗，辅助信息（时间、状态）弱化。
- 操作区固定在右侧。

### 5.4 反馈 (Feedback)
- **Message**: 全局轻量级提示（成功/失败），3秒自动消失。
- **Modal**: 阻断式对话框，用于创建、编辑等复杂表单操作。
- **Loading**: 按钮 Loading 状态或骨架屏，避免界面冻结感。

---

## 6. 交互规范 (Interaction Specs)

- **新建/编辑**: 统一使用模态框 (Modal)，保持上下文不丢失。
- **执行测试**: 点击后按钮立即进入 Loading 状态，避免重复提交。
- **查看报告**: 新标签页打开，不打断当前工作流。
- **列表切换**: 点击侧边栏列表项，右侧内容区即时刷新。
