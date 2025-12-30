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
// 进一步验证后发现，midscene似乎在乐读app采用了在输入法中黏贴
// 的方式输入到输入框中，给了复制粘贴的权限后可以输入，而京东不需要，
// 深入源码后发现，在安卓端，如果输入中文会通过剪切版的方式输入，而英文则使用adb原生输入法
// 乐读app搜索课程中没有搜索按钮，尝试让其点击输入法的搜索按钮失败，转为显示输入回车键后成功搜索

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
        '如果在操作过程中出现定位、权限、用户协议等弹窗，点击“同意”或“允许，或右滑微信弹窗”。'
    });

    await device.connect();

    // 5. 执行搜索操作
    console.log('正在搜索课程...');
    
    // 方案二：手动/显式启动后，直接进行交互
    // 如果你已经手动打开了 App，可以直接从这里开始
    // 或者使用 device.launchApp('com.dadaabc.zhuozan.dadateacher') 显式启动
    
    // 确保在正确的页面
    await agent.aiAct('点击乐读app(图标是乐读小班)，如果当前界面不包含任何app图标，请返回主界面，左右滑动直到出现乐读图标，点击打开');
    await agent.aiAct('进入课程搜索页，如果出现权限/协议/引导弹窗，全部关闭或同意');
    await agent.aiAct('点击搜索框，直到出现输入光标');
    await agent.aiAct('如果搜索框里已有文字，长按搜索框，点击全选，然后删除清空');
    await agent.aiAct('输入小班化学');
    await agent.aiAct('长按搜索框直至出现粘贴界面，点击粘贴');
    await agent.aiAct('如果没有出现“粘贴”，再次长按搜索框直到出现“粘贴”，然后点击“粘贴”，如果搜索框已经包含”小班化学“请忽略');
    // await agent.aiAct('确认搜索框里出现“小班物理”');
    await agent.aiAct('按下回车键');

    //  await agent.aiAct('点击乐读app(图标是乐读小班)，如果当前界面不包含任何app图标，请返回主界面，左右滑动直到出现乐读图标，点击打开');
    // await agent.aiAct('进入课程搜索页，如果出现权限/协议/引导弹窗，全部关闭或同意');
    // await agent.aiAct('点击搜索框，直到出现输入光标');
    // await agent.aiAct('如果搜索框里已有文字，长按搜索框，点击全选，然后删除清空');
    // try {
    //   await device.keyboardType('小班物理');
    //   await agent.runAdbShell('input keyevent 66');
    // } catch {
    //   await agent.aiAct('输入小班物理，输入完毕后按下回车键');
    // }
    // 强制发送一个回车信号
    // const adb = await device.getAdb();
    // await adb.shell(['input', 'keyevent', '66']);
    
    await sleep(5000);
    // 6. 等待条件满足：确保搜索结果已经加载出来
    await agent.aiWaitFor('页面上至少出现一个课程');

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
