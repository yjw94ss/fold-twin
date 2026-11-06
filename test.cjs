/* FOLD TWIN 真机验收：Chromium 驱动真实交互 + 逐关对照 Python 标准答案 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools/fixture.json'), 'utf8'));
const URL = 'file://' + path.resolve(__dirname, 'index.html') + '#dev';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + label + '  ' + (extra || '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 749, height: 827 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__FT, null, { timeout: 8000 });
  await page.waitForTimeout(350);

  /* ── 1. 首屏 ── */
  console.log('\n[1] 启动与首屏');
  const u0 = await page.evaluate(() => window.__FT.ui());
  ok(u0.veil === true, '开场遮罩可见');
  ok(/折/.test(u0.text), '标题存在', u0.text.slice(0, 16));
  const ink = await page.evaluate(() => {
    const c = document.getElementById('cv'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, warm = 0, cool = 0;
    for (let i = 0; i < d.length; i += 40) {
      if (d[i + 3] > 10) {
        n++;
        if (d[i] > d[i + 2] + 12) warm++;
        if (d[i + 2] > d[i] + 12) cool++;
      }
    }
    return { n, warm, cool };
  });
  ok(ink.n > 4000, '画布已绘制', '采样=' + ink.n);
  ok(ink.warm > 50 && ink.cool > 50, '两界色温同时存在', '暖=' + ink.warm + ' 冷=' + ink.cool);

  await page.click('#btnGo');
  await page.waitForTimeout(300);
  ok((await page.evaluate(() => window.__FT.ui().veil)) === false, '点开始后遮罩收起');

  /* ── 2. 同步盘真实点击 ── */
  console.log('\n[2] 同步盘：一次输入两界同动');
  await page.evaluate(() => window.__FT.level(0));
  await page.waitForTimeout(120);
  const before = await page.evaluate(() => window.__FT.state());
  const rp = await page.evaluate(() => window.__FT.dirAt('R'));
  await page.mouse.click(rp.x, rp.y);
  await page.waitForTimeout(320);
  const after = await page.evaluate(() => window.__FT.state());
  ok(after.a.x === before.a.x + 1, '上界角色右移一格', before.a.x + '→' + after.a.x);
  ok(after.b.x === before.b.x + 1, '下界角色同时右移一格', before.b.x + '→' + after.b.x);
  ok(after.steps === 1, '计为 1 步', 'steps=' + after.steps);

  /* ── 3. 滑动输入 ── */
  console.log('\n[3] 画面滑动');
  await page.evaluate(() => window.__FT.level(0));
  await page.waitForTimeout(100);
  const c0 = await page.evaluate(() => {
    const r = document.getElementById('cv').getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.18 };
  });
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  await page.mouse.move(c0.x + 90, c0.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(320);
  const sw = await page.evaluate(() => window.__FT.state());
  ok(sw.a.x === 1 && sw.b.x === 1, '右滑使两界各右移一格',
    'a.x=' + sw.a.x + ' b.x=' + sw.b.x);

  /* ── 4. 撞墙 / 一边受阻 / 踩空 ── */
  console.log('\n[4] 撞墙、单边受阻与踩空');
  // L1 是空场，出口在右侧；向上走不会过关，可以安全地制造受阻
  const oneBlocked = await page.evaluate(() => {
    window.__FT.level(0);
    const s0 = window.__FT.state();
    window.__FT.moveNow('U');       // 上界 (0,2)->(0,1) 能动；下界 (0,0) 已在上边界
    return { s0, s1: window.__FT.state() };
  });
  ok(oneBlocked.s1.steps === 1, '单边受阻仍算一步', 'steps=' + oneBlocked.s1.steps);
  ok(oneBlocked.s1.a.y === oneBlocked.s0.a.y - 1, '能走那侧正常移动',
    'a.y ' + oneBlocked.s0.a.y + '→' + oneBlocked.s1.a.y);
  ok(oneBlocked.s1.b.y === oneBlocked.s0.b.y, '受阻那侧原地不动',
    'b.y=' + oneBlocked.s1.b.y);

  const bothBlocked = await page.evaluate(() => {
    window.__FT.level(0);
    window.__FT.moveNow('U'); window.__FT.moveNow('U');   // 两侧都贴到上边界
    const s0 = window.__FT.state();
    window.__FT.moveNow('U');                             // 谁都走不动
    return { before: s0.steps, after: window.__FT.state().steps, a: s0.a, b: s0.b };
  });
  ok(bothBlocked.a.y === 0 && bothBlocked.b.y === 0, '两侧都已贴顶', 'a.y=' + bothBlocked.a.y);
  ok(bothBlocked.after === bothBlocked.before, '两边都撞墙时不空耗步数',
    bothBlocked.before + '→' + bothBlocked.after);

  const fall = await page.evaluate(() => {
    const L = window.__FT.levels();
    const dirs = ['U', 'D', 'L', 'R'];
    for (let li = 0; li < L.length; li++) {
      for (const pre of [null, 'U', 'D', 'L', 'R']) {
        for (const d2 of dirs) {
          window.__FT.level(li);
          let s1 = window.__FT.state();
          if (pre) { window.__FT.moveNow(pre); s1 = window.__FT.state(); if (s1.won) continue; }
          window.__FT.move(d2);
          const s2 = window.__FT.state();
          if (s2.fall) {
            return { li, seq: (pre ? [pre] : []).concat([d2]),
                     base: s1.steps, steps: s2.steps,
                     a: [s1.a.x, s1.a.y], a2: [s2.a.x, s2.a.y],
                     b: [s1.b.x, s1.b.y], b2: [s2.b.x, s2.b.y] };
          }
        }
      }
    }
    return null;
  });
  ok(!!fall, '存在可触发踩空的走法',
    fall ? '第 ' + (fall.li + 1) + ' 关 走 ' + fall.seq.join('') : '未找到');
  if (fall) {
    ok(fall.steps === fall.base + 1, '踩空计入步数', '+' + (fall.steps - fall.base));
    ok(fall.a.join() === fall.a2.join() && fall.b.join() === fall.b2.join(),
      '踩空后两侧都不移动', 'a=' + fall.a2.join(',') + ' b=' + fall.b2.join(','));
  }

  /* ── 6. 撤销 / 重来 ── */
  console.log('\n[5] 撤销与重来');
  await page.evaluate(() => window.__FT.level(3));
  await page.waitForTimeout(80);
  ok((await page.evaluate(() => window.__FT.ui().undoDisabled)) === true, '开局撤销禁用');
  const u1 = await page.evaluate(() => {
    const s0 = window.__FT.state();
    window.__FT.moveNow('D');
    const s1 = window.__FT.state();
    window.__FT.undo();
    const s2 = window.__FT.state();
    return { s0, s1, s2 };
  });
  ok(u1.s1.steps === 1 && u1.s2.steps === 0, '撤销回退步数', '1→' + u1.s2.steps);
  ok(u1.s2.a.x === u1.s0.a.x && u1.s2.b.y === u1.s0.b.y, '撤销回退坐标');

  /* ── 7. 反向关卡：同一指令，两边朝相反方向 ── */
  console.log('\n[6] 下界反向');
  const flipTest = await page.evaluate(() => {
    const L = window.__FT.levels();
    let found = 0, sample = null, total = 0;
    for (let li = 0; li < L.length; li++) {
      if (!L[li].flip) continue;
      total++;
      // 在反向关里找一个「按右时上界右移、下界左移」的起点
      for (const pre of [null, 'D', 'U', 'L', 'R']) {
        window.__FT.level(li);
        if (pre) window.__FT.moveNow(pre);
        const s0 = window.__FT.state();
        if (s0.won) continue;
        window.__FT.moveNow('R');
        const s1 = window.__FT.state();
        if (s1.a.x === s0.a.x + 1 && s1.b.x === s0.b.x - 1) {
          found++;
          if (!sample) sample = { li, pre, a: [s0.a.x, s1.a.x], b: [s0.b.x, s1.b.x] };
          break;
        }
      }
    }
    return { found, total, sample };
  });
  ok(flipTest.total === 4, '反向关卡共 4 关', '共=' + flipTest.total);
  ok(flipTest.found >= 1, '同一「右」指令使两界反向移动',
    flipTest.sample ? '第 ' + (flipTest.sample.li + 1) + ' 关 a.x ' + flipTest.sample.a.join('→') +
      '，b.x ' + flipTest.sample.b.join('→') : '未找到');
  ok(flipTest.found === flipTest.total, '每个反向关都能验出反向', '命中=' + flipTest.found + '/' + flipTest.total);

  /* ── 8. 18 关逐关通关 ── */
  console.log('\n[7] 18 关全通对照');
  let allGood = true;
  for (const f of FIX) {
    const r = await page.evaluate((f) => {
      window.__FT.level(f.i);
      const s = window.__FT.play(f.path.join(''));
      return { steps: s.steps, a: [s.a.x, s.a.y], b: [s.b.x, s.b.y], won: s.won };
    }, f);
    const good = r.won && r.steps === f.par &&
      r.a[0] === f.ea[0] && r.a[1] === f.ea[1] &&
      r.b[0] === f.eb[0] && r.b[1] === f.eb[1];
    if (!good) {
      allGood = false;
      console.log('    ✗ L' + (f.i + 1) + ' ' + JSON.stringify(r) +
        ' 期望 a=' + JSON.stringify(f.ea) + ' b=' + JSON.stringify(f.eb) + ' par=' + f.par);
    }
  }
  ok(allGood, '18 关全部按最优步数通关，落点与标准答案一致');

  /* ── 9. 存档与选关 ── */
  console.log('\n[8] 存档与选关');
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('foldtwin.v1') || '{}'));
  ok(save.unlocked === 18, '进度已存档', 'unlocked=' + save.unlocked);
  await page.evaluate(() => window.__FT.level(0));
  await page.evaluate(() => document.getElementById('btnList').click());
  await page.waitForTimeout(250);
  const list = await page.evaluate(() => ({
    cells: document.querySelectorAll('#list .grid .cell').length,
    lock: document.querySelectorAll('#list .grid .cell.lock').length
  }));
  ok(list.cells === 18, '选关 18 格', '格=' + list.cells);
  ok(list.lock === 0, '全通后无锁');
  await page.click('#bClose');
  await page.waitForTimeout(200);

  /* ── 10. 多视口 ── */
  console.log('\n[9] 多视口布局');
  const views = [[749, 827], [827, 749], [420, 900], [360, 640]];
  for (const [w, h] of views) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(280);
    await page.evaluate(() => window.__FT.level(16));
    await page.waitForTimeout(150);
    const lay = await page.evaluate(() => {
      const cv = document.getElementById('cv'), sr = cv.getBoundingClientRect();
      const deck = document.getElementById('deck').getBoundingClientRect();
      return {
        ow: document.documentElement.scrollWidth - window.innerWidth,
        oh: document.documentElement.scrollHeight - window.innerHeight,
        cw: Math.round(sr.width), ch: Math.round(sr.height),
        deckBottom: Math.round(deck.bottom), vh: window.innerHeight
      };
    });
    ok(lay.ow <= 1 && lay.oh <= 1 && lay.cw > 200 && lay.ch > 300 && lay.deckBottom <= lay.vh + 1,
      w + 'x' + h + ' 无溢出', '画布=' + lay.cw + 'x' + lay.ch + ' 底=' + lay.deckBottom + '/' + lay.vh);
    // 两块棋盘与同步盘都必须在画布内
    const fit = await page.evaluate(() => {
      const a = window.__FT.cellXY('a', 0, 0), b = window.__FT.cellXY('b', 0, 0);
      const st = window.__FT.state();
      const cv = document.getElementById('cv').getBoundingClientRect();
      const cs = a.cs;
      return {
        aTop: a.y - cs / 2 - (cv.top), bBot: b.y - cv.top + cs * (st.h - 1) + cs / 2,
        left: a.x - cv.left - cs / 2, right: cv.width - (a.x - cv.left - cs / 2 + cs * st.w),
        ch: cv.height
      };
    });
    ok(fit.aTop > 2 && fit.bBot < fit.ch - 2 && fit.left > 2 && fit.right > 2,
      '两界棋盘完整落在画布内',
      '上边距=' + Math.round(fit.aTop) + ' 下边距=' + Math.round(fit.ch - fit.bBot) +
      ' 左右=' + Math.round(fit.left) + '/' + Math.round(fit.right));
  }

  /* ── 11. 报错 ── */
  console.log('\n[10] 运行时错误');
  ok(errors.length === 0, '无 console/page 错误', errors.slice(0, 3).join(' | '));

  console.log('\n────────────────────────────');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(2); });
