/**
 * engine.js 白盒测试（零依赖，Node 直接跑：node tests/engine.test.js）
 * 覆盖：daily 长度 / 单调性 / 去重、缺口不产生伪转折、mean([])、
 *      五类解析输入、单条消息不给预测。
 */
const fs = require('fs');
const path = require('path');
const E = require('../assets/engine.js');

let pass = 0, fail = 0;
const fails = [];

function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(actual, expected, name) {
  ok(actual === expected, name, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function section(t) { console.log('\n' + t); }

/* ---------------- 1. 真实样例：daily 完整性 ---------------- */
section('1. daily 序列完整性（示例聊天.txt）');
const samplePath = path.join(__dirname, '..', '..', '示例聊天.txt');
if (fs.existsSync(samplePath)) {
  const parsed = E.parseChat(fs.readFileSync(samplePath, 'utf8'), '示例聊天.txt');
  const a = E.analyze(parsed.messages, { me: parsed.speakers[0] });
  eq(a.daily.length, a.spanDays, 'daily.length === spanDays');
  const dates = a.daily.map((d) => d.date);
  eq(new Set(dates).size, dates.length, '无重复日期');
  let monotonic = true;
  for (let i = 1; i < dates.length; i++) if (dates[i] <= dates[i - 1]) monotonic = false;
  ok(monotonic, '日期严格单调递增');
  ok(a.ma.length === a.daily.length, 'ma 与 daily 等长（下标对齐）');
  const bad = a.changePoints.filter((p) => Math.abs(p.diff) > 30);
  ok(bad.length === 0, '真实样例不产生 |diff| > 30 的断崖转折',
    bad.map((p) => p.date + ':' + p.diff).join(', '));
  // 转折点必须落在真实观测日
  ok(a.changePoints.every((p) => {
    const d = a.daily.find((x) => x.date === p.date);
    return d && d.active;
  }), '转折点均落在真实观测日（非缺口 / 插值）');
} else {
  console.log('  ! 跳过：仓库根目录没有 示例聊天.txt');
}

/* ---------------- 2. 缺口样本：不产生伪转折 ---------------- */
section('2. 5 天缺口样本');
function mk(dayOffset, hh, text, who) {
  const d = new Date(2026, 8, 1 + dayOffset, hh, 0);
  const p = (n) => String(n).padStart(2, '0');
  return { speaker: who, time: d, text, ts: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` };
}
// 第 1–5 天热聊，第 6–10 天完全空白，第 11–15 天继续热聊
const gapMsgs = [];
for (let i = 0; i < 5; i++) {
  gapMsgs.push(mk(i, 10, '在的，今天想你了，晚上一起吃饭吧', '我'));
  gapMsgs.push(mk(i, 10, '好呀好呀，我也正想说这个，几点见', '她'));
}
for (let i = 10; i < 15; i++) {
  gapMsgs.push(mk(i, 10, '在的，今天想你了，晚上一起吃饭吧', '我'));
  gapMsgs.push(mk(i, 10, '好呀好呀，我也正想说这个，几点见', '她'));
}
const gapA = E.analyze(gapMsgs, { me: '我' });
eq(gapA.daily.length, gapA.spanDays, '缺口样本 daily.length === spanDays');
eq(gapA.daily.length, 15, '缺口样本覆盖 15 天');
ok(gapA.changePoints.every((p) => Math.abs(p.diff) <= 30),
  '缺口样本不产生 |diff| > 30 的伪断崖',
  gapA.changePoints.map((p) => p.date + ':' + p.diff).join(', '));
ok(gapA.changePoints.every((p) => {
  const d = gapA.daily.find((x) => x.date === p.date);
  return d && d.active;
}), '缺口样本转折点不在缺口日');

/* ---------------- 3. mean([]) ---------------- */
section('3. 聚合函数契约');
eq(E.mean([]), null, 'mean([]) === null');
eq(E.mean([2, 4]), 3, 'mean([2,4]) === 3');

/* ---------------- 4. 多格式解析 ---------------- */
section('4. parseChat 多格式');
const wechat = [
  '林晚', '2026年10月1日 21:14', '在吗', '',
  '我', '2026年10月1日 21:15', '在的，怎么啦', ''
].join('\n');
const r1 = E.parseChat(wechat, 'a.txt');
eq(r1.platform, 'wechat', '微信电脑版导出 → wechat');
eq(r1.messages.length, 2, '微信电脑版导出 2 条');

const qq = [
  '2026-10-01 21:14:30 林晚(10001)', '在吗',
  '2026-10-01 21:15:00 我(10002)', '在的'
].join('\n');
const r2 = E.parseChat(qq, 'b.txt');
eq(r2.platform, 'qq', 'QQ 导出 → qq');
eq(r2.messages.length, 2, 'QQ 导出 2 条');

const json = JSON.stringify([
  { speaker: '林晚', time: '2026-10-01 21:14', text: '在吗' },
  { speaker: '我', time: '2026-10-01 21:15', text: '在的' }
]);
const r3 = E.parseChat(json, 'c.json');
eq(r3.platform, 'json', 'JSON → json');
eq(r3.messages.length, 2, 'JSON 2 条');

// 手机「合并转发」：名字 + 纯时分
const fwd = ['林晚', '21:14', '在吗', '', '我', '21:15', '在的', '', '林晚', '21:16', '刚下班好累'].join('\n');
const r4 = E.parseChat(fwd, 'd.txt');
eq(r4.messages.length, 3, '手机合并转发 3 条');
eq(r4.platform, 'wechat', '手机合并转发识别为 wechat');

const r5 = E.parseChat('', 'e.txt');
eq(r5.messages.length, 0, '空文本 → 0 条');

const r6 = E.parseChat('§±Ø¶þ¡ï ÐÅÏ¢ !@#$%^&*()', 'f.txt');
ok(r6.messages.length >= 0, '乱码文本不抛异常');

/* ---------------- 5. 单条消息不给预测 ---------------- */
section('5. 样本门槛');
const one = E.analyze([mk(0, 21, '在吗', '我')], { me: '我' });
eq(one.forecast.length, 0, '单条消息 → forecast 为空');
eq(one.canForecast, false, '单条消息 → canForecast === false');
ok(one.narrative.paras.some((p) => p.indexOf('不足 3 天') >= 0), '单条消息 → 叙事明确说明样本不足');

const many = E.analyze(gapMsgs, { me: '我' });
eq(many.canForecast, true, '15 天样本 → canForecast === true');
eq(many.forecast.length, 7, '15 天样本 → 7 天预测');
ok(many.forecast.every((f) => f.lo <= f.score && f.score <= f.hi), '预测值落在置信区间内');

/* ---------------- 汇总 ---------------- */
console.log('\n' + '─'.repeat(52));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('失败项：\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('全部通过');
