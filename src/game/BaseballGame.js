import * as THREE from 'three';
import {
  BALL_RADIUS,
  BASE_NAMES,
  DIFFICULTY_SETTINGS,
  GRAVITY,
  MAX_INNINGS,
  OFFENSE_COLORS,
  PITCH_TYPES,
  WALL_RADIUS,
  ZONE_TARGETS,
} from './constants.js';
import { clearSave, loadGame, saveGame } from './storage.js';

const HOME = new THREE.Vector3(0, 0.1, 0);
const FIRST = new THREE.Vector3(8, 0.1, -8);
const SECOND = new THREE.Vector3(0, 0.1, -16);
const THIRD = new THREE.Vector3(-8, 0.1, -8);
const BASES = [FIRST, SECOND, THIRD];
const MOUND = new THREE.Vector3(0, 1.55, -8);
const PLATE_CENTER = new THREE.Vector3(0, 1.55, -0.1);
const CONTACT_CHANCE = 0.8;
const PITCH_SPEED_SCALE = 0.4;
const PLAYER_AUTO_DEFENSE = 0.62;
const BATTER_NEXT_PITCH_DELAY = 0.38;
const QUICK_RESOLVE_DELAY = 0.46;
const PLAY_RESOLVE_DELAY = 0.58;
const HALF_INNING_RESOLVE_DELAY = 0.82;
const DOUBLE_STEAL_BOOST = 0.06;
const MAX_STEAL_MARKERS = 2;
const CAMERA_DEFAULT = {
  target: new THREE.Vector3(0, 1.95, -8.4),
  distance: 13.6,
  polar: 1.48,
  azimuth: 0,
};
const CATCHER_SCALE = 0.45;
const CATCHER_POSITION = new THREE.Vector3(0, 0, 3.3);
const BATTER_STANCE = {
  right: {
    position: new THREE.Vector3(1.84, 0, 1.16),
    rotationY: -Math.PI / 2 + 0.1,
    batPosition: new THREE.Vector3(0.24, 2.4, 0.16),
    batTiltX: 0.12,
    batTiltZ: 0.2,
    batRestY: 0,
    batSwingY: Math.PI,
  },
  left: {
    position: new THREE.Vector3(-1.84, 0, 1.16),
    rotationY: Math.PI / 2 - 0.1,
    batPosition: new THREE.Vector3(-0.24, 2.4, 0.16),
    batTiltX: 0.12,
    batTiltZ: -0.2,
    batRestY: 0,
    batSwingY: Math.PI,
  },
};
const FIELDER_LAYOUT = [
  { home: new THREE.Vector3(9.2, 0, -9.6), patrolRadius: 1.1 },
  { home: new THREE.Vector3(-9.2, 0, -9.6), patrolRadius: 1.1 },
  { home: new THREE.Vector3(0, 0, -17), patrolRadius: 1.1 },
  { home: new THREE.Vector3(-13.4, 0, -21.5), patrolRadius: 1.9 },
  { home: new THREE.Vector3(0, 0, -25.5), patrolRadius: 2.1 },
  { home: new THREE.Vector3(13.4, 0, -21.5), patrolRadius: 1.9 },
];

function cloneRunner(runner) {
  return runner ? { ...runner } : null;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function localizedFormatInningLabel(inning, half) {
  return `${inning} 局${half === 'top' ? '上' : '下'}`;
}

function fairBallCheck(x, z) {
  return z <= 0.6 && Math.abs(x) <= Math.abs(z) + 1.5;
}

function landingTime(startY, velocityY) {
  const a = 0.5 * GRAVITY;
  const b = velocityY;
  const c = startY - BALL_RADIUS;
  const discriminant = b * b - 4 * a * c;

  if (discriminant <= 0) {
    return 0.1;
  }

  const root = (-b - Math.sqrt(discriminant)) / (2 * a);
  return root > 0 ? root : 0.1;
}

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

function cloneBases(bases) {
  return bases.map((runner) => cloneRunner(runner));
}

function localizedCreateDefaultState() {
  return {
    inning: 1,
    half: 'top',
    offense: 'player',
    maxInnings: MAX_INNINGS,
    balls: 0,
    strikes: 0,
    outs: 0,
    score: { player: 0, ai: 0 },
    bases: [null, null, null],
    difficulty: 'normal',
    selectedPitch: 'curveball',
    selectedZone: 4,
    gameOver: false,
    lastEvent: '選好球路，準備第一球。',
    runnerSeq: 1,
    serviceWorkerReady: false,
  };
}

function displayInningLabel(inning, half) {
  return `${inning} 局${half === 'top' ? '上' : '下'}`;
}

function buildInitialGameState() {
  return {
    inning: 1,
    half: 'top',
    offense: 'player',
    maxInnings: MAX_INNINGS,
    balls: 0,
    strikes: 0,
    outs: 0,
    score: { player: 0, ai: 0 },
    bases: [null, null, null],
    difficulty: 'normal',
    selectedPitch: 'curveball',
    selectedZone: 4,
    gameOver: false,
    lastEvent: '比賽準備完成，第一球即將開始。',
    runnerSeq: 1,
    serviceWorkerReady: false,
  };
}

function sanitizeState(saved) {
  const base = buildInitialGameState();
  if (!saved) {
    return base;
  }

  const difficulty = Object.hasOwn(DIFFICULTY_SETTINGS, saved.difficulty) ? saved.difficulty : base.difficulty;
  const selectedPitch = Object.hasOwn(PITCH_TYPES, saved.selectedPitch) ? saved.selectedPitch : base.selectedPitch;
  const selectedZone = Number.isInteger(saved.selectedZone)
    ? THREE.MathUtils.clamp(saved.selectedZone, 0, ZONE_TARGETS.length - 1)
    : base.selectedZone;

  return {
    ...base,
    ...saved,
    difficulty,
    selectedPitch,
    selectedZone,
    score: {
      ...base.score,
      ...(saved.score ?? {}),
    },
    bases: Array.isArray(saved.bases)
      ? [0, 1, 2].map((index) => cloneRunner(saved.bases[index]))
      : base.bases,
  };
}

function createRunnerState(game, team) {
  const boost = team === 'ai' ? DIFFICULTY_SETTINGS[game.state.difficulty].aiStealChance * 0.18 : 0;
  return {
    id: game.state.runnerSeq++,
    team,
    speed: 0.96 + Math.random() * 0.12 + boost,
  };
}

function formatInningLabel(inning, half) {
  return `${inning} 局${half === 'top' ? '上' : '下'}`;
}

function createDefaultState() {
  return {
    inning: 1,
    half: 'top',
    offense: 'player',
    maxInnings: MAX_INNINGS,
    balls: 0,
    strikes: 0,
    outs: 0,
    score: { player: 0, ai: 0 },
    bases: [null, null, null],
    difficulty: 'normal',
    selectedPitch: 'curveball',
    selectedZone: 4,
    gameOver: false,
    lastEvent: '比賽準備完成，第一球即將開始。',
    runnerSeq: 1,
    serviceWorkerReady: false,
  };
}

export class BaseballGame {
  constructor(ui) {
    window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間(續玩存檔亦從本次進場起算)
    this.ui = ui;
    const savedState = loadGame();
    this.state = sanitizeState(savedState);

    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0c1f17, 32, 86);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
    this.cameraOrbit = {
      target: CAMERA_DEFAULT.target.clone(),
      distance: CAMERA_DEFAULT.distance,
      polar: CAMERA_DEFAULT.polar,
      azimuth: CAMERA_DEFAULT.azimuth,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.ui.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.phase = this.state.gameOver ? 'gameOver' : 'awaitPitch';
    this.nextPitchDelay = this.playerIsBatting() ? BATTER_NEXT_PITCH_DELAY : 0;
    this.resolveDelay = 0;
    this.swing = { active: false, elapsed: 0, checked: false, batter: null };
    this.currentPitch = null;
    this.battedBall = null;
    this.activeSteals = [];
    this.deferredPrompt = null;
    this.activeFielder = null;
    this.fielderActors = [];
    this.runnerMarkers = [];
    this.stealMarkers = [];
    this.zoneTiles = [];
    this.zoneTargetMarker = null;
    this.animationFrame = null;
    this.time = 0;

    this.setupScene();
    this.buildField();
    this.buildActors();
    this.bindUI();
    this.bindWindowEvents();
    this.applyCamera();
    this.placeBallAtMound();
    this.syncVisualState();
    this.updateUI();

    this.loop = this.loop.bind(this);
    this.animationFrame = requestAnimationFrame(this.loop);

    if (!savedState) {
      this.persist();
    } else {
      this.showEvent('已載入上次存檔，直接繼續比賽。');
    }
  }

  notifyServiceWorkerReady() {
    this.state.serviceWorkerReady = true;
    this.persist();
  }

  setupScene() {
    this.scene.background = new THREE.Color(0x274c31);

    const hemi = new THREE.HemisphereLight(0xf6ffe6, 0x315435, 1.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d4, 1.7);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -42;
    sun.shadow.camera.right = 42;
    sun.shadow.camera.top = 34;
    sun.shadow.camera.bottom = -34;
    this.scene.add(sun);

    const fill = new THREE.PointLight(0xb6fff1, 0.28, 90);
    fill.position.set(0, 10, 18);
    this.scene.add(fill);
  }

  buildField() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshStandardMaterial({ color: 0x2a6633, roughness: 0.96, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const dirt = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0xc8884e, roughness: 0.98 }),
    );
    dirt.rotation.x = -Math.PI / 2;
    dirt.rotation.z = Math.PI / 4;
    dirt.position.y = 0.01;
    dirt.receiveShadow = true;
    this.scene.add(dirt);

    const homeCircle = new THREE.Mesh(
      new THREE.CircleGeometry(4.7, 32),
      new THREE.MeshStandardMaterial({ color: 0xbc7d43, roughness: 0.98 }),
    );
    homeCircle.rotation.x = -Math.PI / 2;
    homeCircle.position.set(0, 0.02, 1.25);
    homeCircle.receiveShadow = true;
    this.scene.add(homeCircle);

    this.addFoulLine(HOME, FIRST.clone().multiplyScalar(3.7));
    this.addFoulLine(HOME, THIRD.clone().multiplyScalar(3.7));
    this.addBatterBox(1.85);
    this.addBatterBox(-1.85);

    const plateShape = new THREE.Shape();
    plateShape.moveTo(-0.55, 0.65);
    plateShape.lineTo(0.55, 0.65);
    plateShape.lineTo(0.55, -0.1);
    plateShape.lineTo(0, -0.65);
    plateShape.lineTo(-0.55, -0.1);
    const plate = new THREE.Mesh(
      new THREE.ShapeGeometry(plateShape),
      new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.8 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.15;
    this.scene.add(plate);

    this.buildZoneBoard();

    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.8 });
    [FIRST, SECOND, THIRD].forEach((position) => {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.25, 1.15), baseMaterial);
      base.position.copy(position);
      base.position.y = 0.12;
      base.castShadow = true;
      base.receiveShadow = true;
      this.scene.add(base);
    });

    const mound = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2.4, 0.35, 32),
      new THREE.MeshStandardMaterial({ color: 0xd4a56a, roughness: 0.94 }),
    );
    mound.position.set(MOUND.x, 0.14, MOUND.z);
    mound.receiveShadow = true;
    this.scene.add(mound);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x18322b, roughness: 0.76 });
    const capMaterial = new THREE.MeshStandardMaterial({ color: 0xf7a546, roughness: 0.32 });
    for (let step = -16; step <= 16; step += 1) {
      const t = step / 16;
      const angle = t * 0.98;
      const x = Math.sin(angle) * WALL_RADIUS;
      const z = -Math.cos(angle) * WALL_RADIUS - 0.8;

      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.35, 4.6, 0.7), wallMaterial);
      wall.position.set(x, 2.35, z);
      wall.rotation.y = angle;
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.25, 0.86), capMaterial);
      cap.position.set(x, 4.8, z);
      cap.rotation.y = angle;
      this.scene.add(cap);
    }

    const poleGeometry = new THREE.CylinderGeometry(0.12, 0.12, 8.5, 12);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0xffbf47, roughness: 0.3 });
    const rightPole = new THREE.Mesh(poleGeometry, poleMaterial);
    rightPole.position.set(21.5, 4.3, -21.5);
    rightPole.castShadow = true;
    this.scene.add(rightPole);

    const leftPole = rightPole.clone();
    leftPole.position.x = -21.5;
    this.scene.add(leftPole);

    this.landingMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.02, 32),
      new THREE.MeshBasicMaterial({
        color: 0xfff4a1,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );
    this.landingMarker.rotation.x = -Math.PI / 2;
    this.landingMarker.visible = false;
    this.scene.add(this.landingMarker);
  }

  addFoulLine(from, to) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([from, to]),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    line.position.y = 0.14;
    this.scene.add(line);
  }

  addBatterBox(centerX) {
    const points = [
      new THREE.Vector3(centerX - 0.72, 0.16, 0.35),
      new THREE.Vector3(centerX + 0.72, 0.16, 0.35),
      new THREE.Vector3(centerX + 0.72, 0.16, 2.15),
      new THREE.Vector3(centerX - 0.72, 0.16, 2.15),
      new THREE.Vector3(centerX - 0.72, 0.16, 0.35),
    ];
    const box = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    this.scene.add(box);
  }

  buildZoneBoard() {
    const zoneZ = 0.28;
    ZONE_TARGETS.forEach((zone, index) => {
      const tile = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 0.66),
        new THREE.MeshBasicMaterial({
          color: 0x78c5ff,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
        }),
      );
      tile.position.set(zone.x, zone.y, zoneZ);
      tile.userData.defaultColor = 0x78c5ff;
      this.scene.add(tile);
      this.zoneTiles[index] = tile;

      const outlinePoints = [
        new THREE.Vector3(zone.x - 0.36, zone.y - 0.33, zoneZ + 0.01),
        new THREE.Vector3(zone.x + 0.36, zone.y - 0.33, zoneZ + 0.01),
        new THREE.Vector3(zone.x + 0.36, zone.y + 0.33, zoneZ + 0.01),
        new THREE.Vector3(zone.x - 0.36, zone.y + 0.33, zoneZ + 0.01),
        new THREE.Vector3(zone.x - 0.36, zone.y - 0.33, zoneZ + 0.01),
      ];
      const outline = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(outlinePoints),
        new THREE.LineBasicMaterial({ color: 0xaadfff, transparent: true, opacity: 0.55 }),
      );
      this.scene.add(outline);
    });

    this.zoneTargetMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.26, 24),
      new THREE.MeshBasicMaterial({
        color: 0xf3b34c,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    this.zoneTargetMarker.position.set(0, 1.78, zoneZ + 0.02);
    this.scene.add(this.zoneTargetMarker);
  }

  updateZoneBoard(activeIndex = this.state.selectedZone) {
    const boardVisible = this.playerIsPitching() || this.currentPitch?.thrower === 'player';
    const focusIndex = this.currentPitch?.thrower === 'player' ? this.currentPitch.zoneIndex : activeIndex;

    this.zoneTiles.forEach((tile, index) => {
      tile.visible = boardVisible;
      if (!boardVisible) {
        return;
      }

      const isFocus = index === focusIndex;
      tile.material.color.set(isFocus ? 0xf3b34c : 0x78c5ff);
      tile.material.opacity = isFocus ? 0.4 : 0.1;
    });

    this.zoneTargetMarker.visible = boardVisible;
    if (!boardVisible) {
      return;
    }

    const zone = ZONE_TARGETS[focusIndex];
    this.zoneTargetMarker.position.set(zone.x, zone.y, 0.3);
    this.zoneTargetMarker.material.color.set(this.currentPitch?.thrower === 'player' ? 0xf3b34c : 0x78c5ff);
  }

  buildActors() {
    this.playerBatter = this.createFigure(OFFENSE_COLORS.player, 0x1e2529, { expression: 'focus', scale: 1.08 });
    this.playerBat = this.createBat(0xf3d18a);
    this.playerBatter.userData.bat = this.playerBat;
    this.playerBatter.add(this.playerBat);
    this.scene.add(this.playerBatter);

    this.aiBatter = this.createFigure(OFFENSE_COLORS.ai, 0x152934, { expression: 'smile', scale: 1.08 });
    this.aiBat = this.createBat(0xcad9e3);
    this.aiBatter.userData.bat = this.aiBat;
    this.aiBatter.add(this.aiBat);
    this.aiBatter.visible = false;
    this.scene.add(this.aiBatter);

    this.pitcher = this.createFigure(0xefe3c6, 0x292f32, { expression: 'stern' });
    this.pitcher.position.set(MOUND.x, 0, MOUND.z);
    this.scene.add(this.pitcher);

    this.catcher = this.createFigure(0x9eb9ff, 0x223142, { expression: 'alert', scale: CATCHER_SCALE });
    this.catcher.position.copy(CATCHER_POSITION);
    this.catcher.rotation.y = Math.PI;
    this.scene.add(this.catcher);

    FIELDER_LAYOUT.forEach((layout) => {
      const actor = this.createFigure(0x5fd1ff, 0x123243, { expression: 'focus', scale: 0.88 });
      actor.position.copy(layout.home);
      actor.rotation.y = Math.PI;
      this.scene.add(actor);
      this.fielderActors.push({
        mesh: actor,
        home: layout.home.clone(),
        patrolRadius: layout.patrolRadius,
        patrolTarget: layout.home.clone(),
        patrolTimer: randomBetween(0.3, 2.2),
        gait: randomBetween(0, Math.PI * 2),
      });
    });

    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0xf7f3ed, roughness: 0.52 }),
    );
    this.ballMesh.castShadow = true;
    this.ballMesh.receiveShadow = true;
    this.scene.add(this.ballMesh);

    BASES.forEach((position) => {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.48, 0.35, 24),
        new THREE.MeshStandardMaterial({
          color: 0xf3b34c,
          emissive: 0x44310d,
          roughness: 0.45,
        }),
      );
      marker.position.copy(position);
      marker.position.y = 0.44;
      marker.visible = false;
      marker.castShadow = true;
      this.scene.add(marker);
      this.runnerMarkers.push(marker);
    });

    for (let index = 0; index < MAX_STEAL_MARKERS; index += 1) {
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.52, 0.38, 24),
        new THREE.MeshStandardMaterial({ color: 0xf3b34c, emissive: 0x38250a, roughness: 0.4 }),
      );
      marker.visible = false;
      marker.castShadow = true;
      this.scene.add(marker);
      this.stealMarkers.push(marker);
    }
  }

  createFigure(primaryColor, secondaryColor, options = {}) {
    const scale = options.scale ?? 1;
    const group = new THREE.Group();
    const primaryMaterial = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.72 });
    const secondaryMaterial = new THREE.MeshStandardMaterial({ color: secondaryColor, roughness: 0.78 });
    const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf0d5b6, roughness: 0.9 });
    const capMaterial = new THREE.MeshStandardMaterial({ color: secondaryColor, roughness: 0.65 });
    const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x161718, roughness: 0.32 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.58, 1.8, 14), primaryMaterial);
    torso.position.y = 1.9;
    torso.castShadow = true;
    group.add(torso);

    const hip = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.42, 0.48), secondaryMaterial);
    hip.position.y = 1.08;
    hip.castShadow = true;
    group.add(hip);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 3.04, 0.02);
    group.add(headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 18), skinMaterial);
    head.castShadow = true;
    headGroup.add(head);

    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.39, 0.16, 18), capMaterial);
    capTop.position.y = 0.2;
    capTop.castShadow = true;
    headGroup.add(capTop);

    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.12), capMaterial);
    brim.position.set(0, 0.14, 0.22);
    brim.castShadow = true;
    headGroup.add(brim);

    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), faceMaterial);
    leftEye.position.set(-0.12, 0.03, 0.34);
    headGroup.add(leftEye);

    const rightEye = leftEye.clone();
    rightEye.position.x = 0.12;
    headGroup.add(rightEye);

    const browGeometry = new THREE.BoxGeometry(0.15, 0.025, 0.025);
    const leftBrow = new THREE.Mesh(browGeometry, faceMaterial);
    leftBrow.position.set(-0.12, 0.14, 0.34);
    headGroup.add(leftBrow);

    const rightBrow = leftBrow.clone();
    rightBrow.position.x = 0.12;
    headGroup.add(rightBrow);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.08, 0.03), skinMaterial);
    nose.position.set(0, -0.02, 0.37);
    headGroup.add(nose);

    const mouthGroup = new THREE.Group();
    mouthGroup.position.set(0, -0.17, 0.35);
    headGroup.add(mouthGroup);

    const mouthMaterial = new THREE.MeshStandardMaterial({ color: 0x8d4a40, roughness: 0.3 });
    const mouthCenter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.024, 0.024), mouthMaterial);
    mouthGroup.add(mouthCenter);

    const mouthLeft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.024, 0.024), mouthMaterial);
    mouthLeft.position.x = -0.09;
    mouthGroup.add(mouthLeft);

    const mouthRight = mouthLeft.clone();
    mouthRight.position.x = 0.09;
    mouthGroup.add(mouthRight);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 10), skinMaterial);
    neck.position.y = 2.72;
    neck.castShadow = true;
    group.add(neck);

    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-0.56, 2.42, 0);
    group.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(0.56, 2.42, 0);
    group.add(rightArmPivot);

    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 10), secondaryMaterial);
    leftArm.position.y = -0.56;
    leftArm.castShadow = true;
    leftArmPivot.add(leftArm);

    const rightArm = leftArm.clone();
    rightArmPivot.add(rightArm);

    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.23, 1.12, 0);
    group.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.23, 1.12, 0);
    group.add(rightLegPivot);

    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.46, 10), secondaryMaterial);
    leftLeg.position.y = -0.72;
    leftLeg.castShadow = true;
    leftLegPivot.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLegPivot.add(rightLeg);

    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.38), faceMaterial);
    leftShoe.position.set(0, -1.47, 0.08);
    leftShoe.castShadow = true;
    leftLegPivot.add(leftShoe);

    const rightShoe = leftShoe.clone();
    rightLegPivot.add(rightShoe);

    group.scale.setScalar(scale);
    group.userData.parts = {
      torso,
      hip,
      headGroup,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
      leftEye,
      rightEye,
      leftBrow,
      rightBrow,
      mouthCenter,
      mouthLeft,
      mouthRight,
    };

    this.setFigureExpression(group, options.expression ?? 'neutral');
    return group;
  }

  setFigureExpression(figure, expression) {
    const parts = figure.userData.parts;
    if (!parts) {
      return;
    }

    parts.leftEye.scale.y = 1;
    parts.rightEye.scale.y = 1;
    parts.leftBrow.position.y = 0.14;
    parts.rightBrow.position.y = 0.14;
    parts.leftBrow.rotation.z = 0;
    parts.rightBrow.rotation.z = 0;
    parts.mouthCenter.scale.x = 1;
    parts.mouthCenter.position.set(0, 0, 0);
    parts.mouthLeft.position.set(-0.09, 0, 0);
    parts.mouthRight.position.set(0.09, 0, 0);
    parts.mouthLeft.rotation.z = 0;
    parts.mouthRight.rotation.z = 0;

    if (expression === 'smile') {
      parts.leftBrow.position.y = 0.16;
      parts.rightBrow.position.y = 0.16;
      parts.leftBrow.rotation.z = -0.1;
      parts.rightBrow.rotation.z = 0.1;
      parts.mouthCenter.position.y = -0.02;
      parts.mouthLeft.position.set(-0.09, 0.02, 0);
      parts.mouthRight.position.set(0.09, 0.02, 0);
      parts.mouthLeft.rotation.z = -0.65;
      parts.mouthRight.rotation.z = 0.65;
      return;
    }

    if (expression === 'stern') {
      parts.leftEye.scale.y = 0.8;
      parts.rightEye.scale.y = 0.8;
      parts.leftBrow.position.y = 0.11;
      parts.rightBrow.position.y = 0.11;
      parts.leftBrow.rotation.z = -0.32;
      parts.rightBrow.rotation.z = 0.32;
      parts.mouthCenter.scale.x = 0.8;
      return;
    }

    if (expression === 'alert') {
      parts.leftBrow.position.y = 0.17;
      parts.rightBrow.position.y = 0.17;
      parts.leftEye.scale.y = 1.12;
      parts.rightEye.scale.y = 1.12;
      parts.mouthCenter.scale.x = 0.7;
      return;
    }

    if (expression === 'focus') {
      parts.leftEye.scale.y = 0.92;
      parts.rightEye.scale.y = 0.92;
      parts.leftBrow.position.y = 0.12;
      parts.rightBrow.position.y = 0.12;
      parts.leftBrow.rotation.z = -0.22;
      parts.rightBrow.rotation.z = 0.22;
      parts.mouthCenter.scale.x = 0.92;
    }
  }

  resetFigurePose(figure) {
    const parts = figure.userData.parts;
    parts.torso.scale.set(1, 1, 1);
    parts.hip.scale.set(1, 1, 1);
    parts.leftArm.scale.set(1, 1, 1);
    parts.rightArm.scale.set(1, 1, 1);
    parts.leftLeg.scale.set(1, 1, 1);
    parts.rightLeg.scale.set(1, 1, 1);
    parts.torso.position.y = 1.9;
    parts.torso.rotation.set(0, 0, 0);
    parts.hip.position.y = 1.08;
    parts.headGroup.position.set(0, 3.04, 0.02);
    parts.headGroup.rotation.set(0, 0, 0);
    parts.leftArmPivot.position.set(-0.56, 2.42, 0);
    parts.rightArmPivot.position.set(0.56, 2.42, 0);
    parts.leftArmPivot.rotation.set(0, 0, 0.18);
    parts.rightArmPivot.rotation.set(0, 0, -0.18);
    parts.leftLegPivot.position.set(-0.23, 1.12, 0);
    parts.rightLegPivot.position.set(0.23, 1.12, 0);
    parts.leftLegPivot.rotation.set(0, 0, 0.02);
    parts.rightLegPivot.rotation.set(0, 0, -0.02);
  }

  setBatterPose(figure, side) {
    this.resetFigurePose(figure);
    const parts = figure.userData.parts;
    const handedness = side === 'right' ? 1 : -1;

    parts.torso.scale.set(0.78, 1.26, 0.78);
    parts.hip.scale.set(0.82, 0.9, 0.78);
    parts.leftArm.scale.set(0.78, 1.14, 0.78);
    parts.rightArm.scale.set(0.78, 1.14, 0.78);
    parts.leftLeg.scale.set(0.8, 1.26, 0.8);
    parts.rightLeg.scale.set(0.8, 1.26, 0.8);

    parts.torso.position.y = 2.12;
    parts.hip.position.y = 1.06;
    parts.headGroup.position.set(0, 3.36, 0.04);
    parts.leftArmPivot.position.set(-0.44, 2.62, 0.06);
    parts.rightArmPivot.position.set(0.44, 2.6, -0.04);
    parts.leftLegPivot.position.set(-0.24, 1.06, 0.08);
    parts.rightLegPivot.position.set(0.22, 1.08, -0.02);

    parts.torso.rotation.set(0.06, -0.18 * handedness, 0);
    parts.headGroup.rotation.set(0.02, 0.14 * handedness, 0);
    parts.leftArmPivot.rotation.set(-1.04, 0.18 * handedness, 0.14 * handedness);
    parts.rightArmPivot.rotation.set(-0.78, -0.18 * handedness, -0.18 * handedness);
    parts.leftLegPivot.rotation.x = 0.28;
    parts.rightLegPivot.rotation.x = -0.08;
  }

  setPitcherPose(figure) {
    this.resetFigurePose(figure);
    const parts = figure.userData.parts;
    parts.torso.rotation.x = -0.03;
    parts.headGroup.position.z = 0.08;
    parts.headGroup.rotation.x = 0.1;
    parts.leftArmPivot.rotation.set(-0.42, 0, 0.26);
    parts.rightArmPivot.rotation.set(-1.36, 0, -0.16);
    parts.leftLegPivot.rotation.x = 0.06;
    parts.rightLegPivot.rotation.x = -0.16;
  }

  setCatcherPose(figure) {
    this.resetFigurePose(figure);
    const parts = figure.userData.parts;
    parts.torso.position.y = 1.45;
    parts.torso.rotation.x = 0.26;
    parts.hip.position.y = 0.88;
    parts.headGroup.position.set(0, 2.58, 0.15);
    parts.headGroup.rotation.x = -0.06;
    parts.leftArmPivot.position.set(-0.5, 2, 0.14);
    parts.rightArmPivot.position.set(0.5, 2, 0.14);
    parts.leftArmPivot.rotation.set(-1.28, 0, 0.3);
    parts.rightArmPivot.rotation.set(-1.18, 0, -0.3);
    parts.leftLegPivot.position.set(-0.28, 0.92, 0.1);
    parts.rightLegPivot.position.set(0.28, 0.92, 0.1);
    parts.leftLegPivot.rotation.x = 1.36;
    parts.rightLegPivot.rotation.x = 1.36;
  }

  setFieldPose(figure, stride = 0) {
    this.resetFigurePose(figure);
    const parts = figure.userData.parts;
    parts.torso.rotation.x = 0.05;
    parts.headGroup.rotation.x = 0.03;
    parts.leftArmPivot.rotation.set(-0.44 + stride, 0, 0.1);
    parts.rightArmPivot.rotation.set(-0.44 - stride, 0, -0.1);
    parts.leftLegPivot.rotation.x = 0.1 - stride;
    parts.rightLegPivot.rotation.x = 0.1 + stride;
  }

  applyBatterPlacement(figure, side) {
    const stance = BATTER_STANCE[side];
    figure.position.copy(stance.position);
    figure.rotation.y = stance.rotationY;
    const bat = figure.userData.bat;
    bat.position.copy(stance.batPosition);
    bat.rotation.set(stance.batTiltX, stance.batRestY, stance.batTiltZ);
    bat.userData.restRotationX = stance.batTiltX;
    bat.userData.restRotationY = stance.batRestY;
    bat.userData.restRotationZ = stance.batTiltZ;
    bat.userData.swingRotationY = stance.batSwingY;
  }

  createBat(color) {
    const group = new THREE.Group();

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 1.05, 10),
      new THREE.MeshStandardMaterial({ color: 0x4d3320, roughness: 0.8 }),
    );
    handle.rotation.z = Math.PI / 2;
    group.add(handle);

    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, 1.26, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
    );
    barrel.position.x = 0.68;
    barrel.rotation.z = Math.PI / 2;
    group.add(barrel);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0x4d3320, roughness: 0.8 }),
    );
    knob.position.x = -0.54;
    group.add(knob);

    return group;
  }

  bindUI() {
    this.ui.pitchButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.state.selectedPitch = button.dataset.pitch;
        this.persist();
        this.updateUI();
      });
    });

    this.ui.zoneButtons.forEach((button, index) => {
      button.textContent = ZONE_TARGETS[index].label;
      button.addEventListener('click', () => {
        this.state.selectedZone = index;
        this.persist();
        this.updateUI();
      });
    });

    this.ui.difficulty.addEventListener('change', () => {
      this.state.difficulty = this.ui.difficulty.value;
      this.persist();
      this.showEvent(`AI 強度切換成 ${DIFFICULTY_SETTINGS[this.state.difficulty].label}。`);
      this.updateUI();
    });

    this.ui.primaryAction.addEventListener('click', () => {
      this.handlePrimaryAction();
    });

    this.ui.stealAction.addEventListener('click', () => {
      if (this.playerIsBatting()) {
        this.startStealAttempt('player');
      }
    });

    this.ui.doubleStealAction.addEventListener('click', () => {
      if (this.playerIsBatting()) {
        this.startDoubleStealAttempt('player');
      }
    });

    this.ui.saveAction.addEventListener('click', () => {
      this.persist();
      this.showEvent('存檔完成，之後可以從這個局面繼續。');
      this.updateUI();
    });

    this.ui.newGameAction.addEventListener('click', () => {
      this.resetGame();
    });

    this.ui.installAction.addEventListener('click', async () => {
      if (!this.deferredPrompt) {
        return;
      }
      this.deferredPrompt.prompt();
      await this.deferredPrompt.userChoice.catch(() => null);
      this.deferredPrompt = null;
      this.updateUI();
    });
  }

  bindWindowEvents() {
    window.addEventListener('resize', () => this.handleResize());
    this.handleResize();

    window.addEventListener('keydown', (event) => {
      if (event.repeat) {
        return;
      }

      if (event.code === 'Space') {
        if (this.playerIsBatting()) {
          event.preventDefault();
          this.handlePrimaryAction();
        }
        return;
      }

      if (event.code === 'Enter') {
        if (this.playerIsPitching()) {
          event.preventDefault();
          this.handlePrimaryAction();
        }
        return;
      }

      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        if (this.playerIsBatting()) {
          event.preventDefault();
          this.startStealAttempt('player');
        }
        return;
      }

      if (event.code === 'KeyD') {
        if (this.playerIsBatting()) {
          event.preventDefault();
          this.startDoubleStealAttempt('player');
        }
        return;
      }

      if (event.code === 'KeyR') {
        this.resetCamera();
        return;
      }

      const pitchMap = {
        Digit1: 'fastball',
        Digit2: 'curveball',
        Digit3: 'slider',
        Digit4: 'changeup',
      };
      if (pitchMap[event.code]) {
        this.state.selectedPitch = pitchMap[event.code];
        this.persist();
        this.updateUI();
        return;
      }

      const zone = this.state.selectedZone;
      const row = Math.floor(zone / 3);
      const col = zone % 3;
      let nextZone = zone;

      if (event.code === 'ArrowUp') {
        nextZone = Math.max(0, row - 1) * 3 + col;
      } else if (event.code === 'ArrowDown') {
        nextZone = Math.min(2, row + 1) * 3 + col;
      } else if (event.code === 'ArrowLeft') {
        nextZone = row * 3 + Math.max(0, col - 1);
      } else if (event.code === 'ArrowRight') {
        nextZone = row * 3 + Math.min(2, col + 1);
      }

      if (nextZone !== zone) {
        event.preventDefault();
        this.state.selectedZone = nextZone;
        this.persist();
        this.updateUI();
      }
    });

    this.ui.canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      this.cameraOrbit.dragging = true;
      this.cameraOrbit.pointerId = event.pointerId;
      this.cameraOrbit.lastX = event.clientX;
      this.cameraOrbit.lastY = event.clientY;
      this.ui.stadiumFrame.classList.add('is-dragging');
      this.ui.canvas.setPointerCapture?.(event.pointerId);
    });

    this.ui.canvas.addEventListener('pointermove', (event) => {
      if (!this.cameraOrbit.dragging || this.cameraOrbit.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - this.cameraOrbit.lastX;
      const deltaY = event.clientY - this.cameraOrbit.lastY;
      this.cameraOrbit.lastX = event.clientX;
      this.cameraOrbit.lastY = event.clientY;
      this.cameraOrbit.azimuth -= deltaX * 0.006;
      this.cameraOrbit.polar = THREE.MathUtils.clamp(this.cameraOrbit.polar + deltaY * 0.0045, 1.02, 1.62);
      this.applyCamera();
    });

    const endDrag = (event) => {
      if (
        this.cameraOrbit.pointerId !== null &&
        event.pointerId !== undefined &&
        this.cameraOrbit.pointerId !== event.pointerId
      ) {
        return;
      }

      this.cameraOrbit.dragging = false;
      this.cameraOrbit.pointerId = null;
      this.ui.stadiumFrame.classList.remove('is-dragging');
    };

    this.ui.canvas.addEventListener('pointerup', endDrag);
    this.ui.canvas.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointerup', endDrag);

    this.ui.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.cameraOrbit.distance = THREE.MathUtils.clamp(
          this.cameraOrbit.distance + Math.sign(event.deltaY) * 1.4,
          9.5,
          24,
        );
        this.applyCamera();
      },
      { passive: false },
    );

    this.ui.canvas.addEventListener('dblclick', () => {
      this.resetCamera();
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event;
      this.showEvent('已支援安裝，點「安裝到手機」就能加入主畫面。');
      this.updateUI();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.showEvent('安裝完成，現在可以像 App 一樣打開。');
      this.updateUI();
    });
  }

  handleResize() {
    const width = this.ui.canvas.clientWidth || 1;
    const height = this.ui.canvas.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  applyCamera() {
    const offset = new THREE.Vector3().setFromSpherical(
      new THREE.Spherical(this.cameraOrbit.distance, this.cameraOrbit.polar, this.cameraOrbit.azimuth),
    );
    this.camera.position.copy(this.cameraOrbit.target).add(offset);
    this.camera.lookAt(this.cameraOrbit.target);
  }

  resetCamera() {
    this.cameraOrbit.target.copy(CAMERA_DEFAULT.target);
    this.cameraOrbit.distance = CAMERA_DEFAULT.distance;
    this.cameraOrbit.polar = CAMERA_DEFAULT.polar;
    this.cameraOrbit.azimuth = CAMERA_DEFAULT.azimuth;
    this.applyCamera();
  }

  loop() {
    const dt = Math.min(this.clock.getDelta(), 0.033);
    this.time += dt;
    this.update(dt);
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  update(dt) {
    if (this.phase === 'awaitPitch' && this.playerIsBatting()) {
      this.nextPitchDelay -= dt;
      if (this.nextPitchDelay <= 0) {
        this.throwPitch('ai');
      }
    } else if (this.phase === 'pitching') {
      this.updatePitch(dt);
    } else if (this.phase === 'batted') {
      this.updateBattedBall(dt);
    } else if (this.phase === 'resolve') {
      this.resolveDelay -= dt;
      if (this.resolveDelay <= 0) {
        this.prepareNextPitch();
      }
    }

    this.updateSwingAnimation(dt);
    this.updateFielders(dt);
    this.updateStealAnimation(dt);
  }

  playerIsBatting() {
    return this.state.offense === 'player';
  }

  playerIsPitching() {
    return this.state.offense === 'ai';
  }

  handlePrimaryAction() {
    if (this.state.gameOver) {
      return;
    }

    if (this.playerIsPitching()) {
      if (this.phase === 'awaitPitch') {
        this.throwPitch('player');
      }
      return;
    }

    if (this.phase === 'pitching') {
      this.startSwing('player');
    }
  }

  throwPitch(thrower) {
    if (this.phase !== 'awaitPitch') {
      return;
    }

    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const pitchType = thrower === 'player' ? this.state.selectedPitch : this.chooseAiPitchType();
    const zoneIndex = thrower === 'player' ? this.state.selectedZone : this.chooseAiZone();
    const pitchInfo = PITCH_TYPES[pitchType];
    const target = this.zoneToTarget(zoneIndex, thrower === 'ai', difficulty.aiPitchAccuracy);
    const distance = MOUND.distanceTo(target);
    const effectiveSpeed = pitchInfo.speed * PITCH_SPEED_SCALE;

    this.phase = 'pitching';
    this.currentPitch = {
      thrower,
      pitchType,
      zoneIndex,
      target,
      start: new THREE.Vector3(0, 2.06, -7.25),
      duration: THREE.MathUtils.clamp(distance / effectiveSpeed, 1.22, 2.32),
      elapsed: 0,
      aiPlan: null,
      inZone: this.isStrike(target.x, target.y),
      effectiveSpeed,
    };

    if (thrower === 'player' && this.shouldAiAttemptSteal()) {
      this.startStealAttempt('ai');
    }

    if (thrower === 'player') {
      this.currentPitch.aiPlan = this.createAiSwingPlan();
    }

    this.placeBallAtMound(pitchInfo.color);
    this.updateZoneBoard(zoneIndex);
    this.showEvent(`${thrower === 'player' ? '你' : 'AI'}投出${pitchInfo.label}。`);
    this.updateUI();
  }

  chooseAiPitchType() {
    const keys = Object.keys(PITCH_TYPES);
    return keys[Math.floor(Math.random() * keys.length)];
  }

  chooseAiZone() {
    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const strikeZones = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    if (Math.random() < difficulty.aiPitchAccuracy) {
      return strikeZones[Math.floor(Math.random() * strikeZones.length)];
    }
    const edgeZones = [0, 2, 6, 8, 1, 7];
    return edgeZones[Math.floor(Math.random() * edgeZones.length)];
  }

  zoneToTarget(zoneIndex, allowMiss, accuracy) {
    const zone = ZONE_TARGETS[zoneIndex];
    const target = new THREE.Vector3(zone.x, zone.y, PLATE_CENTER.z);
    if (allowMiss && Math.random() > accuracy) {
      target.x += randomBetween(-0.9, 0.9);
      target.y += randomBetween(-0.6, 0.6);
    }
    return target;
  }

  isStrike(x, y) {
    return x >= -1.05 && x <= 1.05 && y >= 0.86 && y <= 2.7;
  }

  createAiSwingPlan() {
    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const willSwing = Math.random() < difficulty.aiSwingRate + (this.currentPitch?.inZone ? 0.1 : -0.08);
    if (!willSwing) {
      return { swingAt: null };
    }

    const spread = THREE.MathUtils.mapLinear(difficulty.aiTiming, 0.58, 0.82, 0.18, 0.07);
    return {
      swingAt: THREE.MathUtils.clamp(0.9 + randomBetween(-spread, spread), 0.7, 1.01),
    };
  }

  updatePitch(dt) {
    if (!this.currentPitch) {
      return;
    }

    this.currentPitch.elapsed += dt;
    const pitch = this.currentPitch;
    const t = clamp01(pitch.elapsed / pitch.duration);
    const position = this.samplePitchPosition(pitch, t);
    this.ballMesh.position.copy(position);
    this.ballMesh.rotation.x += dt * 12;
    this.ballMesh.rotation.y += dt * 7;

    if (this.playerIsPitching() && pitch.aiPlan?.swingAt !== null && t >= pitch.aiPlan.swingAt) {
      pitch.aiPlan.swingAt = null;
      this.startSwing('ai');
    }

    if (t >= 1 && this.phase === 'pitching') {
      this.resolvePitchNoContact();
    }
  }

  samplePitchPosition(pitch, t) {
    const position = pitch.start.clone().lerp(pitch.target, t);
    const breakInfo = PITCH_TYPES[pitch.pitchType];
    position.x += breakInfo.breakX * Math.sin(t * Math.PI);
    position.y += breakInfo.breakY * t * t * 0.35;
    position.z += Math.sin(t * Math.PI * 1.2) * 0.06;
    return position;
  }

  startSwing(batter) {
    if (this.phase !== 'pitching' || this.swing.active) {
      return;
    }

    this.swing = {
      active: true,
      batter,
      elapsed: 0,
      checked: false,
    };
  }

  updateSwingAnimation(dt) {
    const playerBat = this.playerBat;
    const aiBat = this.aiBat;
    playerBat.rotation.set(
      playerBat.userData.restRotationX ?? BATTER_STANCE.right.batTiltX,
      playerBat.userData.restRotationY ?? BATTER_STANCE.right.batRestY,
      playerBat.userData.restRotationZ ?? BATTER_STANCE.right.batTiltZ,
    );
    aiBat.rotation.set(
      aiBat.userData.restRotationX ?? BATTER_STANCE.left.batTiltX,
      aiBat.userData.restRotationY ?? BATTER_STANCE.left.batRestY,
      aiBat.userData.restRotationZ ?? BATTER_STANCE.left.batTiltZ,
    );

    if (!this.swing.active) {
      return;
    }

    this.swing.elapsed += dt;
    const swingDuration = 0.28;
    const t = clamp01(this.swing.elapsed / swingDuration);
    const eased = easeOutQuad(t);
    const bat = this.swing.batter === 'player' ? playerBat : aiBat;
    bat.rotation.set(
      bat.userData.restRotationX,
      THREE.MathUtils.lerp(bat.userData.restRotationY, bat.userData.swingRotationY, eased),
      bat.userData.restRotationZ,
    );

    if (!this.swing.checked && this.swing.elapsed >= 0.11) {
      this.swing.checked = true;
      this.evaluateSwing(this.swing.batter);
    }

    if (this.swing.elapsed >= swingDuration) {
      this.swing.active = false;
    }
  }

  evaluateSwing(batter) {
    if (this.phase !== 'pitching' || !this.currentPitch) {
      return;
    }

    const position = this.ballMesh.position.clone();
    const pitchProgress = clamp01(this.currentPitch.elapsed / this.currentPitch.duration);
    const inTimingWindow = pitchProgress >= 0.76 && pitchProgress <= 1.02;
    const reachableX = Math.abs(position.x) <= 1.35;
    const reachableY = Math.abs(position.y - 1.65) <= 1.45;

    if (!inTimingWindow || !reachableX || !reachableY || Math.random() > CONTACT_CHANCE) {
      this.resolveSwingMiss(batter);
      return;
    }

    const timingScore = 1 - THREE.MathUtils.clamp(Math.abs(pitchProgress - 0.9) / 0.18, 0, 1);
    const reachScore = 1 - THREE.MathUtils.clamp((Math.abs(position.x) / 1.3 + Math.abs(position.y - 1.65) / 1.4) * 0.5, 0, 1);
    const quality = clamp01(0.55 + timingScore * 0.28 + reachScore * 0.17 + randomBetween(-0.08, 0.08));

    const stealSnapshot = this.captureActiveSteals();
    this.clearActiveSteals();
    this.beginBattedBall(batter, quality, stealSnapshot);
  }

  resolveSwingMiss(batter) {
    this.showEvent(batter === 'player' ? '揮空，記一個好球。' : 'AI 揮空，你搶到一個好球。');
    this.addStrike();
    this.finishPitchAfterPlate();
  }

  resolvePitchNoContact() {
    if (!this.currentPitch) {
      return;
    }

    if (this.activeSteals.length > 0) {
      this.resolveStealOnCaughtPitch(this.currentPitch);
    }

    if (this.phase !== 'pitching') {
      return;
    }

    if (this.currentPitch.inZone) {
      this.showEvent('進壘點漂亮，主審判定好球。');
      this.addStrike();
    } else {
      this.showEvent('偏出好球帶，記一壞球。');
      this.addBall();
    }

    this.finishPitchAfterPlate();
  }

  finishPitchAfterPlate() {
    if (this.state.gameOver) {
      this.phase = 'gameOver';
      return;
    }

    if (this.state.outs >= 3) {
      this.switchHalfInning();
      return;
    }

    if (this.phase === 'pitching') {
      this.phase = 'resolve';
      this.resolveDelay = QUICK_RESOLVE_DELAY;
      this.currentPitch = null;
      this.placeBallAtMound();
      this.persist();
      this.updateUI();
    }
  }

  beginBattedBall(batter, quality, stealSnapshot) {
    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const spraySeed = this.ballMesh.position.x * 0.38 + randomBetween(-0.2, 0.2);
    const spray = THREE.MathUtils.clamp(spraySeed, -0.78, 0.78);
    const loftRoll = Math.random();
    let launchDeg = 0;

    if (loftRoll > 0.84) {
      launchDeg = THREE.MathUtils.lerp(52, 68, 0.35 + Math.random() * 0.65);
    } else if (loftRoll > 0.42) {
      launchDeg = THREE.MathUtils.lerp(18, 42, quality);
    } else {
      launchDeg = THREE.MathUtils.lerp(7, 18, quality);
    }

    const direction = new THREE.Vector3(spray * 0.92, 0, -1.45).normalize();
    const powerMultiplier = batter === 'ai' ? 0.84 + difficulty.aiPower * 0.48 : 1.02;
    const power = THREE.MathUtils.lerp(10.8, 23.5, quality) * powerMultiplier;
    const launchRad = THREE.MathUtils.degToRad(launchDeg);
    const horizontal = direction.multiplyScalar(power * Math.cos(launchRad));
    const velocity = new THREE.Vector3(horizontal.x, power * Math.sin(launchRad), horizontal.z);
    const plan = this.analyzeBattedBall(this.ballMesh.position.clone(), velocity.clone(), batter);

    this.phase = 'batted';
    this.currentPitch = null;
    this.battedBall = {
      batter,
      elapsed: 0,
      velocity,
      resolved: false,
      plan,
      stealSnapshot,
    };

    this.landingMarker.visible = plan.kind === 'flyOut' || plan.kind === 'flyDrop';
    if (this.landingMarker.visible) {
      this.landingMarker.position.set(plan.target.x, 0.04, plan.target.z);
    }

    this.showEvent(plan.announce);
    this.selectActiveFielder(plan.target);
    this.updateUI();
  }

  analyzeBattedBall(start, velocity, batter) {
    const timeToGround = landingTime(start.y, velocity.y);
    const landing = start.clone().add(new THREE.Vector3(velocity.x * timeToGround, 0, velocity.z * timeToGround));
    const launchAngle = THREE.MathUtils.radToDeg(Math.atan2(velocity.y, Math.hypot(velocity.x, velocity.z)));
    const distance = Math.hypot(landing.x, landing.z);
    const maxHeight = start.y + (velocity.y * velocity.y) / (2 * -GRAVITY);
    const fair = fairBallCheck(landing.x, landing.z);
    const aiDefense = DIFFICULTY_SETTINGS[this.state.difficulty].aiDefense;

    if (!fair) {
      return {
        kind: 'foul',
        target: landing,
        resolveTime: Math.max(timeToGround, 0.8),
        announce: '界外飛球，重新來過。',
      };
    }

    if (distance > WALL_RADIUS - 0.8 && launchAngle >= 24 && landing.z < -12 && maxHeight > 3.4) {
      return {
        kind: 'homeRun',
        target: landing,
        resolveTime: Math.max(1.15, timeToGround * 0.58),
        announce: '球飛向全壘打牆，深遠得很！',
      };
    }

    if (launchAngle >= 36 && timeToGround >= 1.5) {
      return {
        kind: Math.random() < 0.75 ? 'flyOut' : 'flyDrop',
        target: landing,
        resolveTime: Math.max(1.05, timeToGround * 0.86),
        basesAward: distance > 20 ? 2 : 1,
        announce: '高飛球升空，守備有 75% 機率接殺。',
      };
    }

    const defenseFactor = batter === 'player' ? aiDefense : PLAYER_AUTO_DEFENSE;
    const groundOutChance = distance < 10 ? 0.66 : distance < 15 ? 0.34 : 0.12;
    if (launchAngle < 18 && Math.random() < groundOutChance * defenseFactor) {
      return {
        kind: 'groundOut',
        target: landing,
        resolveTime: Math.max(0.95, timeToGround + 0.48),
        announce: '滾地球穿過內野，守備正在處理。',
      };
    }

    let basesAward = 1;
    if (distance > 24) {
      basesAward = 3;
    } else if (distance > 18) {
      basesAward = 2;
    } else if (distance > 13 && launchAngle > 16 && Math.random() > defenseFactor * 0.52) {
      basesAward = 2;
    }

    return {
      kind: 'hit',
      target: landing,
      resolveTime: Math.max(0.98, timeToGround + 0.4),
      basesAward,
      announce:
        basesAward === 1
          ? '平飛球形成安打。'
          : basesAward === 2
            ? '球打到外野縫隙，形成二壘安打。'
            : '球一路滾向牆邊，有三壘安打機會。',
    };
  }

  updateBattedBall(dt) {
    if (!this.battedBall) {
      return;
    }

    const play = this.battedBall;
    play.elapsed += dt;
    this.ballMesh.position.addScaledVector(play.velocity, dt);
    play.velocity.y += GRAVITY * dt;
    this.ballMesh.rotation.x += dt * 10;
    this.ballMesh.rotation.y += dt * 16;

    if (this.ballMesh.position.y <= BALL_RADIUS) {
      this.ballMesh.position.y = BALL_RADIUS;
      if (Math.abs(play.velocity.y) > 1.2) {
        play.velocity.y *= -0.28;
      } else {
        play.velocity.y = 0;
      }
      play.velocity.x *= 0.86;
      play.velocity.z *= 0.86;
    }

    if (!play.resolved && play.elapsed >= play.plan.resolveTime) {
      play.resolved = true;
      this.resolveBattedBall(play);
    }
  }

  resolveBattedBall(play) {
    this.landingMarker.visible = false;

    switch (play.plan.kind) {
      case 'foul':
        this.showEvent('界外球。');
        if (this.state.strikes < 2) {
          this.state.strikes += 1;
        }
        this.phase = 'resolve';
        this.resolveDelay = QUICK_RESOLVE_DELAY;
        this.battedBall = null;
        this.placeBallAtMound();
        this.persist();
        this.updateUI();
        return;
      case 'homeRun':
        this.applyHitResult(4, play.batter, play.stealSnapshot);
        this.showEvent('全壘打，直接飛越全壘打牆！');
        break;
      case 'flyOut':
        this.recordOut(play.batter === 'player' ? '高飛球被接殺，打者出局。' : '你守下高飛球，成功接殺。');
        break;
      case 'flyDrop':
      case 'hit':
        this.applyHitResult(play.plan.basesAward, play.batter, play.stealSnapshot);
        break;
      case 'groundOut':
        this.recordOut(play.batter === 'player' ? '滾地球被處理，打者出局。' : '內野完成封殺，你抓到出局數。');
        break;
      default:
        break;
    }

    this.battedBall = null;
    this.placeBallAtMound();
    this.returnFieldersHome();
  }

  applyHitResult(basesAward, batter, stealSnapshot) {
    const offenseTeam = batter;
    let bases = cloneBases(this.state.bases);

    if (Array.isArray(stealSnapshot)) {
      [...stealSnapshot]
        .sort((left, right) => right.fromBase - left.fromBase)
        .forEach((steal) => {
          if (bases[steal.fromBase]?.id === steal.runner.id && !bases[steal.toBase]) {
            bases[steal.toBase] = bases[steal.fromBase];
            bases[steal.fromBase] = null;
          }
        });
    }

    const nextBases = [null, null, null];
    let scored = 0;
    for (let index = 2; index >= 0; index -= 1) {
      const runner = bases[index];
      if (!runner) {
        continue;
      }

      const destination = index + basesAward;
      if (destination >= 3) {
        scored += 1;
      } else {
        nextBases[destination] = runner;
      }
    }

    if (basesAward >= 4) {
      scored += 1;
    } else {
      nextBases[basesAward - 1] = createRunnerState(this, offenseTeam);
    }

    this.state.bases = nextBases;
    this.state.score[offenseTeam] += scored;
    this.resetCount();
    this.syncRunnerMarkers();

    const hitLabel =
      basesAward === 1
        ? '一壘安打'
        : basesAward === 2
          ? '二壘安打'
          : basesAward === 3
            ? '三壘安打'
            : '全壘打';
    this.showEvent(`${hitLabel}${scored > 0 ? `，帶回 ${scored} 分。` : '。'}`);

    if (this.checkWalkOff()) {
      return;
    }

    this.phase = 'resolve';
    this.resolveDelay = PLAY_RESOLVE_DELAY;
    this.persist();
    this.updateUI();
  }

  addStrike() {
    this.state.strikes += 1;
    if (this.state.strikes >= 3) {
      this.recordOut(this.playerIsBatting() ? '三振出局。' : 'AI 遭到三振。');
      return;
    }
    this.persist();
    this.updateUI();
  }

  addBall() {
    this.state.balls += 1;
    if (this.state.balls >= 4) {
      this.issueWalk();
      return;
    }
    this.persist();
    this.updateUI();
  }

  issueWalk() {
    const offenseTeam = this.state.offense;
    const current = cloneBases(this.state.bases);
    const nextBases = cloneBases(current);
    let scored = 0;

    if (current[0]) {
      if (current[1]) {
        if (current[2]) {
          scored += 1;
        }
        nextBases[2] = current[1];
      }
      nextBases[1] = current[0];
    }

    nextBases[0] = createRunnerState(this, offenseTeam);
    this.state.bases = nextBases;
    this.state.score[offenseTeam] += scored;
    this.resetCount();
    this.syncRunnerMarkers();
    this.showEvent(scored > 0 ? '保送擠回分數。' : '保送上壘。');

    if (this.checkWalkOff()) {
      return;
    }

    this.phase = 'resolve';
    this.resolveDelay = QUICK_RESOLVE_DELAY;
    this.persist();
    this.updateUI();
  }

  recordOut(message) {
    this.state.outs += 1;
    this.resetCount();
    this.showEvent(message);
    this.syncRunnerMarkers();

    if (this.state.outs >= 3) {
      this.switchHalfInning();
      return;
    }

    this.phase = 'resolve';
    this.resolveDelay = PLAY_RESOLVE_DELAY;
    this.persist();
    this.updateUI();
  }

  switchHalfInning() {
    this.state.outs = 0;
    this.state.balls = 0;
    this.state.strikes = 0;
    this.state.bases = [null, null, null];
    this.clearActiveSteals();
    this.syncRunnerMarkers();

    if (this.state.half === 'top') {
      this.state.half = 'bottom';
    } else {
      this.state.half = 'top';
      this.state.inning += 1;
    }

    if (this.state.inning > this.state.maxInnings && this.state.half === 'top' && this.state.score.player !== this.state.score.ai) {
      this.finishGame();
      return;
    }

    this.state.offense = this.state.half === 'top' ? 'player' : 'ai';
    this.phase = 'resolve';
    this.resolveDelay = HALF_INNING_RESOLVE_DELAY;
    this.showEvent(`攻守交換，來到${displayInningLabel(this.state.inning, this.state.half)}。`);
    this.persist();
    this.syncVisualState();
    this.updateUI();
  }

  checkWalkOff() {
    if (this.state.half === 'bottom' && this.state.inning >= this.state.maxInnings && this.state.score.ai > this.state.score.player) {
      this.finishGame();
      return true;
    }
    return false;
  }

  finishGame() {
    try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
      var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
      navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=deyi-baseball-done&t=' + __dt);
    } } catch (_) {}
    this.state.gameOver = true;
    this.phase = 'gameOver';
    const result =
      this.state.score.player > this.state.score.ai
        ? '比賽結束，你贏了這場 3D 棒球對決。'
        : this.state.score.player < this.state.score.ai
          ? '比賽結束，AI 拿下勝利。'
          : '比賽結束，雙方平手。';
    this.showEvent(result);
    this.persist();
    this.updateUI();
  }

  resetCount() {
    this.state.balls = 0;
    this.state.strikes = 0;
  }

  prepareNextPitch() {
    if (this.state.gameOver) {
      this.phase = 'gameOver';
      this.updateUI();
      return;
    }

    this.phase = 'awaitPitch';
    this.nextPitchDelay = this.playerIsBatting() ? BATTER_NEXT_PITCH_DELAY : 0;
    this.currentPitch = null;
    this.battedBall = null;
    this.clearActiveSteals();
    this.placeBallAtMound();
    this.returnFieldersHome();
    this.syncVisualState();
    this.persist();
    this.updateUI();
  }

  startStealAttempt(team) {
    if (this.phase !== 'awaitPitch' && this.phase !== 'pitching') {
      return;
    }

    if (this.steal) {
      return;
    }

    const fromBase = this.findStealSource(team);
    if (fromBase === null) {
      if (team === 'player') {
        this.showEvent('目前沒有適合盜壘的跑者。');
      }
      return;
    }

    const runner = this.state.bases[fromBase];
    if (!runner) {
      return;
    }

    this.steal = {
      team,
      runner: cloneRunner(runner),
      fromBase,
      toBase: fromBase + 1,
      progress: 0,
      resolved: false,
    };

    this.stealMarker.visible = true;
    this.stealMarker.material.color.set(OFFENSE_COLORS[team]);
    this.showEvent(team === 'player' ? `${BASE_NAMES[fromBase]}跑者起跑盜壘。` : `AI ${BASE_NAMES[fromBase]}跑者嘗試盜壘。`);
    this.syncRunnerMarkers();
    this.updateUI();
  }

  shouldAiAttemptSteal() {
    const fromBase = this.findStealSource('ai');
    if (fromBase === null) {
      return false;
    }
    return Math.random() < DIFFICULTY_SETTINGS[this.state.difficulty].aiStealChance;
  }

  findStealSource(team) {
    const runners = this.state.bases;
    if (runners[0] && runners[0].team === team && !runners[1]) {
      return 0;
    }
    if (runners[1] && runners[1].team === team && !runners[2]) {
      return 1;
    }
    return null;
  }

  updateStealAnimation(dt) {
    if (!this.steal || this.steal.resolved) {
      this.stealMarker.visible = false;
      return;
    }

    const speed = this.phase === 'pitching' ? 1.4 : 0.32;
    this.steal.progress = Math.min(1, this.steal.progress + dt * speed);
    const from = BASES[this.steal.fromBase];
    const to = BASES[this.steal.toBase];
    this.stealMarker.visible = true;
    this.stealMarker.position.copy(from).lerp(to, this.steal.progress);
    this.stealMarker.position.y = 0.44;
  }

  resolveStealOnCaughtPitch(pitch) {
    if (!this.steal || this.steal.resolved) {
      return;
    }

    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const pitchSpeed = pitch.effectiveSpeed ?? PITCH_TYPES[pitch.pitchType].speed * PITCH_SPEED_SCALE;
    let successChance = this.steal.fromBase === 0 ? 0.67 : 0.58;
    successChance += (this.steal.runner.speed - 1) * 0.26;
    successChance += (18 - pitchSpeed) * 0.018;

    if (this.steal.team === 'player') {
      successChance += difficulty.stealDefenseMod;
    } else {
      successChance -= 0.03;
    }

    successChance = THREE.MathUtils.clamp(successChance, 0.18, 0.88);
    const success = Math.random() < successChance;
    const currentRunner = this.state.bases[this.steal.fromBase];

    if (!currentRunner || currentRunner.id !== this.steal.runner.id) {
      this.steal = null;
      this.stealMarker.visible = false;
      return;
    }

    if (success) {
      this.state.bases[this.steal.toBase] = currentRunner;
      this.state.bases[this.steal.fromBase] = null;
      this.showEvent(this.steal.team === 'player' ? '盜壘成功。' : 'AI 盜壘成功。');
    } else {
      this.state.bases[this.steal.fromBase] = null;
      this.state.outs += 1;
      this.showEvent(this.steal.team === 'player' ? '盜壘失敗，被觸殺出局。' : '你抓到 AI 盜壘，成功觸殺。');
      if (this.state.outs >= 3) {
        this.steal.resolved = true;
        this.steal = null;
        this.stealMarker.visible = false;
        this.syncRunnerMarkers();
        this.switchHalfInning();
        return;
      }
    }

    this.steal.resolved = true;
    this.steal = null;
    this.stealMarker.visible = false;
    this.syncRunnerMarkers();
    this.persist();
    this.updateUI();
  }

  selectActiveFielder(target) {
    if (!target) {
      this.activeFielder = null;
      return;
    }

    let nearest = null;
    let bestDistance = Infinity;
    for (const actor of this.fielderActors) {
      const distance = actor.mesh.position.distanceToSquared(new THREE.Vector3(target.x, 0, target.z));
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = actor;
      }
    }
    this.activeFielder = nearest;
  }

  updateFielders(dt) {
    this.fielderActors.forEach((actor) => {
      let goal = actor.home;
      let moveSpeed = 2.8;
      if (this.activeFielder === actor && this.battedBall) {
        goal = this.battedBall.plan.target;
        moveSpeed = 7.5;
      } else {
        actor.patrolTimer -= dt;
        if (actor.mesh.position.distanceToSquared(actor.patrolTarget) < 0.18 || actor.patrolTimer <= 0) {
          actor.patrolTarget = this.pickPatrolTarget(actor);
          actor.patrolTimer = randomBetween(1.2, 2.6);
        }
        goal = actor.patrolTarget;
      }

      const flatGoal = new THREE.Vector3(goal.x, actor.mesh.position.y, goal.z);
      const delta = flatGoal.clone().sub(actor.mesh.position);
      const distance = delta.length();
      const moving = distance > 0.03;
      if (moving) {
        delta.normalize().multiplyScalar(Math.min(distance, dt * moveSpeed));
        actor.mesh.position.add(delta);
        actor.mesh.lookAt(flatGoal.x, actor.mesh.position.y, flatGoal.z);
      }

      actor.gait += dt * (moving ? moveSpeed * 1.1 : 1.4);
      const stride = moving ? Math.sin(actor.gait) * 0.2 : Math.sin(actor.gait) * 0.03;
      this.setFieldPose(actor.mesh, stride);
    });
  }

  pickPatrolTarget(actor) {
    return new THREE.Vector3(
      actor.home.x + randomBetween(-actor.patrolRadius, actor.patrolRadius),
      actor.home.y,
      actor.home.z + randomBetween(-actor.patrolRadius * 0.55, actor.patrolRadius * 0.55),
    );
  }

  returnFieldersHome() {
    this.activeFielder = null;
    this.fielderActors.forEach((actor) => {
      actor.patrolTarget = actor.home.clone();
      actor.patrolTimer = randomBetween(0.4, 1.4);
    });
  }

  syncVisualState() {
    const playerBatting = this.playerIsBatting();
    this.playerBatter.visible = playerBatting;
    this.aiBatter.visible = !playerBatting;

    this.applyBatterPlacement(this.playerBatter, 'right');
    this.applyBatterPlacement(this.aiBatter, 'left');
    this.setBatterPose(this.playerBatter, 'right');
    this.setBatterPose(this.aiBatter, 'left');
    this.setPitcherPose(this.pitcher);
    this.setCatcherPose(this.catcher);
    this.catcher.rotation.y = Math.PI;
    this.catcher.position.copy(CATCHER_POSITION);

    const pitcherUniform = playerBatting ? 0x69d4ff : 0xf3b34c;
    this.pitcher.userData.parts.torso.material.color.setHex(pitcherUniform);
    this.pitcher.userData.parts.hip.material.color.setHex(0x202a31);
    this.pitcher.rotation.y = playerBatting ? 0 : Math.PI;

    this.syncRunnerMarkers();
    this.updateZoneBoard();
  }

  syncRunnerMarkers() {
    this.runnerMarkers.forEach((marker, index) => {
      const runner = this.state.bases[index];
      marker.visible = Boolean(runner) && (!this.steal || this.steal.fromBase !== index);
      if (runner) {
        marker.material.color.set(OFFENSE_COLORS[runner.team]);
      }
    });
  }

  placeBallAtMound(color = 0xf7f3ed) {
    this.ballMesh.position.set(MOUND.x, MOUND.y + 0.45, MOUND.z + 0.7);
    this.ballMesh.material.color.set(color);
  }

  showEvent(text) {
    this.state.lastEvent = text;
    this.ui.eventLog.textContent = text;
    this.ui.phaseChip.textContent = text;
  }

  updateUI() {
    this.ui.playerScore.textContent = String(this.state.score.player);
    this.ui.aiScore.textContent = String(this.state.score.ai);
    this.ui.inningLabel.textContent = displayInningLabel(this.state.inning, this.state.half);
    this.ui.roleLabel.textContent = this.playerIsBatting() ? '你在進攻' : '你在守備';
    this.ui.ballsCount.textContent = String(this.state.balls);
    this.ui.strikesCount.textContent = String(this.state.strikes);
    this.ui.outsCount.textContent = String(this.state.outs);
    this.ui.difficulty.value = this.state.difficulty;

    this.ui.baseChips.forEach((chip, index) => {
      chip.classList.toggle('active', Boolean(this.state.bases[index]));
      if (this.state.bases[index]) {
        chip.textContent = `${BASE_NAMES[index]} ${this.state.bases[index].team === 'player' ? '跑者' : 'AI'}`;
      } else {
        chip.textContent = BASE_NAMES[index];
      }
    });

    this.ui.pitchButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.pitch === this.state.selectedPitch);
      button.disabled = this.state.gameOver;
    });

    this.ui.zoneButtons.forEach((button, index) => {
      button.classList.toggle('active', index === this.state.selectedZone);
      button.disabled = this.state.gameOver;
    });
    this.updateZoneBoard();

    this.ui.primaryAction.textContent = this.playerIsPitching() ? '投球' : '揮棒';
    this.ui.primaryAction.disabled = this.state.gameOver || !this.canUsePrimaryAction();

    this.ui.stealAction.disabled =
      this.state.gameOver ||
      !this.playerIsBatting() ||
      !this.canAttemptSteal('player') ||
      !(this.phase === 'awaitPitch' || this.phase === 'pitching');

    this.ui.phaseChip.textContent = this.state.gameOver ? '比賽結束' : this.state.lastEvent;
    this.ui.eventLog.textContent = this.state.lastEvent;
    this.ui.installAction.classList.toggle('hidden', !this.deferredPrompt);
  }

  canUsePrimaryAction() {
    if (this.playerIsPitching()) {
      return this.phase === 'awaitPitch';
    }
    return this.phase === 'pitching';
  }

  canAttemptSteal(team) {
    return this.findStealSource(team) !== null && !this.steal;
  }

  persist() {
    saveGame(this.state);
  }

  resetGame() {
    window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
    clearSave();
    this.state = buildInitialGameState();
    this.phase = 'awaitPitch';
    this.nextPitchDelay = 1.05;
    this.resolveDelay = 0;
    this.currentPitch = null;
    this.battedBall = null;
    this.steal = null;
    this.stealMarker.visible = false;
    this.state.difficulty = this.ui.difficulty.value || 'normal';
    this.resetCamera();
    this.syncVisualState();
    this.placeBallAtMound();
    this.showEvent('重新開局，準備第一球。');
    this.persist();
    this.updateUI();
  }

  createStealAttempt(team, fromBase) {
    const runner = this.state.bases[fromBase];
    if (!runner || runner.team !== team || fromBase < 0 || fromBase > 1) {
      return null;
    }

    return {
      team,
      runner: cloneRunner(runner),
      fromBase,
      toBase: fromBase + 1,
      progress: 0,
      resolved: false,
    };
  }

  captureActiveSteals() {
    return this.activeSteals.map((steal) => ({
      ...steal,
      runner: cloneRunner(steal.runner),
    }));
  }

  clearActiveSteals() {
    this.activeSteals = [];
    this.stealMarkers.forEach((marker) => {
      marker.visible = false;
    });
  }

  startStealAttempt(team) {
    if (this.phase !== 'awaitPitch' && this.phase !== 'pitching') {
      return;
    }

    if (this.activeSteals.length > 0) {
      return;
    }

    const fromBase = this.findStealSource(team);
    if (fromBase === null) {
      if (team === 'player') {
        this.showEvent('目前沒有單盜壘空間');
      }
      return;
    }

    const steal = this.createStealAttempt(team, fromBase);
    if (!steal) {
      return;
    }

    this.activeSteals = [steal];
    if (team === 'player' && this.phase === 'awaitPitch') {
      this.nextPitchDelay = Math.min(this.nextPitchDelay, 0.12);
    }
    this.showEvent(team === 'player' ? '盜壘啟動' : 'AI 發動盜壘');
    this.syncRunnerMarkers();
    this.updateUI();
  }

  startDoubleStealAttempt(team) {
    if (this.phase !== 'awaitPitch' && this.phase !== 'pitching') {
      return;
    }

    if (this.activeSteals.length > 0) {
      return;
    }

    if (!this.canAttemptDoubleSteal(team)) {
      if (team === 'player') {
        this.showEvent('目前沒有雙盜壘空間');
      }
      return;
    }

    const steals = [1, 0]
      .map((fromBase) => this.createStealAttempt(team, fromBase))
      .filter(Boolean);

    if (steals.length !== 2) {
      return;
    }

    this.activeSteals = steals;
    if (team === 'player' && this.phase === 'awaitPitch') {
      this.nextPitchDelay = Math.min(this.nextPitchDelay, 0.12);
    }
    this.showEvent(team === 'player' ? '雙盜壘發動' : 'AI 發動雙盜壘');
    this.syncRunnerMarkers();
    this.updateUI();
  }

  shouldAiAttemptSteal() {
    const fromBase = this.findStealSource('ai');
    if (fromBase === null || this.activeSteals.length > 0) {
      return false;
    }
    return Math.random() < DIFFICULTY_SETTINGS[this.state.difficulty].aiStealChance;
  }

  findStealSource(team) {
    const runners = this.state.bases;
    if (runners[1] && runners[1].team === team && !runners[2]) {
      return 1;
    }
    if (runners[0] && runners[0].team === team && !runners[1]) {
      return 0;
    }
    return null;
  }

  updateStealAnimation(dt) {
    if (this.activeSteals.length === 0) {
      this.stealMarkers.forEach((marker) => {
        marker.visible = false;
      });
      return;
    }

    const speed = this.phase === 'pitching' ? 1.4 : 0.32;
    this.activeSteals.forEach((steal, index) => {
      const marker = this.stealMarkers[index];
      if (!marker || steal.resolved) {
        if (marker) {
          marker.visible = false;
        }
        return;
      }

      steal.progress = Math.min(1, steal.progress + dt * speed);
      const from = BASES[steal.fromBase];
      const to = BASES[steal.toBase];
      marker.visible = true;
      marker.material.color.set(OFFENSE_COLORS[steal.team]);
      marker.position.copy(from).lerp(to, steal.progress);
      marker.position.y = 0.44;
    });

    this.stealMarkers.slice(this.activeSteals.length).forEach((marker) => {
      marker.visible = false;
    });
  }

  resolveStealOnCaughtPitch(pitch) {
    if (this.activeSteals.length === 0) {
      return;
    }

    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const pitchSpeed = pitch.effectiveSpeed ?? PITCH_TYPES[pitch.pitchType].speed * PITCH_SPEED_SCALE;
    const results = [];
    const doubleSteal = this.activeSteals.length > 1;

    for (const steal of [...this.activeSteals].sort((left, right) => right.fromBase - left.fromBase)) {
      let successChance = steal.fromBase === 0 ? 0.67 : 0.58;
      successChance += (steal.runner.speed - 1) * 0.26;
      successChance += (18 - pitchSpeed) * 0.018;

      if (steal.team === 'player') {
        successChance += difficulty.stealDefenseMod;
      } else {
        successChance -= 0.03;
      }

      if (doubleSteal) {
        successChance += DOUBLE_STEAL_BOOST;
      }

      successChance = THREE.MathUtils.clamp(successChance, 0.18, 0.88);
      const currentRunner = this.state.bases[steal.fromBase];
      if (!currentRunner || currentRunner.id !== steal.runner.id) {
        continue;
      }

      let success = Math.random() < successChance;
      if (success && this.state.bases[steal.toBase]) {
        success = false;
      }

      if (success) {
        this.state.bases[steal.toBase] = currentRunner;
        this.state.bases[steal.fromBase] = null;
      } else {
        this.state.bases[steal.fromBase] = null;
        this.state.outs += 1;
      }

      results.push({
        team: steal.team,
        success,
        fromBase: steal.fromBase,
        toBase: steal.toBase,
      });

      if (this.state.outs >= 3) {
        break;
      }
    }

    this.clearActiveSteals();
    this.syncRunnerMarkers();

    if (this.state.outs >= 3) {
      this.switchHalfInning();
      return;
    }

    const successCount = results.filter((result) => result.success).length;
    const actorLabel = results[0]?.team === 'ai' ? 'AI ' : '';
    if (results.length > 1) {
      this.showEvent(
        successCount === results.length
          ? `${actorLabel}雙盜壘成功`
          : successCount === 0
            ? `${actorLabel}雙盜壘失敗`
            : `${actorLabel}雙盜壘一成一敗`,
      );
    } else if (results[0]) {
      this.showEvent(results[0].success ? `${actorLabel}盜壘成功` : `${actorLabel}盜壘失敗`);
    }

    this.persist();
    this.updateUI();
  }

  syncRunnerMarkers() {
    const stealingBases = new Set(this.activeSteals.map((steal) => steal.fromBase));
    this.runnerMarkers.forEach((marker, index) => {
      const runner = this.state.bases[index];
      marker.visible = Boolean(runner) && !stealingBases.has(index);
      if (runner) {
        marker.material.color.set(OFFENSE_COLORS[runner.team]);
      }
    });
  }

  updateUI() {
    this.ui.playerScore.textContent = String(this.state.score.player);
    this.ui.aiScore.textContent = String(this.state.score.ai);
    this.ui.inningLabel.textContent = displayInningLabel(this.state.inning, this.state.half);
    this.ui.roleLabel.textContent = this.playerIsBatting() ? '雿?脫' : '雿摰?';
    this.ui.ballsCount.textContent = String(this.state.balls);
    this.ui.strikesCount.textContent = String(this.state.strikes);
    this.ui.outsCount.textContent = String(this.state.outs);
    this.ui.difficulty.value = this.state.difficulty;

    this.ui.baseChips.forEach((chip, index) => {
      chip.classList.toggle('active', Boolean(this.state.bases[index]));
      if (this.state.bases[index]) {
        chip.textContent = `${BASE_NAMES[index]} ${this.state.bases[index].team === 'player' ? '頝?' : 'AI'}`;
      } else {
        chip.textContent = BASE_NAMES[index];
      }
    });

    this.ui.pitchButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.pitch === this.state.selectedPitch);
      button.disabled = this.state.gameOver;
    });

    this.ui.zoneButtons.forEach((button, index) => {
      button.classList.toggle('active', index === this.state.selectedZone);
      button.disabled = this.state.gameOver;
    });
    this.updateZoneBoard();

    this.ui.primaryAction.textContent = this.playerIsPitching() ? '??' : '?格?';
    this.ui.primaryAction.disabled = this.state.gameOver || !this.canUsePrimaryAction();

    const battingPhaseOpen = this.phase === 'awaitPitch' || this.phase === 'pitching';
    this.ui.stealAction.disabled =
      this.state.gameOver ||
      !this.playerIsBatting() ||
      !battingPhaseOpen ||
      !this.canAttemptSteal('player');

    this.ui.doubleStealAction.disabled =
      this.state.gameOver ||
      !this.playerIsBatting() ||
      !battingPhaseOpen ||
      !this.canAttemptDoubleSteal('player');

    this.ui.phaseChip.textContent = this.state.gameOver ? '瘥魚蝯?' : this.state.lastEvent;
    this.ui.eventLog.textContent = this.state.lastEvent;
    this.ui.installAction.classList.toggle('hidden', !this.deferredPrompt);
  }

  canAttemptSteal(team) {
    return this.findStealSource(team) !== null && this.activeSteals.length === 0;
  }

  canAttemptDoubleSteal(team) {
    if (this.activeSteals.length > 0) {
      return false;
    }

    const runners = this.state.bases;
    return Boolean(
      runners[0] &&
      runners[0].team === team &&
      runners[1] &&
      runners[1].team === team &&
      !runners[2],
    );
  }

  resetGame() {
    window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
    clearSave();
    this.state = buildInitialGameState();
    this.phase = 'awaitPitch';
    this.nextPitchDelay = BATTER_NEXT_PITCH_DELAY;
    this.resolveDelay = 0;
    this.currentPitch = null;
    this.battedBall = null;
    this.clearActiveSteals();
    this.state.difficulty = this.ui.difficulty.value || 'normal';
    this.resetCamera();
    this.syncVisualState();
    this.placeBallAtMound();
    this.showEvent('新比賽開始。');
    this.persist();
    this.updateUI();
  }

  resolveSwingMiss(batter) {
    this.showEvent(batter === 'player' ? '揮空，記一個好球。' : 'AI 揮空，你搶到一個好球。');
    this.addStrike();
    this.finishPitchAfterPlate();
  }

  analyzeBattedBall(start, velocity, batter) {
    const timeToGround = landingTime(start.y, velocity.y);
    const landing = start.clone().add(new THREE.Vector3(velocity.x * timeToGround, 0, velocity.z * timeToGround));
    const launchAngle = THREE.MathUtils.radToDeg(Math.atan2(velocity.y, Math.hypot(velocity.x, velocity.z)));
    const distance = Math.hypot(landing.x, landing.z);
    const maxHeight = start.y + (velocity.y * velocity.y) / (2 * -GRAVITY);
    const fair = fairBallCheck(landing.x, landing.z);
    const aiDefense = DIFFICULTY_SETTINGS[this.state.difficulty].aiDefense;

    if (!fair) {
      return {
        kind: 'foul',
        target: landing,
        resolveTime: Math.max(timeToGround, 0.8),
        announce: '打成界外球。',
      };
    }

    if (distance > WALL_RADIUS - 0.8 && launchAngle >= 24 && landing.z < -12 && maxHeight > 3.4) {
      return {
        kind: 'homeRun',
        target: landing,
        resolveTime: Math.max(1.15, timeToGround * 0.58),
        announce: '這球飛越全壘打牆，是全壘打！',
      };
    }

    if (launchAngle >= 36 && timeToGround >= 1.5) {
      return {
        kind: Math.random() < 0.75 ? 'flyOut' : 'flyDrop',
        target: landing,
        resolveTime: Math.max(1.05, timeToGround * 0.86),
        basesAward: distance > 20 ? 2 : 1,
        announce: '高飛球升空，防守方有 75% 機率接殺。',
      };
    }

    const defenseFactor = batter === 'player' ? aiDefense : PLAYER_AUTO_DEFENSE;
    const groundOutChance = distance < 10 ? 0.66 : distance < 15 ? 0.34 : 0.12;
    if (launchAngle < 18 && Math.random() < groundOutChance * defenseFactor) {
      return {
        kind: 'groundOut',
        target: landing,
        resolveTime: Math.max(0.95, timeToGround + 0.48),
        announce: '這球偏低，內野有機會處理。',
      };
    }

    let basesAward = 1;
    if (distance > 24) {
      basesAward = 3;
    } else if (distance > 18) {
      basesAward = 2;
    } else if (distance > 13 && launchAngle > 16 && Math.random() > defenseFactor * 0.52) {
      basesAward = 2;
    }

    return {
      kind: 'hit',
      target: landing,
      resolveTime: Math.max(0.98, timeToGround + 0.4),
      basesAward,
      announce:
        basesAward === 1
          ? '穿越內野，形成一壘安打。'
          : basesAward === 2
            ? '這球落到外野深處，形成二壘安打。'
            : '一路滾到更深處，形成三壘安打。',
    };
  }

  resolveBattedBall(play) {
    this.landingMarker.visible = false;

    switch (play.plan.kind) {
      case 'foul':
        this.showEvent('界外球。');
        if (this.state.strikes < 2) {
          this.state.strikes += 1;
        }
        this.phase = 'resolve';
        this.resolveDelay = QUICK_RESOLVE_DELAY;
        this.battedBall = null;
        this.placeBallAtMound();
        this.persist();
        this.updateUI();
        return;
      case 'homeRun':
        this.applyHitResult(4, play.batter, play.stealSnapshot);
        this.showEvent('全壘打，直接飛越全壘打牆！');
        break;
      case 'flyOut':
        this.recordOut(play.batter === 'player' ? '高飛球被接殺，打者出局。' : '你接殺了 AI 的高飛球。');
        break;
      case 'flyDrop':
      case 'hit':
        this.applyHitResult(play.plan.basesAward, play.batter, play.stealSnapshot);
        break;
      case 'groundOut':
        this.recordOut(play.batter === 'player' ? '內野處理完成，打者出局。' : '你守下這顆滾地球，AI 出局。');
        break;
      default:
        break;
    }

    this.battedBall = null;
    this.placeBallAtMound();
    this.returnFieldersHome();
  }

  applyHitResult(basesAward, batter, stealSnapshot) {
    const offenseTeam = batter;
    let bases = cloneBases(this.state.bases);

    if (Array.isArray(stealSnapshot)) {
      [...stealSnapshot]
        .sort((left, right) => right.fromBase - left.fromBase)
        .forEach((steal) => {
          if (bases[steal.fromBase]?.id === steal.runner.id && !bases[steal.toBase]) {
            bases[steal.toBase] = bases[steal.fromBase];
            bases[steal.fromBase] = null;
          }
        });
    }

    const nextBases = [null, null, null];
    let scored = 0;
    for (let index = 2; index >= 0; index -= 1) {
      const runner = bases[index];
      if (!runner) {
        continue;
      }

      const destination = index + basesAward;
      if (destination >= 3) {
        scored += 1;
      } else {
        nextBases[destination] = runner;
      }
    }

    if (basesAward >= 4) {
      scored += 1;
    } else {
      nextBases[basesAward - 1] = createRunnerState(this, offenseTeam);
    }

    this.state.bases = nextBases;
    this.state.score[offenseTeam] += scored;
    this.resetCount();
    this.syncRunnerMarkers();

    const hitLabel =
      basesAward === 1
        ? '一壘安打'
        : basesAward === 2
          ? '二壘安打'
          : basesAward === 3
            ? '三壘安打'
            : '全壘打';
    this.showEvent(`${hitLabel}${scored > 0 ? `，帶回 ${scored} 分。` : '。'}`);

    if (this.checkWalkOff()) {
      return;
    }

    this.phase = 'resolve';
    this.resolveDelay = PLAY_RESOLVE_DELAY;
    this.persist();
    this.updateUI();
  }

  finishGame() {
    try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
      var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
      navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=deyi-baseball-done&t=' + __dt);
    } } catch (_) {}
    this.state.gameOver = true;
    this.phase = 'gameOver';
    const result =
      this.state.score.player > this.state.score.ai
        ? '比賽結束，你贏下這場 3D 棒球對決。'
        : this.state.score.player < this.state.score.ai
          ? '比賽結束，AI 拿下勝利。'
          : '比賽結束，雙方平手。';
    this.showEvent(result);
    this.persist();
    this.updateUI();
  }

  resolveStealOnCaughtPitch(pitch) {
    if (this.activeSteals.length === 0) {
      return;
    }

    const difficulty = DIFFICULTY_SETTINGS[this.state.difficulty];
    const pitchSpeed = pitch.effectiveSpeed ?? PITCH_TYPES[pitch.pitchType].speed * PITCH_SPEED_SCALE;
    const results = [];
    const doubleSteal = this.activeSteals.length > 1;

    for (const steal of [...this.activeSteals].sort((left, right) => right.fromBase - left.fromBase)) {
      let successChance = steal.fromBase === 0 ? 0.67 : 0.58;
      successChance += (steal.runner.speed - 1) * 0.26;
      successChance += (18 - pitchSpeed) * 0.018;

      if (steal.team === 'player') {
        successChance += difficulty.stealDefenseMod;
      } else {
        successChance -= 0.03;
      }

      if (doubleSteal) {
        successChance += DOUBLE_STEAL_BOOST;
      }

      successChance = THREE.MathUtils.clamp(successChance, 0.18, 0.88);
      const currentRunner = this.state.bases[steal.fromBase];
      if (!currentRunner || currentRunner.id !== steal.runner.id) {
        continue;
      }

      let success = Math.random() < successChance;
      if (success && this.state.bases[steal.toBase]) {
        success = false;
      }

      if (success) {
        this.state.bases[steal.toBase] = currentRunner;
        this.state.bases[steal.fromBase] = null;
      } else {
        this.state.bases[steal.fromBase] = null;
        this.state.outs += 1;
      }

      results.push({
        team: steal.team,
        success,
        fromBase: steal.fromBase,
        toBase: steal.toBase,
      });

      if (this.state.outs >= 3) {
        break;
      }
    }

    this.clearActiveSteals();
    this.syncRunnerMarkers();

    if (this.state.outs >= 3) {
      this.switchHalfInning();
      return;
    }

    const successCount = results.filter((result) => result.success).length;
    const actorLabel = results[0]?.team === 'ai' ? 'AI ' : '';
    if (results.length > 1) {
      this.showEvent(
        successCount === results.length
          ? `${actorLabel}雙盜壘成功。`
          : successCount === 0
            ? `${actorLabel}雙盜壘失敗。`
            : `${actorLabel}雙盜壘一成一敗。`,
      );
    } else if (results[0]) {
      this.showEvent(results[0].success ? `${actorLabel}盜壘成功。` : `${actorLabel}盜壘失敗。`);
    }

    this.persist();
    this.updateUI();
  }

  updateUI() {
    this.ui.playerScore.textContent = String(this.state.score.player);
    this.ui.aiScore.textContent = String(this.state.score.ai);
    this.ui.inningLabel.textContent = displayInningLabel(this.state.inning, this.state.half);
    this.ui.roleLabel.textContent = this.playerIsBatting() ? '你在進攻' : '你在守備';
    this.ui.ballsCount.textContent = String(this.state.balls);
    this.ui.strikesCount.textContent = String(this.state.strikes);
    this.ui.outsCount.textContent = String(this.state.outs);
    this.ui.difficulty.value = this.state.difficulty;

    this.ui.baseChips.forEach((chip, index) => {
      chip.classList.toggle('active', Boolean(this.state.bases[index]));
      if (this.state.bases[index]) {
        chip.textContent = `${BASE_NAMES[index]} ${this.state.bases[index].team === 'player' ? '跑者' : 'AI'}`;
      } else {
        chip.textContent = BASE_NAMES[index];
      }
    });

    this.ui.pitchButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.pitch === this.state.selectedPitch);
      button.disabled = this.state.gameOver;
    });

    this.ui.zoneButtons.forEach((button, index) => {
      button.classList.toggle('active', index === this.state.selectedZone);
      button.disabled = this.state.gameOver;
    });
    this.updateZoneBoard();

    this.ui.primaryAction.textContent = this.playerIsPitching() ? '投球' : '揮棒';
    this.ui.primaryAction.disabled = this.state.gameOver || !this.canUsePrimaryAction();

    const battingPhaseOpen = this.phase === 'awaitPitch' || this.phase === 'pitching';
    this.ui.stealAction.disabled =
      this.state.gameOver ||
      !this.playerIsBatting() ||
      !battingPhaseOpen ||
      !this.canAttemptSteal('player');

    this.ui.doubleStealAction.disabled =
      this.state.gameOver ||
      !this.playerIsBatting() ||
      !battingPhaseOpen ||
      !this.canAttemptDoubleSteal('player');

    this.ui.phaseChip.textContent = this.state.gameOver ? '比賽結束' : this.state.lastEvent;
    this.ui.eventLog.textContent = this.state.lastEvent;
    this.ui.installAction.classList.toggle('hidden', !this.deferredPrompt);
  }
}
