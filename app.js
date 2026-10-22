/**
 * PyDrill 题库后台 (Admin) 纯静态版应用脚本
 * 免服务端 · 本地草稿 · 实时审查 · 原地编辑 · 导入导出
 */

// 常量配置
const STORAGE_KEY_QUESTIONS = "pydrill_admin_questions_draft";
const STORAGE_KEY_META = "pydrill_admin_meta";

// 全局应用状态
const state = {
  questions: [],
  tags: [],
  tagStats: null,
  isDraftLoaded: false,
  draftTime: null,

  // 筛选与检索
  filterStatus: "all", // all | needs_review | draft | verified
  selectedTags: new Set(), // 组合标签多选 (交集)
  filterSource: "all", // 来源筛选
  filterAddedAt: "all", // 入库日期筛选
  filterTopic: "all", // Topic 筛选
  filterType: "all", // 题型筛选
  filterDifficulty: "all", // 难度筛选
  filterIdStart: "", // 题号范围起
  filterIdEnd: "", // 题号范围止
  filterNote: "all", // 备注/标记: all | has_note | marked
  sortBy: "id_asc", // 排序: id_asc | id_desc | added_desc | added_asc
  searchKeyword: "",

  // 批量操作勾选
  selectedQuestionIds: new Set(),

  // 编辑模态框状态
  editingQuestion: null,
  editSelectedTags: new Set(),

  // 待导入数据暂存
  pendingImportData: null,
};

// 标记题关键词（含任一即算标记题）
const MARKED_NOTE_KEYWORDS = ["重复", "格式", "多选", "多答案"];

// 解析题号中的纯数字，如 "q100" -> 100, "100" -> 100, 空值 -> null
function parseIdNumber(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str) return null;
  const m = str.match(/^q?(\d+)$/i);
  if (m) {
    return parseInt(m[1], 10);
  }
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
}

// 检查是否为标记题（editNote 含「重复」「格式」「多选」「多答案」任一）
function isMarkedQuestion(q) {
  if (!q || !q.editNote) return false;
  return MARKED_NOTE_KEYWORDS.some((kw) => q.editNote.includes(kw));
}

// 检查是否 editNote 非空
function hasNote(q) {
  return Boolean(q && q.editNote && q.editNote.trim().length > 0);
}

// 题目比较器（支持 题号升序/降序、入库日期新旧，日期相同按题号；「未知」排最后）
function compareQuestions(a, b, sortBy) {
  const numA = parseIdNumber(a.id) ?? 0;
  const numB = parseIdNumber(b.id) ?? 0;

  if (sortBy === "id_desc") {
    return numB - numA;
  }
  if (sortBy === "id_asc") {
    return numA - numB;
  }

  if (sortBy === "added_desc" || sortBy === "added_asc") {
    const isUnknownA = !a.addedAt || a.addedAt === "未知";
    const isUnknownB = !b.addedAt || b.addedAt === "未知";

    // 「未知」排最后
    if (isUnknownA && !isUnknownB) return 1;
    if (!isUnknownA && isUnknownB) return -1;
    if (isUnknownA && isUnknownB) {
      return numA - numB; // 均为未知，按题号升序
    }

    // 均有有效日期
    const dateCmp = sortBy === "added_desc"
      ? b.addedAt.localeCompare(a.addedAt)
      : a.addedAt.localeCompare(b.addedAt);

    if (dateCmp !== 0) {
      return dateCmp;
    }
    // 日期相同按题号升序
    return numA - numB;
  }

  return numA - numB;
}

// UI 提示 Toast
function showToast(message, type = "info") {
  if (typeof document === "undefined") return;
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// 辅助 HTML 转义
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 时间格式化
function formatTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch (e) {
    return isoStr;
  }
}

// 本地草稿状态更新与指示器
function updateDraftIndicator() {
  const indicator = document.getElementById("draftIndicator");
  if (!indicator) return;
  if (state.isDraftLoaded) {
    indicator.className = "draft-indicator active";
    indicator.innerHTML = `📝 本地草稿 (${formatTime(state.draftTime)})`;
    indicator.title = "当前正在使用保存在浏览器本地的修改草稿";
  } else {
    indicator.className = "draft-indicator clean";
    indicator.innerHTML = "📄 官方快照副本";
    indicator.title = "当前使用 ./data/questions.json 原始题库，无未保存草稿";
  }
}

// 保存工作副本至 localStorage
function saveDraftToStorage() {
  if (typeof localStorage === "undefined") return;
  try {
    const meta = { updatedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY_QUESTIONS, JSON.stringify(state.questions));
    localStorage.setItem(STORAGE_KEY_META, JSON.stringify(meta));
    state.isDraftLoaded = true;
    state.draftTime = meta.updatedAt;
    updateDraftIndicator();
  } catch (err) {
    console.error("localStorage 写入失败:", err);
    showToast("浏览器本地存储已满或受限，草稿保存失败", "error");
  }
}

// 从 localStorage 读取草稿
function loadDraftFromStorage() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_QUESTIONS);
    const metaRaw = localStorage.getItem(STORAGE_KEY_META);
    if (!raw) return null;
    const list = JSON.parse(raw);
    const meta = metaRaw ? JSON.parse(metaRaw) : null;
    if (Array.isArray(list) && list.length > 0) {
      return { list, meta };
    }
  } catch (err) {
    console.warn("读取本地草稿解析失败:", err);
  }
  return null;
}

// 清除 localStorage 草稿
function clearStorageDraft() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY_QUESTIONS);
    localStorage.removeItem(STORAGE_KEY_META);
  }
  state.isDraftLoaded = false;
  state.draftTime = null;
  updateDraftIndicator();
}

// 实时计算标签看板分布 (遵循 rebuild_tag_stats.py 算法)
function computeTagStats(questions, tags) {
  const counts = {};
  for (const q of questions) {
    for (const name of (q.tags || [])) {
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  let totalTagHits = 0;
  for (const k in counts) {
    totalTagHits += counts[k];
  }

  const totalWeight = tags.reduce((sum, t) => sum + (Number(t.weight) || 0), 0);

  const stats = tags.map((t) => {
    const actual = counts[t.name] || 0;
    const expected = totalWeight > 0 ? (t.weight / totalWeight) * totalTagHits : 0;
    return {
      id: t.id,
      name: t.name,
      weight: t.weight,
      tier: t.tier,
      actualCount: actual,
      expectedShare: Math.round(expected * 100) / 100,
      deficit: Math.round((expected - actual) * 100) / 100, // >0 欠频，<0 超额
    };
  });

  return {
    questionCount: questions.length,
    totalTagHits,
    totalWeight,
    tags: stats,
  };
}

// 核心筛选检索计算（所有筛选同时生效交集，并按设定排序）
function getFilteredQuestions() {
  const kw = state.searchKeyword.trim().toLowerCase();
  const startNum = parseIdNumber(state.filterIdStart);
  const endNum = parseIdNumber(state.filterIdEnd);

  const filtered = state.questions.filter((q) => {
    // 1. 状态筛选
    if (state.filterStatus !== "all" && q.status !== state.filterStatus) {
      return false;
    }

    // 2. 来源筛选
    if (state.filterSource !== "all" && (q.source || "未知") !== state.filterSource) {
      return false;
    }

    // 3. 入库日期 addedAt 筛选
    if (state.filterAddedAt !== "all" && (q.addedAt || "未知") !== state.filterAddedAt) {
      return false;
    }

    // 4. Topic 筛选
    if (state.filterTopic !== "all" && (q.topic || "未知") !== state.filterTopic) {
      return false;
    }

    // 5. 题型 type 筛选
    if (state.filterType !== "all" && (q.type || "未知") !== state.filterType) {
      return false;
    }

    // 6. 难度 difficulty 筛选
    if (state.filterDifficulty !== "all") {
      const qDiff = (q.difficulty !== undefined && q.difficulty !== null) ? String(q.difficulty) : "未知";
      if (qDiff !== state.filterDifficulty) {
        return false;
      }
    }

    // 7. 题号范围筛选 (起止输入框，支持 q100/100 格式，空=不限)
    if (startNum !== null || endNum !== null) {
      const qNum = parseIdNumber(q.id);
      if (qNum === null) return false;
      if (startNum !== null && qNum < startNum) return false;
      if (endNum !== null && qNum > endNum) return false;
    }

    // 8. 备注与标记题筛选 (全部 / 有备注 / 标记题(重复/格式/多选/多答案))
    if (state.filterNote === "has_note") {
      if (!hasNote(q)) return false;
    } else if (state.filterNote === "marked") {
      if (!isMarkedQuestion(q)) return false;
    }

    // 9. 组合标签筛选 (交集：题目必须同时具备所选标签)
    if (state.selectedTags.size > 0) {
      const qTags = new Set(q.tags || []);
      for (const reqTag of state.selectedTags) {
        if (!qTags.has(reqTag)) {
          return false;
        }
      }
    }

    // 10. 关键词检索 (id / stem / code / topic / explanation / editNote / options)
    if (kw) {
      const idMatch = (q.id || "").toLowerCase().includes(kw);
      const stemMatch = (q.stem || "").toLowerCase().includes(kw);
      const codeMatch = (q.code || "").toLowerCase().includes(kw);
      const topicMatch = (q.topic || "").toLowerCase().includes(kw);
      const expMatch = (q.explanation || "").toLowerCase().includes(kw);
      const noteMatch = (q.editNote || "").toLowerCase().includes(kw) ||
        (q.source || "").toLowerCase().includes(kw);
      const optMatch = (q.options || []).some(
        (opt) =>
          (opt.text || "").toLowerCase().includes(kw) ||
          (opt.hint || "").toLowerCase().includes(kw)
      );

      if (!idMatch && !stemMatch && !codeMatch && !topicMatch && !expMatch && !noteMatch && !optMatch) {
        return false;
      }
    }

    return true;
  });

  // 排序
  filtered.sort((a, b) => compareQuestions(a, b, state.sortBy));

  return filtered;
}

// 题库与标签数据加载主流程
async function loadData(forceClean = false) {
  const offlineBanner = document.getElementById("offlineBanner");

  // 1. 若非强制重载且本地有草稿，优先使用草稿
  if (!forceClean) {
    const draft = loadDraftFromStorage();
    if (draft) {
      state.questions = draft.list;
      state.isDraftLoaded = true;
      state.draftTime = draft.meta ? draft.meta.updatedAt : null;
      updateDraftIndicator();

      // 获取标签定义
      try {
        const resTags = await fetch("./data/tags.json");
        state.tags = await resTags.json();
      } catch (e) {
        console.warn("加载 ./data/tags.json 失败，尝试内置推断:", e);
      }

      state.tagStats = computeTagStats(state.questions, state.tags);
      if (offlineBanner) offlineBanner.style.display = "none";
      updateHeaderStats();
      renderActiveTagsBar();
      renderTagStatsGrid();
      renderQuestionList();
      showToast(`已从本地草稿恢复工作副本 (${state.questions.length} 题)`, "info");
      return;
    }
  }

  // 2. 否则从 ./data/ 加载默认快照
  try {
    const [resQ, resT] = await Promise.all([
      fetch("./data/questions.json"),
      fetch("./data/tags.json"),
    ]);

    if (!resQ.ok || !resT.ok) {
      throw new Error(`HTTP 状态异常: questions=${resQ.status}, tags=${resT.status}`);
    }

    state.questions = await resQ.json();
    state.tags = await resT.json();
    state.isDraftLoaded = false;
    state.draftTime = null;
    updateDraftIndicator();

    state.tagStats = computeTagStats(state.questions, state.tags);
    if (offlineBanner) offlineBanner.style.display = "none";
    updateHeaderStats();
    renderActiveTagsBar();
    renderTagStatsGrid();
    renderQuestionList();
    showToast(`题库快照载入成功 (共 ${state.questions.length} 题)`, "success");
  } catch (err) {
    console.error("加载 ./data/ 失败:", err);
    if (offlineBanner) offlineBanner.style.display = "flex";
    showToast("无法自动加载题库快照，请从本地文件载入整库", "error");
  }
}

// 更新顶部统计数据与筛选按钮状态
function updateHeaderStats() {
  if (typeof document === "undefined") return;
  const qList = state.questions;
  const total = qList.length;
  const verified = qList.filter((q) => q.status === "verified").length;
  const needsReview = qList.filter((q) => q.status === "needs_review").length;
  const draft = qList.filter((q) => q.status === "draft").length;

  const statAll = document.getElementById("statAll");
  const statVerified = document.getElementById("statVerified");
  const statNeedsReview = document.getElementById("statNeedsReview");
  const statDraft = document.getElementById("statDraft");

  if (statAll) statAll.textContent = `全部 ${total}`;
  if (statVerified) statVerified.textContent = `已通过 ${verified}`;
  if (statNeedsReview) statNeedsReview.textContent = `待重审 ${needsReview}`;
  if (statDraft) statDraft.textContent = `草稿 ${draft}`;

  // 同步工具条筛选按钮高亮
  document.querySelectorAll(".status-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === state.filterStatus);
  });
  document.querySelectorAll(".stat-pill").forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.status === state.filterStatus);
  });
}

// 渲染组合标签筛选激活栏
function renderActiveTagsBar() {
  const bar = document.getElementById("activeTagsBar");
  const chipsContainer = document.getElementById("selectedTagChips");
  const countTip = document.getElementById("matchCountTip");
  if (!bar || !chipsContainer) return;

  chipsContainer.innerHTML = "";

  if (state.selectedTags.size === 0) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  state.selectedTags.forEach((tagName) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${escapeHtml(tagName)} <span class="tag-chip-remove" title="移除">✕</span>`;
    chip.querySelector(".tag-chip-remove").onclick = () => {
      state.selectedTags.delete(tagName);
      renderActiveTagsBar();
      renderTagStatsGrid();
      renderQuestionList();
    };
    chipsContainer.appendChild(chip);
  });

  if (countTip) {
    const filteredCount = getFilteredQuestions().length;
    countTip.textContent = `当前组合筛选共匹配 ${filteredCount} 题`;
  }
}

// 渲染标签权重与分布看板
function renderTagStatsGrid() {
  if (typeof document === "undefined") return;
  const grid = document.getElementById("tagStatsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const statsDoc = state.tagStats;
  if (!statsDoc || !statsDoc.tags) return;

  const tagList = statsDoc.tags;
  const tip = document.getElementById("tagSummaryTip");
  const deficitCount = tagList.filter((t) => t.deficit > 0).length;
  const overCount = tagList.filter((t) => t.deficit < 0).length;

  if (tip) {
    tip.textContent = `总题数: ${statsDoc.questionCount} | 标签命中: ${statsDoc.totalTagHits} | 欠频: ${deficitCount} | 超额: ${overCount}`;
  }

  tagList.forEach((t) => {
    const item = document.createElement("div");
    const isSelected = state.selectedTags.has(t.name);
    item.className = `tag-stat-item ${isSelected ? "selected" : ""}`;

    // 欠/超徽章
    let deficitBadge = "";
    if (t.deficit > 0) {
      deficitBadge = `<span class="tag-deficit-badge deficit-need">欠 +${t.deficit} (补)</span>`;
    } else if (t.deficit < 0) {
      deficitBadge = `<span class="tag-deficit-badge deficit-over">超 ${t.deficit}</span>`;
    } else {
      deficitBadge = `<span class="tag-deficit-badge deficit-balanced">均衡 0.0</span>`;
    }

    const tierClass = `tier-${t.tier || "common"}`;

    item.innerHTML = `
      <div class="tag-stat-top">
        <div class="tag-name-wrap">
          <span class="tag-stat-name">${escapeHtml(t.name)}</span>
          <span class="tag-tier-badge ${tierClass}">${escapeHtml(t.tier || "common")}</span>
        </div>
        ${deficitBadge}
      </div>
      <div class="tag-stat-bottom">
        <span>实际题数: <b>${t.actualCount}</b> (权重 ${t.weight})</span>
        <span>期望题数: <b>${t.expectedShare}</b></span>
      </div>
    `;

    item.onclick = (e) => {
      if (e.ctrlKey || e.metaKey || state.selectedTags.size > 0) {
        if (state.selectedTags.has(t.name)) {
          state.selectedTags.delete(t.name);
        } else {
          state.selectedTags.add(t.name);
        }
      } else {
        if (state.selectedTags.has(t.name)) {
          state.selectedTags.clear();
        } else {
          state.selectedTags.clear();
          state.selectedTags.add(t.name);
        }
      }
      renderActiveTagsBar();
      renderTagStatsGrid();
      renderQuestionList();
    };

    grid.appendChild(item);
  });
}

// 渲染下拉筛选器
function renderSourceFilter() {
  const sel = document.getElementById("sourceFilter");
  if (!sel) return;
  const counts = {};
  for (const q of state.questions) {
    const k = q.source || "未知";
    counts[k] = (counts[k] || 0) + 1;
  }
  if (state.filterSource !== "all" && !counts[state.filterSource]) state.filterSource = "all";
  sel.innerHTML = `<option value="all">全部来源 (${state.questions.length})</option>` +
    Object.keys(counts).sort().map((k) =>
      `<option value="${escapeHtml(k)}">${escapeHtml(k)} (${counts[k]})</option>`).join("");
  sel.value = state.filterSource;
}

function renderAddedAtFilter() {
  const sel = document.getElementById("addedAtFilter");
  if (!sel) return;
  const counts = {};
  for (const q of state.questions) {
    const k = q.addedAt || "未知";
    counts[k] = (counts[k] || 0) + 1;
  }
  if (state.filterAddedAt !== "all" && !counts[state.filterAddedAt]) state.filterAddedAt = "all";
  const dates = Object.keys(counts).filter((k) => k !== "未知").sort((a, b) => b.localeCompare(a));
  if (counts["未知"]) dates.push("未知");
  sel.innerHTML = `<option value="all">全部入库日期 (${state.questions.length})</option>` +
    dates.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)} (${counts[k]})</option>`).join("");
  sel.value = state.filterAddedAt;
}

function renderTopicFilter() {
  const sel = document.getElementById("topicFilter");
  if (!sel) return;
  const counts = {};
  for (const q of state.questions) {
    const k = q.topic || "未知";
    counts[k] = (counts[k] || 0) + 1;
  }
  if (state.filterTopic !== "all" && !counts[state.filterTopic]) state.filterTopic = "all";
  const topics = Object.keys(counts).sort((a, b) => a.localeCompare(b, "zh-CN"));
  sel.innerHTML = `<option value="all">全部 Topic (${state.questions.length})</option>` +
    topics.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)} (${counts[k]})</option>`).join("");
  sel.value = state.filterTopic;
}

function renderTypeFilter() {
  const sel = document.getElementById("typeFilter");
  if (!sel) return;
  const counts = {};
  for (const q of state.questions) {
    const k = q.type || "未知";
    counts[k] = (counts[k] || 0) + 1;
  }
  if (state.filterType !== "all" && !counts[state.filterType]) state.filterType = "all";
  const types = Object.keys(counts).sort((a, b) => a.localeCompare(b, "zh-CN"));
  sel.innerHTML = `<option value="all">全部题型 (${state.questions.length})</option>` +
    types.map((k) => `<option value="${escapeHtml(k)}">${escapeHtml(k)} (${counts[k]})</option>`).join("");
  sel.value = state.filterType;
}

function renderDifficultyFilter() {
  const sel = document.getElementById("difficultyFilter");
  if (!sel) return;
  const counts = {};
  for (const q of state.questions) {
    const k = (q.difficulty !== undefined && q.difficulty !== null) ? String(q.difficulty) : "未知";
    counts[k] = (counts[k] || 0) + 1;
  }
  if (state.filterDifficulty !== "all" && !counts[state.filterDifficulty]) state.filterDifficulty = "all";
  const diffs = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="all">全部难度 (${state.questions.length})</option>` +
    diffs.map((k) => `<option value="${escapeHtml(k)}">难度 ${escapeHtml(k)} (${counts[k]})</option>`).join("");
  sel.value = state.filterDifficulty;
}

function renderNoteFilter() {
  const sel = document.getElementById("noteFilter");
  if (!sel) return;
  const hasNoteCount = state.questions.filter(hasNote).length;
  const markedCount = state.questions.filter(isMarkedQuestion).length;
  sel.innerHTML = `
    <option value="all">全部备注 (${state.questions.length})</option>
    <option value="has_note">有备注 (${hasNoteCount})</option>
    <option value="marked">标记题(重复/格式/多选) (${markedCount})</option>
  `;
  sel.value = state.filterNote;
}

function renderDropdownFilters() {
  if (typeof document === "undefined") return;
  renderSourceFilter();
  renderAddedAtFilter();
  renderTopicFilter();
  renderTypeFilter();
  renderDifficultyFilter();
  renderNoteFilter();
}

function updateBatchButton() {
  if (typeof document === "undefined") return;
  const btn = document.getElementById("btnBatchApprove");
  const count = state.selectedQuestionIds.size;
  if (btn) {
    btn.innerHTML = `✓ 批量审核通过 (${count})`;
    btn.disabled = count === 0;
  }
}

function renderQuestionList() {
  if (typeof document === "undefined") return;
  renderDropdownFilters();
  const container = document.getElementById("questionList");
  if (!container) return;
  container.innerHTML = "";

  const filtered = getFilteredQuestions();

  const resultCountText = document.getElementById("resultCountText");
  const filteredExportCount = document.getElementById("filteredExportCount");
  const importFilterCount = document.getElementById("importFilterCount");

  if (resultCountText) {
    resultCountText.textContent = `显示 ${filtered.length} / 共 ${state.questions.length} 题`;
  }
  if (filteredExportCount) {
    filteredExportCount.textContent = String(filtered.length);
  }
  if (importFilterCount) {
    importFilterCount.textContent = String(filtered.length);
  }

  updateBatchButton();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="card-panel" style="text-align: center; color: var(--muted); padding: 40px 20px;">
        🔍 没有匹配到符合条件的题目
      </div>
    `;
    return;
  }

  filtered.forEach((q) => {
    const isSelected = state.selectedQuestionIds.has(q.id);
    const card = document.createElement("div");
    card.className = `q-card status-${q.status} ${isSelected ? "selected" : ""}`;
    card.id = `qcard-${q.id}`;

    // 状态徽章文本
    let statusBadgeText = "已通过 verified";
    if (q.status === "needs_review") statusBadgeText = "待重审 needs_review";
    if (q.status === "draft") statusBadgeText = "草稿 draft";

    // 标签徽章
    const tagsHtml = (q.tags || [])
      .map((t) => `<span class="badge badge-tag">${escapeHtml(t)}</span>`)
      .join(" ");

    // 待审警示条
    let reviewAlertHtml = "";
    if (q.status === "needs_review") {
      reviewAlertHtml = `
        <div class="review-alert">
          <span>⚠️ <b>待审查：</b>该题曾有修改，选项与答案必须重新核对。请复制代码在本地 python3 验证，确认无误后点击「审核通过」。</span>
        </div>
      `;
    }

    // 改动备注条
    let editNoteHtml = "";
    if (q.editNote) {
      editNoteHtml = `
        <div class="edit-note-bar">
          📝 <b>改动备注:</b> ${escapeHtml(q.editNote)}
        </div>
      `;
    }

    // 选项列表
    const optionsHtml = (q.options || [])
      .map((opt) => {
        const isCorrect = opt.key === q.answer;
        return `
          <div class="opt-card ${isCorrect ? "correct" : ""}">
            <div class="opt-letter">${escapeHtml(opt.key)}</div>
            <div class="opt-content">
              <div class="opt-text">${escapeHtml(opt.text)} ${
                isCorrect
                  ? '<b style="color:var(--emerald);font-size:12px;margin-left:6px;">[正确答案 ✓]</b>'
                  : ""
              }</div>
              ${
                opt.hint
                  ? `<div class="opt-hint">💡 提示: ${escapeHtml(opt.hint)}</div>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");

    const correctOpt = (q.options || []).find((o) => o.key === q.answer);
    const correctOptText = correctOpt ? correctOpt.text : "";

    card.innerHTML = `
      <div class="q-header">
        <div class="q-meta-left">
          <label class="q-checkbox-label" title="选择本题进行批量操作">
            <input type="checkbox" class="q-card-checkbox" data-qid="${escapeHtml(q.id)}" ${isSelected ? "checked" : ""}>
          </label>
          <span class="q-id">${escapeHtml(q.id)}</span>
          <span class="badge badge-status-${q.status}">${statusBadgeText}</span>
          ${q.topic ? `<span class="badge badge-topic">${escapeHtml(q.topic)}</span>` : ""}
          ${tagsHtml}
          ${q.type ? `<span class="badge badge-type">${escapeHtml(q.type)}</span>` : ""}
          ${q.difficulty ? `<span class="badge badge-diff">难度 ${escapeHtml(q.difficulty)}</span>` : ""}
          <span class="badge badge-rev">${
            q.revised ? `r${q.revision} · 曾改动` : `r${q.revision || 0}`
          }</span>
        </div>
        <div class="q-meta-right">
          <span class="badge badge-source" title="来源">📥 ${escapeHtml(q.source || "未知")}</span>
          <span class="badge badge-added" title="入库日期">🗓 入库 ${escapeHtml(q.addedAt || "未知")}</span>
          ${q.lastEditedAt ? `最近改动: ${formatTime(q.lastEditedAt)}` : "未改动"}
        </div>
      </div>

      ${reviewAlertHtml}
      ${editNoteHtml}

      <div class="q-body">
        <div class="q-stem">${escapeHtml(q.stem)}</div>
        ${q.code ? `<pre class="code-block">${escapeHtml(q.code)}</pre>` : ""}
        <div class="options-grid">
          ${optionsHtml}
        </div>
        ${
          q.explanation
            ? `
          <div class="explanation-box">
            <div class="explanation-title">📖 解析说明</div>
            <div>${escapeHtml(q.explanation)}</div>
          </div>
        `
            : ""
        }

        <div class="code-review-notice">
          <div class="code-review-header">
            <span>💻 Python 运行审查 (纯静态环境)</span>
            <span class="expected-answer-pill">正确答案: ${q.answer} (${escapeHtml(correctOptText)})</span>
          </div>
          <div class="code-review-text">
            纯静态页面无法在浏览器端安全沙箱执行 Python。请点击右下角「复制代码」在本地 <code>python3</code> 验证输出。
          </div>
        </div>
      </div>

      <div class="q-footer">
        <button class="btn btn-sm btn-copy-card-code" data-qid="${escapeHtml(q.id)}" title="复制本题 Python 代码到剪贴板">
          📋 复制代码
        </button>
        <button class="btn btn-sm btn-primary btn-edit-card" data-qid="${escapeHtml(q.id)}">
          ✏️ 原地编辑
        </button>
        ${
          q.status !== "verified"
            ? `
          <button class="btn btn-sm btn-success btn-approve-card" data-qid="${escapeHtml(q.id)}">
            ✓ 审核通过 → verified
          </button>
        `
            : ""
        }
      </div>
    `;

    container.appendChild(card);
  });
}

// 批量审核通过逻辑 (与单题审核通过一致: status -> verified，不增加 revision，不改 revised，保持 lastEditedAt)
function handleBatchApprove() {
  if (state.selectedQuestionIds.size === 0) {
    showToast("请先选择题目", "info");
    return;
  }

  const selectedTargets = state.questions.filter((q) => state.selectedQuestionIds.has(q.id));
  if (selectedTargets.length === 0) {
    showToast("未找到所选题目", "error");
    return;
  }

  const count = selectedTargets.length;
  const ok = (typeof confirm !== "undefined")
    ? confirm(`确认将选中的 ${count} 道题目审核通过吗？\n（状态将变更为 verified，不增加 revision 版本）`)
    : true;
  if (!ok) return;

  selectedTargets.forEach((q) => {
    q.status = "verified";
  });

  state.selectedQuestionIds.clear();

  // 持久化与重绘 (与 handleApprove 逻辑一致)
  saveDraftToStorage();
  state.tagStats = computeTagStats(state.questions, state.tags);
  updateHeaderStats();
  renderTagStatsGrid();
  renderQuestionList();
  showToast(`已批量审核通过 ${count} 道题目！`, "success");
}

// 绑定筛选与检索事件
function setupFilterEvents() {
  // 顶部状态点击
  const headerStats = document.getElementById("headerStats");
  if (headerStats) {
    headerStats.onclick = (e) => {
      const pill = e.target.closest(".stat-pill");
      if (!pill) return;
      state.filterStatus = pill.dataset.status;
      updateHeaderStats();
      renderQuestionList();
    };
  }

  // 工具条状态按钮点击
  document.querySelectorAll(".status-filter-btn").forEach((btn) => {
    btn.onclick = () => {
      state.filterStatus = btn.dataset.status;
      updateHeaderStats();
      renderQuestionList();
    };
  });

  // 搜索框输入防抖检索
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.oninput = (e) => {
      state.searchKeyword = e.target.value;
      renderQuestionList();
      renderActiveTagsBar();
    };
  }

  // 来源筛选
  const sourceFilter = document.getElementById("sourceFilter");
  if (sourceFilter) {
    sourceFilter.onchange = () => {
      state.filterSource = sourceFilter.value;
      renderQuestionList();
    };
  }

  // 入库日期筛选
  const addedAtFilter = document.getElementById("addedAtFilter");
  if (addedAtFilter) {
    addedAtFilter.onchange = () => {
      state.filterAddedAt = addedAtFilter.value;
      renderQuestionList();
    };
  }

  // Topic 筛选
  const topicFilter = document.getElementById("topicFilter");
  if (topicFilter) {
    topicFilter.onchange = () => {
      state.filterTopic = topicFilter.value;
      renderQuestionList();
    };
  }

  // 题型筛选
  const typeFilter = document.getElementById("typeFilter");
  if (typeFilter) {
    typeFilter.onchange = () => {
      state.filterType = typeFilter.value;
      renderQuestionList();
    };
  }

  // 难度筛选
  const difficultyFilter = document.getElementById("difficultyFilter");
  if (difficultyFilter) {
    difficultyFilter.onchange = () => {
      state.filterDifficulty = difficultyFilter.value;
      renderQuestionList();
    };
  }

  // 标记/备注筛选
  const noteFilter = document.getElementById("noteFilter");
  if (noteFilter) {
    noteFilter.onchange = () => {
      state.filterNote = noteFilter.value;
      renderQuestionList();
    };
  }

  // 题号范围筛选
  const idStartInput = document.getElementById("idRangeStart");
  const idEndInput = document.getElementById("idRangeEnd");
  if (idStartInput) {
    idStartInput.oninput = (e) => {
      state.filterIdStart = e.target.value;
      renderQuestionList();
    };
  }
  if (idEndInput) {
    idEndInput.oninput = (e) => {
      state.filterIdEnd = e.target.value;
      renderQuestionList();
    };
  }

  // 排序下拉
  const sortFilter = document.getElementById("sortFilter");
  if (sortFilter) {
    sortFilter.onchange = (e) => {
      state.sortBy = e.target.value;
      renderQuestionList();
    };
  }

  // 全选当前筛选
  const btnSelectAll = document.getElementById("btnSelectAllFiltered");
  if (btnSelectAll) {
    btnSelectAll.onclick = () => {
      const filtered = getFilteredQuestions();
      if (filtered.length === 0) {
        showToast("当前筛选结果为空，无题目可全选", "info");
        return;
      }
      filtered.forEach((q) => state.selectedQuestionIds.add(q.id));
      renderQuestionList();
      showToast(`已选中当前筛选的 ${filtered.length} 道题目`, "info");
    };
  }

  // 清空选择
  const btnClearSel = document.getElementById("btnClearSelection");
  if (btnClearSel) {
    btnClearSel.onclick = () => {
      state.selectedQuestionIds.clear();
      renderQuestionList();
      showToast("已清空所选题目", "info");
    };
  }

  // 批量审核通过
  const btnBatch = document.getElementById("btnBatchApprove");
  if (btnBatch) {
    btnBatch.onclick = handleBatchApprove;
  }

  // 重置全部筛选 (清空所有新旧筛选条件，并恢复控件显示)
  const btnReset = document.getElementById("btnResetAllFilters");
  if (btnReset) {
    btnReset.onclick = () => {
      state.filterStatus = "all";
      state.filterSource = "all";
      state.filterAddedAt = "all";
      state.filterTopic = "all";
      state.filterType = "all";
      state.filterDifficulty = "all";
      state.filterIdStart = "";
      state.filterIdEnd = "";
      state.filterNote = "all";
      state.sortBy = "id_asc";
      state.selectedTags.clear();
      state.searchKeyword = "";
      state.selectedQuestionIds.clear();

      if (searchInput) searchInput.value = "";
      if (idStartInput) idStartInput.value = "";
      if (idEndInput) idEndInput.value = "";
      if (sortFilter) sortFilter.value = "id_asc";

      updateHeaderStats();
      renderActiveTagsBar();
      renderTagStatsGrid();
      renderDropdownFilters();
      renderQuestionList();
      showToast("已重置所有筛选条件", "info");
    };
  }

  // 清空标签筛选
  const btnClearTag = document.getElementById("btnClearTagFilter");
  if (btnClearTag) {
    btnClearTag.onclick = () => {
      state.selectedTags.clear();
      renderActiveTagsBar();
      renderTagStatsGrid();
      renderQuestionList();
    };
  }

  // 展开/收起标签面板
  let tagPanelVisible = true;
  const btnToggleTagPanel = document.getElementById("btnToggleTagPanel");
  const tagStatsGrid = document.getElementById("tagStatsGrid");
  const tagPanelArrow = document.getElementById("tagPanelArrow");
  if (btnToggleTagPanel && tagStatsGrid && tagPanelArrow) {
    btnToggleTagPanel.onclick = () => {
      tagPanelVisible = !tagPanelVisible;
      tagStatsGrid.style.display = tagPanelVisible ? "grid" : "none";
      tagPanelArrow.textContent = tagPanelVisible ? "▼" : "▶";
    };
  }
}

// 剪贴板复制通用函数
async function copyTextToClipboard(text, successMsg = "代码已复制到剪贴板！") {
  if (!text) {
    showToast("没有可复制的代码内容", "info");
    return;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      showToast(successMsg, "success");
      return;
    }
  } catch (err) {
    console.warn("navigator.clipboard 失败，尝试 fallback:", err);
  }

  // 兼容 fallback
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (ok) {
      showToast(successMsg, "success");
    } else {
      showToast("复制失败，请手动选取复制", "error");
    }
  } catch (e) {
    showToast("复制失败，请手动选取复制", "error");
  } finally {
    ta.remove();
  }
}

// 审核通过逻辑 (status -> verified，不增加 revision)
function handleApprove(qid) {
  const q = state.questions.find((x) => x.id === qid);
  if (!q) return;

  const ok = (typeof confirm !== "undefined")
    ? confirm(`确认题目【${qid}】核验无误，审核通过吗？\n（状态将变更为 verified，不增加 revision 版本）`)
    : true;
  if (!ok) return;

  q.status = "verified";

  // 持久化与重绘
  saveDraftToStorage();
  state.tagStats = computeTagStats(state.questions, state.tags);
  updateHeaderStats();
  renderTagStatsGrid();
  renderQuestionList();
  showToast(`题目 ${qid} 审核通过，已保存为 verified！`, "success");
}

// 渲染编辑模态框内部的标签选择器 (严格限制 1–2 个，且在 tags.json 内)
function renderEditTagSelector() {
  const box = document.getElementById("editTagSelector");
  const tip = document.getElementById("editTagCountTip");
  if (!box) return;
  box.innerHTML = "";

  const count = state.editSelectedTags.size;
  if (tip) {
    tip.textContent = `已选 ${count} 个 (规则: 1–2 个)`;
    tip.style.color = count >= 1 && count <= 2 ? "var(--emerald)" : "var(--rose)";
  }

  state.tags.forEach((t) => {
    const chip = document.createElement("span");
    const isChecked = state.editSelectedTags.has(t.name);
    chip.className = `tag-select-chip ${isChecked ? "checked" : ""}`;
    chip.textContent = t.name;

    chip.onclick = () => {
      if (state.editSelectedTags.has(t.name)) {
        state.editSelectedTags.delete(t.name);
      } else {
        if (state.editSelectedTags.size >= 2) {
          showToast("每题标签最多选 2 个", "error");
          return;
        }
        state.editSelectedTags.add(t.name);
      }
      renderEditTagSelector();
    };

    box.appendChild(chip);
  });
}

// 打开原地编辑模态框
function handleOpenEdit(qid) {
  const q = state.questions.find((x) => x.id === qid);
  if (!q) return;

  state.editingQuestion = JSON.parse(JSON.stringify(q));
  state.editSelectedTags = new Set(q.tags || []);

  const editQid = document.getElementById("editQid");
  const editTopic = document.getElementById("editTopic");
  const editAnimationId = document.getElementById("editAnimationId");
  const editStem = document.getElementById("editStem");
  const editCode = document.getElementById("editCode");
  const editExplanation = document.getElementById("editExplanation");
  const editNote = document.getElementById("editNote");

  if (editQid) editQid.value = q.id;
  if (editTopic) editTopic.value = q.topic || "";
  if (editAnimationId) editAnimationId.value = q.animationId || "";
  if (editStem) editStem.value = q.stem || "";
  if (editCode) editCode.value = q.code || "";
  if (editExplanation) editExplanation.value = q.explanation || "";
  if (editNote) editNote.value = q.editNote || "";

  // 选项与提示
  ["A", "B", "C", "D"].forEach((letter) => {
    const opt = (q.options || []).find((o) => o.key === letter) || { text: "", hint: "" };
    const textEl = document.getElementById(`editOptText${letter}`);
    const hintEl = document.getElementById(`editOptHint${letter}`);
    if (textEl) textEl.value = opt.text || "";
    if (hintEl) hintEl.value = opt.hint || "";
  });

  // 正确答案单选
  const answerRadio = document.querySelector(
    `input[name="editAnswer"][value="${q.answer}"]`
  );
  if (answerRadio) answerRadio.checked = true;

  renderEditTagSelector();

  const editModal = document.getElementById("editModal");
  if (editModal) editModal.style.display = "flex";
}

// 保存编辑修改 (needs_review 规则: revision + 1, revised = true, status = needs_review)
function handleSaveEdit() {
  const qid = document.getElementById("editQid")?.value;
  const qIndex = state.questions.findIndex((x) => x.id === qid);
  if (qIndex === -1) {
    showToast("未找到原题目数据", "error");
    return;
  }
  const originalQ = state.questions[qIndex];

  // 1. 校验标签
  const tags = Array.from(state.editSelectedTags);
  if (tags.length < 1 || tags.length > 2) {
    showToast("知识点标签必须选择 1–2 个", "error");
    return;
  }
  const validTagNames = new Set(state.tags.map((t) => t.name));
  for (const t of tags) {
    if (!validTagNames.has(t)) {
      showToast(`标签【${t}】不在 tags.json 允许列表中`, "error");
      return;
    }
  }

  // 2. 校验题干
  const stem = document.getElementById("editStem")?.value.trim() || "";
  if (!stem) {
    showToast("题干内容不能为空", "error");
    return;
  }

  // 3. 校验四选项
  const options = [];
  for (const letter of ["A", "B", "C", "D"]) {
    const text = document.getElementById(`editOptText${letter}`)?.value.trim() || "";
    const hint = document.getElementById(`editOptHint${letter}`)?.value.trim() || "";
    if (!text) {
      showToast(`选项 ${letter} 文本不能为空`, "error");
      return;
    }
    options.push({ key: letter, text, hint });
  }

  // 4. 校验正确答案
  const answerRadio = document.querySelector('input[name="editAnswer"]:checked');
  if (!answerRadio) {
    showToast("必须指定唯一正确答案 (A/B/C/D)", "error");
    return;
  }
  const answer = answerRadio.value;

  // 5. 应用修改与元数据升级
  const currentRevision = Number(originalQ.revision) || 0;
  const updatedQuestion = {
    ...originalQ,
    topic: document.getElementById("editTopic")?.value.trim() || "",
    animationId: document.getElementById("editAnimationId")?.value.trim() || null,
    tags,
    stem,
    code: document.getElementById("editCode")?.value || "",
    options,
    answer,
    explanation: document.getElementById("editExplanation")?.value.trim() || "",
    editNote: document.getElementById("editNote")?.value.trim() || "",
    status: "needs_review", // 强制置为 needs_review
    revised: true,
    revision: currentRevision + 1, // 版本累加
    lastEditedAt: new Date().toISOString(),
  };

  state.questions[qIndex] = updatedQuestion;

  // 持久化保存到本地工作副本草稿
  saveDraftToStorage();
  state.tagStats = computeTagStats(state.questions, state.tags);

  const editModal = document.getElementById("editModal");
  if (editModal) editModal.style.display = "none";

  updateHeaderStats();
  renderTagStatsGrid();
  renderQuestionList();

  showToast(
    `题目 ${qid} 保存成功！版本升至 r${updatedQuestion.revision}，状态置为 needs_review`,
    "success"
  );
}

// 绑定编辑模态框及列表内操作按钮
function setupEditModalEvents() {
  const editModal = document.getElementById("editModal");
  const btnClose = document.getElementById("btnCloseEditModal");
  const btnCancel = document.getElementById("btnCancelEdit");
  const btnSave = document.getElementById("btnSaveEdit");
  const btnCopyModalCode = document.getElementById("btnCopyCodeInModal");

  if (btnClose) btnClose.onclick = () => { if (editModal) editModal.style.display = "none"; };
  if (btnCancel) btnCancel.onclick = () => { if (editModal) editModal.style.display = "none"; };
  if (btnSave) btnSave.onclick = handleSaveEdit;

  // 模态框内复制代码
  if (btnCopyModalCode) {
    btnCopyModalCode.onclick = () => {
      const codeVal = document.getElementById("editCode")?.value || "";
      copyTextToClipboard(codeVal, "编辑器代码已复制到剪贴板！");
    };
  }

  // 事件委托：列表卡片复选框与操作按钮 (复制代码、原地编辑、审核通过)
  const questionList = document.getElementById("questionList");
  if (questionList) {
    questionList.addEventListener("change", (e) => {
      const chk = e.target.closest(".q-card-checkbox");
      if (chk) {
        const qid = chk.dataset.qid;
        if (chk.checked) {
          state.selectedQuestionIds.add(qid);
        } else {
          state.selectedQuestionIds.delete(qid);
        }
        const card = document.getElementById(`qcard-${qid}`);
        if (card) {
          card.classList.toggle("selected", chk.checked);
        }
        updateBatchButton();
      }
    });

    questionList.onclick = (e) => {
      const copyBtn = e.target.closest(".btn-copy-card-code");
      if (copyBtn) {
        const qid = copyBtn.dataset.qid;
        const q = state.questions.find((x) => x.id === qid);
        if (q) {
          copyTextToClipboard(q.code || "", `题目 ${qid} 的代码已复制！`);
        }
        return;
      }

      const editBtn = e.target.closest(".btn-edit-card");
      if (editBtn) {
        const qid = editBtn.dataset.qid;
        handleOpenEdit(qid);
        return;
      }

      const approveBtn = e.target.closest(".btn-approve-card");
      if (approveBtn) {
        const qid = approveBtn.dataset.qid;
        handleApprove(qid);
        return;
      }
    };
  }
}

// 获取用于导出文件名的当前日期字符串 YYYYMMDD
function getExportDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// 触发下载 JSON 文件
function downloadJson(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 600);
}

// 导出功能事件绑定
function setupExportEvents() {
  // 1. 导出当前筛选结果
  const btnExportFiltered = document.getElementById("btnExportFiltered");
  if (btnExportFiltered) {
    btnExportFiltered.onclick = () => {
      const filtered = getFilteredQuestions();
      if (filtered.length === 0) {
        showToast("当前筛选结果为空，无题目可导出", "error");
        return;
      }
      const filename = `pydrill-filtered-${getExportDateString()}.json`;
      downloadJson(filtered, filename);
      showToast(`已导出当前筛选结果 (${filtered.length} 题) 至 ${filename}`, "success");
    };
  }

  // 2. 导出整库 (顶部与工具条按钮)
  const handleExportFull = () => {
    if (state.questions.length === 0) {
      showToast("题库为空，无数据可导出", "error");
      return;
    }
    const filename = `pydrill-questions-full-${getExportDateString()}.json`;
    downloadJson(state.questions, filename);
    showToast(`已导出整库 (${state.questions.length} 题) 至 ${filename}`, "success");
  };

  const btnExportFull = document.getElementById("btnExportFull");
  const btnExportFullToolbar = document.getElementById("btnExportFullToolbar");
  if (btnExportFull) btnExportFull.onclick = handleExportFull;
  if (btnExportFullToolbar) btnExportFullToolbar.onclick = handleExportFull;
}

// 题目单项合法性校验 (遵循 schema.md)
function validateQuestionItem(item, validTagNames) {
  if (!item || typeof item !== "object") {
    return { valid: false, reason: "题目不是有效对象" };
  }
  if (!item.id || typeof item.id !== "string") {
    return { valid: false, reason: "缺少有效题号 id" };
  }
  if (!item.stem || typeof item.stem !== "string") {
    return { valid: false, reason: "缺少题干 stem" };
  }
  if (!Array.isArray(item.options) || item.options.length !== 4) {
    return { valid: false, reason: "选项 options 必须包含 4 个选项" };
  }
  const keys = item.options.map((o) => o.key);
  if (!["A", "B", "C", "D"].every((k) => keys.includes(k))) {
    return { valid: false, reason: "选项 key 必须完整覆盖 A, B, C, D" };
  }
  if (!["A", "B", "C", "D"].includes(item.answer)) {
    return { valid: false, reason: "正确答案 answer 必须为 A, B, C, D 之一" };
  }
  if (!Array.isArray(item.tags) || item.tags.length < 1 || item.tags.length > 2) {
    return { valid: false, reason: "知识点标签 tags 数量必须为 1–2 个" };
  }
  if (validTagNames && validTagNames.size > 0) {
    for (const t of item.tags) {
      if (!validTagNames.has(t)) {
        return { valid: false, reason: `知识点标签【${t}】不在 tags.json 中` };
      }
    }
  }
  return { valid: true };
}

// 导入功能事件绑定与执行
function setupImportEvents() {
  const importModal = document.getElementById("importModal");
  const btnOpen = document.getElementById("btnOpenImportModal");
  const btnClose = document.getElementById("btnCloseImportModal");
  const btnCancel = document.getElementById("btnCancelImport");
  const fileInput = document.getElementById("importFileInput");
  const fileSummary = document.getElementById("importFileSummary");
  const btnExecute = document.getElementById("btnExecuteImport");
  const reportBox = document.getElementById("importReportBox");
  const localFileInput = document.getElementById("localFileInput");

  // 打开导入弹窗
  if (btnOpen) {
    btnOpen.onclick = () => {
      state.pendingImportData = null;
      if (fileInput) fileInput.value = "";
      if (fileSummary) {
        fileSummary.innerHTML = "请选择包含题目数组的 <code>.json</code> 文件 (如 questions.json、导出文件)";
      }
      if (btnExecute) btnExecute.disabled = true;
      if (reportBox) {
        reportBox.style.display = "none";
        reportBox.innerHTML = "";
      }
      const filtered = getFilteredQuestions();
      const countEl = document.getElementById("importFilterCount");
      if (countEl) countEl.textContent = String(filtered.length);

      if (importModal) importModal.style.display = "flex";
    };
  }

  // 关闭导入弹窗
  const closeImportModal = () => {
    if (importModal) importModal.style.display = "none";
    state.pendingImportData = null;
  };
  if (btnClose) btnClose.onclick = closeImportModal;
  if (btnCancel) btnCancel.onclick = closeImportModal;

  // 监听文件选取解析
  if (fileInput) {
    fileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (!Array.isArray(parsed)) {
            throw new Error("JSON 根层级必须为题目数组 (Array)");
          }
          state.pendingImportData = parsed;
          if (fileSummary) {
            fileSummary.innerHTML = `✅ 已解析文件: <b>${escapeHtml(file.name)}</b> (共检测到 <b>${parsed.length}</b> 道题目数据)`;
            fileSummary.style.color = "var(--emerald)";
          }
          if (btnExecute) btnExecute.disabled = false;
        } catch (err) {
          state.pendingImportData = null;
          if (fileSummary) {
            fileSummary.innerHTML = `❌ 文件解析失败: ${escapeHtml(err.message)}`;
            fileSummary.style.color = "var(--rose)";
          }
          if (btnExecute) btnExecute.disabled = true;
        }
      };
      reader.onerror = () => {
        showToast("读取文件失败", "error");
      };
      reader.readAsText(file, "utf-8");
    };
  }

  // 执行导入主逻辑
  if (btnExecute) {
    btnExecute.onclick = () => {
      const importList = state.pendingImportData;
      if (!Array.isArray(importList) || importList.length === 0) {
        showToast("暂无可导入的有效题目数据", "error");
        return;
      }

      const modeRadio = document.querySelector('input[name="importMode"]:checked');
      const mode = modeRadio ? modeRadio.value : "merge_full";

      const validTagNames = new Set(state.tags.map((t) => t.name));
      const currentFilteredIds = new Set(getFilteredQuestions().map((q) => q.id));

      let updatedCount = 0;
      let addedCount = 0;
      let skippedCount = 0;
      const invalidItems = [];

      // 建立 ID 索引表
      const qIndexMap = new Map();
      state.questions.forEach((q, idx) => {
        qIndexMap.set(q.id, idx);
      });

      importList.forEach((rawItem, i) => {
        const valRes = validateQuestionItem(rawItem, validTagNames);
        if (!valRes.valid) {
          invalidItems.push({
            index: i + 1,
            id: rawItem ? rawItem.id || "未知ID" : "无效",
            reason: valRes.reason,
          });
          return;
        }

        const qid = rawItem.id;

        if (mode === "merge_filtered") {
          // 模式 2: 仅更新当前筛选集已有的题目
          if (currentFilteredIds.has(qid)) {
            const existingIdx = qIndexMap.get(qid);
            if (existingIdx !== undefined) {
              state.questions[existingIdx] = rawItem;
              updatedCount++;
            } else {
              skippedCount++;
            }
          } else {
            skippedCount++;
          }
        } else {
          // 模式 1: merge_full，整库合并 (按 ID 覆盖/追加)
          if (qIndexMap.has(qid)) {
            const existingIdx = qIndexMap.get(qid);
            state.questions[existingIdx] = rawItem;
            updatedCount++;
          } else {
            state.questions.push(rawItem);
            qIndexMap.set(qid, state.questions.length - 1);
            addedCount++;
          }
        }
      });

      // 持久化与状态重绘
      saveDraftToStorage();
      state.tagStats = computeTagStats(state.questions, state.tags);
      updateHeaderStats();
      renderTagStatsGrid();
      renderActiveTagsBar();
      renderQuestionList();

      // 展示执行报告
      if (reportBox) {
        reportBox.style.display = "block";
        let invalidHtml = "";
        if (invalidItems.length > 0) {
          invalidHtml = `
            <div style="margin-top: 8px; color: var(--rose); font-size: 12px;">
              <b>⚠️ 跳过不合法题目 (${invalidItems.length} 道):</b>
              <ul style="padding-left: 18px; margin-top: 4px; max-height: 100px; overflow-y: auto;">
                ${invalidItems.map((inv) => `<li>第 ${inv.index} 项 (${inv.id}): ${escapeHtml(inv.reason)}</li>`).join("")}
              </ul>
            </div>
          `;
        }

        reportBox.innerHTML = `
          <div style="font-size: 13.5px; font-weight: 600; color: var(--ink); margin-bottom: 6px;">
            🎉 导入操作完成报告 (${mode === "merge_filtered" ? "仅更新当前筛选" : "合并进整库"})
          </div>
          <div style="font-size: 13px; color: var(--ink-secondary); line-height: 1.6;">
            • 成功覆盖更新: <b>${updatedCount}</b> 题<br>
            • 新增追加题数: <b>${addedCount}</b> 题<br>
            • 筛选外忽略跳过: <b>${skippedCount}</b> 题<br>
            • 内存当前整库题数: <b>${state.questions.length}</b> 题
          </div>
          ${invalidHtml}
          <div style="margin-top: 10px; font-size: 12px; color: var(--amber); font-weight: 500;">
            💡 提示: 数据已自动保存至浏览器本地工作草稿。关闭页面不会丢失，但记得在工作完成后点击「导出整库」将 JSON 文件持久化到本地！
          </div>
        `;
      }

      showToast(`导入成功！已更新 ${updatedCount} 题，新增 ${addedCount} 题`, "success");
    };
  }

  // 离线/跨域横幅文件导入
  if (localFileInput) {
    localFileInput.onchange = (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (!Array.isArray(parsed)) throw new Error("JSON 格式必须为题目数组");

          state.questions = parsed;
          saveDraftToStorage();

          try {
            const resTags = await fetch("./data/tags.json");
            state.tags = await resTags.json();
          } catch (tErr) {
            console.warn("加载 tags.json 失败:", tErr);
          }

          state.tagStats = computeTagStats(state.questions, state.tags);
          const offlineBanner = document.getElementById("offlineBanner");
          if (offlineBanner) offlineBanner.style.display = "none";

          updateHeaderStats();
          renderActiveTagsBar();
          renderTagStatsGrid();
          renderQuestionList();
          showToast(`已从本地文件加载整库 (${state.questions.length} 题)`, "success");
        } catch (err) {
          showToast(`解析本地文件失败: ${err.message}`, "error");
        }
      };
      reader.readAsText(file, "utf-8");
    };
  }
}

// 绑定草稿管理与刷新事件
function setupHeaderActions() {
  // 清除本地草稿
  const btnClearDraft = document.getElementById("btnClearDraft");
  if (btnClearDraft) {
    btnClearDraft.onclick = () => {
      const ok = confirm(
        "确认清除保存在浏览器中的工作副本？\n清除后将丢弃本地草稿，并重新从 ./data/questions.json 加载初始快照。"
      );
      if (!ok) return;

      clearStorageDraft();
      loadData(true);
      showToast("本地草稿已清除，已重新从快照载入", "info");
    };
  }

  // 重新加载按钮
  const btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      loadData();
      showToast("已重新加载数据", "info");
    };
  }
}

// 启动入口
function initApp() {
  setupFilterEvents();
  setupEditModalEvents();
  setupExportEvents();
  setupImportEvents();
  setupHeaderActions();
  loadData();
}

// DOM 加载完成后初始化
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initApp);
}

// 支持 Node 运行环境测试
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    state,
    parseIdNumber,
    isMarkedQuestion,
    hasNote,
    compareQuestions,
    getFilteredQuestions,
    computeTagStats,
    handleApprove,
    handleBatchApprove,
    renderDropdownFilters,
    renderQuestionList,
  };
}
