/* motions.js — 프로시저럴 동작 정의
 * 각 동작: { label, emoji, period(초), fn(tn) } — tn은 0~1 반복 진행도.
 * fn은 { local:{뼈:라디안}, world:{뼈:절대 방향각}, root:[dx,dy](키 비율), squash } 반환.
 * 화면 좌표는 y가 아래로 증가 → "위"는 -π/2. 양수 회전은 화면상 시계 방향.
 */
"use strict";

const TAU = Math.PI * 2;
const UP = -Math.PI / 2;

const MOTIONS = {
  idle: {
    label: "숨쉬기", emoji: "🙂", period: 3,
    fn(tn) {
      const s = Math.sin(tn * TAU);
      return {
        local: { spine: 0.02 * s, headB: 0.03 * Math.sin(tn * TAU + 1), uarmL: 0.04 * s, uarmR: -0.04 * s },
        root: [0, 0.004 * Math.sin(tn * TAU * 2)],
      };
    },
  },

  dance1: {
    label: "신나는 춤", emoji: "🕺", period: 1.6,
    fn(tn) {
      const ph = tn * TAU;                 // 한 바퀴
      const beat = Math.sin(ph * 2);       // 2박자
      const sway = Math.sin(ph);           // 좌우 흔들기
      return {
        world: {
          uarmL: UP - 0.5 + 0.35 * beat,
          farmL: UP - 0.75 + 0.55 * beat,
          uarmR: UP + 0.5 + 0.35 * beat,
          farmR: UP + 0.75 + 0.55 * beat,
        },
        local: {
          spine: 0.07 * sway,
          headB: 0.10 * Math.sin(ph * 2 + 0.6),
          thighL: 0.16 * Math.max(0, beat), shinL: 0.20 * Math.max(0, beat),
          thighR: -0.16 * Math.max(0, -beat), shinR: -0.20 * Math.max(0, -beat),
        },
        root: [0.035 * sway, -0.035 * Math.abs(beat)],
        squash: 1 - 0.03 * Math.max(0, -Math.sin(ph * 4)),
      };
    },
  },

  disco: {
    label: "디스코", emoji: "🪩", period: 1.8,
    fn(tn) {
      const ph = tn * TAU;
      const a = Math.sin(ph);              // -1(왼팔 위) ~ 1(오른팔 위)
      const b = Math.abs(Math.sin(ph * 2));
      const lUp = a < 0 ? -a : 0, rUp = a > 0 ? a : 0;
      return {
        world: {
          uarmL: UP - 0.3 - 0.6 * lUp + 1.5 * (1 - lUp),
          farmL: UP - 0.15 - 0.75 * lUp + 1.9 * (1 - lUp),
          uarmR: UP + 0.3 + 0.6 * rUp - 1.5 * (1 - rUp),
          farmR: UP + 0.15 + 0.75 * rUp - 1.9 * (1 - rUp),
        },
        local: { spine: -0.10 * a, headB: 0.08 * a },
        root: [0.03 * a, -0.05 * b],
        squash: 1 - 0.05 * (1 - b),
      };
    },
  },

  march: {
    label: "행진", emoji: "🚶", period: 1.1,
    fn(tn) {
      const ph = tn * TAU;
      const s = Math.sin(ph);
      const lift = Math.abs(s);
      return {
        local: {
          thighL: 0.38 * Math.max(0, s), shinL: 0.30 * Math.max(0, s),
          thighR: -0.38 * Math.max(0, -s), shinR: -0.30 * Math.max(0, -s),
          uarmL: -0.35 * s, uarmR: -0.35 * s,
          farmL: -0.18 * s, farmR: -0.18 * s,
          spine: 0.03 * Math.sin(ph * 2),
        },
        root: [0, -0.03 * lift],
      };
    },
  },

  run: {
    label: "달리기", emoji: "🏃", period: 0.7,
    fn(tn) {
      const ph = tn * TAU;
      const s = Math.sin(ph);
      return {
        local: {
          thighL: 0.55 * s, shinL: 0.45 * Math.max(0, s),
          thighR: -0.55 * s, shinR: -0.45 * Math.max(0, -s),
          uarmL: 0.5 * s, uarmR: 0.5 * s,
          farmL: 0.45 + 0.2 * s, farmR: -0.45 + 0.2 * s,
          spine: 0.06,
        },
        root: [0, -0.05 * Math.abs(Math.sin(ph))],
        squash: 1 - 0.02 * Math.abs(Math.cos(ph)),
      };
    },
  },

  jump: {
    label: "점프", emoji: "⛹️", period: 1.4,
    fn(tn) {
      /* 0~0.3 웅크리기 → 0.3~0.75 공중 → 0.75~1 착지 */
      let crouch = 0, air = 0, arms = 0;
      if (tn < 0.3) { crouch = Math.sin((tn / 0.3) * Math.PI); arms = -0.3 * crouch; }
      else if (tn < 0.75) {
        const u = (tn - 0.3) / 0.45;
        air = Math.sin(u * Math.PI); arms = air;
      } else { crouch = Math.sin(((tn - 0.75) / 0.25) * Math.PI) * 0.6; }
      return {
        world: arms > 0 ? {
          uarmL: UP - 0.4 - 0.2 * arms, farmL: UP - 0.6 - 0.2 * arms,
          uarmR: UP + 0.4 + 0.2 * arms, farmR: UP + 0.6 + 0.2 * arms,
        } : {},
        local: {
          thighL: 0.28 * crouch + 0.15 * air, shinL: 0.34 * crouch + 0.2 * air,
          thighR: -0.28 * crouch - 0.15 * air, shinR: -0.34 * crouch - 0.2 * air,
          uarmL: arms <= 0 ? 0.5 * crouch : 0, uarmR: arms <= 0 ? -0.5 * crouch : 0,
        },
        root: [0, -0.22 * air],
        squash: 1 - 0.12 * crouch,
      };
    },
  },

  hello: {
    label: "인사", emoji: "👋", period: 1.6,
    fn(tn) {
      const wig = Math.sin(tn * TAU * 3);
      return {
        world: {
          uarmR: UP + 0.35,
          farmR: UP + 0.35 + 0.45 * wig,
        },
        local: {
          spine: -0.05 + 0.02 * Math.sin(tn * TAU),
          headB: 0.06 * Math.sin(tn * TAU + 1),
          uarmL: 0.05 * Math.sin(tn * TAU),
        },
        root: [0, 0.004 * Math.sin(tn * TAU * 2)],
      };
    },
  },

  hooray: {
    label: "만세", emoji: "🙌", period: 1.2,
    fn(tn) {
      const ph = tn * TAU;
      const hop = Math.abs(Math.sin(ph));
      const wig = Math.sin(ph * 2);
      return {
        world: {
          uarmL: UP - 0.35 + 0.12 * wig, farmL: UP - 0.5 + 0.25 * wig,
          uarmR: UP + 0.35 + 0.12 * wig, farmR: UP + 0.5 + 0.25 * wig,
        },
        local: {
          headB: 0.05 * wig,
          thighL: 0.12 * hop, thighR: -0.12 * hop,
          shinL: 0.15 * hop, shinR: -0.15 * hop,
        },
        root: [0, -0.09 * hop],
        squash: 1 - 0.04 * (1 - hop),
      };
    },
  },

  wiggle: {
    label: "엉덩이춤", emoji: "🍑", period: 1.0,
    fn(tn) {
      const ph = tn * TAU;
      const sway = Math.sin(ph * 2);
      return {
        local: {
          spine: -0.14 * sway,
          headB: 0.10 * sway,
          uarmL: 0.35 + 0.15 * sway, uarmR: -0.35 + 0.15 * sway,
          farmL: 0.4 * sway, farmR: 0.4 * sway,
          thighL: -0.06 * sway, thighR: -0.06 * sway,
        },
        root: [0.05 * sway, -0.012 * Math.abs(sway)],
        squash: 1 - 0.03 * Math.abs(Math.cos(ph * 2)),
      };
    },
  },

  stretch: {
    label: "체조", emoji: "🤸", period: 2.4,
    fn(tn) {
      /* 앞 절반: 스쿼트 / 뒤 절반: 위로 쭉 뻗고 좌우 */
      if (tn < 0.5) {
        const u = Math.sin((tn / 0.5) * Math.PI);
        return {
          local: {
            thighL: 0.35 * u, shinL: 0.5 * u,
            thighR: -0.35 * u, shinR: -0.5 * u,
            uarmL: 0.9 * u, uarmR: -0.9 * u,
          },
          squash: 1 - 0.16 * u,
        };
      }
      const u = (tn - 0.5) / 0.5;
      const lean = Math.sin(u * TAU) * 0.22;
      return {
        world: {
          uarmL: UP - 0.18 + lean, farmL: UP - 0.25 + lean,
          uarmR: UP + 0.18 + lean, farmR: UP + 0.25 + lean,
        },
        local: { spine: lean, headB: lean * 0.4 },
        root: [0.02 * Math.sin(u * TAU), 0],
      };
    },
  },
};

/* 학생 화면·무대에서 보여줄 순서 (idle 제외) */
const MOTION_ORDER = ["dance1", "disco", "hooray", "wiggle", "march", "run", "jump", "hello", "stretch"];
