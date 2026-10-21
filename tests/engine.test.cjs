const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CalculusEngine = require('../engine.js');

function course() {
  const lesson = (id, total = 4) => ({ id, questions: Array.from({ length: total }, (_, i) => ({ id: `${id}-${i}`, options: ['正确', '错误', '干扰项', '另一干扰项'], answer: 0 })) });
  return { ranks: [
    { id: 'bronze', name: '青铜', lessons: [lesson('a'), lesson('b')] },
    { id: 'silver', name: '白银', lessons: [lesson('c', 5)] },
  ] };
}

function memoryStorage(raw) {
  const entries = new Map(raw === undefined ? [] : [['calculus-promotion-v1', raw]]);
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

function session(overrides = {}) {
  return { review: false, lessonId: 'a', questionIds: ['a-0', 'a-1', 'a-2', 'a-3'],
    index: 0, selected: null, answers: [], hint: false, view: 'quiz', ...overrides };
}

test('lesson notes, selection and hint resume after reload without counting an unsubmitted choice', () => {
  const storage = memoryStorage();
  let engine = new CalculusEngine(course(), storage);
  assert.equal(engine.state.savedAt, null);
  assert.equal(engine.saveSession(session({ view: 'lesson' })), true);
  assert.equal(new CalculusEngine(course(), storage).getSession().view, 'lesson');
  engine.saveSession(session({ selected: 2, hint: true }));
  const savedAt = engine.state.savedAt;
  assert.match(savedAt, /^\d{4}-\d{2}-\d{2}T/);
  engine = new CalculusEngine(course(), storage);
  assert.deepEqual(engine.getSession(), session({ selected: 2, hint: true }));
  assert.equal(engine.state.savedAt, savedAt);
  assert.equal(engine.state.answered, 0);
  const detached = engine.getSession();
  detached.questionIds.pop();
  detached.selected = 0;
  assert.equal(engine.getSession().selected, 2);
  assert.equal(engine.getSession().questionIds.length, 4);
});

test('submitted feedback and statistics are saved together; reload and repeated submit do not duplicate XP', () => {
  const storage = memoryStorage();
  let writes = 0;
  const originalSet = storage.setItem;
  storage.setItem = (key, raw) => { writes += 1; originalSet(key, raw); };
  let engine = new CalculusEngine(course(), storage);
  engine.saveSession(session());
  assert.throws(() => engine.advanceSession(), /提交/);
  writes = 0;
  assert.deepEqual(engine.submitSessionAnswer(1).answers, [{ selected: 1, correct: false }]);
  assert.equal(writes, 1);
  let saved = JSON.parse(storage.getItem(engine.storageKey));
  assert.equal(saved.answered, 1);
  assert.equal(saved.activeSession.answers.length, 1);
  engine = new CalculusEngine(course(), storage);
  assert.equal(engine.getSession().selected, 1);
  const unchanged = engine.submitSessionAnswer(0);
  assert.deepEqual(unchanged.answers, [{ selected: 1, correct: false }]);
  assert.equal(engine.state.answered, 1);
  assert.equal(engine.state.xp, 2);
  const next = engine.advanceSession();
  assert.equal(next.finished, false);
  assert.equal(next.session.index, 1);
  assert.equal(next.session.selected, null);
  assert.equal(next.session.hint, false);
  engine = new CalculusEngine(course(), storage);
  assert.equal(engine.getSession().index, 1);
  assert.equal(engine.state.answered, 1);
  assert.throws(() => engine.submitSessionAnswer(4), /无效/);
  assert.equal(engine.state.answered, 1);
});

test('finishing the last question saves the result and clears the session atomically', () => {
  const storage = memoryStorage();
  let engine = new CalculusEngine(course(), storage);
  engine.saveSession(session());
  for (let i = 0; i < 3; i += 1) {
    engine.submitSessionAnswer(0);
    engine.advanceSession();
  }
  engine.submitSessionAnswer(0);
  engine = new CalculusEngine(course(), storage);
  let writes = 0;
  const originalSet = storage.setItem;
  storage.setItem = (key, raw) => { writes += 1; originalSet(key, raw); };
  const finished = engine.advanceSession();
  assert.equal(writes, 1);
  assert.equal(finished.finished, true);
  assert.equal(finished.session.index, 3);
  assert.equal(finished.session.answers.length, 4);
  assert.equal(finished.result.passed, true);
  assert.equal(engine.getSession(), null);
  engine = new CalculusEngine(course(), storage);
  assert.equal(engine.state.completed.a.attempts, 1);
  assert.equal(engine.state.xp, 40);
  assert.equal(engine.isUnlocked('b'), true);
  assert.equal(engine.getSession(), null);
  assert.throws(() => engine.advanceSession(), /没有/);
  assert.equal(engine.state.completed.a.attempts, 1);
});

test('review resumes even after corrected questions are removed from the mistake list', () => {
  const storage = memoryStorage();
  let engine = new CalculusEngine(course(), storage);
  engine.recordAnswer('a', 'a-0', false);
  engine.recordAnswer('a', 'a-2', false);
  engine.saveSession(session({ review: true, lessonId: null, questionIds: ['a-2', 'a-0'] }));
  engine.submitSessionAnswer(0);
  assert.equal(engine.state.mistakes['a-2'], undefined);
  engine = new CalculusEngine(course(), storage);
  assert.deepEqual(engine.getSession().questionIds, ['a-2', 'a-0']);
  assert.equal(engine.getSession().answers[0].correct, true);
  engine.advanceSession();
  engine.submitSessionAnswer(0);
  const completed = engine.advanceSession();
  assert.equal(completed.finished, true);
  assert.equal(completed.result, null);
  assert.equal(engine.getStats().mistakes, 0);
  assert.deepEqual(engine.state.completed, {});
  assert.equal(new CalculusEngine(course(), storage).getSession(), null);
});

test('legacy saves keep previous scores and invalid sessions cannot damage valid progress', () => {
  const legacy = { version: 1, completed: { a: { bestCorrect: 3, total: 4, stars: 2, attempts: 2 } }, answered: 4, correct: 3, xp: 32 };
  const storage = memoryStorage(JSON.stringify(legacy));
  let engine = new CalculusEngine(course(), storage);
  assert.equal(engine.state.savedAt, null);
  assert.equal(engine.getSession(), null);
  assert.equal(engine.getStats().completed, 1);
  assert.equal(engine.state.completed.a.attempts, 2);
  engine.saveSession(session({ index: 1, answers: [{ selected: 1, correct: true }] }));
  assert.equal(engine.getSession().answers[0].correct, false);
  const raw = JSON.parse(storage.getItem(engine.storageKey));
  raw.activeSession.questionIds = ['not-a-question'];
  storage.setItem(engine.storageKey, JSON.stringify(raw));
  engine = new CalculusEngine(course(), storage);
  assert.equal(engine.getSession(), null);
  assert.equal(engine.getStats().completed, 1);
  assert.equal(engine.state.xp, 32);
});

test('snapshots reject incomplete or locked questions, illegal choices and discontinuous answers', () => {
  const engine = new CalculusEngine(course(), memoryStorage());
  engine.saveSession(session());
  const invalid = [
    session({ questionIds: ['a-0'] }), session({ questionIds: ['a-1', 'a-0', 'a-2', 'a-3'] }),
    session({ lessonId: 'b', questionIds: ['b-0', 'b-1', 'b-2', 'b-3'] }),
    session({ review: true, lessonId: null, questionIds: ['c-0'] }),
    session({ review: true, lessonId: null, questionIds: ['a-0', 'a-0'] }),
    session({ selected: -1 }), session({ selected: 4 }), session({ selected: 0.5 }),
    session({ index: 4 }), session({ index: 2, answers: [] }),
    session({ answers: [{ selected: 0, correct: true }] }),
    session({ index: 1, answers: [{ selected: 9, correct: false }] }),
    session({ index: 1, answers: new Array(1) }),
    session({ view: 'lesson', selected: 0 }), session({ hint: 'true' }),
  ];
  invalid.forEach((value) => {
    assert.throws(() => engine.saveSession(value), /无效/);
    assert.deepEqual(engine.getSession(), session());
  });
  engine.clearSession();
  assert.equal(new CalculusEngine(course(), engine.storage).getSession(), null);
});

test('clear progress also deletes an active session and its timestamp on reload', () => {
  const storage = memoryStorage();
  const engine = new CalculusEngine(course(), storage);
  engine.saveSession(session());
  engine.submitSessionAnswer(0);
  engine.reset();
  assert.equal(engine.state.savedAt, null);
  assert.equal(engine.getSession(), null);
  const restored = new CalculusEngine(course(), storage);
  assert.equal(restored.state.savedAt, null);
  assert.equal(restored.getSession(), null);
  assert.equal(restored.state.answered, 0);
  assert.equal(restored.state.xp, 0);
});

test('readable but unwritable storage keeps the existing save and never claims a successful save', () => {
  const raw = JSON.stringify({ version: 1, answered: 5, correct: 4, xp: 42 });
  const storage = { getItem: () => raw, setItem: () => { throw new Error('quota'); } };
  const engine = new CalculusEngine(course(), storage);
  assert.equal(engine.storageAvailable, false);
  assert.equal(engine.state.xp, 42);
  assert.equal(engine.saveSession(session()), false);
  assert.equal(engine.state.savedAt, null);
  assert.equal(storage.getItem(engine.storageKey), raw);
  engine.submitSessionAnswer(0);
  assert.equal(engine.state.xp, 52);
  assert.equal(engine.storageAvailable, false);
  engine.reset();
  assert.equal(engine.storageAvailable, false);
});

test('readback failure preserves last confirmed timestamp; normal load never writes or loops across tabs', () => {
  const storage = memoryStorage();
  const engine = new CalculusEngine(course(), storage);
  engine.saveSession(session());
  const timestamp = engine.state.savedAt;
  const raw = storage.getItem(engine.storageKey);
  let writes = 0;
  storage.setItem = () => { writes += 1; };
  engine.load();
  assert.equal(writes, 0);
  engine.state.xp = 2;
  assert.equal(engine.save(), false);
  assert.equal(engine.state.savedAt, timestamp);
  assert.equal(engine.storageAvailable, false);
  assert.equal(storage.getItem(engine.storageKey), raw);
  storage.removeItem = () => {};
  engine.reset();
  assert.equal(engine.storageAvailable, false);
});

function atLocalTime(year, month, day, hour = 12) {
  const OriginalDate = global.Date;
  const timestamp = new OriginalDate(year, month - 1, day, hour).getTime();
  global.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  };
  return () => { global.Date = OriginalDate; };
}

test('75% boundary unlocks one lesson and invalid/skipped results cannot mutate progress', () => {
  const engine = new CalculusEngine(course(), null);
  assert.equal(engine.isUnlocked('a'), true);
  assert.equal(engine.isUnlocked('b'), false);
  assert.equal(engine.isUnlocked('unknown'), false);
  assert.throws(() => engine.finishLesson('b', 4, 4), /前面/);
  assert.throws(() => engine.finishLesson('a', 4, 3), /无效/);
  assert.throws(() => engine.finishLesson('a', 5, 4), /无效/);
  assert.throws(() => engine.finishLesson('a', 2.5, 4), /无效/);
  assert.deepEqual(engine.finishLesson('a', 2, 4), { passed: false, stars: 0, newUnlock: false, rankUp: false, rankIndex: 0 });
  assert.equal(engine.getStats().completed, 0);
  assert.equal(engine.isUnlocked('b'), false);
  assert.deepEqual(engine.finishLesson('a', 3, 4), { passed: true, stars: 2, newUnlock: true, rankUp: false, rankIndex: 0 });
  assert.equal(engine.getStats().completed, 1);
  assert.equal(engine.getNextLesson().id, 'b');
  assert.equal(engine.state.completed.a.attempts, 2);
});

test('replaying preserves best score and stars; rank advances only at rank boundary', () => {
  const engine = new CalculusEngine(course(), null);
  engine.finishLesson('a', 4, 4);
  const replay = engine.finishLesson('a', 0, 4);
  assert.equal(replay.passed, false);
  assert.deepEqual(engine.state.completed.a, { bestCorrect: 4, total: 4, stars: 3, attempts: 2 });
  assert.equal(engine.isUnlocked('b'), true);
  assert.deepEqual(engine.finishLesson('b', 3, 4), { passed: true, stars: 2, newUnlock: true, rankUp: true, rankIndex: 1 });
  assert.equal(engine.getRankIndex(), 1);
  assert.equal(engine.finishLesson('c', 3, 5).passed, false);
  assert.equal(engine.finishLesson('c', 4, 5).passed, true);
  assert.equal(engine.getStats().completed, 3);
  assert.equal(engine.getNextLesson().id, 'c');
  assert.equal(engine.getLessons()[2].rankId, 'silver');
  assert.equal(engine.getLessons()[2].lessonIndex, 0);
});

test('answers count once per call and only successful review clears a mistake', () => {
  const engine = new CalculusEngine(course(), null);
  engine.recordAnswer('a', 'a-0', false);
  engine.recordAnswer('a', 'a-0', false, { review: true });
  assert.deepEqual(engine.state.mistakes['a-0'], { lessonId: 'a', count: 2 });
  engine.recordAnswer('a', 'a-0', true);
  assert.equal(engine.getStats().mistakes, 1);
  engine.recordAnswer('a', 'a-0', true, { review: true });
  assert.equal(engine.getStats().mistakes, 0);
  assert.equal(engine.getStats().accuracy, 50);
  assert.equal(engine.getStats().xp, 24);
  assert.equal(engine.getStats().todayAnswered, 4);
  assert.throws(() => engine.recordAnswer('a', 'b-0', true), /不属于/);
  assert.throws(() => engine.recordAnswer('b', 'b-0', true), /前面/);
  assert.throws(() => engine.recordAnswer('a', 'a-0', 1), /布尔/);
  assert.equal(engine.state.answered, 4);
});

test('study dates use local calendar, count once daily, cross month and reset after gap', () => {
  const engine = new CalculusEngine(course(), null);
  let restore = atLocalTime(2026, 1, 31, 23);
  try {
    engine.recordAnswer('a', 'a-0', true);
    engine.recordAnswer('a', 'a-1', true);
    assert.equal(engine.state.lastStudyDate, '2026-01-31');
    assert.equal(engine.getStats().streak, 1);
  } finally { restore(); }
  restore = atLocalTime(2026, 2, 1, 0);
  try {
    assert.equal(engine.getStats().todayAnswered, 0);
    assert.equal(engine.getStats().streak, 1);
    engine.recordAnswer('a', 'a-0', true);
    assert.equal(engine.getStats().streak, 2);
    assert.equal(engine.state.activity['2026-01-31'].answered, 2);
    assert.equal(engine.state.activity['2026-02-01'].answered, 1);
  } finally { restore(); }
  restore = atLocalTime(2026, 2, 3);
  try {
    assert.equal(engine.getStats().streak, 0);
    engine.recordAnswer('a', 'a-0', true);
    assert.equal(engine.getStats().streak, 1);
  } finally { restore(); }
});

test('progress persists and reset deletes stored progress', () => {
  const storage = memoryStorage();
  const engine = new CalculusEngine(course(), storage);
  engine.recordAnswer('a', 'a-0', false);
  engine.finishLesson('a', 3, 4);
  engine.state.settings.sound = true;
  assert.equal(engine.save(), true);
  const restored = new CalculusEngine(course(), storage);
  assert.deepEqual(restored.state, engine.state);
  assert.equal(restored.storageAvailable, true);
  restored.reset();
  assert.equal(storage.getItem(restored.storageKey), null);
  assert.equal(new CalculusEngine(course(), storage).getStats().completed, 0);
});

test('corrupt, incompatible and malformed saves fail safely or sanitize invalid fields', () => {
  for (const raw of ['{broken', 'null', '{"version":99}', '[]']) {
    const engine = new CalculusEngine(course(), memoryStorage(raw));
    assert.equal(engine.getStats().xp, 0);
    assert.equal(engine.getStats().completed, 0);
    assert.equal(engine.storageAvailable, true);
  }
  const damaged = {
    version: 1, answered: 2, correct: 200, xp: -10, streak: 10, lastStudyDate: '2026-02-31',
    completed: { a: { bestCorrect: 3, total: 4, stars: 9, attempts: -1 }, c: { bestCorrect: 5, total: 5 } },
    mistakes: { 'a-0': { lessonId: 'wrong', count: 1 }, unknown: { lessonId: 'a', count: 1 } },
    activity: { '2026-02-31': { answered: 7 }, '2026-02-01': { answered: 3, correct: 10 } },
    settings: { sound: 'true' },
  };
  const engine = new CalculusEngine(course(), memoryStorage(JSON.stringify(damaged)));
  assert.equal(engine.state.correct, 2);
  assert.equal(engine.state.xp, 0);
  assert.equal(engine.state.streak, 0);
  assert.equal(engine.state.completed.a.stars, 2);
  assert.equal(engine.state.completed.a.attempts, 1);
  assert.equal(engine.state.completed.c, undefined);
  assert.equal(engine.state.activity['2026-02-31'], undefined);
  assert.equal(engine.state.activity['2026-02-01'].correct, 3);
  assert.equal(engine.state.settings.sound, false);
  assert.equal(engine.getStats().mistakes, 0);
});

test('blocked storage and write quota preserve a usable in-memory game', () => {
  const storage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  const engine = new CalculusEngine(course(), storage);
  assert.equal(engine.storageAvailable, false);
  engine.recordAnswer('a', 'a-0', true);
  assert.equal(engine.getStats().xp, 10);
  assert.equal(engine.finishLesson('a', 4, 4).passed, true);
  assert.equal(engine.isUnlocked('b'), true);
  engine.reset();
  assert.equal(engine.state.answered, 0);
  assert.equal(engine.storageAvailable, false);
  assert.equal(new CalculusEngine(course(), null).storageAvailable, false);
});

test('browser script exports globally and handles a denied localStorage getter', () => {
  const browser = vm.createContext({});
  Object.defineProperty(browser, 'localStorage', { get() { throw new Error('SecurityError'); } });
  vm.runInContext(fs.readFileSync(require.resolve('../engine.js'), 'utf8'), browser);
  assert.equal(typeof browser.CalculusEngine, 'function');
  const engine = new browser.CalculusEngine(course());
  assert.equal(engine.storageAvailable, false);
  engine.recordAnswer('a', 'a-0', true);
  assert.equal(engine.getStats().xp, 10);
});

test('restore discards mistakes from locked lessons while keeping accessible review questions', () => {
  const damaged = {
    version: 1,
    completed: {
      a: { bestCorrect: 3, total: 4, stars: 2, attempts: 1 },
      c: { bestCorrect: 5, total: 5, stars: 3, attempts: 1 },
    },
    mistakes: {
      'a-0': { lessonId: 'a', count: 2 },
      'b-0': { lessonId: 'b', count: 1 },
      'c-0': { lessonId: 'c', count: 1 },
    },
  };
  const engine = new CalculusEngine(course(), memoryStorage(JSON.stringify(damaged)));
  assert.equal(engine.isUnlocked('b'), true);
  assert.equal(engine.isUnlocked('c'), false);
  assert.equal(engine.state.completed.c, undefined);
  assert.equal(engine.state.mistakes['c-0'], undefined);
  assert.equal(engine.getStats().mistakes, 2);
  for (const [questionId, { lessonId }] of Object.entries(engine.state.mistakes)) {
    assert.doesNotThrow(() => engine.recordAnswer(lessonId, questionId, true, { review: true }));
  }
  assert.equal(engine.getStats().mistakes, 0);
});

test('real curriculum progresses through all seven ranks at 75%, then persists 21 perfect lessons and 63 stars', () => {
  const browser = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(require.resolve('../curriculum.js'), 'utf8'), browser);
  const curriculum = browser.window.CALCULUS_CURRICULUM;
  const storage = memoryStorage();
  const engine = new CalculusEngine(curriculum, storage);
  const lessons = engine.getLessons();
  const rankIds = new Set();
  const lessonIds = new Set();
  const questionIds = new Set();
  assert.equal(curriculum.ranks.length, 7);
  assert.equal(curriculum.ranks[0].name, '青铜');
  assert.equal(curriculum.ranks[6].name, '王者');
  assert.equal(lessons.length, 21);
  curriculum.ranks.forEach((rank) => {
    assert.equal(typeof rank.id, 'string');
    assert.ok(rank.id.length && !rankIds.has(rank.id), `unique rank ID: ${rank.id}`);
    rankIds.add(rank.id);
    assert.equal(rank.lessons.length, 3);
  });
  lessons.forEach((lesson) => {
    assert.ok(lesson.id.length && !lessonIds.has(lesson.id), `unique lesson ID: ${lesson.id}`);
    lessonIds.add(lesson.id);
    assert.equal(lesson.questions.length, 4);
    lesson.questions.forEach((question) => {
      assert.ok(question.id.length && !questionIds.has(question.id), `unique question ID: ${question.id}`);
      questionIds.add(question.id);
      assert.equal(question.options.length, 4, question.id);
      question.options.forEach((option) => assert.ok(typeof option === 'string' && option.trim(), question.id));
      assert.equal(new Set(question.options.map((option) => option.trim())).size, 4, `distinct options: ${question.id}`);
      assert.ok(Number.isInteger(question.answer) && question.answer >= 0 && question.answer < 4, `valid answer index: ${question.id}`);
      ['prompt', 'explanation', 'hint'].forEach((field) => {
        assert.ok(typeof question[field] === 'string' && question[field].trim(), `${question.id}: ${field}`);
      });
    });
  });
  assert.equal(questionIds.size, 84);

  let promotions = 0;
  lessons.forEach((lesson, index) => {
    assert.equal(engine.getNextLesson().id, lesson.id);
    assert.equal(engine.isUnlocked(lesson.id), true);
    if (lessons[index + 1]) assert.equal(engine.isUnlocked(lessons[index + 1].id), false);
    const threshold = Math.ceil(lesson.questions.length * 0.75);
    lesson.questions.forEach((question, questionIndex) => {
      const selected = questionIndex < threshold ? question.answer : (question.answer + 1) % question.options.length;
      engine.recordAnswer(lesson.id, question.id, selected === question.answer);
    });
    const result = engine.finishLesson(lesson.id, threshold, lesson.questions.length);
    assert.equal(result.passed, true);
    assert.equal(result.stars, 2);
    assert.equal(result.newUnlock, index < lessons.length - 1);
    assert.equal(result.rankIndex, Math.min(6, Math.floor((index + 1) / 3)));
    if (result.rankUp) promotions += 1;
    assert.equal(engine.getStats().completed, index + 1);
  });
  assert.equal(promotions, 6);
  assert.equal(engine.getRankIndex(), 6);
  assert.equal(engine.getNextLesson().id, 'king-3');
  assert.equal(engine.getStats().accuracy, 75);
  assert.equal(engine.getStats().xp, 63 * 10 + 21 * 2);
  assert.equal(Object.values(engine.state.completed).reduce((sum, result) => sum + result.stars, 0), 42);

  // Perfect replays improve stars while preserving the first run's answer history.
  lessons.forEach((lesson) => {
    lesson.questions.forEach((question) => engine.recordAnswer(lesson.id, question.id, true));
    const result = engine.finishLesson(lesson.id, lesson.questions.length, lesson.questions.length);
    assert.equal(result.stars, 3);
    assert.equal(result.newUnlock, false);
    assert.equal(result.rankUp, false);
  });
  const restored = new CalculusEngine(curriculum, storage);
  assert.deepEqual(restored.state, engine.state);
  assert.equal(restored.getRankIndex(), 6);
  assert.equal(restored.getStats().completed, 21);
  assert.equal(restored.getStats().total, 21);
  assert.equal(restored.state.answered, 168);
  assert.equal(restored.state.correct, 147);
  assert.equal(restored.getStats().accuracy, 88);
  assert.equal(restored.getStats().xp, 1512);
  assert.equal(restored.getStats().mistakes, 21);
  assert.equal(Object.values(restored.state.completed).reduce((sum, result) => sum + result.stars, 0), 63);
  lessons.forEach((lesson) => {
    assert.equal(restored.isUnlocked(lesson.id), true);
    assert.equal(restored.state.completed[lesson.id].bestCorrect, 4);
    assert.equal(restored.state.completed[lesson.id].attempts, 2);
  });
});
