/* 零依赖冒烟测试。node tests/smoke.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const win = {};
global.window = win;

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  (0, eval)(code);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok   ' + name); }
  else { console.log('  FAIL ' + name + (extra ? ' → ' + extra : '')); failed++; }
}

console.log('\n[数据]');
load('js/data-scenarios.js');
load('js/scoring.js');
load('js/data-playbook.js');

check('场景数 = 9', win.SCENARIOS.length === 9, win.SCENARIOS.length);
check('总轮次 = 28', win.SCENARIOS.reduce((a, s) => a + s.turns.length, 0) === 28);
check('产业链 10 层', win.CHAIN_LAYERS.length === 10, win.CHAIN_LAYERS.length);
check('品类拆解 12 个', win.CHAIN_CATEGORIES.length === 12, win.CHAIN_CATEGORIES.length);
check('芯片品类 9 类', win.SEMI_SEGMENTS.length === 9, win.SEMI_SEGMENTS.length);
check('下游应用 8 个', win.DOWNSTREAM_APPS.length === 8, win.DOWNSTREAM_APPS.length);
check('客户类型 6 类', win.CUSTOMER_TYPES.length === 6);
check('订单流程 12 步', win.ORDER_FLOW.length === 12);
check('异常路径 3 条', win.ESCALATION.length === 3);
check('信号分 3 组', win.INTENT_SIGNALS.length === 3);
check('卡点诊断 6 条', win.DIAGNOSIS.length === 6, win.DIAGNOSIS.length);
check('底座 13 节', win.PLAYBOOK.length === 13, win.PLAYBOOK.length);

let maxWeight = 0;
win.INTENT_SIGNALS.forEach(g => { if (g.w > 0) maxWeight += g.w * g.list.length; });
check('正信号权重合计 = 28', maxWeight === 28, maxWeight);

console.log('\n[评分引擎]');
let bad = [];
win.SCENARIOS.forEach(s => s.turns.forEach((t, i) => {
  const r = win.SCORING.evaluate(s, i, t.model);
  if (r.score !== 100 || r.avoidHits.length) bad.push(s.id + '#' + (i + 1) + ' score=' + r.score);
}));
check('全部参考答法满分', bad.length === 0, bad.join(', '));

const lame = ['好的，我知道了', '嗯嗯，明白', '行，那我等您消息', '我们产品很好，性价比高'];
let strong = 0, total = 0;
win.SCENARIOS.forEach(s => s.turns.forEach((t, i) => {
  lame.forEach(a => {
    total++;
    if (win.SCORING.evaluate(s, i, a).score >= 60) strong++;
  });
}));
check('敷衍回答拿不到及格分', strong === 0, strong + '/' + total);

console.log('\n' + (failed ? failed + ' 项失败' : '全部通过'));
process.exit(failed ? 1 : 0);
