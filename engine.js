(function (root) {
  'use strict';

  const STORAGE_KEY = 'calculus-promotion-v1';
  const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const integer = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
  const dictionary = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const validSavedAt = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  const validDay = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    return dayKey(new Date(year, month - 1, day)) === value;
  };
  const initialState = () => ({
    version: 1, completed: {}, mistakes: {}, answered: 0, correct: 0, xp: 0,
    streak: 0, lastStudyDate: null, activity: {}, settings: { sound: false },
    savedAt: null, activeSession: null,
  });

  class CalculusEngine {
    constructor(curriculum, storage) {
      if (!curriculum || !Array.isArray(curriculum.ranks)) throw new TypeError('课程必须包含 ranks 数组。');
      this.curriculum = curriculum;
      this.lessons = [];
      this.lessonMap = new Map();
      this.questionMap = new Map();
      curriculum.ranks.forEach((rank, rankIndex) => {
        (rank.lessons || []).forEach((lesson, lessonIndex) => {
          if (typeof lesson.id !== 'string' || !lesson.id || this.lessonMap.has(lesson.id)) throw new Error('关卡 ID 必须唯一且非空。');
          if (!Array.isArray(lesson.questions) || !lesson.questions.length) throw new Error('每个关卡需要至少一道题。');
          const entry = { ...lesson, rankId: rank.id, rankIndex, lessonIndex };
          this.lessons.push(entry);
          this.lessonMap.set(entry.id, entry);
          lesson.questions.forEach((question) => {
            if (typeof question.id !== 'string' || !question.id || this.questionMap.has(question.id)) throw new Error('题目 ID 必须唯一且非空。');
            this.questionMap.set(question.id, { question, lessonId: lesson.id });
          });
        });
      });
      this.storageKey = STORAGE_KEY;
      this.storage = null;
      try {
        const candidate = storage === undefined ? root.localStorage : storage;
        if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') this.storage = candidate;
      } catch (_) { /* Some browsers deny access to localStorage entirely. */ }
      this.storageAvailable = Boolean(this.storage);
      this.state = initialState();
      this.load(true);
    }

    getLessons() { return this.lessons.slice(); }

    _passed(lesson) {
      const result = this.state.completed[lesson.id];
      return Boolean(result && result.bestCorrect >= Math.ceil(lesson.questions.length * 0.75));
    }

    _lesson(lessonId) {
      const lesson = this.lessonMap.get(lessonId);
      if (!lesson) throw new Error('找不到这个关卡。');
      return lesson;
    }

    isUnlocked(lessonId) {
      const index = this.lessons.findIndex((lesson) => lesson.id === lessonId);
      return index >= 0 && this.lessons.slice(0, index).every((lesson) => this._passed(lesson));
    }

    getNextLesson() {
      return this.lessons.find((lesson) => !this._passed(lesson)) || this.lessons[this.lessons.length - 1] || null;
    }

    getRankIndex() {
      return this.lessons.reduce((highest, lesson) => this.isUnlocked(lesson.id) ? Math.max(highest, lesson.rankIndex) : highest, 0);
    }

    recordAnswer(lessonId, questionId, correct, { review = false, persist = true } = {}) {
      this._lesson(lessonId);
      const question = this.questionMap.get(questionId);
      if (!question || question.lessonId !== lessonId) throw new Error('题目不属于这个关卡。');
      if (!this.isUnlocked(lessonId)) throw new Error('请先完成前面的关卡。');
      if (typeof correct !== 'boolean') throw new TypeError('答题结果必须是布尔值。');
      const now = new Date();
      const today = dayKey(now);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (this.state.lastStudyDate !== today) {
        this.state.streak = this.state.lastStudyDate === dayKey(yesterday) ? this.state.streak + 1 : 1;
        this.state.lastStudyDate = today;
      }
      const delta = correct ? 10 : 2;
      this.state.answered += 1;
      this.state.correct += correct ? 1 : 0;
      this.state.xp += delta;
      const activity = this.state.activity[today] || { answered: 0, correct: 0 };
      activity.answered += 1;
      activity.correct += correct ? 1 : 0;
      this.state.activity[today] = activity;
      if (!correct) {
        const previous = this.state.mistakes[questionId];
        this.state.mistakes[questionId] = { lessonId, count: (previous ? previous.count : 0) + 1 };
      } else if (review) {
        delete this.state.mistakes[questionId];
      }
      if (persist) this.save();
      return { correct, xp: delta, streak: this.state.streak };
    }

    finishLesson(lessonId, correct, total, { persist = true } = {}) {
      const lesson = this._lesson(lessonId);
      if (!this.isUnlocked(lessonId)) throw new Error('请先完成前面的关卡。');
      if (total !== lesson.questions.length || !Number.isInteger(correct) || correct < 0 || correct > total) throw new RangeError('关卡成绩无效。');
      const passed = correct >= Math.ceil(total * 0.75);
      const stars = passed ? (correct === total ? 3 : 2) : 0;
      const beforeRank = this.getRankIndex();
      const beforeUnlocked = this.lessons.filter((entry) => this.isUnlocked(entry.id)).length;
      const previous = this.state.completed[lessonId];
      this.state.completed[lessonId] = {
        bestCorrect: Math.max(correct, previous ? previous.bestCorrect : 0), total,
        stars: Math.max(stars, previous ? previous.stars : 0),
        attempts: (previous ? previous.attempts : 0) + 1,
      };
      const rankIndex = this.getRankIndex();
      const newUnlock = this.lessons.filter((entry) => this.isUnlocked(entry.id)).length > beforeUnlocked;
      if (persist) this.save();
      return { passed, stars, newUnlock, rankUp: rankIndex > beforeRank, rankIndex };
    }

    _validateSession(value) {
      const invalid = () => { throw new RangeError('学习进度快照无效。'); };
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          typeof value.review !== 'boolean' || typeof value.hint !== 'boolean' ||
          !['lesson', 'quiz'].includes(value.view) ||
          !Array.isArray(value.questionIds) || !value.questionIds.length ||
          new Set(value.questionIds).size !== value.questionIds.length ||
          !Number.isInteger(value.index) || value.index < 0 || value.index >= value.questionIds.length ||
          !Array.isArray(value.answers) ||
          ![value.index, value.index + 1].includes(value.answers.length)) invalid();
      if (value.review) {
        if (value.lessonId !== null || value.view !== 'quiz') invalid();
      } else {
        const lesson = this.lessonMap.get(value.lessonId);
        if (!lesson || !this.isUnlocked(value.lessonId) ||
            lesson.questions.length !== value.questionIds.length ||
            !lesson.questions.every((question, index) => question.id === value.questionIds[index])) invalid();
      }
      const questions = Array.from(value.questionIds, (id) => {
        const entry = typeof id === 'string' ? this.questionMap.get(id) : null;
        if (!entry || !this.isUnlocked(entry.lessonId)) invalid();
        return entry.question;
      });
      const validSelection = (selection, question) => Number.isInteger(selection) &&
        selection >= 0 && Array.isArray(question.options) && selection < question.options.length;
      if (value.selected !== null && !validSelection(value.selected, questions[value.index])) invalid();
      const answers = Array.from(value.answers, (answer, index) => {
        if (!answer || !validSelection(answer.selected, questions[index])) invalid();
        return { selected: answer.selected, correct: answer.selected === questions[index].answer };
      });
      if (answers.length > value.index && value.selected !== answers[value.index].selected) invalid();
      if (value.view === 'lesson' && (value.index !== 0 || answers.length !== 0 || value.selected !== null || value.hint)) invalid();
      return {
        review: value.review, lessonId: value.lessonId, questionIds: value.questionIds.slice(),
        index: value.index, selected: value.selected, answers, hint: value.hint, view: value.view,
      };
    }

    getSession() { return this.state.activeSession ? clone(this.state.activeSession) : null; }

    saveSession(snapshot) {
      this.state.activeSession = this._validateSession(snapshot);
      return this.save();
    }

    clearSession() {
      this.state.activeSession = null;
      return this.save();
    }

    submitSessionAnswer(selected) {
      if (!this.state.activeSession) throw new Error('没有正在进行的学习进度。');
      const session = this._validateSession(this.state.activeSession);
      if (session.view !== 'quiz') throw new Error('请先进入答题。');
      // Persisted feedback is also the guard against counting a restored answer twice.
      if (session.answers.length > session.index) return this.getSession();
      session.selected = selected;
      const validated = this._validateSession(session);
      const entry = this.questionMap.get(validated.questionIds[validated.index]);
      if (validated.selected === null) throw new RangeError('请先选择一个答案。');
      const correct = validated.selected === entry.question.answer;
      this.recordAnswer(entry.lessonId, entry.question.id, correct, { review: validated.review, persist: false });
      validated.answers.push({ selected: validated.selected, correct });
      this.state.activeSession = validated;
      this.save();
      return this.getSession();
    }

    advanceSession() {
      if (!this.state.activeSession) throw new Error('没有正在进行的学习进度。');
      const session = this._validateSession(this.state.activeSession);
      if (session.view !== 'quiz' || session.answers.length !== session.index + 1) throw new Error('请先提交当前题目的答案。');
      if (session.index < session.questionIds.length - 1) {
        session.index += 1;
        session.selected = null;
        session.hint = false;
        this.state.activeSession = session;
        this.save();
        return { finished: false, session: this.getSession() };
      }
      const correct = session.answers.filter((answer) => answer.correct).length;
      const result = session.review ? null : this.finishLesson(session.lessonId, correct, session.questionIds.length, { persist: false });
      this.state.activeSession = null;
      this.save();
      return { finished: true, session: clone(session), result };
    }

    getStats() {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const recent = [dayKey(today), dayKey(yesterday)].includes(this.state.lastStudyDate);
      return {
        completed: this.lessons.filter((lesson) => this._passed(lesson)).length,
        total: this.lessons.length,
        accuracy: this.state.answered ? Math.round(this.state.correct / this.state.answered * 100) : 0,
        xp: this.state.xp,
        streak: recent ? this.state.streak : 0,
        mistakes: Object.keys(this.state.mistakes).length,
        todayAnswered: (this.state.activity[dayKey(today)] || {}).answered || 0,
      };
    }

    save() {
      if (!this.storage) { this.storageAvailable = false; return false; }
      try {
        const savedAt = new Date().toISOString();
        const raw = JSON.stringify({ ...this.state, savedAt });
        this.storage.setItem(this.storageKey, raw);
        if (this.storage.getItem(this.storageKey) !== raw) throw new Error('存档写入后校验失败。');
        this.state.savedAt = savedAt;
        this.storageAvailable = true;
        return true;
      } catch (_) {
        this.storageAvailable = false;
        return false;
      }
    }

    load(probeStorage = false) {
      this.state = initialState();
      if (!this.storage) { this.storageAvailable = false; return false; }
      let raw;
      try {
        raw = this.storage.getItem(this.storageKey);
      } catch (_) {
        this.storageAvailable = false;
        return false;
      }
      // A readable store may still reject writes (private browsing or quota). Probe
      // by writing the exact original bytes so an older save is never overwritten.
      if (probeStorage) {
        try {
          const probe = raw === null ? JSON.stringify(initialState()) : raw;
          this.storage.setItem(this.storageKey, probe);
          if (this.storage.getItem(this.storageKey) !== probe) throw new Error('存储不可写。');
          if (raw === null && typeof this.storage.removeItem === 'function') {
            this.storage.removeItem(this.storageKey);
            if (this.storage.getItem(this.storageKey) !== null) throw new Error('存储不可清除。');
          }
          this.storageAvailable = true;
        } catch (_) { this.storageAvailable = false; }
      }
      if (!raw) return false;
      let data;
      try { data = JSON.parse(raw); } catch (_) { return false; }
      if (!data || data.version !== 1) return false;
      const next = initialState();
      next.answered = integer(data.answered);
      next.correct = Math.min(integer(data.correct), next.answered);
      next.xp = integer(data.xp);
      next.streak = integer(data.streak);
      next.lastStudyDate = validDay(data.lastStudyDate) ? data.lastStudyDate : null;
      if (!next.lastStudyDate) next.streak = 0;
      next.settings.sound = dictionary(data.settings).sound === true;
      next.savedAt = validSavedAt(data.savedAt) ? data.savedAt : null;
      const results = dictionary(data.completed);
      // Restore only a contiguous progression so a damaged save cannot unlock later ranks.
      let canRestore = true;
      this.lessons.forEach((lesson) => {
        const result = results[lesson.id];
        if (!canRestore || !result || result.total !== lesson.questions.length ||
            !Number.isInteger(result.bestCorrect) || result.bestCorrect < 0 || result.bestCorrect > result.total) {
          canRestore = false;
          return;
        }
        const passed = result.bestCorrect >= Math.ceil(result.total * 0.75);
        next.completed[lesson.id] = {
          bestCorrect: result.bestCorrect, total: result.total,
          stars: passed ? (result.bestCorrect === result.total ? 3 : 2) : 0,
          attempts: Math.max(1, integer(result.attempts)),
        };
        canRestore = passed;
      });
      const unlockedLessons = new Set();
      let previousPassed = true;
      this.lessons.forEach((lesson) => {
        if (previousPassed) unlockedLessons.add(lesson.id);
        const result = next.completed[lesson.id];
        previousPassed = Boolean(previousPassed && result && result.bestCorrect >= Math.ceil(lesson.questions.length * 0.75));
      });
      Object.entries(dictionary(data.mistakes)).forEach(([id, value]) => {
        const question = this.questionMap.get(id);
        if (question && value && question.lessonId === value.lessonId &&
            unlockedLessons.has(value.lessonId) && integer(value.count) > 0) {
          next.mistakes[id] = { lessonId: value.lessonId, count: integer(value.count) };
        }
      });
      Object.entries(dictionary(data.activity)).forEach(([date, value]) => {
        if (!validDay(date) || !value) return;
        const answered = integer(value.answered);
        next.activity[date] = { answered, correct: Math.min(answered, integer(value.correct)) };
      });
      this.state = next;
      if (data.activeSession) {
        try { next.activeSession = this._validateSession(data.activeSession); }
        catch (_) { /* Keep valid completed lessons even if a session is damaged. */ }
      }
      return true;
    }

    reset() {
      this.state = initialState();
      if (this.storage) {
        try {
          if (typeof this.storage.removeItem === 'function') {
            this.storage.removeItem(this.storageKey);
            if (this.storage.getItem(this.storageKey) !== null) throw new Error('存档未能清除。');
          } else {
            const raw = JSON.stringify(this.state);
            this.storage.setItem(this.storageKey, raw);
            if (this.storage.getItem(this.storageKey) !== raw) throw new Error('存档未能清除。');
          }
          this.storageAvailable = true;
        } catch (_) { this.storageAvailable = false; }
      } else this.storageAvailable = false;
      return this.state;
    }
  }

  root.CalculusEngine = CalculusEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = CalculusEngine;
})(typeof globalThis !== 'undefined' ? globalThis : window);
