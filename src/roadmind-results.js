/* RoadMind real result layer — loaded after index.html */
(() => {
  const TOPIC_NAMES = {
    theme_01: 'Основни понятия',
    theme_02: 'Пътищата и улиците',
    theme_03: 'Другите участници в движението',
    theme_04: 'Регулиране на движението',
    theme_05: 'Положение на ППС върху пътя',
    theme_06: 'Скорост и дистанция',
    theme_07: 'Маневри',
    theme_08: 'Кръстовища и пътни възли',
    theme_09: 'Автомагистрала и скоростен път',
    theme_10: 'Спирки и жилищна зона',
    theme_11: 'Специални правила',
    theme_12: 'Престой и паркиране',
    theme_13: 'Неблагоприятни условия',
    theme_14: 'Организация на пътуването',
    theme_15: 'Психомоторни функции и бдителност',
    theme_16: 'Задължения на водача',
    theme_17: 'Административна отговорност',
    theme_18: 'Поведение при ПТП',
    theme_19: 'Устройство на МПС'
  };

  const TOPIC_COLORS = [
    'var(--blue)',
    'var(--cyan)',
    'var(--lime)',
    'var(--amber)',
    'var(--purple)',
    'var(--red)'
  ];

  let questionStartedAt = 0;
  let sessionStartedAt = 0;
  let resultSaving = false;

  const originalStartQuiz = startQuiz;
  const originalRenderQuestion = renderQuestion;

  startQuiz = function(label, mode) {
    sessionStartedAt = Date.now();
    questionStartedAt = Date.now();
    originalStartQuiz(label, mode);
  };

  renderQuestion = function() {
    questionStartedAt = Date.now();
    originalRenderQuestion();
  };

  pickAnswer = function(index) {
    if (quizState.answered) return;

    const question = quizQuestions[quizState.idx];
    if (!question) return;

    quizState.answered = true;

    const correct = Number(question.correctAnswer);
    const isCorrect = index === correct;
    const timeMs = Math.max(0, Date.now() - questionStartedAt);

    quizState.answers.push({
      questionId: question.id,
      selectedAnswer: index,
      correctAnswer: correct,
      isCorrect,
      timeMs,
      topicIds: Array.isArray(question.topicIds) ? question.topicIds : []
    });

    if (isCorrect) quizScore++;

    document
      .querySelectorAll('#quizAnswers .ans-card')
      .forEach((element, answerIndex) => {
        element.disabled = true;
        if (answerIndex === correct) {
          element.classList.add('correct');
        } else if (answerIndex === index) {
          element.classList.add('wrong');
        }
      });
  };

  function calculateLocalResult() {
    const total = quizQuestions.length;
    const correct = quizState.answers.filter(a => a.isCorrect).length;
    const wrong = total - correct;
    const durationMs = Math.max(0, Date.now() - sessionStartedAt);
    const answeredTimeMs = quizState.answers.reduce((sum, a) => sum + Number(a.timeMs || 0), 0);
    const averageTimeMs = quizState.answers.length
      ? Math.round(answeredTimeMs / quizState.answers.length)
      : 0;

    const topicResults = {};

    for (const answer of quizState.answers) {
      const topicIds = Array.isArray(answer.topicIds) ? answer.topicIds : [];

      for (const topicId of topicIds) {
        if (!topicResults[topicId]) {
          topicResults[topicId] = { correct: 0, wrong: 0, total: 0, percentage: 0 };
        }

        topicResults[topicId].total++;
        if (answer.isCorrect) topicResults[topicId].correct++;
        else topicResults[topicId].wrong++;
      }
    }

    for (const value of Object.values(topicResults)) {
      value.percentage = value.total
        ? Math.round((value.correct / value.total) * 100)
        : 0;
    }

    return {
      testId: demoTest?.id || 'demo_test_001',
      score: correct,
      correct,
      wrong,
      total,
      percentage: total ? Math.round((correct / total) * 100) : 0,
      durationMs,
      averageTimeMs,
      topicResults,
      answers: quizState.answers.map(a => ({
        questionId: a.questionId,
        selectedAnswer: a.selectedAnswer,
        timeMs: a.timeMs
      }))
    };
  }

  function formatSeconds(ms) {
    if (!ms) return '0.0с';
    return (ms / 1000).toFixed(1) + 'с';
  }

  function renderTopicResults(topicResults) {
    const container = document.getElementById('resultTopics');
    if (!container) return;

    const entries = Object.entries(topicResults || {});

    if (!entries.length) {
      container.innerHTML = '<p class="muted">Няма данни по теми.</p>';
      return;
    }

    container.innerHTML = entries.map(([topicId, result], index) => {
      const pct = Number(result.percentage || 0);
      const name = TOPIC_NAMES[topicId] || topicId;
      const color = TOPIC_COLORS[index % TOPIC_COLORS.length];

      return `
        <div class="topic-row">
          <span class="topic-name">${escapeHtml(name)}</span>
          <div class="topic-bar-track">
            <div class="topic-bar-fill" style="width:${pct}%;background:${color};"></div>
          </div>
          <span class="topic-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  function buildAnalysis(result) {
    const entries = Object.entries(result.topicResults || {});

    if (!entries.length) {
      return 'Тестът е завършен. След още решени листовки ще можем да покажем по-подробен анализ.';
    }

    const sorted = entries.slice().sort((a, b) => a[1].percentage - b[1].percentage);
    const weakest = sorted[0];
    const strongest = sorted[sorted.length - 1];

    if (result.percentage === 100) {
      return `Отличен резултат — ${result.correct} от ${result.total} верни отговора. Всички проверени теми в тази листовка са решени без грешка.`;
    }

    const weakName = TOPIC_NAMES[weakest[0]] || weakest[0];
    const strongName = TOPIC_NAMES[strongest[0]] || strongest[0];

    return `Общ резултат: ${result.percentage}%. Най-силно представяне: „${strongName}“ (${strongest[1].percentage}%). Най-много внимание изисква „${weakName}“ (${weakest[1].percentage}%).`;
  }

  function renderResult(result, saved) {
    const scoreElement = document.querySelector('#view-result .result-score');
    const correctElement = document.querySelector('#view-result .result-grid .stat-box:nth-child(1) .stat-num');
    const wrongElement = document.querySelector('#view-result .result-grid .stat-box:nth-child(2) .stat-num');
    const timeElement = document.querySelector('#view-result .result-grid .stat-box:nth-child(3) .stat-num');
    const badge = document.querySelector('#view-result .result-hero > .pill');
    const analysisCard = document.querySelector('#view-result .card[style*="--purple"]');

    if (scoreElement) {
      scoreElement.innerHTML = `${result.correct}<span class="result-outof"> / ${result.total}</span>`;
    }
    if (correctElement) correctElement.textContent = result.correct;
    if (wrongElement) wrongElement.textContent = result.wrong;
    if (timeElement) timeElement.textContent = formatSeconds(result.averageTimeMs);

    if (badge) {
      badge.textContent = result.percentage >= 70 ? 'ДЕМО РЕЗУЛТАТ' : 'ТРЯБВА ОЩЕ ТРЕНИРОВКА';
      badge.className = result.percentage >= 70 ? 'pill pill-green mb' : 'pill pill-amber mb';
      badge.style.margin = '0 auto 10px';
      badge.style.width = 'fit-content';
    }

    renderTopicResults(result.topicResults);

    if (analysisCard) {
      const label = analysisCard.querySelector('.pill');
      const text = analysisCard.querySelector('p:last-child');
      if (label) label.textContent = 'АНАЛИЗ НА РЕЗУЛТАТА';
      if (text) text.textContent = buildAnalysis(result);
    }

    if (saved === true) {
      toast('Резултатът е записан във Firestore.');
    }
  }

  async function saveResult(localResult) {
    if (resultSaving) return null;
    resultSaving = true;

    try {
      const response = await fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testId: localResult.testId,
          mode: quizMode || 'demo',
          answers: localResult.answers,
          durationMs: localResult.durationMs
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Result API error');
      }

      return data.result || null;
    } catch (error) {
      console.error('Result save failed:', error);
      toast('Резултатът се показа, но не беше записан.');
      return null;
    } finally {
      resultSaving = false;
    }
  }

  showQuizResult = function() {
    const localResult = calculateLocalResult();

    renderResult(localResult, false);
    go('result');

    saveResult(localResult).then(serverResult => {
      if (serverResult) {
        renderResult(serverResult, true);
      }
    });
  };
})();
