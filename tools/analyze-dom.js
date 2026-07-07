import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const AUTH_FILE = 'chatglm-auth.json';

const storageState = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState });
const page = await context.newPage();

await page.goto('https://chatglm.cn');
console.log('已登录。请在浏览器中导航到一个对话页面。');
console.log('到达对话页面后，按 Enter 键开始 DOM 分析...');
await new Promise(resolve => process.stdin.once('data', resolve));

const url = page.url();
console.log(`当前 URL: ${url}`);

// Dump full page HTML for offline analysis
const html = await page.content();
writeFileSync('chatglm-page.html', html);
console.log('Page HTML saved to chatglm-page.html');

// Try to find message-like elements
const messageSelectorResults = await page.evaluate(() => {
  const results = [];

  // Look for elements with common message-related attributes
  const allElements = document.querySelectorAll('*');
  const candidates = [];

  for (const el of allElements) {
    const text = el.textContent.trim();
    if (text.length < 20) continue;

    const tag = el.tagName.toLowerCase();
    const cls = el.className?.toString() || '';
    const role = el.getAttribute('role') || '';
    const dataAttr = Object.values(el.dataset || {}).join(' ');

    // Look for elements that might represent messages
    if (role === 'message' || role === 'log' || role === 'listitem') {
      candidates.push({ tag, class: cls, role, textLength: text.length });
    }

    // Look for user/assistant mentions
    if (/(?:user|assistant|bot|ai|human|用户|助手|AI)/i.test(cls + ' ' + role)) {
      candidates.push({ tag, class: cls, role, textLength: text.length });
    }
  }

  return candidates;
});

console.log('\n=== Candidate message elements ===');
console.log(JSON.stringify(messageSelectorResults.slice(0, 30), null, 2));

// Look for common chat patterns
const structure = await page.evaluate(() => {
  const info = {
    url: window.location.href,
    title: document.title,
    selectors: {}
  };

  // Check common chat message selectors
  const patterns = [
    '[class*="message"]',
    '[class*="chat"]',
    '[class*="conversation"]',
    '[class*="msg"]',
    '[class*="dialog"]',
    '[class*="bubble"]',
    '[role="log"]',
    '[role="list"]',
    'main',
    'article'
  ];

  for (const sel of patterns) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      info.selectors[sel] = {
        count: els.length,
        sampleTag: els[0].tagName,
        sampleClass: els[0].className?.toString()?.slice(0, 100)
      };
    }
  }

  return info;
});

console.log('\n=== Page structure ===');
console.log(JSON.stringify(structure, null, 2));

// List all class names that might be relevant
const classes = await page.evaluate(() => {
  const all = new Set();
  document.querySelectorAll('*').forEach(el => {
    const cls = el.className?.toString() || '';
    if (typeof cls === 'string' && cls.length > 0) {
      cls.split(/\s+/).forEach(c => {
        if (/(?:chat|msg|message|user|assistant|bot|ai|bubble|dialog|conversation|role)/i.test(c)) {
          all.add(c);
        }
      });
    }
  });
  return [...all].sort();
});

console.log('\n=== Relevant CSS classes found on page ===');
console.log(classes.join('\n'));

await browser.close();
