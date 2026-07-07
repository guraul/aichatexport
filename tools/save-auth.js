import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const AUTH_FILE = 'chatglm-auth.json';

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto('https://chatglm.cn');

console.log('请手动登录 chatglm.cn（在打开的浏览器窗口中完成登录）');
console.log('登录完成后，按 Enter 键继续...');

await new Promise(resolve => process.stdin.once('data', resolve));

const storageState = await context.storageState();
writeFileSync(AUTH_FILE, JSON.stringify(storageState, null, 2));
console.log(`Auth state saved to ${AUTH_FILE}`);

await browser.close();
