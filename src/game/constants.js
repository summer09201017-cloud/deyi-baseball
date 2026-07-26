export const MAX_INNINGS = 18;
export const WALL_RADIUS = 30;
export const BALL_RADIUS = 0.18;
export const GRAVITY = -22;

export const OFFENSE_COLORS = {
  player: '#f3b34c',
  ai: '#69d4ff',
};

export const ZONE_TARGETS = [
  { x: -0.78, y: 2.55, label: '\u5de6\u4e0a' },
  { x: 0, y: 2.55, label: '\u4e0a\u4e2d' },
  { x: 0.78, y: 2.55, label: '\u53f3\u4e0a' },
  { x: -0.78, y: 1.78, label: '\u5de6\u4e2d' },
  { x: 0, y: 1.78, label: '\u4e2d\u592e' },
  { x: 0.78, y: 1.78, label: '\u53f3\u4e2d' },
  { x: -0.78, y: 1.03, label: '\u5de6\u4e0b' },
  { x: 0, y: 1.03, label: '\u4e0b\u4e2d' },
  { x: 0.78, y: 1.03, label: '\u53f3\u4e0b' },
];

export const PITCH_TYPES = {
  fastball: {
    key: '1',
    label: '\u56db\u7e2b\u7dda',
    speed: 19.4,
    breakX: 0.03,
    breakY: -0.52,
    color: '#ffd166',
  },
  curveball: {
    key: '2',
    label: '\u66f2\u7403',
    speed: 14.6,
    breakX: -1.15,
    breakY: -2.15,
    color: '#7bc8f6',
  },
  slider: {
    key: '3',
    label: '\u6ed1\u7403',
    speed: 16.2,
    breakX: 1.08,
    breakY: -1.12,
    color: '#ff9770',
  },
  changeup: {
    key: '4',
    label: '\u8b8a\u901f\u7403',
    speed: 13.4,
    breakX: 0.28,
    breakY: -1.78,
    color: '#91e49c',
  },
};

export const DIFFICULTY_SETTINGS = {
  easy: {
    label: '\u7c21\u55ae',
    aiPitchAccuracy: 0.56,
    aiSwingRate: 0.54,
    aiTiming: 0.58,
    aiPower: 0.5,
    aiDefense: 0.52,
    aiStealChance: 0.16,
    stealDefenseMod: 0.08,
  },
  normal: {
    label: '\u666e\u901a',
    aiPitchAccuracy: 0.72,
    aiSwingRate: 0.68,
    aiTiming: 0.7,
    aiPower: 0.64,
    aiDefense: 0.64,
    aiStealChance: 0.27,
    stealDefenseMod: 0,
  },
  hard: {
    label: '\u56f0\u96e3',
    aiPitchAccuracy: 0.88,
    aiSwingRate: 0.81,
    aiTiming: 0.82,
    aiPower: 0.76,
    aiDefense: 0.78,
    aiStealChance: 0.39,
    stealDefenseMod: -0.08,
  },
};

export const BASE_NAMES = [
  '\u4e00\u58d8',
  '\u4e8c\u58d8',
  '\u4e09\u58d8',
];
