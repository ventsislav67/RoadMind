/* RoadMind real dashboard layer — reads aggregated stats from Firestore through the local API */
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
    'var(--red)',
    'var(--amber)',
    'var(--cyan)',
    'var(--blue)'
  ];

  let lastDashboard = null;
  let loadingDashboard = false;

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

  function renderReadyScore(data) {
    const score = Number(data.readyScore || 0);
    const ring = document.getElementById('readyRing');
    const num = document.getElementById('readyNum');
    const verdict = document.querySelector('#view-dashboard .score-verdict');
    const desc = document.querySelector('#view-dashboard .score-desc');

    if (ring) {
      const circumference = 402;
      const offset = circumference - (score / 100) * circumference;
      ring.style.strokeDashoffset = offset;
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

    const pts = values.map((value, index) => {
      const x = values.length === 1
        ? w / 2
        : pad + index * ((w - pad * 2) / (values.length - 1));
      const y = h - pad - (value / 100) * (h - pad * 2);
      return [x, y];
    });

    const path = pts.map((point, index) =>
      (index === 0 ? 'M' : 'L') + point[0] + ',' + point[1]
    ).join(' ');

    svg.innerHTML = `
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${pts.map((point, index) => `
        <circle cx="${point[0]}" cy="${point[1]}" r="4.5" fill="var(--surface)" stroke="${color}" stroke-width="2.5" />
        <text x="${point[0]}" y="${Math.max(14, point[1] - 13)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${values[index]}%</text>
      `).join('')}
    `;
  }

  function drawRealProgress(data) {
    drawProgressInto('progressSvg', data, 'var(--blue)');
    drawProgressInto('analysisSvg', data, 'var(--purple)');
  }

  async function refreshDashboard() {
    if (loadingDashboard) return;
    loadingDashboard = true;

    try {
      const response = await fetch('/api/dashboard?userId=demo_user', {
        headers: { 'Accept': 'application/json' }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Dashboard API error');
      }

      lastDashboard = data;
      renderReadyScore(data);
      renderWeakTopics(data);
      renderSummaryStats(data);
      renderHistory(data);
      drawRealProgress(data);
    } catch (error) {
      console.error('Dashboard load failed:', error);
    } finally {
      loadingDashboard = false;
    }
  }

  const originalGo = go;
  go = function(name) {
    originalGo(name);
    if (name === 'dashboard' || name === 'analysis') {
      setTimeout(refreshDashboard, 0);
    }
  };

  window.refreshRoadMindDashboard = refreshDashboard;

  document.addEventListener('DOMContentLoaded', refreshDashboard);
  setTimeout(refreshDashboard, 0);
})();
