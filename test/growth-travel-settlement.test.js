'use strict';
/**
 * 行程历史 → 派猫主流程的接线测试。
 *
 * 固件取自真实账号快照（2026-09-16）：09-15 派出的行程在 09-16 才领取，
 * 缓存跨日 roll 时把它丢了 —— 这正是本地推断答不了、必须问 records 的场景。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { applyDaySettlement, planTravelStep, travelCacheCompleted } = require('../scripts/growth-travel.js');

/** `reconcileToday()` 的 reconciliation 部分（已归一化成 camelCase）。 */
const RECONCILED_TODAY = {
  today: '2026-09-16',
  departedToday: false,
  claimedToday: true,
  claimedReward: 8,
  departedRecords: [],
  claimedRecords: [
    { recordId: 5834167, travelDate: '2026-09-15', departAt: 1789470233, arriveAt: 1789484633, claimedAt: 1789558075, rewardCredit: 8, location: '咖啡馆' },
  ],
};

test('applyDaySettlement：records 说今天领过，就把缓存补成已领', () => {
  const prior = { ok: true, claimed: false, location: '咖啡馆' };
  const settled = applyDaySettlement(prior, RECONCILED_TODAY, '2026-09-16');
  assert.equal(settled.ok, true);
  assert.equal(settled.claimed, true);
  assert.equal(settled.date, '2026-09-16');
  assert.equal(settled.claimedAt, 1789558075);
  assert.equal(settled.rewardCredit, 8);
  assert.equal(settled.state, 'idle');
});

test('applyDaySettlement：不修改入参', () => {
  const prior = { ok: true, claimed: false, location: '' };
  const snapshot = JSON.stringify(prior);
  applyDaySettlement(prior, RECONCILED_TODAY, '2026-09-16');
  assert.equal(JSON.stringify(prior), snapshot);
});

test('applyDaySettlement：拿不到权威答案时一律不动缓存', () => {
  const prior = { ok: true, claimed: false, location: '咖啡馆' };
  assert.deepEqual(applyDaySettlement(prior, null, '2026-09-16'), prior);
  assert.deepEqual(applyDaySettlement(prior, undefined, '2026-09-16'), prior);
  assert.deepEqual(applyDaySettlement(prior, {}, '2026-09-16'), prior);
  // 今天确实没领 → 也不能反过来把 claimed 抹成 false
  assert.deepEqual(applyDaySettlement(prior, { claimedToday: false }, '2026-09-16'), prior);
  assert.deepEqual(applyDaySettlement(null, RECONCILED_TODAY, '2026-09-16').claimed, true);
});

test('applyDaySettlement：幂等', () => {
  const once = applyDaySettlement({ ok: true, claimed: false }, RECONCILED_TODAY, '2026-09-16');
  const twice = applyDaySettlement(once, RECONCILED_TODAY, '2026-09-16');
  assert.deepEqual(twice, once);
});

test('applyDaySettlement：已有值不被权威数据覆盖', () => {
  const prior = { ok: true, claimed: false, claimedAt: 1789563000, rewardCredit: 12, location: '海边', date: '2026-09-16', state: 'idle' };
  const settled = applyDaySettlement(prior, RECONCILED_TODAY, '2026-09-16');
  assert.equal(settled.claimedAt, 1789563000);
  assert.equal(settled.rewardCredit, 12);
  assert.equal(settled.location, '海边');
});

test('planTravelStep：不传 reconciliation 时行为与从前完全一致', () => {
  const status = { ok: true, state: 'idle', dailyLimitReached: false };
  const base = { mode: 'claim', status, prior: { ok: true, claimed: false }, now: 1789630852000 };
  const legacy = planTravelStep(base);
  const explicitNull = planTravelStep({ ...base, reconciliation: null, today: '2026-09-16' });
  assert.deepEqual(explicitNull, legacy);
  // 没有权威数据时，缓存认为没领 → 补一次幂等 claim
  assert.equal(legacy.action, 'claim');
});

test('planTravelStep：有权威对账后不再重复 claim 已领过的行程', () => {
  const status = { ok: true, state: 'idle', dailyLimitReached: false };
  const step = planTravelStep({
    mode: 'claim',
    status,
    prior: { ok: true, claimed: false },
    reconciliation: RECONCILED_TODAY,
    today: '2026-09-16',
    now: 1789630852000,
  });
  assert.equal(step.action, 'wait');
  assert.equal(step.reason, '今日已完成');
});

test('planTravelStep：权威对账让当日任务正确收敛为已完成', () => {
  // 缓存被跨日 roll 掉、只剩一条「以为没领」的记录
  const stale = { u1: { ok: true, claimed: false, location: '咖啡馆' } };
  assert.equal(travelCacheCompleted(stale), false);
  // 接上 records 之后，同一条缓存可以被正确判定为收工
  const settled = { u1: applyDaySettlement(stale.u1, RECONCILED_TODAY, '2026-09-16') };
  assert.equal(travelCacheCompleted(settled), true);
});
