const MODE_CONFIG = {
  demo: {
    count: 10,
    title: "Кратка листовка · 10 въпроса",
    adaptiveStrength: 0.75,
    noveltyStrength: 1.15,
    topicBalanceStrength: 0.95,
    recentPenalty: 2.8,
    imageTargetRatio: 0.30
  },
  quick: {
    count: 20,
    title: "Бърз тест · 20 въпроса",
    adaptiveStrength: 0.95,
    noveltyStrength: 1.10,
    topicBalanceStrength: 1.00,
    recentPenalty: 2.8,
    imageTargetRatio: 0.30
  },
  full: {
    count: 45,
    title: "Пълен тест · 45 въпроса",
    adaptiveStrength: 0.80,
    noveltyStrength: 1.00,
    topicBalanceStrength: 1.15,
    recentPenalty: 2.5,
    imageTargetRatio: 0.30
  },
  exam: {
    count: 45,
    title: "Демо изпит · 45 въпроса",
    adaptiveStrength: 0.25,
    noveltyStrength: 0.90,
    topicBalanceStrength: 1.45,
    recentPenalty: 2.2,
    imageTargetRatio: 0.35
  },
  ai: {
    count: 10,
    title: "Адаптивна тренировка · 10 въпроса",
    adaptiveStrength: 1.75,
    noveltyStrength: 0.90,
    topicBalanceStrength: 0.55,
    recentPenalty: 1.8,
    imageTargetRatio: 0.30
  }
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function questionTopics(question) {
  return safeArray(question.topicIds).map(String).filter(Boolean);
}

function buildAdaptiveProfile(results) {
  const sorted = safeArray(results).slice().sort((a, b) => Number(b._createdMs || 0) - Number(a._createdMs || 0));
  const topicStats = {};
  const questionStats = {};
  const recentQuestionIds = new Set();

  sorted.slice(0, 3).forEach(result => {
    safeArray(result.answers).forEach(answer => {
      if (answer?.questionId) recentQuestionIds.add(String(answer.questionId));
    });
  });

  for (const result of sorted) {
    for (const answer of safeArray(result.answers)) {
      if (!answer || !answer.questionId) continue;
      const questionId = String(answer.questionId);
      const q = questionStats[questionId] || {
        attempts: 0,
        wrong: 0,
        correct: 0,
        lastSeenMs: 0
      };

      q.attempts++;
      if (answer.isCorrect === true) q.correct++;
      else q.wrong++;
      q.lastSeenMs = Math.max(q.lastSeenMs, Number(result._createdMs || 0));
      questionStats[questionId] = q;

      for (const topicId of safeArray(answer.topicIds).map(String)) {
        const t = topicStats[topicId] || { total: 0, correct: 0, wrong: 0, accuracy: 50 };
        t.total++;
        if (answer.isCorrect === true) t.correct++;
        else t.wrong++;
        t.accuracy = t.total ? Math.round((t.correct / t.total) * 100) : 50;
        topicStats[topicId] = t;
      }
    }
  }

  return {
    topicStats,
    questionStats,
    recentQuestionIds,
    resultCount: sorted.length
  };
}

function topicWeakness(topicId, profile) {
  const stats = profile.topicStats[topicId];
  if (!stats || stats.total < 2) return 0.50;
  return Math.max(0, Math.min(1, (100 - Number(stats.accuracy || 0)) / 100));
}

function strongestTopicWeakness(question, profile) {
  const topics = questionTopics(question);
  if (!topics.length) return 0.45;
  return Math.max(...topics.map(topicId => topicWeakness(topicId, profile)));
}

function dominantSelectedTopicCount(question, selectedTopicCounts) {
  const topics = questionTopics(question);
  if (!topics.length) return 0;
  return Math.max(...topics.map(topicId => Number(selectedTopicCounts[topicId] || 0)));
}

function randomJitter() {
  return Math.random() * 1.15;
}

function questionScore(question, profile, config, selectedTopicCounts, selectedImageCount, selectedCount) {
  const qStats = profile.questionStats[String(question.id)] || null;
  let score = randomJitter();

  score += strongestTopicWeakness(question, profile) * config.adaptiveStrength * 2.2;

  if (!qStats) {
    score += 1.15 * config.noveltyStrength;
  } else {
    const wrongRatio = qStats.attempts ? qStats.wrong / qStats.attempts : 0;
    score += wrongRatio * config.adaptiveStrength * 1.7;
    score -= Math.min(1.6, qStats.attempts * 0.22) * config.noveltyStrength;
  }

  if (profile.recentQuestionIds.has(String(question.id))) {
    score -= config.recentPenalty;
  }

  const topicLoad = dominantSelectedTopicCount(question, selectedTopicCounts);
  score -= topicLoad * 0.42 * config.topicBalanceStrength;

  const wantsImage = selectedCount > 0
    ? selectedImageCount / selectedCount < config.imageTargetRatio
    : config.imageTargetRatio > 0;

  if (question.imageId && wantsImage) score += 0.35;
  if (!question.imageId && !wantsImage) score += 0.08;

  const difficulty = Number(question.difficulty || 2);
  if (difficulty === 2) score += 0.12;
  if (difficulty === 3 && config.count >= 20) score += 0.12;

  return score;
}

function selectQuestions(questionBank, results, mode = "quick") {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.quick;
  const eligible = safeArray(questionBank)
    .filter(question => question && question.id)
    .filter(question => String(question.category || "B") === "B")
    .filter(question => question.active !== false)
    .filter(question => question.usableForQuiz !== false)
    .filter(question => Array.isArray(question.answers) && question.answers.length >= 2)
    .filter(question => Number.isInteger(Number(question.correctAnswer)));

  if (eligible.length < config.count) {
    return {
      ok: false,
      required: config.count,
      available: eligible.length,
      mode,
      config,
      questions: []
    };
  }

  const profile = buildAdaptiveProfile(results);
  const selected = [];
  const selectedIds = new Set();
  const selectedTopicCounts = {};
  let selectedImageCount = 0;

  while (selected.length < config.count) {
    const candidates = eligible.filter(question => !selectedIds.has(String(question.id)));
    if (!candidates.length) break;

    let best = null;
    let bestScore = -Infinity;

    for (const question of candidates) {
      const score = questionScore(
        question,
        profile,
        config,
        selectedTopicCounts,
        selectedImageCount,
        selected.length
      );

      if (score > bestScore) {
        bestScore = score;
        best = question;
      }
    }

    if (!best) break;
    selected.push(best);
    selectedIds.add(String(best.id));
    if (best.imageId) selectedImageCount++;

    for (const topicId of questionTopics(best)) {
      selectedTopicCounts[topicId] = Number(selectedTopicCounts[topicId] || 0) + 1;
    }
  }

  // Randomize final order so even the same selected set does not appear in the same sequence.
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }

  return {
    ok: selected.length === config.count,
    required: config.count,
    available: eligible.length,
    mode,
    config,
    profile,
    questions: selected
  };
}

module.exports = {
  MODE_CONFIG,
  buildAdaptiveProfile,
  selectQuestions
};
