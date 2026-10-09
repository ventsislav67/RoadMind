/* RoadMind smart randomized/adaptive quiz loader */
(() => {
  const MODE_TITLES = {
    demo: 'Кратка листовка',
    quick: 'Бърз тест',
    full: 'Пълен тест',
    exam: 'Демо изпит',
    ai: 'AI тренировка'
  };

  async function fetchSmartQuiz(mode) {
    const safeMode = MODE_TITLES[mode] ? mode : 'quick';
    const response = await fetch(`/api/quiz?mode=${encodeURIComponent(safeMode)}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    let data = {};
    try { data = await response.json(); } catch (_) {}

    if (!response.ok) {
      const error = new Error(data.error || 'Неуспешно генериране на теста.');
      error.available = data.available;
      error.required = data.required;
      throw error;
    }

    if (!data || !data.test || !Array.isArray(data.questions) || !data.questions.length) {
      throw new Error('Сървърът не върна валиден генериран тест.');
    }

    return data;
  }

  const originalStartQuiz = startQuiz;
  startQuiz = function(label, mode) {
    originalStartQuiz(label, mode);
    const title = document.getElementById('quizTitle');
    if (title) title.textContent = MODE_TITLES[mode] || label || 'Листовка';
  };

  loadAndStartQuiz = async function(label, mode) {
    if (quizLoading) return;
    quizLoading = true;

    try {
      const data = await fetchSmartQuiz(mode);
      demoTest = data.test;
      quizQuestions = data.questions;
      quizScore = 0;
      startQuiz(label, mode);
    } catch (error) {
      console.error('Smart quiz load failed:', error);
      let message = error.message || 'Грешка при генериране на теста.';
      if (Number.isFinite(error.available) && Number.isFinite(error.required)) {
        message += ` Налични: ${error.available}, нужни: ${error.required}.`;
      }
      setLoadingError(message);
    } finally {
      quizLoading = false;
    }
  };

  window.fetchRoadMindSmartQuiz = fetchSmartQuiz;
})();
