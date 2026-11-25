// ============================================================================
// battedBallEngine.js : 0단계(번트), 4단계(타구/실책/라인드라이브 병살), 5단계(안타/3루타)
// ============================================================================
import {
  STAT_CONFIG,
  BUNT_CONFIG,
  BASE_BATTED_BALL,
  FIELDER_DISTRIBUTION,
  ERROR_CONFIG,
  BASE_HIT_TYPE,
  POWER_VS_MOVEMENT_MOD,
  BASERUNNING_CONFIG,
} from "./config.js";
import { weightedChoice, getEffectivePitcherStats } from "./pitchEngine.js";

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// 0. 번트 시도 판정 (컨택과 선구 스탯 반영)
export function resolveBunt(batter, pitchOutcome, strikes) {
  // 빠진 볼이나 폭투에는 번트 실패/볼 처리 가능성 높음
  if (pitchOutcome === "WIDE_BALL" || pitchOutcome === "WILD_PITCH") {
    return { type: "SWING_MISS", text: "빠진 공에 번트를 대지 못해 헛스윙 스트라이크!" };
  }

  const avgStat = (batter.contact + batter.eye) / 2;
  const diff = avgStat - STAT_CONFIG.AVG_STAT;
  const fairProb = clamp(BUNT_CONFIG.BASE_FAIR_PROB + diff * BUNT_CONFIG.STAT_MOD, 0.30, 0.88);
  const foulProb = clamp(BUNT_CONFIG.BASE_FOUL_PROB - diff * 0.015, 0.08, 0.45);

  const r = Math.random();
  if (r < fairProb) {
    // 인플레이 번트 성공 -> 희생번트 아웃 vs 기습번트 내야안타
    const hitProb = clamp(0.14 + (batter.speed - 5) * 0.025, 0.04, 0.35);
    if (Math.random() < hitProb) {
      return { type: "BUNT_HIT", text: `${batter.name}의 절묘한 번트 타구! 빠른 발로 1루에서 세이프(번트 안타)!` };
    }
    return { type: "SAC_BUNT", text: `${batter.name}의 희생번트 성공! 타자 주자는 1루에서 아웃되고 주자들이 진루합니다.` };
  } else if (r < fairProb + foulProb) {
    if (strikes >= 2) {
      return { type: "BUNT_FOUL_OUT", text: `2스트라이크 이후 ${batter.name}의 번트 파울! 쓰리번트 아웃!` };
    }
    return { type: "FOUL", text: `${batter.name}의 번트 타구가 파울 라인 밖으로 벗어납니다.` };
  } else {
    return { type: "SWING_MISS", text: `${batter.name}가 번트를 대려 했으나 헛스윙!` };
  }
}

// 4. 컨택 시 타구 유형 결정 (FOUL, GROUNDBALL, FLYBALL, LINEDRIVE_OUT, HIT)
export function resolveBattedBallType(batter, pitcher, pitchOutcome) {
  const eff = getEffectivePitcherStats(pitcher);
  const probs = { ...BASE_BATTED_BALL };

  // 실투일수록 안타/라인드라이브 비중 상승, 보더라인/걸친볼은 파울/범타 증가
  if (pitchOutcome === "MISTAKE") {
    probs.HIT += 0.08;
    probs.FOUL -= 0.05;
    probs.GROUNDBALL -= 0.03;
  } else if (pitchOutcome === "CLOSE_BALL" || pitchOutcome === "WIDE_BALL") {
    probs.FOUL += 0.06;
    probs.HIT -= 0.05;
    probs.GROUNDBALL -= 0.01;
  }

  // 컨택 vs 구위 차이로 안타 확률 미세 조정
  const diff = batter.contact - eff.stuff;
  probs.HIT = clamp(probs.HIT + diff * 0.015, 0.08, 0.38);

  // 정규화
  const sum = Object.values(probs).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(probs)) probs[k] /= sum;

  return weightedChoice(probs);
}

// 4.2 & 4.2.1 담당 수비수 배정 및 수비 실책 판정
export function resolveFielding(battedType, defenseLineup, pitcher) {
  const dist = FIELDER_DISTRIBUTION[battedType];
  const pos = weightedChoice(dist);

  let fielder;
  if (pos === "P") {
    fielder = { name: pitcher.name, pos: "P", defense: 5, arm: 5 };
  } else {
    fielder = defenseLineup.find((p) => p.pos === pos) || { name: `${pos} 수비수`, pos, defense: 5, arm: 5 };
  }

  const defDiff = fielder.defense - STAT_CONFIG.AVG_STAT;
  const errorProb = clamp(ERROR_CONFIG.BASE_PROB + defDiff * ERROR_CONFIG.DEFENSE_MOD, 0.005, 0.12);
  const isError = Math.random() < errorProb;

  return { pos, fielder, isError, errorProb };
}

// 5 & 5.1 안타 시 1루타 / 2루타 / (3루타) / 홈런 결정
export function resolveHitOutcome(batter, pitcher, defenseLineup) {
  const eff = getEffectivePitcherStats(pitcher);
  const powerDiff = batter.power - eff.movement;

  let doubleProb = clamp(BASE_HIT_TYPE.DOUBLE + powerDiff * POWER_VS_MOVEMENT_MOD.DOUBLE, 0.06, 0.38);
  let hrProb = clamp(BASE_HIT_TYPE.HOMERUN + powerDiff * POWER_VS_MOVEMENT_MOD.HOMERUN, 0.01, 0.28);
  let singleProb = Math.max(0.30, 1.0 - doubleProb - hrProb);

  const total = singleProb + doubleProb + hrProb;
  const hitType = weightedChoice({
    SINGLE: singleProb / total,
    DOUBLE: doubleProb / total,
    HOMERUN: hrProb / total,
  });

  if (hitType !== "DOUBLE") {
    return { hitType, tripleAttempted: false, tripleSafe: false, outfielder: null };
  }

  // 5.1 2루타 시 타자 주자의 주루와 외야수 송구 스탯에 따라 3루타 시도 및 판정
  const ofPos = weightedChoice({ LF: 0.25, CF: 0.40, RF: 0.35 });
  const outfielder = defenseLineup.find((p) => p.pos === ofPos) || { name: `${ofPos} 외야수`, pos: ofPos, arm: 5 };

  const statDiff = batter.speed - outfielder.arm;
  const attemptProb = clamp(BASERUNNING_CONFIG.BASE_TRIPLE_ATTEMPT + statDiff * BASERUNNING_CONFIG.TRIPLE_STAT_MOD, 0.02, 0.45);
  const tripleAttempted = Math.random() < attemptProb;

  if (!tripleAttempted) {
    return { hitType: "DOUBLE", tripleAttempted: false, tripleSafe: false, outfielder };
  }

  const safeProb = clamp(BASERUNNING_CONFIG.BASE_TRIPLE_SAFE + statDiff * BASERUNNING_CONFIG.EXTRA_BASE_STAT_MOD, 0.25, 0.95);
  const tripleSafe = Math.random() < safeProb;

  return {
    hitType: tripleSafe ? "TRIPLE" : "DOUBLE_OUT_AT_3B",
    tripleAttempted: true,
    tripleSafe,
    outfielder,
  };
}
