/* ============================================================
 * CrushLens Cloud · 用户端
 * ============================================================ */
(function (root) {
  'use strict';
  const { $, $$, esc, icon, toast, modal, confirmDlg, trendChart, sparkline,
    gauge, radar, donut, bars, avatar, empty, fmtDate, fmtDateFull, fmtDT,
    relTime, fmtNum, chipTrend, scoreClass, el, sideDrawer, cssVar, avatarPair,
    wireTheme, wireThemeSelects } = UI;
  const S = Store, E = CLEngine, Api = root.CLApi, M = root.Model;

  // 草稿：注册/导入过程中切到演示再回来，草稿不丢（T3 验收）
  const draft = { email: '', name: '', pass: '' };

  const MEDIA_RE = /\[(图片|表情|语音|视频|文件|动画表情|链接|位置|红包|转账|名片|聊天记录|小程序|视频号|音乐|拍一拍)\]/g;

  // 登录页也要跟随主题（含系统深色的实时切换），登录页的主题下拉在这里就接上
  if (window.CLTheme) { CLTheme.init(); wireThemeSelects(); }

  const state = {
    me: null, role: null, partners: [], pid: null,
    view: 'overview', range: 30, timer: null, lastRt: null, parsed: null,
    importingPid: null,
    bridge: {
      ok: false, needPair: false, info: null, error: null, contactsErr: null,
      apps: [], contacts: [], inboxOnly: true,
      links: {}, auto: false, q: '', sort: 'recent', busy: false, scanning: false
    }
  };

  /* ================= 主题悬浮按钮：点击循环切换（T7.2） ================= */
  const THEME_CYCLE = ['rose', 'mist', 'matcha', 'dusk', 'night'];
  const THEME_META = {
    rose: { label: '玫瑰', color: '#e11d48' },
    mist: { label: '雾蓝', color: '#2563eb' },
    matcha: { label: '抹茶', color: '#059669' },
    dusk: { label: '黄昏', color: '#ea580c' },
    night: { label: '夜间', color: '#1e293b' }
  };

  // 点一下换一个主题色，不再弹出下拉面板
  function wireThemeFab() {
    const fab = $('#themeFab');
    if (!fab) return;
    const dot = fab.querySelector('.fab-dot');
    const paint = () => {
      const cur = CLTheme.current();
      const meta = THEME_META[cur] || THEME_META.rose;
      if (dot) dot.style.background = meta.color;
      fab.title = '主题：' + meta.label + '（点击切换）';
      fab.setAttribute('aria-label', fab.title);
    };
    const cycle = () => {
      const i = THEME_CYCLE.indexOf(CLTheme.current());
      const next = THEME_CYCLE[(i + 1) % THEME_CYCLE.length];
      CLTheme.apply(next);
      toast('主题：' + THEME_META[next].label);
      paint();
    };
    fab.onclick = cycle;
    fab.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } };
    CLTheme.onChange(paint);
    paint();
  }

  // 昼夜滑块：左=浅色(rose) 中=跟随系统 右=深色(night)，拖动即时生效并持久化
  function syncDayNight() {
    const d = $('#daynight'); if (!d) return;
    const manual = CLTheme.isManual(), cur = CLTheme.current();
    const pos = !manual ? 1 : (cur === 'night' ? 2 : 0);
    d.dataset.pos = String(pos);
    d.setAttribute('aria-valuenow', String(pos));
    $('#dnLabel').textContent = !manual ? '跟随系统' : (cur === 'night' ? '深色' : '浅色');
  }
  function wireDayNight() {
    const d = $('#daynight'); if (!d || d.dataset.bound) return;
    d.dataset.bound = '1';
    let dragging = false;
    const applyX = (clientX) => {
      const r = d.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const pos = ratio < 0.33 ? 0 : ratio > 0.67 ? 2 : 1;
      d.dataset.pos = String(pos);
      d.setAttribute('aria-valuenow', String(pos));
      $('#dnLabel').textContent = pos === 1 ? '跟随系统' : (pos === 2 ? '深色' : '浅色');
      if (pos === 1) CLTheme.apply('system');
      else CLTheme.apply(pos === 2 ? 'night' : 'rose');
    };
    d.addEventListener('pointerdown', (e) => { dragging = true; d.setPointerCapture(e.pointerId); applyX(e.clientX); });
    d.addEventListener('pointermove', (e) => { if (dragging) applyX(e.clientX); });
    d.addEventListener('pointerup', () => { dragging = false; });
    d.addEventListener('keydown', (e) => {
      let pos = +d.dataset.pos;
      if (e.key === 'ArrowLeft') pos = Math.max(0, pos - 1);
      else if (e.key === 'ArrowRight') pos = Math.min(2, pos + 1);
      else if (e.key === 'Enter' || e.key === ' ') pos = (pos + 1) % 3;
      else return;
      e.preventDefault();
      d.dataset.pos = String(pos);
      $('#dnLabel').textContent = pos === 1 ? '跟随系统' : (pos === 2 ? '深色' : '浅色');
      if (pos === 1) CLTheme.apply('system'); else CLTheme.apply(pos === 2 ? 'night' : 'rose');
    });
    syncDayNight();
    CLTheme.onChange(syncDayNight);
  }

  /* ================= 启动 ================= */
  boot();

  async function boot() {
    // GitHub 回调：GitHub 授权后带 code/state 回到 /?gh=1。前端把这两个参数
    // 转交 Worker 的 /gh/callback（GET，credentials:include 接收会话 Cookie），
    // 服务端换 token 并下发 cl_session，之后再用 /me 拿到登录态。
    if (location.search.indexOf('gh=1') >= 0) {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const state = params.get('state');
      history.replaceState({}, '', location.pathname);
      if (Api && Api.configured()) {
        try {
          let cb = null;
          if (code && state && Api.githubCallback) {
            cb = await Api.githubCallback(code, state);
          }
          const r = await Api.me();
          if (r && r.account) {
            const acc = await S.upsertCloudAccount(r.account);
            // 从开发端发起的 GitHub 登录：不留在用户端，直接送回去。
            // 是不是真能进由 admin.html 再问服务端（同样的白名单）。
            if ((cb && cb.to === 'admin') || (r && r.admin && sessionStorage.getItem('cl_want_admin') === '1')) {
              sessionStorage.removeItem('cl_want_admin');
              location.replace('admin.html');
              return;
            }
            await afterCloudLogin(acc, r.account);
            return;
          }
        } catch (e) { /* 落到下面正常登录页 */ }
      }
    }
    if (S.isDemo && S.isDemo() && sessionStorage.getItem('cl_demo') === '1') {
      // 演示态刷新：离开演示、回登录页，IndexedDB 仍是空的
      S.leaveDemo && S.leaveDemo();
      document.body.classList.remove('demo-mode');
    }
    const me = await S.current();
    if (me) enter(me);
    else showAuth();
  }

  // 云端登录后：把本地 uid 从访客态合并到云账号 id，再进入应用
  async function afterCloudLogin(acc, profile) {
    const oldUid = S.sessionUid && S.sessionUid();
    if (oldUid && oldUid !== acc.id) {
      try {
        const r = await S.migrateUid(oldUid, acc.id);
        if (r && r.moved) toast('已把本机的 ' + r.moved + ' 条记录并入云端账号');
      } catch (e) { toast('本机数据合并失败，原数据仍在：' + e.message, 'warn'); }
    }
    if (Api && Api.configured() && profile) {
      const n = (await S.listPartners(acc.id)).length;
      Api.syncCounts(n).catch(() => { });
    }
    await enter(acc);
    toast('已登录');
  }

  function setAuthErr(msg) { const el = $('#authErr'); if (el) el.textContent = msg || ''; }

  function applyAuthMode(mode) {
    const signup = mode === 'signup';
    $$('.auth-tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === mode));
    $('#nameField').hidden = !signup;
    $('#codeField').hidden = !signup;
    $('#confirmField').hidden = !signup;
    $('#authTitle').textContent = signup ? '创建你的账号' : '欢迎回来';
    $('#authSub').textContent = signup ? '注册需要邮箱验证码，聊天记录仍然只在本机' : '登录后继续追踪你的对话曲线';
    $('#authSubmit').textContent = signup ? '注册并进入' : '登录';
    $('#fPass').autocomplete = signup ? 'new-password' : 'current-password';
    $('#fPass2').value = '';
    setAuthErr('');
    validateConfirm();
  }

  // 确认密码：不一致 → 两边标红、禁用提交、不发请求；都空也算不一致
  function validateConfirm() {
    const signup = $$('.auth-tabs button.active')[0] && $$('.auth-tabs button.active')[0].dataset.tab === 'signup';
    if (!signup) return true;
    const a = $('#fPass').value, b = $('#fPass2').value;
    const bothEmpty = !a && !b;
    const mismatch = a !== b;
    const bad = bothEmpty || mismatch;
    $('#fPass').classList.toggle('bad', bad);
    $('#fPass2').classList.toggle('bad', bad);
    $('#authSubmit').disabled = bad;
    setAuthErr(bad ? (bothEmpty ? '请输入密码并确认' : '两次输入不一致') : '');
    return !bad;
  }

  function showAuth() {
    $('#auth').hidden = false;
    $('#app').hidden = true;
    const fab = $('#themeFab'); if (fab) fab.hidden = true; // 登录页不显示主题悬浮按钮
    let mode = 'login';
    if (S.wasSessionExpired && S.wasSessionExpired()) {
      $('#authSub').textContent = '登录已过期（7 天未使用）。重新登录，之前的数据还在。';
    }
    $('#fEmail').value = draft.email;
    $('#fName').value = draft.name;
    $('#fPass').value = draft.pass;
    applyAuthMode(mode);

    $$('.auth-tabs button').forEach((b) => {
      b.onclick = () => { mode = b.dataset.tab; applyAuthMode(mode); };
    });
    ['#fEmail', '#fName', '#fPass'].forEach((sel) => {
      $(sel).addEventListener('input', () => {
        draft.email = $('#fEmail').value; draft.name = $('#fName').value; draft.pass = $('#fPass').value;
      });
    });
    $('#fPass2').addEventListener('input', validateConfirm);

    // GitHub 登录（主入口）
    $('#ghBtn').onclick = () => {
      if (!Api || !Api.configured()) {
        setAuthErr('还没有配置云端接口地址。请在「先不登录，本地用」进入后到 设置 → 模型与云端 填写 Worker 地址。');
        return;
      }
      try { Api.githubLogin(); } catch (e) { setAuthErr(e.message); }
    };

    // 发送邮箱验证码
    $('#sendCodeBtn').onclick = async () => {
      const email = $('#fEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthErr('先填好邮箱'); return; }
      if (!Api || !Api.configured()) { setAuthErr('还没配置云端接口地址'); return; }
      const btn = $('#sendCodeBtn'); const old = btn.textContent;
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        const r = await Api.sendCode(email);
        toast(r.sent ? '验证码已发送，请查收邮箱' : '验证码发送失败，请稍后重试', r.sent ? '' : 'warn');
      } catch (e) { setAuthErr(e.message); }
      finally { btn.disabled = false; btn.textContent = old; }
    };

    // 先看看效果（T3）：进入纯内存演示，不碰 IndexedDB
    $('#demoBtn').onclick = () => enterDemoMode();

    // 先不登录，本地用（T8）：建一个 provider:'local' 的本地账号
    $('#localBtn').onclick = async () => {
      try {
        let acc = await S.current();
        if (!acc) {
          const all = await S.raw.getAll('accounts');
          acc = all.find((a) => a.provider === 'local') || null;
          if (!acc) {
            acc = { id: 'local_' + Date.now(), email: '', name: '本机用户', provider: 'local',
              salt: null, pw: null, pwAlg: null, createdAt: Date.now(), lastLogin: Date.now(), loginCount: 1 };
            acc.id = await S.raw.add('accounts', acc);
          }
          localStorage.setItem('crushlens_session_v1', JSON.stringify({ uid: acc.id, at: Date.now() }));
        }
        await enter(acc);
        toast('本机模式：数据只存在这台设备');
      } catch (e) { setAuthErr(e.message); }
    };

    $('#authForm').onsubmit = async (e) => {
      e.preventDefault();
      if (mode === 'signup' && !validateConfirm()) return;
      const email = $('#fEmail').value.trim();
      const pass = $('#fPass').value;
      const name = $('#fName').value.trim();
      const code = $('#fCode').value.trim();
      draft.email = email; draft.name = name; draft.pass = pass;
      if (mode === 'signup' && pass.length < 8) { setAuthErr('密码至少 8 位'); return; }
      $('#authErr').textContent = '';
      $('#authSubmit').disabled = true;
      try {
        let acc, profile = null;
        if (Api && Api.configured()) {
          // 云端注册/登录：拉伸在浏览器，Worker 只做一次 HMAC
          const r = mode === 'login' ? await Api.login(email, pass) : await Api.register(email, code, pass, name);
          profile = r.account;
          acc = await S.upsertCloudAccount(profile);
        } else {
          // 未配置云端时，注册/登录退回本机 IndexedDB（零成本、离线可用）
          acc = mode === 'login' ? await S.login(email, pass) : await S.signup(email, pass, name);
        }
        if (mode === 'signup' && Api && Api.configured()) await afterCloudLogin(acc, profile);
        else await enter(acc);
        toast(mode === 'login' ? '欢迎回来' : '账号已创建');
      } catch (err) {
        setAuthErr(err.message || '出错了，再试一次');
      } finally {
        $('#authSubmit').disabled = false;
        validateConfirm();
      }
    };
  }

  /* ================= 演示模式（T3） ================= */
  async function enterDemoMode() {
    const acc = S.enterDemo();
    document.body.classList.add('demo-mode');
    $('#demoBanner').hidden = false;
    // 演示里允许当前账号为空的概览：state.pid 交给各视图；role 给普通用户
    state.me = acc;
    state.role = { level: 'user', permanent: false };
    state.demo = true;
    await enter(acc);
    $('#demoBanner').hidden = false;
  }
  function leaveDemoToRegister() {
    S.leaveDemo();
    document.body.classList.remove('demo-mode');
    $('#demoBanner').hidden = true;
    state.demo = false;
    state.me = null; state.partners = []; state.pid = null;
    showAuth();
    $$('.auth-tabs button').find((b) => b.dataset.tab === 'signup').click();
    // 草稿保留
    $('#fEmail').value = draft.email; $('#fName').value = draft.name; $('#fPass').value = draft.pass;
    validateConfirm();
    toast('已退出演示，填写信息即可开始记录');
  }

  async function enter(acc) {
    state.me = acc;
    state.role = await S.roleOf(acc);
    $('#auth').hidden = true;
    $('#app').hidden = false;
    const fab = $('#themeFab'); if (fab) fab.hidden = false; // 进入应用后才显示主题悬浮按钮

    $('#meName').textContent = acc.name;
    $('#meAvatar').textContent = String(acc.name || '?').slice(0, 1);
    const [meBg, meFg] = avatarPair(S.pickColor(acc.name));
    $('#meAvatar').style.background = meBg;
    $('#meAvatar').style.color = meFg;
    $('#meRole').textContent = state.role.level === 'owner' ? '总开发者' :
      state.role.level === 'dev' ? '授权开发者' : '普通用户';

    $('#logoutBtn').onclick = async () => {
      const ok = await confirmDlg({ title: '退出登录', text: '数据仍然保存在本机，下次登录还能看到。共用电脑的话，下一步可以顺手清掉本机聊天记录。', okText: '继续' });
      if (!ok) return;
      // 三态：keep=保留数据并退出 / clear=清除并退出 / abort=算了不退
      const choice = await new Promise((resolve) => {
        let done = false;
        const m = modal({
          title: '要一并清除本机聊天数据吗？',
          html: `<p class="muted" style="margin:0 0 6px">清除后，这台电脑上的追踪对象、聊天记录和分析报告都会删除（账号保留），无法恢复。只是换个人用的话，选「保留数据并退出」。</p>`,
          footer: `
            <button class="btn ghost" data-x="abort">取消</button>
            <button class="btn ghost" data-x="keep">保留数据并退出</button>
            <button class="btn danger" data-x="clear">清除并退出</button>`,
          onMount(wrap) {
            wrap.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => {
              done = true; m.close(); resolve(b.dataset.x);
            });
          },
          // 点遮罩 / Esc / 右上角 × 关闭都视为「算了不退」
          onClose() { if (!done) resolve('abort'); }
        });
      });
      if (choice !== 'keep' && choice !== 'clear') return;
      if (choice === 'clear') {
        try { await S.clearChatData(state.me.id); } catch (e) { /* 清失败也别把退出卡住 */ }
      }
      stopRealtime();
      S.logout();
      location.reload();
    };

    $('#addPartnerBtn').onclick = () => newPartnerDialog();
    sideDrawer({ side: '#side', toggle: '#sideToggle' });
    wireTheme(() => {
      const [bg, fg] = avatarPair(S.pickColor(state.me.name));
      $('#meAvatar').style.background = bg;
      $('#meAvatar').style.color = fg;
      renderNav();
      renderPartnerList();
      syncDayNight();
      if (state.view) goto(state.view, { quiet: true });
    });
    wireThemeFab();
    wireDayNight();
    $('#demoRegisterBtn').onclick = leaveDemoToRegister;

    await loadPartners();
    state.bridge.links = loadLinks();
    state.bridge.auto = loadAutoFlag();
    if (state.bridge.auto) startAutoSync();
    renderNav();
    goto(state.partners.length ? 'overview' : 'local');
  }

  async function loadPartners() {
    state.partners = await S.listPartners(state.me.id);
    if (!state.pid && state.partners.length) state.pid = state.partners[0].id;
    if (state.pid && !state.partners.some((p) => p.id === state.pid)) {
      state.pid = state.partners.length ? state.partners[0].id : null;
    }
    renderPartnerList();
  }

  /* ================= 侧栏 ================= */
  const NAV = [
    { id: 'overview', label: '概览', icon: 'dash' },
    { id: 'local', label: '直连本机', icon: 'wifi' },
    { id: 'import', label: '导入记录', icon: 'import' },
    { id: 'realtime', label: '实时监测', icon: 'radio' },
    { id: 'reports', label: '复盘报告', icon: 'report' },
    { id: 'usage', label: '使用记录', icon: 'folder' },
    { id: 'settings', label: '设置', icon: 'key' }
  ];

  function renderNav() {
    $('#nav').innerHTML = NAV.map((n) => `
      <button class="nav-item ${state.view === n.id ? 'active' : ''}" data-nav="${n.id}">
        ${icon(n.icon, 17)}<span>${n.label}</span>
        ${n.id === 'import' ? `<span class="nav-badge">+</span>` : ''}
      </button>`).join('');
    $$('[data-nav]').forEach((b) => b.onclick = () => goto(b.dataset.nav));
  }

  function renderPartnerList() {
    const box = $('#plist');
    if (!state.partners.length) {
      box.innerHTML = `<div style="padding:14px 10px;font-size:12px;color:var(--ink-3);line-height:1.7">
        这台设备上还没有导入记录。<br>导入一段聊天记录就会自动创建追踪对象。</div>`;
      return;
    }
    box.innerHTML = state.partners.map((p) => {
      const c = p.color || S.pickColor(p.name);
      const active = state.pid === p.id;
      const score = p.lastAnalysis;
      return `<button class="pitem ${active ? 'active' : ''}" data-pid="${p.id}">
        ${avatar(p.name, c, 36)}
        <div class="pitem-body">
          <div class="pitem-name">${esc(p.name)}</div>
          <div class="pitem-sub">${esc((E.PLATFORM_META[p.platform] || {}).label || p.platform)} · ${fmtNum(p.msgCount || 0)} 条</div>
        </div>
        ${score != null ? `<span class="pitem-score">${Math.round(score)}</span>` : ''}
      </button>`;
    }).join('');
    $$('[data-pid]').forEach((b) => b.onclick = async () => {
      state.pid = +b.dataset.pid;
      renderPartnerList();
      if (state.view === 'overview' || state.view === 'partner') await goto('overview');
      else if (state.view === 'realtime') await goto('realtime');
      // 窄屏抽屉的收起交给 sideDrawer 的 [data-pid] 委托（经 close()，会还原焦点与遮罩）
    });
  }

  /* quiet: 不为切换视图而清空 #main、也不回滚滚动位置（换主题时用，避免图表闪一下） */
  async function goto(view, opts) {
    const quiet = !!(opts && opts.quiet);
    stopRealtime();
    state.view = view;
    renderNav();
    if (!quiet) $('#main').innerHTML = `<div class="card pad center muted small" style="padding:60px">正在计算…</div>`;
    try {
      if (view === 'overview') await viewOverview();
      else if (view === 'local') await viewLocal();
      else if (view === 'import') await viewImport();
      else if (view === 'realtime') await viewRealtime();
      else if (view === 'reports') await viewReports();
      else if (view === 'usage') await viewUsage();
      else if (view === 'settings') await viewSettings();
      else if (view === 'partner') await viewPartner();
    } catch (err) {
      console.error(err);
      $('#main').innerHTML = `<div class="card pad"><h3>出错了</h3><p class="muted small mt8">${esc(err.message || err)}</p></div>`;
    }
    if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ================= 计算 ================= */
  function toRows(msgs) {
    return msgs.map((m) => ({
      speaker: m.speaker,
      text: m.text,
      time: new Date(m.ts),
      media: (m.text.match(MEDIA_RE) || []).length
    }));
  }

  async function compute(pid) {
    let partner = state.partners.find((p) => p.id === pid);
    if (!partner) {
      // 刚导入/刚创建的对象可能还没进内存列表，先刷新一次再算
      await loadPartners();
      partner = state.partners.find((p) => p.id === pid);
    }
    const rows = await S.messagesOf(pid);
    state._lastRows = rows; // 供 AI 摘要使用（原文默认不外发）
    const a = E.analyze(toRows(rows), { me: partner && partner.meSpeaker });
    return { a, partner, rows };
  }

  function head(title, sub, actions) {
    return `<div class="page-head">
      <div>
        <h1>${title}</h1>
        <p>${sub || ''}</p>
      </div>
      <div class="spacer"></div>
      <div class="row">${actions || ''}</div>
    </div>`;
  }

  function kpi(lab, val, unit, foot, spark) {
    return `<div class="card kpi">
      <div class="kpi-lab">${icon('spark', 13)} ${esc(lab)}</div>
      <div class="kpi-val">${val}${unit ? `<small>${unit}</small>` : ''}</div>
      <div class="kpi-foot">
        <div style="font-size:11.5px;color:var(--ink-3)">${foot || ''}</div>
        ${spark || ''}
      </div>
    </div>`;
  }

  /* ================= 概览 ================= */
  // 概览页内的对象切换器：让它跟侧栏一样能选人，切换后侧栏同步高亮
  function ovSwitch(pid) {
    if (state.partners.length < 2) return '';
    return `<div class="ov-switch" role="tablist" aria-label="切换追踪对象">
      ${state.partners.map((p) => {
      const c = p.color || S.pickColor(p.name);
      const on = p.id === pid;
      return `<button class="ov-chip ${on ? 'active' : ''}" role="tab" aria-selected="${on}" data-switch="${p.id}"
          title="切换到 ${esc(p.name)}">
          ${avatar(p.name, c, 24)}
          <span class="nm">${esc(p.name)}</span>
          <span class="ct">${fmtNum(p.msgCount || 0)} 条</span>
        </button>`;
    }).join('')}
    </div>`;
  }

  async function switchPartner(pid) {
    if (!pid || pid === state.pid) return;
    state.pid = pid;
    renderPartnerList();            // 侧栏同步高亮
    await goto('overview');
    const main = $('#main');
    main.classList.add('ov-enter'); // 给一个轻微的淡入，确认「已经换了」
    // 620ms 要覆盖 skin.css 的入场时长（.36s + 最迟 .16s 延迟 = .52s），
    // 否则类被提前摘掉，交错动画会被拦腰截断。
    setTimeout(() => main.classList.remove('ov-enter'), 620);
  }

  async function viewOverview() {
    const pid = state.pid;
    if (!pid) {
      $('#main').innerHTML = head('概览', '先导入一段聊天记录，才能开始追踪') +
        `<div class="card">${empty('import', '这台设备上还没有导入记录', '换设备登录后本机数据是空的，这是正常的；导入聊天记录后即可开始追踪。支持 txt / json，也可以直接粘贴。',
          `<button class="btn primary" data-go="import">去导入</button>`)}</div>`;
      bindGo();
      return;
    }

    const { a, partner } = await compute(pid);
    if (!partner || a.empty) {
      /* 区分「真的没有消息」和「消息还在写 / 对象刚建好」：
         partner 缺失或 msgCount > 0 说明库里其实有东西，只是这次读到的快照还没就绪，
         这时给骨架屏并自动重试，而不是直接甩一句「没有可分析的消息」。 */
      const name = partner ? partner.name : '这个对象';
      const writing = !partner || state.importingPid === pid || (partner.msgCount || 0) > 0;
      state.ovEmptyTry = state.ovEmptyTry || {};
      const tries = state.ovEmptyTry[pid] || 0;
      if (writing && tries < 2) {
        state.ovEmptyTry[pid] = tries + 1;
        $('#main').innerHTML = head(`正在看 ${esc(name)}`, '消息刚写进来，正在整理…') +
          `<div class="card pad center">
            <div class="skl-line"></div>
            <div class="skl-line" style="width:70%"></div>
            <div class="skl-block"></div>
            <p class="muted small">消息正在写入并计算曲线，稍等一下就好…</p>
          </div>`;
        setTimeout(() => {
          if (state.view === 'overview' && state.pid === pid) viewOverview();
        }, 600);
        return;
      }
      $('#main').innerHTML = head('概览', esc(name)) +
        `<div class="card">${empty('chart', '这段记录里没有可分析的消息', '可能是格式没被识别，或者只有系统消息。',
          `<button class="btn primary" data-go="import">重新导入</button>`)}</div>`;
      bindGo();
      return;
    }
    if (state.ovEmptyTry) delete state.ovEmptyTry[pid];

    if (partner.lastAnalysis !== a.total) {
      await S.updatePartner(state.me.id, pid, { lastAnalysis: a.total }).catch(() => { });
      partner.lastAnalysis = a.total;
    }

    const c = partner.color || S.pickColor(partner.name);
    const scores = a.daily.map((d) => d.score).filter((v) => v != null);
    const spark = sparkline(scores.slice(-18), cssVar('--rose', '#e11d48'), 80, 26);

    const trendTone = a.momentum > 1.5 ? 'up' : a.momentum < -1.5 ? 'down' : 'flat';
    const trendIcon = a.momentum > 1.5 ? 'up' : a.momentum < -1.5 ? 'down' : 'flat';

    const rangeDaily = sliceRange(a.daily, state.range);

    const html = `
      ${head(
      `正在看 ${esc(partner.name)}`,
      `今天 ${fmtDateFull(Date.now())} · ${esc((E.PLATFORM_META[partner.platform] || {}).label || partner.platform)} · ${fmtNum(a.count)} 条消息 · 共 ${state.partners.length} 段对话`,
      `<button class="btn ghost sm" data-go="import">${icon('plus', 14)} 导入新记录</button>`
    )}

      ${ovSwitch(pid)}

      <div class="grid g4 mb16">
        ${kpi('情感浓度', Math.round(a.total), '', `全部 ${fmtNum(a.count)} 条 · 覆盖 ${a.spanDays} 天`, spark)}
        ${kpi('近期变化', `${a.momentum > 0 ? '+' : ''}${a.momentum.toFixed(1)}`, '',
      `<span class="kpi-delta ${trendTone}">${icon(trendIcon, 12)} ${a.narrative.dir} · 近 ${a.winLen} 个活跃日 vs 前 ${a.winLen} 个</span>`)}
        ${kpi('覆盖天数', a.spanDays, '天', `全部历史 · ${a.firstDay.slice(5)} 至 ${a.lastDay.slice(5)}`)}
        ${kpi('六维最强', a.narrative ? Object.entries(a.dims).sort((x, y) => y[1] - x[1])[0][0] : '—',
      '', `得分 ${Object.entries(a.dims).sort((x, y) => y[1] - x[1])[0][1]} · 全量特征＋近 7 个活跃日`)}
      </div>
      <p class="kpi-note">${icon('flat', 12)} 上方四个 KPI 是<b>全部历史</b>口径；下面的曲线、转折点与 7 天预测按右上角 <b>${state.range} 天</b> 区间显示。</p>

      <div class="grid g-2-1 mb16">
        <div class="card">
          <div class="card-head">
            <div>
              <h3>情感浓度趋势</h3>
              <div class="sub">${esc(partner.name)} · ${esc((E.PLATFORM_META[partner.platform] || {}).label || '')} · 实线为逐日浓度，虚线为 7 日均线</div>
            </div>
            <div class="spacer"></div>
            <div class="auth-tabs" style="margin:0;width:auto">
              ${[14, 30, 90].map((d) => `<button data-range="${d}" class="${state.range === d ? 'active' : ''}" style="padding:0 12px;flex:none">${d}天</button>`).join('')}
            </div>
          </div>
          <div class="card-body" id="chartBox"></div>
          <div class="card-body" style="padding-top:0;display:flex;gap:18px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-3)">
            <span class="row">${icon('flat', 13)} 逐日浓度</span>
            <span class="row" style="color:var(--legend-ma)">${icon('flat', 13)} 7 日均线</span>
            <span class="row" style="color:var(--violet)">${icon('flat', 13)} 未来 7 天预测</span>
            <span class="row" style="color:var(--rose)">${icon('spark', 13)} 转折点</span>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>当前状态</h3><div class="sub">${esc(a.narrative.level)}</div></div></div>
          <div class="card-body center">
            ${gauge(a.total, { size: 200 })}
            <div class="row" style="justify-content:center;gap:10px;margin-top:6px">
              ${chipTrend(a.momentum)}
              <span class="chip ${a.total >= 70 ? 'up' : 'flat'}">${esc(a.narrative.level)}</span>
            </div>
          </div>
          <div class="divider" style="margin:0 20px"></div>
          <div class="card-body" style="padding-top:14px">
            ${Object.entries(a.dims).map(([k, v]) => `
              <div class="bar-row">
                <span class="bl">${esc(k)}</span>
                <span class="bt"><span class="bf" style="width:${v}%"></span></span>
                <span class="bv">${v}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>

      ${aiBubbleHtml()}

      <div class="grid g-1-2">
        <div class="card">
          <div class="card-head"><div><h3>六维结构</h3><div class="sub">最近 7 天窗口</div></div></div>
          <div class="card-body">${radar(a.dims)}</div>
        </div>

        <div class="card">
          <div class="card-head">
            <div><h3>复盘与预测</h3><div class="sub">${esc(a.narrative.paras[0].replace(/\*\*/g, ''))}</div></div>
            <div class="spacer"></div>
            <button class="btn soft sm" data-report="${pid}">查看完整报告</button>
          </div>
          <div class="card-body">
            <div class="rev-grid">
              ${a.review.slice(0, 4).map((r) => `
                <div class="rev ${r.tone}">
                  <div class="rev-top">
                    <span class="rev-ico">${icon(r.icon === 'trend' ? 'chart' : r.icon === 'risk' ? 'alert' : r.icon === 'peak' ? 'up' : r.icon === 'low' ? 'down' : r.icon === 'turn' ? 'refresh' : r.icon === 'dim' ? 'spark' : 'flat', 14)}</span>
                    <span class="rev-title">${esc(r.title)}</span>
                  </div>
                  <div class="rev-val">${esc(r.value)}</div>
                  <div class="rev-txt">${esc(r.text)}</div>
                </div>`).join('')}
            </div>

            <div class="divider"></div>

            <div class="row between mb12">
              <strong style="font-size:13px">未来 7 天预测</strong>
              <span class="tiny muted">趋势外推，非预言</span>
            </div>
            <div class="row wrap" style="gap:7px">
              ${a.forecast.map((f, i) => `
                <div style="flex:1;min-width:62px;text-align:center;padding:9px 4px;border-radius:11px;background:var(--surface-2);border:1px solid var(--line-2)">
                  <div class="tiny muted">${f.date.slice(5)}</div>
                  <div style="font-size:16px;font-weight:700;color:${f.score >= 60 ? cssVar('--fc-hi', '#e11d48') : f.score >= 45 ? cssVar('--fc-mid', '#b45309') : cssVar('--fc-lo', '#64748b')}">${Math.round(f.score)}</div>
                  <div class="tiny muted">${Math.round(f.lo)}–${Math.round(f.hi)}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="sec-title"><h2>最近导入</h2><div class="spacer"></div>
        <span class="more" data-go="import">继续导入 →</span></div>
      <div class="card" id="batchMini"></div>
    `;

    $('#main').innerHTML = html;
    bindGo();

    // 图表
    const box = $('#chartBox');
    if (box) {
      box.innerHTML = '';
      box.appendChild(trendChart({
        daily: rangeDaily, ma: sliceRange(a.ma, state.range).map((v) => v),
        forecast: a.forecast, changePoints: a.changePoints,
        height: 300
      }));
    }
    $$('[data-switch]').forEach((b) => b.onclick = () => switchPartner(+b.dataset.switch));
    $$('[data-range]').forEach((b) => b.onclick = () => {
      state.range = +b.dataset.range;
      viewOverview();
    });
    $$('[data-report]').forEach((b) => b.onclick = () => openReport(pid));
    bindAiBubble(pid, a, partner);

    const batches = await S.batchesOf(pid);
    const mini = $('#batchMini');
    if (mini) mini.innerHTML = batches.length ? `
      <div class="table-wrap"><table class="tb">
        <thead><tr><th>时间</th><th>来源</th><th>新增</th><th>跳过重复</th><th>覆盖区间</th></tr></thead>
        <tbody>${batches.slice(0, 4).map((b) => `<tr>
          <td>${relTime(b.createdAt)}</td>
          <td><span class="badge gray">${esc((E.PLATFORM_META[b.source] || {}).label || b.source)}</span></td>
          <td class="num">${b.added}</td>
          <td class="num muted">${b.skipped}</td>
          <td class="small muted">${b.firstAt ? fmtDate(b.firstAt) + ' – ' + fmtDate(b.lastAt) : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty" style="padding:26px"><p>还没有导入记录</p></div>`;
  }

  // 报告要跟着对象的模式走，不能一律写成 crush
  function modeOf(pid) {
    const p = (state.partners || []).find((x) => x.id === pid);
    return (p && p.mode) || 'crush';
  }

  function sliceRange(arr, n) {
    if (!arr) return [];
    return arr.slice(-n);
  }

  function bindGo() {
    $$('[data-go]').forEach((b) => b.onclick = () => goto(b.dataset.go));
  }

  /* ================= 对象详情 ================= */
  async function viewPartner() {
    const { a, partner } = await compute(state.pid);
    const batches = await S.batchesOf(state.pid);
    const reports = await S.reportsOf(state.pid);
    const c = partner.color || S.pickColor(partner.name);

    const html = `
      ${head(esc(partner.name), `${esc((E.PLATFORM_META[partner.platform] || {}).label || '')} · ${partner.mode === 'couple' ? '情侣模式' : 'Crush 模式'} · ${esc(partner.note || '没有备注')}`,
      `<button class="btn ghost sm" data-go="overview">返回概览</button>
       <button class="btn primary sm" data-go="import">${icon('plus', 14)} 继续导入</button>`)}

      <div class="grid g4 mb16">
        ${kpi('消息总数', fmtNum(partner.msgCount || 0), '条', `平均 ${Math.round((partner.msgCount || 0) / Math.max(1, a.spanDays))} 条/天`)}
        ${kpi('覆盖天数', a.spanDays, '天', a.firstDay ? `${a.firstDay} 起` : '—')}
        ${kpi('当前浓度', Math.round(a.total), '', chipTrend(a.momentum))}
        ${kpi('导入批次', batches.length, '次', `最近 ${partner.lastImportAt ? relTime(partner.lastImportAt) : '—'}`)}
      </div>

      <div class="card mb16">
        <div class="card-head"><div><h3>浓度曲线</h3><div class="sub">共 ${a.count} 条有效消息</div></div></div>
        <div class="card-body" id="pchart"></div>
      </div>

      <div class="grid g2">
        <div class="card">
          <div class="card-head"><div><h3>导入历史</h3><div class="sub">每次导入只追加新消息，重复内容自动跳过</div></div></div>
          <div class="card-body table-wrap">
            ${batches.length ? `<table class="tb">
              <thead><tr><th>时间</th><th>来源</th><th>新增</th><th>跳过</th></tr></thead>
              <tbody>${batches.map((b) => `<tr>
                <td class="small">${fmtDT(b.createdAt)}</td>
                <td><span class="badge gray">${esc((E.PLATFORM_META[b.source] || {}).label || b.source)}</span>
                  ${b.fileName ? `<div class="tiny muted">${esc(b.fileName)}</div>` : ''}</td>
                <td class="num">+${b.added}</td>
                <td class="num muted">${b.skipped}</td>
              </tr>`).join('')}</tbody></table>`
        : `<p class="muted small">还没有导入记录</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>历史报告</h3><div class="sub">每次导入都会生成一份快照</div></div></div>
          <div class="card-body">
            ${reports.length ? `<div class="timeline">${reports.slice(0, 8).map((r) => `
              <div class="tl-item ${r.score >= 55 ? 'up' : ''}">
                <div class="tl-time">${fmtDT(r.createdAt)}</div>
                <div class="tl-txt"><b style="color:var(--ink)">${r.score}</b> 分 · ${esc(r.narrative ? r.narrative.level : '')} · ${r.count} 条
                  <span class="link" data-open-report="${r.id}" style="margin-left:6px">打开</span></div>
              </div>`).join('')}</div>` : `<p class="muted small">还没有报告</p>`}
          </div>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;
    bindGo();
    const box = $('#pchart');
    if (box && !a.empty) {
      const chartDaily = sliceRange(a.daily, state.range);
      const chartMa = sliceRange(a.ma, chartDaily.length);
      box.appendChild(trendChart({ daily: chartDaily, ma: chartMa, forecast: a.forecast, changePoints: a.changePoints, height: 260 }));
    }
    $$('[data-open-report]').forEach((b) => b.onclick = async () => {
      const r = (await S.reportsOf(state.pid)).find((x) => x.id === +b.dataset.openReport);
      if (r) openReportObj(r);
    });
  }

  /* ================= 导入 ================= */
  async function viewImport() {
    const html = `
      ${head('导入聊天记录', '支持微信 / QQ / 钉钉 / WhatsApp 导出的 txt、json，也可以直接粘贴',
      `<button class="btn primary sm" data-go="local">${icon('wifi', 14)} 直连本机，点人名一键导入</button>`)}

      <div class="stepper">
        <div class="step on"><span class="sn">1</span> 选择对象</div>
        <div class="step-sep"></div>
        <div class="step ${state.parsed ? 'done' : ''}"><span class="sn">2</span> 粘贴或上传</div>
        <div class="step-sep"></div>
        <div class="step ${state.parsed ? 'on' : ''}"><span class="sn">3</span> 预览并确认</div>
      </div>

      <div class="grid g-1-2">
        <div>
          <div class="card pad mb16">
            <h3 style="font-size:14px;margin-bottom:12px">1 · 导入到哪个对象</h3>
            <div class="field">
              <label>已有追踪对象</label>
              <select class="select" id="pidSelect">
                <option value="">— 新建一个对象 —</option>
                ${state.partners.map((p) => `<option value="${p.id}" ${state.pid === p.id ? 'selected' : ''}>${esc(p.name)}（${fmtNum(p.msgCount || 0)} 条）</option>`).join('')}
              </select>
            </div>
            <div id="newPartnerBox" ${state.partners.length ? 'hidden' : ''}>
              <div class="row2">
                <div class="field">
                  <label>对象昵称</label>
                  <input class="input" id="newPName" placeholder="例如：林晚">
                </div>
                <div class="field">
                  <label>模式</label>
                  <select class="select" id="newPMode">
                    <option value="crush">Crush 心动</option>
                    <option value="couple">情侣关系</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label>备注（可选）</label>
                <input class="input" id="newPNote" placeholder="例如：同事介绍，聊了一个月">
              </div>
            </div>
            <div class="auth-note" style="margin-top:4px">
              <b>增量导入：</b>同一个对象下次只需要导入新的聊天记录，系统按「发送人 + 时间 + 内容」自动去重，不会重复计算。
            </div>
          </div>

          <div class="card pad">
            <h3 style="font-size:14px;margin-bottom:12px">2 · 导入数据</h3>
            <div class="auth-tabs" style="margin:0 0 12px">
              <button data-src="paste" class="active">粘贴文本</button>
              <button data-src="shot">截图识别</button>
              <button data-src="file">上传文件</button>
            </div>
            <div id="srcShot" hidden>
              <div class="auth-note" style="margin-bottom:12px">
                <b>手机最省事的方法：</b>聊天截图 → 传到这里，自动识别每句话是谁说的、说了什么。
                <b>识别在你手机/电脑本地完成，图片不会上传。</b>建议一次 3-10 张、连续的截图（带时间分隔的那条灰色小字也会被利用）。
              </div>
              <div class="row2">
                <div class="field">
                  <label>对方称呼（识别出的话会标成这个名字）</label>
                  <input class="input" id="shotName" placeholder="例如：林晚">
                </div>
                <div class="field">
                  <label>你的称呼</label>
                  <input class="input" id="shotMine" value="我">
                </div>
              </div>
              <button class="btn ghost block" id="shotPickBtn" style="height:56px">${icon('phone', 16)} 选择或拍摄聊天截图（可多选）</button>
              <input type="file" id="shotInput" accept="image/*" multiple hidden>
              <div id="shotProg" hidden class="prog-wrap mt12">
                <div class="prog"><div class="prog-bar" id="shotProgBar"></div></div>
                <div class="tiny muted mt8" id="shotStatus"></div>
              </div>
              <div class="auth-note mt8" style="font-size:11.5px">
                <b>说明：</b>首次使用需加载识别引擎（约 9MB，只下一次，之后走浏览器缓存）。识别准确率一般在 90% 上下，
                识别完请在右边预览里扫一眼再导入；群聊截图左右判断会失准，1 对 1 聊天效果最好。
              </div>
            </div>
            <div id="srcPaste">
              <textarea class="textarea" id="pasteArea" style="min-height:180px"
                placeholder="把聊天记录直接粘进来，例如：&#10;&#10;林晚&#10;2026年10月1日 21:14&#10;在吗&#10;&#10;我&#10;2026年10月1日 21:15&#10;在的"></textarea>
            </div>
            <div id="srcFile" hidden>
              <div class="dropzone" id="dropzone">
                <div class="dz-ico">${icon('import', 20)}</div>
                <h4>拖入文件，或点击选择</h4>
                <p>.txt / .json / .csv，单文件建议 &lt; 5MB</p>
                <div class="plat-row">
                  <span class="plat"><i style="background:#07c160"></i>微信</span>
                  <span class="plat"><i style="background:#12b7f5"></i>QQ</span>
                  <span class="plat"><i style="background:#3f7dff"></i>钉钉</span>
                  <span class="plat"><i style="background:#25d366"></i>WhatsApp</span>
                </div>
              </div>
              <input type="file" id="fileInput" accept=".txt,.json,.csv,text/plain,application/json" hidden>
            </div>

            <div class="row between mt16">
              <button class="btn ghost sm" id="demoBtn">${icon('spark', 14)} 载入示例数据</button>
              <button class="btn primary" id="parseBtn">解析记录</button>
            </div>
          </div>

          <div class="card pad mt16">
            <h3 style="font-size:14px;margin-bottom:4px">${icon('phone', 14)} 手机也能导入（微信 / QQ）</h3>
            <div class="auth-note" style="margin-bottom:10px">手机 App 的聊天数据库是封闭的，手机上无法自动抓取；但可以用下面的「合并转发」办法，一分钟把记录搬进来：</div>
            <div class="m-steps">
              <div class="ms"><b>①</b> 在微信里打开那个聊天，长按一条消息 → <b>多选</b></div>
              <div class="ms"><b>②</b> 勾选要分析的记录（一次最多 100 条）→ 点左下角「…」→ <b>合并转发</b>给「文件传输助手」</div>
              <div class="ms"><b>③</b> 在<b>电脑版微信</b>打开这条合并记录 → 全选复制 → 回到这里粘贴解析</div>
            </div>
            <div class="auth-note mt8"><b>提示：</b>复制出来的「名字 / 时间 / 内容」格式本页已支持，直接粘进上面的框点「解析记录」即可，系统会自动识别成微信格式。</div>
          </div>
        </div>

        <div>
          <div class="card" id="previewCard">
            <div class="card-head"><div><h3>3 · 解析结果</h3><div class="sub">确认无误后再导入</div></div></div>
            <div class="card-body" id="previewBody">
              ${empty('eye', '还没有解析内容', '在左边粘贴或上传聊天记录，点「解析记录」后会在这里预览。')}
            </div>
          </div>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;

    // 交互
    const sel = $('#pidSelect');
    sel.onchange = () => {
      state.pid = sel.value ? +sel.value : null;
      $('#newPartnerBox').hidden = !!sel.value;
    };
    $$('[data-src]').forEach((b) => b.onclick = () => {
      $$('[data-src]').forEach((x) => x.classList.toggle('active', x === b));
      $('#srcPaste').hidden = b.dataset.src !== 'paste';
      $('#srcShot').hidden = b.dataset.src !== 'shot';
      $('#srcFile').hidden = b.dataset.src !== 'file';
      if (b.dataset.src === 'shot' && !$('#shotName').value) {
        const sel = $('#pidSelect');
        const p = state.partners.find((x) => String(x.id) === sel.value);
        $('#shotName').value = p ? p.name : ($('#newPName').value || '');
      }
    });

    /* ---- 截图识别 ---- */
    $('#shotPickBtn').onclick = () => $('#shotInput').click();
    $('#shotInput').onchange = async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      const theirs = $('#shotName').value.trim() || '对方';
      const mine = $('#shotMine').value.trim() || '我';
      const prog = $('#shotProg'), bar = $('#shotProgBar'), st = $('#shotStatus');
      prog.hidden = false;
      $('#shotPickBtn').disabled = true;
      const setP = (info) => {
        if (!info) return;
        if (info.phase === 'ocr') {
          const base = 0.15, span = 0.8;
          bar.style.width = Math.round((base + span * (info.progress || 0)) * 100) + '%';
        } else if (info.phase === 'file' && info.progress != null) {
          bar.style.width = Math.round((0.05 + 0.9 * info.progress) * 100) + '%';
        }
        if (info.msg) st.textContent = info.msg;
        if (info.phase === 'lib') bar.style.width = '6%';
      };
      try {
        st.textContent = '准备中…';
        const text = await CLShot.process(files, { mine, theirs, onProgress: setP });
        if (!text.trim()) throw new Error('没能识别出聊天内容，确认是聊天截图且文字清晰');
        $('#pasteArea').value = text;
        state.fileName = '截图识别.txt';
        $$('[data-src]').forEach((x) => x.classList.toggle('active', x.dataset.src === 'paste'));
        $('#srcPaste').hidden = false; $('#srcShot').hidden = true; $('#srcFile').hidden = true;
        st.textContent = '识别完成！请在下方预览确认。';
        bar.style.width = '100%';
        doParse(text, '截图识别');
        $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('识别完成，请在预览里检查后导入', 'ok');
      } catch (err) {
        st.textContent = err.message || '识别失败';
        toast(err.message || '识别失败', 'error');
      } finally {
        $('#shotPickBtn').disabled = false;
        $('#shotInput').value = '';
      }
    };

    const dz = $('#dropzone');
    if (dz) {
      dz.onclick = () => $('#fileInput').click();
      dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
      dz.ondragleave = () => dz.classList.remove('drag');
      dz.ondrop = async (e) => {
        e.preventDefault(); dz.classList.remove('drag');
        const f = e.dataTransfer.files[0];
        if (f) await readFile(f);
      };
      $('#fileInput').onchange = async (e) => {
        if (e.target.files[0]) await readFile(e.target.files[0]);
      };
    }

    $('#parseBtn').onclick = () => doParse();
    $('#demoBtn').onclick = async () => {
      const ok = await confirmDlg({
        title: '载入示例数据',
        text: '会创建 3 个示例追踪对象（升温 / 平稳 / 降温各一段），共约 40 天的模拟对话，方便你先看看完整效果。随时可以删除。',
        okText: '载入'
      });
      if (!ok) return;
      $('#demoBtn').disabled = true;
      const r = await S.seedDemo(state.me.id);
      await loadPartners();
      toast(`已生成 ${r.count} 个示例对象`);
      state.pid = state.partners[0].id;
      await goto('overview');
    };

    async function readFile(f) {
      if (f.size > 8 * 1024 * 1024) { toast('文件太大，建议先拆分', 'error'); return; }
      const text = decodeText(await f.arrayBuffer());
      $('#pasteArea').value = text;
      $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
      state.fileName = f.name;
      doParse(text, f.name);
    }
  }

  let pendingParse = null;
  // 本次解析出的「对方是谁 / 平台」，导入时以它为准，不再隐式取当前选中对象
  let pendingTarget = null;

  const normName = (s) => String(s || '').trim().toLowerCase();

  /* 解码：BOM 优先，UTF-8 失败回退 GB18030。
     中文 Windows 上 QQ / 微信导出的 txt 很多是 GBK，直接按 UTF-8 读会整篇乱码。 */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    const utf8 = new TextDecoder('utf-8').decode(u8);
    if (utf8.indexOf('\uFFFD') >= 0) {
      try { return new TextDecoder('gb18030').decode(u8); } catch (e) { /* 浏览器不支持就算了 */ }
    }
    return utf8;
  }

  async function doParse(text, fileName) {
    const raw = text != null ? text : ($('#pasteArea') ? $('#pasteArea').value : '');
    if (!raw || raw.trim().length < 8) { toast('内容太短了，先粘一段完整的聊天记录', 'warn'); return; }

    const parsed = E.parseChat(raw, fileName || null);
    if (!parsed.messages.length) {
      $('#previewBody').innerHTML = empty('alert', '没识别出消息', '检查一下格式：需要包含「发送人 + 时间 + 内容」。微信电脑版可以直接多选复制。');
      return;
    }
    pendingParse = parsed;

    const plat = E.PLATFORM_META[parsed.detected] || E.PLATFORM_META.unknown;
    const first = parsed.messages[0].time, last = parsed.messages[parsed.messages.length - 1].time;
    const speakers = parsed.speakers;
    const meDefault = speakers.find((s) => /^(我|me|self)$/i.test(s)) || speakers[0];
    const otherName = speakers.find((s) => s !== meDefault) || '未命名对象';
    const platform = parsed.detected || parsed.platform;

    /* 归属确认：先看有没有同名对象，再看当前选中的是不是同一个人。
       以前这里直接用 state.pid，选中林晚却导陈屿的记录会静默混进林晚档案。 */
    const sameNames = await S.findPartnersByName(state.me.id, otherName);
    // 同名可能有多个（不同平台 / 不同的人）：默认目标优先同平台那个，其余照旧列在下拉里
    const platNorm = String(platform || '').toLowerCase();
    const sameName = sameNames.find((p) => String(p.platform || '').toLowerCase() === platNorm) || sameNames[0] || null;
    const current = state.partners.find((p) => p.id === state.pid) || null;
    const currentIsSame = !!(current && normName(current.name) === normName(otherName));
    const mismatch = current && !currentIsSame ? current : null;
    const defaultPid = sameName ? sameName.id : (currentIsSame ? current.id : 'new');
    pendingTarget = { name: otherName, platform, mismatchName: mismatch ? mismatch.name : null };

    const targetOpts = [
      `<option value="new" ${defaultPid === 'new' ? 'selected' : ''}>＋ 新建对象「${esc(otherName)}」</option>`,
      ...state.partners.map((p) => {
        const hit = normName(p.name) === normName(otherName);
        return `<option value="${p.id}" ${p.id === defaultPid ? 'selected' : ''}>${esc(p.name)}（${esc((E.PLATFORM_META[p.platform] || {}).label || p.platform)} · ${fmtNum(p.msgCount || 0)} 条）${hit ? ' · 同名合并' : ''}</option>`;
      })
    ].join('');

    const body = `
      <div class="parse-summary">
        <span class="badge" style="background:${plat.color}18;color:${plat.color}">
          <i style="width:6px;height:6px;border-radius:99px;background:${plat.color}"></i> 识别为 ${plat.label}
        </span>
        <span><b>${parsed.messages.length}</b> 条消息</span>
        <span><b>${speakers.length}</b> 个说话人</span>
        ${first ? `<span class="muted">${fmtDateFull(first)} → ${fmtDateFull(last)}</span>` : ''}
      </div>

      ${mismatch ? `<div class="warn-box" id="targetWarn">
        ⚠ 你当前选中的是「${esc(mismatch.name)}」，但这份记录里的对方是「${esc(otherName)}」。
        已自动把导入目标改为「${esc(otherName)}」，<b>不会</b>写进「${esc(mismatch.name)}」的档案。
      </div>` : ''}

      <div class="field">
        <label>导入到哪个对象</label>
        <select class="select" id="targetSelect">${targetOpts}</select>
        <div class="hint" id="targetHint"></div>
      </div>

      <div class="field">
        <label>哪个是你？</label>
        <select class="select" id="meSelect">
          ${speakers.map((s) => `<option value="${esc(s)}" ${/^(我|me|self)$/i.test(s) ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <div class="hint">用于计算「双向投入」和「谁更主动」，选错会让曲线失真。</div>
      </div>

      <div class="row between mb8">
        <strong style="font-size:12.5px">预览（最后 20 条）</strong>
        <span class="tiny muted">已自动过滤系统消息</span>
      </div>
      <div class="msg-preview">
        ${parsed.messages.slice(-20).map((m) => {
      const meSel = /^(我|me|self)$/i.test(m.speaker);
      return `<div class="msg-row ${meSel ? 'me' : ''}">
            ${avatar(m.speaker, S.pickColor(m.speaker), 26)}
            <div>
              <div class="msg-bub">${esc(m.text.slice(0, 300))}</div>
              <div class="msg-meta">${esc(m.speaker)} · ${m.time ? fmtDate(m.time) + ' ' + String(m.time.getHours()).padStart(2, '0') + ':' + String(m.time.getMinutes()).padStart(2, '0') : '无时间'}</div>
            </div>
          </div>`;
    }).join('')}
      </div>

      <div class="divider"></div>
      <button class="btn primary block lg" id="confirmImport">确认导入 ${parsed.messages.length} 条</button>
    `;
    $('#previewBody').innerHTML = body;
    $('#confirmImport').onclick = () => runImport();

    const tsel = $('#targetSelect');
    const hint = $('#targetHint');
    const refreshHint = () => {
      const v = tsel.value;
      if (v === 'new') {
        hint.className = 'hint';
        hint.innerHTML = sameNames.length && defaultPid !== 'new'
          ? `已存在 ${sameNames.length} 个同名对象（${sameNames.map((x) => esc((E.PLATFORM_META[x.platform] || {}).label || x.platform)).join('、')}），建议直接合并；选「新建」会另开一份。`
          : `将新建一个对象「${esc(otherName)}」，平台记为 ${esc(plat.label)}。`;
        return;
      }
      const p = state.partners.find((x) => x.id === +v);
      if (!p) { hint.textContent = ''; return; }
      if (normName(p.name) !== normName(otherName)) {
        hint.className = 'hint warn';
        hint.innerHTML = `这份记录的对方是「${esc(otherName)}」，导进「${esc(p.name)}」会把两个人混在一起。`;
      } else {
        hint.className = 'hint';
        hint.innerHTML = `已存在《${esc(p.name)} · ${fmtNum(p.msgCount || 0)} 条》，本次只补新消息，重复的会自动跳过。`;
      }
    };
    tsel.onchange = refreshHint;
    refreshHint();

    $('#previewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function runImport() {
    const parsed = pendingParse;
    if (!parsed) return;
    const btn = $('#confirmImport');
    btn.disabled = true; btn.textContent = '正在写入…';
    const prevImporting = state.importingPid;

    // 进度反馈：写入按批刷新；切到后台会提示可能被浏览器暂停
    const pwrap = document.createElement('div');
    pwrap.className = 'prog-wrap mt12';
    pwrap.setAttribute('data-import-progress', '');
    pwrap.innerHTML = `<div class="prog"><div class="prog-bar" id="impBar" style="width:2%"></div></div>
      <div class="tiny muted mt8" id="impText">准备写入 0 / ${parsed.messages.length} 条</div>`;
    btn.parentNode.insertBefore(pwrap, btn);
    const pbar = pwrap.querySelector('#impBar');
    const ptext = pwrap.querySelector('#impText');
    const setP = (info) => {
      if (!info) return;
      const pct = info.total ? Math.max(2, Math.round((info.written / info.total) * 100)) : 100;
      pbar.style.width = pct + '%';
      ptext.textContent = `正在写入 ${info.written} / ${info.total} 条`;
    };
    let warnedHidden = false;
    const onHide = () => {
      if (document.hidden && !warnedHidden) {
        warnedHidden = true;
        toast('导入还没结束，先别切到后台，浏览器可能会暂停写入', 'warn');
      }
    };
    document.addEventListener('visibilitychange', onHide);

    try {
      const meSpeaker = $('#meSelect') ? $('#meSelect').value : null;
      const targetName = (pendingTarget && pendingTarget.name) || parsed.speakers.find((s) => s !== meSpeaker) || '未命名对象';
      const platform = (pendingTarget && pendingTarget.platform) || parsed.platform || 'paste';
      const tsel = $('#targetSelect');
      const chosen = tsel ? tsel.value : 'new';
      let pid = chosen === 'new' ? null : +chosen;

      if (pid) {
        // 用户手动把别人的记录导进当前档案 → 必须再确认一次
        const tp = state.partners.find((x) => x.id === pid);
        if (tp && normName(tp.name) !== normName(targetName)) {
          const goOn = await confirmDlg({
            title: `确认导入到「${tp.name}」？`,
            text: `这份记录的对方是「${targetName}」，导进去会和「${tp.name}」混在同一个档案里，之后只能整份删掉重来。建议改选「新建对象」。`,
            okText: '仍然合并'
          });
          if (!goOn) {
            btn.disabled = false; btn.textContent = `确认导入 ${parsed.messages.length} 条`;
            return;
          }
        }
        await S.updatePartner(state.me.id, pid, { meSpeaker }).catch(() => { });
      } else {
        // 「新建」也要再查一次同名，避免同一份记录被导成第二个同名对象
        const existeds = await S.findPartnersByName(state.me.id, targetName);
        if (existeds.length) {
          const platNorm2 = String(platform || '').toLowerCase();
          const existed = existeds.find((x) => String(x.platform || '').toLowerCase() === platNorm2) || existeds[0];
          const desc = existeds.map((x) => `《${targetName} · ${(E.PLATFORM_META[x.platform] || {}).label || x.platform} · ${fmtNum(x.msgCount || 0)} 条》`).join('、');
          const goOn = await confirmDlg({
            title: `已经有「${targetName}」了`,
            text: `列表里已有 ${desc}。继续新建会出现两个同名对象，曲线各算各的。要不要合并到${existeds.length > 1 ? '同平台的那个' : '已有的那个'}？`,
            okText: '合并到已有'
          });
          if (goOn) {
            pid = existed.id;
            await S.updatePartner(state.me.id, pid, { meSpeaker }).catch(() => { });
          }
        }
        if (!pid) {
          const mode = ($('#newPMode') && $('#newPMode').value) || 'crush';
          const note = ($('#newPNote') && $('#newPNote').value.trim()) || '';
          const p = await S.createPartner(state.me.id, { name: targetName, platform, mode, note, meSpeaker });
          pid = p.id;
        }
      }

      // 导入目标（新建或合并进已有对象）一律成为当前对象，
      // 否则「查看趋势」会把用户带回导入前选中的那个人
      state.pid = pid;

      // 标记「这一份正在写」，概览据此显示骨架而不是「没有可分析的消息」
      state.importingPid = pid;

      const res = await S.importMessages(state.me.id, pid, parsed, {
        source: parsed.detected || parsed.platform,
        fileName: state.fileName || (parsed.fileName || null)
      }, setP);

      await loadPartners();
      ptext.textContent = '正在计算曲线与复盘…';
      pbar.style.width = '100%';
      const { a } = await compute(pid);
      if (!a.empty) {
        await S.saveReport(state.me.id, pid, a, modeOf(pid));
        await S.updatePartner(state.me.id, pid, { lastAnalysis: a.total });
      }

      $('#previewBody').innerHTML = `
        <div class="center" style="padding:26px 8px">
          <div class="empty-ico" style="margin:0 auto 12px;background:var(--ok-bg);color:var(--ok-fg)">${icon('check', 24)}</div>
          <h3 style="font-size:16px">导入完成</h3>
          <p class="muted small mt8">新增 <b style="color:var(--ink)">${res.added}</b> 条${res.skipped ? `，跳过重复 <b style="color:var(--ink)">${res.skipped}</b> 条` : ''}</p>
          <div class="parse-summary" style="justify-content:center;margin-top:16px">
            <span>当前总消息 <b>${res.partner.msgCount}</b></span>
            <span>情感浓度 <b>${a.total || '—'}</b></span>
            <span>${esc(a.narrative ? a.narrative.level : '')}</span>
          </div>
          <div class="row" style="justify-content:center;margin-top:18px">
            <button class="btn ghost" id="againBtn">再导一份</button>
            <button class="btn primary" id="goTrend">查看趋势</button>
          </div>
        </div>`;
      $('#goTrend').onclick = () => goto('overview');
      $('#againBtn').onclick = () => { pendingParse = null; goto('import'); };
      toast(`导入成功，新增 ${res.added} 条`);
      renderPartnerList();
      state.fileName = null;
    } catch (err) {
      console.error(err);
      toast(err.message || '导入失败', 'error');
      btn.disabled = false; btn.textContent = '重试导入';
      if (pwrap && pwrap.parentNode) pwrap.parentNode.removeChild(pwrap);
    } finally {
      state.importingPid = prevImporting;
      document.removeEventListener('visibilitychange', onHide);
    }
  }

  /* ================= 新建对象 ================= */
  function newPartnerDialog() {
    const m = modal({
      title: '新建追踪对象',
      sub: '一个对象对应一段关系',
      html: `
        <div class="field"><label>昵称</label><input class="input" id="npName" placeholder="例如：林晚"></div>
        <div class="row2">
          <div class="field"><label>平台</label>
            <select class="select" id="npPlat">
              ${Object.entries(E.PLATFORM_META).filter(([k]) => ['wechat', 'qq', 'dingtalk', 'whatsapp'].includes(k))
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>模式</label>
            <select class="select" id="npMode">
              <option value="crush">Crush 心动</option>
              <option value="couple">情侣关系</option>
            </select>
          </div>
        </div>
        <div class="field"><label>备注（可选）</label><input class="input" id="npNote" placeholder="怎么认识的 / 现在什么阶段"></div>`,
      footer: `<button class="btn ghost" data-close>取消</button><button class="btn primary" id="npOk">创建</button>`
    });
    m.el.querySelector('#npOk').onclick = async () => {
      const name = m.el.querySelector('#npName').value.trim();
      if (!name) { toast('起个名字吧', 'warn'); return; }
      const p = await S.createPartner(state.me.id, {
        name,
        platform: m.el.querySelector('#npPlat').value,
        mode: m.el.querySelector('#npMode').value,
        note: m.el.querySelector('#npNote').value.trim()
      });
      await loadPartners();
      state.pid = p.id;
      renderPartnerList();
      m.close();
      toast('对象已创建');
      goto('import');
    };
  }

  /* ================= 实时监测 ================= */
  async function viewRealtime() {
    if (!state.partners.length) {
      $('#main').innerHTML = head('实时监测', '先导入一段记录') +
        `<div class="card">${empty('radio', '还没有可监测的对象', '实时监测需要至少一段已导入的对话作为基线。',
          `<button class="btn primary" data-go="import">去导入</button>`)}</div>`;
      bindGo(); return;
    }

    const pid = state.pid;
    const { a, partner } = await compute(pid);

    const html = `
      ${head('实时监测', '持续重算当前对话的浓度，出现明显变化会提醒你')}

      <div class="realtime-head mb16">
        ${avatar(partner.name, partner.color || S.pickColor(partner.name), 44)}
        <div>
          <div style="font-weight:650;font-size:15px">${esc(partner.name)}</div>
          <div class="tiny muted">${esc((E.PLATFORM_META[partner.platform] || {}).label || '')} · ${fmtNum(partner.msgCount || 0)} 条消息</div>
        </div>
        <div class="spacer" style="flex:1"></div>
        <div class="rt-state" id="rtState">${icon('radio', 14)} 未开启</div>
        <button class="btn primary sm" id="rtToggle">开启监测</button>
      </div>

      <div class="grid g-2-1 mb16">
        <div class="card">
          <div class="card-head"><div><h3>实时浓度</h3><div class="sub" id="rtSub">每 6 秒重新计算一次</div></div>
            <div class="spacer"></div><span class="badge gray" id="rtCount">${a.count} 条</span></div>
          <div class="card-body center" id="rtGauge">${a.empty ? '<p class="muted small">暂无数据</p>' : gauge(a.total, { size: 210 })}</div>
          <div class="card-body" style="padding-top:0" id="rtBars">
            ${a.empty ? '' : Object.entries(a.dims).map(([k, v]) => `
              <div class="bar-row"><span class="bl">${esc(k)}</span>
                <span class="bt"><span class="bf" style="width:${v}%"></span></span>
                <span class="bv">${v}</span></div>`).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>增量追加</h3><div class="sub">粘贴最新几条，立刻并入曲线</div></div></div>
          <div class="card-body">
            <textarea class="textarea" id="rtPaste" style="min-height:130px"
              placeholder="只粘新的那几条就行，重复的会自动跳过"></textarea>
            <button class="btn primary block mt12" id="rtAdd">追加并重算</button>
            <div class="auth-note" style="margin-top:12px;font-size:11px">
              <b>更进一步：</b>在「直连本机」里打开<b>后台自动同步</b>后，只要这个页面开着，本机助手每 20 秒检查一次投递箱，
              新记录自动并入曲线，不用手动粘贴。
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>消息流</h3><div class="sub">最近 24 条</div></div>
          <div class="spacer"></div><span class="link" id="rtRefresh">刷新</span></div>
        <div class="card-body"><div class="rt-feed" id="rtFeed"></div></div>
      </div>
    `;
    $('#main').innerHTML = html;

    await renderFeed(pid);

    $('#rtAdd').onclick = async () => {
      const txt = $('#rtPaste').value.trim();
      if (!txt) { toast('先粘几条消息', 'warn'); return; }
      const parsed = E.parseChat(txt);
      if (!parsed.messages.length) { toast('没识别出消息，检查一下格式', 'error'); return; }
      const res = await S.importMessages(state.me.id, pid, parsed, { source: 'paste' });
      $('#rtPaste').value = '';
      toast(res.added ? `已追加 ${res.added} 条` : '这几条都是重复内容', res.added ? '' : 'warn');
      await loadPartners();
      await refreshRt(pid, true);
      await renderFeed(pid);
    };

    $('#rtRefresh').onclick = () => renderFeed(pid);

    let on = false;
    const btn = $('#rtToggle');
    btn.onclick = () => {
      on = !on;
      if (on) {
        btn.textContent = '停止监测';
        btn.classList.remove('primary'); btn.classList.add('ghost');
        $('#rtState').innerHTML = `<span class="dot pulse" style="background:var(--rose)"></span> 监测中`;
        $('#rtState').classList.add('live');
        state.lastRt = a.total;
        state.timer = setInterval(() => refreshRt(pid, false), 6000);
        toast('已开始监测');
      } else {
        stopRealtime();
        btn.textContent = '开启监测';
        btn.classList.add('primary'); btn.classList.remove('ghost');
        $('#rtState').innerHTML = `${icon('radio', 14)} 已停止`;
        $('#rtState').classList.remove('live');
      }
    };

    S.onBroadcast((msg) => {
      if (state.view !== 'realtime') return;
      if (msg.type === 'messages-changed' && msg.payload.pid === pid) {
        refreshRt(pid, false);
        renderFeed(pid);
      }
    });
  }

  function stopRealtime() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  async function refreshRt(pid, force) {
    const { a } = await compute(pid);
    const g = $('#rtGauge');
    if (!g) return;
    if (a.empty) { g.innerHTML = '<p class="muted small">暂无数据</p>'; return; }
    g.innerHTML = gauge(a.total, { size: 210 });
    const bars = $('#rtBars');
    if (bars) bars.innerHTML = Object.entries(a.dims).map(([k, v]) => `
      <div class="bar-row"><span class="bl">${esc(k)}</span>
        <span class="bt"><span class="bf" style="width:${v}%"></span></span>
        <span class="bv">${v}</span></div>`).join('');
    const cnt = $('#rtCount'); if (cnt) cnt.textContent = a.count + ' 条';

    if (state.lastRt != null && Math.abs(a.total - state.lastRt) >= 4) {
      const up = a.total > state.lastRt;
      toast(`浓度${up ? '上升' : '下降'} ${Math.abs(a.total - state.lastRt)} 分（${state.lastRt} → ${a.total}）`, up ? '' : 'warn');
      state.lastRt = a.total;
    } else if (state.lastRt == null || force) {
      state.lastRt = a.total;
    }
  }

  async function renderFeed(pid) {
    const feed = $('#rtFeed');
    if (!feed) return;
    const rows = await S.messagesOf(pid);
    const last = rows.slice(-24).reverse();
    feed.innerHTML = last.map((m) => `
      <div class="rt-msg">
        ${avatar(m.speaker, S.pickColor(m.speaker), 28)}
        <div class="c">
          <div class="cm">${esc(m.text.slice(0, 200))}</div>
          <div class="ct">${esc(m.speaker)} · ${fmtDT(m.ts)}</div>
        </div>
      </div>`).join('') || '<p class="muted small">还没有消息</p>';
  }

  /* ================= 直连本机 ================= */
  const BRIDGE_BASE = 'http://127.0.0.1:17321';
  const IS_WIN = /Windows/i.test(navigator.userAgent);

  /* ---- 设计说明 ----
     助手 v2 起不再对任意网页开放：必须先用助手窗口里的 6 位配对码换 Token，
     之后所有 /api/* 请求都带 X-Bridge-Token。Token 存在本机 localStorage，
     助手重启后失效，页面会自动回到配对界面。 */

  function bridgeTokenKey() { return 'crushlens_bridge_token'; }
  function getToken() {
    try { return localStorage.getItem(bridgeTokenKey()) || ''; } catch (e) { return ''; }
  }
  function setToken(t) {
    try {
      if (t) localStorage.setItem(bridgeTokenKey(), t);
      else localStorage.removeItem(bridgeTokenKey());
    } catch (e) { }
  }

  function timeoutSignal(ms) {
    if (window.AbortSignal && AbortSignal.timeout) return AbortSignal.timeout(ms);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), ms);
    return ac.signal;
  }

  async function bFetch(path, opts) {
    const o = opts || {};
    const headers = {};
    const tk = getToken();
    if (tk) headers['X-Bridge-Token'] = tk;
    let r;
    try {
      r = await fetch(BRIDGE_BASE + path, {
        method: o.method || 'GET',
        cache: 'no-store',
        headers,
        signal: timeoutSignal(o.ms || 4000)
      });
    } catch (err) {
      // T2：把 fetch 的几种失败拆成可识别的 code，供 UI 给出四套不同文案
      const coded = new Error(err && err.message ? err.message : 'fetch failed');
      if (err && err.name === 'AbortError') coded.code = 'timeout';
      else if (err && /Failed to fetch|NetworkError|Load failed/i.test(err.message || '')) coded.code = 'FETCH_FAILED';
      else coded.code = 'ERR_CONNECTION_REFUSED';
      throw coded;
    }
    if (r.status === 401) {
      const err = new Error('unauthorized');
      err.code = 401;
      throw err;
    }
    if (!r.ok) {
      const err = new Error('助手返回 ' + r.status);
      err.code = r.status;
      throw err;
    }
    return r.json();
  }

  async function bGet(path, ms) { return bFetch(path, { ms }); }
  async function bPost(path, ms) { return bFetch(path, { ms, method: 'POST' }); }

  async function bridgePair(code) {
    const d = await bFetch('/api/pair?code=' + encodeURIComponent(String(code || '').trim()), { ms: 6000, method: 'POST' });
    if (d && d.token) { setToken(d.token); return true; }
    return false;
  }

  async function bridgeProbe() {
    const b = state.bridge;
    b.needPair = false;
    // 1) 公开探活：只说明「本机有助手在跑」
    try {
      await bFetch('/api/ping', { ms: 2500, method: 'GET' });
    } catch (err) {
      b.ok = false; b.info = null; b.needPair = false;
      b.error = err && err.code ? err.code : (err && err.name === 'AbortError' ? 'timeout' : (err.message || 'unreachable'));
      return false;
    }
    // 2) 有 Token 才算真正连上
    if (!getToken()) {
      b.ok = false; b.info = null; b.needPair = true; b.error = null;
      return false;
    }
    try {
      b.info = await bGet('/api/hello', 3000);
      b.ok = true; b.error = null; b.needPair = false;
    } catch (err) {
      b.ok = false; b.info = null;
      if (err && err.code === 401) { setToken(''); b.needPair = true; b.error = null; }
      else b.error = err && err.name === 'AbortError' ? 'timeout' : (err.message || 'unreachable');
    }
    return b.ok;
  }

  async function loadBridgeApps() {
    try {
      const d = await bGet('/api/apps', 8000);
      state.bridge.apps = d.apps || [];
    } catch (e) {
      state.bridge.apps = [];
      if (e && e.code === 401) state.bridge.needPair = true;
    }
  }

  async function loadBridgeContacts() {
    try {
      const d = await bGet('/api/contacts', 15000);
      state.bridge.contacts = d.contacts || [];
      state.bridge.inbox = d.inbox || '';
      state.bridge.inboxOnly = !!d.inboxOnly;
      state.bridge.contactsErr = null;
    } catch (e) {
      state.bridge.contacts = [];
      if (e && e.code === 401) state.bridge.needPair = true;
      // 失败不能静默成「投递箱是空的」，否则用户会以为没数据
      state.bridge.contactsErr = (e && e.code) ? ('读取失败（' + e.code + '）') : '读取失败：连不上助手';
    }
  }

  /* ---- 本地记住「哪个联系人导进了哪个对象」 ---- */
  function linkKey() { return 'crushlens_bridge_links_' + (state.me ? state.me.id : 'x'); }
  function autoKey() { return 'crushlens_bridge_auto_' + (state.me ? state.me.id : 'x'); }
  function loadLinks() {
    try { return JSON.parse(localStorage.getItem(linkKey()) || '{}'); } catch (e) { return {}; }
  }
  function saveLinks(v) {
    try { localStorage.setItem(linkKey(), JSON.stringify(v)); } catch (e) { }
  }
  function loadAutoFlag() {
    try { return localStorage.getItem(autoKey()) === '1'; } catch (e) { return false; }
  }
  function saveAutoFlag(v) {
    try { localStorage.setItem(autoKey(), v ? '1' : '0'); } catch (e) { }
  }

  async function viewLocal() {
    $('#main').innerHTML = `<div class="card pad center muted small" style="padding:64px">
      <span class="dot pulse" style="background:var(--rose);display:inline-block;margin-right:8px"></span>正在检测本机助手…</div>`;
    const ok = await bridgeProbe();
    if (ok) await Promise.all([loadBridgeApps(), loadBridgeContacts()]);
    renderLocal();
    if (ok) startAutoSync();
  }

  function connBadge() {
    const b = state.bridge;
    if (b.ok) {
      return `<span class="conn on"><i></i>已连接 · ${esc((b.info && b.info.host) || '本机')}</span>`;
    }
    if (b.needPair) {
      return `<span class="conn off"><i></i>助手已启动 · 待配对</span>`;
    }
    return `<span class="conn off"><i></i>未连接</span>`;
  }

  function renderLocal() {
    const b = state.bridge;
    const headHtml = head(
      '直连本机',
      '不用再手动找文件：连上这台电脑，直接点一个人，一键把聊天记录搬进来',
      `${connBadge()}<button class="btn ghost sm" id="bRefresh">${icon('refresh', 14)} 重新检测</button>`
    );
    let body;
    if (b.ok) body = localOnlineHtml();
    else if (b.needPair) body = localPairHtml();
    else body = localOfflineHtml();
    $('#main').innerHTML = headHtml + body;
    $('#bRefresh').onclick = async () => {
      await viewLocal();
      const s = state.bridge;
      toast(s.ok ? '已连接本机助手' : (s.needPair ? '助手在运行，等你输入配对码' : '还没检测到助手'), s.ok ? '' : 'warn');
    };
    if (b.ok) bindLocalOnline();
    else if (b.needPair) bindLocalPair();
    else bindLocalOffline();
  }

  /* ---------- 待配对：输入助手窗口里的 6 位配对码 ---------- */
  function localPairHtml() {
    return `
      <div class="card pad mb16" style="max-width:520px">
        <div class="bridge-hero">
          <div class="bh-ico">${icon('lock', 22)}</div>
          <div style="min-width:0">
            <h3>最后一步：输入配对码</h3>
            <p class="small muted mt8">
              助手已经在你电脑上跑起来了。为了不让别的网页偷偷读你的聊天记录，
              助手每次启动都会生成一个新的 6 位配对码，显示在它的黑色窗口里。
            </p>
          </div>
        </div>
        <div class="mt16">
          <label class="tiny muted" style="display:block;margin-bottom:6px">配对码（6 位数字）</label>
          <input id="pairCode" class="input" inputmode="numeric" maxlength="6" autocomplete="one-time-code"
                 placeholder="例如 482913" style="font-family:var(--mono);font-size:20px;letter-spacing:6px;text-align:center">
          <div id="pairMsg" class="tiny mt8" style="color:var(--danger);min-height:18px"></div>
          <button class="btn primary mt8" id="pairBtn" style="width:100%">连接这台电脑</button>
        </div>
        <div class="card-foot tiny muted mt16">
          找不到配对码？回到那个黑色窗口，第一行黄字就是。
          关掉助手窗口再重新双击「启动助手.bat」，会生成一个新的。
        </div>
      </div>
    `;
  }

  function bindLocalPair() {
    const inp = $('#pairCode');
    const btn = $('#pairBtn');
    const msg = $('#pairMsg');
    if (!inp || !btn) return;
    inp.focus();
    const submit = async () => {
      const code = inp.value.replace(/\D/g, '');
      if (code.length !== 6) { msg.textContent = '请填满 6 位数字'; return; }
      btn.disabled = true;
      btn.textContent = '连接中…';
      msg.textContent = '';
      try {
        const ok = await bridgePair(code);
        if (!ok) { msg.textContent = '配对码不对，看一眼助手窗口里的黄字'; return; }
        await viewLocal();
      } catch (e) {
        msg.textContent = e && e.code === 429
          ? '试错次数太多，等 1 分钟再试'
          : '连不上助手，确认那个黑色窗口还开着';
      } finally {
        btn.disabled = false;
        btn.textContent = '连接这台电脑';
      }
    };
    btn.onclick = submit;
    inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
  }

  /* ---------- T2：四种失败态，各自不同的文案与下一步 ---------- */
  function bridgeErrorHtml() {
    const e = state.bridge.error;
    if (!e) return '';
    if (e === 401 || e === '401') {
      return `<div class="bridge-warn b-paired mt12">${icon('lock', 14)} <b>助手在运行，但还没配对。</b>助手每次启动会生成新的 6 位配对码，显示在它的黑色窗口第一行。点下方「我下载好了，现在连接」输入配对码即可。</div>`;
    }
    if (e === 'timeout') {
      return `<div class="bridge-warn mt12">${icon('clock', 14)} <b>请求超时了。</b>通常是 17321 端口被别的程序占用，或防火墙拦住了本机连接。先关掉可能占用端口的程序，再确认防火墙允许「心动镜连接助手」，然后点「重新检测」。</div>`;
    }
    if (e === 'FETCH_FAILED') {
      return `<div class="bridge-warn b-cors mt12">${icon('alert', 14)} <b>浏览器拦住了这个本机地址。</b>Chrome / Edge 的「本地网络访问」权限没有放行 127.0.0.1。请在地址栏左侧的站点设置里把「本地网络访问」改为允许，然后点「重试连接」。<br><span class="tiny">如果助手根本没启动，也会看到同样的提示——请先双击「启动助手.bat」再重试。</span><button class="btn ghost sm" id="bRetryLocalNet" style="display:block;margin-top:8px">${icon('refresh', 13)} 重试连接</button></div>`;
    }
    // ERR_CONNECTION_REFUSED 及其它：助手没启动
    return `<div class="bridge-warn mt12">${icon('alert', 14)} <b>助手还没有启动。</b>点击下面的绿色按钮下载压缩包，解压后双击里面的「启动助手.bat」，看到黑色窗口里出现 6 位配对码就算成功。</div>`;
  }

  /* ---------- 未连接：引导 ---------- */
  function localOfflineHtml() {
    const b = state.bridge;
    const winOnly = !IS_WIN;
    return `
      <div class="card pad bridge-hero mb16">
        <div class="bh-ico">${icon('wifi', 22)}</div>
        <div style="min-width:0">
          <h3>把「本机助手」打开，就能直接选人导入</h3>
          <p class="small muted mt8">
            助手是一个几十 KB 的小程序，只在你自己的电脑上运行，只监听本机地址 <code>127.0.0.1:17321</code>，
            <b>不联网、不上传、不写注册表</b>。它会帮你把电脑上的聊天记录来源整理成「联系人列表」，
            你在这页点一下名字就导进来了。
          </p>
          ${bridgeErrorHtml()}
        </div>
      </div>

      ${winOnly ? `<div class="bridge-warn mb16">${icon('alert', 14)} 本机助手目前只支持 Windows 电脑。iPhone / 安卓手机、Mac 暂时用不了，可以先用手动导入。</div>` : ''}

      <div class="steps3 mb16">
        <div class="st">
          <span class="n">1</span>
          <h4>下载助手（v2）</h4>
          <p>下载压缩包，里面已含启动器，解压到任意文件夹即可。</p>
          <a class="bridge-dl-primary" href="assistant/心动镜连接助手-v2.zip" download="心动镜连接助手-v2.zip">${icon('import', 15)} 下载连接助手 v2（zip，含启动器）</a>
          <div class="tiny muted mt8">下载完成后文件在你的「下载」文件夹里，解压后双击即可。浏览器若提示保留，选「保留」。</div>
          <div class="bridge-sub-links">只要单个文件：<a href="assistant/连接助手.ps1" download="连接助手.ps1">连接助手.ps1</a> ·
            <a href="assistant/启动助手.bat" download="启动助手.bat">启动助手.bat</a></div>
        </div>
        <div class="st">
          <span class="n">2</span>
          <h4>双击「启动助手.bat」</h4>
          <p>会弹出一个黑色窗口，里面有一行黄字「配对码 123456」就说明成功了。</p>
          <div class="code-box">看到「本机连接助手 已就绪」<br>以及一行 6 位配对码</div>
          <div class="tiny muted mt8">如果 Windows 弹出「已保护你的电脑」，点「更多信息 → 仍要运行」。</div>
        </div>
        <div class="st">
          <span class="n">3</span>
          <h4>我下载好了，现在连接</h4>
          <p>点下面按钮，页面先探测助手是否已启动，然后让你输入那 6 位配对码即可接通。</p>
          <button class="btn primary sm" id="bGotIt">${icon('wifi', 14)} 我下载好了，现在连接</button>
          <div class="tiny muted mt8" style="margin-top:8px">如果 Windows / 浏览器问「允许访问你的本地网络」，点【允许】。</div>
        </div>
      </div>

      <div class="card pad">
        <div class="row between wrap" style="gap:12px">
          <div style="min-width:0">
            <strong style="font-size:13px">不想装东西？先看看效果</strong>
            <p class="small muted mt6">用一份模拟的「本机联系人」走一遍完整流程：选人 → 一键导入 → 出曲线。</p>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn ghost sm" id="bDemo">${icon('spark', 14)} 看演示</button>
            <button class="btn primary sm" data-go="import">手动导入</button>
          </div>
        </div>
      </div>

      <div class="card pad mt16">
        <h3 style="font-size:13.5px;margin-bottom:10px">关于隐私，一句话说清</h3>
        <div class="tiny muted" style="line-height:1.9">
          · 助手只读<b>文件</b>，不改、不删、不上传；所有解析都在你的浏览器里完成。<br>
          · 它只监听 <code>127.0.0.1</code>，局域网里别的设备连不进来。<br>
          · <b>但"只有本机能连"并不等于安全</b>：浏览器本身就能访问 127.0.0.1，所以助手 v2 要求先用窗口里的 6 位配对码换一个随机 Token，
            之后所有接口都要带这个 Token；并且只接受本应用与 <code>localhost</code> 的网页来源，其他网站发起的请求一律拒绝。<br>
          · 默认<b>只扫描投递箱</b>这一个文件夹，不会去翻你的桌面和下载目录；想扩大范围要自己加参数启动。<br>
          · 微信 / QQ 的聊天数据库是加密的，任何程序都无法直接读取——助手会检测到并告诉你，你需要用它们自带的「导出」功能生成 txt，放进投递箱，之后就能一键导入。
        </div>
      </div>
    `;
  }

  function bindLocalOffline() {
    const r = $('#bRetry');
    if (r) r.onclick = async () => {
      r.disabled = true; r.textContent = '检测中…';
      await viewLocal();
    };
    const rl = $('#bRetryLocalNet');
    if (rl) rl.onclick = async () => {
      rl.disabled = true; rl.textContent = '重试中…';
      await viewLocal();
    };
    // T2：先探活 /api/ping，通了就进配对界面，否则给出对应失败态
    const got = $('#bGotIt');
    if (got) got.onclick = async () => {
      got.disabled = true; const old = got.textContent; got.textContent = '检测助手中…';
      const ok = await bridgeProbe();
      if (ok) { await loadBridgeApps(); await loadBridgeContacts(); renderLocal(); startAutoSync(); }
      else {
        renderLocal();
        toast(state.bridge.needPair ? '助手已就绪，输入配对码' : '还没检测到助手，看上面的提示', state.bridge.needPair ? '' : 'warn');
      }
      got.disabled = false; got.textContent = old;
    };
    const d = $('#bDemo');
    if (d) d.onclick = () => runBridgeDemo();
    bindGo();
  }

  /* ---------- 已连接：控制台 ---------- */
  function localOnlineHtml() {
    const b = state.bridge;
    const info = b.info || {};
    const mins = Math.max(0, Math.round((info.uptime || 0) / 60));
    const contacts = filteredContacts();
    const linked = Object.keys(b.links || {}).length;
    const appMeta = {
      wechat: { label: '微信', color: '#07c160', short: '微' },
      qq: { label: 'QQ', color: '#12b7f5', short: 'Q' },
      dingtalk: { label: '钉钉', color: '#3f7dff', short: '钉' }
    };

    const appCards = (b.apps || []).map((a) => {
      const m = appMeta[a.key] || { label: a.label, color: cssVar('--ink-3', '#888'), short: '?' };
      const stateTxt = a.running ? '正在运行' : a.installed ? '已安装 · 未运行' : '未检测到';
      const dotCls = a.running ? 'live' : a.installed ? 'idle' : 'off';
      let note = '';
      if (!a.installed) note = '这台电脑上没装';
      else if (a.dbState === 'encrypted') note = '数据库已加密，需要先导出成 txt';
      else if (a.dbState === 'plain') note = '数据库未加密，可以直接读';
      else note = a.dataDir ? '已找到数据目录' : '没找到数据目录';
      return `<div class="appcard">
        <div class="ac-top">
          <span class="ac-ico" style="background:${m.color}1a;color:${m.color}">${m.short}</span>
          <div style="min-width:0">
            <div class="ac-name">${esc(m.label)}<i class="dot ${dotCls}"></i></div>
            <div class="ac-state">${stateTxt}</div>
          </div>
        </div>
        <div class="ac-note">${esc(note)}</div>
        <button class="btn ghost sm" data-apphint="${a.key}" style="width:100%">${a.dbState === 'encrypted' ? '怎么导出？' : '查看说明'}</button>
      </div>`;
    }).join('');

    const inboxCard = `<div class="appcard inbox">
      <div class="ac-top">
        <span class="ac-ico" style="background:var(--rose-soft);color:var(--rose)">${icon('folder', 16)}</span>
        <div style="min-width:0">
          <div class="ac-name">投递箱<i class="dot live"></i></div>
          <div class="ac-state">${b.contacts.length} 个聊天文件 · ${b.inboxOnly ? '仅扫这一个文件夹' : '含桌面/下载'}</div>
        </div>
      </div>
      <div class="ac-note">丢进去就自动出现，不用每次上传</div>
      <button class="btn ghost sm" id="bOpenInbox" style="width:100%">打开文件夹</button>
    </div>`;

    const rows = contacts.map((c) => {
      const link = b.links[c.id];
      const done = link && link.mtime >= c.mtime;
      const plat = (E.PLATFORM_META[c.platform] || {}).label || '未知';
      return `<div class="crow" data-cid="${esc(c.id)}">
        ${avatar(c.name, S.pickColor(c.name), 40)}
        <div class="cr-main">
          <div class="cr-name">${esc(c.name)}
            <span class="badge gray">${esc(plat)}</span>
            ${done ? `<span class="badge ok">${icon('check', 11)} 已导入</span>` : ''}
          </div>
          <div class="cr-sub">${fmtNum(c.count)} 条 · ${relTime(new Date(c.modified).getTime())}更新 · ${esc(c.source)}</div>
        </div>
        <button class="btn ${done ? 'ghost' : 'primary'} sm" data-imp="${esc(c.id)}">${done ? '导入新增' : '一键导入'}</button>
      </div>`;
    }).join('');

    return `
      <div class="dev-strip mb16">
        <span class="ds-dot"></span>
        <div class="ds-main">
          <b>${esc(info.host || '本机')}</b>
          <span>${esc(info.os || 'Windows')} · 助手 v${esc(info.version || '1')} · 已连接 ${mins} 分钟</span>
        </div>
        <div class="spacer"></div>
        <button class="btn ghost sm" id="bDisconnect">断开</button>
      </div>

      <div class="appgrid mb16">${appCards}${inboxCard}</div>

      <div class="card mb16">
        <div class="card-head">
          <div>
            <h3>可以导入的对话</h3>
            <div class="sub">点一下就进来，重复内容会自动跳过</div>
          </div>
          <div class="spacer"></div>
          <div class="row" style="gap:8px">
            <div class="search-box">
              ${icon('search', 14)}
              <input id="bSearch" placeholder="搜索联系人" value="${esc(b.q)}">
            </div>
            <div class="seg">
              <button data-sort="recent" class="${b.sort === 'recent' ? 'active' : ''}">最近</button>
              <button data-sort="count" class="${b.sort === 'count' ? 'active' : ''}">消息多</button>
            </div>
          </div>
        </div>
        <div class="card-body" id="clist">
          ${contacts.length ? rows : (b.contactsErr
      ? empty('alert', '读取联系人失败', b.contactsErr + '。助手窗口还开着吗？关了窗口就重启一次再试。',
        `<button class="btn primary" id="bRetryList">重试</button>`)
      : empty('search', '投递箱还是空的', '把导出的聊天记录（txt / json / csv）拖进投递箱文件夹，这里 3 秒内就会自动出现。',
        `<button class="btn primary" id="bOpenInbox2">打开投递箱</button>`))}
        </div>
        <div class="card-foot tiny muted">
          为什么看不到微信里的联系人？微信电脑版的聊天数据库是加密的，任何程序都读不了。
          你需要把聊天记录导出成 txt（或用开源工具转成 txt），之后放进投递箱，这里就会自动列出所有人。
        </div>
      </div>

      <div class="card pad">
        <div class="row between wrap" style="gap:14px">
          <div style="min-width:0">
            <strong style="font-size:13px">后台自动同步</strong>
            <p class="small muted mt6">
              开着这个页面时，每 20 秒检查一次你已导入的文件有没有更新，有就自动补进来并重算曲线。
              已记住 ${linked} 个联系人。
            </p>
          </div>
          <label class="switch">
            <input type="checkbox" id="bAuto" ${b.auto ? 'checked' : ''}>
            <span class="track"><span class="knob"></span></span>
            <span class="sw-txt">${b.auto ? '已开启' : '关闭'}</span>
          </label>
        </div>
      </div>
    `;
  }

  function filteredContacts() {
    const b = state.bridge;
    let list = b.contacts.slice();
    const q = (b.q || '').trim().toLowerCase();
    if (q) list = list.filter((c) => String(c.name).toLowerCase().includes(q));
    if (b.sort === 'count') list.sort((x, y) => (y.count || 0) - (x.count || 0));
    else list.sort((x, y) => (y.mtime || 0) - (x.mtime || 0));
    return list;
  }

  function bindLocalOnline() {
    const b = state.bridge;
    const dis = $('#bDisconnect');
    if (dis) dis.onclick = async () => {
      const ok = await confirmDlg({ title: '断开本机助手', text: '只是让这个页面不再读取本机数据，助手程序还在运行。想彻底关掉，关掉那个黑窗口就行。', okText: '断开' });
      if (!ok) return;
      b.ok = false; b.info = null;
      renderLocal();
    };
    $$('#bOpenInbox, #bOpenInbox2').forEach((x) => x.onclick = async () => {
      try { await bPost('/api/open-inbox', 3000); toast('已在电脑上打开投递箱文件夹'); }
      catch (e) { toast('打开失败，可以手动去：' + (b.inbox || '文档\\心动镜导入'), 'warn'); }
    });
    const rl = $('#bRetryList');
    if (rl) rl.onclick = async () => { rl.disabled = true; rl.textContent = '重试中…'; await viewLocal(); };
    const se = $('#bSearch');
    if (se) {
      se.oninput = () => {
        b.q = se.value;
        const box = $('#clist');
        const list = filteredContacts();
        if (!box) return;
        box.innerHTML = list.length ? list.map(crowHtml).join('') : `<p class="muted small" style="padding:20px 0">没有匹配的联系人</p>`;
        bindCrows();
      };
    }
    $$('[data-sort]').forEach((x) => x.onclick = () => { b.sort = x.dataset.sort; renderLocal(); });
    $$('[data-apphint]').forEach((x) => x.onclick = () => appHint(x.dataset.apphint));
    const au = $('#bAuto');
    if (au) au.onchange = () => {
      b.auto = au.checked;
      saveAutoFlag(b.auto);
      if (b.auto) { startAutoSync(); toast('已开启自动同步，别关这个页面'); }
      else toast('已关闭自动同步');
      renderLocal();
    };
    bindCrows();
  }

  function crowHtml(c) {
    const b = state.bridge;
    const link = b.links[c.id];
    const done = link && link.mtime >= c.mtime;
    const plat = (E.PLATFORM_META[c.platform] || {}).label || '未知';
    return `<div class="crow" data-cid="${esc(c.id)}">
      ${avatar(c.name, S.pickColor(c.name), 40)}
      <div class="cr-main">
        <div class="cr-name">${esc(c.name)}
          <span class="badge gray">${esc(plat)}</span>
          ${done ? `<span class="badge ok">${icon('check', 11)} 已导入</span>` : ''}
        </div>
        <div class="cr-sub">${fmtNum(c.count)} 条 · ${relTime(new Date(c.modified).getTime())}更新 · ${esc(c.source)}</div>
      </div>
      <button class="btn ${done ? 'ghost' : 'primary'} sm" data-imp="${esc(c.id)}">${done ? '导入新增' : '一键导入'}</button>
    </div>`;
  }

  function bindCrows() {
    $$('[data-imp]').forEach((x) => x.onclick = () => {
      const c = state.bridge.contacts.find((k) => k.id === x.dataset.imp);
      if (c) importFromBridge(c, x);
    });
  }

  function appHint(key) {
    const b = state.bridge;
    const app = (b.apps || []).find((a) => a.key === key) || {};
    const data = {
      wechat: {
        title: '微信怎么导进来',
        html: `
          <div class="prose">
            <p>微信电脑版把聊天记录存成加密数据库（我在这台电脑上验证过：文件头不是 <code>SQLite</code>，是加密的），
            所以<b>任何软件都不能直接读</b>——这不是权限问题，是加密。</p>
            <p>官方也没有导出按钮，所以有三条实用路径：</p>
          </div>
          <div class="advice-list mt12">
            <div class="advice-item"><span class="n">1</span><span><b>多选复制</b>：电脑微信打开和 TA 的聊天窗口，右键任意消息 → <b>多选</b> → 勾选 → 右键 → 复制，然后到「导入记录」页粘贴。一次能选几百条。</span></div>
            <div class="advice-item"><span class="n">2</span><span><b>开源工具导出</b>：用 WeChatMsg / chatlog 这类工具把聊天记录导出成 txt，直接丢进投递箱，这里就会自动出现人名，一键导入。</span></div>
            <div class="advice-item"><span class="n">3</span><span><b>手机端</b>：微信「我 → 设置 → 聊天 → 聊天记录迁移与备份 → 迁移到电脑」，迁移完再配合上面的工具。</span></div>
          </div>
          <div class="auth-note mt12"><b>助手能帮你做的：</b>一旦 txt 落在投递箱或下载文件夹里，助手会自动认出来、自动归到人名下，你不用再一个个选文件。</div>
        `
      },
      qq: {
        title: 'QQ 怎么导进来',
        html: `<div class="prose"><p>QQ 的好处是有官方导出：</p></div>
          <div class="advice-list mt12">
            <div class="advice-item"><span class="n">1</span><span>打开 QQ → 左下角主菜单 → <b>消息管理</b>（或「工具 → 消息管理器」）</span></div>
            <div class="advice-item"><span class="n">2</span><span>左侧选中和 TA 的会话 → 右键 → <b>导出消息记录</b> → 选 <b>txt</b></span></div>
            <div class="advice-item"><span class="n">3</span><span>保存到「文档\\心动镜导入」，助手会自动列出来，一键导入</span></div>
          </div>`
      },
      dingtalk: {
        title: '钉钉怎么导进来',
        html: `<div class="prose"><p>钉钉没有开放本地消息读取，也没有导出 txt 的入口。可行的办法：</p></div>
          <div class="advice-list mt12">
            <div class="advice-item"><span class="n">1</span><span>在钉钉里选中消息 → 复制 → 粘贴到「导入记录」页</span></div>
            <div class="advice-item"><span class="n">2</span><span>或者手动存成 txt 放进投递箱</span></div>
          </div>`
      }
    }[key] || { title: '说明', html: '<p class="muted">暂无说明</p>' };

    modal({
      title: data.title,
      sub: app.dataDir ? '数据目录：' + app.dataDir : '',
      html: data.html,
      footer: `<button class="btn ghost" data-close>知道了</button>
               <button class="btn primary" data-open-inbox>打开投递箱</button>`,
      onMount: (wrap, close) => {
        const btn = wrap.querySelector('[data-open-inbox]');
        if (btn) btn.onclick = async () => {
          try { await bPost('/api/open-inbox', 3000); toast('已打开投递箱'); } catch (e) { toast('打开失败，可以手动去：' + (state.bridge.inbox || '文档\\心动镜导入'), 'warn'); }
          close();
        };
      }
    });
  }

  /* ---------- 导入流程 ---------- */
  async function importFromBridge(c, btn) {
    if (state.bridge.busy) return;
    state.bridge.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '读取中…'; }

    let data, parsed;
    try {
      if (c.demo) {
        data = { text: demoChatText(c.demo, c.name), name: c.name };
        parsed = E.parseChat(data.text, c.name);
      } else {
        data = await bGet('/api/messages?id=' + encodeURIComponent(c.id), 25000);
        parsed = E.parseChat(data.text || '', data.name || c.name);
      }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '一键导入'; }
      state.bridge.busy = false;
      toast('读不到这个文件：' + (err.message || ''), 'error');
      return;
    }
    if (btn) { btn.disabled = false; btn.textContent = '一键导入'; }
    state.bridge.busy = false;

    if (!parsed.messages.length) {
      toast('这个文件里没识别出消息，可能格式特殊', 'warn');
      return;
    }

    const plat = E.PLATFORM_META[parsed.detected] || E.PLATFORM_META.unknown;
    const speakers = parsed.speakers || [];
    const first = parsed.messages[0].time;
    const last = parsed.messages[parsed.messages.length - 1].time;
    const guessMe = speakers.find((s) => /^(我|me|self)$/i.test(s)) ||
      speakers.find((s) => s !== c.name) || speakers[0] || '我';
    const matched = state.partners.find((p) => p.name === c.name);

    const m = modal({
      title: `导入「${c.name}」`,
      sub: '从本机 · ' + c.path,
      html: `
        <div class="parse-summary">
          <span class="badge" style="background:${plat.color}18;color:${plat.color}">${esc(plat.label)}</span>
          <span><b>${parsed.messages.length}</b> 条消息</span>
          <span><b>${speakers.length}</b> 个说话人</span>
          <span class="muted">${first ? fmtDateFull(first) : ''} → ${last ? fmtDateFull(last) : ''}</span>
        </div>
        <div class="row2">
          <div class="field">
            <label>导入到</label>
            <select class="select" id="icTarget">
              <option value="new" ${matched ? '' : 'selected'}>＋ 新建对象「${esc(c.name)}」</option>
              ${state.partners.map((p) => `<option value="${p.id}" ${matched && matched.id === p.id ? 'selected' : ''}>${esc(p.name)}（已有 ${fmtNum(p.msgCount || 0)} 条）</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>导入范围</label>
            <select class="select" id="icRange">
              <option value="0">全部记录</option>
              <option value="7">只导最近 7 天</option>
              <option value="30">只导最近 30 天</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>哪个是你</label>
          <select class="select" id="icMe">
            ${speakers.map((s) => `<option value="${esc(s)}" ${s === guessMe ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
          <div class="hint">用来计算「双向投入」，选错会让曲线失真。</div>
        </div>
        <div class="auth-note">同一份文件重复导入也没关系，系统按「发送人 + 时间 + 内容」去重，只会补进新增的部分。</div>
        <div id="icProg"></div>
      `,
      footer: `<button class="btn ghost" data-close>取消</button>
               <button class="btn primary" id="icGo">开始导入</button>`
    });

    m.el.querySelector('#icGo').onclick = async () => {
      const go = m.el.querySelector('#icGo');
      const prog = m.el.querySelector('#icProg');
      go.disabled = true; go.textContent = '正在写入…';
      prog.innerHTML = `<div class="ic-steps"><i class="on"></i><i class="on"></i><i></i> 正在解析并写入本地数据库…</div>`;

      try {
        const target = m.el.querySelector('#icTarget').value;
        const days = +m.el.querySelector('#icRange').value;
        const me = m.el.querySelector('#icMe').value;

        let msgs = parsed.messages.slice();
        if (days > 0) {
          const cut = Date.now() - days * 86400000;
          msgs = msgs.filter((x) => x.time && x.time.getTime() >= cut);
        }
        if (!msgs.length) { toast('这个范围内没有消息，换「全部记录」试试', 'warn'); go.disabled = false; go.textContent = '开始导入'; return; }

        const payload = { messages: msgs, platform: parsed.platform, detected: parsed.detected, speakers: parsed.speakers };

        let pid, partner;
        if (target === 'new') {
          partner = await S.createPartner(state.me.id, {
            name: c.name, platform: parsed.platform || c.platform,
            mode: 'crush', note: '来自本机 · ' + c.source, meSpeaker: me
          });
          pid = partner.id;
        } else {
          pid = +target;
          await S.updatePartner(state.me.id, pid, { meSpeaker: me }).catch(() => { });
        }

        const res = await S.importMessages(state.me.id, pid, payload, {
          source: parsed.detected || parsed.platform,
          fileName: '本机·' + c.name
        });

        prog.innerHTML = `<div class="ic-steps"><i class="on"></i><i class="on"></i><i class="on"></i> 正在生成复盘报告…</div>`;

        await loadPartners();
        const { a } = await compute(pid);
        if (!a.empty) {
          await S.saveReport(state.me.id, pid, a, modeOf(pid));
          await S.updatePartner(state.me.id, pid, { lastAnalysis: a.total });
        }

        const b = state.bridge;
        b.links[c.id] = { pid, mtime: c.mtime, name: c.name, at: Date.now() };
        saveLinks(b.links);

        m.close();
        state.pid = pid;
        renderPartnerList();
        toast(res.added ? `已导入 ${res.added} 条${res.skipped ? `，跳过重复 ${res.skipped} 条` : ''}` : '没有新消息，文件已经导过了',
          res.added ? '' : 'warn');
        await renderLocal();
      } catch (err) {
        console.error(err);
        prog.innerHTML = `<div class="bridge-warn">${icon('alert', 14)} ${esc(err.message || '导入失败')}</div>`;
        go.disabled = false; go.textContent = '重试';
      }
    };
  }

  /* ---------- 自动同步 ---------- */
  let autoTimer = null;
  function startAutoSync() {
    if (autoTimer) return;
    autoTimer = setInterval(autoSyncTick, 20000);
  }
  async function autoSyncTick() {
    const b = state.bridge;
    if (!b.auto || !b.ok || document.hidden || b.busy) return;
    if (!state.me) return;
    b.busy = true;
    let added = 0;
    try {
      const d = await bGet('/api/contacts', 12000);
      const list = d.contacts || [];
      for (const c of list) {
        const link = b.links[c.id];
        if (!link || !link.pid) continue;
        if (link.mtime && c.mtime <= link.mtime) continue;
        const data = await bGet('/api/messages?id=' + encodeURIComponent(c.id), 25000);
        const parsed = E.parseChat(data.text || '', data.name || c.name);
        if (!parsed.messages.length) { link.mtime = c.mtime; continue; }
        const r = await S.importMessages(state.me.id, link.pid, parsed, {
          source: parsed.detected || parsed.platform, fileName: '本机·' + c.name + '（自动同步）'
        });
        if (r.added) {
          added += r.added;
          const { a } = await compute(link.pid);
          if (!a.empty) {
            await S.saveReport(state.me.id, link.pid, a, modeOf(link.pid));
            await S.updatePartner(state.me.id, link.pid, { lastAnalysis: a.total });
          }
        }
        link.mtime = c.mtime;
        b.links[c.id] = link;
        saveLinks(b.links);
      }
      if (added) {
        await loadPartners();
        toast(`自动同步：新增 ${added} 条消息`);
        if (state.view === 'local') await renderLocal();
      }
    } catch (e) {
      // 静默失败，下一轮再试
    } finally {
      b.busy = false;
    }
  }

  /* ---------- 演示：模拟一台连上的电脑 ---------- */
  function demoChatText(kind, name) {
    const WARM = ['今天好累啊', '刚下班', '你吃饭了吗', '嘿嘿 你真好', '想你啦', '晚安做个好梦', '今天超开心',
      '谢谢你陪我', '周末一起去看海吧', '抱抱', '别熬夜啦', '到家了跟我说一声'];
    const COOL = ['嗯', '哦', '在忙', '晚点说', '随便吧', '有点烦', '不想聊这个', '算了', '知道了'];
    const NEU = ['在干嘛', '刚吃完饭', '今天天气不错', '还好', '在开会', '晚点回你', '好的', '你也是', '嗯嗯'];
    const days = 26;
    const blocks = [];
    let seed = 11 + kind.length * 37;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const now = Date.now();
    for (let d = days; d >= 0; d--) {
      const p = (days - d) / days;
      let temp = kind === 'rise' ? 0.22 + p * 0.62 : kind === 'fall' ? 0.84 - p * 0.58 : 0.5 + Math.sin(p * 5) * 0.12;
      temp = Math.max(0.08, Math.min(0.95, temp));
      if (rnd() > temp * 0.85 + 0.3) continue;
      const cnt = 2 + Math.round(temp * 6);
      for (let i = 0; i < cnt; i++) {
        const t = new Date(now - d * 86400000);
        t.setHours(9 + Math.floor(rnd() * 13), Math.floor(rnd() * 60), 0, 0);
        const who = rnd() < 0.5 ? name : '我';
        const roll = rnd();
        const bucket = roll < temp ? 'warm' : (rnd() < 0.5 ? 'neu' : 'cool');
        const arr = bucket === 'warm' ? WARM : bucket === 'cool' ? COOL : NEU;
        const txt = arr[Math.floor(rnd() * arr.length)];
        blocks.push(who + '\n' + t.getFullYear() + '年' + (t.getMonth() + 1) + '月' + t.getDate() + '日 ' +
          String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + '\n' + txt);
      }
    }
    return blocks.join('\n\n');
  }

  async function runBridgeDemo() {
    const demoContacts = [
      { id: 'demo:1', name: '林晚', app: 'files', platform: 'wechat', source: '投递箱', count: 386, mtime: Date.now() - 3600e3, demo: 'rise' },
      { id: 'demo:2', name: '陈屿', app: 'files', platform: 'qq', source: '本机文件', count: 214, mtime: Date.now() - 86400e3, demo: 'flat' },
      { id: 'demo:3', name: '苏念', app: 'files', platform: 'dingtalk', source: '投递箱', count: 512, mtime: Date.now() - 3 * 86400e3, demo: 'fall' }
    ];
    state.bridge.ok = true;
    state.bridge.info = {
      host: 'DEMO-PC（演示）', os: 'Windows 11 · 模拟', version: '1.1.0', uptime: 780,
      inbox: '文档\\心动镜导入'
    };
    state.bridge.apps = [
      { key: 'wechat', label: '微信', installed: true, running: true, dataDir: '文档\\WeChat Files', dbState: 'encrypted', readable: false },
      { key: 'qq', label: 'QQ', installed: true, running: false, dataDir: '文档\\Tencent Files', dbState: 'encrypted', readable: false },
      { key: 'dingtalk', label: '钉钉', installed: false, running: false, dataDir: null, dbState: 'none', readable: false }
    ];
    state.bridge.contacts = demoContacts;
    state.bridge.inbox = '文档\\心动镜导入';
    state.bridge.demo = true;
    renderLocal();
    toast('这是演示模式：点「一键导入」可以体验完整流程');
  }

  /* ================= 使用记录 ================= */
  /* ================= AI 建议面板（T5，依赖 T4） ================= */
  function aiBubbleHtml() {
    const has = M && M.hasKey();
    return `<button class="ai-bubble ${has ? '' : 'disabled'}" id="aiBubble" title="${has ? '基于结构化摘要，不泄露聊天原文' : '还没有配置 API key，点此去设置'}">
      ${icon('spark', 15)} 问问 AI ${has ? '' : '<span style="font-size:10px;opacity:.8">（需先配置模型）</span>'}
    </button>`;
  }

  let aiCtx = null;
  function bindAiBubble(pid, a, partner) {
    const b = $('#aiBubble'); if (!b) return;
    // 缓存结构化上下文；原文默认不进 ctx，只有开关打开才补
    const turns = (state._lastRows || []).slice(-12).map((m) => ({
      speaker: m.speaker, text: m.text, isMe: m.speaker === (partner && partner.meSpeaker) || m.speaker === '我'
    }));
    aiCtx = {
      score: a.total, dims: a.dims, momentum: a.momentum,
      turningPoints: (a.changePoints || []).slice(0, 8).map((p) => ({ date: p.date, delta: p.diff })),
      lastTurns: turns, partner: partner && partner.name
    };
    b.onclick = () => {
      if (!M || !M.hasKey()) { goto('settings'); toast('先在这里配置模型 API key', 'warn'); return; }
      openAiPanel();
    };
  }

  function openAiPanel() {
    let panel = $('#aiPanel');
    if (!panel) {
      panel = el('div', 'ai-panel'); panel.id = 'aiPanel'; panel.setAttribute('hidden', '');
      panel.innerHTML = `
        <div class="ai-head">${icon('spark', 16)}<h3>问问 AI</h3>
          <span class="spacer"></span>
          <button class="icon-btn" id="aiClose" aria-label="关闭">${icon('close', 15)}</button></div>
        <div class="ai-msgs" id="aiMsgs"></div>
        <div class="ai-tpls" id="aiTpls"></div>
        <div class="ai-foot">
          <div class="ai-input-row"><input id="aiInput" placeholder="问点什么…" aria-label="问题"><button class="btn primary sm" id="aiSend">发送</button></div>
          <label class="ai-raw-toggle"><input type="checkbox" id="aiRaw"> 允许 AI 读取对话原文（默认关闭，仅发结构化摘要）</label>
        </div>`;
      document.body.appendChild(panel);
      $('#aiClose').onclick = () => { panel.hidden = true; };
      $('#aiTpls').innerHTML = M.TEMPLATES.map((t) => `<button data-q="${esc(t.id)}">${esc(t.label)}</button>`).join('');
      $$('#aiTpls button').forEach((x) => x.onclick = () => {
        const t = M.TEMPLATES.find((y) => y.id === x.dataset.q);
        $('#aiInput').value = t.q; sendAi(t.q);
      });
      $('#aiSend').onclick = () => { const q = $('#aiInput').value.trim(); if (q) sendAi(q); };
      $('#aiInput').onkeydown = (e) => { if (e.key === 'Enter') { const q = $('#aiInput').value.trim(); if (q) sendAi(q); } };
    }
    panel.hidden = false;
    const cfg = M.load();
    $('#aiRaw').checked = cfg.allowRaw;
    $('#aiRaw').onchange = () => { cfg.allowRaw = $('#aiRaw').checked; M.save(cfg); };
    if (!$('#aiMsgs').children.length) addAiMsg('ai', '你好。我已读到这段对话的本地分析结果。默认只看结构化摘要，不会把聊天原文发出去。你可以问我关于趋势、转折或下一步的问题。');
  }

  function addAiMsg(role, text) {
    const box = $('#aiMsgs'); if (!box) return null;
    const d = document.createElement('div');
    d.className = 'ai-msg ' + (role === 'me' ? 'me' : 'ai');
    d.textContent = text;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
    return d;
  }

  async function sendAi(question, retry) {
    const cfg = M.load();
    if (!cfg.key) { toast('还没有配置 API key', 'warn'); return; }
    addAiMsg('me', question);
    const out = addAiMsg('ai', '思考中…');
    const summary = M.buildContext(aiCtx || { dims: {}, lastTurns: [] }, cfg.allowRaw);
    const messages = [
      { role: 'system', content: '你是心动镜的情感复盘助手。只基于给定结构化摘要回答，克制、不臆断、不做关系判决或心理诊断。用中文。' },
      { role: 'user', content: '结构化摘要：\n' + JSON.stringify(summary) + '\n\n问题：' + question }
    ];
    try {
      const full = await M.streamChat(cfg, messages, (delta, acc) => { out.textContent = acc; $('#aiMsgs').scrollTop = $('#aiMsgs').scrollHeight; });
      if (!full) out.textContent = '（没有返回内容）';
    } catch (e) {
      out.innerHTML = '';
      out.textContent = '请求失败：' + e.message + ' ';
      const r = document.createElement('span'); r.className = 'ai-retry'; r.textContent = '重试';
      r.onclick = () => { out.remove(); sendAi(question, true); };
      out.appendChild(r);
    }
  }

  /* ================= 设置（T4 模型接入 / T8 云端账号 / 备份） ================= */
  async function viewSettings() {
    const cfg = M.load();
    const presetOpts = M.PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
    const apiBase = Api ? Api.base() : '';
    const html = `
      ${head('设置', '模型接入、云端账号与数据备份')}

      <div class="card pad mb16">
        <h3 style="font-size:14px;margin:0 0 4px">模型接入</h3>
        <p class="small muted mt6">API key 默认只保存在内存，刷新即失效；勾选「记住」才写入本机。备份 JSON 永不导出 key。</p>
        <div class="grid g-1-1 mt12">
          <div class="field"><label>服务商预设</label><select class="input" id="mPreset">${presetOpts}</select></div>
          <div class="field"><label>Base URL</label><input class="input" id="mBase" value="${esc(cfg.base)}" placeholder="https://api.deepseek.com/v1"></div>
        </div>
        <div class="grid g-1-1 mt8">
          <div class="field"><label>模型 ID</label><input class="input" id="mModel" value="${esc(cfg.model)}" placeholder="deepseek-chat"></div>
          <div class="field"><label>Temperature</label><input class="input" id="mTemp" type="number" min="0" max="2" step="0.1" value="${cfg.temperature}"></div>
        </div>
        <div class="field mt8"><label>API key ${cfg.remember ? '' : '<span class="badge gray">内存模式</span>'}</label>
          <input class="input" id="mKey" type="password" value="${esc(cfg.key)}" placeholder="sk-…" autocomplete="off"></div>
        <label class="row mt8" style="gap:8px;font-size:12.5px"><input type="checkbox" id="mRemember" ${cfg.remember ? 'checked' : ''}> 记住这个 key（写入本机 localStorage）</label>
        <div class="row mt12" style="gap:8px;flex-wrap:wrap">
          <button class="btn primary sm" id="mSave">保存设置</button>
          <button class="btn ghost sm" id="mTest">测试连接</button>
          <span id="mTestMsg" class="small muted"></span>
        </div>
      </div>

      <div class="card pad mb16">
        <h3 style="font-size:14px;margin:0 0 4px">云端账号</h3>
        <p class="small muted mt6">云端只存账号信息（邮箱、昵称、导入次数统计），聊天记录永远只在本机。</p>
        <div class="field mt12"><label>云端接口地址（Worker）</label>
          <input class="input" id="cBase" value="${esc(apiBase)}" placeholder="留空则使用官方默认地址"></div>
        <div class="row mt8" style="gap:8px">
          <button class="btn ghost sm" id="cSave">保存地址</button>
          <button class="btn ghost sm" id="cMe">查看云端账号</button>
        </div>
        <div id="cInfo" class="small muted mt8"></div>
      </div>

      <div class="card pad">
        <h3 style="font-size:14px;margin:0 0 4px">数据备份</h3>
        <p class="small muted mt6">导出 JSON 包含本机记录与账号元数据，明确不含 API key 与会话。</p>
        <div class="row mt12" style="gap:8px;flex-wrap:wrap">
          <button class="btn ghost sm" id="bExport">导出备份 JSON</button>
          <button class="btn ghost sm" id="bImport">导入备份 JSON</button>
          <input type="file" id="bFile" accept="application/json,.json" hidden>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;

    // 预设联动
    const applyPreset = (id) => {
      const p = M.PRESETS.find((x) => x.id === id); if (!p || id === 'custom') return;
      $('#mBase').value = p.base; $('#mModel').value = p.model;
    };
    $('#mPreset').onchange = () => applyPreset($('#mPreset').value);
    const cur = M.PRESETS.find((p) => p.base === cfg.base); if (cur) $('#mPreset').value = cur.id;

    const collect = () => ({
      base: $('#mBase').value.trim(), model: $('#mModel').value.trim(),
      temperature: parseFloat($('#mTemp').value) || 0, key: $('#mKey').value,
      remember: $('#mRemember').checked, allowRaw: cfg.allowRaw
    });
    $('#mSave').onclick = () => {
      M.save(collect());
      toast('模型设置已保存' + ($('#mRemember').checked ? '' : '（key 仅在内存中）'));
      goto('settings', { quiet: true });
    };
    $('#mTest').onclick = async () => {
      const btn = $('#mTest'); btn.disabled = true; $('#mTestMsg').textContent = '测试中…';
      try {
        const r = await M.testConnection(collect());
        $('#mTestMsg').textContent = '连接成功 · 延迟 ' + r.latency + 'ms';
      } catch (e) {
        $('#mTestMsg').textContent = '失败：' + e.message + (e.latency ? '（' + e.latency + 'ms）' : '');
      } finally { btn.disabled = false; }
    };

    $('#cSave').onclick = () => {
      try { Api.setBase($('#cBase').value.trim()); toast('云端地址已保存'); }
      catch (e) { toast(e.message, 'warn'); }
    };
    $('#cMe').onclick = async () => {
      if (!Api.configured()) { $('#cInfo').textContent = '还没配置云端接口地址'; return; }
      try { const r = await Api.me(); $('#cInfo').textContent = '邮箱：' + r.account.email + ' · 登录 ' + r.account.login_count + ' 次 · 追踪对象 ' + r.account.partner_count + ' 个'; }
      catch (e) { $('#cInfo').textContent = '未登录云端：' + e.message; }
    };

    $('#bExport').onclick = async () => {
      const backup = await S.exportBackup();
      backup.localStorage = M.safeLocalSnapshot(); // 明确排除 API key
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '心动镜备份-' + fmtDateFull(Date.now()) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast('备份已导出（不含 API key）');
    };
    $('#bImport').onclick = () => $('#bFile').click();
    $('#bFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const ok = await confirmDlg({ title: '导入备份', text: '会把备份里的记录合并进当前账号，确定继续？', okText: '导入' });
      if (!ok) return;
      try {
        const data = JSON.parse(await f.text());
        const r = await S.importBackup(data);
        toast('已导入 ' + r.rows + ' 条记录');
        goto('settings', { quiet: true });
      } catch (err) { toast('导入失败：' + err.message, 'warn'); }
    };
  }

  async function viewUsage() {
    const all = [];
    for (const p of state.partners) {
      const bs = await S.batchesOf(p.id);
      bs.forEach((b) => all.push({ ...b, partner: p }));
    }
    all.sort((a, b) => b.createdAt - a.createdAt);

    const totalMsgs = state.partners.reduce((s, p) => s + (p.msgCount || 0), 0);
    const totalAdded = all.reduce((s, b) => s + b.added, 0);
    const totalSkipped = all.reduce((s, b) => s + b.skipped, 0);

    const srcCount = {};
    all.forEach((b) => { const k = (E.PLATFORM_META[b.source] || {}).label || b.source; srcCount[k] = (srcCount[k] || 0) + 1; });

    const html = `
      ${head('使用记录', '你导入过的每一段对话，都在这里留了档')}
      <div class="grid g4 mb16">
        ${kpi('累计导入', all.length, '次', `覆盖 ${state.partners.length} 个对象`)}
        ${kpi('累计消息', fmtNum(totalMsgs), '条', `本次新增 ${fmtNum(totalAdded)} 条`)}
        ${kpi('自动去重', fmtNum(totalSkipped), '条', '重复内容不会重复计算')}
        ${kpi('最近导入', all.length ? relTime(all[0].createdAt) : '—', '', all.length ? `到 ${esc(all[0].partner.name)}` : '')}
      </div>

      <div class="grid g-2-1">
        <div class="card">
          <div class="card-head"><div><h3>导入流水</h3><div class="sub">按时间倒序，共 ${all.length} 次</div></div></div>
          <div class="card-body table-wrap">
            ${all.length ? `<table class="tb">
              <thead><tr><th>时间</th><th>对象</th><th>来源</th><th>新增</th><th>跳过</th><th></th></tr></thead>
              <tbody>${all.map((b) => `<tr>
                <td class="small" style="white-space:nowrap">${fmtDT(b.createdAt)}</td>
                <td>${esc(b.partner.name)}</td>
                <td><span class="badge gray">${esc((E.PLATFORM_META[b.source] || {}).label || b.source)}</span>
                  ${b.fileName ? `<div class="tiny muted">${esc(b.fileName)}</div>` : ''}</td>
                <td class="num" style="color:var(--rose)">+${b.added}</td>
                <td class="num muted">${b.skipped}</td>
                <td class="right"><span class="link" data-open-p="${b.partner.id}">查看</span></td>
              </tr>`).join('')}</tbody>
            </table>` : empty('folder', '还没有导入记录', '导入第一段聊天记录后，这里会显示全部历史。',
        `<button class="btn primary" data-go="import">去导入</button>`)}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div><h3>来源分布</h3><div class="sub">你更常用哪种方式导入</div></div></div>
          <div class="card-body">
            ${all.length ? donut(srcCount, { label: '导入次数' }) : '<div class="chart-empty">暂无数据</div>'}
            <div class="divider"></div>
            <div class="tiny muted" style="line-height:1.8">
              小提示：同一个对象再次导入时，只需要把<b>新的那几天</b>聊天记录复制进来即可。
              系统会按「发送人 + 时间 + 内容」做指纹比对，重复消息自动跳过，曲线不会被打乱。
            </div>
          </div>
        </div>
      </div>
    `;
    $('#main').innerHTML = html;
    bindGo();
    $$('[data-open-p]').forEach((b) => b.onclick = async () => {
      state.pid = +b.dataset.openP;
      renderPartnerList();
      await goto('partner');
    });
  }

  /* ================= 报告列表 ================= */
  async function viewReports() {
    const all = [];
    for (const p of state.partners) {
      const rs = await S.reportsOf(p.id);
      rs.forEach((r) => all.push({ ...r, partner: p }));
    }
    all.sort((a, b) => b.createdAt - a.createdAt);

    const html = `
      ${head('复盘报告', `共 ${all.length} 份快照，每次导入自动生成`)}
      ${all.length ? `<div class="grid g3">${all.map((r) => {
      const p = r.partner;
      return `<div class="card pad" data-open-report2="${r.id}" data-pid="${p.id}" style="cursor:pointer">
          <div class="row between mb12">
            <div class="row">${avatar(p.name, p.color || S.pickColor(p.name), 34)}
              <div><div style="font-weight:600;font-size:13.5px">${esc(p.name)}</div>
                <div class="tiny muted">${fmtDT(r.createdAt)}</div></div>
            </div>
            <div style="font-size:22px;font-weight:750;color:${r.score >= 60 ? 'var(--rose)' : 'var(--ink-2)'}">${r.score}</div>
          </div>
          <div class="row wrap" style="gap:6px">
            <span class="chip">${esc(r.narrative ? r.narrative.level : '')}</span>
            <span class="chip">${r.count} 条</span>
            <span class="chip">${esc((E.PLATFORM_META[p.platform] || {}).label || '')}</span>
          </div>
          <p class="small muted mt12" style="line-height:1.7">${esc((r.narrative && r.narrative.paras[1] || '').replace(/\*\*/g, '').slice(0, 62))}…</p>
        </div>`;
    }).join('')}</div>` : `<div class="card">${empty('report', '还没有报告', '导入一段聊天记录后会自动生成第一份复盘。',
      `<button class="btn primary" data-go="import">去导入</button>`)}</div>`}
    `;
    $('#main').innerHTML = html;
    bindGo();
    $$('[data-open-report2]').forEach((b) => b.onclick = async () => {
      const pid = +b.dataset.pid;
      const r = (await S.reportsOf(pid)).find((x) => x.id === +b.dataset.openReport2);
      if (r) openReportObj({ ...r, partner: state.partners.find((p) => p.id === pid) });
    });
  }

  async function openReport(pid) {
    const reports = await S.reportsOf(pid);
    if (reports.length) openReportObj({ ...reports[0], partner: state.partners.find((p) => p.id === pid) });
    else toast('还没有生成报告', 'warn');
  }

  function openReportObj(r) {
    const p = r.partner || {};
    const n = r.narrative || { paras: [], advice: [], level: '' };
    modal({
      wide: true,
      title: `${p.name || ''} · 复盘报告`,
      sub: `${fmtDT(r.createdAt)} · ${r.count} 条消息 · ${r.firstDay || ''} 至 ${r.lastDay || ''}`,
      html: `
        <div class="grid g-1-2" style="gap:18px">
          <div class="center">
            ${gauge(r.score, { size: 176 })}
            <div class="row" style="justify-content:center;gap:8px;margin-top:4px">
              <span class="chip">${esc(n.level || '')}</span>
            </div>
            <div class="divider"></div>
            ${radar(r.dims)}
          </div>
          <div>
            <div class="prose">
              ${(n.paras || []).map((t) => `<p>${t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`).join('')}
            </div>
            <div class="divider"></div>
            <strong style="font-size:12.5px">下一步建议</strong>
            <div class="advice-list mt8">
              ${(n.advice || []).map((t, i) => `<div class="advice-item"><span class="n">${i + 1}</span><span>${esc(t)}</span></div>`).join('')}
            </div>
          </div>
        </div>
        <div class="divider"></div>
        <strong style="font-size:12.5px">当时的复盘要点</strong>
        <div class="rev-grid mt12">
          ${(r.review || []).map((x) => `<div class="rev ${x.tone}">
            <div class="rev-top"><span class="rev-ico">${icon('spark', 13)}</span><span class="rev-title">${esc(x.title)}</span></div>
            <div class="rev-val">${esc(x.value)}</div>
            <div class="rev-txt">${esc(x.text)}</div>
          </div>`).join('')}
        </div>
      `,
      footer: `<span class="tiny muted" style="margin-right:auto">报告基于本地算法，不含心理诊断</span>
               <button class="btn ghost" data-close>关闭</button>`
    });
  }
})(window);
