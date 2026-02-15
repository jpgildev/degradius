const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  level: document.getElementById("level"),
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  combo: document.getElementById("combo"),
  power: document.getElementById("power"),
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
  bombsFalling: [],
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
  pulseCooldown: 0,
  toast: "",
  toastTimer: 0,
  paused: false,
  gameOver: false,
  message: ""
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randi(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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
  state.shots = [];
  state.enemies = [];
  state.enemySpawnTimer = 78;
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

function spawnBomb() {
  if (state.player.cooldown > 0 || state.gameOver) return;
  if (!UNLIMITED_BOMBS && state.bombs <= 0) return;
  if (!UNLIMITED_BOMBS) state.bombs -= 1;
  const vxWorld = state.scrollSpeed + 2.25 + state.player.vx * 0.6;
  state.player.cooldown = 16;
  const blastScale = 1 + (state.bombLevel - 1) * 0.22;
  state.bombsFalling.push({
    x: state.player.x + 8,
    y: state.player.y + 8,
    vxWorld,
    vy: 1.8,
    blast: 82 * blastScale
  });
}

function spawnShot() {
  const pattern = shotPatterns[Math.min(shotPatterns.length - 1, state.weaponLevel - 1)];
  const shotVx = 9.4 + state.weaponLevel * 0.45;
  for (const node of pattern) {
    state.shots.push({
      x: state.player.x + state.player.w / 2 - 2,
      y: state.player.y - 1 + node.dy,
      vx: shotVx,
      vy: node.vy
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
  spawnExplosion(state.player.x, state.player.y, "#ff8080", 42);

  if (state.lives <= 0) {
    state.gameOver = true;
    state.message = `${reason} No lives left. Press R to retry.`;
    return;
  }

  state.player.invulnTimer = 130;
  showToast(`Life Lost - ${state.lives} left`);
}

function applyUpgrade(type) {
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
  const hp = spec.hpBase + stage * spec.hpPerStage;
  const eliteChance = clamp((stage - 4) * 0.03, 0, 0.36);
  const elite = Math.random() < eliteChance;
  const sizeScale = elite ? 1.22 : 1;
  const hpScaled = Math.floor(hp * (elite ? 1.85 : 1));
  const fireBase = randi(84, 126) - stage * 2;

  state.enemies.push({
    type,
    x: WIDTH + 24,
    y,
    w: Math.floor(randi(spec.wMin, spec.wMax) * sizeScale),
    h: Math.floor(randi(spec.hMin, spec.hMax) * sizeScale),
    hp: hpScaled,
    maxHp: hpScaled,
    value: Math.floor((spec.scoreBase + stage * 10) * (elite ? 2.1 : 1)),
    elite,
    vx: (rand(spec.speedMin, spec.speedMax) + stage * 0.06) * (elite ? 1.08 : 1),
    wobble: rand(0, Math.PI * 2),
    drift: rand(spec.driftMin, spec.driftMax),
    diveArmed: type === "diver" ? Math.random() > 0.45 : false,
    fireCooldown: clamp(fireBase, 30, 132)
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
    state.player.shotCooldown = Math.max(3, 10 - Math.floor(stage * 0.35) - state.rapidLevel * 2);
  }

}

function updateEnemies() {
  const stage = currentStage();
  state.enemySpawnTimer -= 1;
  if (state.enemySpawnTimer <= 0) {
    const pack = clamp(1 + Math.floor(stage / 7), 1, 5);
    for (let i = 0; i < pack; i += 1) spawnEnemy();
    const base = 122 - stage * 3;
    state.enemySpawnTimer = clamp(randi(base - 16, base + 10), 16, 120);
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

    if (stage >= 6 && enemy.x < WIDTH - 60) {
      enemy.fireCooldown -= 1;
      if (enemy.fireCooldown <= 0) {
        const tx = state.player.x + rand(-14, 14);
        const ty = state.player.y + rand(-10, 10);
        const dxAim = tx - enemy.x;
        const dyAim = ty - enemy.y;
        const len = Math.hypot(dxAim, dyAim) || 1;
        const speed = 2.2 + stage * 0.09 + (enemy.elite ? 0.55 : 0);
        state.enemyProjectiles.push({
          x: enemy.x,
          y: enemy.y,
          vx: (dxAim / len) * speed,
          vy: (dyAim / len) * speed,
          life: 220,
          elite: enemy.elite
        });
        enemy.fireCooldown = clamp(randi(118 - stage * 3, 156 - stage), 20, 132);
      }
    }

    const dx = Math.abs(enemy.x - state.player.x);
    const dy = Math.abs(enemy.y - state.player.y);
    if (state.player.invulnTimer <= 0 && dx < (enemy.w + state.player.w) * 0.45 && dy < (enemy.h + state.player.h) * 0.55) {
      if (state.shieldLevel > 0) {
        state.shieldLevel -= 1;
        spawnShockwave(state.player.x, state.player.y, 44, 14, "#97f7ff");
        showToast(state.shieldLevel > 0 ? "Shield Hit" : "Shield Down");
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

function updateShots() {
  const stage = currentStage();
  for (let i = state.shots.length - 1; i >= 0; i -= 1) {
    const shot = state.shots[i];
    shot.x += shot.vx;
    shot.y += shot.vy;

    let hit = false;
    for (let ei = state.enemies.length - 1; ei >= 0; ei -= 1) {
      const enemy = state.enemies[ei];
      const dx = Math.abs(shot.x - enemy.x);
      const dy = Math.abs(shot.y - enemy.y);
      if (dx > enemy.w * 0.55 || dy > enemy.h * 0.65) continue;
      enemy.hp -= 10;
      spawnFloatText(shot.x + 2, shot.y - 4, "10", "#90ecff", 11, 16);
      hit = true;
      if (enemy.hp <= 0) {
        state.score += enemy.value || 55 + stage * 12;
        spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 18);
        spawnFloatText(enemy.x, enemy.y - 10, `+${enemy.value || 55 + stage * 12}`, "#a6ffbf", 14, 28);
        state.enemies.splice(ei, 1);
      }
      break;
    }

    if (hit || shot.x > WIDTH + 16) state.shots.splice(i, 1);
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

function updateBombs() {
  for (let i = state.bombsFalling.length - 1; i >= 0; i -= 1) {
    const b = state.bombsFalling[i];
    // World-space horizontal velocity with light drag, then convert to screen-space.
    b.vxWorld = Math.max(state.scrollSpeed * 0.95, b.vxWorld * 0.997);
    b.vy += 0.16;
    b.x += b.vxWorld - state.scrollSpeed;
    b.y += b.vy;

    const col = columnAtScreenX(b.x);
    const top = columnFloorTop(col);

    if (b.y >= top) {
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
    const vxScreen = b.vxWorld - state.scrollSpeed;
    const angle = Math.atan2(b.vy, vxScreen);

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(angle);
    ctx.fillStyle = "#ffae45";
    ctx.fillRect(-9, -3, 18, 6);
    ctx.fillStyle = "#ffe9b0";
    ctx.fillRect(6, -1.5, 4, 3);
    ctx.restore();
  }
}

function drawShots() {
  for (const shot of state.shots) {
    const tailX = shot.x - Math.max(7, shot.vx * 0.9);
    const tailY = shot.y - shot.vy * 1.2;
    ctx.strokeStyle = "rgba(120, 235, 255, 0.8)";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(shot.x + 8, shot.y);
    ctx.stroke();

    ctx.fillStyle = "#e8fdff";
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
  ui.score.textContent = `Score ${Math.floor(state.score)}`;
  ui.best.textContent = `Best ${Math.floor(state.highScore)}`;
  ui.combo.textContent = `Combo x${state.combo.toFixed(1)}`;
  ui.power.textContent = `Power W${state.weaponLevel} B${state.bombLevel} R${state.rapidLevel} M${state.magnetLevel} C${state.chainLevel} S${state.speedLevel} D${state.shieldLevel} P${state.pulseLevel}`;
  ui.lives.textContent = `Lives ${state.lives}`;
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
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if (e.code === "ArrowUp" || e.code === "KeyW") keys.up = true;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = true;

  if (e.code === "Space") {
    keys.bomb = true;
    e.preventDefault();
  }

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
    initLevel();
  }

  if (e.code === "KeyP") {
    state.paused = !state.paused;
    if (state.paused) keys.bomb = false;
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  if (e.code === "ArrowUp" || e.code === "KeyW") keys.up = false;
  if (e.code === "ArrowDown" || e.code === "KeyS") keys.down = false;
  if (e.code === "Space") keys.bomb = false;
});

initLevel();
loop();
