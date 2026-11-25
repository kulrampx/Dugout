// ============================================================================
// gameEngine.js : 경기 상태 관리 및 1구 단위 마스터 시뮬레이션 엔진
// ============================================================================
import { STAT_CONFIG } from "./config.js";
import { resolvePitch, resolveSwingDecision, resolveNoSwingCall, resolveContact, getEffectivePitcherStats } from "./pitchEngine.js";
import { resolveBunt, resolveBattedBallType, resolveFielding, resolveHitOutcome } from "./battedBallEngine.js";
import { resolvePickoff, resolveStealPlay, resolveExtraBaseAdvancement } from "./baserunningEngine.js";

export class BaseballGame {
  constructor(awayTeam, homeTeam) {
    this.teams = {
      away: this._initTeam(awayTeam),
      home: this._initTeam(homeTeam),
    };
    this.inning = 1;
    this.isTop = true; // true = 초(원정 공격), false = 말(홈 공격)
    this.outs = 0;
    this.count = { balls: 0, strikes: 0 };
    this.bases = { 1: null, 2: null, 3: null };
    this.pickoffsThisPA = 0;
    this.pendingExtraBase = null; // 5.2 안타 후 추가 진루 대기 상태
    this.gameOver = false;
    this.logs = [];
    this.inningScores = { away: [0], home: [] };

    this._log(`⚾ 경기 시작! ${this.teams.away.name}(원정) vs ${this.teams.home.name}(홈)`);
    this._log(`선발 투수: ${this.getPitcher().name}(체${this.getPitcher().stamina}/제${this.getPitcher().control}/구${this.getPitcher().stuff}/변${this.getPitcher().movement})`);
  }

  _initTeam(team) {
    const pitchers = team.pitchers.map((p) => ({
      ...p,
      pitchesThrown: 0,
      outsRecorded: 0,
      runsAllowed: 0,
      strikeouts: 0,
      walks: 0,
      hitsAllowed: 0,
    }));
    const batters = team.batters.map((b) => ({
      ...b,
      pa: 0,
      ab: 0,
      hits: 0,
      hr: 0,
      rbi: 0,
      bb: 0,
      so: 0,
      sb: 0,
    }));
    return {
      name: team.name,
      score: 0,
      hits: 0,
      errors: 0,
      batters,
      batterIdx: 0,
      pitchers,
      pitcherIdx: 0,
    };
  }

  getOffense() {
    return this.isTop ? this.teams.away : this.teams.home;
  }

  getDefense() {
    return this.isTop ? this.teams.home : this.teams.away;
  }

  getBatter() {
    const off = this.getOffense();
    return off.batters[off.batterIdx];
  }

  getPitcher() {
    const def = this.getDefense();
    return def.pitchers[def.pitcherIdx];
  }

  changePitcher(newPitcherIdx) {
    const def = this.getDefense();
    if (newPitcherIdx >= 0 && newPitcherIdx < def.pitchers.length && newPitcherIdx !== def.pitcherIdx) {
      def.pitcherIdx = newPitcherIdx;
      const p = this.getPitcher();
      this._log(`🔄 [투수 교체] ${def.name} 투수 교체 -> ${p.name} (체${p.stamina}/제${p.control}/구${p.stuff}/변${p.movement})`);
    }
  }

  _log(msg, tag = "INFO") {
    this.logs.unshift({
      id: Date.now() + Math.random(),
      inning: `${this.inning}회${this.isTop ? "초" : "말"}`,
      count: `${this.count.balls}B-${this.count.strikes}S`,
      outs: `${this.outs}사`,
      tag,
      msg,
    });
  }

  _addScore(runs, batter = null) {
    if (runs <= 0) return;
    const off = this.getOffense();
    off.score += runs;
    if (batter) batter.rbi += runs;
    const side = this.isTop ? "away" : "home";
    const idx = this.inning - 1;
    while (this.inningScores[side].length <= idx) this.inningScores[side].push(0);
    this.inningScores[side][idx] += runs;
  }

  _nextBatter() {
    const off = this.getOffense();
    off.batterIdx = (off.batterIdx + 1) % off.batters.length;
    this.count = { balls: 0, strikes: 0 };
    this.pickoffsThisPA = 0;
  }

  _recordOuts(count) {
    const pitcher = this.getPitcher();
    this.outs += count;
    pitcher.outsRecorded += count;
    if (this.outs >= 3) {
      this._endHalfInning();
      return true;
    }
    return false;
  }

  _endHalfInning() {
    this._log(`📣 ${this.inning}회${this.isTop ? "초" : "말"} 종료 (현재 스코어 ${this.teams.away.name} ${this.teams.away.score} : ${this.teams.home.score} ${this.teams.home.name})`, "INNING");
    this.outs = 0;
    this.count = { balls: 0, strikes: 0 };
    this.bases = { 1: null, 2: null, 3: null };
    this.pickoffsThisPA = 0;
    this.pendingExtraBase = null;

    if (this.isTop) {
      // 9회초 종료 후 홈팀이 이미 앞서면 경기 종료
      if (this.inning >= 9 && this.teams.home.score > this.teams.away.score) {
        this.gameOver = true;
        this._log(`🏆 경기 종료! ${this.teams.home.name} 승리 (${this.teams.away.score} : ${this.teams.home.score})`, "END");
        return;
      }
      this.isTop = false;
      if (this.inningScores.home.length < this.inning) this.inningScores.home.push(0);
    } else {
      if (this.inning >= 9 && this.teams.away.score !== this.teams.home.score) {
        this.gameOver = true;
        const winner = this.teams.away.score > this.teams.home.score ? this.teams.away.name : this.teams.home.name;
        this._log(`🏆 경기 종료! ${winner} 승리 (${this.teams.away.score} : ${this.teams.home.score})`, "END");
        return;
      }
      this.inning += 1;
      this.isTop = true;
      this.inningScores.away.push(0);
    }
  }

  // 1.2 견제 실행 (투구 전 수비 감독 지시)
  executePickoff(targetBase) {
    if (this.gameOver || this.pendingExtraBase) return;
    if (this.pickoffsThisPA >= STAT_CONFIG.MAX_PICKOFFS_PER_PA) {
      this._log(`⚠️ 타석당 견제 제한(${STAT_CONFIG.MAX_PICKOFFS_PER_PA}회)에 도달했습니다.`, "WARN");
      return;
    }
    const pitcher = this.getPitcher();
    const res = resolvePickoff(this.bases, targetBase, pitcher, this.getDefense().batters);
    if (!res.valid) {
      this._log(`⚠️ ${res.text}`, "WARN");
      return;
    }

    pitcher.pitchesThrown += STAT_CONFIG.PICKOFF_STAMINA_COST;
    this.pickoffsThisPA += 1;
    this._log(res.text, res.out ? "OUT" : "PICKOFF");

    if (res.out) {
      this.bases[targetBase] = null;
      this._recordOuts(1);
    }
  }

  // 5.2 안타 이후 추가 진루 명령 처리
  executeExtraBase(decision) {
    if (!this.pendingExtraBase) return;
    const { outfielder } = this.pendingExtraBase;

    if (decision === "HOLD") {
      this._log(`🛑 공격 팀 감독 주자 정지 지시. 루상 주자들이 현재 베이스에 멈춥니다.`);
      this.pendingExtraBase = null;
      return;
    }

    // decision 예시: { from: 2, to: 4 } 또는 { from: 1, to: 3 }
    const res = resolveExtraBaseAdvancement({
      bases: this.bases,
      runnerFromBase: decision.from,
      targetBase: decision.to,
      outfielder,
    });

    this.pendingExtraBase = null;
    if (!res.valid) return;

    const runner = this.bases[decision.from];
    this.bases[decision.from] = null;
    this._log(res.text, res.safe ? "SCORE" : "OUT");

    if (res.safe) {
      if (decision.to === 4) {
        this._addScore(1, this.getOffense().batters[(this.getOffense().batterIdx + 8) % 9]);
      } else {
        this.bases[decision.to] = runner;
      }
    } else {
      this._recordOuts(1);
    }
  }

  // 메인 1구 실행: 0.번트 -> 1.도루 -> 1.1타격주문 -> 2.투구 -> 3.스윙/노스윙 -> 4.타구 -> 5.안타
  stepPitch({
    bunt = false,
    stealPlan = "NONE",
    batterOrder = "NORMAL",
    pitchOrder = "NORMAL",
    defenseThrow = "THROW_2B",
  } = {}) {
    if (this.gameOver) return;
    if (this.pendingExtraBase) {
      this._log("⚠️ 먼저 추가 진루 여부를 결정해 주세요.", "WARN");
      return;
    }

    const batter = this.getBatter();
    const pitcher = this.getPitcher();
    const defenseLineup = this.getDefense().batters;

    // 0. 번트 지시 시 1.1(타격 주문)은 생략
    const effectiveBatterOrder = bunt ? "BUNT" : batterOrder;
    const isStealing = stealPlan !== "NONE";

    // 투구 수 증가
    pitcher.pitchesThrown += 1;
    const effPitcher = getEffectivePitcherStats(pitcher);

    // 2. 투구 결과 판정 (MISTAKE, BORDERLINE, CLOSE_BALL, WIDE_BALL, WILD_PITCH)
    const { outcome: pitchOutcome } = resolvePitch(pitcher, pitchOrder);
    const pitchLabelMap = {
      MISTAKE: "실투(몰린 스트라이크)",
      BORDERLINE: "보더라인 스트라이크",
      CLOSE_BALL: "걸친 볼",
      WIDE_BALL: "빠진 볼",
      WILD_PITCH: "폭투!",
    };
    const orderLabelMap = { AGGRESSIVE: "적극적 공략", NORMAL: "일반적 투구", CHASE: "유인구" };
    this._log(
      `⚾ [${pitcher.name} 투구 - ${orderLabelMap[pitchOrder]}${effPitcher.isTired ? "/체력저하" : ""}] → ${pitchLabelMap[pitchOutcome]}`,
      "PITCH"
    );

    // 폭투(WILD_PITCH) 시 주자 자동 진루
    if (pitchOutcome === "WILD_PITCH" && (this.bases[1] || this.bases[2] || this.bases[3])) {
      this._advanceAllRunnersOneBase("폭투로 인해 루상의 주자들이 한 베이스씩 진루합니다!");
    }

    // 0. 번트 처리 분기
    if (bunt) {
      const buntRes = resolveBunt(batter, pitchOutcome, this.count.strikes);
      this._log(`🏏 [번트 작전] ${buntRes.text}`, "BUNT");

      if (buntRes.type === "BUNT_HIT") {
        this._advanceRunnersOnSingle(batter, false);
        batter.pa += 1; batter.ab += 1; batter.hits += 1;
        this.getOffense().hits += 1; pitcher.hitsAllowed += 1;
        this._nextBatter();
        return;
      }
      if (buntRes.type === "SAC_BUNT") {
        batter.pa += 1;
        this._advanceAllRunnersOneBase("희생번트로 주자 진루!");
        if (!this._recordOuts(1)) this._nextBatter();
        return;
      }
      if (buntRes.type === "BUNT_FOUL_OUT") {
        batter.pa += 1; batter.ab += 1;
        if (!this._recordOuts(1)) this._nextBatter();
        return;
      }
      if (buntRes.type === "FOUL") {
        this.count.strikes += 1;
        return;
      }
      if (buntRes.type === "SWING_MISS") {
        this._handleStrike(batter, pitcher, isStealing, stealPlan, defenseThrow, pitchOutcome);
        return;
      }
    }

    // 3. 스윙 vs 노스윙 결정
    const swingDec = resolveSwingDecision(batter, pitchOutcome, effectiveBatterOrder, this.count);

    // 3.1 노스윙 시
    if (!swingDec.swung) {
      const call = resolveNoSwingCall(pitchOutcome);
      if (call.isStrike) {
        this._log(`👀 ${batter.name} 노스윙 (${swingDec.reason}) → 루킹 스트라이크!`, "STRIKE");
        this._handleStrike(batter, pitcher, isStealing, stealPlan, defenseThrow, pitchOutcome);
      } else {
        this._log(`👀 ${batter.name} 노스윙 (${swingDec.reason}) → 볼!`, "BALL");
        this._handleBall(batter, pitcher, isStealing, stealPlan, defenseThrow, pitchOutcome);
      }
      return;
    }

    // 3.2 스윙 시 -> 컨택 vs 헛스윙
    const contactRes = resolveContact(batter, pitcher, pitchOutcome);
    if (!contactRes.contacted) {
      this._log(`💨 ${batter.name} 풀스윙 헛스윙! (컨택률 ${(contactRes.contactProb * 100).toFixed(0)}%)`, "STRIKE");
      this._handleStrike(batter, pitcher, isStealing, stealPlan, defenseThrow, pitchOutcome);
      return;
    }

    // 3.2.2 컨택 성공! 도루 발생 시 기존 주자들은 한 베이스 앞에 있는 것으로 취급
    const activeBases = isStealing ? this._shiftBasesForSteal(this.bases) : { ...this.bases };
    if (isStealing) {
      this._log(`⚡ 컨택 성공! 도루 출발한 주자들이 한 베이스 앞선 상태에서 타구가 진행됩니다.`, "PLAY");
    }

    // 4. 타구 결과 결정 (FOUL, GROUNDBALL, FLYBALL, LINEDRIVE_OUT, HIT)
    const battedType = resolveBattedBallType(batter, pitcher, pitchOutcome);

    // 4.1 파울 (2스트라이크 전까지 스트라이크 취급)
    if (battedType === "FOUL") {
      if (this.count.strikes < 2) {
        this.count.strikes += 1;
        this._log(`💥 파울 타구! (${this.count.balls}B-${this.count.strikes}S)`, "FOUL");
      } else {
        this._log(`💥 2스트라이크 이후 커트 파울! 카운트 유지 (${this.count.balls}B-${this.count.strikes}S)`, "FOUL");
      }
      return;
    }

    // 4.2 땅볼, 뜬공, 라인드라이브 아웃
    if (battedType === "GROUNDBALL" || battedType === "FLYBALL" || battedType === "LINEDRIVE_OUT") {
      const fielding = resolveFielding(battedType, defenseLineup, pitcher);
      const typeName = { GROUNDBALL: "땅볼", FLYBALL: "뜬공", LINEDRIVE_OUT: "라인드라이브" }[battedType];

      // 4.2.1 실책 판정
      if (fielding.isError) {
        this.getDefense().errors += 1;
        batter.pa += 1;
        this._log(`🚨 [수비 실책!] ${fielding.pos} ${fielding.fielder.name}(수비 ${fielding.fielder.defense})가 ${typeName} 타구를 놓쳤습니다! 타자 출루!`, "ERROR");
        this._advanceRunnersOnSingle(batter, false, activeBases);
        this._nextBatter();
        return;
      }

      // 4.3 내야수나 투수 라인드라이브 아웃인데 이미 도루한 주자들이 있을 경우 더블 아웃
      const isInfieldOrPitcher = ["P", "1B", "2B", "3B", "SS"].includes(fielding.pos);
      if (battedType === "LINEDRIVE_OUT" && isInfieldOrPitcher && isStealing) {
        batter.pa += 1; batter.ab += 1;
        const stolenRunnerCount = [this.bases[1], this.bases[2], this.bases[3]].filter(Boolean).length;
        const doubleOuts = Math.min(2, 1 + stolenRunnerCount);
        this._log(`🔥 [라인드라이브 더블아웃!] ${fielding.pos} ${fielding.fielder.name} 직선타 캐치 후 도루 스타트한 주자까지 아웃 처리! (${doubleOuts}아웃)`, "OUT");
        if (!this._recordOuts(doubleOuts)) {
          this.bases = { 1: null, 2: null, 3: null };
          this._nextBatter();
        }
        return;
      }

      // 일반 범타 아웃 처리 (땅볼 병살 / 외야 뜬공 희생플라이 포함)
      batter.pa += 1; batter.ab += 1;
      if (battedType === "GROUNDBALL" && this.outs < 2 && activeBases[1]) {
        // 병살타 처리
        this._log(`⚾ ${fielding.pos} ${fielding.fielder.name} 앞 땅볼 → 4-6-3 병살타!`, "OUT");
        const r3 = activeBases[3];
        if (r3 && this.outs === 0) {
          this._addScore(1);
          this._log(`🏃 3루 주자 ${r3.name} 병살타 사이 홈 득점!`, "SCORE");
        }
        this.bases = { 1: null, 2: activeBases[2] ? activeBases[2] : null, 3: null };
        if (!this._recordOuts(2)) this._nextBatter();
        return;
      }

      // 외야 뜬공 희생플라이 (2사 미만 + 3루 주자)
      if (battedType === "FLYBALL" && this.outs < 2 && activeBases[3]) {
        const sacRunner = activeBases[3];
        activeBases[3] = null;
        this.bases = activeBases;
        batter.ab -= 1; // 희생플라이 타수 제외
        this._addScore(1, batter);
        this._log(`🕊️ ${fielding.pos} ${fielding.fielder.name} 뜬공 아웃! 3루 주자 ${sacRunner.name} 태그업 희생플라이 득점!`, "SCORE");
        if (!this._recordOuts(1)) this._nextBatter();
        return;
      }

      this.bases = activeBases;
      this._log(`⚾ ${fielding.pos} ${fielding.fielder.name} ${typeName} 아웃!`, "OUT");
      if (!this._recordOuts(1)) this._nextBatter();
      return;
    }

    // 4.4 안타 -> 5. 1루타, 2루타, (3루타), 홈런 결정
    if (battedType === "HIT") {
      const hitRes = resolveHitOutcome(batter, pitcher, defenseLineup);
      batter.pa += 1; batter.ab += 1; batter.hits += 1;
      this.getOffense().hits += 1;
      pitcher.hitsAllowed += 1;

      if (hitRes.hitType === "HOMERUN") {
        const runnersOn = [activeBases[1], activeBases[2], activeBases[3]].filter(Boolean);
        const totalRuns = 1 + runnersOn.length;
        batter.hr += 1;
        this.bases = { 1: null, 2: null, 3: null };
        this._addScore(totalRuns, batter);
        this._log(`🎆 [홈런!!] ${batter.name}의 담장을 넘어가는 ${totalRuns}점 홈런!`, "HR");
        this._nextBatter();
        return;
      }

      if (hitRes.hitType === "TRIPLE") {
        const runs = this._scoreAllRunners(activeBases, batter);
        this.bases = { 1: null, 2: null, 3: batter };
        this._log(`🔥 [3루타!!] ${batter.name}(주루 ${batter.speed})가 외야수 ${hitRes.outfielder.name}(송구 ${hitRes.outfielder.arm})의 송구를 따돌리고 3루까지 질주! (${runs}타점)`, "HIT");
        this._nextBatter();
        return;
      }

      if (hitRes.hitType === "DOUBLE_OUT_AT_3B") {
        const runs = this._scoreAllRunners(activeBases, batter);
        this.bases = { 1: null, 2: null, 3: null };
        this._log(`💥 [2루타 후 3루 주루사!] ${batter.name}가 3루까지 노렸으나 ${hitRes.outfielder.name}의 송구에 아웃! (선행 주자 ${runs}득점 인정)`, "OUT");
        if (!this._recordOuts(1)) this._nextBatter();
        return;
      }

      if (hitRes.hitType === "DOUBLE") {
        const { runs, remainingBases } = this._advanceRunnersOnDouble(batter, activeBases);
        this.bases = remainingBases;
        this._log(`🔥 [2루타!] ${batter.name}의 장타! (${runs}타점)`, "HIT");
        this._checkExtraBaseOpportunity(hitRes.outfielder);
        this._nextBatter();
        return;
      }

      // SINGLE (1루타)
      const of = defenseLineup.find((p) => p.pos === "CF") || { name: "중견수", arm: 5 };
      const { runs, remainingBases } = this._advanceRunnersOnSingle(batter, true, activeBases);
      this.bases = remainingBases;
      this._log(`🏏 [1루타!] ${batter.name}의 깔끔한 안타! (${runs}타점)`, "HIT");
      this._checkExtraBaseOpportunity(of);
      this._nextBatter();
    }
  }

  _handleStrike(batter, pitcher, isStealing, stealPlan, defenseThrow, pitchOutcome) {
    this.count.strikes += 1;

    // 3.1.1 & 3.2.1 도루 발생 시 포수 송구 / 투수 커트 판정
    if (isStealing) {
      const stealRes = resolveStealPlay({
        bases: this.bases,
        stealPlan,
        defenseThrowDecision: defenseThrow,
        defenseLineup: this.getDefense().batters,
        pitchOutcome,
      });
      this.bases = stealRes.bases;
      stealRes.logs.forEach((l) => this._log(l, "STEAL"));
      if (stealRes.runsAdded > 0) this._addScore(stealRes.runsAdded);
      if (stealRes.outsAdded > 0 && this._recordOuts(stealRes.outsAdded)) return;
    }

    if (this.count.strikes >= 3) {
      batter.pa += 1; batter.ab += 1; batter.so += 1;
      pitcher.strikeouts += 1;
      this._log(`🔥 삼진 아웃! (${batter.name})`, "OUT");
      if (!this._recordOuts(1)) this._nextBatter();
    }
  }

  _handleBall(batter, pitcher, isStealing, stealPlan, defenseThrow, pitchOutcome) {
    this.count.balls += 1;

    // 볼넷(4볼)이면 도루와 무관하게 포스 진루 처리
    if (this.count.balls >= 4) {
      batter.pa += 1; batter.bb += 1;
      pitcher.walks += 1;
      this._log(`🚶 볼넷 출루! (${batter.name})`, "WALK");
      this._advanceRunnersOnWalk(batter);
      this._nextBatter();
      return;
    }

    // 3.1.1 볼 카운트 중 도루 발생 시 포수 송구 / 투수 커트
    if (isStealing) {
      const stealRes = resolveStealPlay({
        bases: this.bases,
        stealPlan,
        defenseThrowDecision: defenseThrow,
        defenseLineup: this.getDefense().batters,
        pitchOutcome,
      });
      this.bases = stealRes.bases;
      stealRes.logs.forEach((l) => this._log(l, "STEAL"));
      if (stealRes.runsAdded > 0) this._addScore(stealRes.runsAdded);
      if (stealRes.outsAdded > 0 && this._recordOuts(stealRes.outsAdded)) return;
    }
  }

  _shiftBasesForSteal(bases) {
    // 3.2.2 도루 중 컨택 시 기존 주자들은 한 베이스 앞선 것으로 취급
    if (bases[3]) {
      this._addScore(1);
      this._log(`🏃 도루 출발했던 3루 주자 ${bases[3].name} 컨택과 동시에 홈인!`, "SCORE");
    }
    return {
      1: null,
      2: bases[1],
      3: bases[2],
    };
  }

  _advanceAllRunnersOneBase(reasonText) {
    let runs = 0;
    if (this.bases[3]) runs += 1;
    this.bases = {
      1: null,
      2: this.bases[1],
      3: this.bases[2],
    };
    if (runs > 0) this._addScore(runs);
    this._log(`🏃 ${reasonText}${runs > 0 ? ` (${runs}득점)` : ""}`, "PLAY");
  }

  _advanceRunnersOnWalk(batter) {
    let runs = 0;
    const b = { ...this.bases };
    if (b[1] && b[2] && b[3]) {
      runs += 1;
      b[3] = b[2];
      b[2] = b[1];
      b[1] = batter;
    } else if (b[1] && b[2]) {
      b[3] = b[2];
      b[2] = b[1];
      b[1] = batter;
    } else if (b[1]) {
      b[2] = b[1];
      b[1] = batter;
    } else {
      b[1] = batter;
    }
    this.bases = b;
    if (runs > 0) {
      this._addScore(runs, batter);
      this._log(`🏃 밀어내기 볼넷 득점!`, "SCORE");
    }
  }

  _advanceRunnersOnSingle(batter, countRbi = true, sourceBases = this.bases) {
    let runs = 0;
    if (sourceBases[3]) runs += 1;
    const remainingBases = {
      1: batter,
      2: sourceBases[1],
      3: sourceBases[2],
    };
    if (runs > 0) this._addScore(runs, countRbi ? batter : null);
    return { runs, remainingBases };
  }

  _advanceRunnersOnDouble(batter, sourceBases = this.bases) {
    let runs = 0;
    if (sourceBases[3]) runs += 1;
    if (sourceBases[2]) runs += 1;
    const remainingBases = {
      1: null,
      2: batter,
      3: sourceBases[1],
    };
    if (runs > 0) this._addScore(runs, batter);
    return { runs, remainingBases };
  }

  _scoreAllRunners(sourceBases, batter) {
    let runs = 0;
    if (sourceBases[1]) runs += 1;
    if (sourceBases[2]) runs += 1;
    if (sourceBases[3]) runs += 1;
    if (runs > 0) this._addScore(runs, batter);
    return runs;
  }

  // 5.2 안타 후 추가 진루 선택지 생성 (예: 3루 주자 홈 도전, 2루 주자 3루 도전)
  _checkExtraBaseOpportunity(outfielder) {
    if (this.outs >= 3 || this.gameOver) return;
    const options = [];
    if (this.bases[3]) {
      options.push({ from: 3, to: 4, label: `3루 주자 ${this.bases[3].name} → 홈 쇄도 도전` });
    }
    if (this.bases[2] && !this.bases[3]) {
      options.push({ from: 2, to: 3, label: `2루 주자 ${this.bases[2].name} → 3루 추가 진루 도전` });
    }
    if (options.length > 0) {
      this.pendingExtraBase = { outfielder, options };
      this._log(`⚡ [5.2 추가 진루 기회] 공격 팀 감독이 루상 주자의 추가 진루 여부를 선택할 수 있습니다.`, "DECISION");
    }
  }
}
