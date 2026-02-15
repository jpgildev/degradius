const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  level: document.getElementById("level"),
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  combo: document.getElementById("combo"),
  power: document.getElementById("power"),
  bombMode: document.getElementById("bombMode"),
  megaCd: document.getElementById("megaCd"),
  lives: document.getElementById("lives"),
  fuel: document.getElementById("fuel"),
  bombs: document.getElementById("bombs")
};

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const CELL_W = 8;
const COLS = Math.floor(WIDTH / CELL_W) + 2;
const SCROLL_SPEED_SCALE = 1 / 6;
const UNLIMITED_BOMBS = true;
const SFX_ENABLED = true;

const hardnessPalette = [
  "#8f5f2f", // soft dirt
  "#a07b4d", // compact
  "#838484", // stone
  "#486f94" // reinforced
];

const bunkerPalette = ["#f6d15c", "#f48f6f", "#ff5d88", "#77f0c1"];
const bunkerTiers = {
  small: { radiusMin: 5, radiusMax: 7, hpBase: 20, hpPerLevel: 5, bountyBase: 120, bountyPerLevel: 28, upgradeChance: 0.08 },
  medium: { radiusMin: 8, radiusMax: 11, hpBase: 34, hpPerLevel: 7, bountyBase: 185, bountyPerLevel: 36, upgradeChance: 0.18 },
  large: { radiusMin: 12, radiusMax: 16, hpBase: 52, hpPerLevel: 10, bountyBase: 280, bountyPerLevel: 44, upgradeChance: 0.38 }
};
const shotPatterns = [
  [{ dy: 0, vy: 0 }],
  [{ dy: -3, vy: -0.16 }, { dy: 3, vy: 0.16 }],
  [{ dy: -6, vy: -0.24 }, { dy: 0, vy: 0 }, { dy: 6, vy: 0.24 }],
  [{ dy: -8, vy: -0.3 }, { dy: -2, vy: -0.09 }, { dy: 2, vy: 0.09 }, { dy: 8, vy: 0.3 }]
];
const shotTypePalette = {
  laser: { core: "#e8fdff", glow: "rgba(120, 235, 255, 0.8)" },
  pulse: { core: "#d6b4ff", glow: "rgba(183, 126, 255, 0.9)" },
  rocket: { core: "#ffd9b1", glow: "rgba(255, 178, 101, 0.9)" },
  blast: { core: "#fff3a8", glow: "rgba(255, 210, 90, 0.95)" },
  shard: { core: "#9ffff0", glow: "rgba(96, 245, 222, 0.85)" }
};
const enemyArchetypes = {
  scout: { hpBase: 14, hpPerStage: 2, wMin: 16, wMax: 22, hMin: 9, hMax: 13, speedMin: 1.1, speedMax: 2.0, driftMin: 0.6, driftMax: 1.2, scoreBase: 48 },
  bruiser: { hpBase: 30, hpPerStage: 4, wMin: 22, wMax: 30, hMin: 12, hMax: 16, speedMin: 0.75, speedMax: 1.35, driftMin: 0.2, driftMax: 0.45, scoreBase: 92 },
  diver: { hpBase: 18, hpPerStage: 3, wMin: 18, wMax: 24, hMin: 10, hMax: 14, speedMin: 1.2, speedMax: 1.8, driftMin: 0.35, driftMax: 0.7, scoreBase: 72 },
  zigzag: { hpBase: 20, hpPerStage: 3, wMin: 18, wMax: 24, hMin: 10, hMax: 14, speedMin: 1.0, speedMax: 1.6, driftMin: 0.8, driftMax: 1.4, scoreBase: 78 }
};

const keys = {
  left: false,
  right: false,
  up: false,
  down: false,
  bomb: false
};

const state = {
  tick: 0,
  score: 0,
  highScore: Number.parseInt(localStorage.getItem("degradius-high-score") || "0", 10) || 0,
  combo: 1,
  comboTimer: 0,
  lives: 3,
  fuel: 100,
  bombs: 30,
  terrain: [],
  bunkers: [],
  upgradeDrops: [],
  enemyProjectiles: [],
  floatTexts: [],
  particles: [],
  shockwaves: [],
  bombQueue: [],
  bombsFalling: [],
  shotQueue: [],
  shots: [],
  enemies: [],
  enemySpawnTimer: 0,
  scrollOffset: 0,
  nextTerrainCol: 0,
  scrollSpeed: 3.4,
  player: {
    x: WIDTH * 0.3,
    y: HEIGHT * 0.45,
    w: 34,
    h: 16,
    speed: 4.8,
    vx: 0,
    invulnTimer: 0,
    cooldown: 0,
    shotCooldown: 0
  },
  weaponLevel: 1,
  bombLevel: 1,
  speedLevel: 1,
  shieldLevel: 0,
  pulseLevel: 0,
  rapidLevel: 0,
  magnetLevel: 0,
  chainLevel: 0,
  bombMode: "standard",
  volleyCounter: 0,
  megaCooldown: 0,
  pulseCooldown: 0,
  toast: "",
  toastTimer: 0,
  paused: false,
  gameOver: false,
  message: ""
};
let audioCtx = null;
let audioUnlocked = false;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randi(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ensureAudio() {
  if (!SFX_ENABLED) return null;
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx = new Ctx();
  return audioCtx;
}

function unlockAudio() {
  if (!SFX_ENABLED) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === "running") {
    audioUnlocked = true;
    return;
  }
  ctx.resume()
    .then(() => {
      audioUnlocked = ctx.state === "running";
      if (audioUnlocked) playTone(660, 880, 0.035, 0.012, "triangle");
    })
    .catch(() => {});
}

function playTone(freqStart, freqEnd, duration, gain, type = "square") {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state !== "running" || !audioUnlocked) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, duration * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.01);
}

function playNoise(duration, gain, highpass = 700) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state !== "running" || !audioUnlocked) return;
  const len = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = highpass;
  const g = ctx.createGain();
  const t0 = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(hp).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.01);
}

function playSfx(kind) {
  if (!SFX_ENABLED) return;
  if (kind === "bomb_drop") {
    playTone(260, 140, 0.08, 0.03, "triangle");
    return;
  }
  if (kind === "blast") {
    playNoise(0.12, 0.08, 450);
    playTone(180, 70, 0.16, 0.035, "sawtooth");
    return;
  }
  if (kind === "pickup") {
    playTone(430, 860, 0.08, 0.03, "square");
    return;
  }
  if (kind === "hit") {
    playNoise(0.08, 0.05, 900);
    playTone(220, 120, 0.1, 0.02, "square");
    return;
  }
  if (kind === "laser") {
    playTone(780, 620, 0.045, 0.012, "square");
    return;
  }
  if (kind === "rocket") {
    playTone(260, 180, 0.08, 0.02, "triangle");
    playNoise(0.05, 0.018, 950);
    return;
  }
  if (kind === "pulse_shot") {
    playTone(520, 760, 0.065, 0.016, "triangle");
    return;
  }
  if (kind === "blast_shot") {
    playTone(360, 220, 0.1, 0.022, "sawtooth");
    return;
  }
  if (kind === "life_lost") {
    playNoise(0.2, 0.1, 500);
    playTone(240, 70, 0.28, 0.05, "sawtooth");
    return;
  }
  if (kind === "game_over") {
    playNoise(0.45, 0.16, 350);
    playTone(300, 45, 0.55, 0.08, "sawtooth");
  }
}

function currentStage() {
  // Geometric progression: each next stage needs a larger score jump.
  const maxStage = 30;
  let stage = 1;
  let delta = 120000;
  let threshold = delta;

  while (stage < maxStage && state.score >= threshold) {
    stage += 1;
    delta = Math.floor(delta * 1.28);
    threshold += delta;
  }

  return stage;
}

function makeLayers(depth, hardBase) {
  const layers = [];
  let remaining = depth;
  let hardnessBase = hardBase;

  while (remaining > 0) {
    const thickness = Math.min(remaining, randi(10, 24));
    const hardness = clamp(randi(0, 2) + hardnessBase, 0, 3);
    const maxHp = thickness * (1 + hardness * 0.85);
    layers.push({
      thickness,
      hp: maxHp,
      maxHp,
      hardness
    });
    remaining -= thickness;
    if (Math.random() > 0.7) hardnessBase = clamp(hardnessBase + 1, 0, 3);
  }

  return layers;
}

function makeColumn(colIndex, level) {
  const phase = colIndex + level * 24;
  const maxTerrainTotal = Math.floor(HEIGHT * 0.4);
  const minTerrainTotal = Math.floor(HEIGHT * 0.22);
  const totalTerrain = clamp(
    Math.floor(HEIGHT * 0.3 + Math.sin(phase * 0.058) * 34 + Math.sin(phase * 0.145) * 22 - level * 0.35),
    minTerrainTotal,
    maxTerrainTotal
  );
  const splitBias = 0.5 + Math.sin(phase * 0.09) * 0.22;
  const ceilingDepth = clamp(Math.floor(totalTerrain * splitBias), 10, totalTerrain - 10);
  const floorDepth = totalTerrain - ceilingDepth;
  const baseHard = clamp(Math.floor(level / 3), 0, 3);

  return {
    ceilingLayers: makeLayers(ceilingDepth, clamp(baseHard + 1, 0, 3)),
    floorLayers: makeLayers(floorDepth, baseHard)
  };
}

function layerStackHeight(layers) {
  let h = 0;
  for (const layer of layers) {
    if (layer.hp <= 0) continue;
    h += layer.thickness * (layer.hp / layer.maxHp);
  }
  return Math.max(0, Math.floor(h));
}

function columnFloorTop(i) {
  return HEIGHT - layerStackHeight(state.terrain[i].floorLayers);
}

function columnCeilingBottom(i) {
  return layerStackHeight(state.terrain[i].ceilingLayers);
}

function corridorBoundsAtScreenX(screenX) {
  const col = columnAtScreenX(screenX);
  return {
    ceiling: columnCeilingBottom(col),
    floor: columnFloorTop(col)
  };
}

function columnAtScreenX(screenX) {
  return clamp(Math.floor((screenX + state.scrollOffset) / CELL_W), 0, state.terrain.length - 1);
}

function digColumn(i, power) {
  const col = state.terrain[i];
  if (!col) return 0;

  let remaining = power;
  let removedHeight = 0;

  for (let li = 0; li < col.floorLayers.length && remaining > 0; li += 1) {
    const layer = col.floorLayers[li];
    if (layer.hp <= 0) continue;
    const factor = 0.85 + layer.hardness * 0.5;
    const dmg = Math.min(layer.hp, remaining / factor);
    layer.hp -= dmg;
    remaining -= dmg * factor;
    removedHeight += layer.thickness * (dmg / layer.maxHp);
  }

  return removedHeight;
}

function digCeilingColumn(i, power) {
  const col = state.terrain[i];
  if (!col) return 0;

  let remaining = power;
  let removedHeight = 0;

  for (let li = col.ceilingLayers.length - 1; li >= 0 && remaining > 0; li -= 1) {
    const layer = col.ceilingLayers[li];
    if (layer.hp <= 0) continue;
    const factor = 0.85 + layer.hardness * 0.5;
    const dmg = Math.min(layer.hp, remaining / factor);
    layer.hp -= dmg;
    remaining -= dmg * factor;
    removedHeight += layer.thickness * (dmg / layer.maxHp);
  }

  return removedHeight;
}

function placeBunkers(level) {
  const count = 8 + Math.floor(level * 2);
  state.bunkers = [];
  for (let i = 0; i < count; i += 1) spawnBunkerInRange(16, state.terrain.length - 10, level);

  if (state.bunkers.length > 0 && !state.bunkers.some((b) => b.containsUpgrade)) {
    const idx = randi(0, state.bunkers.length - 1);
    state.bunkers[idx].containsUpgrade = true;
    state.bunkers[idx].upgradeType = pickUpgradeType();
  }
}

function pickTier() {
  const roll = Math.random();
  if (roll < 0.5) return "small";
  if (roll < 0.85) return "medium";
  return "large";
}

function pickUpgradeType() {
  const roll = Math.random();
  if (roll < 0.24) return "weapon";
  if (roll < 0.42) return "bomb";
  if (roll < 0.56) return "rapid";
  if (roll < 0.68) return "magnet";
  if (roll < 0.78) return "chain";
  if (roll < 0.86) return "speed";
  if (roll < 0.94) return "shield";
  return "pulse";
}

function spawnBunkerInRange(colMin, colMax, level) {
  let tries = 0;
  while (tries < 80) {
    tries += 1;
    const col = randi(colMin, colMax);
    const top = columnFloorTop(col);
    const depth = HEIGHT - top;
    if (depth < 36) continue;

    const tier = pickTier();
    const tierCfg = bunkerTiers[tier];
    const radius = randi(tierCfg.radiusMin, tierCfg.radiusMax);
    const y = randi(top + radius + 8, Math.min(HEIGHT - radius - 8, top + Math.floor(depth * 0.86)));
    const hp = randi(tierCfg.hpBase, tierCfg.hpBase + 8) + level * tierCfg.hpPerLevel;
    const x = col * CELL_W + CELL_W / 2;
    const containsUpgrade = Math.random() < tierCfg.upgradeChance;

    const overlap = state.bunkers.some((b) => Math.abs(b.x - x) < radius * 3 && Math.abs(b.y - y) < radius * 3);
    if (overlap) continue;

    state.bunkers.push({
      x,
      y,
      hp,
      maxHp: hp,
      radius,
      tier,
      bounty: tierCfg.bountyBase + level * tierCfg.bountyPerLevel,
      containsUpgrade,
      upgradeType: containsUpgrade ? pickUpgradeType() : null,
      color: bunkerPalette[randi(0, bunkerPalette.length - 1)]
    });
    return true;
  }
  return false;
}

function initLevel() {
  const stage = currentStage();
  state.terrain = Array.from({ length: COLS }, (_, i) => makeColumn(i, stage));
  state.nextTerrainCol = COLS;
  state.scrollOffset = 0;
  placeBunkers(stage);

  state.bombsFalling = [];
  state.upgradeDrops = [];
  state.enemyProjectiles = [];
  state.floatTexts = [];
  state.shockwaves = [];
  state.bombQueue = [];
  state.shotQueue = [];
  state.shots = [];
  state.enemies = [];
  state.enemySpawnTimer = 102;
  state.particles = [];
  state.gameOver = false;
  state.message = "";

  state.fuel = 100;
  state.bombs = UNLIMITED_BOMBS ? 0 : 42 + stage * 4;
  state.scrollSpeed = (3.4 + stage * 0.16) * SCROLL_SPEED_SCALE;

  state.player.x = WIDTH * 0.3;
  state.player.y = HEIGHT * 0.45;
  state.player.vx = 0;
  state.player.invulnTimer = 70;
  state.player.cooldown = 0;
  state.player.shotCooldown = 0;
  state.combo = 1;
  state.comboTimer = 0;
  state.pulseCooldown = 0;
  state.volleyCounter = 0;
  state.toast = "";
  state.toastTimer = 0;
  state.player.speed = 4.8 + (state.speedLevel - 1) * 0.55;
}

function spawnExplosion(x, y, color = "#ffcf55", count = 24) {
  for (let i = 0; i < count; i += 1) {
    const a = rand(0, Math.PI * 2);
    const s = rand(0.8, 3.6);
    state.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 0.6,
      life: randi(18, 40),
      color
    });
  }
}

function spawnShockwave(x, y, maxRadius, life = 22, color = "#ffd27a") {
  state.shockwaves.push({
    x,
    y,
    radius: 8,
    maxRadius,
    life,
    maxLife: life,
    color
  });
}

function createBomb(params = {}) {
  const vxWorld = params.vxWorld ?? state.scrollSpeed + 2.25 + state.player.vx * 0.6;
  return {
    type: params.type || "standard",
    x: params.x ?? state.player.x + 8,
    y: params.y ?? state.player.y + 8,
    vxWorld,
    vy: params.vy ?? 1.8,
    blast: params.blast ?? 82,
    phase: params.phase || "air",
    runnerTimer: params.runnerTimer ?? 8,
    runnerSteps: params.runnerSteps ?? 0
  };
}

function queueBomb(delay, params) {
  state.bombQueue.push({ delay, params });
}

function spawnBomb() {
  if (state.player.cooldown > 0 || state.gameOver) return;
  if (!UNLIMITED_BOMBS && state.bombs <= 0) return;
  if (!UNLIMITED_BOMBS) state.bombs -= 1;

  const blastScale = 1 + (state.bombLevel - 1) * 0.22;
  const baseBlast = 82 * blastScale;

  if (state.bombMode === "mega") {
    if (state.megaCooldown > 0) {
      showToast(`Mega Cooldown ${(state.megaCooldown / 60).toFixed(1)}s`);
      return;
    }
    state.player.cooldown = 26;
    state.megaCooldown = 720;
    state.bombsFalling.push(
      createBomb({
        type: "mega",
        blast: baseBlast * 2.45,
        vy: 2.2,
        vxWorld: state.scrollSpeed + 2.05 + state.player.vx * 0.55
      })
    );
    queueBomb(18, { type: "cluster", blast: baseBlast * 0.55, vy: 1.5 });
    queueBomb(34, { type: "runner", blast: baseBlast * 0.7, vy: 1.45 });
  } else if (state.bombMode === "cluster") {
    state.player.cooldown = 18;
    state.bombsFalling.push(createBomb({ type: "cluster", blast: baseBlast * 0.9, vy: 1.65 }));
    queueBomb(10, { type: "standard", blast: baseBlast * 0.52, vy: 1.45 });
    queueBomb(20, { type: "standard", blast: baseBlast * 0.52, vy: 1.4 });
  } else if (state.bombMode === "runner") {
    state.player.cooldown = 14;
    state.bombsFalling.push(createBomb({ type: "runner", blast: baseBlast * 0.95, vy: 1.6 }));
    queueBomb(12, { type: "runner", blast: baseBlast * 0.55, vy: 1.45 });
  } else {
    state.player.cooldown = 12;
    state.bombsFalling.push(createBomb({ type: "standard", blast: baseBlast, vy: 1.8 }));
    queueBomb(9, { type: "standard", blast: baseBlast * 0.45, vy: 1.4 });
  }

  playSfx("bomb_drop");
}

function createShot(params = {}) {
  return {
    kind: params.kind || "laser",
    x: params.x ?? state.player.x + state.player.w / 2 - 2,
    y: params.y ?? state.player.y,
    vx: params.vx ?? 9.8,
    vy: params.vy ?? 0,
    damage: params.damage ?? 10,
    radius: params.radius ?? 3,
    life: params.life ?? 80,
    pierce: params.pierce ?? 0,
    blastRadius: params.blastRadius ?? 0,
    terrainDamage: params.terrainDamage ?? 0,
    wobble: params.wobble ?? 0,
    wobbleSpeed: params.wobbleSpeed ?? 0.22,
    homing: params.homing ?? 0,
    split: params.split ?? 0
  };
}

function queueShot(delay, params) {
  state.shotQueue.push({ delay, params });
}

function pushShotPattern(pattern, base) {
  for (const node of pattern) {
    state.shots.push(
      createShot({
        ...base,
        y: (base.y ?? state.player.y) + node.dy,
        vy: (base.vy ?? 0) + node.vy
      })
    );
  }
}

function spawnSplitShards(x, y, power) {
  const shardCount = 4 + state.chainLevel;
  for (let i = 0; i < shardCount; i += 1) {
    const angle = -0.35 + (i / Math.max(1, shardCount - 1)) * 0.9;
    state.shots.push(
      createShot({
        kind: "shard",
        x,
        y,
        vx: 6.8 + Math.cos(angle) * 2.3,
        vy: Math.sin(angle) * 2.6,
        damage: power * 0.42,
        radius: 2.6,
        life: 38,
        pierce: 0
      })
    );
  }
}

function spawnShot() {
  const pattern = shotPatterns[Math.min(shotPatterns.length - 1, state.weaponLevel - 1)];
  const volley = state.volleyCounter;
  state.volleyCounter += 1;
  const rapidBoost = state.rapidLevel * 0.25;
  const shotVx = 9.3 + state.weaponLevel * 0.5 + rapidBoost;
  const x = state.player.x + state.player.w / 2 - 2;
  const y = state.player.y - 1;

  pushShotPattern(pattern, {
    kind: "laser",
    x,
    y,
    vx: shotVx,
    damage: 10 + state.weaponLevel * 2,
    radius: 3.1,
    life: 74
  });

  if (volley % 4 === 0 || state.weaponLevel >= 3) {
    state.shots.push(
      createShot({
        kind: "pulse",
        x: x + 2,
        y,
        vx: shotVx * 0.82,
        damage: 16 + state.weaponLevel * 4,
        radius: 5.5,
        life: 84,
        pierce: 2,
        wobble: rand(0, Math.PI * 2),
        wobbleSpeed: 0.28,
        split: state.weaponLevel >= 4 ? 1 : 0
      })
    );
    playSfx("pulse_shot");
  } else {
    playSfx("laser");
  }

  if (state.weaponLevel >= 2 && volley % 5 === 0) {
    state.shots.push(
      createShot({
        kind: "rocket",
        x: x - 1,
        y: y - 2,
        vx: 6.6 + state.weaponLevel * 0.45,
        vy: -0.18,
        damage: 22 + state.weaponLevel * 5,
        radius: 4.2,
        blastRadius: 42 + state.weaponLevel * 5,
        terrainDamage: 30 + state.weaponLevel * 8,
        life: 96,
        homing: 0.045 + state.weaponLevel * 0.006
      })
    );
    playSfx("rocket");
  }

  if (state.weaponLevel >= 3 && volley % 7 === 0) {
    const fan = [-0.44, -0.16, 0.16, 0.44];
    for (const drift of fan) {
      state.shots.push(
        createShot({
          kind: "shard",
          x: x + 6,
          y: y + drift * 8,
          vx: shotVx * 0.84,
          vy: drift * 2.9,
          damage: 8 + state.weaponLevel * 2,
          radius: 2.5,
          life: 54
        })
      );
    }
  }

  if (state.weaponLevel >= 4 && volley % 11 === 0) {
    state.shots.push(
      createShot({
        kind: "blast",
        x: x + 4,
        y,
        vx: shotVx * 0.76,
        damage: 34 + state.weaponLevel * 8,
        radius: 7.5,
        life: 62,
        pierce: 3,
        blastRadius: 58,
        terrainDamage: 42
      })
    );
    playSfx("blast_shot");
  }

  if (state.chainLevel > 0 && volley % clamp(12 - state.chainLevel * 2, 5, 10) === 0) {
    queueShot(5, {
      kind: "laser",
      x: x + 1,
      y: y - 5,
      vx: shotVx * 0.95,
      vy: -0.18,
      damage: 8 + state.chainLevel * 2,
      radius: 2.8,
      life: 50
    });
    queueShot(9, {
      kind: "laser",
      x: x + 1,
      y: y + 5,
      vx: shotVx * 0.95,
      vy: 0.18,
      damage: 8 + state.chainLevel * 2,
      radius: 2.8,
      life: 50
    });
  }
}

function spawnUpgradeDrop(x, y, type) {
  state.upgradeDrops.push({
    x,
    y,
    type,
    radius: 9,
    bobPhase: rand(0, Math.PI * 2)
  });
}

function showToast(text) {
  state.toast = text;
  state.toastTimer = 120;
}

function spawnFloatText(x, y, text, color = "#dff4ff", size = 14, life = 32) {
  state.floatTexts.push({
    x,
    y,
    text,
    color,
    size,
    life,
    maxLife: life
  });
}

function loseLife(reason) {
  if (state.gameOver || state.player.invulnTimer > 0) return;

  state.lives -= 1;
  spawnExplosion(state.player.x, state.player.y, "#ff8080", 68);
  spawnShockwave(state.player.x, state.player.y, 84, 20, "#ffb0b0");

  if (state.lives <= 0) {
    for (let i = 0; i < 12; i += 1) {
      const a = (Math.PI * 2 * i) / 12;
      const d = 24 + i * 7;
      const ex = state.player.x + Math.cos(a) * d;
      const ey = state.player.y + Math.sin(a) * d * 0.75;
      spawnExplosion(ex, ey, i % 2 === 0 ? "#ff8459" : "#ffd088", 80 - i * 2);
      spawnShockwave(ex, ey, 110 + i * 8, 24, "#ffd6a4");
    }
    playSfx("game_over");
    state.gameOver = true;
    state.message = `${reason} No lives left. Press R to retry.`;
    return;
  }

  playSfx("life_lost");
  state.player.invulnTimer = 130;
  showToast(`Life Lost - ${state.lives} left`);
}

function applyUpgrade(type) {
  playSfx("pickup");
  if (type === "weapon") {
    if (state.weaponLevel < 4) {
      state.weaponLevel += 1;
      showToast(`Weapon Up W${state.weaponLevel}`);
    } else {
      state.score += 120;
      showToast("Weapon Max +120");
    }
    return;
  }

  if (type === "bomb") {
    if (state.bombLevel < 4) {
      state.bombLevel += 1;
      showToast(`Bomb Up B${state.bombLevel}`);
    } else {
      state.score += 120;
      showToast("Bomb Max +120");
    }
    return;
  }

  if (type === "speed") {
    if (state.speedLevel < 4) {
      state.speedLevel += 1;
      state.player.speed = 4.8 + (state.speedLevel - 1) * 0.55;
      showToast(`Speed Up S${state.speedLevel}`);
    } else {
      state.score += 120;
      showToast("Speed Max +120");
    }
    return;
  }

  if (type === "rapid") {
    if (state.rapidLevel < 3) {
      state.rapidLevel += 1;
      showToast(`Rapid Up R${state.rapidLevel}`);
    } else {
      state.score += 120;
      showToast("Rapid Max +120");
    }
    return;
  }

  if (type === "magnet") {
    if (state.magnetLevel < 3) {
      state.magnetLevel += 1;
      showToast(`Magnet Up M${state.magnetLevel}`);
    } else {
      state.score += 120;
      showToast("Magnet Max +120");
    }
    return;
  }

  if (type === "chain") {
    if (state.chainLevel < 3) {
      state.chainLevel += 1;
      showToast(`Chain Up C${state.chainLevel}`);
    } else {
      state.score += 120;
      showToast("Chain Max +120");
    }
    return;
  }

  if (type === "shield") {
    if (state.shieldLevel < 2) {
      state.shieldLevel += 1;
      showToast(state.shieldLevel === 2 ? "Double Shield Online" : "Shield Online");
    } else {
      state.score += 140;
      showToast("Shield Max +140");
    }
    return;
  }

  if (type === "pulse") {
    if (state.pulseLevel < 2) {
      state.pulseLevel += 1;
      showToast(`Pulse Up P${state.pulseLevel}`);
    } else {
      state.score += 140;
      showToast("Pulse Max +140");
    }
  }
}

function triggerPulseBlast() {
  const stage = currentStage();
  const radius = 72 + state.pulseLevel * 34;
  const power = 28 + state.pulseLevel * 18;
  const x = state.player.x + 10;
  const y = state.player.y;
  const col = columnAtScreenX(x);
  const colRadius = Math.ceil(radius / CELL_W);

  for (let i = col - colRadius; i <= col + colRadius; i += 1) {
    if (i < 0 || i >= state.terrain.length) continue;
    const sx = i * CELL_W - state.scrollOffset + CELL_W / 2;
    const dist = Math.abs(sx - x);
    const falloff = Math.max(0, 1 - dist / radius);
    if (falloff <= 0) continue;
    const terrainPower = power * falloff;
    state.score += Math.floor(digColumn(i, terrainPower) * 4);
    state.score += Math.floor(digCeilingColumn(i, terrainPower * 0.82) * 3);
  }

  damageBunkers(x, y, power * 2.4, radius);

  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    const d = Math.hypot(enemy.x - x, enemy.y - y);
    if (d > radius) continue;
    enemy.hp -= power * 1.7;
    if (enemy.hp <= 0) {
      state.score += 48 + stage * 10;
      spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 18);
      state.enemies.splice(i, 1);
    }
  }

  spawnShockwave(x, y, radius, 18, "#9cf4ff");
  spawnExplosion(x, y, "#b8f9ff", 42);
}

function pickEnemyType(stage) {
  const roll = Math.random();
  if (stage < 3) return roll < 0.8 ? "scout" : "zigzag";
  if (stage < 6) {
    if (roll < 0.5) return "scout";
    if (roll < 0.75) return "zigzag";
    return "diver";
  }
  if (roll < 0.34) return "scout";
  if (roll < 0.58) return "zigzag";
  if (roll < 0.8) return "diver";
  return "bruiser";
}

function spawnEnemy() {
  const stage = currentStage();
  const type = pickEnemyType(stage);
  const spec = enemyArchetypes[type];
  const corridor = corridorBoundsAtScreenX(WIDTH - 12);
  const minY = corridor.ceiling + 22;
  const maxY = corridor.floor - 22;
  const y = randi(minY, Math.max(minY + 4, maxY));
  const hpRamp = 0.62 + stage * 0.065;
  const hp = Math.floor(spec.hpBase + spec.hpPerStage * hpRamp);
  const eliteChance = clamp((stage - 8) * 0.012, 0, 0.22);
  const elite = Math.random() < eliteChance;
  const sizeScale = elite ? 1.22 : 1;
  const hpScaled = Math.floor(hp * (elite ? 1.42 : 1));
  const fireBase = randi(114, 156) - stage;

  state.enemies.push({
    type,
    x: WIDTH + 24,
    y,
    w: Math.floor(randi(spec.wMin, spec.wMax) * sizeScale),
    h: Math.floor(randi(spec.hMin, spec.hMax) * sizeScale),
    hp: hpScaled,
    maxHp: hpScaled,
    value: Math.floor((spec.scoreBase + stage * 8) * (elite ? 1.8 : 1)),
    elite,
    vx: (rand(spec.speedMin, spec.speedMax) + stage * 0.022) * (elite ? 1.04 : 1),
    wobble: rand(0, Math.PI * 2),
    drift: rand(spec.driftMin, spec.driftMax),
    diveArmed: type === "diver" ? Math.random() > 0.45 : false,
    fireCooldown: clamp(fireBase, 38, 170)
  });
}

function updatePlayer() {
  if (state.gameOver) return;
  const stage = currentStage();

  const startX = state.player.x;
  if (keys.left) state.player.x -= state.player.speed;
  if (keys.right) state.player.x += state.player.speed;
  if (keys.up) state.player.y -= state.player.speed * 0.9;
  if (keys.down) state.player.y += state.player.speed * 0.9;

  state.player.x = clamp(state.player.x, state.player.w / 2, WIDTH - state.player.w / 2);
  const corridor = corridorBoundsAtScreenX(state.player.x);
  const minY = corridor.ceiling + state.player.h / 2 + 4;
  const maxY = corridor.floor - state.player.h / 2 - 4;
  state.player.y = clamp(state.player.y, minY, maxY);
  state.player.vx = state.player.x - startX;

  if (state.player.cooldown > 0) state.player.cooldown -= 1;
  if (state.player.invulnTimer > 0) state.player.invulnTimer -= 1;
  if (keys.bomb) spawnBomb();
  if (state.player.shotCooldown > 0) {
    state.player.shotCooldown -= 1;
  } else {
    spawnShot();
    state.player.shotCooldown = Math.max(4, 10 - Math.floor(stage * 0.12) - state.rapidLevel * 2);
  }

}

function updateEnemies() {
  const stage = currentStage();
  state.enemySpawnTimer -= 1;
  if (state.enemySpawnTimer <= 0) {
    const pack = clamp(1 + Math.floor(stage / 12), 1, 4);
    for (let i = 0; i < pack; i += 1) spawnEnemy();
    const base = 142 - stage * 1.2;
    state.enemySpawnTimer = clamp(randi(base - 18, base + 14), 42, 170);
  }

  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    enemy.x -= enemy.vx + state.scrollSpeed * 0.2;
    enemy.wobble += enemy.drift * 0.04;

    if (enemy.type === "scout") {
      enemy.y += Math.sin(enemy.wobble) * 0.65;
    } else if (enemy.type === "bruiser") {
      enemy.y += Math.sin(enemy.wobble * 0.6) * 0.22;
    } else if (enemy.type === "diver") {
      enemy.y += Math.sin(enemy.wobble * 0.9) * 0.45;
      if (enemy.diveArmed && enemy.x < WIDTH * 0.72) {
        enemy.y += (state.player.y - enemy.y) * 0.04;
      }
    } else if (enemy.type === "zigzag") {
      enemy.y += Math.sin(enemy.wobble * 1.8) * 1.15;
    }

    const corridor = corridorBoundsAtScreenX(enemy.x);
    enemy.y = clamp(enemy.y, corridor.ceiling + 14, corridor.floor - 14);

    if (stage >= 9 && enemy.x < WIDTH - 70) {
      enemy.fireCooldown -= 1;
      if (enemy.fireCooldown <= 0) {
        const tx = state.player.x + rand(-14, 14);
        const ty = state.player.y + rand(-10, 10);
        const dxAim = tx - enemy.x;
        const dyAim = ty - enemy.y;
        const len = Math.hypot(dxAim, dyAim) || 1;
        const speed = 1.9 + stage * 0.04 + (enemy.elite ? 0.3 : 0);
        state.enemyProjectiles.push({
          x: enemy.x,
          y: enemy.y,
          vx: (dxAim / len) * speed,
          vy: (dyAim / len) * speed,
          life: 220,
          elite: enemy.elite
        });
        enemy.fireCooldown = clamp(randi(132 - stage * 1.5, 178 - stage * 0.4), 48, 176);
      }
    }

    const dx = Math.abs(enemy.x - state.player.x);
    const dy = Math.abs(enemy.y - state.player.y);
    if (state.player.invulnTimer <= 0 && dx < (enemy.w + state.player.w) * 0.45 && dy < (enemy.h + state.player.h) * 0.55) {
      if (state.shieldLevel > 0) {
        state.shieldLevel -= 1;
        spawnShockwave(state.player.x, state.player.y, 44, 14, "#97f7ff");
        showToast(state.shieldLevel > 0 ? "Shield Hit" : "Shield Down");
        playSfx("hit");
      } else {
        loseLife("Hit.");
        spawnExplosion(enemy.x, enemy.y, "#ff6666", 28);
      }
      spawnExplosion(enemy.x, enemy.y, "#ff6666", 20);
      state.enemies.splice(i, 1);
      continue;
    }

    if (enemy.x < -40) state.enemies.splice(i, 1);
  }
}

function updateShotQueue() {
  for (let i = state.shotQueue.length - 1; i >= 0; i -= 1) {
    const entry = state.shotQueue[i];
    entry.delay -= 1;
    if (entry.delay > 0) continue;
    state.shots.push(createShot(entry.params));
    state.shotQueue.splice(i, 1);
  }
}

function applyShotSplash(shot, x, y, damageScale = 0.56) {
  if (shot.blastRadius <= 0) return;
  const radius = shot.blastRadius;
  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    const d = Math.hypot(enemy.x - x, enemy.y - y);
    if (d > radius) continue;
    const dmg = Math.max(4, shot.damage * damageScale * (1 - d / radius));
    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      state.score += enemy.value || 68;
      spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 16);
      spawnFloatText(enemy.x, enemy.y - 10, `+${enemy.value || 68}`, "#a6ffbf", 14, 24);
      state.enemies.splice(i, 1);
    }
  }
  if (shot.terrainDamage > 0) {
    applyBlastDamage(x, y, shot.terrainDamage, 2);
  }
  spawnShockwave(x, y, radius * 0.85, 12, "#ffd3a1");
}

function updateShots() {
  const stage = currentStage();
  updateShotQueue();

  for (let i = state.shots.length - 1; i >= 0; i -= 1) {
    const shot = state.shots[i];
    shot.life -= 1;
    if (shot.life <= 0) {
      state.shots.splice(i, 1);
      continue;
    }

    if (shot.kind === "pulse") {
      shot.wobble += shot.wobbleSpeed;
      shot.y += Math.sin(shot.wobble) * 0.75;
    } else if (shot.kind === "rocket") {
      let target = null;
      let closest = Infinity;
      for (const enemy of state.enemies) {
        if (enemy.x < shot.x - 10) continue;
        const d = Math.hypot(enemy.x - shot.x, enemy.y - shot.y);
        if (d < 180 && d < closest) {
          closest = d;
          target = enemy;
        }
      }
      if (target) {
        shot.vy += clamp((target.y - shot.y) * shot.homing, -0.26, 0.26);
      }
      shot.vy *= 0.97;
    }

    shot.x += shot.vx;
    shot.y += shot.vy;

    let removeShot = false;
    for (let ei = state.enemies.length - 1; ei >= 0; ei -= 1) {
      const enemy = state.enemies[ei];
      const dx = Math.abs(shot.x - enemy.x);
      const dy = Math.abs(shot.y - enemy.y);
      const reachX = enemy.w * 0.55 + shot.radius;
      const reachY = enemy.h * 0.65 + shot.radius;
      if (dx > reachX || dy > reachY) continue;

      enemy.hp -= shot.damage;
      spawnFloatText(shot.x + 2, shot.y - 4, `${Math.floor(shot.damage)}`, "#90ecff", 11, 16);

      if (shot.kind === "rocket" || shot.kind === "blast") {
        applyShotSplash(shot, shot.x, shot.y);
        spawnExplosion(shot.x, shot.y, shot.kind === "blast" ? "#ffd882" : "#ffb978", 22);
        removeShot = true;
      } else if (shot.kind === "pulse" && shot.split > 0) {
        spawnSplitShards(shot.x, shot.y, shot.damage);
        shot.split = 0;
      }

      if (enemy.hp <= 0) {
        state.score += enemy.value || 55 + stage * 12;
        spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 18);
        spawnFloatText(enemy.x, enemy.y - 10, `+${enemy.value || 55 + stage * 12}`, "#a6ffbf", 14, 28);
        state.enemies.splice(ei, 1);
      }

      if (shot.pierce > 0) {
        shot.pierce -= 1;
      } else {
        removeShot = true;
      }
      if (removeShot) break;
    }

    if (
      removeShot ||
      shot.x > WIDTH + 30 ||
      shot.x < -20 ||
      shot.y < -20 ||
      shot.y > HEIGHT + 20
    ) {
      state.shots.splice(i, 1);
    }
  }
}

function updateEnemyProjectiles() {
  for (let i = state.enemyProjectiles.length - 1; i >= 0; i -= 1) {
    const p = state.enemyProjectiles[i];
    p.x += p.vx - state.scrollSpeed * 0.2;
    p.y += p.vy;
    p.life -= 1;

    if (state.player.invulnTimer <= 0) {
      const dx = Math.abs(p.x - state.player.x);
      const dy = Math.abs(p.y - state.player.y);
      if (dx < state.player.w * 0.45 && dy < state.player.h * 0.45) {
        if (state.shieldLevel > 0) {
          state.shieldLevel -= 1;
          spawnShockwave(state.player.x, state.player.y, 40, 12, "#97f7ff");
          showToast(state.shieldLevel > 0 ? "Shield Hit" : "Shield Down");
          playSfx("hit");
        } else {
          loseLife("Shot down.");
        }
        state.enemyProjectiles.splice(i, 1);
        continue;
      }
    }

    if (p.life <= 0 || p.x < -18 || p.x > WIDTH + 18 || p.y < -18 || p.y > HEIGHT + 18) {
      state.enemyProjectiles.splice(i, 1);
    }
  }
}

function updateUpgradeDrops() {
  for (let i = state.upgradeDrops.length - 1; i >= 0; i -= 1) {
    const drop = state.upgradeDrops[i];
    drop.x -= state.scrollSpeed * 0.9;
    drop.bobPhase += 0.08;
    drop.y += Math.sin(drop.bobPhase) * 0.45;

    if (state.magnetLevel > 0) {
      const pullRadius = 80 + state.magnetLevel * 36;
      const mdx = state.player.x - drop.x;
      const mdy = state.player.y - drop.y;
      const dist = Math.hypot(mdx, mdy);
      if (dist < pullRadius && dist > 0.001) {
        const pull = (state.magnetLevel * 0.4 + 0.3) * (1 - dist / pullRadius);
        drop.x += (mdx / dist) * pull * 6;
        drop.y += (mdy / dist) * pull * 6;
      }
    }

    const pickupPad = state.magnetLevel * 4;
    const dx = Math.abs(drop.x - state.player.x);
    const dy = Math.abs(drop.y - state.player.y);
    if (dx < state.player.w * 0.55 + pickupPad && dy < state.player.h * 0.55 + pickupPad) {
      applyUpgrade(drop.type);
      spawnExplosion(drop.x, drop.y, "#8fffe6", 30);
      state.upgradeDrops.splice(i, 1);
      continue;
    }

    if (drop.x < -18) state.upgradeDrops.splice(i, 1);
  }
}

function scrollWorld() {
  if (state.gameOver) return;
  const stage = currentStage();

  state.scrollOffset += state.scrollSpeed;

  for (const bunker of state.bunkers) bunker.x -= state.scrollSpeed;

  while (state.scrollOffset >= CELL_W) {
    state.scrollOffset -= CELL_W;
    state.terrain.shift();
    state.terrain.push(makeColumn(state.nextTerrainCol, stage));
    state.nextTerrainCol += 1;
  }

  const kept = [];
  for (const bunker of state.bunkers) {
    if (bunker.x < -20) {
      state.score = Math.max(0, state.score - 75);
      continue;
    }
    kept.push(bunker);
  }
  state.bunkers = kept;

  const targetBunkers = 10;
  if (state.bunkers.length < targetBunkers) {
    const colMin = Math.max(18, state.terrain.length - 44);
    const colMax = state.terrain.length - 8;
    spawnBunkerInRange(colMin, colMax, stage);
  }
}

function damageBunkers(x, y, power, radius) {
  let destroyed = 0;
  let bounty = 0;
  for (const bunker of state.bunkers) {
    const dx = bunker.x - x;
    const dy = bunker.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist > radius + bunker.radius) continue;
    const hit = Math.max(0, power - dist * 0.9);
    bunker.hp -= hit;
    if (bunker.hp <= 0) {
      destroyed += 1;
      bounty += bunker.bounty;
      spawnExplosion(bunker.x, bunker.y, bunker.color, 24 + bunker.radius * 2);
      spawnFloatText(bunker.x, bunker.y - 10, `+${bunker.bounty}`, "#ffe6a8", 13, 24);
      if (bunker.containsUpgrade && bunker.upgradeType) {
        spawnUpgradeDrop(bunker.x, bunker.y, bunker.upgradeType);
      }
    }
  }

  if (destroyed > 0) {
    state.combo = clamp(state.combo + destroyed * 0.18, 1, 4.5);
    state.comboTimer = 210;
    state.score += Math.floor(bounty * state.combo);
    spawnFloatText(x, y - 18, `x${state.combo.toFixed(1)}`, "#ffd0ff", 15, 26);
  }

  state.bunkers = state.bunkers.filter((b) => b.hp > 0);
}

function applyBlastDamage(x, y, blast, terrainScoreScale = 8) {
  const col = columnAtScreenX(x);
  const blastCols = Math.ceil(blast / 14);

  for (let i = col - blastCols; i <= col + blastCols; i += 1) {
    if (i < 0 || i >= state.terrain.length) continue;
    const distance = Math.abs(i - col);
    const power = blast * (1 - distance * 0.11);
    if (power <= 0) continue;
    const dug = digColumn(i, power);
    state.score += Math.floor(dug * terrainScoreScale);
  }

  damageBunkers(x, y, blast * 2.15, blast * 0.9);

  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    const d = Math.hypot(enemy.x - x, enemy.y - y);
    if (d > blast * 0.82) continue;
    enemy.hp -= blast * 0.56;
    spawnFloatText(enemy.x, enemy.y - 4, `${Math.floor(blast * 0.56)}`, "#ffcf9f", 11, 16);
    if (enemy.hp <= 0) {
      state.score += enemy.value || 60;
      spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 16);
      spawnFloatText(enemy.x, enemy.y - 11, `+${enemy.value || 60}`, "#a6ffbf", 14, 26);
      state.enemies.splice(i, 1);
    }
  }
}

function explodeBomb(bomb, impactY) {
  applyBlastDamage(bomb.x, impactY, bomb.blast, 8);
  spawnExplosion(bomb.x, impactY, "#ffc866", 78);
  spawnShockwave(bomb.x, impactY, bomb.blast * 1.45, 24, "#ffefb8");
  playSfx("blast");

  if (state.chainLevel > 0) {
    const chainCount = 1 + state.chainLevel;
    const clusterRadius = 26 + state.chainLevel * 10;
    const subBlast = bomb.blast * (0.32 + state.chainLevel * 0.08);
    for (let i = 0; i < chainCount; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(8, clusterRadius);
      const cx = bomb.x + Math.cos(angle) * dist;
      const cy = impactY + Math.sin(angle) * dist * 0.45;
      applyBlastDamage(cx, cy, subBlast, 4);
      spawnExplosion(cx, cy, "#ffb36a", 26);
      spawnShockwave(cx, cy, subBlast * 0.9, 14, "#ffd8a6");
    }
  }
}

function updateBombQueue() {
  for (let i = state.bombQueue.length - 1; i >= 0; i -= 1) {
    const entry = state.bombQueue[i];
    entry.delay -= 1;
    if (entry.delay > 0) continue;
    state.bombsFalling.push(createBomb(entry.params));
    state.bombQueue.splice(i, 1);
  }
}

function updateBombs() {
  if (state.megaCooldown > 0) state.megaCooldown -= 1;
  updateBombQueue();

  for (let i = state.bombsFalling.length - 1; i >= 0; i -= 1) {
    const b = state.bombsFalling[i];
    if (b.phase === "runner") {
      b.x += (b.vxWorld + 1.6) - state.scrollSpeed;
      b.runnerTimer -= 1;
      if (b.runnerTimer <= 0) {
        b.runnerTimer = 7;
        b.runnerSteps += 1;
        const burst = b.blast * (0.33 + Math.min(0.22, b.runnerSteps * 0.03));
        applyBlastDamage(b.x, b.y, burst, 4);
        spawnExplosion(b.x, b.y, "#ff9c5e", 24);
        spawnShockwave(b.x, b.y, burst * 0.72, 12, "#ffd19f");
      }

      if (b.runnerSteps >= 6 || b.x > WIDTH + 28) {
        explodeBomb({ ...b, blast: b.blast * 0.85 }, b.y);
        state.bombsFalling.splice(i, 1);
      }
      continue;
    }

    // World-space horizontal velocity with light drag, then convert to screen-space.
    b.vxWorld = Math.max(state.scrollSpeed * 0.95, b.vxWorld * 0.997);
    b.vy += 0.16;
    b.x += b.vxWorld - state.scrollSpeed;
    b.y += b.vy;

    const col = columnAtScreenX(b.x);
    const top = columnFloorTop(col);

    if (b.y >= top) {
      if (b.type === "runner") {
        b.phase = "runner";
        b.y = top + 4;
        b.runnerTimer = 6;
        b.runnerSteps = 0;
        spawnShockwave(b.x, top, 36, 10, "#ffd8a5");
        continue;
      }

      if (b.type === "cluster") {
        const miniCount = 4 + state.chainLevel;
        for (let k = 0; k < miniCount; k += 1) {
          const spread = rand(-1.4, 1.6);
          const burstDelay = randi(2, 18);
          queueBomb(burstDelay, {
            type: "bomblet",
            x: b.x + rand(-10, 10),
            y: b.y - rand(8, 20),
            vy: rand(0.8, 1.5),
            vxWorld: state.scrollSpeed + 1.1 + spread,
            blast: b.blast * rand(0.24, 0.35)
          });
        }
        spawnExplosion(b.x, top, "#ffbf6f", 40);
        spawnShockwave(b.x, top, b.blast * 0.7, 14, "#ffe7bf");
        state.bombsFalling.splice(i, 1);
        continue;
      }

      explodeBomb(b, top);
      state.bombsFalling.splice(i, 1);
      continue;
    }

    if (b.y > HEIGHT + 2 || b.x < -6) {
      state.bombsFalling.splice(i, 1);
    }
  }

  if (!UNLIMITED_BOMBS && !state.gameOver && state.bombs <= 0 && state.bombsFalling.length === 0 && state.bunkers.length > 0) {
    state.gameOver = true;
    state.message = "No bombs left. Press R to retry.";
  }
}

function updateParticles() {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.03;
    p.life -= 1;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

function updateFloatTexts() {
  for (let i = state.floatTexts.length - 1; i >= 0; i -= 1) {
    const t = state.floatTexts[i];
    t.y -= 0.7;
    t.x += Math.sin((t.maxLife - t.life) * 0.2) * 0.2;
    t.life -= 1;
    if (t.life <= 0) state.floatTexts.splice(i, 1);
  }
}

function updateShockwaves() {
  for (let i = state.shockwaves.length - 1; i >= 0; i -= 1) {
    const s = state.shockwaves[i];
    s.life -= 1;
    const t = 1 - s.life / s.maxLife;
    s.radius = 8 + (s.maxRadius - 8) * t;
    if (s.life <= 0) state.shockwaves.splice(i, 1);
  }
}

function updatePulseBlast() {
  if (state.pulseLevel <= 0 || state.gameOver) return;
  if (state.pulseCooldown > 0) {
    state.pulseCooldown -= 1;
    return;
  }

  triggerPulseBlast();
  state.pulseCooldown = clamp(300 - state.pulseLevel * 85, 120, 300);
}

function updateToast() {
  if (state.toastTimer > 0) state.toastTimer -= 1;
  if (state.toastTimer <= 0) state.toast = "";
}

function checkWin() {}

function drawStars() {
  const stage = currentStage();
  for (let i = 0; i < 110; i += 1) {
    const drift = state.tick * (0.55 + (i % 5) * 0.18);
    const x = WIDTH - ((i * 91 + drift) % (WIDTH + 16));
    const y = (i * 53 + (stage * 29) % HEIGHT) % HEIGHT;
    ctx.fillStyle = i % 3 === 0 ? "#a5d9ff" : "#ffffff";
    ctx.fillRect(x, y, 1.2, 1.2);
  }
}

function drawPlayer() {
  const p = state.player;
  if (p.invulnTimer > 0 && Math.floor(p.invulnTimer / 4) % 2 === 0) return;
  ctx.save();
  ctx.translate(p.x, p.y);

  ctx.fillStyle = "#dce9ff";
  ctx.beginPath();
  ctx.moveTo(-p.w / 2, 0);
  ctx.lineTo(-8, -p.h / 2);
  ctx.lineTo(12, -p.h / 3);
  ctx.lineTo(p.w / 2, 0);
  ctx.lineTo(12, p.h / 3);
  ctx.lineTo(-8, p.h / 2);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#66b9ff";
  ctx.fillRect(-4, -3, 12, 6);

  ctx.fillStyle = "#ff7d45";
  ctx.beginPath();
  ctx.moveTo(-p.w / 2, 0);
  ctx.lineTo(-p.w / 2 - 8 - Math.random() * 3, -3);
  ctx.lineTo(-p.w / 2 - 8 - Math.random() * 3, 3);
  ctx.closePath();
  ctx.fill();

  if (state.shieldLevel > 0) {
    ctx.strokeStyle = "#90f8ff";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();
    if (state.shieldLevel > 1) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawTerrain() {
  for (let i = 0; i < state.terrain.length; i += 1) {
    const col = state.terrain[i];
    const x = i * CELL_W - state.scrollOffset;
    if (x > WIDTH || x < -CELL_W) continue;

    let ceilingCursor = 0;
    for (let li = 0; li < col.ceilingLayers.length; li += 1) {
      const layer = col.ceilingLayers[li];
      if (layer.hp <= 0) continue;
      const h = Math.max(1, Math.floor(layer.thickness * (layer.hp / layer.maxHp)));
      ctx.fillStyle = hardnessPalette[layer.hardness];
      ctx.fillRect(x, ceilingCursor, CELL_W + 1, h);
      ceilingCursor += h;
    }

    let floorCursor = HEIGHT - layerStackHeight(col.floorLayers);
    for (let li = 0; li < col.floorLayers.length; li += 1) {
      const layer = col.floorLayers[li];
      if (layer.hp <= 0) continue;
      const h = Math.max(1, Math.floor(layer.thickness * (layer.hp / layer.maxHp)));
      ctx.fillStyle = hardnessPalette[layer.hardness];
      ctx.fillRect(x, floorCursor, CELL_W + 1, h);
      floorCursor += h;
    }
  }
}

function drawBunkers() {
  for (const bunker of state.bunkers) {
    ctx.beginPath();
    ctx.fillStyle = bunker.color;
    ctx.arc(bunker.x, bunker.y, bunker.radius, 0, Math.PI * 2);
    ctx.fill();

    const hpPct = bunker.hp / bunker.maxHp;
    ctx.fillStyle = "#1e2e3f";
    ctx.fillRect(bunker.x - bunker.radius, bunker.y - bunker.radius - 8, bunker.radius * 2, 3);
    ctx.fillStyle = hpPct > 0.5 ? "#6bf98a" : hpPct > 0.25 ? "#ffda6e" : "#ff6e6e";
    ctx.fillRect(bunker.x - bunker.radius, bunker.y - bunker.radius - 8, bunker.radius * 2 * hpPct, 3);

    if (bunker.containsUpgrade) {
      ctx.fillStyle = "#7cf8ff";
      ctx.fillRect(bunker.x - 2, bunker.y - 2, 4, 4);
    }
  }
}

function drawBombs() {
  for (const b of state.bombsFalling) {
    if (b.phase === "runner") {
      ctx.fillStyle = "#ff7b4b";
      ctx.fillRect(b.x - 6, b.y - 4, 12, 8);
      ctx.fillStyle = "#ffe2a1";
      ctx.fillRect(b.x - 1, b.y - 1, 6, 2);
      continue;
    }

    const vxScreen = b.vxWorld - state.scrollSpeed;
    const angle = Math.atan2(b.vy, vxScreen);
    const scale = b.type === "mega" ? 1.75 : b.type === "bomblet" ? 0.6 : b.type === "cluster" ? 1.15 : 1;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(angle);
    ctx.fillStyle = b.type === "mega" ? "#ff5f45" : b.type === "cluster" ? "#ffbf64" : "#ffae45";
    ctx.fillRect(-9 * scale, -3 * scale, 18 * scale, 6 * scale);
    ctx.fillStyle = "#ffe9b0";
    ctx.fillRect(6 * scale, -1.5 * scale, 4 * scale, 3 * scale);
    ctx.restore();
  }
}

function drawShots() {
  for (const shot of state.shots) {
    const palette = shotTypePalette[shot.kind] || shotTypePalette.laser;
    const tailX = shot.x - Math.max(6, Math.abs(shot.vx) * 0.9);
    const tailY = shot.y - shot.vy * 1.25;

    if (shot.kind === "rocket") {
      const angle = Math.atan2(shot.vy, shot.vx || 0.001);
      ctx.save();
      ctx.translate(shot.x, shot.y);
      ctx.rotate(angle);
      ctx.fillStyle = palette.glow;
      ctx.fillRect(-10, -3.4, 16, 6.8);
      ctx.fillStyle = palette.core;
      ctx.fillRect(-2, -2, 8, 4);
      ctx.fillStyle = "#ff8e5f";
      ctx.fillRect(-12, -1.5, 4, 3);
      ctx.restore();
      continue;
    }

    if (shot.kind === "pulse") {
      ctx.strokeStyle = palette.glow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = palette.core;
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (shot.kind === "blast") {
      ctx.strokeStyle = palette.glow;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(tailX - 4, tailY);
      ctx.lineTo(shot.x + 10, shot.y);
      ctx.stroke();
      ctx.fillStyle = palette.core;
      ctx.fillRect(shot.x - 2, shot.y - 4, 13, 8);
      continue;
    }

    if (shot.kind === "shard") {
      ctx.strokeStyle = palette.glow;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(shot.x + 4, shot.y);
      ctx.stroke();
      ctx.fillStyle = palette.core;
      ctx.fillRect(shot.x - 1, shot.y - 1, 4, 2);
      continue;
    }

    ctx.strokeStyle = palette.glow;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(shot.x + 8, shot.y);
    ctx.stroke();

    ctx.fillStyle = palette.core;
    ctx.fillRect(shot.x - 1, shot.y - 2, 10, 4);
    ctx.fillStyle = "#6ed6ff";
    ctx.fillRect(shot.x + 6, shot.y - 1, 4, 2);
  }
}

function drawUpgradeDrops() {
  for (const drop of state.upgradeDrops) {
    let fill = "#7cf8ff";
    let label = "P";
    if (drop.type === "weapon") {
      fill = "#ffdd77";
      label = "W";
    } else if (drop.type === "bomb") {
      fill = "#ff8f65";
      label = "B";
    } else if (drop.type === "rapid") {
      fill = "#a7f6ff";
      label = "R";
    } else if (drop.type === "magnet") {
      fill = "#ffc1ea";
      label = "M";
    } else if (drop.type === "chain") {
      fill = "#ffb29a";
      label = "C";
    } else if (drop.type === "speed") {
      fill = "#82ff9d";
      label = "S";
    } else if (drop.type === "shield") {
      fill = "#8ce9ff";
      label = "D";
    } else if (drop.type === "pulse") {
      fill = "#d0a0ff";
      label = "P";
    }

    ctx.fillStyle = "rgba(8, 20, 38, 0.88)";
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, drop.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.font = "11px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText(label, drop.x, drop.y + 3.5);
  }
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    if (enemy.type === "scout") {
      ctx.fillStyle = "#ff7f5f";
      ctx.fillRect(enemy.x - enemy.w / 2, enemy.y - enemy.h / 2, enemy.w, enemy.h);
      ctx.fillStyle = "#ffd6b0";
      ctx.fillRect(enemy.x - enemy.w / 2 + 3, enemy.y - 1, enemy.w - 6, 2);
    } else if (enemy.type === "bruiser") {
      ctx.fillStyle = "#bf5dff";
      ctx.fillRect(enemy.x - enemy.w / 2, enemy.y - enemy.h / 2, enemy.w, enemy.h);
      ctx.fillStyle = "#f7ceff";
      ctx.fillRect(enemy.x - enemy.w / 2 + 2, enemy.y - enemy.h / 2 + 2, enemy.w - 4, 3);
      ctx.fillStyle = "#6b2e8a";
      ctx.fillRect(enemy.x - 2, enemy.y - enemy.h / 2, 4, enemy.h);
    } else if (enemy.type === "diver") {
      ctx.fillStyle = "#5dffb7";
      ctx.beginPath();
      ctx.moveTo(enemy.x - enemy.w / 2, enemy.y);
      ctx.lineTo(enemy.x, enemy.y - enemy.h / 2);
      ctx.lineTo(enemy.x + enemy.w / 2, enemy.y);
      ctx.lineTo(enemy.x, enemy.y + enemy.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#cffff0";
      ctx.fillRect(enemy.x - 2, enemy.y - 1, 4, 2);
    } else {
      ctx.fillStyle = "#ffd35f";
      ctx.fillRect(enemy.x - enemy.w / 2, enemy.y - enemy.h / 2, enemy.w, enemy.h);
      ctx.fillStyle = "#fff0b5";
      ctx.fillRect(enemy.x - enemy.w / 2 + 2, enemy.y - enemy.h / 2 + 2, enemy.w - 4, 2);
      ctx.fillStyle = "#ff8f4a";
      ctx.fillRect(enemy.x - 1, enemy.y - enemy.h / 2, 2, enemy.h);
    }

    if (enemy.elite) {
      ctx.strokeStyle = "#fff4a8";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(enemy.x - enemy.w / 2 - 1, enemy.y - enemy.h / 2 - 1, enemy.w + 2, enemy.h + 2);
    }
  }
}

function drawEnemyProjectiles() {
  for (const p of state.enemyProjectiles) {
    ctx.fillStyle = p.elite ? "#ffd37a" : "#ff6f77";
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.elite ? 3.2 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 45);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawShockwaves() {
  for (const s of state.shockwaves) {
    ctx.globalAlpha = Math.max(0, s.life / s.maxLife) * 0.7;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawFloatTexts() {
  for (const t of state.floatTexts) {
    ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
    ctx.fillStyle = t.color;
    ctx.font = `${t.size}px Trebuchet MS`;
    ctx.textAlign = "center";
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function drawMessage() {
  if (!state.message) return;
  ctx.fillStyle = "rgba(4, 14, 24, 0.75)";
  ctx.fillRect(140, 260, WIDTH - 280, 72);
  ctx.strokeStyle = "#4de1ff";
  ctx.strokeRect(140, 260, WIDTH - 280, 72);
  ctx.fillStyle = "#dff4ff";
  ctx.font = "20px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText(state.message, WIDTH / 2, 304);
}

function drawToast() {
  if (!state.toast) return;
  ctx.globalAlpha = Math.max(0, state.toastTimer / 120);
  ctx.fillStyle = "#b9fff4";
  ctx.font = "18px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText(state.toast, WIDTH / 2, 48);
  ctx.globalAlpha = 1;
}

function drawPauseOverlay() {
  if (!state.paused) return;
  ctx.fillStyle = "rgba(2, 8, 14, 0.7)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "#dff4ff";
  ctx.font = "28px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText("Paused", WIDTH / 2, HEIGHT / 2 - 8);
  ctx.font = "18px Trebuchet MS";
  ctx.fillText("Press P to resume", WIDTH / 2, HEIGHT / 2 + 22);
}

function updateUI() {
  const stage = currentStage();
  ui.level.textContent = `Stage ${stage} | Enemies ${state.enemies.length}`;
  ui.score.textContent = `SCORE ${Math.floor(state.score)}`;
  ui.best.textContent = `HI SCORE ${Math.floor(state.highScore)}`;
  ui.combo.textContent = `Combo x${state.combo.toFixed(1)}`;
  ui.power.textContent = `Power W${state.weaponLevel} B${state.bombLevel} R${state.rapidLevel} M${state.magnetLevel} C${state.chainLevel} S${state.speedLevel} D${state.shieldLevel} P${state.pulseLevel} | Arsenal MIX`;
  ui.lives.textContent = `x${state.lives}`;
  ui.bombMode.textContent = `Bomb ${state.bombMode.toUpperCase()}`;
  ui.megaCd.textContent = state.megaCooldown <= 0 ? "Mega Ready" : `Mega CD ${(state.megaCooldown / 60).toFixed(1)}s`;
  ui.fuel.textContent = "Fuel ∞";
  ui.bombs.textContent = UNLIMITED_BOMBS ? "Bombs ∞" : `Bombs ${state.bombs}`;
}

function update() {
  if (state.paused) return;

  state.tick += 1;

  updatePlayer();
  scrollWorld();
  updateEnemies();
  updateShots();
  updateEnemyProjectiles();
  updateUpgradeDrops();
  updateBombs();
  updateParticles();
  updateFloatTexts();
  updateShockwaves();
  updatePulseBlast();
  updateToast();
  checkWin();

  if (state.comboTimer > 0) {
    state.comboTimer -= 1;
  } else {
    state.combo = Math.max(1, state.combo - 0.02);
  }

  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem("degradius-high-score", String(Math.floor(state.highScore)));
  }

  updateUI();
}

function render() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawStars();
  drawTerrain();
  drawBunkers();
  drawUpgradeDrops();
  drawEnemies();
  drawEnemyProjectiles();
  drawBombs();
  drawShots();
  drawPlayer();
  drawFloatTexts();
  drawShockwaves();
  drawParticles();
  drawMessage();
  drawToast();
  drawPauseOverlay();
}

function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (e) => {
  unlockAudio();

  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if (e.code === "ArrowUp" || e.code === "KeyW") keys.up = true;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = true;

  if (e.code === "Space") {
    keys.bomb = true;
    e.preventDefault();
  }

  if (e.code === "Digit1") state.bombMode = "standard";
  if (e.code === "Digit2") state.bombMode = "cluster";
  if (e.code === "Digit3") state.bombMode = "mega";
  if (e.code === "Digit4") state.bombMode = "runner";

  if (e.code === "KeyR") {
    state.score = 0;
    state.lives = 3;
    state.weaponLevel = 1;
    state.bombLevel = 1;
    state.speedLevel = 1;
    state.shieldLevel = 0;
    state.pulseLevel = 0;
    state.rapidLevel = 0;
    state.magnetLevel = 0;
    state.chainLevel = 0;
    state.bombMode = "standard";
    state.megaCooldown = 0;
    initLevel();
  }

  if (e.code === "KeyP") {
    state.paused = !state.paused;
    if (state.paused) keys.bomb = false;
  }
});

window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("touchstart", unlockAudio, { passive: true });

window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  if (e.code === "ArrowUp" || e.code === "KeyW") keys.up = false;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = false;
  if (e.code === "Space") keys.bomb = false;
});

initLevel();
loop();
