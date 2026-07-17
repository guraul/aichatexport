import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

const AUTH_FILE = process.env.CHATGLM_AUTH || join(homedir(), '.config', 'chatglm_session.json');

try {
  mkdirSync(join(homedir(), '.config'), { recursive: true });
} catch { /* exists */ }

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://chatglm.cn');

console.log('='.repeat(50));
console.log('请在打开的浏览器窗口中登录 chatglm.cn');
console.log('支持：扫码登录 / 手机号验证码');
console.log('登录完成后，回到此终端按 Enter 键继续...');
console.log('='.repeat(50));

await new Promise(resolve => process.stdin.once('data', resolve));

const storageState = await context.storageState();
writeFileSync(AUTH_FILE, JSON.stringify(storageState, null, 2), 'utf-8');
console.log(`\n✓ 登录态已保存到: ${AUTH_FILE}`);

const cookies = storageState.cookies || [];
const hasToken = cookies.some(c => c.name === 'chatglm_refresh_token');
if (hasToken) {
  console.log('✓ chatglm_refresh_token 已捕获');
} else {
  console.log('⚠ 未找到 chatglm_refresh_token，请确认已成功登录');
}

await browser.close();
