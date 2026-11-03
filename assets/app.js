/* =========================================================
   砺学题库 · 应用逻辑
   纯原生 JavaScript，无框架、无后端
   ========================================================= */

(function () {
  "use strict";

  const BANK = window.QUESTION_BANK;
  if (!BANK || !Array.isArray(BANK.questions)) {
    document.getElementById("app").innerHTML =
      '<div class="empty-state"><div class="empty-mark">!</div><h3>题库数据未加载</h3><p>请确认 data/questions.js 与 index.html 位于同一目录结构中。</p></div>';
    return;
  }

  const QUESTIONS = BANK.questions;
  const META = BANK.meta;
  const Q_MAP = new Map(QUESTIONS.map((q) => [q.id, q]));
  const ALL_CATEGORIES = META.categories.map((c) => c.name);
  const ALL_TYPES = ["single", "multi", "judge", "fill", "short"];
  const TYPE_LABEL = {
    single: "单选题",
    multi: "多选题",
    judge: "判断题",
    fill: "填空题",
    short: "简答题",
  };
  const TYPE_SHORT = {
    single: "单选",
    multi: "多选",
    judge: "判断",
    fill: "填空",
    short: "简答",
  };
  const TYPE_HINT = {
    single: "单选 · 选出唯一正确答案",
    multi: "请选出所有正确答案（少选、多选均不得分）",
    judge: "判断 · 判断下列说法是否正确",
    fill: "填空 · 在下方写下你的答案，提交后对照参考答案",
    short: "简答 · 在下方组织你的答案，提交后对照参考答案",
  };
  const AUTO_TYPES = new Set(["single", "multi", "judge"]);
  const SELF_TYPES = new Set(["fill", "short"]);
  const STORAGE_KEY = "lishi-question-bank-v1";
  const PAGE_SIZE = 12;
  const MAX_GROUP_PER_TYPE = 5;
  const CIRCLE_NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const toastEl = document.getElementById("toast");
  const headerStatus = document.getElementById("header-status");
  const footerTotal = document.getElementById("footer-total");

  let store = null;
  let toastTimer = 0;
  let saveTimer = 0;
  let lastFocused = null;

  const state = {
    view: "practice",
    practice: {
      stage: "setup",
      categories: new Set(ALL_CATEGORIES),
      types: new Set(ALL_TYPES),
      weight: 70,
      count: 20,
      session: null,
    },
    group: {
      stage: "setup",
      categories: new Set(ALL_CATEGORIES),
      weight: 70,
      counts: { single: 3, multi: 1, judge: 1, fill: 1, short: 1 },
      session: null,
    },
    browse: {
      query: "",
      categories: new Set(ALL_CATEGORIES),
      types: new Set(ALL_TYPES),
      importance: "all",
      status: "all",
      page: 1,
      filtersOpen: false,
    },
    modal: null,
  };

  /* ---------------------------------------------------------
     Utilities
     --------------------------------------------------------- */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escAttr(value) {
    return esc(value).replace(/\n/g, "&#10;");
  }

  function nl2br(value) {
    return esc(value).replace(/\r?\n/g, "<br>");
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function unique(list) {
    return Array.from(new Set(list));
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(timestamp));
    } catch (err) {
      return "";
    }
  }

  function formatStem(stem, type) {
    let text = String(stem);
    if (type === "multi") {
      text = text.replace(/^[（(]\s*多选\s*[）)]\s*/, "");
    }
    let html = esc(text);
    const blank = '<span class="blank-mark" aria-label="空格"></span>';
    html = html.replace(/_{2,}/g, blank);
    html = html.replace(/（[\u3000\s]{1,}）/g, blank);
    html = html.replace(/\([\u3000\s]{2,}\)/g, blank);
    html = html.replace(/（\s*）/g, blank);
    return html.replace(/\r?\n/g, "<br>");
  }

  function typeTag(type, extraClass) {
    return `<span class="tag tag-type-${type} ${extraClass || ""}">${TYPE_LABEL[type]}</span>`;
  }

  function importanceTag(important) {
    return important
      ? '<span class="tag tag-important">重</span>'
      : '<span class="tag tag-normal">轻</span>';
  }

  function categoryTag(q, extraClass) {
    return `<span class="tag tag-category ${extraClass || ""}" title="${escAttr(q.category)}"><span class="tag-dot"></span>${esc(q.categoryShort)}</span>`;
  }

  function statusTag(status) {
    if (status === "passed") return '<span class="tag tag-status-passed">已通过</span>';
    if (status === "wrong") return '<span class="tag tag-status-wrong">曾答错</span>';
    return '<span class="tag tag-status-new">未练习</span>';
  }

  function sourceLabel(q) {
    const suffix = q.number
      ? ` · 原题 ${q.number}`
      : q.type === "short"
      ? " · 补充题"
      : " · 例题";
    return `第${q.part}部分${suffix}`;
  }

  function questionMeta(q, includeSource) {
    return [
      typeTag(q.type),
      importanceTag(q.important),
      categoryTag(q),
      includeSource ? `<span class="tag tag-normal">${esc(sourceLabel(q))}</span>` : "",
    ]
      .filter(Boolean)
      .join("");
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove("is-visible");
    }, 2600);
  }

  /* ---------------------------------------------------------
     Persistence
     --------------------------------------------------------- */

  function defaultPrefs() {
    return {
      practice: {
        categories: ALL_CATEGORIES.slice(),
        types: ALL_TYPES.slice(),
        weight: 70,
        count: 20,
      },
      group: {
        categories: ALL_CATEGORIES.slice(),
        weight: 70,
        counts: { single: 3, multi: 1, judge: 1, fill: 1, short: 1 },
      },
    };
  }

  function loadStore() {
    const defaults = defaultPrefs();
    let parsed = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (err) {
      parsed = null;
    }

    const stats = {};
    if (parsed && parsed.stats && typeof parsed.stats === "object") {
      Object.keys(parsed.stats).forEach((qid) => {
        if (!Q_MAP.has(qid)) return;
        const rawStat = parsed.stats[qid];
        if (!rawStat || typeof rawStat !== "object") return;
        const attempts = Math.max(0, Number(rawStat.attempts) || 0);
        const correct = clamp(Number(rawStat.correct) || 0, 0, attempts);
        stats[qid] = {
          attempts,
          correct,
          lastCorrect: Boolean(rawStat.lastCorrect),
          lastAt: Number(rawStat.lastAt) || 0,
        };
      });
    }

    const history = [];
    if (parsed && Array.isArray(parsed.history)) {
      parsed.history.slice(0, 80).forEach((item) => {
        if (!item || !Q_MAP.has(item.qid)) return;
        history.push({
          qid: item.qid,
          correct: Boolean(item.correct),
          at: Number(item.at) || 0,
        });
      });
    }

    const prefs = defaults;
    if (parsed && parsed.prefs) {
      const p = parsed.prefs;
      if (p.practice) {
        if (Array.isArray(p.practice.categories)) {
          prefs.practice.categories = p.practice.categories.filter((name) =>
            ALL_CATEGORIES.includes(name)
          );
        }
        if (Array.isArray(p.practice.types)) {
          prefs.practice.types = p.practice.types.filter((type) => ALL_TYPES.includes(type));
        }
        if (Number.isFinite(Number(p.practice.weight))) {
          prefs.practice.weight = clamp(Math.round(Number(p.practice.weight) / 10) * 10, 0, 100);
        }
        if ([0, 10, 20, 40].includes(Number(p.practice.count))) {
          prefs.practice.count = Number(p.practice.count);
        }
      }
      if (p.group) {
        if (Array.isArray(p.group.categories)) {
          prefs.group.categories = p.group.categories.filter((name) =>
            ALL_CATEGORIES.includes(name)
          );
        }
        if (Number.isFinite(Number(p.group.weight))) {
          prefs.group.weight = clamp(Math.round(Number(p.group.weight) / 10) * 10, 0, 100);
        }
        if (p.group.counts && typeof p.group.counts === "object") {
          ALL_TYPES.forEach((type) => {
            const value = Number(p.group.counts[type]);
            if (Number.isFinite(value)) {
              prefs.group.counts[type] = clamp(Math.round(value), 0, MAX_GROUP_PER_TYPE);
            }
          });
        }
      }
    }

    store = { stats, history, prefs };
  }

  function saveStore() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveStoreNow();
    }, 120);
  }

  function saveStoreNow() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
      /* 本地存储不可用时，当前会话仍可继续使用 */
    }
  }

  function persistPracticePrefs() {
    store.prefs.practice.categories = Array.from(state.practice.categories);
    store.prefs.practice.types = Array.from(state.practice.types);
    store.prefs.practice.weight = state.practice.weight;
    store.prefs.practice.count = state.practice.count;
    saveStore();
  }

  function persistGroupPrefs() {
    store.prefs.group.categories = Array.from(state.group.categories);
    store.prefs.group.weight = state.group.weight;
    store.prefs.group.counts = Object.assign({}, state.group.counts);
    saveStore();
  }

  function recordAttempt(qid, correct) {
    const now = Date.now();
    const current = store.stats[qid] || { attempts: 0, correct: 0, lastCorrect: false, lastAt: 0 };
    current.attempts += 1;
    if (correct) current.correct += 1;
    current.lastCorrect = Boolean(correct);
    current.lastAt = now;
    store.stats[qid] = current;
    store.history.unshift({ qid, correct: Boolean(correct), at: now });
    store.history = store.history.slice(0, 60);
    saveStore();
    updateChrome();
  }

  function updateLastResult(qid, correct) {
    const current = store.stats[qid];
    if (!current) {
      recordAttempt(qid, correct);
      return;
    }
    if (current.lastCorrect !== Boolean(correct)) {
      current.correct = clamp(current.correct + (correct ? 1 : -1), 0, current.attempts);
    }
    current.lastCorrect = Boolean(correct);
    current.lastAt = Date.now();
    const latest = store.history.find((item) => item.qid === qid);
    if (latest) latest.correct = Boolean(correct);
    saveStore();
    updateChrome();
  }

  function statOf(qid) {
    return store.stats[qid] || null;
  }

  function statusOf(qid) {
    const stat = statOf(qid);
    if (!stat) return "new";
    return stat.lastCorrect ? "passed" : "wrong";
  }

  function resetLearningData() {
    store.stats = {};
    store.history = [];
    saveStoreNow();
    updateChrome();
    closeModal();
    render();
    showToast("学习记录已清空");
  }

  /* ---------------------------------------------------------
     Question helpers
     --------------------------------------------------------- */

  function filteredQuestions(categories, types) {
    return QUESTIONS.filter((q) => categories.has(q.category) && types.has(q.type));
  }

  function sampleWeighted(pool, count, weight) {
    const amount = Math.max(0, Math.min(count, pool.length));
    if (amount === 0) return [];
    if (amount === pool.length) return shuffle(pool);

    const heavy = shuffle(pool.filter((q) => q.important));
    const light = shuffle(pool.filter((q) => !q.important));
    const picked = [];
    const heavyProbability = clamp(weight, 0, 100);

    while (picked.length < amount && (heavy.length || light.length)) {
      let chooseHeavy;
      if (!heavy.length) chooseHeavy = false;
      else if (!light.length) chooseHeavy = true;
      else chooseHeavy = Math.random() * 100 < heavyProbability;
      picked.push(chooseHeavy ? heavy.pop() : light.pop());
    }
    return picked;
  }

  function correctLetters(q) {
    return (q.answer || "").split("").filter((ch) => /[A-E]/.test(ch));
  }

  function gradeChoice(q, selected) {
    if (q.type === "judge") {
      return selected.length === 1 && selected[0] === q.answer;
    }
    const correct = correctLetters(q).sort().join("");
    const chosen = selected.slice().sort().join("");
    return correct.length > 0 && correct === chosen;
  }

  function answerContent(q) {
    if (q.type === "single" || q.type === "multi") {
      const letters = correctLetters(q);
      const lines = q.options
        .filter((opt) => letters.includes(opt.key))
        .map(
          (opt) =>
            `<div class="answer-option-line"><b>${esc(opt.key)}</b><span>${esc(opt.text)}</span></div>`
        )
        .join("");
      return `<div class="answer-options">${lines}</div>`;
    }
    if (q.type === "judge") {
      return `<div class="answer-main"><strong>${q.answer === "√" ? "√ 正确" : "× 错误"}</strong></div>`;
    }
    if (q.type === "fill") {
      if (!q.answers || !q.answers.length) {
        return '<div class="answer-main muted">本题原文档未标注参考答案。</div>';
      }
      if (q.answers.length === 1) {
        return `<div class="answer-main"><strong>${esc(q.answers[0])}</strong></div>`;
      }
      return `<div class="answer-main">${q.answers
        .map(
          (item, idx) =>
            `<div><span class="muted">${CIRCLE_NUMS[idx] || `${idx + 1}.`}</span> ${esc(item)}</div>`
        )
        .join("")}</div>`;
    }
    return `<div class="answer-main">${nl2br(q.answer || "原文档未提供参考答案。")}</div>`;
  }

  function answerPanel(q, includeMeta) {
    return `<div class="answer-panel">
      <div class="answer-label">参考答案</div>
      ${answerContent(q)}
      ${includeMeta === false ? "" : `<div class="answer-meta">${questionMeta(q, true)}</div>`}
    </div>`;
  }

  /* ---------------------------------------------------------
     Global chrome
     --------------------------------------------------------- */

  function updateChrome() {
    const navButtons = document.querySelectorAll(".nav-item");
    navButtons.forEach((btn) => {
      const active = btn.getAttribute("data-view") === state.view;
      btn.classList.toggle("is-active", active);
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });

    let passed = 0;
    let wrong = 0;
    let attempts = 0;
    let correctAttempts = 0;

    QUESTIONS.forEach((q) => {
      const stat = store.stats[q.id];
      if (!stat) return;
      if (stat.lastCorrect) passed += 1;
      else wrong += 1;
      attempts += stat.attempts;
      correctAttempts += stat.correct;
    });

    const unpracticed = META.total - passed - wrong;
    const accuracy = attempts ? Math.round((correctAttempts / attempts) * 100) : 0;

    if (headerStatus) {
      headerStatus.innerHTML = `
        <div class="header-stat-row" role="group" aria-label="全局答题状态">
          <span class="header-stat passed" title="最后一次作答为正确的题目">
            <b>${passed}</b><small>正确</small>
          </span>
          <span class="header-stat wrong" title="最后一次作答为错误的题目">
            <b>${wrong}</b><small>错误</small>
          </span>
          <span class="header-stat new" title="还没有判分记录的题目">
            <b>${unpracticed}</b><small>未练习</small>
          </span>
        </div>
        <div class="header-subline">
          <span>${META.total} 题</span>
          <span>正确率 ${accuracy}%</span>
        </div>`;
    }
    if (footerTotal) footerTotal.textContent = String(META.total);
  }

  function switchView(view) {
    if (!["practice", "group", "browse", "stats"].includes(view)) return;
    state.view = view;
    if (window.location.hash !== `#${view}`) {
      try {
        window.history.replaceState(null, "", `#${view}`);
      } catch (err) {
        /* ignore */
      }
    }
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------------------------------------------------
     Render root
     --------------------------------------------------------- */

  function render() {
    updateChrome();
    if (state.view === "practice") renderPracticeView();
    else if (state.view === "group") renderGroupView();
    else if (state.view === "browse") renderBrowseView();
    else renderStatsView();
    renderModal();
  }

  /* ---------------------------------------------------------
     Practice view
     --------------------------------------------------------- */

  function renderPracticeView() {
    if (state.practice.stage === "session") renderPracticeSession();
    else if (state.practice.stage === "summary") renderPracticeSummary();
    else renderPracticeSetup();
  }

  function categoryChips(scope, selected) {
    return META.categories
      .map((cat) => {
        const on = selected.has(cat.name);
        return `<button type="button" class="check-chip ${on ? "is-on" : ""}" data-action="toggle-${scope}-category" data-value="${escAttr(cat.name)}" title="${escAttr(cat.name)}" aria-pressed="${on}">
          <span class="chip-check">${on ? "✓" : ""}</span>
          <span>${esc(cat.short)}</span>
          <span class="chip-count">${cat.count}</span>
        </button>`;
      })
      .join("");
  }

  function typeChips(scope, selected, counts) {
    return ALL_TYPES.map((type) => {
      const on = selected.has(type);
      const count = counts[type] || 0;
      return `<button type="button" class="check-chip ${on ? "is-on" : ""}" data-action="toggle-${scope}-type" data-value="${type}" aria-pressed="${on}">
        <span class="chip-check">${on ? "✓" : ""}</span>
        <span>${TYPE_LABEL[type]}</span>
        <span class="chip-count">${count}</span>
      </button>`;
    }).join("");
  }

  function weightCard(scope, weight, summaryHtml) {
    return `<aside class="weight-card card">
      <div class="weight-kicker">抽题权重</div>
      <div class="weight-heading">重题与轻题的抽取比例</div>
      <div class="weight-readout">
        <span class="heavy-num">${weight / 10}</span>
        <span class="ratio-colon">:</span>
        <span class="light-num">${(100 - weight) / 10}</span>
      </div>
      <div class="weight-caption">重题 ${weight}% · 轻题 ${100 - weight}%</div>
      <div class="range-wrap">
        <input type="range" min="0" max="100" step="10" value="${weight}" style="--range-fill:${weight}%" data-field="${scope}-weight" aria-label="重题抽取权重">
        <div class="range-labels"><span>全轻 0:10</span><span>均衡 5:5</span><span>全重 10:0</span></div>
      </div>
      <div class="weight-preset-row">
        ${[50, 60, 70, 80, 90]
          .map(
            (value) =>
              `<button type="button" class="preset-btn" data-action="${scope}-weight-preset" data-weight="${value}">${value / 10}:${(100 - value) / 10}</button>`
          )
          .join("")}
      </div>
      ${summaryHtml || ""}
    </aside>`;
  }

  function renderPracticeSetup() {
    const pool = filteredQuestions(state.practice.categories, state.practice.types);
    const heavy = pool.filter((q) => q.important).length;
    const light = pool.length - heavy;
    const count = state.practice.count === 0 ? pool.length : Math.min(state.practice.count, pool.length);
    const eligible = pool.length > 0;
    const typeCounts = {};
    QUESTIONS.forEach((q) => {
      typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
    });

    app.innerHTML = `<section class="view">
      <div class="view-head">
        <div>
          <div class="eyebrow">Daily Practice</div>
          <h1 class="page-title">一次一题，稳步向前</h1>
          <p class="page-lead">按专题和题型筛选题目，用「重 : 轻」滑块调整抽题概率，再开始一轮专注练习。</p>
        </div>
        <div class="head-note">题库共 ${META.total} 题 · ${META.categories.length} 个专题</div>
      </div>

      <div class="setup-grid">
        <div class="setup-main card">
          <div class="filter-block">
            <div class="section-label">
              <h3>专题范围</h3>
              <div class="inline-actions">
                <button type="button" class="text-action" data-action="select-all-practice-categories">全选</button>
                <button type="button" class="text-action" data-action="clear-practice-categories">清空</button>
                <span>${state.practice.categories.size} / ${META.categories.length}</span>
              </div>
            </div>
            <div class="chip-grid">${categoryChips("practice", state.practice.categories)}</div>
          </div>

          <div class="filter-block">
            <div class="section-label">
              <h3>题型范围</h3>
              <div class="inline-actions">
                <button type="button" class="text-action" data-action="select-all-practice-types">全选</button>
                <span>${state.practice.types.size} / ${ALL_TYPES.length}</span>
              </div>
            </div>
            <div class="chip-grid">${typeChips("practice", state.practice.types, typeCounts)}</div>
          </div>

          <div class="filter-block">
            <div class="select-row">
              <label class="select-control">
                <span>本轮题数</span>
                <select data-field="practice-count">
                  ${[10, 20, 40, 0]
                    .map(
                      (value) =>
                        `<option value="${value}" ${value === state.practice.count ? "selected" : ""}>${value === 0 ? "全部符合条件的题" : `${value} 题`}</option>`
                    )
                    .join("")}
                </select>
              </label>
              <div class="select-control">
                <span>抽题说明</span>
                <div class="helper-note" style="margin-top:0">
                  <span><strong>权重</strong>只影响抽中概率，不改变题目难度。若某一类题已抽完，会自动从另一类补足。</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        ${weightCard(
          "practice",
          state.practice.weight,
          `<div class="setup-summary">
            <div class="summary-line"><span>符合当前筛选</span><strong>${pool.length} 道</strong></div>
            <div class="summary-line"><span>其中重题 / 轻题</span><strong>${heavy} / ${light}</strong></div>
            <div class="summary-line"><span>本轮计划抽取</span><strong>${count} 道</strong></div>
            <div class="summary-total"><strong>${count}</strong> 道题，约 ${Math.max(3, Math.round(count * 1.2))} 分钟</div>
            <div class="setup-actions">
              <button type="button" class="btn btn-primary btn-lg btn-block" data-action="start-practice" ${eligible ? "" : "disabled"}>开始练习</button>
              <button type="button" class="btn btn-secondary btn-block" data-action="view-browse">先浏览题库</button>
            </div>
            ${eligible ? "" : '<div class="helper-note"><span>当前筛选下没有题目，请至少选择一个专题和一个题型。</span></div>'}
          </div>`
        )}
      </div>
    </section>`;
  }

  function startPractice(poolOverride) {
    let pool = poolOverride;
    if (!Array.isArray(pool)) {
      pool = filteredQuestions(state.practice.categories, state.practice.types);
    }
    if (!pool.length) {
      showToast("当前筛选下没有可练习的题目");
      return;
    }
    const requested = state.practice.count === 0 ? pool.length : state.practice.count;
    const count = Math.min(requested, pool.length);
    const picked = sampleWeighted(pool, count, state.practice.weight);
    const items = picked.map((q) => ({
      qid: q.id,
      selected: [],
      draft: "",
      submitted: false,
      result: null,
      selfCorrect: null,
      recorded: false,
    }));

    state.practice.session = {
      items,
      index: 0,
      startedAt: Date.now(),
      config: {
        categories: Array.from(state.practice.categories),
        types: Array.from(state.practice.types),
        weight: state.practice.weight,
        count,
      },
    };
    state.practice.stage = "session";
    state.view = "practice";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function currentPracticeItem() {
    const session = state.practice.session;
    if (!session) return null;
    return session.items[session.index] || null;
  }

  function renderPracticeSession() {
    const session = state.practice.session;
    if (!session || !session.items.length) {
      state.practice.stage = "setup";
      renderPracticeSetup();
      return;
    }
    const item = currentPracticeItem();
    const q = Q_MAP.get(item.qid);
    const position = session.index + 1;
    const total = session.items.length;
    const percent = (position / total) * 100;
    const correctCount = session.items.filter(
      (it) => it.result === true || it.selfCorrect === true
    ).length;
    const wrongCount = session.items.filter(
      (it) => it.result === false || it.selfCorrect === false
    ).length;
    const isLast = position === total;

    app.innerHTML = `<section class="view session-wrap">
      <div class="session-head">
        <div class="session-progress">
          <div class="session-progress-label">
            <span>第 <strong>${position}</strong> / ${total} 题</span>
            <span>${esc(q.categoryShort)}</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        </div>
        <div class="session-score">答对 <strong>${correctCount}</strong> · 答错 <span class="wrong-count">${wrongCount}</span></div>
        <button type="button" class="btn btn-ghost btn-sm" data-action="end-practice">结束本轮</button>
      </div>

      <article class="question-card card">
        <div class="question-top">
          <div class="question-index">第 <strong>${pad2(position)}</strong> 题 <span class="muted">/ ${pad2(total)}</span></div>
          <div class="question-meta">${questionMeta(q, true)}</div>
        </div>

        <h1 class="question-stem">${formatStem(q.stem, q.type)}</h1>
        <div class="question-instruction ${q.type === "multi" ? "is-multi" : ""}">${q.type === "multi" ? '<span class="multi-mark">多选</span>' : ""}${TYPE_HINT[q.type]}</div>

        ${renderQuestionInput(q, item, "practice", session.submitted === true)}
        ${item.submitted ? renderPracticeFeedback(q, item) : ""}

        <div class="practice-actions">
          ${
            item.submitted
              ? `<button type="button" class="btn btn-primary" data-action="next-practice">${isLast ? "完成本轮" : "下一题"}</button>`
              : `<button type="button" class="btn btn-primary" data-action="submit-practice">${AUTO_TYPES.has(q.type) ? "提交答案" : "对照参考答案"}</button>`
          }
          <span class="shortcut-hint">${q.type === "judge" ? "点击判断选项 · Enter 提交 / 下一题" : AUTO_TYPES.has(q.type) ? "键盘：A–E 选择 · Enter 提交 / 下一题" : "提交后可对照答案并自评"}</span>
        </div>
      </article>
    </section>`;

    if (item.submitted) {
      const textarea = app.querySelector("textarea");
      if (textarea && textarea.value === "") textarea.value = item.draft || "";
    }
  }

  function renderQuestionInput(q, item, scope, locked) {
    if (AUTO_TYPES.has(q.type)) {
      return `<div class="options ${q.type === "multi" ? "is-multi" : ""}">${renderChoiceOptions(q, item, scope, locked)}</div>`;
    }
    return `<div class="self-answer">
      <label for="${scope}-answer-${q.id}">
        <span>写下你的答案</span>
        <span class="muted tiny">提交后显示参考答案</span>
      </label>
      <textarea id="${scope}-answer-${q.id}" data-${scope}-draft="${q.id}" placeholder="${q.type === "fill" ? "请填写答案，多个空可用分号隔开…" : "请组织语言作答，写出要点即可…"}" ${locked || item.submitted ? "disabled" : ""}>${esc(item.draft || "")}</textarea>
    </div>`;
  }

  function renderChoiceOptions(q, item, scope, locked) {
    if (q.type === "judge") {
      return `<div class="judge-options">
        ${[
          { key: "√", label: "正确", symbol: "✓" },
          { key: "×", label: "错误", symbol: "✕" },
        ]
          .map((option) => {
            const selected = item.selected.includes(option.key);
            const isCorrect = q.answer === option.key;
            let classes = "judge-option";
            if (selected) classes += " is-selected";
            if (locked || item.submitted) {
              classes += " is-locked";
              if (isCorrect) classes += " is-correct";
              else if (selected) classes += " is-wrong";
            }
            return `<button type="button" class="${classes}" data-action="select-option" data-scope="${scope}" data-qid="${q.id}" data-key="${option.key}" ${locked || item.submitted ? "disabled" : ""} aria-pressed="${selected}">
              <span class="judge-symbol">${option.symbol}</span>
              <span>${option.label}</span>
            </button>`;
          })
          .join("")}
      </div>`;
    }

    const letters = correctLetters(q);
    return q.options
      .map((opt) => {
        const selected = item.selected.includes(opt.key);
        const isCorrect = letters.includes(opt.key);
        let classes = "option";
        if (selected) classes += " is-selected";
        if (locked || item.submitted) {
          classes += " is-locked";
          if (isCorrect) classes += " is-correct";
          else if (selected) classes += " is-wrong";
        }
        let stateText = "";
        if (locked || item.submitted) {
          if (isCorrect) stateText = selected ? "已选对" : "正确答案";
          else if (selected) stateText = "你的选择";
        }
        return `<button type="button" class="${classes}" data-action="select-option" data-scope="${scope}" data-qid="${q.id}" data-key="${opt.key}" ${locked || item.submitted ? "disabled" : ""} aria-pressed="${selected}">
          <span class="option-key">${opt.key}</span>
          <span class="option-text">${esc(opt.text)}</span>
          ${stateText ? `<span class="option-state">${stateText}</span>` : ""}
        </button>`;
      })
      .join("");
  }

  function renderPracticeFeedback(q, item) {
    if (AUTO_TYPES.has(q.type)) {
      const correct = Boolean(item.result);
      return `<div class="feedback ${correct ? "correct" : "wrong"}">
        <div class="feedback-head">
          <span class="feedback-icon">${correct ? "✓" : "×"}</span>
          <span class="feedback-title">${correct ? "回答正确" : "回答错误"}</span>
          <span class="tag ${correct ? "tag-status-passed" : "tag-status-wrong"}">已计入统计</span>
        </div>
        <div class="feedback-text">${correct ? "保持这个节奏，继续下一题。" : "对照参考答案，留意题干中的关键限定词。"}</div>
        ${answerPanel(q, true)}
      </div>`;
    }

    const graded = item.selfCorrect !== null;
    const correct = item.selfCorrect === true;
    return `<div class="feedback ${graded ? (correct ? "correct" : "wrong") : "neutral"}">
      <div class="feedback-head">
        <span class="feedback-icon">${graded ? (correct ? "✓" : "×") : "○"}</span>
        <span class="feedback-title">${graded ? (correct ? "本题自评为答对" : "本题自评为答错") : "参考答案已展示"}</span>
        <span class="tag ${graded ? (correct ? "tag-status-passed" : "tag-status-wrong") : "tag-normal"}">${graded ? "已计入统计" : "待自评"}</span>
      </div>
      <div class="feedback-text">${graded ? "可随时修改自评结果，统计会以最后一次为准。" : "请对照参考答案，判断你的回答是否命中关键要点。"}</div>
      ${answerPanel(q, true)}
      <div class="self-grade">
        <span class="self-grade-label">我的判断：</span>
        <button type="button" class="btn btn-secondary btn-sm ${item.selfCorrect === true ? "is-chosen" : ""}" data-action="self-grade" data-scope="practice" data-qid="${q.id}" data-correct="1">我答对了</button>
        <button type="button" class="btn btn-secondary btn-sm ${item.selfCorrect === false ? "is-chosen-wrong" : ""}" data-action="self-grade" data-scope="practice" data-qid="${q.id}" data-correct="0">我答错了</button>
      </div>
      ${graded ? `<div class="graded-note">本题已记录：${correct ? "通过" : "错误"}。修改自评不会重复增加练习次数。</div>` : ""}
    </div>`;
  }

  function submitPractice() {
    const item = currentPracticeItem();
    if (!item) return;
    const q = Q_MAP.get(item.qid);
    if (item.submitted) return;

    if (AUTO_TYPES.has(q.type)) {
      if (!item.selected.length) {
        showToast(q.type === "multi" ? "请至少选择一个选项" : "请选择一个答案");
        return;
      }
      const correct = gradeChoice(q, item.selected);
      item.submitted = true;
      item.result = correct;
      if (!item.recorded) {
        recordAttempt(q.id, correct);
        item.recorded = true;
      }
      render();
      return;
    }

    item.submitted = true;
    render();
  }

  function nextPractice() {
    const session = state.practice.session;
    const item = currentPracticeItem();
    if (!session || !item) return;
    if (!item.submitted) {
      showToast("请先提交答案");
      return;
    }
    const q = Q_MAP.get(item.qid);
    if (SELF_TYPES.has(q.type) && item.selfCorrect === null) {
      showToast("本题尚未自评，将不会计入统计");
    }
    if (session.index >= session.items.length - 1) {
      endPractice();
    } else {
      session.index += 1;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function endPractice() {
    if (!state.practice.session) {
      state.practice.stage = "setup";
    } else {
      state.practice.stage = "summary";
    }
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function computePracticeSummary() {
    const session = state.practice.session;
    const items = session ? session.items : [];
    let attempted = 0;
    let correct = 0;
    let wrong = 0;
    let pending = 0;

    items.forEach((item) => {
      const q = Q_MAP.get(item.qid);
      const submitted = item.submitted;
      const graded =
        item.result !== null || (SELF_TYPES.has(q.type) && item.selfCorrect !== null);
      if (submitted) attempted += 1;
      if (graded) {
        if (item.result === true || item.selfCorrect === true) correct += 1;
        else wrong += 1;
      } else if (submitted && SELF_TYPES.has(q.type)) {
        pending += 1;
      }
    });

    return { total: items.length, attempted, correct, wrong, pending, graded: correct + wrong };
  }

  function renderPracticeSummary() {
    const summary = computePracticeSummary();
    const accuracy = summary.graded ? Math.round((summary.correct / summary.graded) * 100) : 0;
    const message =
      summary.graded === 0
        ? "本轮还没有完成判分的题目。下次可以试着先写下答案，再对照参考答案。"
        : accuracy >= 85
        ? "状态很好。继续保持这种稳定、专注的节奏。"
        : accuracy >= 60
        ? "整体不错。把错题对应的知识点再读一遍，会更扎实。"
        : "别急，先回到题库把相关知识点过一遍，再练一轮会更有效。";

    app.innerHTML = `<section class="view">
      <div class="result-card card">
        <div class="result-mark">${summary.graded ? "✓" : "○"}</div>
        <h1 class="result-title">本轮练习完成</h1>
        <p class="result-subtitle">${message}</p>
        <div class="result-numbers">
          <div class="result-number"><strong>${summary.attempted}</strong><span>已作答</span></div>
          <div class="result-number"><strong>${summary.correct}</strong><span>答对</span></div>
          <div class="result-number"><strong>${summary.wrong}</strong><span>答错</span></div>
          <div class="result-number"><strong>${summary.pending}</strong><span>待自评</span></div>
        </div>
        <div class="small muted">本轮判分正确率 <strong style="color:var(--red-deep)">${accuracy}%</strong> · 共 ${summary.total} 题</div>
        <div class="result-actions" style="margin-top:26px">
          <button type="button" class="btn btn-primary" data-action="practice-again">再来一轮</button>
          <button type="button" class="btn btn-secondary" data-action="practice-setup">调整设置</button>
          <button type="button" class="btn btn-ghost" data-action="view-stats">查看学习统计</button>
        </div>
      </div>
    </section>`;
  }

  /* ---------------------------------------------------------
     Group view
     --------------------------------------------------------- */

  function renderGroupView() {
    if (state.group.stage === "session") renderGroupSession();
    else renderGroupSetup();
  }

  function groupPlan() {
    const pool = filteredQuestions(state.group.categories, new Set(ALL_TYPES));
    const byType = {};
    ALL_TYPES.forEach((type) => {
      byType[type] = pool.filter((q) => q.type === type);
    });
    return ALL_TYPES.map((type) => {
      const requested = state.group.counts[type] || 0;
      const available = byType[type].length;
      return {
        type,
        requested,
        available,
        count: Math.min(requested, available),
        pool: byType[type],
      };
    });
  }

  function renderGroupSetup() {
    const plan = groupPlan();
    const actualTotal = plan.reduce((sum, row) => sum + row.count, 0);
    const requestedTotal = plan.reduce((sum, row) => sum + row.requested, 0);
    const composition = plan.filter((row) => row.count > 0);

    app.innerHTML = `<section class="view">
      <div class="view-head">
        <div>
          <div class="eyebrow">Mock Group</div>
          <h1 class="page-title">一页一组，模拟小测</h1>
          <p class="page-lead">每种题型抽取少量题目组成一组。选择题与判断题交卷后自动判分，填空、简答由你对照答案自评。</p>
        </div>
        <div class="head-note">建议每组 5–8 题 · 一次完成</div>
      </div>

      <div class="group-setup-grid">
        <div class="setup-main card">
          <div class="filter-block">
            <div class="section-label">
              <h3>专题范围</h3>
              <div class="inline-actions">
                <button type="button" class="text-action" data-action="select-all-group-categories">全选</button>
                <button type="button" class="text-action" data-action="clear-group-categories">清空</button>
                <span>${state.group.categories.size} / ${META.categories.length}</span>
              </div>
            </div>
            <div class="chip-grid">${categoryChips("group", state.group.categories)}</div>
          </div>

          <div class="filter-block">
            <div class="section-label">
              <h3>题型与题量</h3>
              <span>每种最多 ${MAX_GROUP_PER_TYPE} 题</span>
            </div>
            <div class="count-grid">
              ${ALL_TYPES.map((type) => {
                const row = plan.find((item) => item.type === type);
                return `<div class="count-field">
                  <label>${TYPE_LABEL[type]}</label>
                  <div class="count-stepper">
                    <button type="button" data-action="group-count" data-type="${type}" data-delta="-1" aria-label="减少${TYPE_LABEL[type]}">−</button>
                    <output>${state.group.counts[type] || 0}</output>
                    <button type="button" data-action="group-count" data-type="${type}" data-delta="1" aria-label="增加${TYPE_LABEL[type]}">+</button>
                  </div>
                  <div class="tiny muted">可用 ${row.available}</div>
                </div>`;
              }).join("")}
            </div>
            <div class="group-notes">
              <span>题量会按所选专题的可用题量自动调整，不会重复抽题。</span>
              <span>权重影响每种题型内部重题 / 轻题的抽取概率。</span>
            </div>
          </div>
        </div>

        ${weightCard(
          "group",
          state.group.weight,
          `<div class="setup-summary">
            <div class="summary-line"><span>计划题量</span><strong>${requestedTotal} 道</strong></div>
            <div class="summary-line"><span>实际可生成</span><strong>${actualTotal} 道</strong></div>
            <div class="group-composition">
              ${
                composition.length
                  ? composition
                      .map((row) => `<span>${TYPE_SHORT[row.type]} <strong>${row.count}</strong></span>`)
                      .join("")
                  : '<span>暂无可用题目</span>'
              }
            </div>
            <div class="summary-total"><strong>${actualTotal}</strong> 道题组成一组</div>
            <div class="setup-actions">
              <button type="button" class="btn btn-primary btn-lg btn-block" data-action="start-group" ${actualTotal ? "" : "disabled"}>生成题组</button>
              <button type="button" class="btn btn-secondary btn-block" data-action="view-browse">浏览题库</button>
            </div>
          </div>`
        )}
      </div>
    </section>`;
  }

  function startGroup() {
    const plan = groupPlan().filter((row) => row.count > 0);
    if (!plan.length) {
      showToast("当前配置下没有可生成的题目");
      return;
    }

    const items = [];
    plan.forEach((row) => {
      const picked = sampleWeighted(row.pool, row.count, state.group.weight);
      picked.forEach((q) => {
        items.push({
          qid: q.id,
          selected: [],
          draft: "",
          submitted: false,
          result: null,
          selfCorrect: null,
          recorded: false,
        });
      });
    });

    state.group.session = {
      items,
      startedAt: Date.now(),
      submitted: false,
      config: {
        categories: Array.from(state.group.categories),
        weight: state.group.weight,
        counts: Object.assign({}, state.group.counts),
      },
    };
    state.group.stage = "session";
    state.view = "group";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshGroupProgress() {
    const session = state.group.session;
    if (!session || session.submitted) return;
    const bar = document.querySelector(".group-sticky-bar");
    if (!bar) return;
    const answered = session.items.filter((item) => {
      const q = Q_MAP.get(item.qid);
      return AUTO_TYPES.has(q.type) ? item.selected.length > 0 : item.draft.trim().length > 0;
    }).length;
    const label = bar.querySelector(".progress-label strong");
    const fill = bar.querySelector(".progress-fill");
    const hint = bar.querySelector(".tiny.muted");
    if (label) label.textContent = `${answered} / ${session.items.length}`;
    if (fill) fill.style.width = `${(answered / session.items.length) * 100}%`;
    if (hint) hint.textContent = answered === session.items.length ? "全部已作答" : `还有 ${session.items.length - answered} 题未作答`;
  }

  function groupAutoScore() {
    const session = state.group.session;
    if (!session) return { autoTotal: 0, autoCorrect: 0, selfTotal: 0, selfGraded: 0, selfCorrect: 0 };
    let autoTotal = 0;
    let autoCorrect = 0;
    let selfTotal = 0;
    let selfGraded = 0;
    let selfCorrect = 0;

    session.items.forEach((item) => {
      const q = Q_MAP.get(item.qid);
      if (AUTO_TYPES.has(q.type)) {
        autoTotal += 1;
        if (item.result === true) autoCorrect += 1;
      } else {
        selfTotal += 1;
        if (item.selfCorrect !== null) {
          selfGraded += 1;
          if (item.selfCorrect === true) selfCorrect += 1;
        }
      }
    });

    return { autoTotal, autoCorrect, selfTotal, selfGraded, selfCorrect };
  }

  function renderGroupSession() {
    const session = state.group.session;
    if (!session || !session.items.length) {
      state.group.stage = "setup";
      renderGroupSetup();
      return;
    }

    const answered = session.items.filter((item) => {
      const q = Q_MAP.get(item.qid);
      return AUTO_TYPES.has(q.type) ? item.selected.length > 0 : item.draft.trim().length > 0;
    }).length;
    const unanswered = session.items.length - answered;
    const score = groupAutoScore();
    const typeSummary = {};
    session.items.forEach((item) => {
      const q = Q_MAP.get(item.qid);
      typeSummary[q.type] = (typeSummary[q.type] || 0) + 1;
    });

    app.innerHTML = `<section class="view">
      <div class="group-session-head">
        <div>
          <div class="eyebrow">${session.submitted ? "Group Review" : "Group Practice"}</div>
          <h1 class="group-session-title">${session.submitted ? "本组已交卷" : "模拟题组"} <span>${session.items.length} 题</span></h1>
          <div class="meta-row" style="margin-top:8px">
            ${Object.keys(typeSummary)
              .map((type) => `<span class="tag tag-type-${type}">${TYPE_SHORT[type]} ${typeSummary[type]}</span>`)
              .join("")}
          </div>
        </div>
        <div class="meta-row">
          ${
            session.submitted
              ? `<button type="button" class="btn btn-secondary btn-sm" data-action="group-setup">调整配置</button>
                 <button type="button" class="btn btn-primary btn-sm" data-action="group-again">再来一组</button>`
              : `<button type="button" class="btn btn-primary" data-action="submit-group">交卷</button>`
          }
        </div>
      </div>

      ${
        session.submitted
          ? `<div class="group-scoreline card">
              <span>客观题 <strong>${score.autoCorrect} / ${score.autoTotal}</strong></span>
              <span>主观题已自评 <strong>${score.selfGraded} / ${score.selfTotal}</strong></span>
              <span>主观题自评答对 <strong>${score.selfCorrect}</strong></span>
              <span class="muted">${score.selfGraded === score.selfTotal ? "本组已全部完成" : "请在下方完成主观题自评"}</span>
            </div>`
          : ""
      }

      <div class="group-list">
        ${session.items
          .map((item, index) => {
            const q = Q_MAP.get(item.qid);
            return renderGroupCard(q, item, index, session);
          })
          .join("")}
      </div>

      ${
        session.submitted
          ? `<div class="group-sticky-bar">
              <div class="progress-wrap">
                <div class="progress-label"><span>本组状态</span><strong>${score.selfGraded === score.selfTotal ? "已完成" : "待自评"}</strong></div>
                <div class="progress-track"><div class="progress-fill" style="width:${score.selfTotal ? (score.selfGraded / score.selfTotal) * 100 : 100}%"></div></div>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" data-action="view-stats">查看统计</button>
              <button type="button" class="btn btn-primary btn-sm" data-action="group-again">再来一组</button>
            </div>`
          : `<div class="group-sticky-bar">
              <div class="progress-wrap">
                <div class="progress-label"><span>作答进度</span><strong>${answered} / ${session.items.length}</strong></div>
                <div class="progress-track"><div class="progress-fill" style="width:${(answered / session.items.length) * 100}%"></div></div>
              </div>
              <span class="tiny muted" style="white-space:nowrap">${unanswered ? `还有 ${unanswered} 题未作答` : "全部已作答"}</span>
              <button type="button" class="btn btn-primary btn-sm" data-action="submit-group">交卷</button>
            </div>`
      }
    </section>`;
  }

  function renderGroupCard(q, item, index, session) {
    const resultClass = item.submitted && AUTO_TYPES.has(q.type)
      ? item.result
        ? "is-correct"
        : "is-wrong"
      : item.submitted && item.selfCorrect === true
      ? "is-correct"
      : item.submitted && item.selfCorrect === false
      ? "is-wrong"
      : "";

    return `<article class="group-card card ${resultClass}">
      <div class="group-card-head">
        <div class="group-number">${pad2(index + 1)}</div>
        <div class="group-meta">${questionMeta(q, true)}</div>
      </div>
      <div class="group-stem">${formatStem(q.stem, q.type)}</div>
      ${q.type === "multi" ? '<div class="group-multi-hint"><span class="multi-mark">多选</span>请选择所有正确答案，少选、多选均不得分</div>' : ""}
      ${renderQuestionInput(q, item, "group", session.submitted)}
      ${
        session.submitted
          ? AUTO_TYPES.has(q.type)
            ? renderGroupAutoFeedback(q, item)
            : renderGroupSelfFeedback(q, item)
          : ""
      }
    </article>`;
  }

  function renderGroupAutoFeedback(q, item) {
    const correct = Boolean(item.result);
    return `<div class="feedback ${correct ? "correct" : "wrong"}">
      <div class="feedback-head">
        <span class="feedback-icon">${correct ? "✓" : "×"}</span>
        <span class="feedback-title">${correct ? "回答正确" : "回答错误"}</span>
        <span class="tag ${correct ? "tag-status-passed" : "tag-status-wrong"}">已计入统计</span>
      </div>
      ${answerPanel(q, true)}
    </div>`;
  }

  function renderGroupSelfFeedback(q, item) {
    const graded = item.selfCorrect !== null;
    const correct = item.selfCorrect === true;
    return `<div class="feedback ${graded ? (correct ? "correct" : "wrong") : "neutral"}">
      <div class="feedback-head">
        <span class="feedback-icon">${graded ? (correct ? "✓" : "×") : "○"}</span>
        <span class="feedback-title">${graded ? (correct ? "本题自评为答对" : "本题自评为答错") : "参考答案已展示"}</span>
        <span class="tag ${graded ? (correct ? "tag-status-passed" : "tag-status-wrong") : "tag-normal"}">${graded ? "已计入统计" : "待自评"}</span>
      </div>
      ${answerPanel(q, true)}
      <div class="self-grade">
        <span class="self-grade-label">我的判断：</span>
        <button type="button" class="btn btn-secondary btn-sm ${item.selfCorrect === true ? "is-chosen" : ""}" data-action="self-grade" data-scope="group" data-qid="${q.id}" data-correct="1">我答对了</button>
        <button type="button" class="btn btn-secondary btn-sm ${item.selfCorrect === false ? "is-chosen-wrong" : ""}" data-action="self-grade" data-scope="group" data-qid="${q.id}" data-correct="0">我答错了</button>
      </div>
    </div>`;
  }

  function submitGroup() {
    const session = state.group.session;
    if (!session || session.submitted) return;
    const unanswered = session.items.filter((item) => {
      const q = Q_MAP.get(item.qid);
      return AUTO_TYPES.has(q.type) ? !item.selected.length : !item.draft.trim();
    }).length;

    if (unanswered > 0) {
      state.modal = { type: "confirm-group", unanswered };
      renderModal();
      return;
    }
    finalizeGroupSubmission();
  }

  function finalizeGroupSubmission() {
    const session = state.group.session;
    if (!session || session.submitted) return;
    closeModal(false);

    session.items.forEach((item) => {
      const q = Q_MAP.get(item.qid);
      item.submitted = true;
      if (AUTO_TYPES.has(q.type)) {
        const correct = item.selected.length ? gradeChoice(q, item.selected) : false;
        item.result = correct;
        if (!item.recorded) {
          recordAttempt(q.id, correct);
          item.recorded = true;
        }
      }
    });
    session.submitted = true;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSelfGrade(scope, qid, correct) {
    let item = null;
    if (scope === "practice") {
      const session = state.practice.session;
      if (!session) return;
      item = session.items.find((it) => it.qid === qid) || currentPracticeItem();
    } else {
      const session = state.group.session;
      if (!session) return;
      item = session.items.find((it) => it.qid === qid);
    }
    if (!item) return;

    const firstGrade = !item.recorded;
    item.selfCorrect = Boolean(correct);
    if (firstGrade) {
      recordAttempt(qid, Boolean(correct));
      item.recorded = true;
    } else {
      updateLastResult(qid, Boolean(correct));
    }
    render();
    showToast(Boolean(correct) ? "已记录为答对" : "已记录为答错");
  }

  /* ---------------------------------------------------------
     Browse view
     --------------------------------------------------------- */

  function renderBrowseView() {
    app.innerHTML = `<section class="view">
      <div class="view-head">
        <div>
          <div class="eyebrow">Question Library</div>
          <h1 class="page-title">把整本题库摊开来</h1>
          <p class="page-lead">在所有题目中浏览、搜索和筛选。点开任意一题即可查看答案与知识点归属。</p>
        </div>
        <div class="head-note">共 ${META.total} 题 · ${META.important} 道重题</div>
      </div>

      <div class="browse-layout">
        <aside class="filter-sidebar card">
          <div class="filter-sidebar-head">
            <h2>筛选</h2>
            <div class="inline-actions">
              <button type="button" class="mobile-filter-toggle" data-action="toggle-browse-filters" aria-expanded="${state.browse.filtersOpen}" aria-controls="browse-filter-body">
                <span class="toggle-label">${state.browse.filtersOpen ? "收起" : "展开"}</span>
                <span class="toggle-mark" aria-hidden="true">${state.browse.filtersOpen ? "−" : "+"}</span>
              </button>
              <button type="button" class="text-action" data-action="clear-browse-filters">重置</button>
            </div>
          </div>

          <div id="browse-filter-body" class="filter-body ${state.browse.filtersOpen ? "is-open" : ""}">
          <div class="filter-group">
            <h3>专题</h3>
            <div class="chip-grid">${categoryChips("browse", state.browse.categories)}</div>
            <div class="inline-actions" style="margin-top:7px">
              <button type="button" class="text-action" data-action="select-all-browse-categories">全选</button>
              <button type="button" class="text-action" data-action="clear-browse-categories">清空</button>
            </div>
          </div>

          <div class="filter-group">
            <h3>题型</h3>
            <div class="chip-grid">${typeChips("browse", state.browse.types, META.types.reduce((acc, item) => { acc[item.key] = item.count; return acc; }, {}))}</div>
            <div class="inline-actions" style="margin-top:7px">
              <button type="button" class="text-action" data-action="select-all-browse-types">全选</button>
              <button type="button" class="text-action" data-action="clear-browse-types">清空</button>
            </div>
          </div>

          <div class="filter-group">
            <h3>重要程度</h3>
            <div class="chip-grid">
              ${[
                ["all", "全部"],
                ["important", "重题"],
                ["normal", "轻题"],
              ]
                .map(
                  ([value, label]) =>
                    `<button type="button" class="check-chip ${state.browse.importance === value ? "is-on" : ""}" data-action="browse-importance" data-value="${value}" aria-pressed="${state.browse.importance === value}"><span class="chip-check">${state.browse.importance === value ? "✓" : ""}</span><span>${label}</span></button>`
                )
                .join("")}
            </div>
          </div>

          <div class="filter-group">
            <h3>练习状态</h3>
            <div class="chip-grid">
              ${[
                ["all", "全部"],
                ["new", "未练习"],
                ["passed", "已通过"],
                ["wrong", "曾答错"],
              ]
                .map(
                  ([value, label]) =>
                    `<button type="button" class="check-chip ${state.browse.status === value ? "is-on" : ""}" data-action="browse-status" data-value="${value}" aria-pressed="${state.browse.status === value}"><span class="chip-check">${state.browse.status === value ? "✓" : ""}</span><span>${label}</span></button>`
                )
                .join("")}
            </div>
          </div>
          </div>
        </aside>

        <section class="browse-main">
          <div class="browse-toolbar">
            <div class="search-box">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 4.2 4.2"/></svg>
              <input type="search" id="browse-search" data-field="browse-search" value="${escAttr(state.browse.query)}" placeholder="搜索题干、选项、答案或专题…" autocomplete="off" aria-label="搜索题库">
              <button type="button" class="search-clear" data-action="clear-search" aria-label="清除搜索" style="display:${state.browse.query ? "" : "none"}">×</button>
            </div>
            <div class="head-note" style="padding:7px 12px">${state.browse.categories.size} 个专题 · ${state.browse.types.size} 种题型</div>
          </div>
          <div id="browse-results">${buildBrowseResults()}</div>
        </section>
      </div>
    </section>`;
  }

  function getBrowseFiltered() {
    const query = state.browse.query.trim().toLowerCase();
    return QUESTIONS.filter((q) => {
      if (!state.browse.categories.has(q.category)) return false;
      if (!state.browse.types.has(q.type)) return false;
      if (state.browse.importance === "important" && !q.important) return false;
      if (state.browse.importance === "normal" && q.important) return false;
      if (state.browse.status !== "all" && statusOf(q.id) !== state.browse.status) return false;
      if (query) {
        const haystack = [
          q.stem,
          q.category,
          q.categoryShort,
          TYPE_LABEL[q.type],
          q.answer,
          q.options.map((opt) => `${opt.key} ${opt.text}`).join(" "),
          (q.answers || []).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function activeFilterChips() {
    const chips = [];
    if (state.browse.query.trim()) {
      chips.push({ kind: "query", label: `搜索：${state.browse.query.trim()}`, value: "" });
    }
    if (state.browse.importance !== "all") {
      chips.push({
        kind: "importance",
        label: state.browse.importance === "important" ? "只看重题" : "只看轻题",
        value: state.browse.importance,
      });
    }
    if (state.browse.status !== "all") {
      const labels = { new: "未练习", passed: "已通过", wrong: "曾答错" };
      chips.push({ kind: "status", label: `状态：${labels[state.browse.status]}`, value: state.browse.status });
    }
    return chips;
  }

  function buildBrowseResults() {
    const filtered = getBrowseFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.browse.page = clamp(state.browse.page, 1, totalPages);
    const start = (state.browse.page - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);
    const chips = activeFilterChips();

    const cards = pageItems
      .map(
        (q) => `<button type="button" class="browse-card" data-action="open-question" data-qid="${q.id}">
          <span class="browse-card-top">
            ${typeTag(q.type)}
            ${importanceTag(q.important)}
            ${categoryTag(q)}
            ${statusTag(statusOf(q.id))}
            <span class="browse-card-id">${esc(sourceLabel(q))}</span>
          </span>
          <span class="browse-card-stem">${formatStem(q.stem, q.type)}</span>
          <span class="browse-card-foot">
            <span>${q.options.length ? "含选项" : "文字作答"} · ${q.hasAnswer ? "有参考答案" : "暂无答案"}</span>
            <span class="arrow">→</span>
          </span>
        </button>`
      )
      .join("");

    return `<div class="browse-result-meta">
        <span>找到 <strong>${filtered.length}</strong> 道题 · 第 ${filtered.length ? state.browse.page : 0} / ${filtered.length ? totalPages : 0} 页</span>
        <span>搜索与筛选会即时生效</span>
      </div>
      ${chips.length ? `<div class="active-filter-row">${chips.map((chip) => `<span class="active-filter">${esc(chip.label)}<button type="button" data-action="remove-browse-filter" data-kind="${chip.kind}" aria-label="移除筛选">×</button></span>`).join("")}</div>` : ""}
      ${
        filtered.length
          ? `<div class="browse-list">${cards}</div>${renderPagination(state.browse.page, totalPages)}`
          : `<div class="empty-state"><div class="empty-mark">寻</div><h3>没有找到匹配的题目</h3><p>试试减少筛选条件，或换一个关键词。</p><button type="button" class="btn btn-secondary" data-action="clear-browse-filters">清除全部筛选</button></div>`
      }`;
  }

  function updateBrowseResults() {
    const container = document.getElementById("browse-results");
    if (!container) {
      renderBrowseView();
      return;
    }
    container.innerHTML = buildBrowseResults();
  }

  function renderPagination(current, totalPages) {
    if (totalPages <= 1) return "";
    const pages = [];
    for (let i = 1; i <= totalPages; i += 1) {
      if (i === 1 || i === totalPages || Math.abs(i - current) <= 1) pages.push(i);
      else if (pages[pages.length - 1] !== "…") pages.push("…");
    }
    return `<nav class="pagination" aria-label="题库分页">
      <button type="button" class="page-btn" data-action="browse-page" data-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>上一页</button>
      ${pages
        .map((page) =>
          page === "…"
            ? '<span class="page-ellipsis">…</span>'
            : `<button type="button" class="page-btn ${page === current ? "is-current" : ""}" data-action="browse-page" data-page="${page}" ${page === current ? 'aria-current="page"' : ""}>${page}</button>`
        )
        .join("")}
      <button type="button" class="page-btn" data-action="browse-page" data-page="${current + 1}" ${current >= totalPages ? "disabled" : ""}>下一页</button>
    </nav>`;
  }

  function openQuestionModal(qid) {
    if (!Q_MAP.has(qid)) return;
    state.modal = { type: "question", qid, showAnswer: false };
    renderModal();
  }

  function detailAnswer(q) {
    if (q.type === "single" || q.type === "multi") {
      const letters = correctLetters(q);
      return q.options
        .filter((opt) => letters.includes(opt.key))
        .map((opt) => `${opt.key}. ${opt.text}`)
        .join("；");
    }
    if (q.type === "judge") return q.answer === "√" ? "√ 正确" : "× 错误";
    if (q.type === "fill") return (q.answers || []).join("；");
    return q.answer;
  }

  /* ---------------------------------------------------------
     Stats view
     --------------------------------------------------------- */

  function computeGlobalStats() {
    let passed = 0;
    let wrong = 0;
    let newCount = 0;
    let attempts = 0;
    let correctAttempts = 0;

    const byType = {};
    const byCategory = {};
    ALL_TYPES.forEach((type) => {
      byType[type] = { total: 0, passed: 0, wrong: 0, new: 0 };
    });
    META.categories.forEach((cat) => {
      byCategory[cat.name] = { total: 0, passed: 0, wrong: 0, new: 0 };
    });

    QUESTIONS.forEach((q) => {
      const stat = store.stats[q.id];
      const status = stat ? (stat.lastCorrect ? "passed" : "wrong") : "new";
      if (status === "passed") passed += 1;
      else if (status === "wrong") wrong += 1;
      else newCount += 1;

      if (stat) {
        attempts += stat.attempts;
        correctAttempts += stat.correct;
      }

      if (byType[q.type]) {
        byType[q.type].total += 1;
        byType[q.type][status] += 1;
      }
      if (byCategory[q.category]) {
        byCategory[q.category].total += 1;
        byCategory[q.category][status] += 1;
      }
    });

    return {
      total: QUESTIONS.length,
      passed,
      wrong,
      new: newCount,
      practiced: passed + wrong,
      attempts,
      correctAttempts,
      accuracy: attempts ? Math.round((correctAttempts / attempts) * 100) : 0,
      passRate: QUESTIONS.length ? Math.round((passed / QUESTIONS.length) * 100) : 0,
      byType,
      byCategory,
    };
  }

  function renderStatsView() {
    const stats = computeGlobalStats();
    const recent = store.history
      .filter((item) => Q_MAP.has(item.qid))
      .slice(0, 12);

    app.innerHTML = `<section class="view">
      <div class="view-head">
        <div>
          <div class="eyebrow">Learning Dashboard</div>
          <h1 class="page-title">知道自己走到了哪里</h1>
          <p class="page-lead">按「最后一次作答结果」统计：通过、错误与未练习互不重叠，三者之和等于题库总题数。</p>
        </div>
        <div class="head-note">已练 ${stats.practiced} / ${stats.total} 题</div>
      </div>

      <div class="stats-top">
        <div class="stat-grid">
          <div class="stat-card featured">
            <div class="stat-card-label">通过题目</div>
            <div class="stat-card-value">${stats.passed}<small>&nbsp;/ ${stats.total} 题</small></div>
            <div class="stat-card-note">最后一次作答为正确的题目</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">错误题目</div>
            <div class="stat-card-value" style="color:var(--danger)">${stats.wrong}</div>
            <div class="stat-card-note">最后一次作答为错误的题目</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">未练习</div>
            <div class="stat-card-value">${stats.new}</div>
            <div class="stat-card-note">还没有判分记录的题目</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">累计练习次数</div>
            <div class="stat-card-value">${stats.attempts}</div>
            <div class="stat-card-note">同一题重复练习也会累计</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">总正确率</div>
            <div class="stat-card-value">${stats.accuracy}<small>%</small></div>
            <div class="stat-card-note">${stats.correctAttempts} 次正确 / ${stats.attempts} 次作答</div>
          </div>
        </div>

        <div class="donut-card card">
          <div class="stat-card-label" style="align-self:flex-start">全局掌握情况</div>
          <div class="donut" style="--passed:${stats.total ? (stats.passed / stats.total) * 100 : 0}%;--wrong:${stats.total ? (stats.wrong / stats.total) * 100 : 0}%">
            <div class="donut-center"><strong>${stats.practiced}</strong><span>已练题目</span></div>
          </div>
          <div class="legend">
            <div class="legend-item"><span class="legend-dot passed"></span>通过 <strong>${stats.passed}</strong></div>
            <div class="legend-item"><span class="legend-dot wrong"></span>错误 <strong>${stats.wrong}</strong></div>
            <div class="legend-item"><span class="legend-dot new"></span>未练习 <strong>${stats.new}</strong></div>
          </div>
          <div class="small muted" style="margin-top:14px">题库通过率 ${stats.passRate}%</div>
        </div>
      </div>

      <div class="stats-section">
        <div class="stats-section-head">
          <div>
            <h2>按题型拆解</h2>
            <p>每一条都按通过、错误、未练习三种状态拆分。</p>
          </div>
          ${
            stats.wrong
              ? '<button type="button" class="btn btn-secondary btn-sm" data-action="practice-wrong">只练错题</button>'
              : ""
          }
        </div>
        <div class="card panel">
          <div class="breakdown-list">
            ${ALL_TYPES.map((type) => {
              const row = stats.byType[type];
              const passedPct = row.total ? (row.passed / row.total) * 100 : 0;
              const wrongPct = row.total ? (row.wrong / row.total) * 100 : 0;
              return `<div class="breakdown-row">
                <div class="breakdown-label">${TYPE_LABEL[type]}</div>
                <div class="breakdown-bar" title="通过 ${row.passed} / 错误 ${row.wrong} / 未练 ${row.new}">
                  <span class="passed" style="width:${passedPct}%"></span>
                  <span class="wrong" style="width:${wrongPct}%"></span>
                  <span class="new" style="width:${100 - passedPct - wrongPct}%"></span>
                </div>
                <div class="breakdown-numbers"><strong>${row.total}</strong> 题 · 过 ${row.passed} · 错 ${row.wrong}</div>
              </div>`;
            }).join("")}
          </div>
        </div>
      </div>

      <div class="stats-section">
        <div class="stats-section-head">
          <div>
            <h2>按专题拆解</h2>
            <p>找出最薄弱的专题，回到题库定向补强。</p>
          </div>
        </div>
        <div class="category-table-wrap">
          <table class="category-table">
            <thead><tr><th>专题</th><th>总题数</th><th>通过</th><th>错误</th><th>未练习</th><th>通过率</th></tr></thead>
            <tbody>
              ${META.categories
                .map((cat) => {
                  const row = stats.byCategory[cat.name];
                  return `<tr>
                    <td title="${escAttr(cat.name)}">${esc(cat.short)}<span>第 ${cat.part} 部分</span></td>
                    <td>${row.total}</td>
                    <td class="passed-cell">${row.passed}</td>
                    <td class="wrong-cell">${row.wrong}</td>
                    <td>${row.new}</td>
                    <td>${row.total ? Math.round((row.passed / row.total) * 100) : 0}%</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="stats-section">
        <div class="stats-section-head">
          <div>
            <h2>最近作答</h2>
            <p>最近 ${recent.length} 条练习记录。</p>
          </div>
        </div>
        ${
          recent.length
            ? `<div class="recent-list">${recent
                .map((item) => {
                  const q = Q_MAP.get(item.qid);
                  return `<div class="recent-item">
                    <span class="recent-mark ${item.correct ? "" : "wrong"}">${item.correct ? "✓" : "×"}</span>
                    <div class="recent-body">
                      <div class="recent-stem">${esc(q.stem.slice(0, 100))}</div>
                      <div class="recent-meta">${TYPE_LABEL[q.type]} · ${esc(q.categoryShort)} · ${formatDate(item.at)}</div>
                    </div>
                  </div>`;
                })
                .join("")}</div>`
            : `<div class="empty-state"><div class="empty-mark">记</div><h3>还没有作答记录</h3><p>从单题练习开始，你的通过、错误与未练习分布会自动汇总到这里。</p><button type="button" class="btn btn-primary" data-action="go-practice">开始第一题</button></div>`
        }
      </div>

      <div class="stats-footer">
        <p>数据保存在当前浏览器的 localStorage 中。清除浏览器数据会同时清除学习记录。</p>
        <button type="button" class="btn btn-danger btn-sm" data-action="confirm-reset">清空学习记录</button>
      </div>
    </section>`;
  }

  /* ---------------------------------------------------------
     Modals
     --------------------------------------------------------- */

  function renderModal() {
    if (!state.modal) {
      modalRoot.innerHTML = "";
      document.body.classList.remove("modal-open");
      if (lastFocused && document.contains(lastFocused)) {
        lastFocused.focus({ preventScroll: true });
      }
      lastFocused = null;
      return;
    }

    if (document.body.classList.contains("modal-open") === false) {
      lastFocused = document.activeElement;
    }
    document.body.classList.add("modal-open");
    let content = "";

    if (state.modal.type === "question") {
      const q = Q_MAP.get(state.modal.qid);
      if (!q) {
        state.modal = null;
        renderModal();
        return;
      }
      const showAnswer = state.modal.showAnswer;
      const letters = correctLetters(q);
      content = `<div class="modal-backdrop" data-modal-backdrop="1">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head">
            <div>
              <h2 id="modal-title">${TYPE_LABEL[q.type]} · ${esc(q.categoryShort)}</h2>
              <p>${esc(sourceLabel(q))} · ${q.important ? "重题" : "轻题"} · 当前状态：${statusOf(q.id) === "passed" ? "已通过" : statusOf(q.id) === "wrong" ? "曾答错" : "未练习"}</p>
            </div>
            <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div class="meta-row" style="margin-bottom:13px">${questionMeta(q, false)}</div>
            ${q.type === "multi" ? '<div class="detail-multi-hint"><span class="multi-mark">多选</span>本题有多个正确答案，请全部选出。</div>' : ""}
            <div class="detail-stem">${formatStem(q.stem, q.type)}</div>
            ${
              q.options.length
                ? `<div class="detail-options">${q.options
                    .map((opt) => {
                      const correct = showAnswer && letters.includes(opt.key);
                      return `<div class="detail-option ${correct ? "is-correct" : ""}"><b>${opt.key}</b><span>${esc(opt.text)}</span></div>`;
                    })
                    .join("")}</div>`
                : ""
            }
            ${
              showAnswer
                ? `<div class="detail-answer"><div class="detail-answer-label">参考答案</div><div class="detail-answer-body">${q.type === "short" ? nl2br(detailAnswer(q)) : esc(detailAnswer(q))}</div></div>`
                : `<div class="detail-answer"><div class="detail-answer-label">答案已隐藏</div><div class="detail-answer-body muted">点击下方「显示答案」查看参考答案。</div></div>`
            }
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary btn-sm" data-action="toggle-detail-answer">${showAnswer ? "隐藏答案" : "显示答案"}</button>
            <button type="button" class="btn btn-primary btn-sm" data-action="practice-this" data-qid="${q.id}">练习这题</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="close-modal">关闭</button>
          </div>
        </div>
      </div>`;
    } else if (state.modal.type === "confirm-group") {
      content = `<div class="modal-backdrop" data-modal-backdrop="1">
        <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head">
            <div><h2 id="modal-title">确认交卷？</h2><p>未作答的题目将按空白提交处理。</p></div>
            <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div class="modal-form">
              <p>还有 <strong>${state.modal.unanswered}</strong> 道题未作答。未作答的选择题和判断题会按错误计入统计；填空、简答题交卷后仍可自评。</p>
              <div class="meta-row"><span class="tag tag-normal">交卷后可逐题查看答案</span><span class="tag tag-normal">主观题需自行判分</span></div>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost btn-sm" data-action="close-modal">继续作答</button>
            <button type="button" class="btn btn-primary btn-sm" data-action="confirm-group-submit">仍然交卷</button>
          </div>
        </div>
      </div>`;
    } else if (state.modal.type === "confirm-reset") {
      content = `<div class="modal-backdrop" data-modal-backdrop="1">
        <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div class="modal-head">
            <div><h2 id="modal-title">清空学习记录？</h2><p>此操作不可撤销。</p></div>
            <button type="button" class="modal-close" data-action="close-modal" aria-label="关闭">×</button>
          </div>
          <div class="modal-body">
            <div class="modal-form">
              <p>将删除所有题目的通过 / 错误状态、累计练习次数与最近作答记录。题库本身和筛选设置不会受到影响。</p>
              <p class="small">如果只是想重新做错题，可以先去统计页使用「只练错题」。</p>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-ghost btn-sm" data-action="close-modal">取消</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="reset-stats">确认清空</button>
          </div>
        </div>
      </div>`;
    }

    modalRoot.innerHTML = content;
    window.requestAnimationFrame(() => {
      const closeBtn = modalRoot.querySelector(".modal-close");
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    });
  }

  function closeModal(restoreFocus) {
    state.modal = null;
    renderModal();
    if (restoreFocus !== false && lastFocused && document.contains(lastFocused)) {
      lastFocused.focus({ preventScroll: true });
    }
  }

  /* ---------------------------------------------------------
     Actions
     --------------------------------------------------------- */

  function toggleInSet(set, value) {
    if (set.has(value)) set.delete(value);
    else set.add(value);
  }

  function setWeight(scope, weight) {
    if (scope === "practice") {
      state.practice.weight = clamp(weight, 0, 100);
      persistPracticePrefs();
    } else {
      state.group.weight = clamp(weight, 0, 100);
      persistGroupPrefs();
    }
  }

  function updateWeightUI(scope, weight) {
    const field = document.querySelector(`[data-field="${scope}-weight"]`);
    if (!field) return;
    field.value = String(weight);
    field.style.setProperty("--range-fill", `${weight}%`);
    const card = field.closest(".weight-card");
    if (!card) return;
    const heavy = card.querySelector(".heavy-num");
    const light = card.querySelector(".light-num");
    const caption = card.querySelector(".weight-caption");
    if (heavy) heavy.textContent = String(weight / 10);
    if (light) light.textContent = String((100 - weight) / 10);
    if (caption) caption.textContent = `重题 ${weight}% · 轻题 ${100 - weight}%`;
  }

  function practiceWrongQuestions() {
    const wrongPool = QUESTIONS.filter((q) => statusOf(q.id) === "wrong");
    if (!wrongPool.length) {
      showToast("目前没有错题");
      return;
    }
    state.view = "practice";
    state.practice.stage = "setup";
    state.practice.categories = new Set(ALL_CATEGORIES);
    state.practice.types = new Set(ALL_TYPES);
    startPractice(wrongPool);
  }

  function startSingleQuestion(qid) {
    const q = Q_MAP.get(qid);
    if (!q) return;
    closeModal(false);
    state.practice.session = {
      items: [
        {
          qid: q.id,
          selected: [],
          draft: "",
          submitted: false,
          result: null,
          selfCorrect: null,
          recorded: false,
        },
      ],
      index: 0,
      startedAt: Date.now(),
      config: { categories: [q.category], types: [q.type], weight: state.practice.weight, count: 1 },
    };
    state.practice.stage = "session";
    state.view = "practice";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleAction(action, el) {
    if (!action) return;

    if (action === "go-practice") {
      switchView("practice");
      return;
    }
    if (action === "view-browse") {
      switchView("browse");
      return;
    }
    if (action === "view-stats") {
      switchView("stats");
      return;
    }
    if (action === "close-modal") {
      closeModal();
      return;
    }

    /* Practice setup */
    if (action === "toggle-practice-category") {
      toggleInSet(state.practice.categories, el.dataset.value);
      persistPracticePrefs();
      render();
      return;
    }
    if (action === "select-all-practice-categories") {
      state.practice.categories = new Set(ALL_CATEGORIES);
      persistPracticePrefs();
      render();
      return;
    }
    if (action === "clear-practice-categories") {
      state.practice.categories.clear();
      persistPracticePrefs();
      render();
      return;
    }
    if (action === "toggle-practice-type") {
      toggleInSet(state.practice.types, el.dataset.value);
      persistPracticePrefs();
      render();
      return;
    }
    if (action === "select-all-practice-types") {
      state.practice.types = new Set(ALL_TYPES);
      persistPracticePrefs();
      render();
      return;
    }
    if (action === "practice-weight-preset") {
      const weight = Number(el.dataset.weight);
      setWeight("practice", weight);
      updateWeightUI("practice", weight);
      return;
    }
    if (action === "start-practice") {
      startPractice();
      return;
    }
    if (action === "practice-again") {
      state.practice.stage = "setup";
      render();
      startPractice();
      return;
    }
    if (action === "practice-setup") {
      state.practice.stage = "setup";
      render();
      return;
    }

    /* Practice session */
    if (action === "select-option") {
      const scope = el.dataset.scope || "practice";
      const key = el.dataset.key;
      const item = scope === "practice" ? currentPracticeItem() : null;
      if (scope === "practice" && item) {
        if (item.submitted) return;
        const q = Q_MAP.get(item.qid);
        if (q.type === "multi") {
          if (item.selected.includes(key)) item.selected = item.selected.filter((k) => k !== key);
          else item.selected.push(key);
        } else {
          item.selected = [key];
        }
        render();
      } else if (scope === "group") {
        const session = state.group.session;
        if (!session || session.submitted) return;
        const targetQid = el.dataset.qid;
        const target = session.items.find((it) => it.qid === targetQid);
        if (!target) return;
        const targetQ = Q_MAP.get(target.qid);
        if (targetQ.type === "multi") {
          if (target.selected.includes(key)) target.selected = target.selected.filter((k) => k !== key);
          else target.selected.push(key);
        } else {
          target.selected = [key];
        }
        render();
      }
      return;
    }
    if (action === "submit-practice") {
      submitPractice();
      return;
    }
    if (action === "self-grade") {
      handleSelfGrade(el.dataset.scope || "practice", el.dataset.qid, el.dataset.correct === "1");
      return;
    }
    if (action === "next-practice") {
      nextPractice();
      return;
    }
    if (action === "end-practice") {
      endPractice();
      return;
    }

    /* Group setup */
    if (action === "toggle-group-category") {
      toggleInSet(state.group.categories, el.dataset.value);
      persistGroupPrefs();
      render();
      return;
    }
    if (action === "select-all-group-categories") {
      state.group.categories = new Set(ALL_CATEGORIES);
      persistGroupPrefs();
      render();
      return;
    }
    if (action === "clear-group-categories") {
      state.group.categories.clear();
      persistGroupPrefs();
      render();
      return;
    }
    if (action === "group-weight-preset") {
      const weight = Number(el.dataset.weight);
      setWeight("group", weight);
      updateWeightUI("group", weight);
      return;
    }
    if (action === "group-count") {
      const type = el.dataset.type;
      const delta = Number(el.dataset.delta);
      state.group.counts[type] = clamp((state.group.counts[type] || 0) + delta, 0, MAX_GROUP_PER_TYPE);
      persistGroupPrefs();
      render();
      return;
    }
    if (action === "start-group") {
      startGroup();
      return;
    }
    if (action === "submit-group") {
      submitGroup();
      return;
    }
    if (action === "confirm-group-submit") {
      finalizeGroupSubmission();
      return;
    }
    if (action === "group-again") {
      state.group.stage = "setup";
      render();
      startGroup();
      return;
    }
    if (action === "group-setup") {
      state.group.stage = "setup";
      render();
      return;
    }

    /* Browse */
    if (action === "toggle-browse-category") {
      toggleInSet(state.browse.categories, el.dataset.value);
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "select-all-browse-categories") {
      state.browse.categories = new Set(ALL_CATEGORIES);
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "clear-browse-categories") {
      state.browse.categories.clear();
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "toggle-browse-type") {
      toggleInSet(state.browse.types, el.dataset.value);
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "select-all-browse-types") {
      state.browse.types = new Set(ALL_TYPES);
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "clear-browse-types") {
      state.browse.types.clear();
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "browse-importance") {
      state.browse.importance = el.dataset.value;
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "browse-status") {
      state.browse.status = el.dataset.value;
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "toggle-browse-filters") {
      state.browse.filtersOpen = !state.browse.filtersOpen;
      const body = document.getElementById("browse-filter-body");
      if (body) body.classList.toggle("is-open", state.browse.filtersOpen);
      el.setAttribute("aria-expanded", String(state.browse.filtersOpen));
      const label = el.querySelector(".toggle-label");
      const mark = el.querySelector(".toggle-mark");
      if (label) label.textContent = state.browse.filtersOpen ? "收起" : "展开";
      if (mark) mark.textContent = state.browse.filtersOpen ? "−" : "+";
      return;
    }
    if (action === "clear-browse-filters") {
      state.browse.query = "";
      state.browse.categories = new Set(ALL_CATEGORIES);
      state.browse.types = new Set(ALL_TYPES);
      state.browse.importance = "all";
      state.browse.status = "all";
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "remove-browse-filter") {
      const kind = el.dataset.kind;
      if (kind === "query") state.browse.query = "";
      else if (kind === "importance") state.browse.importance = "all";
      else if (kind === "status") state.browse.status = "all";
      state.browse.page = 1;
      render();
      return;
    }
    if (action === "clear-search") {
      state.browse.query = "";
      state.browse.page = 1;
      renderBrowseView();
      const input = document.getElementById("browse-search");
      if (input) input.focus();
      return;
    }
    if (action === "browse-page") {
      state.browse.page = Number(el.dataset.page) || 1;
      updateBrowseResults();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (action === "open-question") {
      openQuestionModal(el.dataset.qid);
      return;
    }
    if (action === "toggle-detail-answer") {
      if (state.modal && state.modal.type === "question") {
        state.modal.showAnswer = !state.modal.showAnswer;
        renderModal();
      }
      return;
    }
    if (action === "practice-this") {
      startSingleQuestion(el.dataset.qid);
      return;
    }

    /* Stats */
    if (action === "confirm-reset") {
      state.modal = { type: "confirm-reset" };
      renderModal();
      return;
    }
    if (action === "reset-stats") {
      resetLearningData();
      return;
    }
    if (action === "practice-wrong") {
      practiceWrongQuestions();
      return;
    }
  }

  /* ---------------------------------------------------------
     Event wiring
     --------------------------------------------------------- */

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      event.preventDefault();
      switchView(nav.getAttribute("data-view"));
      return;
    }

    const actionEl = event.target.closest("[data-action]");
    if (actionEl) {
      event.preventDefault();
      handleAction(actionEl.getAttribute("data-action"), actionEl);
      return;
    }

    if (event.target.matches("[data-modal-backdrop]")) {
      closeModal();
    }
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches('[data-field="practice-weight"]')) {
      const weight = Number(target.value);
      state.practice.weight = weight;
      updateWeightUI("practice", weight);
      persistPracticePrefs();
      return;
    }
    if (target.matches('[data-field="group-weight"]')) {
      const weight = Number(target.value);
      state.group.weight = weight;
      updateWeightUI("group", weight);
      persistGroupPrefs();
      return;
    }
    if (target.matches('[data-field="practice-count"]')) {
      state.practice.count = Number(target.value);
      persistPracticePrefs();
      render();
      return;
    }
    if (target.matches('[data-field="browse-search"]')) {
      state.browse.query = target.value;
      state.browse.page = 1;
      updateBrowseResults();
      const clearBtn = document.querySelector(".search-clear");
      if (clearBtn) {
        clearBtn.style.display = target.value ? "" : "none";
      }
      return;
    }
    if (target.matches("[data-practice-draft]")) {
      const item = currentPracticeItem();
      if (item) item.draft = target.value;
      return;
    }
    if (target.matches("[data-group-draft]")) {
      const session = state.group.session;
      if (!session) return;
      const qid = target.getAttribute("data-group-draft");
      const item = session.items.find((it) => it.qid === qid);
      if (item) {
        item.draft = target.value;
        refreshGroupProgress();
      }
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches('[data-field="practice-count"]')) {
      state.practice.count = Number(target.value);
      persistPracticePrefs();
      render();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.modal) {
      closeModal();
      return;
    }

    if (state.view !== "practice" || state.practice.stage !== "session") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(activeTag)) return;

    const session = state.practice.session;
    if (!session) return;
    const item = currentPracticeItem();
    if (!item) return;
    const q = Q_MAP.get(item.qid);
    if (!q) return;

    if (AUTO_TYPES.has(q.type)) {
      const key = event.key.toUpperCase();
      if (/^[A-E]$/.test(key) && !item.submitted) {
        const opt = q.options.find((option) => option.key === key);
        if (!opt) return;
        event.preventDefault();
        if (q.type === "multi") {
          if (item.selected.includes(key)) item.selected = item.selected.filter((k) => k !== key);
          else item.selected.push(key);
        } else {
          item.selected = [key];
        }
        render();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (item.submitted) nextPractice();
        else submitPractice();
        return;
      }
      if (event.key === "ArrowRight" && item.submitted) {
        event.preventDefault();
        nextPractice();
      }
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submitPractice();
    }
  });

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */

  function init() {
    loadStore();
    state.practice.categories = new Set(store.prefs.practice.categories);
    state.practice.types = new Set(store.prefs.practice.types);
    state.practice.weight = store.prefs.practice.weight;
    state.practice.count = store.prefs.practice.count;
    state.group.categories = new Set(store.prefs.group.categories);
    state.group.weight = store.prefs.group.weight;
    state.group.counts = Object.assign(
      { single: 3, multi: 1, judge: 1, fill: 1, short: 1 },
      store.prefs.group.counts
    );

    const hashView = (window.location.hash || "").replace("#", "");
    if (["practice", "group", "browse", "stats"].includes(hashView)) {
      state.view = hashView;
    }

    render();
  }

  init();
})();

