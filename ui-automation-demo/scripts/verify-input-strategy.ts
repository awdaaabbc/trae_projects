import 'dotenv/config';
import { runTestCase } from '../server/runner.android';
import { TestCase } from '../server/types';
import { getConnectedDevices } from '@midscene/android';

async function main() {
    console.log('=== Android 智能输入策略验证脚本 ===');
    console.log('此脚本将测试：ADBKeyBoard 中文输入 -> ADB Shell 英文降级 -> AI 兜底\n');

    // 1. 检查设备
    try {
        const devices = await getConnectedDevices();
        if (devices.length === 0) {
            console.error('❌ 未检测到 Android 设备，请连接设备后重试。');
            return;
        }
        console.log(`✓ 检测到设备: ${devices[0].udid}`);
    } catch (e) {
        console.error('❌ 获取设备失败:', e);
        return;
    }

    // 2. 交互提示
    console.log('\n⚠️  【准备工作】 ⚠️');
    console.log('1. 请确保手机已解锁。');
    console.log('2. 请打开一个带有明显搜索框的界面（例如：系统设置页、应用商店首页）。');
    console.log('3. 脚本将尝试点击输入框并输入混合文字。');
    console.log('----------------------------------------');
    console.log('⏳ 5秒后自动开始...');
    
    await new Promise(r => setTimeout(r, 5000));

    // 3. 构造测试用例
    const testCase: TestCase = {
        id: 'verify-input-' + Date.now(),
        name: 'Input Strategy Verification',
        description: 'Verify intelligent input fallback strategy',
        platform: 'android',
        status: 'idle',
        steps: [
            {
                id: 's1',
                type: 'action',
                action: '点击页面上方的搜索框或输入框，确保光标出现'
            },
            {
                id: 's2',
                type: 'input',
                action: '输入: 策略Test_中文' // 这里的 "输入: " 前缀会被正则匹配处理
            },
            {
                id: 's3',
                type: 'action',
                action: '等待1秒'
            },
            {
                id: 's4',
                type: 'input',
                action: 'MidsceneInput' // 没有 "输入:" 前缀，作为直接值
            }
        ]
    };

    console.log('\n🚀 开始执行测试用例...');
    const executionId = 'exec-verify-' + Date.now();

    try {
        const result = await runTestCase(testCase, executionId, (patch) => {
            // 这里只打印进度，详细日志会在控制台直接输出（因为 runner.android.ts 里有 console.log）
            if (patch.progress) {
                process.stdout.write(`.`);
            }
        });

        console.log('\n\n✅ 执行结束');
        console.log('----------------------------------------');
        console.log(`执行状态: ${result.status}`);
        if (result.reportPath) {
            console.log(`报告路径: ${result.reportPath}`);
        }
        if (result.errorMessage) {
            console.error(`错误信息: ${result.errorMessage}`);
        }
        
        console.log('\n📝 结果验证:');
        console.log('1. 请查看手机输入框，是否包含 "策略Test_中文" 和 "MidsceneInput"');
        console.log('2. 请检查上方日志，寻找以下关键信息:');
        console.log('   - "[Android Runner] Attempting to input via ADBKeyBoard" (预期出现)');
        console.log('   - "[Android Runner] ADBKeyBoard input successful" (预期出现)');
        console.log('----------------------------------------');

    } catch (e) {
        console.error('\n❌ 脚本运行异常:', e);
    }
}

main();
