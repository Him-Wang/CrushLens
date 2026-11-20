#!/usr/bin/env node
/**
 * stamp-assets.mjs —— 把 web/*.html 里 assets/xxx?v=yyy 的版本号换成资源内容哈希。
 *
 * 为什么需要它：
 *   GitHub Pages 对 assets/ 下的静态资源返回 Cache-Control: max-age=600，
 *   浏览器和 Fastly 都会按完整 URL 缓存。改资源内容却没改 URL 上的 ?v=，
 *   用户就会继续用旧文件——「明明部署了却看不到新 UI」基本都是这个原因。
 *   手写版本号（例如都写成当天日期 20261120）只能骗过一次：
 *   当天再改一次资源就又撞车了。
 *
 * 做法：取文件内容的 sha256 前 8 位做版本号。
 *   内容不变 → URL 不变 → 缓存继续命中（快）。
 *   内容一改 → URL 跟着变 → 必然重新拉取（新）。
 *   全程无需人工维护，可重复执行且结果幂等。
 *
 * 用法：
 *   node tools/stamp-assets.mjs          写入（自动更新所有 HTML）
 *   node tools/stamp-assets.mjs --check  只校验，不一致就退出码 1（给 CI 用）
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const CHECK = process.argv.includes('--check');

/** 资源引用：assets/<文件名>.<扩展名>?v=<token> */
const REF = /(assets\/[A-Za-z0-9._-]+\.(?:js|css))\?v=([A-Za-z0-9._-]+)/g;

/** 计算文件的短哈希；文件不存在返回 null（由调用方报错，不要静默跳过） */
function stampOf(relPath) {
  try {
    return createHash('sha256').update(readFileSync(join(WEB, relPath))).digest('hex').slice(0, 8);
  } catch {
    return null;
  }
}

const htmlFiles = readdirSync(WEB).filter(f => f.endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error('✗ web/ 下没有找到任何 .html 文件');
  process.exit(1);
}

let changed = 0;
const problems = [];

for (const file of htmlFiles) {
  const full = join(WEB, file);
  const before = readFileSync(full, 'utf8');
  const missing = [];

  const after = before.replace(REF, (whole, relPath, curToken) => {
    const want = stampOf(relPath);
    if (want === null) {
      missing.push(relPath);
      return whole;
    }
    if (want === curToken) return whole;
    changed++;
    return `${relPath}?v=${want}`;
  });

  for (const m of missing) {
    problems.push(`${file}: 引用了不存在的资源 ${m}`);
  }

  if (after !== before && !CHECK) {
    writeFileSync(full, after);
    console.log(`✓ 已更新 web/${file}`);
  } else if (after !== before && CHECK) {
    problems.push(`web/${file}: 版本号与资源内容不一致`);
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(
    CHECK
      ? '\n请运行 node tools/stamp-assets.mjs 后提交改动。'
      : '\n有无法修复的问题，见上。'
  );
  process.exit(1);
}

console.log(
  CHECK
    ? `✓ 版本号全部与资源内容一致（检查了 ${htmlFiles.length} 个 HTML）`
    : changed
      ? `✓ 完成：更新了 ${changed} 处资源引用`
      : '✓ 无需改动：版本号已是最新'
);
