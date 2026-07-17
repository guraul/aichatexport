import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'chatglm-export');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const CONVERSATIONS_PATH = path.join(CONFIG_DIR, 'conversations.json');
const SESSION_PATH = path.join(os.homedir(), '.config', 'chatglm_session.json');

function loadConfig() {
  const p = process.env.CONFIG_PATH || CONFIG_PATH;
  if (!fs.existsSync(p)) {
    const c = { outputDir: path.join(os.homedir(), 'raw', 'inbox'), requestTimeoutMs: 120000 };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(c, null, 2));
    console.log(`已创建默认配置: ${p}`);
    return c;
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function safeName(title) {
  if (!title) return 'untitled';
  return title.replace(/[/\\?%*:|"<>]/g, '＿').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function toMarkdown(messages, convTitle) {
  const fm = { title: convTitle, source: 'chatglm.cn', date: '', tags: ['ai-chat', 'chatglm'] };
  const blocks = [];
  for (const msg of messages) {
    const user = msg.input?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
    if (user) { fm.date ||= msg.update_time?.split(' ')[0] || ''; blocks.push({ role: 'user', text: user }); }
    const asst = (msg.output?.parts || [])
      .filter(p => (p.content || []).some(c => c.type === 'text'))
      .map(p => p.content.find(c => c.type === 'text').text)
      .filter(Boolean);
    if (asst.length > 0) { fm.date ||= msg.update_time?.split(' ')[0] || ''; blocks.push({ role: 'assistant', text: asst.join('\n\n') }); }
  }
  fm.date ||= new Date().toISOString().split('T')[0];
  const yml = `---\ntitle: ${fm.title}\nsource: ${fm.source}\ndate: ${fm.date}\ntags:\n${fm.tags.map(t => `  - ${t}`).join('\n')}\n---\n\n`;
  const body = blocks.map(b => `# ${b.role === 'user' ? 'User' : 'Assistant'}\n\n${b.text}`).join('\n\n---\n\n');
  return yml + body + '\n';
}

async function run() {
  const cfg = loadConfig();
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  if (!fs.existsSync(SESSION_PATH)) { console.error('请先运行 tools/save-auth.js 登录'); process.exit(1); }

  let browser, ctx, pg;
  let msgResolve = null, msgBody = null;

  const launchBrowser = async () => {
    if (browser) { try { await browser.close().catch(() => {}); } catch {} }
    browser = await chromium.launch({
      headless: true, executablePath: '/snap/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  };
  await launchBrowser();

  function setupInterceptors(c) {
    c.on('response', async r => {
      try {
        if (r.url().includes('/conversation/messages')) {
          msgBody = await r.text();
          if (msgResolve) { msgResolve(); msgResolve = null; }
        }
      } catch {}
    });
  }

  async function newPage() {
    if (pg) { try { pg.close().catch(() => {}); } catch {} }
    pg = await ctx.newPage();
    pg.on('crash', () => {});
    return pg;
  }

  const waitMsg = (t = cfg.requestTimeoutMs) => new Promise(res => {
    msgBody = null; msgResolve = res;
    setTimeout(() => { if (msgResolve) { msgResolve(); msgResolve = null; } }, t);
  });

  const ensurePage = async () => {
    try { await pg.evaluate(() => 1); return true; }
    catch { await newPage(); return false; }
  };

  const goHome = async () => {
    try {
      await pg.goto('https://chatglm.cn', { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      return false;
    }
    await pg.waitForTimeout(3000);
    const count = await pg.locator('.history-item').count().catch(() => 0);
    return count > 0;
  };

  const navigateToConversation = async (cid) => {
    // Use Vue Router to navigate directly (no DOM click needed)
    await pg.evaluate((cid) => {
      const root = document.querySelector('#app');
      const vue = root?.__vue_app__;
      if (vue?.config?.globalProperties?.$router) {
        vue.config.globalProperties.$router.push({ path: '/alltoolsdetail', query: { cid } });
      }
    }, cid);
  };

  // -- Create initial context --
  const ss = JSON.parse(fs.readFileSync(SESSION_PATH));
  const initContext = async () => {
    if (ctx) { try { ctx.close().catch(() => {}); } catch {} }
    msgResolve = null; msgBody = null;
    try {
      ctx = await browser.newContext({ storageState: ss, viewport: { width: 1280, height: 900 } });
    } catch {
      // Browser crashed — restart it
      await launchBrowser();
      ctx = await browser.newContext({ storageState: ss, viewport: { width: 1280, height: 900 } });
    }
    setupInterceptors(ctx);
    await newPage();
  };
  await initContext();

  // === Step 1: Load or create conversation index ===
  let convs;
  if (fs.existsSync(CONVERSATIONS_PATH)) {
    convs = JSON.parse(fs.readFileSync(CONVERSATIONS_PATH));
    const left = convs.filter(c => !c.done).length;
    console.log(`已有进度: ${convs.length - left}/${convs.length}`);
    if (left === 0) { console.log('全部完成!'); await browser.close(); return; }
    for (const c of convs) { if (c.strikes === undefined) c.strikes = 0; }
  } else {
    console.log('获取全部对话列表...');
    // Same as before: scroll load all conversations
    if (!(await goHome())) { console.error('无法加载主页'); await browser.close(); return; }

    const allConvs = [];
    let recentListQueue = [], recentListResolve = null;
    ctx.on('response', async r => {
      try {
        if (r.url().includes('recent_list') && r.request().method() === 'POST') {
          const data = JSON.parse(await r.text());
          if (recentListResolve) { recentListResolve(data); recentListResolve = null; }
          else { recentListQueue.push(data); }
        }
      } catch {}
    });
    const nextRecentList = () => new Promise(resolve => {
      if (recentListQueue.length > 0) { resolve(recentListQueue.shift()); return; }
      recentListResolve = resolve;
      setTimeout(() => { if (recentListResolve) { recentListResolve(null); recentListResolve = null; } }, 15000);
    });

    let data = await nextRecentList();
    if (!data?.result?.conversation_list) { console.error('获取对话列表失败'); await browser.close(); return; }
    allConvs.push(...data.result.conversation_list);
    console.log(`  第 1 页: ${data.result.conversation_list.length} 条`);

    let pn = 1;
    while (data?.result?.has_more) {
      pn++;
      await pg.evaluate(() => { const el = document.querySelector('.subjects.limitation'); if (el) el.scrollTop = el.scrollHeight; }).catch(() => {});
      data = await nextRecentList();
      if (!data?.result?.conversation_list) break;
      allConvs.push(...data.result.conversation_list);
      console.log(`  第 ${pn} 页: ${data.result.conversation_list.length} 条 (累计 ${allConvs.length} 条)`);
    }

    convs = allConvs.map(c => ({
      conversation_id: c.conversation_id, title: c.title,
      history_total: c.history_total, update_time: c.update_time,
      assistant_id: c.assistant_id,
      created_at: new Date().toISOString(), strikes: 0, done: false
    }));
    fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convs, null, 2));
    console.log(`共 ${convs.length} 条对话`);
  }

  // === Step 2: Export loop ===
  const pending = convs.filter(c => !c.done);
  console.log(`开始导出 ${pending.length} 条...`);
  let exportCount = 0;
  let lastHome = false;

  for (const conv of pending) {
    const doneCount = convs.filter(c => c.done).length;
    const title = conv.title || conv.conversation_id;
    console.log(`\n[${doneCount + 1}/${convs.length}] ${title.slice(0, 60)}`);

    try {
      exportCount++;
      if (exportCount % 10 === 0) {
        console.log('  周期性重启浏览器上下文...');
        await initContext();
        lastHome = false;
      }

      // Ensure we're on the main page before navigating
      if (!lastHome) {
        let homeOk = false;
        for (let h = 0; h < 3; h++) {
          if (await goHome()) { homeOk = true; break; }
          await ensurePage();
          await pg.waitForTimeout(1000);
        }
        if (!homeOk) { console.log('  → 无法加载主页'); break; }
        lastHome = true;
      }

      // Retry with Vue Router navigation
      let exported = false;
      for (let retry = 0; retry < 3 && !exported; retry++) {
        if (retry > 0) {
          console.log(`  重试 ${retry}/2...`);
          await newPage();
          lastHome = false;
          if (!(await goHome())) break;
          lastHome = true;
        }

        await navigateToConversation(conv.conversation_id).catch(() => {});

        const start = Date.now();
        await waitMsg();
        const elapsed = Date.now() - start;

        if (!msgBody) {
          conv.strikes = (conv.strikes || 0) + 1;
          console.log(`  → 超时 (${Math.round(elapsed / 1000)}s，第 ${conv.strikes} 次失败)`);
          if (conv.strikes >= 3) {
            console.log('  → 超过 3 次失败，跳过');
            conv.done = true; conv.error = 'timeout x3';
            fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convs, null, 2));
            exported = true;
          }
          lastHome = false;
          continue;
        }

        let data;
        try { data = JSON.parse(msgBody); } catch (e) {
          console.log(`  → 解析失败: ${e.message.slice(0, 60)}`);
          lastHome = false;
          continue;
        }

        const msgs = data.result?.messages || [];
        if (msgs.length === 0) {
          console.log('  → 空对话或 API 错误');
          conv.done = true; conv.exported_at = new Date().toISOString();
          fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convs, null, 2));
          exported = true;
          lastHome = false;
          continue;
        }

        const md = toMarkdown(msgs, title);
        const fpath = path.join(cfg.outputDir, safeName(title) + '.md');
        fs.writeFileSync(fpath, md);
        console.log(`  → ${msgs.length} 条消息 (${(msgBody.length / 1024).toFixed(0)}KB, ${Math.round(elapsed / 1000)}s) → ${path.basename(fpath)}`);

        conv.done = true; conv.exported_at = new Date().toISOString();
        conv.file = path.basename(fpath); conv.strikes = 0; delete conv.error;
        fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convs, null, 2));
        exported = true;
        lastHome = false;
      }

      if (!exported) {
        conv.strikes = (conv.strikes || 0) + 1;
        conv.error = conv.error || 'exhausted';
        if (conv.strikes >= 3) { console.log('  → 重试耗尽，跳过'); conv.done = true; }
        fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convs, null, 2));
      }

    } catch (e) {
      console.log(`  → 意外错误: ${e.message.slice(0, 80)}`);
      // If browser died, restart it
      if (e.message.includes('browser has been closed') || e.message.includes('Target closed')) {
        await launchBrowser();
        await initContext();
        lastHome = false;
      }
      conv.strikes = (conv.strikes || 0) + 1;
      conv.error = e.message.slice(0, 100);
      if (conv.strikes >= 3) { conv.done = true; }
      fs.writeFileSync(CONVERSATIONS_PATH, JSON.stringify(convs, null, 2));
      lastHome = false;
    }
  }

  await browser.close();
  const d = convs.filter(c => c.done).length;
  const t = convs.length;
  if (d === t) console.log(`\n全部完成! 共 ${t} 条`);
  else console.log(`\n已完成 ${d}/${t}，重跑继续剩余 ${t - d} 条`);
}

run().catch(e => { console.error('失败:', e.message); process.exit(1); });
