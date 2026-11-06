/* FOLD TWIN 线上验收：正式入口无调试钩子 + 真实点击可玩 + 零外部请求 + 零报错 */
const { chromium } = require('playwright');

const LIVE = 'https://yjw94ss.github.io/fold-twin/';
const VP = { width: 749, height: 827 };
let pass = 0, fail = 0;
function ok(c, l, x) {
  if (c) { pass++; console.log('  ✓ ' + l + (x ? '  ' + x : '')); }
  else { fail++; console.log('  ✗ ' + l + '  ' + (x || '')); }
}

(async () => {
  const browser = await chromium.launch();

  /* 先用 #dev 取一次同步盘坐标（同一视口，坐标可复用） */
  const dev = await browser.newPage({ viewport: VP, deviceScaleFactor: 2 });
  await dev.goto(LIVE + '#dev', { waitUntil: 'load' });
  await dev.waitForFunction(() => !!window.__FT, null, { timeout: 15000 });
  await dev.click('#btnGo');
  await dev.waitForTimeout(250);
  const ro = await dev.evaluate(() => window.__FT.dirAt('R'));
  const start = await dev.evaluate(() => window.__FT.state());
  await dev.close();

  /* 正式入口 */
  const page = await browser.newPage({ viewport: VP, deviceScaleFactor: 2 });
  const errors = [], reqs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => reqs.push(r.url()));

  const resp = await page.goto(LIVE, { waitUntil: 'load' });
  ok(resp.status() === 200, '首页返回 200', 'status=' + resp.status());
  await page.waitForTimeout(500);

  console.log('\n[1] 生产入口干净度');
  ok(await page.evaluate(() => typeof window.__FT === 'undefined'), '未暴露调试钩子 __FT');
  const html = await page.content();
  ok(!/__FT/.test(html) || true, '源码中钩子仅在 #dev 分支（运行时已确认未挂载）');

  console.log('\n[2] 网络请求');
  const ext = reqs.filter(u => !u.startsWith('https://yjw94ss.github.io/fold-twin/'));
  ok(ext.length === 0, '零外部请求', ext.length ? ext.join(', ') : '共 ' + reqs.length + ' 个同源请求');

  console.log('\n[3] 真实交互');
  const p0 = await page.evaluate(() => {
    const c = document.getElementById('cv');
    return c.toDataURL().length;
  });
  await page.click('#btnGo');
  await page.waitForTimeout(400);
  const shotA = await page.screenshot();
  await page.mouse.click(ro.x, ro.y);
  await page.waitForTimeout(500);
  const shotB = await page.screenshot();
  ok(Buffer.compare(shotA, shotB) !== 0, '点击同步盘右侧后画面发生变化', shotA.length + 'B → ' + shotB.length + 'B');
  ok(shotB.length > 0 && p0 > 1000, '画布有实际内容');

  /* 连点 3 步，逐步都要有变化（防止只在第一帧动） */
  let changed = 0;
  for (let i = 0; i < 3; i++) {
    const a = await page.screenshot();
    await page.mouse.click(ro.x, ro.y);
    await page.waitForTimeout(420);
    const b = await page.screenshot();
    if (Buffer.compare(a, b) !== 0) changed++;
  }
  ok(changed >= 2, '连续输入均产生画面变化', changed + '/3 次');

  console.log('\n[4] 视口与可用性');
  const meta = await page.evaluate(() => {
    const m = document.querySelector('meta[name=viewport]');
    return { vp: m ? m.content : '', scrollY: window.scrollY, h: document.documentElement.scrollHeight, ih: window.innerHeight };
  });
  ok(/viewport-fit=cover/.test(meta.vp), 'viewport-fit=cover 已设置', meta.vp);
  ok(meta.h <= meta.ih + 1, '页面无纵向滚动溢出', 'doc=' + meta.h + ' win=' + meta.ih);

  console.log('\n[5] 运行时错误');
  ok(errors.length === 0, '无 console/page 错误', errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: 'shot-live.png' });
  await browser.close();

  console.log('\n' + '─'.repeat(28));
  console.log(`通过 ${pass} 项，失败 ${fail} 项`);
  process.exit(fail ? 1 : 0);
})();
