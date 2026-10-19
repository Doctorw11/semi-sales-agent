/* 半导体销售陪练陪跑 · 主逻辑 */
(function () {
  'use strict';

  var LS = {
    projects: 'ssa.projects',
    targets: 'ssa.targets',
    activities: 'ssa.activities',
    sparring: 'ssa.sparring',
    cfg: 'ssa.cfg'
  };

  var state = {
    view: 'today',
    projects: [],
    targets: [],
    activities: [],
    activeTargetId: null,
    prospectTab: 'chain',
    activeProjectId: null,
    detailTab: 'facts',
    sparring: null,
    cfg: { baseUrl: '', apiKey: '', model: '' }
  };

  /* ------------------------------------------------------------------ 工具 */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function daysBetween(a, b) {
    if (!a || !b) return null;
    var d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
    if (isNaN(d1) || isNaN(d2)) return null;
    return Math.round((d2 - d1) / 86400000);
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2400);
  }

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { toast('本地存储写入失败'); }
  }

  function stageDef(id) {
    var list = window.STAGE_DEFS;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0];
  }

  function fieldDef(k) {
    var list = window.FIELD_DEFS;
    for (var i = 0; i < list.length; i++) if (list[i].k === k) return list[i];
    return { k: k, label: k };
  }

  /* -------------------------------------------------------------- 进度计算 */

  var FIELD_QUESTIONS = {
    endProduct: '你们这个项目最终做的是哪一类产品？',
    application: '这颗料具体用在电路里的哪一部分？',
    specs: '你们对这颗料的规格要求是什么，有没有必须满足的硬指标？',
    currentSolution: '现在方案上用的是哪个型号？',
    painPoint: '现在这个方案里，有没有让你们比较难受的地方？',
    criteria: '你们评估这类料，主要看哪几项？',
    decisionMaker: '这类料的选型，最后是谁拍板，还有谁会参与评估？',
    timeline: '这个项目大概什么时候量产，中间有哪几个节点？',
    sampleModel: '样品我们送的是哪个型号、送了多少？',
    sampleQty: '样品数量够不够做完整测试？',
    sampleDate: '样品是哪天到的？',
    tester: '这次测试具体是哪位在跟？',
    testProgress: '测试进行到哪一步了？',
    testIssues: '测试过程中有没有出现什么问题？',
    testEta: '预计什么时候能出结果？',
    bomLocked: '我们这颗料有没有正式进你们的 BOM？',
    monthlyVolume: '这个项目量产后，一个月大概用多少？',
    annualVolume: '一年大概的用量是多少？',
    volumeDate: '预计什么时候开始放量？',
    unitPrice: '价格这块你们目前的目标是什么？',
    paymentTerm: '你们这边账期一般是多久？',
    firstOrderQty: '首批订单大概多少量？',
    deliveryDate: '这批货你们希望什么时候到？',
    rollingDemand: '接下来几个月的滚动需求大概是什么节奏？',
    competitor: '这个项目上还有哪家在同时评估？',
    secondSource: '你们有没有考虑保留第二家供应商？'
  };

  var STAGE_RISK = {
    0: '还在线索阶段。如果对方给不出具体项目和节点，说明这只是一个客气话，不是你真正的机会。',
    1: '技术交流阶段。拿不到评估标准，后面的送样就是盲测，测完也不知道为什么没过。',
    2: '样品已经送出去了。没人跟的样品最容易躺在抽屉里，你必须知道谁在测、测什么。',
    3: '测试阶段。如果你只等客户通知，出问题时你一定是最后一个知道的。',
    4: '口头说进 BOM 不算数。要看到实际 BOM 或采购动作，否则这一步最容易空欢喜。',
    5: 'Design-win 之后还有被二供分份额的风险。锁定用量和价格条件才算稳。',
    6: '小批量阶段。这个时候出质量问题，前面所有的工作都要重来。',
    7: '量产阶段最容易放松。份额被慢慢蚕食通常就发生在这时候。'
  };

  function completeness(p) {
    var need = window.STAGE_FACTS[p.stage] || [];
    if (!need.length) return { pct: 100, missing: [] };
    var missing = need.filter(function (k) { return !String(p.fields[k] || '').trim(); });
    return { pct: Math.round((need.length - missing.length) / need.length * 100), missing: missing };
  }

  function projectHealth(p) {
    var t = today();
    if (p.nextDate) {
      var gap = daysBetween(p.nextDate, t);
      if (gap > 0) return { level: 'danger', text: '下次跟进已过期 ' + gap + ' 天' };
      if (gap === 0) return { level: 'warn', text: '今天该跟进' };
    }
    if (p.lastContact) {
      var idle = daysBetween(p.lastContact, t);
      if (idle > 14) return { level: 'danger', text: idle + ' 天没有接触记录' };
    } else {
      return { level: 'warn', text: '还没有接触记录' };
    }
    if (!p.nextDate) return { level: 'warn', text: '没有定下次跟进时间' };
    return { level: 'ok', text: '下次跟进 ' + p.nextDate };
  }

  function buildBriefing(p) {
    var missing = completeness(p).missing;
    var questions = missing.slice(0, 6).map(function (k) {
      return { q: FIELD_QUESTIONS[k] || ('确认' + fieldDef(k).label), why: '项目卡上这个格子是空的：' + fieldDef(k).label };
    });

    var generic = [
      { q: '这个项目接下来最关键的一个节点是什么，大概什么时候？', why: '没有节点的项目等于没有项目' },
      { q: '除了你，还有谁会参与这个决定？', why: '单线联系的项目最容易突然断掉' },
      { q: '这个项目上还有哪家在同时评估？', why: '不知道对手，就无法准备材料' }
    ];
    generic.forEach(function (g) {
      if (questions.length < 6) questions.push(g);
    });

    var risks = [];
    if (STAGE_RISK[p.stage]) risks.push({ level: 'warn', text: STAGE_RISK[p.stage] });
    if (!String(p.fields.decisionMaker || '').trim()) risks.push({ level: 'danger', text: '你还没找到真正拍板选型的人，这个项目的主动权不在你手上。' });
    if (!String(p.fields.competitor || '').trim() && p.stage >= 2) risks.push({ level: 'warn', text: '竞品信息是空白。你不知道在跟谁比，也说不出该突出哪一点。' });
    if (!p.nextDate) risks.push({ level: 'danger', text: '没有下次跟进时间。这个项目实际上已经处于停滞。' });
    var h = projectHealth(p);
    if (p.nextDate && h.level === 'danger') risks.push({ level: 'danger', text: h.text + '，先把这个电话补上。' });

    return { questions: questions, risks: risks };
  }

  /* -------------------------------------------------------------- 视图切换 */

  var NAV = [
    { id: 'today', label: '今天', icon: 'clock' },
    { id: 'agent', label: 'Agent', icon: 'flame' },
    { id: 'sparring', label: '陪练', icon: 'target' },
    { id: 'coaching', label: '陪跑', icon: 'route' },
    { id: 'prospect', label: '找客户', icon: 'layers' },
    { id: 'playbook', label: '底座', icon: 'book' },
    { id: 'settings', label: '设置', icon: 'settings' }
  ];

  function renderNav() {
    var overdue = state.projects.filter(function (p) { return projectHealth(p).level === 'danger'; }).length;
    $('nav').innerHTML = NAV.map(function (n) {
      var badge = (n.id === 'coaching' && overdue) ? '<i class="nav-badge">' + overdue + '</i>' : '';
      return '<button class="nav-item' + (state.view === n.id ? ' active' : '') + '" data-view="' + n.id + '" type="button">' +
        window.ICON(n.icon) + '<span>' + n.label + '</span>' + badge + '</button>';
    }).join('');
    Array.prototype.forEach.call($('nav').querySelectorAll('.nav-item'), function (b) {
      b.addEventListener('click', function () { switchView(b.dataset.view); });
    });
  }

  function switchView(v) {
    state.view = v;
    NAV.forEach(function (n) { $('view-' + n.id).hidden = (n.id !== v); });
    renderNav();
    if (v === 'today') renderToday();
    if (v === 'coaching') renderStats();
    if (v === 'prospect') renderProspect();
    if (v === 'agent') {
      var ai = $('agentInput');
      if (ai) setTimeout(function () { ai.focus(); }, 40);
    }
  }

  /* ------------------------------------------------------------------ 陪练 */

  function renderSceneList() {
    var box = $('sceneList');
    box.innerHTML = window.SCENARIOS.map(function (s) {
      var active = state.sparring && state.sparring.sceneId === s.id;
      var pips = '';
      for (var i = 1; i <= 3; i++) pips += '<i class="pip' + (i <= s.level ? ' on' : '') + '"></i>';
      return '<button class="scene-card' + (active ? ' active' : '') + '" data-scene="' + s.id + '" type="button">' +
        '<h3>' + esc(s.title) + '</h3>' +
        '<div class="scene-tags">' + s.tags.map(function (t, i) {
          return '<span class="tag' + (i === 0 ? ' hot' : '') + '">' + esc(t) + '</span>';
        }).join('') + '</div>' +
        '<div class="scene-meta"><span class="pips">' + pips + '</span><span>' + s.turns.length + ' 轮追问</span></div>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.scene-card'), function (b) {
      b.addEventListener('click', function () { startScene(b.dataset.scene); });
    });
  }

  function startScene(id) {
    var scene = null;
    window.SCENARIOS.forEach(function (s) { if (s.id === id) scene = s; });
    if (!scene) return;
    state.sparring = {
      sceneId: id,
      turnIndex: 0,
      phase: 'answering',
      log: [{ who: 'them', text: scene.turns[0].say, first: true }],
      results: [],
      extra: []
    };
    renderSceneList();
    renderChat();
  }

  function renderChat() {
    var sp = state.sparring;
    var panel = $('chatPanel');
    if (!sp) return;

    var scene = null;
    window.SCENARIOS.forEach(function (s) { if (s.id === sp.sceneId) scene = s; });
    if (!scene) return;

    var logHtml = sp.log.map(function (m) {
      if (m.type === 'feedback') return renderFeedback(m.feedback, m.isLast);
      if (m.type === 'summary') return renderSummary(m.summary, scene);
      if (m.type === 'brief') {
        return '<div class="bubble them" style="max-width:100%;background:#fff;border-style:dashed">' +
          '<div class="who-line">场景</div>' + nl2br(m.text) + '</div>';
      }
      var who = m.who === 'me' ? '你' : scene.them.name + ' · ' + scene.them.role;
      return '<div class="bubble ' + m.who + '"><div class="who-line">' + esc(who) + '</div>' + nl2br(m.text) + '</div>';
    }).join('');

    var dots = '';
    for (var i = 0; i < scene.turns.length; i++) {
      dots += '<i class="pd ' + (i < sp.turnIndex ? 'done' : (i === sp.turnIndex && sp.phase !== 'done' ? 'now' : '')) + '"></i>';
    }

    var composer;
    if (sp.phase === 'answering') {
      composer =
        '<div class="composer">' +
          '<textarea id="sparringInput" placeholder="用你会跟客户说的原话说，别写标准答案。写完按 Ctrl+Enter 提交。"></textarea>' +
          '<div class="composer-bar">' +
            '<span class="tip">第 ' + (sp.turnIndex + 1) + ' / ' + scene.turns.length + ' 轮</span>' +
            '<button class="btn primary" id="btnSubmitReply" type="button">' + window.ICON('send') + '提交</button>' +
          '</div>' +
        '</div>';
    } else if (sp.phase === 'feedback') {
      composer =
        '<div class="composer"><div class="composer-bar">' +
          '<span class="tip">看看上面漏掉的动，再进入下一轮。' + (llmEnabled() ? '已开启大模型，对方会追加一句。' : '') + '</span>' +
          '<div class="row-gap" style="margin:0">' +
            '<button class="btn ghost" id="btnRedo" type="button">' + window.ICON('reset') + '重答这句</button>' +
            '<button class="btn primary" id="btnNextTurn" type="button">' + window.ICON('chevron') + '继续</button>' +
          '</div>' +
        '</div></div>';
    } else {
      composer =
        '<div class="composer"><div class="composer-bar">' +
          '<span class="tip">这轮练完了。换个场景继续，或者重来一次把分刷上去。</span>' +
          '<div class="row-gap" style="margin:0">' +
            '<button class="btn ghost" id="btnRestart" type="button">' + window.ICON('reset') + '重练</button>' +
            '<button class="btn primary" id="btnAnother" type="button">换一个场景</button>' +
          '</div>' +
        '</div></div>';
    }

    panel.innerHTML =
      '<div class="chat-head">' +
        '<div class="who"><strong>' + esc(scene.title) + '</strong>' +
        '<span>' + esc(scene.you) + ' ｜ 对方：' + esc(scene.them.name) + '（' + esc(scene.them.role) + '）</span></div>' +
        '<div class="progress-dots">' + dots + '</div>' +
      '</div>' +
      '<div class="chat-log" id="chatLog">' + logHtml + '</div>' +
      composer;

    var log = $('chatLog');
    if (log) log.scrollTop = log.scrollHeight;

    if (sp.phase === 'answering') {
      var ta = $('sparringInput');
      ta.focus();
      ta.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitReply(); }
      });
      $('btnSubmitReply').addEventListener('click', submitReply);
    } else if (sp.phase === 'feedback') {
      $('btnNextTurn').addEventListener('click', nextTurn);
      $('btnRedo').addEventListener('click', redoTurn);
    } else {
      $('btnRestart').addEventListener('click', function () { startScene(sp.sceneId); });
      $('btnAnother').addEventListener('click', function () {
        state.sparring = null; renderSceneList(); renderChat();
      });
    }
  }

  function renderFeedback(fb, isLast) {
    var g = window.SCORING.grade(fb.score);
    var color = g.key === 'good' ? 'var(--ok)' : (g.key === 'bad' ? 'var(--danger)' : 'var(--warn)');
    var html = '<div class="feedback">' +
      '<div class="fb-head">' +
        '<span class="fb-score ' + g.key + '">' + fb.score + '</span>' +
        '<span class="fb-label">' + esc(g.label) + '</span>' +
      '</div>' +
      '<div class="fb-bar"><i style="width:' + fb.score + '%;background:' + color + '"></i></div>';

    if (fb.mustHits.length) {
      html += '<div class="fb-group"><h4>做对了</h4>' + fb.mustHits.map(function (t) {
        return '<div class="fb-item ok">' + window.ICON('check') + '<span>' + esc(t) + '</span></div>';
      }).join('') + '</div>';
    }
    if (fb.mustMiss.length) {
      html += '<div class="fb-group"><h4>漏掉的</h4>' + fb.mustMiss.map(function (t) {
        return '<div class="fb-item miss">' + window.ICON('alert') + '<span>' + esc(t) + '</span></div>';
      }).join('') + '</div>';
    }
    if (fb.avoidHits.length) {
      html += '<div class="fb-group"><h4>踩到的坑</h4>' + fb.avoidHits.map(function (t) {
        return '<div class="fb-item bad">' + window.ICON('x') + '<span>' + esc(t) + '</span></div>';
      }).join('') + '</div>';
    }
    html += '<details class="model-line"><summary>看一句参考说法</summary><p>' + esc(fb.model) + '</p></details>';
    if (fb.llmNote) {
      html += '<details class="model-line" open><summary>教练补充</summary><p>' + nl2br(fb.llmNote) + '</p></details>';
    }
    return html + '</div>';
  }

  function renderSummary(s, scene) {
    var g = window.SCORING.grade(s.avg);
    return '<div class="feedback">' +
      '<div class="fb-head"><span class="fb-score ' + g.key + '">' + s.avg + '</span>' +
      '<span class="fb-label">整场平均分 ｜ 踩坑 ' + s.traps + ' 次</span></div>' +
      '<div class="fb-bar"><i style="width:' + s.avg + '%;background:var(--accent)"></i></div>' +
      '<div class="fb-group"><h4>这场该记住的</h4>' +
        scene.debrief.map(function (d) {
          return '<div class="fb-item ok">' + window.ICON('flame') + '<span>' + esc(d) + '</span></div>';
        }).join('') +
        (s.llmSummary ? '<div class="fb-item miss">' + window.ICON('users') + '<span>' + nl2br(s.llmSummary) + '</span></div>' : '') +
      '</div>' +
    '</div>';
  }

  function submitReply() {
    var sp = state.sparring;
    var ta = $('sparringInput');
    var text = (ta.value || '').trim();
    if (!text) { toast('先写一句再提交'); ta.focus(); return; }
    if (text.length < 4) { toast('太短了，把你会说的原话说完整'); ta.focus(); return; }

    var scene = null;
    window.SCENARIOS.forEach(function (s) { if (s.id === sp.sceneId) scene = s; });

    var result = window.SCORING.evaluate(scene, sp.turnIndex, text);
    sp.log.push({ who: 'me', text: text });
    sp.results.push(result);

    var isLast = sp.turnIndex >= scene.turns.length - 1;
    sp.log.push({ type: 'feedback', feedback: result, isLast: isLast });
    sp.phase = 'feedback';
    save(LS.sparring, { sceneId: sp.sceneId, results: sp.results });
    renderChat();

    if (llmEnabled()) enrichWithLLM(scene, sp, text, result);
  }

  function redoTurn() {
    var sp = state.sparring;
    while (sp.log.length) {
      var last = sp.log[sp.log.length - 1];
      if (last.who === 'me' || last.type === 'feedback') sp.log.pop();
      else break;
    }
    sp.results.pop();
    sp.phase = 'answering';
    renderChat();
  }

  function nextTurn() {
    var sp = state.sparring;
    var scene = null;
    window.SCENARIOS.forEach(function (s) { if (s.id === sp.sceneId) scene = s; });
    sp.turnIndex += 1;
    if (sp.turnIndex >= scene.turns.length) {
      sp.phase = 'done';
      var summary = window.SCORING.summarize(sp.results);
      sp.log.push({ type: 'summary', summary: summary });
      renderChat();
      if (llmEnabled()) summariseWithLLM(scene, sp);
      return;
    }
    sp.log.push({ who: 'them', text: scene.turns[sp.turnIndex].say });
    sp.phase = 'answering';
    renderChat();
  }

  /* ---------------------------------------------------------- 可选的大模型 */

  function llmEnabled() { return !!(state.cfg.apiKey && state.cfg.baseUrl && state.cfg.model); }

  function llmChat(messages) {
    var url = state.cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.cfg.apiKey },
      body: JSON.stringify({ model: state.cfg.model, messages: messages, temperature: 0.7 })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      return (j.choices && j.choices[0] && j.choices[0].message.content || '').trim();
    });
  }

  /* 带工具调用能力的底层请求，返回完整 message 对象 */
  function llmChatRaw(messages, tools) {
    var url = state.cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    var body = { model: state.cfg.model, messages: messages, temperature: 0.35 };
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.cfg.apiKey },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120)); });
      return r.json();
    }).then(function (j) {
      var msg = j.choices && j.choices[0] && j.choices[0].message;
      if (!msg) throw new Error('返回里没有 message');
      return msg;
    });
  }

  function enrichWithLLM(scene, sp, answer, result) {
    var missed = result.mustMiss.join('；') || '（无）';
    var prompt = [
      { role: 'system', content: '你扮演一位资深半导体 ToB 销售教练。语气直接、具体、不客套。用中文回答，不超过 120 字。' },
      {
        role: 'user',
        content: '场景：' + scene.brief + '\n对方：' + scene.them.name + '（' + scene.them.role + '）\n' +
          '对方刚才说：' + scene.turns[sp.turnIndex].say + '\n' +
          '学员回答：' + answer + '\n' +
          '规则评分漏掉的动作：' + missed + '\n' +
          '请指出这个回答最要命的一个问题，并给出一句可以直接说出口的改法。不要重复规则里的原话。'
      }
    ];
    llmChat(prompt).then(function (txt) {
      if (!txt) return;
      for (var i = sp.log.length - 1; i >= 0; i--) {
        if (sp.log[i].type === 'feedback') { sp.log[i].feedback.llmNote = txt; break; }
      }
      renderChat();
    }).catch(function (e) {
      toast('大模型没连上，已用离线引擎：' + e.message);
    });
  }

  function summariseWithLLM(scene, sp) {
    var transcript = sp.log.filter(function (m) { return m.who; }).map(function (m) {
      return (m.who === 'me' ? '学员：' : '客户：') + m.text;
    }).join('\n');
    llmChat([
      { role: 'system', content: '你是半导体 ToB 销售教练。语气像并肩作战的老兵，直接、不哄人。中文，不超过 150 字。' },
      { role: 'user', content: '场景：' + scene.brief + '\n对话记录：\n' + transcript + '\n请给出这场陪练里最值得改的一个习惯，以及下次对话最该坚持的一个动作。' }
    ]).then(function (txt) {
      if (!txt) return;
      for (var i = sp.log.length - 1; i >= 0; i--) {
        if (sp.log[i].type === 'summary') { sp.log[i].summary.llmSummary = txt; break; }
      }
      renderChat();
    }).catch(function () { /* 离线模式下静默 */ });
  }

  /* ------------------------------------------------------------------ 陪跑 */

  function newProjectId() { return uid(); }

  function currentProject() {
    var id = state.activeProjectId;
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === id) return state.projects[i];
    return null;
  }

  function saveProjects() {
    state.projects.forEach(function (p) { p.updatedAt = new Date().toISOString(); });
    save(LS.projects, state.projects);
    renderNav();
  }

  function renderStats() {
    var t = today();
    var overdue = 0, idle = 0, advanced = 0;
    state.projects.forEach(function (p) {
      if (p.nextDate && daysBetween(p.nextDate, t) > 0) overdue++;
      if (p.lastContact && daysBetween(p.lastContact, t) > 14) idle++;
      else if (!p.lastContact) idle++;
      if (p.stage >= 5) advanced++;
    });
    var cells = [
      { k: '在跟项目', v: state.projects.length, cls: '' },
      { k: '跟进已过期', v: overdue, cls: overdue ? 'danger' : '' },
      { k: '14 天没动静', v: idle, cls: idle ? 'warn' : '' },
      { k: '已到 Design-win', v: advanced, cls: '' }
    ];
    $('statsRow').innerHTML = cells.map(function (c) {
      return '<div class="stat"><span class="k">' + c.k + '</span><span class="v ' + c.cls + '">' + c.v + '</span></div>';
    }).join('');
  }

  function renderProjectList() {
    var box = $('projectList');
    if (!state.projects.length) {
      box.innerHTML = '<div class="panel muted">还没有项目。</div>';
      return;
    }
    var sorted = state.projects.slice().sort(function (a, b) {
      var ra = projectHealth(a).level === 'danger' ? 0 : 1;
      var rb = projectHealth(b).level === 'danger' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return (a.nextDate || '9999') < (b.nextDate || '9999') ? -1 : 1;
    });
    box.innerHTML = sorted.map(function (p) {
      var st = stageDef(p.stage);
      var h = projectHealth(p);
      var dot = h.level === 'danger' ? 'dot-danger' : (h.level === 'warn' ? 'dot-warn' : 'dot-ok');
      var active = p.id === state.activeProjectId;
      return '<button class="proj-card' + (active ? ' active' : '') + '" data-pid="' + p.id + '" type="button">' +
        '<div class="proj-top"><strong>' + esc(p.customer || '未命名客户') + '</strong>' +
        '<span class="stage-pill ' + st.cls + '">' + esc(st.name) + '</span></div>' +
        '<div class="proj-sub">' + esc(p.project || '未填写项目') + '</div>' +
        '<div class="proj-foot"><i class="' + dot + '"></i><span>' + esc(h.text) + '</span></div>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.proj-card'), function (b) {
      b.addEventListener('click', function () {
        state.activeProjectId = b.dataset.pid;
        state.detailTab = 'facts';
        renderProjectList(); renderDetail();
      });
    });
  }

  function renderDetail() {
    var box = $('projectDetail');
    var p = currentProject();
    if (!p) {
      box.innerHTML = '<div class="empty-state"><div class="empty-icon">' + window.ICON('clipboard') + '</div>' +
        '<h2>还没有项目</h2><p>新建一张项目卡，把你手头跟的客户放进来。哪怕信息残缺，先建起来，缺什么一眼就看得到。</p></div>';
      return;
    }
    var st = stageDef(p.stage);
    var tabs = [
      { id: 'facts', label: '事实' },
      { id: 'flow', label: '流程' },
      { id: 'plan', label: '拜访准备' },
      { id: 'log', label: '记录' }
    ];
    box.innerHTML =
      '<div class="detail-head">' +
        '<div class="dh-l"><h2>' + esc(p.customer || '未命名客户') + '</h2>' +
        '<span class="dh-sub">' + esc(p.project || '未填写项目') + (p.owner ? ' ｜ ' + esc(p.owner) : '') + '</span></div>' +
        '<div class="row-gap" style="margin:0">' +
          '<span class="stage-pill ' + st.cls + '">' + esc(st.name) + '</span>' +
          '<button class="btn sm" id="btnEditProject" type="button">' + window.ICON('pen') + '编辑</button>' +
          '<button class="btn sm danger" id="btnDelProject" type="button">' + window.ICON('trash') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="detail-tabs">' + tabs.map(function (t) {
        return '<button class="tab' + (state.detailTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '" type="button">' + t.label + '</button>';
      }).join('') + '</div>' +
      '<div class="detail-body" id="detailBody"></div>';

    Array.prototype.forEach.call(box.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () {
        state.detailTab = b.dataset.tab;
        renderDetail();
      });
    });
    $('btnEditProject').addEventListener('click', function () { openProjectForm(p); });
    $('btnDelProject').addEventListener('click', function () {
      if (!confirm('删除这个项目？删掉就找不回来了。')) return;
      state.projects = state.projects.filter(function (x) { return x.id !== p.id; });
      state.activeProjectId = null;
      saveProjects(); renderStats(); renderProjectList(); renderDetail();
    });

    var body = $('detailBody');
    if (state.detailTab === 'facts') body.innerHTML = renderFactsTab(p);
    if (state.detailTab === 'flow') {
      body.innerHTML = renderFlowTab(p);
      bindFlowTab(p, body);
    }
    if (state.detailTab === 'plan') body.innerHTML = renderPlanTab(p);
    if (state.detailTab === 'log') {
      body.innerHTML = renderLogTab(p);
      bindLogTab(p, body);
    }
  }

  function renderFactsTab(p) {
    var c = completeness(p);
    var need = window.STAGE_FACTS[p.stage] || [];
    var html = '<div class="completeness" style="margin-bottom:14px">' +
      '<span class="fb-label">当前阶段的关键事实</span>' +
      '<div class="cbar"><i style="width:' + c.pct + '%"></i></div>' +
      '<strong>' + c.pct + '%</strong></div>';

    if (need.length) {
      html += '<div class="checklist" style="margin-bottom:16px">' + need.map(function (k) {
        var fd = fieldDef(k);
        var val = String(p.fields[k] || '').trim();
        return '<div class="check-item ' + (val ? 'done' : 'pending') + '">' +
          window.ICON(val ? 'check' : 'circle') +
          '<div><div class="ci-t"><strong>' + esc(fd.label) + '</strong>' +
          (val ? '：' + esc(val) : '：还没问到') + '</div>' +
          (val ? '' : '<div class="ci-h">下次见面把这个问题问掉</div>') + '</div></div>';
      }).join('') + '</div>';
    }

    html += '<h3 style="margin:18px 0 8px">全部事实</h3><div class="fact-grid">' +
      window.FIELD_DEFS.map(function (fd) {
        var v = String(p.fields[fd.k] || '').trim();
        return '<div class="fact"><span class="fk">' + esc(fd.label) + '</span>' +
          '<span class="fv' + (v ? '' : ' empty') + '">' + esc(v || '未填') + '</span></div>';
      }).join('') + '</div>';

    html += '<h3 style="margin:18px 0 8px">关键人</h3><div class="briefing">' +
      (String(p.people || '').trim() ? nl2br(p.people) : '<span class="muted">还没记录。至少记下每个关键人的名字、角色和他关心什么。</span>') + '</div>';
    return html;
  }

  function renderFlowTab(p) {
    p.flow = p.flow || {};
    var steps = window.ORDER_FLOW || [];
    var done = steps.filter(function (s) { return p.flow[s.id]; }).length;

    var html = '<div class="completeness" style="margin-bottom:12px">' +
      '<span class="fb-label">订单全流程</span>' +
      '<div class="cbar"><i style="width:' + (steps.length ? Math.round(done / steps.length * 100) : 0) + '%"></i></div>' +
      '<strong>' + done + '/' + steps.length + '</strong></div>' +
      '<p class="muted" style="margin-bottom:10px">勾掉的是这条线上这一步已经走完的。走过一遍全套，后面就是复制。</p>';

    html += '<div class="flow-list">' + steps.map(function (s, i) {
      var on = !!p.flow[s.id];
      return '<div class="flow-step' + (on ? ' done' : '') + '">' +
        '<button class="fs-check" data-fid="' + esc(s.id) + '" type="button" aria-label="标记完成">' +
          window.ICON(on ? 'check' : 'circle') + '</button>' +
        '<div class="fs-body">' +
          '<div class="fs-name">' + (i + 1) + '. ' + esc(s.name) + '</div>' +
          '<div class="fs-act">' + esc(s.act) + '</div>' +
          '<div class="fs-need">要拿到：' + esc(s.need) + '</div>' +
        '</div></div>';
    }).join('') + '</div>';

    html += '<h3 style="margin:20px 0 8px">卡住了找谁：三条升级路径</h3>' +
      (window.ESCALATION || []).map(function (e) {
        return '<details class="esc"><summary>' + esc(e.name) + '</summary>' +
          '<ul class="plain-list">' + e.items.map(function (it) {
            return '<li>' + esc(it) + '</li>';
          }).join('') + '</ul></details>';
      }).join('');

    html += '<h3 style="margin:20px 0 8px">议价计算器</h3>' +
      '<p class="muted" style="margin-bottom:10px">降价吃掉的是纯利润。毛利 20% 的料降 5%，毛利率就剩 15%。先把数字算清楚，再决定答不答应。</p>' +
      '<div class="calc">' +
        '<div class="calc-grid">' +
          '<label class="field"><span>现价（元）</span><input type="number" id="cP" value="5" step="0.01"></label>' +
          '<label class="field"><span>现毛利率（%）</span><input type="number" id="cG" value="20" step="0.5"></label>' +
          '<label class="field"><span>我方现在份额</span><input type="number" id="cA" value="50" step="1"></label>' +
          '<label class="field"><span>客户要降价（%）</span><input type="number" id="cD" value="5" step="0.5"></label>' +
          '<label class="field"><span>降价后我方份额</span><input type="number" id="cA2" value="60" step="1"></label>' +
        '</div>' +
        '<div class="row-gap">' +
          '<button class="btn primary" id="calcRun" type="button">算一算</button>' +
          '<button class="btn ghost" id="calcEx1" type="button">降 5% 换份额</button>' +
          '<button class="btn ghost" id="calcEx2" type="button">降 2% 换份额</button>' +
          '<button class="btn ghost" id="calcEx3" type="button">不降价丢份额</button>' +
        '</div>' +
        '<div class="calc-out" id="calcOut"></div>' +
      '</div>';
    return html;
  }

  function computeDeal(P, g, A, d, A2) {
    var gm = g / 100, dm = d / 100;
    var baseSales = P * A;
    var baseProfit = baseSales * gm;
    var newSales = P * (1 - dm) * A2;
    var newMargin = gm - dm;
    var newProfit = newSales * newMargin;
    var breakEven = newMargin > 0 ? baseProfit / (P * (1 - dm) * newMargin) : Infinity;
    return {
      baseSales: baseSales, baseProfit: baseProfit,
      newSales: newSales, newMargin: newMargin * 100, newProfit: newProfit,
      dSales: newSales - baseSales, dProfit: newProfit - baseProfit,
      breakEven: breakEven
    };
  }

  function fmt(n) {
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
  }

  function renderCalc(p, body) {
    var out = body.querySelector('#calcOut');
    if (!out) return;
    var P = parseFloat(body.querySelector('#cP').value);
    var g = parseFloat(body.querySelector('#cG').value);
    var A = parseFloat(body.querySelector('#cA').value);
    var d = parseFloat(body.querySelector('#cD').value);
    var A2 = parseFloat(body.querySelector('#cA2').value);
    if ([P, g, A, d, A2].some(function (v) { return !isFinite(v); })) {
      out.innerHTML = '<p class="muted">五个数都填上才能算。</p>';
      return;
    }

    var r = computeDeal(P, g, A, d, A2);
    var worse = r.dProfit < -1e-9;
    var better = r.dProfit > 1e-9;
    var verdict, vcls;
    if (r.newMargin <= 0) {
      verdict = '降幅已经吃光毛利。这个价不用算，不能答应。';
      vcls = 'danger';
    } else if (better) {
      verdict = '利润额是涨的。这个方案可以谈。';
      vcls = 'ok';
    } else if (worse) {
      verdict = r.dSales < 0
        ? '销售额和毛利额同时减少。这个方案没有理由接受。'
        : '销售额涨了，但毛利额在跌。要么改降幅，要么把份额谈得更高。';
      vcls = 'warn';
    } else {
      verdict = '刚好持平。可以接受，但没有额外收益。';
      vcls = 'warn';
    }

    var possible = isFinite(r.breakEven) && r.breakEven <= 100;
    out.innerHTML =
      '<table class="calc-table">' +
        '<tr><th></th><th>现在</th><th>降价后</th><th>变化</th></tr>' +
        '<tr><td>销售额</td><td>' + fmt(r.baseSales) + '</td><td>' + fmt(r.newSales) + '</td>' +
          '<td class="' + (r.dSales < 0 ? 'neg' : 'pos') + '">' + (r.dSales >= 0 ? '+' : '') + fmt(r.dSales) + '</td></tr>' +
        '<tr><td>毛利率</td><td>' + fmt(g) + '%</td><td>' + fmt(r.newMargin) + '%</td>' +
          '<td class="neg">' + fmt(r.newMargin - g) + ' pt</td></tr>' +
        '<tr><td>毛利额</td><td>' + fmt(r.baseProfit) + '</td><td>' + fmt(r.newProfit) + '</td>' +
          '<td class="' + (r.dProfit < 0 ? 'neg' : 'pos') + '">' + (r.dProfit >= 0 ? '+' : '') + fmt(r.dProfit) + '</td></tr>' +
      '</table>' +
      '<div class="calc-verdict ' + vcls + '">' + esc(verdict) + '</div>' +
      '<div class="calc-note">要保住原来的毛利额，降价 ' + fmt(d) + '% 之后份额至少要拿到 <b>' +
        (isFinite(r.breakEven) ? fmt(r.breakEven) : '不可能') + '</b>' +
        (possible ? '，你的方案是 ' + fmt(A2) + '，' + (A2 >= r.breakEven ? '够了。' : '还差 ' + fmt(r.breakEven - A2) + '。') : '（降幅太大，涨多少份额都补不回来）。') +
      '</div>' +
      '<div class="calc-note muted">单位跟着份额走：份额填 50，结果就是"50 个份额"对应的销售额和毛利额。要和客户谈的是降幅和份额的交换，不是单纯让价。</div>';
  }

  function bindFlowTab(p, body) {
    Array.prototype.forEach.call(body.querySelectorAll('.fs-check'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.fid;
        p.flow = p.flow || {};
        if (p.flow[id]) delete p.flow[id];
        else p.flow[id] = true;
        saveProjects();
        body.innerHTML = renderFlowTab(p);
        bindFlowTab(p, body);
        renderCalc(p, body);
      });
    });

    var run = body.querySelector('#calcRun');
    if (!run) return;
    run.addEventListener('click', function () { renderCalc(p, body); });

    var presets = [
      ['#calcEx1', [5, 20, 50, 5, 60]],
      ['#calcEx2', [5, 20, 50, 2, 60]],
      ['#calcEx3', [5, 20, 50, 0, 40]]
    ];
    presets.forEach(function (item) {
      var el = body.querySelector(item[0]);
      if (!el) return;
      el.addEventListener('click', function () {
        var v = item[1];
        body.querySelector('#cP').value = v[0];
        body.querySelector('#cG').value = v[1];
        body.querySelector('#cA').value = v[2];
        body.querySelector('#cD').value = v[3];
        body.querySelector('#cA2').value = v[4];
        renderCalc(p, body);
      });
    });

    renderCalc(p, body);
  }

  function renderPlanTab(p) {
    var b = buildBriefing(p);
    var html = '<div class="briefing"><h3>这次见面必问的 ' + b.questions.length + ' 个问题</h3><ol>' +
      b.questions.map(function (q) {
        return '<li>' + esc(q.q) + '<span class="why">' + esc(q.why) + '</span></li>';
      }).join('') + '</ol></div>';

    if (b.risks.length) {
      html += '<div class="risk-list">' + b.risks.map(function (r) {
        return '<div class="risk ' + (r.level === 'danger' ? 'danger' : '') + '">' + window.ICON('alert') + '<span>' + esc(r.text) + '</span></div>';
      }).join('') + '</div>';
    }

    var short = [];
    if (p.nextAction) short.push('下一步动作：' + p.nextAction);
    if (p.nextDate) short.push('跟进时间：' + p.nextDate);
    html += '<div class="panel" style="margin-top:14px;background:var(--panel-2)">' +
      '<h3>你上次给自己定的</h3><p class="muted" style="margin-top:6px">' +
      (short.length ? esc(short.join('　｜　')) : '还没定。没有下一步动作和日期的项目，等于没在跟。') + '</p></div>';
    return html;
  }

  function renderLogTab(p) {
    var notes = (p.notes || []).slice().reverse();
    var html = '<div class="panel" style="background:var(--panel-2);margin-bottom:16px">' +
      '<h3>拜访后复盘</h3><p class="muted" style="margin:4px 0 10px">见完客户当天写完，隔天写就只剩印象了。</p>' +
      '<div class="field"><span>这次见到谁</span><input id="rvWho" placeholder="姓名 / 角色"></div>' +
      '<div class="field"><span>客户说了什么（原话最好）</span><textarea id="rvSaid" placeholder="他说了什么、顾虑是什么、做了什么承诺"></textarea></div>' +
      '<div class="field"><span>你当场承诺了什么</span><input id="rvPromise" placeholder="如：明天中午前给测试数据"></div>' +
      '<div class="field"><span>下一步动作</span><input id="rvNext" placeholder="如：约下周四上门谈价格"></div>' +
      '<div class="field"><span>下次跟进日期</span><input id="rvDate" type="date" value="' + esc(p.nextDate || '') + '"></div>' +
      '<button class="btn primary" id="btnSaveReview" type="button">' + window.ICON('check') + '记下来，并更新项目卡</button>' +
      '</div>';

    html += '<h3 style="margin:16px 0 10px">接触记录（' + notes.length + ' 条）</h3>';
    if (!notes.length) {
      html += '<p class="muted">还没有记录。</p>';
    } else {
      html += notes.map(function (n) {
        return '<div class="log-item"><div class="lt">' + esc(n.date || '') + '</div>' +
          '<div class="lb">' + nl2br(n.text) + '</div></div>';
      }).join('');
    }
    return html;
  }

  function bindLogTab(p, body) {
    var btn = body.querySelector('#btnSaveReview');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var who = body.querySelector('#rvWho').value.trim();
      var said = body.querySelector('#rvSaid').value.trim();
      var promise = body.querySelector('#rvPromise').value.trim();
      var next = body.querySelector('#rvNext').value.trim();
      var date = body.querySelector('#rvDate').value;
      if (!said && !who) { toast('至少写一句见到了谁、说了什么'); return; }

      var lines = [];
      if (who) lines.push('见到：' + who);
      if (said) lines.push('客户说：' + said);
      if (promise) lines.push('我承诺：' + promise);
      if (next) lines.push('下一步：' + next);
      if (date) lines.push('下次跟进：' + date);

      p.notes = p.notes || [];
      p.notes.push({ date: today(), text: lines.join('\n') });
      p.lastContact = today();
      if (next) p.nextAction = next;
      if (date) p.nextDate = date;

      saveProjects(); renderStats(); renderProjectList(); renderDetail();
      toast('记下了，项目卡已更新');
    });
  }

  function openProjectForm(p) {
    var isNew = !p;
    var d = p || {
      id: newProjectId(), customer: '', project: '', owner: '', stage: 0,
      fields: {}, people: '', nextAction: '', nextDate: '', lastContact: '', notes: []
    };

    var stageOpts = window.STAGE_DEFS.map(function (s) {
      return '<option value="' + s.id + '"' + (d.stage === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');

    var factFields = window.FIELD_DEFS.map(function (fd) {
      return '<label class="field"><span>' + esc(fd.label) + '</span>' +
        '<input data-fk="' + fd.k + '" value="' + esc(d.fields[fd.k] || '') + '" placeholder="' + esc(fd.ph || '') + '"></label>';
    }).join('');

    openModal(
      (isNew ? '新建项目' : '编辑项目'),
      '<div class="form-grid">' +
        '<label class="field"><span>客户名称</span><input id="pfCustomer" value="' + esc(d.customer) + '" placeholder="如：XX 电源科技"></label>' +
        '<label class="field"><span>项目名称</span><input id="pfProject" value="' + esc(d.project) + '" placeholder="如：工业电源 DC-DC 项目"></label>' +
        '<label class="field"><span>当前阶段</span><select id="pfStage">' + stageOpts + '</select></label>' +
        '<label class="field"><span>负责人</span><input id="pfOwner" value="' + esc(d.owner || '') + '" placeholder="你自己"></label>' +
        '<label class="field"><span>下一步动作</span><input id="pfNext" value="' + esc(d.nextAction || '') + '" placeholder="如：约研发做技术交流"></label>' +
        '<label class="field"><span>下次跟进日期</span><input id="pfDate" type="date" value="' + esc(d.nextDate || '') + '"></label>' +
        '<label class="field full"><span>关键人</span><textarea id="pfPeople" placeholder="李工 / 硬件研发 / 关心成本&#10;周女士 / 采购 / 关心交期">' + esc(d.people || '') + '</textarea></label>' +
      '</div>' +
      '<h3 style="margin:8px 0 10px">项目事实（能填多少填多少，空着就是没问到）</h3>' +
      '<div class="form-grid">' + factFields + '</div>',
      function () {
        var customer = $('pfCustomer').value.trim();
        if (!customer) { toast('客户名称不能为空'); return false; }
        d.customer = customer;
        d.project = $('pfProject').value.trim();
        d.stage = parseInt($('pfStage').value, 10) || 0;
        d.owner = $('pfOwner').value.trim();
        d.nextAction = $('pfNext').value.trim();
        d.nextDate = $('pfDate').value;
        d.people = $('pfPeople').value;
        Array.prototype.forEach.call(document.querySelectorAll('[data-fk]'), function (inp) {
          d.fields[inp.dataset.fk] = inp.value.trim();
        });

        if (isNew) {
          d.createdAt = new Date().toISOString();
          d.notes = d.notes || [];
          state.projects.push(d);
          state.activeProjectId = d.id;
        }
        saveProjects(); renderStats(); renderProjectList(); renderDetail();
        toast(isNew ? '项目建好了。先把空的格子填上' : '已保存');
        return true;
      }
    );
  }

  /* ------------------------------------------------------------------ 底座 */

  function renderPlaybook(filter) {
    var q = window.SCORING.normalize(filter || '');
    var hit = function (text) { return !q || window.SCORING.normalize(text).indexOf(q) !== -1; };

    var html = window.PLAYBOOK.map(function (sec) {
      var body = '';
      var count = 0;

      if (sec.groups && sec.groups.length && sec.groups[0].terms) {
        body = sec.groups.map(function (g) {
          var terms = g.terms.filter(function (t) { return hit(t.t + t.e + t.d); });
          if (!terms.length) return '';
          count += terms.length;
          return '<h3 style="margin:12px 0 8px">' + esc(g.name) + '</h3><div class="term-grid">' +
            terms.map(function (t) {
              return '<div class="term"><div class="tt">' + esc(t.t) + '<em>' + esc(t.e) + '</em></div><div class="td">' + esc(t.d) + '</div></div>';
            }).join('') + '</div>';
        }).join('');
      } else if (sec.rows) {
        var rows = sec.rows.filter(function (r) {
          return hit(r.role + r.care + (r.lines || []).map(function (l) { return l.join(''); }).join(''));
        });
        count = rows.length;
        body = rows.map(function (r) {
          return '<div class="role-row"><h3>' + esc(r.role) + '</h3>' +
            '<div class="rr-line"><b>核心关心</b><span>' + esc(r.care) + '</span></div>' +
            r.lines.map(function (l) {
              return '<div class="rr-line"><b>' + esc(l[0]) + '</b><span>' + esc(l[1]) + '</span></div>';
            }).join('') + '</div>';
        }).join('');
      } else if (sec.groups) {
        body = sec.groups.map(function (g) {
          var items = g.items.filter(hit);
          if (!items.length) return '';
          count += items.length;
          return '<h3 style="margin:12px 0 8px">' + esc(g.name) + '</h3><ul class="plain-list">' +
            items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
        }).join('');
      } else if (sec.items) {
        var items = sec.items.filter(function (i) { return hit(i.t + i.d); });
        count = items.length;
        var danger = sec.id === 'redlines';
        body = '<ul class="plain-list' + (danger ? ' danger' : '') + '">' + items.map(function (i) {
          return '<li><b>' + esc(i.t) + '</b><br>' + esc(i.d) + '</li>';
        }).join('') + '</ul>';
      }

      if (q && !count) return '';
      return '<div class="pb-section' + (q ? ' open' : '') + '" data-sec="' + sec.id + '">' +
        '<button class="pb-head" type="button">' + window.ICON('chevron', 'chev') +
        '<h2>' + esc(sec.title) + '</h2><span class="count">' + count + ' 条</span></button>' +
        '<div class="pb-body"><p class="muted" style="margin-bottom:10px">' + esc(sec.note) + '</p>' + body + '</div></div>';
    }).join('');

    $('playbook').innerHTML = html || '<div class="panel muted">没有匹配的内容。</div>';
    Array.prototype.forEach.call($('playbook').querySelectorAll('.pb-head'), function (b) {
      b.addEventListener('click', function () { b.parentNode.classList.toggle('open'); });
    });
  }

  /* ------------------------------------------------------------------ 今天 */

  function todayLabel() {
    var d = new Date();
    var w = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 周' + w;
  }

  function lastActivity(refType, refId) {
    var list = (state.activities || []).filter(function (a) {
      return a.refType === refType && a.refId === refId;
    });
    if (!list.length) return null;
    return list.sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
  }

  function buildTodos() {
    var t = today();
    var map = {};
    function add(todo) {
      var key = todo.kind + ':' + todo.id;
      var rank = { danger: 3, warn: 2, ok: 1 };
      if (!map[key] || rank[todo.level] > rank[map[key].level]) map[key] = todo;
    }

    state.projects.forEach(function (p) {
      var name = (p.customer || '未命名客户') + (p.project ? ' · ' + p.project : '');
      if (!p.nextDate) {
        add({ level: 'warn', kind: 'project', id: p.id, title: '没定下次跟进', sub: name, act: '定时间' });
      } else {
        var gap = daysBetween(p.nextDate, t);
        if (gap > 0) add({ level: 'danger', kind: 'project', id: p.id, title: '跟进已过期 ' + gap + ' 天', sub: name, act: '今天就打' });
        else if (gap === 0) add({ level: 'warn', kind: 'project', id: p.id, title: '今天该跟进', sub: name, act: '打电话' });
      }
      if (p.lastContact) {
        var idle = daysBetween(p.lastContact, t);
        if (idle > 14) add({ level: 'warn', kind: 'project', id: p.id, title: idle + ' 天没有接触记录', sub: name, act: '补一个电话' });
      }
    });

    state.targets.forEach(function (tg) {
      var s = intentScore(tg);
      var last = lastActivity('target', tg.id);
      if (s.pct >= 65 && !last) {
        add({ level: 'ok', kind: 'target', id: tg.id, title: '优先打，但还没联系过', sub: (tg.name || '未命名') + ' · ' + s.pct + ' 分', act: '打第一通' });
      } else if (s.pct >= 65 && last) {
        var idle = daysBetween(last.date, t);
        if (idle > 14) add({ level: 'warn', kind: 'target', id: tg.id, title: '高分客户 ' + idle + ' 天没碰', sub: (tg.name || '未命名') + ' · ' + s.pct + ' 分', act: '跟进一下' });
      }
    });

    var order = { danger: 0, warn: 1, ok: 2 };
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return order[a.level] - order[b.level]; })
      .slice(0, 12);
  }

  function renderToday() {
    var todos = buildTodos();
    var line = $('todayLine');
    if (line) {
      line.textContent = todayLabel() + '　·　' + (todos.length ? '有 ' + todos.length + ' 件事要处理' : '今天没有待办，去建一条新的目标公司');
    }

    var box = $('todoList');
    if (box) {
      if (!todos.length) {
        box.innerHTML = '<div class="panel muted" style="padding:22px">' +
          '没有过期跟进，也没有漏掉的高分客户。要么你今天做得很好，要么你还没录入数据。' +
          '<div class="row-gap"><button class="btn primary sm" id="todoEmptyNew" type="button">新建目标公司</button></div></div>';
        var en = $('todoEmptyNew');
        if (en) en.addEventListener('click', function () {
          state.prospectTab = 'targets'; switchView('prospect'); openTargetForm(null);
        });
      } else {
        box.innerHTML = todos.map(function (t, i) {
          return '<div class="todo ' + t.level + '">' +
            '<span class="todo-dot"></span>' +
            '<div class="todo-body"><div class="todo-title">' + esc(t.title) + '</div>' +
            '<div class="todo-sub">' + esc(t.sub) + '</div></div>' +
            '<button class="btn sm" data-todo-act="' + i + '" type="button">' + esc(t.act) + '</button>' +
            '</div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('[data-todo-act]'), function (b) {
          b.addEventListener('click', function () {
            var t = todos[parseInt(b.dataset.todoAct, 10)];
            if (t.kind === 'project') {
              state.activeProjectId = t.id;
              state.detailTab = 'facts';
              switchView('coaching');
              renderProjectList(); renderDetail();
            } else {
              state.activeTargetId = t.id;
              state.prospectTab = 'targets';
              switchView('prospect');
            }
          });
        });
      }
    }
    renderWeek();
  }

  function renderWeek() {
    var box = $('weekStats');
    if (!box) return;
    var now = new Date();
    var start = new Date(now.getTime() - 6 * 86400000);
    var startStr = start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate());
    var recent = (state.activities || []).filter(function (a) { return a.date >= startStr; });
    var types = ['电话', '微信', '拜访', '送样', '报价', '测试', '下单'];
    var counts = {};
    types.forEach(function (x) { counts[x] = 0; });
    recent.forEach(function (a) { if (counts[a.type] !== undefined) counts[a.type]++; });

    box.innerHTML = '<div class="week-total"><strong>' + recent.length + '</strong><span>次动作 / 近 7 天</span></div>' +
      '<div class="week-grid">' + types.map(function (x) {
        return '<div class="week-cell"><span>' + x + '</span><strong>' + counts[x] + '</strong></div>';
      }).join('') + '</div>' +
      '<p class="muted" style="font-size:11.5px;margin-top:10px">没开单的月份，这些数字就是你的进度。' +
      '老板问起来，拿得出手的不是"我在跟进"，是这 7 天打了多少通、送了几次样。</p>';
  }

  function openActivityForm() {
    var opts = '<option value="">— 选一个 —</option>';
    if (state.targets.length) {
      opts += '<optgroup label="目标公司">' + state.targets.map(function (t) {
        return '<option value="target:' + esc(t.id) + '">' + esc(t.name || '未命名') + '</option>';
      }).join('') + '</optgroup>';
    }
    if (state.projects.length) {
      opts += '<optgroup label="项目">' + state.projects.map(function (p) {
        return '<option value="project:' + esc(p.id) + '">' + esc((p.customer || '') + (p.project ? ' · ' + p.project : '')) + '</option>';
      }).join('') + '</optgroup>';
    }
    var types = ['电话', '微信', '拜访', '送样', '报价', '测试', '下单'];

    openModal('记一笔',
      '<div class="form-grid">' +
        '<label class="field full"><span>对象</span><select id="afRef">' + opts + '</select></label>' +
        '<label class="field"><span>类型</span><select id="afType">' + types.map(function (x) {
          return '<option>' + x + '</option>';
        }).join('') + '</select></label>' +
        '<label class="field"><span>日期</span><input type="date" id="afDate" value="' + today() + '"></label>' +
        '<label class="field full"><span>备注</span><textarea id="afNote" placeholder="说了什么、承诺了什么、下一步是什么"></textarea></label>' +
      '</div>',
      function () {
        var ref = $('afRef').value;
        if (!ref) { toast('先选一个对象'); return false; }
        var parts = ref.split(':');
        var note = $('afNote').value.trim();
        var date = $('afDate').value || today();
        state.activities = state.activities || [];
        state.activities.push({
          id: uid(), date: date, type: $('afType').value,
          refType: parts[0], refId: parts[1], note: note
        });
        if (parts[0] === 'project') {
          var p = state.projects.filter(function (x) { return x.id === parts[1]; })[0];
          if (p) {
            p.lastContact = date;
            p.notes = p.notes || [];
            p.notes.push({ date: date, text: '【' + $('afType').value + '】' + (note || '（无备注）') });
            saveProjects();
          }
        } else {
          var tg = state.targets.filter(function (x) { return x.id === parts[1]; })[0];
          if (tg) { tg.lastContact = date; saveTargets(); }
        }
        save(LS.activities, state.activities);
        renderToday();
        toast('记下了');
        return true;
      }
    );
  }

  function openDiagnosis() {
    var list = window.DIAGNOSIS || [];
    openInfoModal('我卡住了',
      '<p class="muted" style="margin-bottom:12px">先定位你卡在哪一步。别在错误的那一步上使劲。</p>' +
      '<div class="diag-grid">' + list.map(function (d, i) {
        return '<button class="diag-card" data-diag="' + i + '" type="button">' +
          '<strong>' + esc(d.name) + '</strong><span>' + esc(d.symptom) + '</span></button>';
      }).join('') + '</div>' +
      '<div id="diagResult"></div>');

    Array.prototype.forEach.call(document.querySelectorAll('[data-diag]'), function (b) {
      b.addEventListener('click', function () {
        var d = list[parseInt(b.dataset.diag, 10)];
        Array.prototype.forEach.call(document.querySelectorAll('.diag-card'), function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        document.getElementById('diagResult').innerHTML = '<div class="diag-result">' +
          '<h3>' + esc(d.name) + '</h3>' +
          '<ol class="plain-list">' + d.actions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ol>' +
          '<p class="muted" style="margin-top:10px">相关内容：' + esc(d.see) + '</p></div>';
      });
    });
  }

  function openInfoModal(title, bodyHtml) {
    var back = $('modalBackdrop');
    $('modal').innerHTML =
      '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
      '<button class="btn sm ghost" id="modalCloseInfo" type="button">' + window.ICON('x') + '</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>';
    back.hidden = false;
    var close = function () { back.hidden = true; $('modal').innerHTML = ''; };
    $('modalCloseInfo').addEventListener('click', close);
    back.onclick = function (e) { if (e.target === back) close(); };
    return close;
  }

  /* ---------------------------------------------------------------- 找客户 */

  // 满分按"5 条强信号"计。没人能把 14 条正信号全占上，按全量归一化会把好线索压成低分。
  var INTENT_FULL = 15;

  function intentScore(t) {
    var got = 0;
    (window.INTENT_SIGNALS || []).forEach(function (g) {
      g.list.forEach(function (s) { if (t.signals && t.signals[s.id]) got += g.w; });
    });
    var pct = Math.max(0, Math.min(100, Math.round(got / INTENT_FULL * 100)));
    var grade = pct >= 65
      ? { key: 'high', label: '优先打' }
      : (pct >= 35 ? { key: 'mid', label: '可以打' } : { key: 'low', label: '先放着' });
    return { pct: pct, grade: grade };
  }

  function currentTarget() {
    for (var i = 0; i < state.targets.length; i++) {
      if (state.targets[i].id === state.activeTargetId) return state.targets[i];
    }
    return null;
  }

  function saveTargets() {
    state.targets.forEach(function (t) { t.updatedAt = new Date().toISOString(); });
    save(LS.targets, state.targets);
  }

  function renderProspect() {
    var seg = $('prospectSeg');
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll('.seg-btn'), function (b) {
      b.classList.toggle('active', b.dataset.ptab === state.prospectTab);
    });
    var body = $('prospectBody');
    if (state.prospectTab === 'chain') body.innerHTML = renderChainTab();
    if (state.prospectTab === 'targets') {
      body.innerHTML = renderTargetsTab();
      bindTargetsTab(body);
    }
    if (state.prospectTab === 'talk') {
      body.innerHTML = renderTalkTab();
      bindTalkTab(body);
    }
  }

  function renderChainTab() {
    var layers = window.CHAIN_LAYERS || [];
    var cats = window.CHAIN_CATEGORIES || [];
    var types = window.CUSTOMER_TYPES || [];
    var segs = window.SEMI_SEGMENTS || [];
    var apps = window.DOWNSTREAM_APPS || [];

    var html = '<div class="orient">' +
      '<h3>看不懂这条链，就问自己三个问题</h3>' +
      '<ol><li>我卖的这颗料，是谁做出来的？往上游追。</li>' +
      '<li>它最后装进谁的产品？往下游追。</li>' +
      '<li>每两个环节之间，谁在求谁？谁手里有定价权？</li></ol>' +
      '<p class="muted">这三个问题答不上来，你就不知道客户为什么买、也不知道该去找谁。</p></div>';

    html += '<h2 class="sec-title">一条主链，从上到下</h2>' +
      '<div class="chain">' + layers.map(function (l, i) {
        return '<div class="chain-row">' +
          '<div class="chain-dot">' + (i + 1) + '</div>' +
          '<div class="chain-card">' +
            '<div class="chain-head"><strong>' + esc(l.name) + '</strong>' +
              '<span class="tier tier-' + (l.tier === '新人可进' ? 'ok' : (l.tier === '需要积累' ? 'mid' : 'hard')) + '">' + esc(l.tier) + '</span></div>' +
            (l.sub ? '<div class="chain-sub">' + esc(l.sub) + '</div>' : '') +
            '<div class="chain-line"><b>谁在这</b><span>' + esc(l.who) + '</span></div>' +
            '<div class="chain-line"><b>买什么</b><span>' + esc(l.buys) + '</span></div>' +
            '<div class="chain-line"><b>卖给谁</b><span>' + esc(l.sells) + '</span></div>' +
            '<div class="chain-note">' + esc(l.note) + '</div>' +
          '</div></div>';
      }).join('') + '</div>';

    html += '<h2 class="sec-title">芯片品类：同样叫半导体销售，卖的东西完全不同</h2>' +
      '<div class="seg-grid">' + segs.map(function (s) {
        return '<div class="seg-card">' +
          '<h3>' + esc(s.name) + '</h3>' +
          '<div class="seg-items">' + esc(s.items) + '</div>' +
          '<div class="chain-line"><b>代表</b><span>' + esc(s.who) + '</span></div>' +
          '<div class="chain-note">' + esc(s.note) + '</div>' +
        '</div>';
      }).join('') + '</div>';

    html += '<h2 class="sec-title">品类上下游：你在哪一层，上面买什么，下面卖给谁</h2>' +
      '<div class="cat-grid">' + cats.map(function (c) {
        return '<div class="cat-card">' +
          '<h3>' + esc(c.name) + '</h3>' +
          '<div class="cat-line up"><b>上游</b><span>' + esc(c.up) + '</span></div>' +
          '<div class="cat-line self"><b>你这一层</b><span>' + esc(c.self) + '</span></div>' +
          '<div class="cat-line down"><b>下游</b><span>' + esc(c.down) + '</span></div>' +
          '<div class="cat-tip">' + esc(c.tip) + '</div>' +
        '</div>';
      }).join('') + '</div>';

    html += '<h2 class="sec-title">下游应用：同一颗芯片，卖进不同行业打法不同</h2>' +
      '<div class="app-list">' + apps.map(function (a) {
        return '<div class="app-row">' +
          '<div class="app-name">' + esc(a.name) + '</div>' +
          '<div class="app-body">' +
            '<div class="chain-line"><b>做什么</b><span>' + esc(a.what) + '</span></div>' +
            '<div class="chain-line"><b>用什么</b><span>' + esc(a.chips) + '</span></div>' +
            '<div class="chain-line"><b>代表客户</b><span>' + esc(a.who) + '</span></div>' +
            '<div class="chain-note">' + esc(a.note) + '</div>' +
          '</div></div>';
      }).join('') + '</div>';

    html += '<h2 class="sec-title">六类客户，在乎的东西完全不同</h2>' +
      '<div class="ctype-list">' + types.map(function (t) {
        return '<div class="ctype">' +
          '<div class="ctype-head"><strong>' + esc(t.name) + '</strong><span class="muted">' + esc(t.role) + '</span></div>' +
          '<div class="chain-line"><b>在乎什么</b><span>' + esc(t.care) + '</span></div>' +
          '<div class="chain-line"><b>决策链</b><span>' + esc(t.chain) + '</span></div>' +
          '<div class="chain-note">' + esc(t.tip) + '</div>' +
        '</div>';
      }).join('') + '</div>';

    return html;
  }

  var CSV_FIELDS = {
    '公司名称': 'name', '公司': 'name', '企业名称': 'name', 'name': 'name',
    '产业链位置': 'layer', '层级': 'layer', 'layer': 'layer',
    '主营产品': 'product', '产品': 'product', 'product': 'product',
    '参保人数': 'insured', '人数': 'insured',
    '成立时间': 'founded', '成立日期': 'founded',
    '注册资本': 'capital',
    '注册地址': 'addr', '地址': 'addr',
    '经营范围': 'bizScope',
    '在招岗位': 'hiring', '招聘': 'hiring',
    '下游客户': 'downCustomer',
    '是否有生产场地': 'hasFactory', '生产场地': 'hasFactory', '厂房': 'hasFactory',
    '备注': 'notes'
  };

  function parseCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  function importTargetsCsv(text) {
    var lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return { added: 0, skipped: 0, total: 0 };
    var rows = lines.map(parseCsvLine);
    var header = null;
    if (/公司|名称|企业|name/i.test(rows[0].join(' '))) header = rows.shift();

    var added = 0, skipped = 0;
    rows.forEach(function (cells) {
      var rec = {};
      if (header) {
        header.forEach(function (h, i) {
          var key = CSV_FIELDS[String(h).trim()];
          if (key) rec[key] = (cells[i] || '').trim();
        });
      } else {
        rec.name = (cells[0] || '').trim();
      }
      if (!rec.name) { skipped++; return; }
      if (state.targets.some(function (t) { return t.name === rec.name; })) { skipped++; return; }
      rec.id = uid();
      rec.signals = {};
      rec.createdAt = new Date().toISOString();
      state.targets.push(rec);
      added++;
    });

    if (added) {
      state.activeTargetId = state.targets[state.targets.length - 1].id;
      saveTargets();
    }
    return { added: added, skipped: skipped, total: rows.length };
  }

  function renderTargetsTab() {
    var list = state.targets.slice().sort(function (a, b) {
      return intentScore(b).pct - intentScore(a).pct;
    });

    var left = '<div class="target-list">' + (list.length ? list.map(function (t) {
      var s = intentScore(t);
      return '<button class="target-card' + (t.id === state.activeTargetId ? ' active' : '') + '" data-tid="' + esc(t.id) + '" type="button">' +
        '<div class="target-top"><strong>' + esc(t.name || '未命名公司') + '</strong>' +
        '<span class="score-pill ' + s.grade.key + '">' + s.pct + '</span></div>' +
        '<div class="target-sub">' + esc(t.layer || '未标产业链位置') + (t.product ? ' ｜ ' + esc(t.product) : '') + '</div>' +
        '<div class="target-foot">' + esc(s.grade.label) + '</div>' +
        '</button>';
    }).join('') : '<div class="panel muted">还没有目标公司。先按「产业链地图」定好你要打哪一层。</div>') + '</div>';

    var t = currentTarget();
    var right = t ? renderTargetDetail(t) : '<div class="empty-state"><div class="empty-icon">' + window.ICON('building') + '</div>' +
      '<h2>选一家公司，或者新建一个</h2><p>工商信息查一遍，再把信号勾一遍，这个公司值不值得打电话，数字会告诉你。</p></div>';

    return '<div class="target-wrap"><div class="target-col">' +
      '<div class="row-gap" style="margin:0">' +
        '<button class="btn primary" id="btnNewTarget" type="button">' + window.ICON('plus') + '新建</button>' +
        '<button class="btn ghost" id="btnImportTargets" type="button">' + window.ICON('upload') + '导入 CSV</button>' +
      '</div>' +
      left + '</div>' +
      '<div class="target-detail">' + right + '</div></div>';
  }

  function renderTargetDetail(t) {
    var s = intentScore(t);
    var facts = [
      ['统一社会信用代码', t.creditCode],
      ['注册资本', t.capital],
      ['成立时间', t.founded],
      ['参保人数', t.insured],
      ['注册地址', t.addr],
      ['是否有生产场地', t.hasFactory],
      ['经营范围', t.bizScope],
      ['产业链位置', t.layer],
      ['主营产品', t.product],
      ['下游客户', t.downCustomer],
      ['在招岗位', t.hiring],
      ['备注', t.notes]
    ];

    var signals = (window.INTENT_SIGNALS || []).map(function (g) {
      return '<div class="sig-group"><h4 class="sig-' + (g.w > 0 ? (g.w > 1 ? 'strong' : 'mid') : 'neg') + '">' + esc(g.g) + '</h4>' +
        g.list.map(function (x) {
          var on = !!(t.signals && t.signals[x.id]);
          return '<button class="sig-item' + (on ? ' on' : '') + '" data-sid="' + esc(x.id) + '" type="button">' +
            window.ICON(on ? 'check' : 'circle') +
            '<span class="sig-t">' + esc(x.label) + '<em>' + esc(x.why) + '</em></span></button>';
        }).join('') + '</div>';
    }).join('');

    var verdict = s.grade.key === 'high'
      ? '信号够了，这家可以直接打电话约拜访。'
      : (s.grade.key === 'mid' ? '有一点苗头，先打电话探一探，别投入太多时间。' : '信号太弱。先放回池子，等有新动静再说。');

    return '<div class="detail-head">' +
        '<div class="dh-l"><h2>' + esc(t.name || '未命名公司') + '</h2>' +
        '<span class="dh-sub">' + esc(t.layer || '未标产业链位置') + '</span></div>' +
        '<div class="row-gap" style="margin:0">' +
          '<span class="score-pill big ' + s.grade.key + '">' + s.pct + ' · ' + esc(s.grade.label) + '</span>' +
          '<button class="btn sm" id="btnEditTarget" type="button">' + window.ICON('pen') + '编辑</button>' +
          '<button class="btn sm danger" id="btnDelTarget" type="button">' + window.ICON('trash') + '</button>' +
        '</div></div>' +
      '<div class="detail-body">' +
        '<div class="verdict ' + s.grade.key + '">' + esc(verdict) + '</div>' +
        '<h3 class="sub-title">工商信息</h3>' +
        '<div class="fact-grid">' + facts.map(function (f) {
          var v = String(f[1] || '').trim();
          return '<div class="fact"><span class="fk">' + esc(f[0]) + '</span>' +
            '<span class="fv' + (v ? '' : ' empty') + '">' + esc(v || '还没查') + '</span></div>';
        }).join('') + '</div>' +
        '<h3 class="sub-title">采购意向信号</h3>' +
        '<p class="muted" style="margin-bottom:8px">勾上你能证实的那几条。没查证的不要勾，自欺欺人最后浪费的是你的时间。分数按 5 条强信号为满分折算，65 分以上优先打。</p>' +
        signals +
      '</div>';
  }

  function renderTalkTab() {
    var ft = window.FIRST_TOUCH || [];
    var fu = window.FOLLOW_UP || [];
    var html = '<div class="orient"><h3>开口之前，先想清楚一件事</h3>' +
      '<p class="muted">你不是去求别人给你机会，是告诉他"我能帮你解决什么问题"。第一次接触的目标只有一个：换到下一次接触。</p></div>';

    html += '<h2 class="sec-title">首次触达，可以直接抄</h2><div class="talk-grid">' +
      ft.map(function (f, i) {
        return '<div class="talk-card"><div class="talk-head"><strong>' + esc(f.name) + '</strong>' +
          '<button class="btn sm ghost" data-copy="' + i + '" type="button">复制</button></div>' +
          '<p class="talk-body">' + esc(f.body) + '</p></div>';
      }).join('') + '</div>';

    html += '<h2 class="sec-title">跟进节奏</h2>' +
      '<div class="fu-list">' + fu.map(function (f) {
        return '<div class="fu-row"><div class="fu-day">' + esc(f.day) + '</div>' +
          '<div class="fu-body"><div class="fu-act">' + esc(f.act) + '</div>' +
          '<div class="fu-why">' + esc(f.why) + '</div></div></div>';
      }).join('') + '</div>';

    html += '<div class="orient warn"><h3>两个不要</h3>' +
      '<ol><li>不要空手跟进。每次联系都带一条新信息，否则就是骚扰。</li>' +
      '<li>不要只回一句"好的"。所有对话结束前，都要换到一个具体的下一步。</li></ol></div>';
    return html;
  }

  function bindTalkTab(body) {
    Array.prototype.forEach.call(body.querySelectorAll('[data-copy]'), function (b) {
      b.addEventListener('click', function () {
        var item = window.FIRST_TOUCH[parseInt(b.dataset.copy, 10)];
        if (!item) return;
        var text = item.body;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { toast('已复制'); })
            .catch(function () { toast('复制失败，手动选中吧'); });
        } else {
          toast('这个浏览器不支持一键复制');
        }
      });
    });
  }

  function bindTargetsTab(body) {
    Array.prototype.forEach.call(body.querySelectorAll('.target-card'), function (b) {
      b.addEventListener('click', function () {
        state.activeTargetId = b.dataset.tid;
        renderProspect();
      });
    });

    var nw = body.querySelector('#btnNewTarget');
    if (nw) nw.addEventListener('click', function () { openTargetForm(null); });

    var imp = body.querySelector('#btnImportTargets');
    if (imp) imp.addEventListener('click', function () { $('csvInput').click(); });

    Array.prototype.forEach.call(body.querySelectorAll('.sig-item'), function (b) {
      b.addEventListener('click', function () {
        var t = currentTarget();
        if (!t) return;
        t.signals = t.signals || {};
        var id = b.dataset.sid;
        if (t.signals[id]) delete t.signals[id];
        else t.signals[id] = true;
        saveTargets();
        renderProspect();
      });
    });

    var ed = body.querySelector('#btnEditTarget');
    if (ed) ed.addEventListener('click', function () { openTargetForm(currentTarget()); });

    var del = body.querySelector('#btnDelTarget');
    if (del) del.addEventListener('click', function () {
      var t = currentTarget();
      if (!t || !confirm('删除「' + (t.name || '未命名公司') + '」？')) return;
      state.targets = state.targets.filter(function (x) { return x.id !== t.id; });
      state.activeTargetId = state.targets.length ? state.targets[0].id : null;
      saveTargets();
      renderProspect();
    });
  }

  function openTargetForm(t) {
    var isNew = !t;
    var d = t || { id: uid(), name: '', signals: {} };
    var F = [
      ['tfName', 'name', '公司名称', '如：常州恒力电源科技', true],
      ['tfCode', 'creditCode', '统一社会信用代码', '企查查/天眼查/爱企查上抄', false],
      ['tfCapital', 'capital', '注册资本', '如：2000 万元', false],
      ['tfFounded', 'founded', '成立时间', '如：2015-06', false],
      ['tfInsured', 'insured', '参保人数', '比注册资本真实', false],
      ['tfLayer', 'layer', '产业链位置', '如：器件 / 元件 / 模组', false],
      ['tfProduct', 'product', '主营产品', '如：工业开关电源', false],
      ['tfDown', 'downCustomer', '下游客户', '如：储能、工控设备厂', false],
      ['tfHiring', 'hiring', '在招岗位', '招聘软件上看，招什么岗是重要信号', false],
      ['tfFactory', 'hasFactory', '是否有生产场地', '有厂房 = 真工厂', false],
      ['tfAddr', 'addr', '注册地址', '', false],
      ['tfScope', 'bizScope', '经营范围', '', false]
    ];

    var inputs = F.map(function (f) {
      return '<label class="field"><span>' + esc(f[2]) + '</span>' +
        '<input id="' + f[0] + '" data-tk="' + f[1] + '" value="' + esc(d[f[1]] || '') + '" placeholder="' + esc(f[3]) + '"></label>';
    }).join('');

    openModal(
      isNew ? '新建目标公司' : '编辑目标公司',
      '<p class="muted" style="margin-bottom:12px">这些字段就是你要去查的东西。查不到可以留空，但空着的格子是你没做的功课。</p>' +
      '<div class="form-grid">' + inputs +
        '<label class="field full"><span>备注</span><textarea id="tfNotes" data-tk="notes" placeholder="怎么找到的、谁介绍、聊过什么">' + esc(d.notes || '') + '</textarea></label>' +
      '</div>',
      function () {
        var name = $('tfName').value.trim();
        if (!name) { toast('公司名称不能为空'); return false; }
        d.name = name;
        Array.prototype.forEach.call(document.querySelectorAll('[data-tk]'), function (inp) {
          d[inp.dataset.tk] = inp.value.trim();
        });
        d.signals = d.signals || {};
        if (isNew) {
          d.createdAt = new Date().toISOString();
          state.targets.push(d);
          state.activeTargetId = d.id;
        }
        saveTargets();
        renderProspect();
        toast(isNew ? '建好了。把信号勾一遍，看它值不值得打' : '已保存');
        return true;
      }
    );
  }

  /* ------------------------------------------------------------------ 弹窗 */

  function openModal(title, bodyHtml, onOk) {
    var back = $('modalBackdrop');
    $('modal').innerHTML =
      '<div class="modal-head"><h2>' + esc(title) + '</h2>' +
      '<button class="btn sm ghost" id="modalClose" type="button">' + window.ICON('x') + '</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      '<div class="modal-foot"><button class="btn ghost" id="modalCancel" type="button">取消</button>' +
      '<button class="btn primary" id="modalOk" type="button">保存</button></div>';
    back.hidden = false;
    var close = function () { back.hidden = true; $('modal').innerHTML = ''; };
    $('modalClose').addEventListener('click', close);
    $('modalCancel').addEventListener('click', close);
    $('modalOk').addEventListener('click', function () { if (onOk() !== false) close(); });
    back.onclick = function (e) { if (e.target === back) close(); };
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ------------------------------------------------------------------ 启动 */

  function renderModeChip() {
    var on = llmEnabled();
    $('modeChip').className = 'mode-chip' + (on ? ' on' : '');
    $('modeChip').innerHTML = '<i class="dot"></i>' + (on ? '大模型模式' : '离线引擎');
  }

  function init() {
    state.projects = load(LS.projects, []);
    state.targets = load(LS.targets, []);
    state.activities = load(LS.activities, []);
    state.cfg = load(LS.cfg, { baseUrl: '', apiKey: '', model: '' });
    state.projects.forEach(function (p) {
      p.fields = p.fields || {};
      p.notes = p.notes || [];
      p.flow = p.flow || {};
      p.stage = parseInt(p.stage, 10) || 0;
    });
    if (state.projects.length) state.activeProjectId = state.projects[0].id;
    state.targets.forEach(function (t) { t.signals = t.signals || {}; });
    if (state.targets.length) state.activeTargetId = state.targets[0].id;

    $('brandMark').innerHTML = window.ICON('flame');
    $('emptyIcon').innerHTML = window.ICON('target');
    $('emptyIcon2').innerHTML = window.ICON('clipboard');
    $('searchIcon').innerHTML = window.ICON('search');

    $('cfgBaseUrl').value = state.cfg.baseUrl || '';
    $('cfgApiKey').value = state.cfg.apiKey || '';
    $('cfgModel').value = state.cfg.model || '';
    renderModeChip();

    renderNav();
    renderSceneList();
    renderStats();
    renderProjectList();
    renderDetail();
    renderPlaybook('');
    renderProspect();
    renderToday();
    switchView(state.view);

    $('btnDiagnose').addEventListener('click', openDiagnosis);
    $('btnLogActivity').addEventListener('click', function () { openActivityForm(); });

    Array.prototype.forEach.call($('prospectSeg').querySelectorAll('.seg-btn'), function (b) {
      b.addEventListener('click', function () {
        state.prospectTab = b.dataset.ptab;
        renderProspect();
      });
    });

    $('sparringRandom').addEventListener('click', function () {
      var list = window.SCENARIOS;
      startScene(list[Math.floor(Math.random() * list.length)].id);
    });

    $('btnNewProject').addEventListener('click', function () { openProjectForm(null); });

    $('btnExport').addEventListener('click', function () {
      if (!state.projects.length) { toast('还没有项目可以导出'); return; }
      download('半导体项目卡-' + today() + '.json', JSON.stringify(state.projects, null, 2));
    });

    $('btnImport').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(reader.result);
          var data = Array.isArray(parsed) ? parsed : (parsed.projects || []);
          var tgts = Array.isArray(parsed) ? [] : (parsed.targets || []);
          var acts = Array.isArray(parsed) ? [] : (parsed.activities || []);
          if (!Array.isArray(data) || (!data.length && !tgts.length)) throw new Error('没找到可导入的数据');
          data.forEach(function (p) {
            if (!p.id) p.id = newProjectId();
            p.fields = p.fields || {};
            p.notes = p.notes || [];
            p.flow = p.flow || {};
          });
          tgts.forEach(function (t) {
            if (!t.id) t.id = uid();
            t.signals = t.signals || {};
          });
          state.projects = state.projects.concat(data);
          state.targets = state.targets.concat(tgts);
          state.activities = state.activities.concat(acts);
          if (state.targets.length && !state.activeTargetId) state.activeTargetId = state.targets[0].id;
          saveProjects(); saveTargets(); save(LS.activities, state.activities);
          renderStats(); renderProjectList(); renderProspect(); renderToday();
          toast('导入 ' + data.length + ' 个项目、' + tgts.length + ' 家目标公司');
        } catch (err) { toast('导入失败：' + err.message); }
      };
      reader.readAsText(f);
      e.target.value = '';
    });

    $('csvInput').addEventListener('change', function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = importTargetsCsv(reader.result);
        state.prospectTab = 'targets';
        renderProspect();
        renderToday();
        toast('导入 ' + res.added + ' 家' + (res.skipped ? '，跳过 ' + res.skipped + ' 条（空行或重名）' : ''));
      };
      reader.readAsText(f, 'utf-8');
      e.target.value = '';
    });

    $('playbookSearch').addEventListener('input', function (e) { renderPlaybook(e.target.value); });

    $('btnSaveCfg').addEventListener('click', function () {
      state.cfg = {
        baseUrl: $('cfgBaseUrl').value.trim(),
        apiKey: $('cfgApiKey').value.trim(),
        model: $('cfgModel').value.trim()
      };
      save(LS.cfg, state.cfg);
      renderModeChip();
      toast(llmEnabled() ? '已保存，陪练切换到大模型模式' : '已保存，当前为离线引擎');
    });

    $('btnClearCfg').addEventListener('click', function () {
      state.cfg = { baseUrl: '', apiKey: '', model: '' };
      $('cfgBaseUrl').value = ''; $('cfgApiKey').value = ''; $('cfgModel').value = '';
      save(LS.cfg, state.cfg);
      renderModeChip();
      toast('已清空，回到离线引擎');
    });

    $('btnTestCfg').addEventListener('click', function () {
      var test = {
        baseUrl: $('cfgBaseUrl').value.trim(),
        apiKey: $('cfgApiKey').value.trim(),
        model: $('cfgModel').value.trim()
      };
      if (!test.apiKey || !test.baseUrl || !test.model) { toast('三项都填完才能测'); return; }
      var backup = state.cfg;
      state.cfg = test;
      $('cfgHint').textContent = '正在测试…';
      llmChat([{ role: 'user', content: '回复两个字：正常' }]).then(function (t) {
        $('cfgHint').textContent = '连接成功：' + t.slice(0, 40);
        state.cfg = backup;
      }).catch(function (e) {
        $('cfgHint').textContent = '连接失败：' + e.message + '（检查接口地址、Key、模型名，以及是否允许跨域）';
        state.cfg = backup;
      });
    });

    $('btnExportAll').addEventListener('click', function () {
      download('销售陪跑-全部数据-' + today() + '.json', JSON.stringify({
        exportedAt: new Date().toISOString(),
        projects: state.projects,
        targets: state.targets,
        activities: state.activities
      }, null, 2));
    });

    $('btnResetAll').addEventListener('click', function () {
      if (!confirm('清空本机所有项目卡和陪练记录？这一步不可撤销。')) return;
      localStorage.removeItem(LS.projects);
      localStorage.removeItem(LS.targets);
      localStorage.removeItem(LS.activities);
      localStorage.removeItem(LS.sparring);
      state.projects = [];
      state.targets = [];
      state.activities = [];
      state.activeProjectId = null;
      state.activeTargetId = null;
      renderStats(); renderProjectList(); renderDetail(); renderNav(); renderProspect(); renderToday();
      toast('已清空');
    });
  }

  /* 给 agent.js 用的对外接口 */
  window.APP_API = {
    targets: function () { return state.targets; },
    findTarget: function (q) {
      q = String(q || '').trim();
      if (!q) return null;
      var byId = state.targets.filter(function (t) { return t.id === q; })[0];
      if (byId) return byId;
      var exact = state.targets.filter(function (t) { return t.name === q; })[0];
      if (exact) return exact;
      return state.targets.filter(function (t) { return String(t.name || '').indexOf(q) !== -1; })[0] || null;
    },
    searchTargets: function (q) {
      q = String(q || '').trim().toLowerCase();
      if (!q) return state.targets.slice();
      return state.targets.filter(function (t) {
        return [t.name, t.layer, t.product, t.downCustomer, t.notes, t.bizScope]
          .join(' ').toLowerCase().indexOf(q) !== -1;
      });
    },
    createTarget: function (data) {
      var d = Object.assign({ id: uid(), signals: {}, createdAt: new Date().toISOString() }, data || {});
      state.targets.push(d);
      state.activeTargetId = d.id;
      saveTargets();
      return d;
    },
    updateTarget: function (id, data) {
      var t = state.targets.filter(function (x) { return x.id === id; })[0];
      if (!t) return null;
      Object.keys(data || {}).forEach(function (k) {
        if (k === 'signals') t.signals = Object.assign({}, t.signals || {}, data.signals);
        else t[k] = data[k];
      });
      saveTargets();
      return t;
    },
    setActiveTarget: function (id) { state.activeTargetId = id; },
    score: intentScore,
    saveTargets: saveTargets,
    importCsv: importTargetsCsv,
    activities: function () { return state.activities || []; },
    toast: toast,
    go: switchView,
    goProspectTab: function (tab) { state.prospectTab = tab; switchView('prospect'); },
    chainLayers: function () { return window.CHAIN_LAYERS || []; },
    categories: function () { return window.CHAIN_CATEGORIES || []; },
    customerTypes: function () { return window.CUSTOMER_TYPES || []; },
    templates: function () { return window.FIRST_TOUCH || []; },
    followUp: function () { return window.FOLLOW_UP || []; },
    llm: { enabled: llmEnabled, chat: llmChatRaw }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
