/* 陪练评分引擎：关键词规则打分，离线可用 */
(function () {
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\u3000]/g, '')
      .replace(/[，。、；：？！“”‘’（）《》,.!?;:'"()<>\[\]{}~`\-_/\\|]/g, '');
  }

  function hitRule(rule, text) {
    var any = rule.any || [];
    var matched = false;
    for (var i = 0; i < any.length; i++) {
      if (text.indexOf(normalize(any[i])) !== -1) { matched = true; break; }
    }
    if (!matched && rule.re) {
      try { matched = new RegExp(rule.re, 'i').test(String(text)); } catch (e) { matched = false; }
    }
    return matched;
  }

  function excepted(rule, text) {
    if (!rule.except) return false;
    for (var i = 0; i < rule.except.length; i++) {
      if (text.indexOf(normalize(rule.except[i])) !== -1) return true;
    }
    return false;
  }

  function evaluate(scenario, turnIndex, rawText) {
    var turn = scenario.turns[turnIndex];
    var text = normalize(rawText);
    var raw = String(rawText || '').trim();
    var must = turn.must || [];
    var avoid = turn.avoid || [];

    var mustHits = [], mustMiss = [];
    must.forEach(function (rule) {
      if (hitRule(rule, text)) mustHits.push(rule.label);
      else mustMiss.push(rule);
    });

    var avoidHits = [];
    avoid.forEach(function (rule) {
      if (!hitRule(rule, text)) return;
      if (excepted(rule, text)) return;
      if (rule.maxLen && raw.length > rule.maxLen) return;
      avoidHits.push(rule.label);
    });

    var base = must.length ? mustHits.length / must.length : 1;
    var score = Math.max(0, base - 0.34 * avoidHits.length);
    score = Math.round(score * 100);

    return {
      score: score,
      mustHits: mustHits,
      mustMiss: mustMiss.map(function (r) { return r.label; }),
      avoidHits: avoidHits,
      model: turn.model
    };
  }

  function grade(score) {
    if (score >= 85) return { key: 'good', label: '这句能打，客户不会拿它挑刺' };
    if (score >= 60) return { key: 'mid', label: '方向对，还差一两个动作' };
    if (score >= 35) return { key: 'mid', label: '有想到，但关键动作漏了' };
    return { key: 'bad', label: '这句会被客户带节奏，重来一次' };
  }

  function summarize(results) {
    if (!results.length) return { avg: 0, traps: 0, grade: grade(0) };
    var sum = 0, traps = 0;
    results.forEach(function (r) { sum += r.score; traps += r.avoidHits.length; });
    var avg = Math.round(sum / results.length);
    return { avg: avg, traps: traps, grade: grade(avg) };
  }

  window.SCORING = { evaluate: evaluate, grade: grade, summarize: summarize, normalize: normalize };
})();
