// ============================================================================
// pitchEngine.js : 2단계(투구 결과) & 3단계(스윙/노스윙, 컨택/헛스윙) 모듈
// ============================================================================
import {
  STAT_CONFIG,
  BASE_PITCH_OUTCOME,
  CONTROL_MOD_PER_POINT,
  PITCH_ORDER_MOD,
  BASE_SWING_PROB,
  EYE_SWING_MOD,
  NOSWING_STRIKE_PROB,
  BASE_CONTACT_PROB,
  CONTACT_VS_STUFF_MOD,
} from "./config.js";

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function normalizeProbs(probMap) {
  const keys = Object.keys(probMap);
  const clamped = {};
  let sum = 0;
  for (const k of keys) {
    clamped[k] = Math.max(0.005, probMap[k]);
    sum += clamped[k];
  }
  for (const k of keys) {
    clamped[k] /= sum;
  }
  return clamped;
}

export function weightedChoice(probMap, rng = Math.random) {
  const r = rng();
  let acc = 0;
  const entries = Object.entries(probMap);
  for (const [key, p] of entries) {
    acc += p;
    if (r <= acc) return key;
  }
  return entries[entries.length - 1][0];
}

// 투수 잔여 체력에 따른 유효 스탯 계산
export function getEffectivePitcherStats(pitcher) {
  const maxPitches = pitcher.stamina * STAT_CONFIG.PITCHES_PER_STAMINA;
  const remainRatio = Math.max(0, (maxPitches - pitcher.pitchesThrown) / Math.max(1, maxPitches));
  let penalty = 0;
  if (remainRatio <= 0) penalty = 2.5;
  else if (remainRatio <= STAT_CONFIG.FATIGUE_THRESHOLD) penalty = 1.2;

  return {
    control: clamp(pitcher.control - penalty, 1, 9),
    stuff: clamp(pitcher.stuff - penalty, 1, 9),
    movement: clamp(pitcher.movement - penalty * 0.8, 1, 9),
    remainRatio,
    isTired: penalty > 0,
  };
}

// 2. 투구 결과 확률 계산 및 추첨 (MISTAKE, BORDERLINE, CLOSE_BALL, WIDE_BALL, WILD_PITCH)
export function calculatePitchOutcomeProbs(pitcher, pitchOrder = "NORMAL") {
  const eff = getEffectivePitcherStats(pitcher);
  const ctrlDiff = eff.control - STAT_CONFIG.AVG_STAT;
  const orderMod = PITCH_ORDER_MOD[pitchOrder] || PITCH_ORDER_MOD.NORMAL;

  const raw = {};
  for (const key of Object.keys(BASE_PITCH_OUTCOME)) {
    raw[key] =
      BASE_PITCH_OUTCOME[key] +
      ctrlDiff * CONTROL_MOD_PER_POINT[key] +
      (orderMod[key] || 0);
  }
  return normalizeProbs(raw);
}

export function resolvePitch(pitcher, pitchOrder = "NORMAL") {
  const probs = calculatePitchOutcomeProbs(pitcher, pitchOrder);
  const outcome = weightedChoice(probs);
  return { outcome, probs };
}

// 3. 타자 스윙 / 노스윙 결정
export function resolveSwingDecision(batter, pitchOutcome, batterOrder = "NORMAL", count = { balls: 0, strikes: 0 }) {
  if (batterOrder === "HIT_AND_RUN") {
    return { swung: true, swingProb: 1.0, reason: "런앤히트 지시(무조건 스윙)" };
  }
  if (batterOrder === "TAKE") {
    return { swung: false, swingProb: 0.0, reason: "스탠딩 지시(무조건 노스윙)" };
  }

  const eyeDiff = batter.eye - STAT_CONFIG.AVG_STAT;
  let prob = BASE_SWING_PROB[pitchOutcome] + eyeDiff * EYE_SWING_MOD[pitchOutcome];

  // 2스트라이크 보호 스윙 보정 (보더라인/걸친 공에 대한 반응 소폭 증가)
  if (count.strikes === 2 && (pitchOutcome === "BORDERLINE" || pitchOutcome === "CLOSE_BALL")) {
    prob += 0.12;
  }
  // 3-0 카운트 신중함 보정
  if (count.balls === 3 && count.strikes === 0) {
    prob -= 0.18;
  }

  prob = clamp(prob, 0.02, 0.96);
  const swung = Math.random() < prob;
  return { swung, swingProb: prob, reason: `선구(${batter.eye}) 기반 판단` };
}

// 3.1 노스윙 시 스트라이크 / 볼 판정
export function resolveNoSwingCall(pitchOutcome) {
  const strikeProb = NOSWING_STRIKE_PROB[pitchOutcome] ?? 0;
  const isStrike = Math.random() < strikeProb;
  return { isStrike, strikeProb };
}

// 3.2 스윙 시 컨택 / 헛스윙 판정
export function resolveContact(batter, pitcher, pitchOutcome) {
  const eff = getEffectivePitcherStats(pitcher);
  const diff = batter.contact - eff.stuff;
  let contactProb = BASE_CONTACT_PROB[pitchOutcome] + diff * CONTACT_VS_STUFF_MOD;
  contactProb = clamp(contactProb, 0.08, 0.97);
  const contacted = Math.random() < contactProb;
  return { contacted, contactProb };
}
