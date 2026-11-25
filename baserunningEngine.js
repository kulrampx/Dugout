// ============================================================================
// baserunningEngine.js : 견제(1.2), 도루/더블스틸/투수 커트(1, 3.1.1, 3.2.1), 추가진루(5.2)
// ============================================================================
import { STAT_CONFIG, BASERUNNING_CONFIG } from "./config.js";

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// 1.2 특정 루 견제 판정
export function resolvePickoff(bases, targetBase, pitcher, defenseLineup) {
  const runner = bases[targetBase];
  if (!runner) {
    return { valid: false, out: false, text: `${targetBase}루에는 주자가 없습니다.` };
  }

  const fielderPos = targetBase === 1 ? "1B" : targetBase === 2 ? "2B" : "3B";
  const fielder = defenseLineup.find((p) => p.pos === fielderPos) || { name: `${fielderPos} 야수`, defense: 5 };

  // 견제 능력은 투수 제구 + 야수 수비 평균으로 계산
  const pickoffSkill = (pitcher.control + fielder.defense) / 2;
  const diff = pickoffSkill - runner.speed;
  const outProb = clamp(
    BASERUNNING_CONFIG.BASE_PICKOFF_OUT + diff * BASERUNNING_CONFIG.PICKOFF_STAT_MOD,
    0.02,
    0.25
  );

  const isOut = Math.random() < outProb;
  if (isOut) {
    return {
      valid: true,
      out: true,
      text: `⚡ 투수 ${pitcher.name}의 기습 ${targetBase}루 견제! ${runner.name} 태그 아웃! (아웃 확률 ${(outProb * 100).toFixed(1)}%)`,
    };
  }
  return {
    valid: true,
    out: false,
    text: `투수 ${pitcher.name}가 ${targetBase}루로 견제구를 던졌으나 ${runner.name}가 귀루합니다. (투수 체력 -${STAT_CONFIG.PICKOFF_STAMINA_COST})`,
  };
}

// 3.1.1 & 3.2.1 노스윙 또는 헛스윙 시 도루 & 포수 송구 / 투수 커트 판정
// stealPlan: "NONE" | "STEAL_2B" | "STEAL_3B" | "DOUBLE_2B_3B" | "DOUBLE_2B_HOME"
// defenseThrowDecision: "NO_THROW" | "THROW_2B" | "THROW_2B_CUT" | "THROW_3B" | "THROW_HOME"
export function resolveStealPlay({
  bases,
  stealPlan,
  defenseThrowDecision,
  defenseLineup,
  pitchOutcome,
}) {
  const catcher = defenseLineup.find((p) => p.pos === "C") || { name: "포수", arm: 5 };
  const chaseBonus = (pitchOutcome === "CLOSE_BALL" || pitchOutcome === "WIDE_BALL")
    ? BASERUNNING_CONFIG.CHASE_PITCH_STEAL_BONUS
    : 0;

  const newBases = { 1: bases[1], 2: bases[2], 3: bases[3] };
  let outsAdded = 0;
  let runsAdded = 0;
  const logs = [];

  const calcStealSuccess = (runner) => {
    const diff = runner.speed - catcher.arm;
    return clamp(
      BASERUNNING_CONFIG.BASE_STEAL_SUCCESS + diff * BASERUNNING_CONFIG.STEAL_STAT_MOD + chaseBonus,
      0.20,
      0.96
    );
  };

  // 단독 2루 도루
  if (stealPlan === "STEAL_2B" && bases[1]) {
    const r1 = bases[1];
    newBases[1] = null;
    if (defenseThrowDecision === "NO_THROW" || defenseThrowDecision === "THROW_3B") {
      newBases[2] = r1;
      logs.push(`🏃 ${r1.name}, 포수가 송구하지 않으며 여유 있게 2루 도루 성공!`);
    } else {
      const safeProb = calcStealSuccess(r1);
      if (Math.random() < safeProb) {
        newBases[2] = r1;
        logs.push(`🏃 ${r1.name} 2루 도루 성공! (포수 ${catcher.name} 송구보다 빨랐습니다, 성공률 ${(safeProb * 100).toFixed(0)}%)`);
      } else {
        outsAdded += 1;
        logs.push(`❌ ${r1.name} 2루 도루 실패! 포수 ${catcher.name}의 강한 송구에 태그 아웃!`);
      }
    }
  }

  // 단독 3루 도루
  if (stealPlan === "STEAL_3B" && bases[2]) {
    const r2 = bases[2];
    newBases[2] = null;
    if (defenseThrowDecision !== "THROW_3B") {
      newBases[3] = r2;
      logs.push(`🏃 ${r2.name} 3루 도루 성공!`);
    } else {
      const safeProb = calcStealSuccess(r2) - 0.05;
      if (Math.random() < safeProb) {
        newBases[3] = r2;
        logs.push(`🏃 ${r2.name} 헤드퍼스트 슬라이딩으로 3루 도루 성공!`);
      } else {
        outsAdded += 1;
        logs.push(`❌ ${r2.name} 3루 도루 실패! 태그 아웃!`);
      }
    }
  }

  // 1·2루 더블스틸
  if (stealPlan === "DOUBLE_2B_3B" && bases[1] && bases[2]) {
    const r1 = bases[1];
    const r2 = bases[2];
    newBases[1] = null;
    newBases[2] = null;

    if (defenseThrowDecision === "THROW_3B") {
      newBases[2] = r1;
      const safe3 = calcStealSuccess(r2) - 0.04;
      if (Math.random() < safe3) {
        newBases[3] = r2;
        logs.push(`🏃‍♂️ 더블스틸 전원 성공! ${r2.name}(3루)·${r1.name}(2루) 모두 세이프!`);
      } else {
        outsAdded += 1;
        logs.push(`⚡ 더블스틸 중 3루로 뛰던 ${r2.name} 아웃! (${r1.name}은 2루 안착)`);
      }
    } else if (defenseThrowDecision === "THROW_2B" || defenseThrowDecision === "THROW_2B_CUT") {
      newBases[3] = r2;
      const safe2 = calcStealSuccess(r1);
      if (Math.random() < safe2) {
        newBases[2] = r1;
        logs.push(`🏃‍♂️ 더블스틸 전원 성공! ${r2.name}(3루)·${r1.name}(2루) 세이프!`);
      } else {
        outsAdded += 1;
        logs.push(`⚡ 더블스틸 중 2루로 뛰던 ${r1.name} 아웃! (${r2.name}은 3루 안착)`);
      }
    } else {
      newBases[2] = r1;
      newBases[3] = r2;
      logs.push(`🏃‍♂️ 수비 송구 포기! ${r2.name}(3루)·${r1.name}(2루) 더블스틸 성공!`);
    }
  }

  // 1·3루 더블스틸 (규칙 3.1.1 / 3.2.1 핵심: 2루 송구 시 투수 커트 선택 가능 -> 커트하면 홈 주자 아웃!)
  if (stealPlan === "DOUBLE_2B_HOME" && bases[1] && bases[3]) {
    const r1 = bases[1];
    const r3 = bases[3];
    newBases[1] = null;
    newBases[3] = null;

    if (defenseThrowDecision === "THROW_2B_CUT") {
      // 투수 커트: 1루 주자는 2루에 들어가지만, 2루 송구를 보고 홈으로 뛰던 3루 주자가 잡힘
      newBases[2] = r1;
      outsAdded += 1;
      logs.push(`🎯 [투수 커트 작전 적중!] 포수 ${catcher.name}의 2루 송구를 투수가 커트해 홈으로 쇄도하던 ${r3.name}을 태그 아웃! (${r1.name}는 2루 진루)`);
    } else if (defenseThrowDecision === "THROW_2B") {
      // 투수가 커트하지 않고 2루까지 송구가 빠짐 -> 3루 주자 홈인, 2루 주자 판정
      runsAdded += 1;
      const safe2 = calcStealSuccess(r1);
      if (Math.random() < safe2) {
        newBases[2] = r1;
        logs.push(`🔥 [1·3루 더블스틸 대성공!] 포수가 2루로 던진 사이 3루 주자 ${r3.name} 홈인! ${r1.name}도 2루 세이프!`);
      } else {
        outsAdded += 1;
        logs.push(`🔥 2루 송구 사이 3루 주자 ${r3.name} 홈 득점! 단, 2루로 뛰던 ${r1.name}는 태그 아웃!`);
      }
    } else if (defenseThrowDecision === "THROW_HOME") {
      newBases[2] = r1;
      const safeHome = calcStealSuccess(r3) - 0.12;
      if (Math.random() < safeHome) {
        runsAdded += 1;
        logs.push(`🔥 홈 송구를 뚫고 ${r3.name} 홈 스틸 성공! (${r1.name} 2루 진루)`);
      } else {
        outsAdded += 1;
        logs.push(`❌ 포수 ${catcher.name}의 홈 블로킹! 홈으로 뛰던 ${r3.name} 태그 아웃! (${r1.name} 2루 진루)`);
      }
    } else {
      newBases[2] = r1;
      newBases[3] = r3;
      logs.push(`🏃 포수 송구 없이 ${r1.name} 2루 도루 성공 (${r3.name}은 3루 대기)`);
    }
  }

  return { bases: newBases, outsAdded, runsAdded, logs };
}

// 5.2 안타 후 추가 진루 판정 (주자 주루 스탯 vs 외야수 송구 스탯)
export function resolveExtraBaseAdvancement({
  bases,
  runnerFromBase,
  targetBase,
  outfielder,
}) {
  const runner = bases[runnerFromBase];
  if (!runner) return { valid: false, safe: false, text: "해당 루에 주자가 없습니다." };

  const arm = outfielder ? outfielder.arm : 5;
  const diff = runner.speed - arm;
  const safeProb = clamp(
    BASERUNNING_CONFIG.EXTRA_BASE_SAFE + diff * BASERUNNING_CONFIG.EXTRA_BASE_STAT_MOD,
    0.20,
    0.95
  );

  const isSafe = Math.random() < safeProb;
  const destLabel = targetBase === 4 ? "홈" : `${targetBase}루`;
  if (isSafe) {
    return {
      valid: true,
      safe: true,
      safeProb,
      text: `⚡ [추가 진루 성공!] ${runner.name}(주루 ${runner.speed})가 송구(송구 ${arm})를 뚫고 ${destLabel}에 세이프! (성공률 ${(safeProb * 100).toFixed(0)}%)`,
    };
  }
  return {
    valid: true,
    safe: false,
    safeProb,
    text: `❌ [추가 진루 아웃!] ${outfielder ? outfielder.name : "외야수"}(송구 ${arm})의 레이저 송구에 ${runner.name}가 ${destLabel}에서 보살 아웃!`,
  };
}
