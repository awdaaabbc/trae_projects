# Midscene 深度性能优化方案：Agent 内核级加速

> ⚠️ **警告**：本方案涉及修改底层库行为，属于高级优化技巧。请在充分理解风险后实施。

## 方案一：端侧截图压缩 (Client-side Image Compression)

### 原理
Midscene 默认上传原图给 LLM。对于现在的 2K/4K 手机屏幕，一张截图可能高达 3MB-5MB。
LLM（如 GPT-4o 或 Gemini）处理大图不仅 Token 消耗多，而且首字延迟（Time to First Token）显著增加。

### 实现 (Monkey Patching)
在 `server/runner.android.ts` 中，通过动态代理拦截 `device.screenshot` 方法。

```typescript
// 伪代码示例
const originalScreenshot = device.screenshot.bind(device);

device.screenshot = async () => {
  // 1. 获取原图 Buffer
  const buffer = await originalScreenshot();
  
  // 2. 使用 Sharp/Jimp 进行压缩 (需安装 sharp 库)
  // 目标：宽度缩放至 1080px，JPEG 质量 60
  const resizedBuffer = await sharp(buffer)
    .resize(1080, null, { fit: 'inside' })
    .jpeg({ quality: 60 })
    .toBuffer();
    
  return resizedBuffer;
};
```

### 预期收益
- **上传耗时**: 减少 80% (3MB -> 300KB)
- **推理耗时**: 减少 30% (LLM 视觉编码更快)
- **总提速**: 单步可节省约 1.5s - 2s。

---

## 方案二：UI 树剪枝 (Tree Pruning)

### 原理
Android 的 `dumpHierarchy` 往往包含大量不可见的布局嵌套。
Midscene 虽然会压缩，但我们可以做得更激进。

### 实现
拦截 `device.getUiTree` 或类似方法（取决于具体实现），在发送给 Agent 前清洗 XML。
剔除所有 `visible="false"` 或 `bounds` 为空/在屏幕外的节点。

---

## 方案三：预测性执行 (Speculative Execution)

### 原理
如果连续两个步骤是 `点击输入框` -> `输入文字`。
在发送 `点击` 请求的同时，如果我们可以预测下一步大概率是输入，可以提前把输入框的坐标和 Prompt 准备好。
(这需要极强的工程能力和对业务的理解，通常通过“合并指令”来替代)

## 总结
修改 Agent 代码是完全可行的，通常通过 **Decorator 模式** 或 **Proxy 代理** 来无侵入地增强现有类。这展示了你对动态语言特性和框架底层的掌控力。
