(async function () {
  'use strict';
  const curriculum = window.CALCULUS_CURRICULUM;
  const account = await CalculusAccounts.open(curriculum, CalculusEngine);
  const engine = account.engine;
  const ranks = curriculum.ranks;
  const lessons = engine.getLessons();
  const app = document.getElementById('app');
  const dialog = document.getElementById('dialog');
  let view = 'map';
  let selectedRank = engine.getRankIndex();
  let session = null;
  let search = '';
  let labMode = 'derivative';
  let labX = 1;
  let toastTimer;
  let students = [], studentOffset = 0, studentsLoading = false, studentsError = '';
  const names = { map: '闯关地图', handbook: '知识手册', mistakes: '错题回顾', profile: '学习档案', students: '学生进度', lesson: '关卡学习', quiz: '正在挑战', result: '挑战结算' };
  const paths = {
    map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16M15 5v16"/>',
    book:'<path d="M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1Zm0 0v16"/>',
    review:'<path d="M8 3H5a2 2 0 0 0-2 2v15l4-2 4 2 4-2 4 2V9"/><path d="m14 3 7 7M14 10l7-7M7 8h3M7 12h6"/>',
    chart:'<path d="M4 3v17h17M8 15v-4M13 15V7M18 15v-7"/>',
    arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    back:'<path d="M20 12H5m5-5-5 5 5 5"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    medal:'<circle cx="12" cy="9" r="6"/><path d="m8 14-2 7 6-3 6 3-2-7m-4-10 1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 10l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4Z"/>',
    flag:'<path d="M5 22V3c5-4 9 4 15 0v11c-6 4-10-4-15 0"/>',
    fire:'<path d="M12 2c2 6 7 7 7 13a7 7 0 0 1-14 0c0-3 2-6 4-8 0 3 1 4 2 4 2-2 2-5 1-9Z"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2M12 16h.01"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M7 14h2M14 14h2"/>',
    bulb:'<path d="M8 17c0-4-3-4-3-8a7 7 0 0 1 14 0c0 4-3 4-3 8Zm0 3h8m-6 3h4M10 8l2 3 2-3m-2 3v6"/>',
    leaf:'<path d="M20 3c-7-1-16 2-16 9a7 7 0 0 0 12 5c4-4 4-9 4-14ZM3 22 15 10"/>',
    target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
    search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    x:'<path d="m6 6 12 12M6 18 18 6"/>',
    shield:'<path d="m12 2 9 4v6c0 5-6 8-9 10-3-2-9-5-9-10V6Zm-4 9 3 3 5-6"/>',
    sparkle:'<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3ZM20 2v4M18 4h4"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.sparkle}</svg>`;
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const completed = id => (engine.state.completed[id]?.stars || 0) > 0;
  const starText = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  const questionEntry = id => {
    for (const lesson of lessons) { const question = lesson.questions.find(q => q.id === id); if (question) return { lesson, question }; }
    return null;
  };
  const medal = (index, extra = '') => {
    const colors = [['#d6b08a','#a9774c','#f5e1c8'],['#cbd7df','#889eae','#eff5f7'],['#e8cb83','#b79747','#fff1c2'],['#afd9cb','#6ba693','#e4f7ed'],['#b3cddd','#6793b2','#e9f6ff'],['#c9bce2','#9580b4','#f1e9ff'],['#e4cd8a','#a99143','#fff4ce']][index];
    return `<svg class="rank-emblem ${extra}" viewBox="0 0 70 78" aria-hidden="true"><path d="M16 49 10 74l25-12 25 12-6-25" fill="${colors[1]}" opacity=".75"/><path d="M35 3 61 17v31L35 66 9 48V17Z" fill="${colors[0]}" stroke="${colors[1]}" stroke-width="2"/><path d="m35 10 20 11v23L35 58 15 44V21Z" fill="none" stroke="${colors[2]}" stroke-width="1.5"/><path d="${index === 6 ? 'M22 27l7 7 6-12 6 12 7-7-3 19H25Z' : index === 4 ? 'm23 29 7-7h10l7 7-12 20Zm0 0h24m-17-7 5 27 5-27' : 'm35 22 4 9 10 1-8 7 2 10-8-5-8 5 2-10-8-7 10-1Z'}" fill="${colors[2]}" stroke="${colors[1]}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  };
  function heroArt() {
    return `<svg viewBox="0 0 450 280" aria-hidden="true"><defs><pattern id="hero-grid" width="29" height="29" patternUnits="userSpaceOnUse"><path d="M29 0H0V29" fill="none" stroke="#82b497" stroke-width=".5" opacity=".13"/></pattern><linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#badb82" stop-opacity=".24"/><stop offset="1" stop-color="#badb82" stop-opacity="0"/></linearGradient></defs><path d="M0 0h450v280H0z" fill="url(#hero-grid)"/><path d="M58 221h350M100 252V28" stroke="#82ac8e" opacity=".25"/><path d="m403 217 6 4-6 4m-307-192 4-6 4 6" fill="none" stroke="#82ac8e" opacity=".4"/><path d="M99 220c57 0 73-6 109-39S276 63 341 57v164Z" fill="url(#hero-fill)"/><path d="M64 220c78 8 103-2 143-39S270 65 341 57" stroke="#bcdf8b" stroke-width="2.7" fill="none"/><path d="m170 218 163-154" stroke="#82b69a" stroke-dasharray="5 6" stroke-width="1.2"/><circle cx="248" cy="135" r="5" fill="#dafaad"/><circle cx="248" cy="135" r="10" fill="none" stroke="#dafaad" opacity=".2"/><path d="M248 135v86" stroke="#b1d298" stroke-dasharray="3 5" opacity=".35"/><text x="126" y="66" fill="#a5c59b" font-size="21" font-family="Georgia" font-style="italic" opacity=".7">f ′(x)</text><text x="356" y="94" fill="#8db796" font-size="27" font-family="Georgia" opacity=".7">∫</text><text x="225" y="248" fill="#92b39a" font-size="12" font-family="Georgia" font-style="italic" opacity=".45">a little progress, every day.</text><g transform="translate(285 97) rotate(9)"><path d="M0 0 44-15 81 7 75 61 32 87-7 57Z" fill="#315441" stroke="#d4e7a8" stroke-width="1.3"/><path d="m7 7 36-13 29 18-6 44-33 21L2 53Z" fill="#496748" stroke="#a5bf7d" stroke-width=".8"/><path d="m36 10 8 18 19 3-14 14 2 20-18-10-18 7 5-20L7 27l21-1Z" fill="#d6e9a7"/><path d="m36 10-3 45 16-10Z" fill="#aec77d"/></g><circle cx="179" cy="103" r="2" fill="#b0d383" opacity=".7"/><path d="M382 168v10m-5-5h10M212 51v8m-4-4h8" stroke="#a3c288" opacity=".7"/></svg>`;
  }
  function render() {
    const stats = engine.getStats();
    const rank = ranks[engine.getRankIndex()];
    const navView = ['lesson','quiz','result'].includes(view) ? (session?.review ? 'mistakes' : 'map') : view;
    app.innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-symbol">∫</div><div class="brand-text"><div class="brand-name">微积分晋级</div><small>CALCULUS QUEST</small></div></div><div class="nav-label">学习空间 / WORKSPACE</div><nav class="nav" aria-label="主导航">${[['map','map'],['handbook','book'],['mistakes','review'],['profile','chart']].concat(account.teacher?[['students','book']]:[]).map(([id, symbol]) => `<button data-action="nav" data-view="${id}" class="${navView === id ? 'active' : ''}" ${navView === id ? 'aria-current="page"' : ''} title="${names[id]}">${icon(symbol)}<span class="nav-text">${names[id]}</span>${id === 'mistakes' && stats.mistakes ? `<span class="badge-count">${stats.mistakes}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-note"><div class="note-top">${icon('leaf')}每天一点，进步无限</div><p>今日学习目标：完成 4 道题<br>已完成 ${Math.min(stats.todayAnswered,4)} / 4 题${stats.todayAnswered >= 4 ? ' · 已达成' : ''}</p><div class="mini-progress"><span style="width:${Math.min(stats.todayAnswered/4*100,100)}%"></span></div></div><div class="sidebar-footer"><i></i>${account.mode==='cloud'?'学习进度按账号保存':engine.storageAvailable ? '进度自动保存在此浏览器' : '当前为临时学习，请允许本地存储'}</div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs">学习空间 ${icon('chevron')}<span class="current">${names[view]}</span></div><div class="mobile-brand"><span>∫</span>微积分晋级</div><div class="topbar-right">${account.mode==='cloud'?'<button class="quiet-button" data-action="signout">退出登录</button>':''}<button class="quiet-button" data-action="help">${icon('help')}玩法说明</button><span class="topbar-divider"></span><div class="user-mini"><div class="avatar">学</div><div>${account.user?escape(account.user.user_metadata?.display_name||'学习者'):'微积分探索者'}<small>${rank.name}段位 · ${stats.xp} XP</small></div></div></div></header><main class="main screen-enter" id="main" tabindex="-1">${saveBar()}${renderView()}</main></div></div>`;
    if (view === 'handbook') updateLab();
  }
  function renderView() {
    if (view === 'map') return renderMap();
    if (view === 'handbook') return renderHandbook();
    if (view === 'mistakes') return renderMistakes();
    if (view === 'profile') return renderProfile();
    if (view === 'students' && account.teacher) return renderStudents();
    if (view === 'lesson') return renderIntro();
    if (view === 'quiz') return renderQuiz();
    if (view === 'result') return renderResult();
    return '';
  }
  function saveBar() {
    if(account.mode==='cloud')return cloudSaveBar();
    const pending=engine.getSession();
    const saved=engine.state.savedAt;
    const time=saved ? new Date(saved).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : '';
    const description=pending ? `${pending.review ? '错题复习' : lessons.find(l=>l.id===pending.lessonId).title} · ${pending.view==='lesson' ? '知识学习中' : `第 ${pending.index+1} / ${pending.questionIds.length} 题${pending.answers[pending.index] ? ' · 已作答' : ''}`}` : '关卡成绩、段位和错题都会自动保存';
    return `<section class="save-bar ${engine.storageAvailable ? '' : 'save-warning'}" aria-label="进度管理"><div class="save-info">${icon(engine.storageAvailable?'shield':'help')}<div><strong>${engine.storageAvailable ? saved ? `进度已保存 · ${time}` : '自动保存已开启' : '未能保存到浏览器'}</strong><span>${engine.storageAvailable ? description : '当前记录仅在本页内存中，请允许浏览器保存本地数据后重试。'}</span></div></div><div class="save-actions">${pending && !['quiz','lesson'].includes(view) ? `<button class="secondary" data-action="resume">继续上次</button>` : ''}<button class="secondary" data-action="save">${icon('save')}保存进度</button><button class="clear-progress" data-action="reset">${icon('trash')}清除进度</button></div></section>`;
  }
  function cloudSaveBar(){
    const state=account.status;
    const labels={loading:'正在读取云端进度',synced:state.lastSyncedAt?'进度已保存到账号':'账号已连接 · 自动保存已开启',pending:'有新进度，等待同步',syncing:'正在保存到账号…',error:state.cacheAvailable?'已保存在本机，云端同步待重试':'云端和本机均未保存，请保留此页面',conflict:'检测到其他设备的新进度'};
    const note=state.status==='conflict'?'为避免覆盖另一台设备的记录，请选择要保留的版本。':state.status==='error'?state.message:state.lastSyncedAt?`最近同步 ${new Date(state.lastSyncedAt).toLocaleString('zh-CN',{hour12:false})}`:'同一账号登录后，可恢复段位、关卡和当前题目。';
    const pending=engine.getSession();
    return `<section class="save-bar ${['error','conflict'].includes(state.status)?'save-warning':''}" aria-label="进度管理"><div class="save-info">${icon('shield')}<div><strong>${labels[state.status]||'正在连接账号'}</strong><span>${escape(note)}</span></div></div><div class="save-actions">${pending&&!['lesson','quiz'].includes(view)?'<button class="secondary" data-action="resume">继续上次</button>':''}${state.status==='conflict'?'<button class="secondary" data-action="sync-conflict">处理同步冲突</button>':'<button class="secondary" data-action="save">保存进度</button>'}<button class="clear-progress" data-action="reset">清除进度</button></div></section>`;
  }
  function hydrateSession(snapshot) {
    if(!snapshot)return null;
    return {lesson:snapshot.review ? null : lessons.find(l=>l.id===snapshot.lessonId),review:snapshot.review,entries:snapshot.questionIds.map(questionEntry),index:snapshot.index,selected:snapshot.selected,answers:snapshot.answers,hint:snapshot.hint};
  }
  function persistSession() {
    if(session && ['lesson','quiz'].includes(view))return engine.saveSession({review:session.review,lessonId:session.review?null:session.lesson.id,questionIds:session.entries.map(e=>e.question.id),index:session.index,selected:session.selected,answers:session.answers,hint:session.hint,view});
    return engine.save();
  }
  function resumeSession() {
    const pending=engine.getSession();
    if(!pending){openLesson(engine.getNextLesson().id);return;}
    session=hydrateSession(pending);view=pending.view;render();window.scrollTo({top:0,behavior:'instant'});
  }
  function beginNewSession(start) {
    if(engine.getSession())confirmDialog('开始新的练习？','新的练习会替换尚未完成的续答记录。已获得的经验、关卡成绩和错题会保留。','开始新练习',start);
    else start();
  }
  function footer() { return '<footer class="page-footer"><span>每一步，都更接近答案。 EVERY STEP COUNTS.</span><span>理解 · 练习 · 突破</span></footer>'; }
  function renderMap() {
    const stats = engine.getStats();
    const index = engine.getRankIndex();
    const activeRank = ranks[index];
    const rank = ranks[selectedRank];
    const next = engine.getNextLesson();
    const pending = engine.getSession();
    const done = stats.completed === stats.total;
    const rankCompleted = rank.lessons.filter(l => completed(l.id)).length;
    return `<div class="page-heading"><div><div class="eyebrow">YOUR JOURNEY TO MASTERY</div><h1>每一次思考，都是一次进阶。</h1><p>从第一个极限开始，探索微积分的无限可能。</p></div><div class="date-pill">${icon('calendar')}自主探索 · 循序渐进</div></div><section class="hero"><div class="hero-copy"><div class="hero-tag"><span></span> 微积分冒险，现已开启</div><h2>把抽象的微积分，<br>变成你的<em>下一次晋级。</em></h2><p>7 大段位 · 21 个关卡 · 从理解概念，到解决问题</p><button class="primary lime" data-action="${pending ? 'resume' : 'lesson'}" data-id="${next.id}">${pending ? '继续上次练习' : done ? '重温王者挑战' : stats.xp ? '继续我的挑战' : '开启第一关'} ${icon('arrow')}</button><span class="hero-sub">${done ? '让理解再深一层' : '每关 4 题，让进步看得见'}</span></div><div class="hero-art">${heroArt()}</div></section><div class="stats-grid"><div class="stat-card"><div class="stat-icon">${icon('medal')}</div><div><div class="stat-label">当前段位</div><div class="stat-number">${activeRank.name}<small>段位</small></div></div><span class="stat-end">${activeRank.title}</span></div><div class="stat-card"><div class="stat-icon">${icon('flag')}</div><div><div class="stat-label">已攻克关卡</div><div class="stat-number">${String(stats.completed).padStart(2,'0')}<small>/ 21 关</small></div></div><span class="stat-end">一步一个脚印</span></div><div class="stat-card"><div class="stat-icon">${icon('fire')}</div><div><div class="stat-label">连续学习</div><div class="stat-number">${stats.streak}<small>天</small></div></div><span class="stat-end">${stats.streak ? '保持你的好节奏' : '今天就是好起点'}</span></div></div><div class="content-grid"><div><div class="section-heading"><h2>你的闯关地图</h2><small>循序解锁，步步晋级</small></div><div class="rank-tabs" role="tablist" aria-label="选择段位">${ranks.map((r,i) => `<button class="rank-tab ${selectedRank === i ? 'selected' : ''} ${i > index ? 'locked' : ''}" role="tab" aria-selected="${selectedRank === i}" data-action="rank" data-index="${i}">${r.name}${i > index ? '<span class="lock-small">·</span>' : ''}</button>`).join('')}</div><div class="section-heading"><h3 style="font-size:12px;font-weight:500;color:#84917f">${rank.name}篇 · ${rank.title}</h3><span style="font-size:10px;color:#9da794">${rankCompleted} / 3 已完成</span></div><div class="lesson-list">${rank.lessons.map((lesson,i) => {
      const open = engine.isUnlocked(lesson.id); const passed = completed(lesson.id); const current = lesson.id === next.id && !done;
      const symbols = ['lim','ƒ′','∫'];
      return `<article class="lesson-card ${current ? 'current' : ''} ${!open ? 'is-locked' : ''}"><div class="lesson-symbol">${selectedRank === 0 ? ['lim','∞','↝'][i] : symbols[Math.min(selectedRank > 2 ? 2 : selectedRank,2)]}</div><div class="lesson-main"><div class="lesson-kicker">LEVEL ${String(selectedRank * 3+i+1).padStart(2,'0')} ${current ? '<span class="current-label">当前挑战</span>' : passed ? `<span class="stars" aria-label="${engine.state.completed[lesson.id].stars}星">${starText(engine.state.completed[lesson.id].stars)}</span>` : ''}</div><h3>${lesson.title}</h3><p>${lesson.subtitle} · 4 道挑战</p></div>${open ? `<button class="${current ? 'primary' : 'secondary'} lesson-action" data-action="lesson" data-id="${lesson.id}">${pending?.lessonId===lesson.id ? '继续练习' : passed ? '再次挑战' : '开始闯关'} ${current ? '→' : ''}</button>` : `<span class="lesson-locked">${icon('lock')}待解锁</span>`}</article>`;
    }).join('')}</div><p class="section-footnote">${icon('shield')}每关答对 3 题即可通关，全对收获 3 星。没有倒计时，安心思考。</p><div class="insight-card"><div class="insight-icon">${icon('bulb')}</div><div><h3>公式背后，藏着怎样的直觉？</h3><p>拖动一个点，亲眼看见导数与积分的意义。</p></div><button data-action="nav" data-view="handbook">去探索 ${icon('arrow')}</button></div></div><aside class="right-column"><section class="rank-rail"><div class="rail-heading"><h3>通往王者之路</h3><span>THE RANKS</span></div>${ranks.map((r,i) => `<div class="rail-row ${i > index ? 'future' : ''}">${medal(i)}<div><div class="rank-name">${r.name}段位</div><div class="rank-sub">${r.title}</div></div>${i === index ? '<span class="rail-check">当前</span>' : i < index ? icon('check') : icon('lock')}</div>`).join('')}</section><div class="small-quote">“把复杂的问题，拆成小小的一步。”<span>— 给每一个正在探索的你</span></div></aside></div>${footer()}`;
  }
  function sideNote() {
    return `<aside class="panel side-note"><div class="eyebrow">LEARNING, NOT RACING</div><h3 style="margin-top:10px">把思路走通，比快更重要。</h3><p>每次作答后都会展示解析。答错的题会收入错题本，订正后就能将它移出。</p><ul><li>${icon('clock')}不限时，按自己的节奏来</li><li>${icon('bulb')}卡住时，试试看提示</li><li>${icon('flag')}答对 3 / 4 题，即可晋级</li><li>${icon('sparkle')}答对 +10 XP，尝试 +2 XP</li></ul></aside>`;
  }
  function renderIntro() {
    const lesson = session.lesson;
    return `<button class="back-button" data-action="nav" data-view="map">${icon('back')}返回闯关地图</button><div class="learn-layout"><section class="panel lesson-intro"><span class="pill">${ranks[lesson.rankIndex].name}段位 · 第 ${lesson.lessonIndex + 1} 关</span><h2>${lesson.title}</h2><p>${lesson.concept}</p><div class="formula">${lesson.formula}</div><div class="concept-tip">${icon('bulb')}<div><strong>记住这个小线索</strong><br>${lesson.tip}</div></div><div class="intro-rules"><span>${icon('book')}4 道精选题</span><span>${icon('flag')}答对 3 题通关</span><span>${icon('clock')}不限时挑战</span></div><button class="primary" data-action="begin">我准备好了，开始挑战 ${icon('arrow')}</button></section>${sideNote()}</div>${footer()}`;
  }
  function renderQuiz() {
    const q = session.entries[session.index].question;
    const result = session.answers[session.index];
    const answered = Boolean(result);
    return `<button class="back-button" data-action="nav" data-view="${session.review ? 'mistakes' : 'map'}">${icon('back')}保存并返回${session.review ? '错题本' : '地图'}</button><div class="view-head"><div class="eyebrow">${session.review ? 'TURN MISTAKES INTO PROGRESS' : `${ranks[session.lesson.rankIndex].name}段位 · ${session.lesson.subtitle}`}</div><h1>${session.review ? '再想一次，就更进一步。' : session.lesson.title}</h1></div><div class="quiz-layout"><section class="panel"><div class="quiz-meta"><span>${session.review ? '错题订正' : '关卡挑战'}</span><span>第 ${session.index+1} 题 / 共 ${session.entries.length} 题</span></div><div class="quiz-progress" aria-label="答题进度">${session.entries.map((_,i) => `<span class="${session.answers[i] ? session.answers[i].correct ? 'done' : 'wrong' : i === session.index ? 'current' : ''}"></span>`).join('')}</div><h2 class="question" id="question-title">${q.prompt}</h2><div class="options" role="group" aria-labelledby="question-title">${q.options.map((option,i) => `<button class="option ${session.selected === i ? 'selected' : ''} ${answered && i === q.answer ? 'correct' : ''} ${answered && session.selected === i && !result.correct ? 'incorrect' : ''}" data-action="option" data-index="${i}" aria-pressed="${session.selected === i}" ${answered ? 'disabled' : ''}><span class="option-key">${'ABCD'[i]}</span><span>${option}</span>${answered && i === q.answer ? `<span class="answer-icon">${icon('check')}</span>` : answered && session.selected === i ? `<span class="answer-icon">${icon('x')}</span>` : ''}</button>`).join('')}</div>${session.hint && !answered ? `<div class="hint-box">提示：${q.hint}</div>` : ''}${answered ? `<div class="feedback ${result.correct ? '' : 'wrong'}" role="status"><h3>${result.correct ? '✓ 思路正确，继续保持！' : `再看一眼思路 · 正确答案 ${'ABCD'[q.answer]}`}</h3><p>${q.explanation}</p></div>` : ''}<div class="quiz-actions">${answered ? `<span style="font-size:11px;color:#92a17f">${result.correct ? '+10 XP · 理解又深了一点' : '+2 XP · 每次尝试都有价值'}</span>` : `<button class="hint-button" data-action="hint">${icon('bulb')}${session.hint ? '收起提示' : '给我一点提示'}</button>`}<button class="primary" data-action="${answered ? 'next-question' : 'submit'}" ${!answered && session.selected === null ? 'disabled' : ''}>${answered ? session.index === session.entries.length-1 ? '查看学习成果' : '下一题' : '确认答案'} ${icon('arrow')}</button></div></section>${sideNote()}</div><div class="keyboard-tip">键盘也可以：1–4 选择答案 · Enter 确认或继续</div>`;
  }
  function renderResult() {
    const correct = session.answers.filter(a => a.correct).length;
    const total = session.entries.length;
    const info = session.result;
    const allDone = engine.getStats().completed === lessons.length;
    const title = session.review ? '又向理解迈进了一步' : info.rankUp ? `恭喜晋级${ranks[info.rankIndex].name}段位！` : info.passed ? allDone ? '王者之路，圆满通关！' : '关卡突破，做得不错！' : '离突破，只差一点点';
    return `<div class="panel result">${medal(session.review ? engine.getRankIndex() : info.rankIndex,'result-emblem')}<div class="eyebrow">${session.review ? 'PRACTICE MAKES PROGRESS' : info.passed ? 'CHALLENGE COMPLETED' : 'KEEP EXPLORING'}</div><h2>${title}</h2><p>${session.review ? '答对的错题已移出错题本，理解会在练习中沉淀。' : info.passed ? `${session.lesson.title} · 你已经掌握了这一站的关键知识。` : '本关答对至少 3 题即可通关。带着刚才的解析，再试一次。'}</p>${!session.review ? `<div class="stars" aria-label="${info.stars}星">${starText(info.stars)}</div>` : ''}<div class="result-stats"><div><strong>${correct}<small style="font-size:14px;color:#a3b195"> / ${total}</small></strong><span>本次答对</span></div><div><strong>+${correct * 10 + (total-correct)*2}</strong><span>学习经验 XP</span></div><div><strong>${Math.round(correct/total*100)}<small style="font-size:14px">%</small></strong><span>本次正确率</span></div></div>${!session.review && info.passed ? `<div class="result-banner">${allDone ? '21 关全部完成！可以继续冲刺满星，或去错题本巩固。' : info.rankUp ? `新段位已解锁：${ranks[info.rankIndex].description}` : info.newUnlock ? '下一关已解锁，新的探索正在等你。' : '最佳成绩已保留，所有练习都是积累。'}</div>` : ''}<div class="result-actions"><button class="secondary" data-action="nav" data-view="${session.review ? 'mistakes' : 'map'}">${session.review ? '返回错题本' : '返回地图'}</button>${!session.review ? `<button class="${info.passed ? 'secondary' : 'primary'}" data-action="lesson" data-id="${session.lesson.id}">再练一次</button>${info.passed && !allDone ? `<button class="primary" data-action="lesson" data-id="${engine.getNextLesson().id}">继续下一关 ${icon('arrow')}</button>` : ''}` : engine.getStats().mistakes ? '<button class="primary" data-action="review-all">继续巩固错题 →</button>' : '<button class="primary" data-action="nav" data-view="map">继续闯关 →</button>'}</div></div>${footer()}`;
  }
  function renderHandbook() {
    return `<div class="view-head"><div class="eyebrow">UNDERSTAND THE WHY</div><h1>知识手册</h1><p>让公式有画面，让每个知识点都有来处。所有概念都可以提前探索。</p></div><section class="lab"><div><div class="eyebrow">THE LITTLE MATH LAB</div><h2>动手，让抽象变具体。</h2><div class="lab-tabs" aria-label="演示主题"><button data-action="lab-mode" data-mode="derivative" class="${labMode === 'derivative' ? 'active' : ''}">导数 · 切线的斜率</button><button data-action="lab-mode" data-mode="integral" class="${labMode === 'integral' ? 'active' : ''}">积分 · 累积的面积</button></div><p id="lab-description"></p><div class="lab-value" id="lab-value"></div></div><div class="lab-graph"><svg id="lab-svg" viewBox="0 0 400 215" role="img" aria-label="平方函数的切线演示"></svg><label class="slider-label" for="lab-slider"><span id="slider-name">移动切点 x</span><span id="slider-number"></span></label><input id="lab-slider" type="range" min="${labMode === 'derivative' ? -2 : 0}" max="${labMode === 'derivative' ? 2 : 3}" step="0.1" value="${labX}" aria-label="拖动改变函数演示的自变量"></div></section><div class="handbook-controls"><div class="search-wrap">${icon('search')}<input type="search" id="knowledge-search" placeholder="搜索知识点、公式或段位…" aria-label="搜索知识手册" value="${escape(search)}"></div><span style="font-size:11px;color:#9ba990">21 个知识点</span></div><div class="knowledge-grid" id="knowledge-grid">${knowledgeCards()}</div>${footer()}`;
  }
  function knowledgeCards() {
    const found = lessons.filter(l => `${l.title}${l.subtitle}${l.concept}${ranks[l.rankIndex].name}${l.formula}`.toLowerCase().includes(search.trim().toLowerCase()));
    if (!found.length) return '<section class="panel empty-state" style="grid-column:1/-1"><h2>还没有找到这个知识点</h2><p>试试“极限”“导数”或“积分”。</p></section>';
    return found.map(l => `<article class="panel knowledge-card"><span class="pill">${ranks[l.rankIndex].name} · ${l.subtitle}</span><h3>${l.title}</h3><p>${l.concept}</p><div class="formula">${l.formula}</div><div class="knowledge-bottom"><span>LEVEL ${String(l.rankIndex*3+l.lessonIndex+1).padStart(2,'0')}</span><button class="text-button" data-action="${engine.isUnlocked(l.id) ? 'lesson' : 'locked'}" data-id="${l.id}">${engine.isUnlocked(l.id) ? '练习这个知识点' : '闯关解锁练习'} ${icon(engine.isUnlocked(l.id) ? 'arrow' : 'lock')}</button></div></article>`).join('');
  }
  function updateLab() {
    const svg = document.getElementById('lab-svg'); if (!svg) return;
    const derivative = labMode === 'derivative';
    const left = derivative ? -2.5 : -.35; const right = derivative ? 2.5 : 3.5;
    const maxY = derivative ? 6 : 10;
    const X = x => 34 + (x-left)/(right-left)*342;
    const Y = y => 180-y/maxY*150;
    const curve = Array.from({length:101},(_,i)=>{const x=left+(right-left)*i/100;return `${i?'L':'M'}${X(x).toFixed(2)},${Y(x*x).toFixed(2)}`;}).join(' ');
    let markup = `<defs><clipPath id="plot-clip"><rect x="25" y="15" width="360" height="178"/></clipPath></defs>`;
    for (let y=0;y<=maxY;y+=derivative?2:3) markup += `<path d="M34 ${Y(y)}H378" stroke="#eaf0e4"/><text x="21" y="${Y(y)+4}" text-anchor="end" fill="#a9b5a0" font-size="10">${y}</text>`;
    for (let x=Math.ceil(left);x<=Math.floor(right);x++) markup += `<path d="M${X(x)} 22V185" stroke="#f0f4eb"/><text x="${X(x)}" y="199" text-anchor="middle" fill="#a9b5a0" font-size="10">${x}</text>`;
    markup += `<path d="M34 180H380M${X(0)} 185V15" stroke="#becbb2"/><text x="379" y="197" fill="#8fa07e" font-family="Georgia" font-size="12">x</text><text x="${X(0)+8}" y="21" fill="#8fa07e" font-family="Georgia" font-size="12">y</text><g clip-path="url(#plot-clip)">`;
    if (derivative) {
      const f = x => 2*labX*(x-labX)+labX*labX;
      markup += `<path d="M${X(left)} ${Y(f(left))}L${X(right)} ${Y(f(right))}" stroke="#c4a56e" stroke-width="1.8"/><path d="M${X(labX)} 180V${Y(labX*labX)}" stroke="#b5c3a4" stroke-dasharray="4 4"/>`;
    } else {
      const area = Array.from({length:51},(_,i)=>{const x=labX*i/50;return `L${X(x)} ${Y(x*x)}`;}).join(' ');
      markup += `<path d="M${X(0)} 180 ${area}L${X(labX)} 180Z" fill="#c9dfac" opacity=".65"/><path d="M${X(labX)} 180V${Y(labX*labX)}" stroke="#8fb773" stroke-dasharray="4 3"/>`;
    }
    markup += `<path d="${curve}" fill="none" stroke="#729563" stroke-width="2.5"/><circle cx="${X(labX)}" cy="${Y(labX*labX)}" r="5" fill="#63884f" stroke="white" stroke-width="2"/></g><text x="294" y="28" fill="#85a071" font-size="14" font-family="Georgia" font-style="italic">f(x) = x²</text>`;
    svg.innerHTML = markup;
    svg.setAttribute('aria-label', derivative ? `平方函数在x=${labX.toFixed(1)}处，切线斜率为${(2*labX).toFixed(1)}` : `平方函数从0到${labX.toFixed(1)}的曲线下面积为${(labX**3/3).toFixed(2)}`);
    document.getElementById('lab-description').textContent = derivative ? '绿色曲线是 y = x²，金色直线是切线。拖动切点，观察斜率如何随 x 改变：导数 2x 就是这一刻的变化率。' : '绿色区域是 y = x² 在 0 到 a 之间的曲线下面积。向右拖动上限，看看一个个小变化如何累积成积分。';
    document.getElementById('lab-value').textContent = derivative ? `f′(${labX.toFixed(1)}) = 2 × (${labX.toFixed(1)}) = ${(2*labX).toFixed(1)}` : `∫₀ᵃ x² dx = a³/3 ≈ ${(labX**3/3).toFixed(2)}`;
    document.getElementById('slider-name').textContent = derivative ? '移动切点 x' : '移动积分上限 a';
    document.getElementById('slider-number').textContent = `${derivative?'x':'a'} = ${labX.toFixed(1)}`;
  }
  function renderMistakes() {
    const entries = Object.entries(engine.state.mistakes).map(([id,value])=>({...questionEntry(id),...value}));
    return `<div class="view-head"><div class="eyebrow">MISTAKES ARE STEPPING STONES</div><h1>错题回顾</h1><p>每一道错题，都是下一次理解的起点。${entries.length ? `还有 ${entries.length} 道题等待你重新征服。` : ''}</p></div>${entries.length ? `<div class="section-heading"><span style="font-size:12px;color:#8a9a7c">订正答对后，题目会自动移出错题本。</span><button class="primary" data-action="review-all">开始集中复习 ${icon('arrow')}</button></div><div class="mistake-list">${entries.map(entry=>`<article class="panel mistake-card"><span class="pill">${ranks[entry.lesson.rankIndex].name} · ${entry.lesson.title} · 错过 ${entry.count} 次</span><h3>${entry.question.prompt}</h3><details><summary>展开解题思路</summary><p><strong>正确答案：${entry.question.options[entry.question.answer]}</strong><br>${entry.question.explanation}</p></details><button class="text-button" data-action="review-one" data-id="${entry.question.id}">再挑战一次 ${icon('arrow')}</button></article>`).join('')}</div>` : `<section class="panel empty-state"><div class="empty-symbol">${icon('leaf')}</div><h2>这一页，留给成长的足迹。</h2><p>目前没有待订正的错题。去关卡中探索，答错的题会自动收集在这里。</p><button class="primary" data-action="nav" data-view="map">去闯关 ${icon('arrow')}</button></section>`}${footer()}`;
  }
  function renderProfile() {
    const stats = engine.getStats();
    const rankIndex = engine.getRankIndex();
    const days = Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-6+i);const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;return {label:i===6?'今天':`${date.getMonth()+1}/${date.getDate()}`,n:engine.state.activity[key]?.answered||0};});
    const max = Math.max(4,...days.map(d=>d.n));
    const stars = Object.values(engine.state.completed).reduce((n,l)=>n+l.stars,0);
    return `<div class="view-head"><div class="eyebrow">SMALL STEPS, REAL GROWTH</div><h1>学习档案</h1><p>你走过的每一步，都会在这里留下痕迹。</p></div><div class="profile-grid"><section class="panel"><div class="profile-heading">${medal(rankIndex)}<div><span class="eyebrow">CURRENT RANK</span><h2>${ranks[rankIndex].name}探索者</h2><p>${ranks[rankIndex].title} · ${stats.xp} 学习经验</p></div></div><div class="profile-total"><div><strong>${stats.completed}<small style="font-size:13px;color:#a2ae97">/21</small></strong><span>已通过关卡</span></div><div><strong>${stats.accuracy}%</strong><span>累计正确率</span></div><div><strong>${stars}<small style="font-size:13px;color:#a2ae97">/63</small></strong><span>收集星星</span></div></div></section><section class="panel"><div class="section-heading"><h3 style="font-size:14px">最近七天的脚步</h3><span style="font-size:10px;color:#9da991">连续学习 ${stats.streak} 天</span></div><div class="activity-bars">${days.map(d=>`<div class="activity-day"><small>${d.n} 题</small><i style="height:${Math.max(3,d.n/max*90)}px"></i><span>${d.label}</span></div>`).join('')}</div></section><section class="panel profile-wide"><div class="section-heading"><h3 style="font-size:15px">我的段位徽章</h3><span style="font-size:10px;color:#9ba68f">已解锁 ${rankIndex+1} / 7</span></div><div class="achievement-grid">${ranks.map((r,i)=>`<div class="achievement ${i>rankIndex?'future':''}">${medal(i)}<p>${r.name}段位</p><span>${i<=rankIndex?'已解锁':'待探索'}</span></div>`).join('')}</div></section></div><div class="data-note"><span class="inline-label">${icon('shield')}${account.mode==='cloud' ? '已同步的记录保存在你的账号中。请在退出前确认云端保存成功。' : engine.storageAvailable ? '学习记录保存在当前浏览器。换设备或清除浏览器数据后，记录不会保留。' : '此浏览器未允许本地存储；关闭页面后，学习记录可能丢失。'}</span><button class="danger-button" data-action="reset">清除进度</button></div>${footer()}`;
  }
  function renderStudents(){
    return `<div class="view-head"><div class="eyebrow">CLASSROOM PROGRESS</div><h1>学生学习进度</h1><p>查看已注册学生的当前段位、通关数量和最近学习时间。仅教师账号可访问。</p></div><section class="panel"><div class="section-heading"><h2 style="font-size:16px">学生名单</h2><button class="secondary" data-action="students-refresh" ${studentsLoading?'disabled':''}>刷新记录</button></div>${studentsLoading?'<p class="teacher-message" role="status">正在读取学习记录…</p>':studentsError?`<p class="teacher-message" role="alert">${escape(studentsError)}</p>`:students.length?`<div class="teacher-table-wrap"><table class="teacher-table"><thead><tr><th>学生昵称</th><th>当前段位</th><th>已通过关卡</th><th>星星</th><th>经验</th><th>最近同步</th></tr></thead><tbody>${students.map(student=>`<tr><td>${escape(student.displayName||'未命名学生')}<small>${escape(student.userId?.slice(0,8)||'')}</small></td><td>${escape(ranks[student.rankIndex]?.name||'青铜')}</td><td>${Number(student.completedCount)||0} / 21</td><td>${Number(student.stars)||0} / 63</td><td>${Number(student.xp)||0} XP</td><td>${student.updatedAt?escape(new Date(student.updatedAt).toLocaleString('zh-CN',{hour12:false})):'尚未开始'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><h2>等待第一位探索者加入</h2><p>学生注册账号后，会在这里留下学习记录。</p></div>'}<div class="teacher-pagination"><button class="secondary" data-action="students-prev" ${studentOffset===0||studentsLoading?'disabled':''}>上一页</button><span>第 ${Math.floor(studentOffset/100)+1} 页 · 每页最多 100 人</span><button class="secondary" data-action="students-next" ${students.length<100||studentsLoading?'disabled':''}>下一页</button></div></section>${footer()}`;
  }
  async function loadStudents(){
    if(!account.teacher)return;
    studentsLoading=true;studentsError='';render();
    try{students=await account.listStudents(studentOffset,100);}catch(error){studentsError=error.message;students=[];}
    finally{studentsLoading=false;if(view==='students')render();}
  }
  function applyAccountState(){
    const checkpoint=engine.getSession();session=hydrateSession(checkpoint);view=checkpoint?.view||'map';selectedRank=engine.getRankIndex();render();
  }
  function navigate(target) {
    if(session && ['lesson','quiz'].includes(view))persistSession();
    view=target;session=null;search='';if(target==='map')selectedRank=engine.getRankIndex();render();window.scrollTo({top:0,behavior:'instant'});
    if(target==='students')loadStudents();
  }
  function openLesson(id) {
    if(!engine.isUnlocked(id)){toast('先通过前一关，再来开启这次挑战。');return;}
    const lesson=lessons.find(l=>l.id===id);
    const pending=engine.getSession();
    if(pending && !pending.review && pending.lessonId===id){resumeSession();return;}
    beginNewSession(()=>{
      session={lesson,review:false,entries:lesson.questions.map(question=>({lesson,question})),index:0,selected:null,answers:[],hint:false};
      view='lesson';persistSession();render();window.scrollTo({top:0,behavior:'instant'});
    });
  }
  function startReview(ids) {
    if(engine.getSession()?.review){resumeSession();return;}
    const entries=ids.map(questionEntry).filter(Boolean);
    if(!entries.length){navigate('mistakes');return;}
    beginNewSession(()=>{session={review:true,entries,index:0,selected:null,answers:[],hint:false};view='quiz';persistSession();render();window.scrollTo({top:0,behavior:'instant'});});
  }
  function submit() {
    if(!session || session.selected===null || session.answers[session.index]) return;
    session=hydrateSession(engine.submitSessionAnswer(session.selected));
    render();
    document.querySelector('[data-action="next-question"]')?.focus({preventScroll:true});
  }
  function nextQuestion() {
    if(!session.answers[session.index])return;
    const progress=engine.advanceSession();
    session=hydrateSession(progress.session);
    if(!progress.finished){render();document.getElementById('question-title')?.scrollIntoView({block:'nearest'});}
    else {
      session.result=progress.result;
      view='result';render();window.scrollTo({top:0,behavior:'instant'});
      if(!session.review && session.result.passed) confetti();
    }
  }
  function toast(text){const element=document.getElementById('toast');element.textContent=text;element.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>element.classList.remove('show'),3400);}
  function confirmDialog(title,body,label,callback){
    dialog.innerHTML=`<h2 id="dialog-title">${title}</h2><p>${body}</p><div class="dialog-actions"><button class="secondary" data-dialog="cancel">取消</button><button class="primary" data-dialog="confirm">${label}</button></div>`;
    dialog.querySelector('[data-dialog="cancel"]').onclick=()=>dialog.close();
    dialog.querySelector('[data-dialog="confirm"]').onclick=()=>{dialog.close();callback();};
    dialog.showModal();
  }
  function help(){
    dialog.innerHTML=`<h2 id="dialog-title">每一步，都算数。</h2><p>从青铜起步，经过 7 个段位，成为微积分王者。</p><ol><li>每个段位有 3 关。每关先学概念，再挑战 4 道选择题。</li><li>答对 3 题获得 2 星并解锁下一关；4 题全对获得 3 星。完成一个段位的 3 关，晋级下一段位。</li><li>答对获得 10 XP，答错也有 2 XP。经验用来记录积累，晋级依据是关卡成绩。</li><li>没有限时、生命值或惩罚。可随时看提示、重练关卡，最高成绩会保留。</li><li>错题自动收集到「错题回顾」；在复习中答对，即可移出错题本。</li><li>学习记录自动保存在当前浏览器；当前题目、所选答案和已答结果也会自动保存，重新打开可接着答。</li></ol><div class="dialog-actions"><button class="primary" data-dialog="close">明白了，去探索</button></div>`;
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal();
  }
  function confetti(){
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    for(let i=0;i<32;i++){const piece=document.createElement('i');piece.className='confetti';piece.style.cssText=`left:${Math.random()*100}%;background:${['#a6c881','#dab980','#7aab95','#dceaa7'][i%4]};animation-delay:${Math.random()*.45}s;animation-duration:${1.8+Math.random()*.9}s;`;document.body.appendChild(piece);setTimeout(()=>piece.remove(),3400);}
  }
  app.addEventListener('click',async event=>{
    if(account.transitioning)return;
    const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
    const action=button.dataset.action;
    if(action==='nav')navigate(button.dataset.view);
    else if(action==='rank'){selectedRank=Number(button.dataset.index);render();document.querySelector(`.rank-tab[data-index="${selectedRank}"]`)?.focus({preventScroll:true});}
    else if(action==='lesson')openLesson(button.dataset.id);
    else if(action==='begin'){view='quiz';persistSession();render();}
    else if(action==='option'){if(session.answers[session.index])return;session.selected=Number(button.dataset.index);persistSession();render();document.querySelector(`[data-action="option"][data-index="${session.selected}"]`)?.focus({preventScroll:true});}
    else if(action==='submit')submit();
    else if(action==='next-question')nextQuestion();
    else if(action==='hint'){session.hint=!session.hint;persistSession();render();}
    else if(action==='resume')resumeSession();
    else if(action==='save'){
      const saved=persistSession();
      try{if(account.mode==='cloud')await account.flush();render();toast(account.mode==='cloud'?'进度已保存到你的账号。':saved?'进度已保存，下次打开可以从当前题目继续。':'保存失败：浏览器未允许写入本地存储，请检查浏览器设置。');}
      catch(error){render();toast(`云端尚未保存：${error.message}`);}
    }
    else if(action==='signout'){
      button.disabled=true;try{if(['quiz','lesson'].includes(view))persistSession();await account.signOut();}catch(error){button.disabled=false;toast(error.message);}
    }
    else if(action==='students-refresh')loadStudents();
    else if(action==='students-prev'){studentOffset=Math.max(0,studentOffset-100);loadStudents();}
    else if(action==='students-next'){studentOffset+=100;loadStudents();}
    else if(action==='sync-conflict'){
      dialog.innerHTML='<h2 id="dialog-title">选择要保留的进度</h2><p>另一台设备已更新账号记录。使用云端会替换本机尚未同步的练习；保留本机则会覆盖当前云端进度。</p><div class="dialog-actions"><button class="secondary" data-choice="cancel">稍后处理</button><button class="secondary" data-choice="local">保留本机</button><button class="primary" data-choice="cloud">使用云端</button></div>';
      dialog.querySelectorAll('[data-choice]').forEach(control=>control.onclick=async()=>{if(control.dataset.choice==='cancel'){dialog.close();return;}control.disabled=true;try{await account.resolveConflict(control.dataset.choice);dialog.close();applyAccountState();toast('进度已同步。');}catch(error){control.disabled=false;toast(error.message);}});dialog.showModal();
    }
    else if(action==='help')help();
    else if(action==='locked')toast('知识可以提前学习；练习需要按顺序通过前面的关卡。');
    else if(action==='review-all')startReview(Object.keys(engine.state.mistakes));
    else if(action==='review-one')startReview([button.dataset.id]);
    else if(action==='lab-mode'){labMode=button.dataset.mode;labX=1;render();}
    else if(action==='reset')confirmDialog('清除全部学习进度？',`${account.mode==='cloud'?'这将清空此账号的云端和本机':'这将删除当前浏览器在此地址保存的'}段位、经验、成绩、错题和未完成练习。清除后从青铜第一关重新开始，此操作无法撤销。`,'确认清除',async()=>{try{const saved=await account.reset();search='';applyAccountState();window.scrollTo({top:0,behavior:'instant'});toast(saved?'学习进度已清除，可以从青铜第一关重新开始。':'本机存档未能删除，请检查浏览器存储设置。');}catch(error){applyAccountState();toast(`清除尚未完成：${error.message}`);}});
  });
  app.addEventListener('input',event=>{
    if(account.transitioning)return;
    if(event.target.id==='lab-slider'){labX=Number(event.target.value);updateLab();}
    if(event.target.id==='knowledge-search'){search=event.target.value;document.getElementById('knowledge-grid').innerHTML=knowledgeCards();}
  });
  document.addEventListener('keydown',event=>{
    if(account.transitioning)return;
    if(view!=='quiz'||dialog.open||event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;
    if(/^[1-4]$/.test(event.key)&&!session.answers[session.index]){event.preventDefault();session.selected=Number(event.key)-1;persistSession();render();document.querySelector(`[data-action="option"][data-index="${session.selected}"]`)?.focus({preventScroll:true});}
    else if(event.key==='Enter' && ((document.activeElement?.dataset.action==='option' && session.selected===Number(document.activeElement.dataset.index)) || !['BUTTON','INPUT','SUMMARY'].includes(document.activeElement?.tagName))){event.preventDefault();session.answers[session.index]?nextQuestion():submit();}
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
  window.addEventListener('storage',event=>{
    if(account.mode==='cloud')return;
    if(event.key!==engine.storageKey && event.key!==null)return;
    engine.load();const checkpoint=engine.getSession();session=hydrateSession(checkpoint);view=checkpoint?.view||'map';selectedRank=engine.getRankIndex();if(dialog.open)dialog.close();render();toast('已同步其他页面更新的学习进度。');
  });
  const checkpoint=engine.getSession();
  if(checkpoint){session=hydrateSession(checkpoint);view=checkpoint.view;}
  render();
  account.onStatus(()=>{const bar=document.querySelector('.save-bar');if(bar)bar.outerHTML=saveBar();});
  if(account.mode==='cloud')window.addEventListener('online',()=>account.flush().catch(()=>{}));
  if(account.mode==='offline'&&!engine.storageAvailable)toast('浏览器未开放本地存储，本次可正常练习，但进度可能无法保留。');
})().catch(error=>{const app=document.getElementById('app');app.replaceChildren();const panel=document.createElement('section');panel.className='panel startup-error';const title=document.createElement('h1');title.textContent='暂时无法启动游戏';const message=document.createElement('p');message.textContent=error.message||'请刷新页面重试。';const retry=document.createElement('button');retry.className='primary';retry.textContent='重新加载';retry.onclick=()=>location.reload();panel.append(title,message,retry);app.append(panel);});
