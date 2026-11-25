// ============================================================================
// config.js : 1~9 스탯(5=평균) 기준 확률 파라미터 & 밸런스 설정
// 숫자를 수정하면 시뮬레이션 밸런스가 즉시 반영됩니다.
// ============================================================================

export const STAT_CONFIG = {
  MIN_STAT: 1,
  MAX_STAT: 9,
  AVG_STAT: 5,
  // 투수 체력 1당 최대 투구수 환산 (예: 체력 10 -> ~100구, 체력 3 -> ~30구)
  PITCHES_PER_STAMINA: 10,
  PICKOFF_STAMINA_COST: 3,      // 견제 1회당 체력(투구수 환산) 소모량
  MAX_PICKOFFS_PER_PA: 2,       // 타석당 최대 견제 제한
  FATIGUE_THRESHOLD: 0.25,      // 잔여 체력 25% 이하부터 구위/제구 페널티
};

// 2. 투구 결과 기본 확률 (제구=5, 일반적 투구 기준, 합계 = 1.00)
export const BASE_PITCH_OUTCOME = {
  MISTAKE: 0.16,      // 실투 (몰린 스트)
  BORDERLINE: 0.34,   // 보더라인 (걸친 스트)
  CLOSE_BALL: 0.28,   // 걸친 볼
  WIDE_BALL: 0.20,    // 빠진 볼
  WILD_PITCH: 0.02,   // 폭투
};

// 투수 제구 스탯(1~9, 5=평균) 1포인트당 확률 보정
// 제구 높을수록 보더라인 상승, 실투/빠진볼/폭투 감소
export const CONTROL_MOD_PER_POINT = {
  MISTAKE: -0.015,
  BORDERLINE: +0.032,
  CLOSE_BALL: +0.005,
  WIDE_BALL: -0.019,
  WILD_PITCH: -0.003,
};

// 감독 투구 주문에 따른 확률 변화량
// 적극적 공략: 볼 감소, 보더라인 소폭 상승, 실투 대폭 상승
// 유인구: 볼/빠진볼/폭투 상승, 보더라인 소폭 하락, 실투 대폭 하락
export const PITCH_ORDER_MOD = {
  AGGRESSIVE: {
    MISTAKE: +0.11,
    BORDERLINE: +0.04,
    CLOSE_BALL: -0.07,
    WIDE_BALL: -0.07,
    WILD_PITCH: -0.01,
  },
  NORMAL: {
    MISTAKE: 0,
    BORDERLINE: 0,
    CLOSE_BALL: 0,
    WIDE_BALL: 0,
    WILD_PITCH: 0,
  },
  CHASE: {
    MISTAKE: -0.10,
    BORDERLINE: -0.04,
    CLOSE_BALL: +0.05,
    WIDE_BALL: +0.07,
    WILD_PITCH: +0.02,
  },
};

// 3. 투구 결과별 기본 스윙 확률 (타자 선구=5 기준)
// 선구(신중함)가 높을수록 유인구/볼에 덜 속고, 실투/스트에 더 공격적
export const BASE_SWING_PROB = {
  MISTAKE: 0.78,
  BORDERLINE: 0.62,
  CLOSE_BALL: 0.32,
  WIDE_BALL: 0.08,
  WILD_PITCH: 0.04,
};

// 타자 선구(1~9) 1포인트당 스윙 확률 변화
export const EYE_SWING_MOD = {
  MISTAKE: +0.025,     // 선구 좋을수록 실투는 잘 노림
  BORDERLINE: +0.005,
  CLOSE_BALL: -0.035,  // 선구 좋을수록 걸친 볼 참아냄
  WIDE_BALL: -0.015,
  WILD_PITCH: -0.008,
};

// 3.1 노스윙 시 스트라이크 판정 확률 (보더라인/걸친 볼의 심판 존 판정 포함)
export const NOSWING_STRIKE_PROB = {
  MISTAKE: 1.00,
  BORDERLINE: 0.85,
  CLOSE_BALL: 0.15,
  WIDE_BALL: 0.00,
  WILD_PITCH: 0.00,
};

// 3.2 스윙 시 기본 컨택 확률 (컨택=5, 구위=5 기준)
export const BASE_CONTACT_PROB = {
  MISTAKE: 0.90,
  BORDERLINE: 0.76,
  CLOSE_BALL: 0.56,
  WIDE_BALL: 0.30,
  WILD_PITCH: 0.12,
};

// 컨택 vs 구위 1포인트 차이당 컨택 확률 변화
export const CONTACT_VS_STUFF_MOD = 0.032;

// 0. 번트 성공 기본 확률 (컨택=5, 선구=5 기준)
export const BUNT_CONFIG = {
  BASE_FAIR_PROB: 0.62,         // 인플레이 번트 성공 확률
  BASE_FOUL_PROB: 0.28,         // 번트 파울 확률 (2스트라이크면 아웃)
  STAT_MOD: 0.03,               // (컨택+선구 평균 - 5) * 0.03
  SACRIFICE_OUT_PROB: 0.82,     // 번트 인플레이 시 희생번트 아웃(주자 진루) 비중 (나머지는 내야안타)
};

// 4. 컨택 시 타구 결과 기본 분포 (합계 = 1.00)
export const BASE_BATTED_BALL = {
  FOUL: 0.34,
  GROUNDBALL: 0.24,
  FLYBALL: 0.16,
  LINEDRIVE_OUT: 0.06,
  HIT: 0.20,
};

// 4.2 아웃성 타구별 수비수 분배 가중치
export const FIELDER_DISTRIBUTION = {
  GROUNDBALL: { P: 0.12, C: 0.04, "1B": 0.16, "2B": 0.26, "3B": 0.16, SS: 0.26 },
  FLYBALL: { "1B": 0.04, "2B": 0.06, "3B": 0.04, SS: 0.06, LF: 0.27, CF: 0.28, RF: 0.25 },
  LINEDRIVE_OUT: { P: 0.10, "1B": 0.14, "2B": 0.16, "3B": 0.14, SS: 0.16, LF: 0.10, CF: 0.10, RF: 0.10 },
};

// 4.2.1 수비 실책 확률 (수비=5 기준 약 3.5%, 스탯 1당 0.6% 변동)
export const ERROR_CONFIG = {
  BASE_PROB: 0.035,
  DEFENSE_MOD: -0.006,
};

// 5. 안타 시 1루타 / 2루타 / 홈런 기본 비율 (파워=5, 변화=5 기준)
export const BASE_HIT_TYPE = {
  SINGLE: 0.72,
  DOUBLE: 0.19,
  HOMERUN: 0.09,
};

// 파워 vs 변화 1포인트 차이당 장타 이동량
export const POWER_VS_MOVEMENT_MOD = {
  DOUBLE: 0.016,
  HOMERUN: 0.014,
};

// 5.1 2루타 -> 3루타 전환 & 5.2 추가 진루 & 도루·견제 기본 확률
export const BASERUNNING_CONFIG = {
  BASE_STEAL_SUCCESS: 0.72,      // 주루=5 vs 포수 송구=5
  STEAL_STAT_MOD: 0.045,         // 스탯 1포인트 차이당
  CHASE_PITCH_STEAL_BONUS: 0.05, // 유인구(변화구)일 때 도루 유리
  BASE_PICKOFF_OUT: 0.07,        // 견제 아웃 기본 확률
  PICKOFF_STAT_MOD: 0.015,       // 견제력(제구) vs 주루 차이
  BASE_TRIPLE_ATTEMPT: 0.14,     // 2루타 시 3루타 시도 확률
  TRIPLE_STAT_MOD: 0.025,
  BASE_TRIPLE_SAFE: 0.78,        // 3루타 시도 시 세이프 확률
  EXTRA_BASE_SAFE: 0.68,         // 추가 진루 명령 시 세이프 확률
  EXTRA_BASE_STAT_MOD: 0.045,
};
