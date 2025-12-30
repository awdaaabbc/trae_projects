import 'dotenv/config'; // 第一行
import {
  AndroidAgent,
  AndroidDevice,
  getConnectedDevices,
} from '@midscene/android';
//脚本的效果，和前端输入的效果不一样，脚本甚至运行失败，前端输入打开乐读可以打开，后端脚本运行直接直接识别不到
//原因在于，打开与点击两个动作，ai的理解不一样，打开的话ai直接找驱动包，点击的话ai依然会找驱动，改成点击带有乐读小班图标后成功
// 输入问题，在启动脚本时候，无法在输入框中输入小班语文，发现在输入法中看到了小班语文的问题，而京东app可以输入
// 猜测两种app的开发框架不同，不能直接在输入框中输入
// 进一步验证后发现，midscene似乎在乐读app采用了在输入法中黏贴的方式输入到输入框中，给了复制粘贴的权限后可以输入

// 辅助函数：等待指定毫秒数
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Promise.resolve(
  (async () => {
    // 1. 获取设备
    const devices = await getConnectedDevices();
    if (devices.length === 0) {
      throw new Error('未检测到 Android 设备，请检查 USB 或无线连接');
    }
    const device = new AndroidDevice(devices[0].udid);

    // 2. 初始化 Agent，并配置中文的上下文处理规则
    // 这里的 context 非常重要，告诉 AI 如何处理国内常见的“打开APP查看”或权限弹窗
    const agent = new AndroidAgent(device, {
      aiActionContext:
        '如果在操作过程中出现定位、权限、用户协议等弹窗，点击“同意”或“允许”。'
    });

    await device.connect();

    // 5. 执行搜索操作
    console.log('正在搜索课程...');
    
    // 方案二：手动/显式启动后，直接进行交互
    // 如果你已经手动打开了 App，可以直接从这里开始
    // 或者使用 device.launchApp('com.dadaabc.zhuozan.dadateacher') 显式启动
    
    // 确保在正确的页面
    await agent.aiAct('点击京东app图标，点击上方首页下的搜索框');
    // 注意：adb shell input text 不支持直接输入中文字符，需要使用 Base64 或专用输入法
    // 这里改用 MidScene 的 aiAct 来处理输入，或者输入英文/数字
    await agent.aiAct('输入雅迪电动车，点击搜索按钮'); 
    // await agent.aiAct('点击输入法界面右下角的搜索按钮');
    // 强制发送一个回车信号
    // await device.adbShell(['input', 'keyev/ent', '66']);
    
    await sleep(5000);
    // 6. 等待条件满足：确保搜索结果已经加载出来
    await agent.aiWaitFor('页面上至少出现一个商品');

    // 7. 数据提取 (Query)
    console.log('正在提取课程信息...');
    // schema 定义我们要提取的数据结构
    const items = await agent.aiQuery(
      '{itemTitle: string, price: string, teacherName:}[], 找到搜索结果列表中的前3个商品，提取它们的标题和价格和老师姓名',
    );
    console.log('提取到的商品信息：', items);

    // 8. 断言 (Assert)
   
  })(),
);