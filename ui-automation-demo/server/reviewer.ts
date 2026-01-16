
import OpenAI from 'openai'
import type { TestCase } from './types.js'

export interface ReviewResult {
  score: number
  suggestions: {
    stepIndex: number
    severity: 'error' | 'warning' | 'info'
    message: string
    suggestion?: string
  }[]
  refinedSteps?: string
}

const SYSTEM_PROMPT = `你是一个资深的 UI 自动化测试专家。请审查以下测试用例，并根据以下核心规则进行严格检查。

### 核心审查规则

1.  **界面跳转等待**：如果涉及界面跳转（如点击登录后进入首页），必须提示 AI 等待页面加载完毕（例如检查某个元素出现）。
2.  **元素定位辅助**：描述点击操作时，必须提供大概位置（如右上角、中间）和图标特征，以加速定位。
3.  **详细操作描述**：在自然语言中，必须详细描述每一步的原子操作。
    *   *错误示例*：“搜索大班语文”
    *   *正确示例*：“点击搜索按钮，激活输入框，输入大班语文，并按下回车键”
    *   *特别注意*：输入后必须明确说明是否需要按回车键。
4.  **消除歧义**：避免产生歧义的描述。
    *   *反例*：“向下滑动，浏览课程页面” -> AI 可能会理解为“先下滑再上滑”。
    *   *修正*：删除“浏览课程页面”这种模糊动作，直接写“向下滑动半页”。
5.  **输入法限制**：
    *   如果需要输入中文，请在手机上按照 ADBKeyboard 或确保剪贴板权限已打开。
    *   如果步骤涉及输入，检查是否提示了输入法相关配置。
6.  **特殊板块输入**：对于“天天练”等不支持底层自动输入的板块，必须明确指示“点击屏幕键盘输入答案”。
7.  **分支逻辑合并**：条件判断（If）必须写在同一个步骤中。
    *   *正确示例*：“输入账号密码登录，若已登陆，请跳过此步骤”。
8.  **滑动操作规范**：
    *   禁止使用笼统的“滑动”。
    *   必须指定幅度，例如“滑动半页”或“滑动四分之一页”，避免滑过头导致漏掉目标。
9.  **特定场景点击（乐读购买课程）**：
    *   在课程列表中，如果中间有辅导老师头像，必须明确指示“点击课程条目”，否则 AI 可能会点到老师头像。
10. **具体化目标**：
    *   禁止模糊指令，如“在课程列表中任意点击一门课程”。
    *   必须指定详细的课程名字。
11. **无文字标识处理**：
    *   对于没有文字标识的图标（如 AI 批改、报名按钮），必须给出详细的视觉描述或位置信息，防止误点。
12. **合并多步骤**：
    *   为了减少调用大模型的耗时，可以将相同阶段的步骤合并为一个，例如：1. 点击课程列表页面中的“时间”筛选按钮（通常是一个日历或时钟图标，并带有“时间”文字）。2. 在弹出的筛选器中，找到并选择“周五”。3. 找到并选择时间段“18:30-19:00”。4. 点击筛选器底部的“确定”按钮。 可以将四个步骤放在一起组合使用。也可以将等待界面跳转放到上一个步骤的末尾

### 输出格式

请返回 JSON 格式，不要包含 Markdown 代码块标记：
{
  "score": <0-100的整数打分>,
  "suggestions": [
    {
      "stepIndex": <步骤序号，从0开始>,
      "severity": "error" | "warning" | "info",
      "message": "<简短的问题描述>",
      "suggestion": "<具体的修改建议>"
    }
  ],
  "refinedSteps": "<根据上述建议优化后的完整测试步骤文本，每行一步，直接可用的纯文本格式，不要包含'Step X:'前缀或'[action]'标记，只保留操作描述>"
}

如果用例完美，suggestions 数组为空，score 为 100，refinedSteps 为原步骤文本。
`

export async function reviewTestCase(testCase: TestCase): Promise<ReviewResult> {
  const apiKey = process.env.REVIEW_MODEL_KEY
  const baseURL = process.env.REVIEW_MODEL_URL
  const model = process.env.REVIEW_MODEL_NAME || 'gpt-4o'

  if (!apiKey) {
    throw new Error('Missing REVIEW_MODEL_KEY environment variable')
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
  })

  const stepsContent = testCase.steps
    .map((s, i) => `Step ${i}: [${s.type || 'action'}] ${s.action}`)
    .join('\n')

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `请审查以下测试用例（平台：${testCase.platform}）：\n\n${stepsContent}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2, // Low temperature for consistent analysis
    })

    const content = response.choices[0].message.content
    if (!content) {
      throw new Error('Empty response from LLM')
    }

    const result = JSON.parse(content) as ReviewResult
    
    // Fallback validation for result structure
    if (typeof result.score !== 'number' || !Array.isArray(result.suggestions)) {
      throw new Error('Invalid JSON structure from LLM')
    }

    return result
  } catch (error) {
    console.error('AI Review failed:', error)
    // Fallback result on error
    return {
      score: -1,
      suggestions: [
        {
          stepIndex: -1,
          severity: 'error',
          message: 'AI 审查服务暂时不可用',
          suggestion: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
}
