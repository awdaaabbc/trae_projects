import 'dotenv/config';
import {
  IOSAgent,
  IOSDevice,
  agentFromWebDriverAgent,
} from '@midscene/ios';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
Promise.resolve(
  (async () => {
    // 方式一：直接创建设备和 Agent
    const page = new IOSDevice({
      wdaPort: 8100,
      wdaHost: 'localhost',
    });

    // 👀 初始化 Midscene Agent
    const agent = new IOSAgent(page, {
      aiActionContext:
        'If any location, permission, user agreement, etc. popup appears, click agree. If login page appears, close it.',
    });
    await page.connect();

    // 方式二：使用便捷函数（推荐）
    // const agent = await agentFromWebDriverAgent({
    //   wdaPort: 8100,
    //   wdaHost: 'localhost',
    //   aiActionContext: 'If any location, permission, user agreement, etc. popup appears, click agree. If login page appears, close it.',
    // });

    // 👀 直接打开 ebay.com（推荐做法）
    await page.launch('https://ebay.com');
    await sleep(3000);

    // 👀 输入关键字并执行搜索
    await agent.aiAct('Search for "Headphones"');

    // 👀 等待加载完成
    await agent.aiWaitFor('At least one headphone product is displayed on the page');
    // 或简单地等待几秒：
    // await sleep(5000);

    // 👀 理解页面内容并提取数据
    const items = await agent.aiQuery(
      '{itemTitle: string, price: Number}[], find product titles and prices in the list',
    );
    console.log('Headphone product information', items);

    // 👀 使用 AI 断言
    await agent.aiAssert('Multiple headphone products are displayed on the interface');

    await page.destroy();
  })(),
);