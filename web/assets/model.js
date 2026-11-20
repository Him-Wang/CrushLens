/* ============================================================
 * CrushLens · 模型接入（T4）与 AI 建议（T5）
 * ------------------------------------------------------------
 * API key 策略：默认只在内存里；勾选「记住」才写进专用 localStorage
 * 键 CL_API_KEY_KEY。该键被排除在备份导出之外（备份只走 Store）。
 * 无 key 时整个应用退化成规则文案，绝不白屏。
 * ============================================================ */
(function (root) {
  'use strict';

  const KEY_BASE = 'cl_model_base';
  const KEY_MODEL = 'cl_model_id';
  const KEY_TEMP = 'cl_model_temp';
  const KEY_REMEMBER = 'cl_model_remember';
  const KEY_ALLOW_RAW = 'cl_model_allow_raw';
  const API_KEY_KEY = 'cl_api_key';           // 专用键，备份导出排除
  // 精确排除列表 + 前缀规则：绝不能把凭据写进可下载的备份。
  // 注意真实会话键是 crushlens_session_v1（store.js 的 SESSION_KEY），
  // 桥接 token 是 crushlens_bridge_token（app.js 的 bridgeTokenKey）；
  // 旧实现误写成 'cl_session'，导致两者都被导出。
  const BACKUP_EXCLUDE = [API_KEY_KEY, 'crushlens_session_v1', 'crushlens_bridge_token', (root.CLApi && root.CLApi.BASE_KEY) || 'cl_api_base'];
  function isBackupExcluded(k) {
    if (BACKUP_EXCLUDE.indexOf(k) >= 0) return true;
    // 兜底：任何会话 / 令牌 / token / key 类键一律不外泄
    return /session|token|^cl_api_key$|bridge/i.test(k);
  }

  const PRESETS = [
    { id: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'openai', label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'moonshot', label: 'Moonshot', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'glm', label: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { id: 'qwen', label: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { id: 'doubao', label: '豆包', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
    { id: 'baichuan', label: '百川', base: 'https://api.baichuan-ai.com/v1', model: 'Baichuan4' },
    { id: 'custom', label: '自定义', base: '', model: '' }
  ];

  // API key 默认只存内存；勾选记住才落 localStorage
  let memoryKey = '';
  function load() {
    const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
    const remembered = get(KEY_REMEMBER, '0') === '1';
    return {
      base: get(KEY_BASE, 'https://api.deepseek.com/v1'),
      model: get(KEY_MODEL, 'deepseek-chat'),
      temperature: parseFloat(get(KEY_TEMP, '0.7')) || 0,
      remember: remembered,
      key: remembered ? get(API_KEY_KEY, '') : memoryKey,
      allowRaw: get(KEY_ALLOW_RAW, '0') === '1'
    };
  }
  function save(cfg) {
    const set = (k, v) => { try { v ? localStorage.setItem(k, String(v)) : localStorage.removeItem(k); } catch (e) { } };
    set(KEY_BASE, cfg.base); set(KEY_MODEL, cfg.model); set(KEY_TEMP, cfg.temperature);
    set(KEY_REMEMBER, cfg.remember ? '1' : '0');
    set(KEY_ALLOW_RAW, cfg.allowRaw ? '1' : '0');
    if (cfg.remember) {
      memoryKey = String(cfg.key || '');
      set(API_KEY_KEY, memoryKey);
    } else {
      // 关闭「记住」立刻抹掉磁盘上的 key，只剩内存
      memoryKey = String(cfg.key || '');
      set(API_KEY_KEY, '');
    }
  }
  function hasKey() { return !!load().key; }
  function clearKey() {
    memoryKey = '';
    try { localStorage.removeItem(API_KEY_KEY); } catch (e) { }
  }
  // 导出时给 UI 用的安全 localStorage 快照（明确排除 key 与会话）
  function safeLocalSnapshot() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (isBackupExcluded(k)) continue;
        out[k] = localStorage.getItem(k);
      }
    } catch (e) { }
    return out;
  }

  function chatUrl(cfg) {
    return String(cfg.base || '').replace(/\/$/, '') + '/chat/completions';
  }

  // 测试连接：发一个 8-token 探针，返回延迟；失败带状态码与原因
  async function testConnection(cfg, signal) {
    if (!cfg.key) throw new Error('还没有填 API key');
    const t0 = performance.now();
    const resp = await fetch(chatUrl(cfg), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 8, temperature: 0 }),
      signal
    });
    const ms = Math.round(performance.now() - t0);
    let data = null;
    try { data = await resp.json(); } catch (e) { }
    if (!resp.ok) {
      const msg = (data && data.error && (data.error.message || data.error.type)) || resp.statusText || '未知错误';
      const err = new Error('HTTP ' + resp.status + '：' + msg);
      err.status = resp.status; err.latency = ms;
      throw err;
    }
    return { ok: true, latency: ms, reply: data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content };
  }

  /* ---------------- T5：结构化摘要（原文默认不外发） ----------------
     ctx = { score, dims:{}, momentum, turningPoints:[], lastTurns:[{speaker,text}] }
     allowRaw=false 时 lastTurns 只给出「轮数 / 角色分布 / 长度分布」，
     请求体里零逐字聊天内容。 */
  function buildContext(ctx, allowRaw) {
    const dims = ctx.dims || {};
    const turns = ctx.lastTurns || [];
    const meCount = turns.filter((t) => t.isMe).length;
    const summary = {
      score: Math.round(ctx.score || 0),
      dimensions: dims,
      momentum: Number((ctx.momentum || 0).toFixed(2)),
      turningPoints: (ctx.turningPoints || []).map((p) => ({ date: p.date, delta: Number((p.delta || 0).toFixed(1)) })),
      lastTurns: {
        count: turns.length,
        fromMe: meCount,
        fromOther: turns.length - meCount,
        avgLength: turns.length ? Math.round(turns.reduce((s, t) => s + String(t.text || '').length, 0) / turns.length) : 0
      },
      note: '以上为本地计算的结构化摘要；聊天原文默认未外发。'
    };
    if (allowRaw) {
      summary.lastTurns.raw = turns.slice(-10).map((t) => ({ speaker: t.isMe ? '我' : (t.speaker || '对方'), text: String(t.text || '').slice(0, 200) }));
      summary.note = '用户已授权 AI 读取最近 10 条原文。';
    }
    return summary;
  }

  const TEMPLATES = [
    { id: 'why', label: '为什么最近会这样？', q: '结合这份结构化摘要，解释最近浓度变化最可能的 2-3 个原因，语气克制、不臆断。' },
    { id: 'next', label: '接下来一周我该注意什么？', q: '基于六维结构和转折点，给出接下来一周可执行的 3 条建议，具体到行为，不做关系判决。' },
    { id: 'risk', label: '有没有被我忽略的信号？', q: '指出摘要里可能被忽略的 1-2 个信号（如回应变慢、主动性下降），每条给出可观察的佐证维度。' }
  ];

  // SSE 流式请求：逐块回调 onToken；返回完整文本
  async function streamChat(cfg, messages, onToken, signal) {
    if (!cfg.key) throw new Error('还没有配置 API key');
    const resp = await fetch(chatUrl(cfg), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model, messages, temperature: cfg.temperature, stream: true }),
      signal
    });
    if (!resp.ok) {
      let data = null; try { data = await resp.json(); } catch (e) { }
      const err = new Error('HTTP ' + resp.status + '：' + ((data && data.error && data.error.message) || resp.statusText));
      err.status = resp.status; throw err;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (delta) { full += delta; if (onToken) onToken(delta, full); }
        } catch (e) { /* 忽略半包 */ }
      }
    }
    return full;
  }

  root.Model = {
    PRESETS, API_KEY_KEY, load, save, hasKey, clearKey, safeLocalSnapshot,
    testConnection, buildContext, TEMPLATES, streamChat
  };
})(window);
