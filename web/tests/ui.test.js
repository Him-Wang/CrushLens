/* ============================================================
 * UI 回归测试（Node 直接跑：node tests/ui.test.js）
 * 验证两项交互修复：
 *  1. 登录页不再出现主题选择（删除重复的下拉 + 悬浮按钮在登录页隐藏）
 *  2. 右下角悬浮按钮点击即循环切换主题，不再弹出下拉面板
 * 用真实 index.html / app.js / theme.js 源码，不做玩具重实现。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n' + t); }
const readWeb = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const readAsset = (f) => fs.readFileSync(path.join(__dirname, '..', 'assets', f), 'utf8');

(async () => {
  const html = readWeb('index.html');
  const app = readAsset('app.js');

  section('1. 登录页不出现主题选择');
  // 登录外壳 #auth ... 到主应用 #app 之前的那段 HTML
  const authStart = html.indexOf('id="auth"');
  const appStart = html.indexOf('id="app"');
  const authSection = html.slice(authStart, appStart);
  ok(authSection.indexOf('data-theme-select') < 0, '登录外壳内没有 data-theme-select 下拉');
  ok(authSection.indexOf('theme-row') < 0, '登录外壳内没有 theme-row 主题行');
  ok(html.indexOf('themePanel') < 0 && html.indexOf('tpDots') < 0, '整页已删除下拉主题面板元素');
  ok(/id="themeFab"[^>]*\shidden/.test(html), '悬浮按钮初始为 hidden（登录页不显示）');

  section('2. 悬浮按钮点击循环切换主题');
  ok(app.indexOf('function wireThemeFab') >= 0, 'app.js 定义了 wireThemeFab（点击切换，非下拉）');
  ok(app.indexOf('wireThemePanel') < 0, '旧的 wireThemePanel 下拉实现已移除');
  ok(app.indexOf("fab.onclick = cycle") >= 0, '悬浮按钮绑定了 cycle 点击处理');
  // 五个主题按顺序循环
  const cycleMatch = app.match(/THEME_CYCLE\s*=\s*\[([^\]]+)\]/);
  ok(!!cycleMatch && (cycleMatch[1].match(/'[^']+'/g) || []).length === 5, '定义了 5 个主题的循环顺序');
  ok(!!cycleMatch && /rose/.test(cycleMatch[1]) && /night/.test(cycleMatch[1]), '循环包含玫瑰与夜间');
  ok(/CLTheme\.apply\(next\)/.test(app), '点击后真正调用 CLTheme.apply 切换主题');
  // 登录页隐藏 / 进入应用显示
  ok(/function showAuth\(\)[\s\S]{0,120}fab\.hidden = true/.test(app), 'showAuth 时隐藏悬浮按钮');
  ok(/async function enter\(acc\)[\s\S]{0,180}fab\.hidden = false/.test(app), '进入应用时显示悬浮按钮');

  section('3. CLTheme 主题切换真实生效（theme.js）');
  const ls = new Map();
  globalThis.localStorage = {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k)
  };
  const attr = {};
  globalThis.document = {
    documentElement: { setAttribute: (k, v) => { attr[k] = v; } },
    querySelector: () => null,
    createElement: () => ({ setAttribute() {} }),
    head: { appendChild() {} }
  };
  const styleStub = { getPropertyValue: () => '#ffffff' };
  globalThis.getComputedStyle = () => styleStub;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.window = globalThis;
  new Function('window', readAsset('theme.js'))(globalThis);
  const T = globalThis.CLTheme;
  T.apply('mist');
  ok(attr['data-theme'] === 'mist', 'apply(mist) 把 data-theme 设为 mist');
  T.apply('night');
  ok(attr['data-theme'] === 'night', 'apply(night) 把 data-theme 设为 night');
  T.apply('system');
  ok(attr['data-theme'] === 'rose', 'apply(system) 回到跟随系统的浅色（rose）');

  console.log('\n────────────────────────────────────────────');
  console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
