/* RoadMind real dashboard + achievements layer */
(() => {
  const CACHE_KEY = 'roadmind_dashboard_cache_v3';

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
    'var(--red)',
    'var(--amber)',
    'var(--cyan)',
    'var(--blue)'
  ];

  let loadingDashboard = false;
  let latestDashboardData = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function formatSeconds(ms) {
    const value = Number(ms || 0);
    if (!value) return '—';
    return (value / 1000).toFixed(1) + 'с';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('bg-BG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function readCache() {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeCache(data) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function readinessText(score, attempts) {
    if (!attempts) {
      return {
        title: 'Започни с първата си листовка',
        text: 'Ready Score ще се изчислява от реалните ти резултати.'
      };
    }
    if (score >= 90) {
      return {
        title: 'Много висока готовност',
        text: 'Поддържаш отлични резултати. Продължи с пълни тестове и преговор на грешките.'
      };
    }
    if (score >= 75) {
      return {
        title: 'Добра готовност',
        text: 'Резултатите са стабилни. Фокусирай се върху най-слабите теми преди изпита.'
      };
    }
    if (score >= 60) {
      return {
        title: 'Напредваш добре',
        text: 'Има добра основа, но още са нужни упражнения по слабите теми.'
      };
    }
    return {
      title: 'Нужна е още подготовка',
      text: 'Продължи с кратки листовки и преговаряй темите с най-нисък резултат.'
    };
  }

  function renderLoadingState() {
    const stats = document.querySelector('#view-dashboard .chart-wrap .chart-stats');
    if (stats) {
      stats.innerHTML = [
        'РЕШЕНИ ВЪПРОСИ',
        'ПРАВИЛНИ ОТГОВОРИ',
        'СР. ВРЕМЕ / ВЪПРОС',
        'ДНИ ПОРЕД'
      ].map(label => `
        <div class="stat-box">
          <div class="stat-num" style="color:var(--text-faint);">—</div>
          <div class="stat-label">${label}</div>
        </div>
      `).join('');
    }

    const num = document.getElementById('readyNum');
    if (num) num.textContent = '—';

    const ring = document.getElementById('readyRing');
    if (ring) ring.style.strokeDashoffset = 402;

    const verdict = document.querySelector('#view-dashboard .score-verdict');
    const desc = document.querySelector('#view-dashboard .score-desc');
    if (verdict) verdict.textContent = 'Зареждаме реалните ти данни…';
    if (desc) desc.textContent = 'Статистиките се синхронизират с Firestore.';

    const achGrid = document.getElementById('achGrid');
    if (achGrid) {
      achGrid.innerHTML = '<div class="card ach-card"><div class="ach-emoji">⏳</div><div class="ach-name">Зареждане…</div></div>';
    }

    const gami = document.querySelector('#view-achievements .gami-row');
    if (gami) {
      gami.innerHTML = `
        <div class="gami-chip pill-amber">🔥 — дни</div>
        <div class="gami-chip pill-blue">⭐ Level —</div>
        <div class="gami-chip pill-purple">⚡ — XP</div>
      `;
    }
  }

  function renderReadyScore(data) {
    const score = Number(data.readyScore || 0);
    const ring = document.getElementById('readyRing');
    const num = document.getElementById('readyNum');
    const verdict = document.querySelector('#view-dashboard .score-verdict');
    const desc = document.querySelector('#view-dashboard .score-desc');

    if (ring) {
      const circumference = 402;
      ring.style.strokeDashoffset = circumference - (score / 100) * circumference;
    }
    if (num) num.textContent = score + '%';

    const copy = readinessText(score, Number(data.totalAttempts || 0));
    if (verdict) verdict.textContent = copy.title;
    if (desc) {
      desc.textContent = copy.text + (data.totalAttempts
        ? ` Ready Score е средният резултат от последните ${Math.min(10, data.totalAttempts)} теста.`
        : '');
    }
  }

  function renderMainProgressStats(data) {
    const container = document.querySelector('#view-dashboard .chart-wrap .chart-stats');
    if (!container) return;

    container.innerHTML = `
      <div class="stat-box">
        <div class="stat-num">${Number(data.totalAnsweredQuestions || 0)}</div>
        <div class="stat-label">РЕШЕНИ ВЪПРОСИ</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${Number(data.overallAccuracy || 0)}%</div>
        <div class="stat-label">ПРАВИЛНИ ОТГОВОРИ</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${formatSeconds(data.averageAnswerTimeMs)}</div>
        <div class="stat-label">СР. ВРЕМЕ / ВЪПРОС</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">🔥 ${Number(data.streakDays || 0)}</div>
        <div class="stat-label">ДНИ ПОРЕД</div>
      </div>
    `;
  }

  function renderWeakTopics(data) {
    const allTopics = Array.isArray(data.weakTopics) ? data.weakTopics : [];
    const topics = allTopics.filter(topic => Number(topic.percentage || 0) < 100);

    ['weakTopicsCard', 'weakTopicsCard2'].forEach(containerId => {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (!allTopics.length) {
        container.innerHTML = '<p class="muted" style="padding:12px 4px;">Няма достатъчно реални резултати по теми.</p>';
        return;
      }

      if (!topics.length) {
        container.innerHTML = '<p style="padding:12px 4px;font-weight:700;color:var(--lime-ink);">✅ Няма открити слаби теми в решените тестове.</p>';
        return;
      }

      container.innerHTML = topics.map((topic, index) => {
        const name = TOPIC_NAMES[topic.topicId] || topic.topicId;
        const pct = Number(topic.percentage || 0);
        const color = TOPIC_COLORS[index % TOPIC_COLORS.length];

        return `
          <div class="topic-row">
            <span class="topic-name">${esc(name)}</span>
            <div class="topic-bar-track">
              <div class="topic-bar-fill" style="width:${pct}%;background:${color};"></div>
            </div>
            <span class="topic-pct">${pct}%</span>
            <span class="topic-btn" onclick="toast('Тренировка по «${esc(name)}» ще използва тази тема')">Тренирай</span>
          </div>
        `;
      }).join('');
    });
  }

  function ensureHistorySection() {
    const dashboard = document.getElementById('view-dashboard');
    if (!dashboard) return null;

    let section = document.getElementById('realHistorySection');
    if (section) return section;

    section = document.createElement('div');
    section.id = 'realHistorySection';
    section.innerHTML = `
      <div class="section-head">
        <h2>История на резултатите</h2>
        <span class="link">Реални данни от Firestore</span>
      </div>
      <div class="chart-stats" id="realDashboardStats"></div>
      <div class="card" style="padding:8px 20px;" id="realResultHistory"></div>
    `;

    dashboard.appendChild(section);
    return section;
  }

  function renderSummaryStats(data) {
    ensureHistorySection();
    const container = document.getElementById('realDashboardStats');
    if (!container) return;

    container.innerHTML = `
      <div class="stat-box">
        <div class="stat-num">${Number(data.totalAttempts || 0)}</div>
        <div class="stat-label">РЕШЕНИ ТЕСТОВЕ</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${Number(data.averagePercentage || 0)}%</div>
        <div class="stat-label">СРЕДЕН РЕЗУЛТАТ</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${Number(data.bestPercentage || 0)}%</div>
        <div class="stat-label">НАЙ-ДОБЪР РЕЗУЛТАТ</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${formatSeconds(data.averageAnswerTimeMs)}</div>
        <div class="stat-label">СР. ВРЕМЕ / ВЪПРОС</div>
      </div>
    `;
  }

  function renderHistory(data) {
    ensureHistorySection();
    const container = document.getElementById('realResultHistory');
    if (!container) return;

    const history = Array.isArray(data.history) ? data.history : [];
    if (!history.length) {
      container.innerHTML = '<p class="muted" style="padding:12px 4px;">Все още няма записани тестове.</p>';
      return;
    }

    container.innerHTML = history.map(item => {
      const passed = Number(item.percentage || 0) >= 70;
      return `
        <div class="topic-row" style="align-items:center;">
          <div style="min-width:0;flex:1;">
            <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${esc(item.testTitle || 'Листовка')}
            </div>
            <div class="muted" style="font-size:12px;margin-top:2px;">
              ${esc(formatDate(item.createdAt))} · ${item.correct}/${item.total} верни · ${formatSeconds(item.averageTimeMs)} средно
            </div>
          </div>
          <span class="pill ${passed ? 'pill-green' : 'pill-amber'}">${Number(item.percentage || 0)}%</span>
        </div>
      `;
    }).join('');
  }

  function calculateGamification(data) {
    const totalAttempts = Number(data.totalAttempts || 0);
    const totalCorrect = Number(data.totalCorrectAnswers || 0);
    const streak = Number(data.streakDays || 0);
    const history = Array.isArray(data.history) ? data.history : [];

    const xp = totalCorrect * 10 + totalAttempts * 20 + streak * 25;
    const level = Math.max(1, Math.floor(xp / 250) + 1);

    const firstDemoExam = history.some(item => item.mode === 'exam');
    const perfectExam = history.some(item => item.mode === 'exam' && Number(item.percentage || 0) === 100);
    const tenCorrectRun = history.some(item => Number(item.total || 0) >= 10 && Number(item.wrong || 0) === 0);

    return {
      xp,
      level,
      achievements: [
        { e: '🏆', n: 'Първи тест', unlocked: totalAttempts >= 1, progress: `${Math.min(totalAttempts, 1)}/1` },
        { e: '🎯', n: '10 правилни поред', unlocked: tenCorrectRun, progress: tenCorrectRun ? '10/10' : `${Math.min(totalCorrect, 9)}/10` },
        { e: '🔥', n: '7-дневен streak', unlocked: streak >= 7, progress: `${Math.min(streak, 7)}/7 дни` },
        { e: '🚗', n: 'Първи демо изпит', unlocked: firstDemoExam, progress: firstDemoExam ? 'Готово' : '0/1' },
        { e: '📚', n: '50 листовки', unlocked: totalAttempts >= 50, progress: `${Math.min(totalAttempts, 50)}/50` },
        { e: '🧠', n: 'AI майстор', unlocked: false, progress: 'След AI Tutor' },
        { e: '⭐', n: 'Level 20', unlocked: level >= 20, progress: `Level ${level}/20` },
        { e: '💯', n: '100% на изпит', unlocked: perfectExam, progress: perfectExam ? 'Готово' : '0/1' }
      ]
    };
  }

  function renderAchievements(data) {
    const gami = document.querySelector('#view-achievements .gami-row');
    const grid = document.getElementById('achGrid');
    if (!gami || !grid) return;

    const game = calculateGamification(data);

    gami.innerHTML = `
      <div class="gami-chip pill-amber">🔥 ${Number(data.streakDays || 0)} дни поред</div>
      <div class="gami-chip pill-blue">⭐ Level ${game.level}</div>
      <div class="gami-chip pill-purple">⚡ ${game.xp.toLocaleString('bg-BG')} XP</div>
    `;

    grid.innerHTML = game.achievements.map(a => `
      <div class="card ach-card ${a.unlocked ? '' : 'ach-locked'}" title="${esc(a.progress)}">
        <div class="ach-emoji">${a.e}</div>
        <div class="ach-name">${esc(a.n)}</div>
        <div style="font-size:11px;color:var(--text-faint);margin-top:5px;font-weight:700;">${esc(a.progress)}</div>
      </div>
    `).join('');
  }

  function drawProgressInto(svgId, data, color) {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    const progression = Array.isArray(data.progression) ? data.progression : [];
    const values = progression.map(item => Number(item.percentage || 0));

    if (!values.length) {
      svg.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="var(--text-faint)" font-size="14">Реши тест, за да се появи прогрес.</text>';
      return;
    }

    const w = 560;
    const h = svgId === 'analysisSvg' ? 170 : 160;
    const pad = 24;

    const points = values.map((value, index) => {
      const x = values.length === 1
        ? w / 2
        : pad + index * ((w - pad * 2) / (values.length - 1));
      const y = h - pad - (value / 100) * (h - pad * 2);
      return [x, y];
    });

    const path = points.map((point, index) =>
      (index === 0 ? 'M' : 'L') + point[0] + ',' + point[1]
    ).join(' ');

    svg.innerHTML = `
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${points.map((point, index) => `
        <circle cx="${point[0]}" cy="${point[1]}" r="4.5" fill="var(--surface)" stroke="${color}" stroke-width="2.5" />
        <text x="${point[0]}" y="${Math.max(14, point[1] - 13)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${values[index]}%</text>
      `).join('')}
    `;
  }

  function drawRealProgress(data) {
    drawProgressInto('progressSvg', data, 'var(--blue)');
    drawProgressInto('analysisSvg', data, 'var(--purple)');
  }

  function renderAll(data) {
    if (!data) return;
    latestDashboardData = data;
    renderReadyScore(data);
    renderMainProgressStats(data);
    renderWeakTopics(data);
    renderSummaryStats(data);
    renderHistory(data);
    renderAchievements(data);
    drawRealProgress(data);
  }

  async function refreshDashboard() {
    if (loadingDashboard) return;
    loadingDashboard = true;

    try {
      const response = await fetch('/api/dashboard?userId=demo_user', {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Dashboard API error');

      writeCache(data);
      renderAll(data);
    } catch (error) {
      console.error('Dashboard load failed:', error);
    } finally {
      loadingDashboard = false;
    }
  }

  const cached = readCache();
  if (cached) {
    renderAll(cached);
  } else {
    renderLoadingState();
  }

  /* Protect the real Ready Score from the old demo animation while it finishes. */
  const readyGuard = setInterval(() => {
    if (latestDashboardData) renderReadyScore(latestDashboardData);
    else {
      const num = document.getElementById('readyNum');
      if (num) num.textContent = '—';
    }
  }, 50);
  setTimeout(() => clearInterval(readyGuard), 1700);

  const originalGo = go;
  go = function(name) {
    originalGo(name);
    if (name === 'dashboard' || name === 'analysis' || name === 'achievements') {
      if (latestDashboardData) renderAll(latestDashboardData);
      setTimeout(refreshDashboard, 0);
    }
  };

  window.refreshRoadMindDashboard = refreshDashboard;
  document.addEventListener('DOMContentLoaded', refreshDashboard);
  setTimeout(refreshDashboard, 0);
})();
