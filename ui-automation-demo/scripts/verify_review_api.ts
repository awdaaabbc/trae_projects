
import axios from 'axios'

const SERVER_URL = 'http://localhost:3002'

async function testReviewApi() {
  console.log('Testing /api/review-case...')

  // Test Case 1: Bad Case (Violating multiple rules)
  const badCase = {
    name: 'Bad Android Case',
    platform: 'android',
    steps: [
      { action: '搜索大班语文' }, // Violates Rule 3 (Detailed steps)
      { action: '向下滑动，浏览课程页面' }, // Violates Rule 4 (Ambiguity) & Rule 8 (Scroll distance)
      { action: '在课程列表中任意点击一门课程' }, // Violates Rule 10 (Specific target)
      { action: '输入密码123456' } // Violates Rule 5 (ADBKeyboard)
    ]
  }

  try {
    const res = await axios.post(`${SERVER_URL}/api/review-case`, badCase)
    console.log('\n[Bad Case Review Result]:')
    console.log(`Score: ${res.data.data.score}`)
    if (res.data.data.refinedSteps) {
      console.log('Refined Steps available:')
      console.log(res.data.data.refinedSteps.split('\n').map((l: string) => `  > ${l}`).join('\n'))
    } else {
      console.warn('WARNING: No refinedSteps returned!')
    }
    res.data.data.suggestions.forEach((s: any) => {
      console.log(`- [Step ${s.stepIndex}] ${s.severity.toUpperCase()}: ${s.message} -> ${s.suggestion}`)
    })
  } catch (e: any) {
    console.error('Failed to review bad case:', e.response?.data || e.message)
  }

  // Test Case 2: Good Case
  const goodCase = {
    name: 'Good Android Case',
    platform: 'android',
    steps: [
      { action: '点击右上角的搜索图标' }, // Good: Specific location
      { action: '点击输入框，激活键盘' },
      { action: '输入：使用ADBKeyboard输入“大班语文”，并点击回车键' }, // Good: Rule 3 & 5
      { action: '等待页面跳转，直到看到“筛选”按钮' }, // Good: Rule 1
      { action: '向下滑动半页' }, // Good: Rule 8
      { action: '点击课程名称“大班语文秋季班”' } // Good: Rule 10
    ]
  }

  try {
    const res = await axios.post(`${SERVER_URL}/api/review-case`, goodCase)
    console.log('\n[Good Case Review Result]:')
    console.log(`Score: ${res.data.data.score}`)
    res.data.data.suggestions.forEach((s: any) => {
      console.log(`- [Step ${s.stepIndex}] ${s.severity.toUpperCase()}: ${s.message} -> ${s.suggestion}`)
    })
  } catch (e: any) {
    console.error('Failed to review good case:', e.response?.data || e.message)
  }
}

testReviewApi()
