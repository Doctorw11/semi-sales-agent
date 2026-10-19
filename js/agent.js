/* 找客户 Agent：工具调用循环 + 本地降级 */
(function () {
  'use strict';

  var state = { messages: [], log: [], busy: false };
  var MAX_STEPS = 6;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

  var SYSTEM = [
    '你是「半导体销售找客户助手」，一个能调用工具的 agent。',
    '你的任务：把一家目标公司从"只有一个名字"推进到"可以打电话"。',
    '',
    '工作方式：',
    '1. 先用 search_companies 查本机台账，看这家公司是否已经存在。',
    '2. 不存在就 create_company 建一条。只填用户给的或你能确定的信息。',
    '3. 用 list_industry_chain 判断它可能在哪一层；不确定就直接问用户。',
    '4. 用 list_signals 看有哪些信号，再按用户能证实的用 score_intent 打分。',
    '5. 用 draft_outreach 起一版开场，然后按用户的情况改写。',
    '6. 最后给一段结论：值不值得打、下一步具体做什么、还缺哪些信息。',
    '',
    '硬规则：',
    '- 你没有联网能力。不准编造工商信息（注册资本、参保人数、成立时间、信用代码、经营范围）。没有就说没有，让用户去企查查或爱企查查。',
    '- 不准说"我查过了"。你只能查本机台账。',
    '- 用户没说过的信号，不准替他勾上。',
    '- 中文，直白，不客套，不说"希望对你有帮助"这种话。',
    '- 一次最多调用 3 个工具，然后停下来看结果。'
  ].join('\n');

  /* ------------------------------------------------------------ 工具定义 */

  var TOOLS = [
    { type: 'function', function: {
      name: 'list_industry_chain',
      description: '列出半导体产业链的 10 个层级，每层带"新人能不能进"的标签。用来判断目标公司站在哪一层。',
      parameters: { type: 'object', properties: {}, required: [] }
    }},
    { type: 'function', function: {
      name: 'search_companies',
      description: '在本机已录入的目标公司里按关键词搜索，返回公司名、产业链位置和意向分。',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    }},
    { type: 'function', function: {
      name: 'get_company',
      description: '按公司名或 id 取一家公司的完整档案，包含已勾选的信号和分数。',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    }},
    { type: 'function', function: {
      name: 'create_company',
      description: '新建一家目标公司。不知道的字段留空，绝对不要编造工商数据。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          layer: { type: 'string', description: '产业链位置，例如 器件 / 元件 / 模组' },
          product: { type: 'string' },
          downCustomer: { type: 'string' },
          insured: { type: 'string' },
          founded: { type: 'string' },
          capital: { type: 'string' },
          addr: { type: 'string' },
          bizScope: { type: 'string' },
          hiring: { type: 'string' },
          hasFactory: { type: 'string' },
          notes: { type: 'string' }
        },
        required: ['name']
      }
    }},
    { type: 'function', function: {
      name: 'update_company',
      description: '更新一家公司的字段。只在用户明确给出信息时使用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, fields: { type: 'object' } },
        required: ['query', 'fields']
      }
    }},
    { type: 'function', function: {
      name: 'list_signals',
      description: '列出全部采购意向信号，含 id、分值和判断理由。',
      parameters: { type: 'object', properties: {}, required: [] }
    }},
    { type: 'function', function: {
      name: 'score_intent',
      description: '给一家公司算采购意向分。signals 是 {信号id: true} 的对象，只传用户确认过的。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, signals: { type: 'object' } },
        required: ['query']
      }
    }},
    { type: 'function', function: {
      name: 'draft_outreach',
      description: '按渠道生成一版首次触达话术草稿。',
      parameters: {
        type: 'object',
        properties: {
          company: { type: 'string' },
          channel: { type: 'string', enum: ['电话', '微信', '邮件'] },
          product: { type: 'string' },
          angle: { type: 'string', description: '你最想强调的一个点，比如交期、国产替代、认证' }
        },
        required: ['company']
      }
    }}
  ];

  /* ------------------------------------------------------------ 工具实现 */

  function brief(t) {
    var s = window.APP_API.score(t);
    return {
      id: t.id, name: t.name, layer: t.layer || '', product: t.product || '',
      downCustomer: t.downCustomer || '', insured: t.insured || '',
      score: s.pct, grade: s.grade.label
    };
  }

  function buildDraft(channel, company, product, angle) {
    var c = company || '贵司';
    var p = product || '（你的品类）';
    var a = angle ? '我们主要强在' + angle + '。' : '';
    if (channel === '微信') {
      return 'X 工您好，我是 XX 公司的小 X。刚才电话里提到的 ' + p + ' 资料在这里，您先存着。' + a + '用得上随时找我，用不上也不打扰您。';
    }
    if (channel === '邮件') {
      return '主题：' + c + '｜' + p + '供货资料\n\nX 工您好，\n我是 XX 公司的小 X，负责 ' + p + '。随信附上产品简介、常用型号清单和交期记录。\n' + a + '\n如果你们后续有评估或比价的计划，我可以先送样，不需要任何前置条件。\n方便的话加个微信，我把资料按你们的需求整理一版。';
    }
    return '您好，请问是 ' + c + ' 的采购或研发吗？我是 XX 公司的小 X，就耽误您一分钟。我们做 ' + p + '，想确认一句：你们现在有没有在用这一类？' + a + '有的话我加个微信，把型号和交期发您；没有也不打扰您。';
  }

  function execute(name, args) {
    var API = window.APP_API;
    var a = args || {};

    if (name === 'list_industry_chain') {
      return API.chainLayers().map(function (l) {
        return { 层级: l.name, 新人友好度: l.tier, 谁在这: l.who, 一句话: l.note };
      });
    }

    if (name === 'search_companies') {
      var hits = API.searchTargets(a.query || '');
      return { count: hits.length, companies: hits.slice(0, 10).map(brief) };
    }

    if (name === 'get_company') {
      var t = API.findTarget(a.query || '');
      if (!t) return { found: false, message: '本机台账里没有这家公司' };
      var s = API.score(t);
      return {
        found: true,
        company: {
          id: t.id, name: t.name, layer: t.layer, product: t.product, downCustomer: t.downCustomer,
          insured: t.insured, founded: t.founded, capital: t.capital, addr: t.addr,
          bizScope: t.bizScope, hiring: t.hiring, hasFactory: t.hasFactory, notes: t.notes,
          signals: Object.keys(t.signals || {}).filter(function (k) { return t.signals[k]; })
        },
        score: s.pct, grade: s.grade.label
      };
    }

    if (name === 'create_company') {
      if (!a.name) return { error: '缺少公司名' };
      var exist = API.findTarget(a.name);
      if (exist) return { created: false, reason: '已存在', company: brief(exist) };
      var c = API.createTarget(a);
      return { created: true, id: c.id, name: c.name, message: '已建立档案，工商信息待补' };
    }

    if (name === 'update_company') {
      var ut = API.findTarget(a.query || '');
      if (!ut) return { error: '找不到这家公司' };
      var u = API.updateTarget(ut.id, a.fields || {});
      return { updated: true, company: brief(u) };
    }

    if (name === 'list_signals') {
      return (window.INTENT_SIGNALS || []).map(function (g) {
        return {
          分组: g.g,
          信号: g.list.map(function (x) { return { id: x.id, 内容: x.label, 为什么: x.why }; })
        };
      });
    }

    if (name === 'score_intent') {
      var st = API.findTarget(a.query || '');
      if (!st) return { error: '找不到这家公司，先 create_company' };
      if (a.signals && typeof a.signals === 'object') {
        API.updateTarget(st.id, { signals: a.signals });
        st = API.findTarget(st.id);
      }
      var sc = API.score(st);
      return {
        company: st.name, score: sc.pct, grade: sc.grade.label,
        checked: Object.keys(st.signals || {}).filter(function (k) { return st.signals[k]; }).length
      };
    }

    if (name === 'draft_outreach') {
      return {
        channel: a.channel || '电话',
        draft: buildDraft(a.channel, a.company, a.product, a.angle)
      };
    }

    return { error: '未知工具：' + name };
  }

  /* ------------------------------------------------------------------ UI */

  function el(id) { return document.getElementById(id); }

  function push(type, data) {
    state.log.push({ type: type, data: data });
    renderLog();
  }

  function renderLog() {
    var box = el('agentLog');
    if (!box) return;
    if (!state.log.length) {
      box.innerHTML = '<div class="empty-state" style="padding:40px 20px">' +
        '<div class="empty-icon">' + window.ICON('chat') + '</div>' +
        '<h2>给它一家公司，或者一句话</h2>' +
        '<p>它会：查本机台账 → 建档案 → 判产业链位置 → 算意向分 → 起草开场。' +
        '没有联网能力，工商信息要你提供，它不会编。</p></div>';
      return;
    }
    box.innerHTML = state.log.map(function (m) {
      if (m.type === 'user') return '<div class="bubble me">' + nl2br(m.data) + '</div>';
      if (m.type === 'assistant') return '<div class="bubble them agent">' + nl2br(m.data) + '</div>';
      if (m.type === 'tool') {
        var sum = summarize(m.data.result);
        return '<div class="tool-chip"><span class="tc-name">' + window.ICON('settings') + esc(m.data.name) + '</span>' +
          '<span class="tc-res">' + esc(sum) + '</span></div>';
      }
      if (m.type === 'error') return '<div class="tool-chip err"><span class="tc-name">出错了</span><span class="tc-res">' + esc(m.data) + '</span></div>';
      return '';
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function summarize(r) {
    if (!r) return '';
    if (r.error) return '失败：' + r.error;
    if (r.created) return '已建立档案：' + r.name;
    if (r.updated) return '已更新：' + (r.company && r.company.name || '');
    if (r.count !== undefined) return '命中 ' + r.count + ' 家';
    if (r.found === false) return '台账里没有';
    if (r.found) return (r.company && r.company.name) + ' · ' + r.score + ' 分 · ' + r.grade;
    if (r.score !== undefined) return r.company + ' · ' + r.score + ' 分 · ' + r.grade;
    if (r.draft) return '已生成' + (r.channel || '') + '话术';
    if (Array.isArray(r)) return '返回 ' + r.length + ' 条';
    return '完成';
  }

  async function send() {
    if (state.busy) { window.APP_API.toast('等它说完'); return; }
    var input = el('agentInput');
    var text = (input.value || '').trim();
    if (!text) { input.focus(); return; }
    input.value = '';

    push('user', text);
    state.messages.push({ role: 'user', content: text });

    if (!window.APP_API.llm.enabled()) {
      runLocal(text);
      return;
    }

    state.busy = true;
    setBusy(true);
    try {
      for (var step = 0; step < MAX_STEPS; step++) {
        var msg = await window.APP_API.llm.chat(
          [{ role: 'system', content: SYSTEM }].concat(state.messages), TOOLS
        );
        state.messages.push(msg);
        if (msg.content && msg.content.trim()) push('assistant', msg.content.trim());
        var calls = msg.tool_calls || [];
        if (!calls.length) break;
        for (var i = 0; i < calls.length; i++) {
          var tc = calls[i];
          var args = {};
          try { args = JSON.parse(tc.function && tc.function.arguments || '{}'); } catch (e) { args = {}; }
          var result;
          try { result = execute(tc.function.name, args); }
          catch (e) { result = { error: e.message }; }
          push('tool', { name: tc.function.name, args: args, result: result });
          state.messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify(result).slice(0, 4000)
          });
        }
      }
    } catch (e) {
      push('error', e.message || String(e));
    } finally {
      state.busy = false;
      setBusy(false);
    }
  }

  function runLocal(text) {
    var hits = window.APP_API.searchTargets(text);
    if (hits.length) {
      var top = hits.slice(0, 5).map(function (t) {
        var s = window.APP_API.score(t);
        return '· ' + t.name + '（' + (t.layer || '未标层级') + '）' + s.pct + ' 分 · ' + s.grade.label;
      }).join('\n');
      push('assistant', '没配大模型，我只能查本机台账。找到 ' + hits.length + ' 家相关的：\n' + top +
        '\n\n要跑完整的"建档 → 判层级 → 算分 → 起草话术"，去设置里填 API Key。');
      return;
    }
    var all = window.APP_API.targets();
    var best = all.slice().sort(function (a, b) { return window.APP_API.score(b).pct - window.APP_API.score(a).pct; }).slice(0, 3);
    push('assistant',
      '没配大模型，我只能查本机台账。台账里没有和「' + text.slice(0, 12) + '」对得上的公司。\n\n' +
      (best.length ? '目前分数最高的三家：\n' + best.map(function (t) {
        return '· ' + t.name + '　' + window.APP_API.score(t).pct + ' 分';
      }).join('\n') + '\n\n' : '') +
      '要做完整的找客户流程，两条路：\n1. 去「目标公司」手动建卡，勾信号。\n2. 去设置里填 API Key，让我跑 agent 循环。');
  }

  function reviewLocal(text) {
    var asks = (text.match(/[？?]/g) || []).length;
    var hasNext = /(下周|明天|后天|周[一二三四五六日]|月\d+日|\d+号|约|再联系|回访|电话)/.test(text);
    var hasCommit = /(我来|我会|我去|我发|我给|我确认|我问|答复|回复|今天|明天.*给)/.test(text);
    var passive = /(好的|行|可以|收到|嗯)[。.!！]?\s*$/.test(text.trim());
    var out = [];
    if (asks < 2) out.push('整段只有 ' + asks + ' 个问号。问得太少，说明你在答，不在挖。');
    if (!hasCommit) out.push('你这边没有明确的承诺（什么时候发资料、什么时候回复）。');
    if (!hasNext) out.push('没有落到具体的下一步时间。对话结束前必须换到一个明确动作。');
    if (passive) out.push('结尾停在"好的 / 行 / 可以"，主动权交出去了。');
    if (!out.length) out.push('问句、承诺、下一步都有，结构完整。再检查一遍有没有落到具体的人。');
    return out.join('\n');
  }

  async function runReview() {
    var box = el('reviewInput');
    var text = (box.value || '').trim();
    if (text.length < 20) { window.APP_API.toast('太短了，至少粘一段完整对话'); return; }

    push('user', '【复盘这段对话】\n' + text.slice(0, 500) + (text.length > 500 ? '…' : ''));
    el('reviewPanel').hidden = true;
    box.value = '';

    if (!window.APP_API.llm.enabled()) {
      push('assistant', '【本地规则检查，不是 AI 判断】\n' + reviewLocal(text));
      return;
    }

    setBusy(true);
    try {
      var msg = await window.APP_API.llm.chat([
        { role: 'system', content: '你是半导体 ToB 销售教练。语气直接、具体、不客套。中文，不超过 220 字。' },
        { role: 'user', content: '复盘下面这段销售对话。指出：1) 哪一句丢了主动权 2) 哪一句把天聊死了 3) 下一句该怎么回 4) 缺了哪个关键信息。不要泛泛而谈，要引用原话。\n\n' + text }
      ]);
      push('assistant', (msg.content || '').trim() || '模型没有返回内容');
    } catch (e) {
      push('error', e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function setBusy(on) {
    var b = el('btnAgentSend');
    if (!b) return;
    b.disabled = on;
    b.innerHTML = on ? '思考中…' : window.ICON('send') + '发送';
  }

  function reset() {
    state.messages = [];
    state.log = [];
    renderLog();
  }

  function init() {
    var sendBtn = el('btnAgentSend');
    if (!sendBtn) return;
    sendBtn.addEventListener('click', send);
    el('btnAgentReset').addEventListener('click', reset);
    el('agentInput').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-agent-example]'), function (b) {
      b.addEventListener('click', function () {
        el('agentInput').value = b.dataset.agentExample;
        el('agentInput').focus();
      });
    });

    var rb = el('btnAgentReview');
    if (rb) rb.addEventListener('click', function () {
      var p = el('reviewPanel');
      p.hidden = !p.hidden;
      if (!p.hidden) el('reviewInput').focus();
    });
    var rc = el('btnReviewClose');
    if (rc) rc.addEventListener('click', function () { el('reviewPanel').hidden = true; });
    var rr = el('btnReviewRun');
    if (rr) rr.addEventListener('click', runReview);
    var hint = el('reviewHint');
    if (hint) hint.textContent = window.APP_API.llm.enabled()
      ? '已接大模型，会引用原话给判断。'
      : '没配大模型时，走本地规则检查。';

    renderLog();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.AGENT_DEBUG = { execute: execute, tools: TOOLS, reset: reset };
})();
