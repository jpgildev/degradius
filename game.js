const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  level: document.getElementById("level"),
  score: document.getElementById("score"),
  best: document.getElementById("best"),
  combo: document.getElementById("combo"),
  power: document.getElementById("power"),
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

const keys = {
  left: false,
  right: false,
  up: false,
  down: false,
  bomb: false
};

const state = {
  tick: 0,
  level: 1,
  score: 0,
  highScore: Number.parseInt(localStorage.getItem("degradius-high-score") || "0", 10) || 0,
  combo: 1,
  comboTimer: 0,
  fuel: 100,
  bombs: 30,
  terrain: [],
  bunkers: [],
  upgradeDrops: [],
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
    cooldown: 0,
    shotCooldown: 0
  },
  weaponLevel: 1,
  bombLevel: 1,
  speedLevel: 1,
  shieldLevel: 0,
  pulseLevel: 0,
  pulseCooldown: 0,
  toast: "",
  toastTimer: 0,
  cleared: false,
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
  const count = 7 + Math.floor(level * 2);
  state.bunkers = [];
  const pickTier = () => {
    const roll = Math.random();
    if (roll < 0.5) return "small";
    if (roll < 0.85) return "medium";
    return "large";
  };
  const pickUpgradeType = () => {
    const roll = Math.random();
    if (roll < 0.35) return "weapon";
    if (roll < 0.58) return "bomb";
    if (roll < 0.76) return "speed";
    if (roll < 0.92) return "shield";
    return "pulse";
  };

  for (let i = 0; i < count; i += 1) {
    let tries = 0;
    while (tries < 80) {
      tries += 1;
      const col = randi(16, state.terrain.length - 10);
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
      break;
    }
  }

  if (state.bunkers.length > 0 && !state.bunkers.some((b) => b.containsUpgrade)) {
    const idx = randi(0, state.bunkers.length - 1);
    state.bunkers[idx].containsUpgrade = true;
    state.bunkers[idx].upgradeType = pickUpgradeType();
  }
}

function initLevel() {
  state.terrain = Array.from({ length: COLS }, (_, i) => makeColumn(i, state.level));
  state.nextTerrainCol = COLS;
  state.scrollOffset = 0;
  placeBunkers(state.level);

  state.bombsFalling = [];
  state.upgradeDrops = [];
  state.shockwaves = [];
  state.shots = [];
  state.enemies = [];
  state.enemySpawnTimer = 45;
  state.particles = [];
  state.cleared = false;
  state.gameOver = false;
  state.message = "";

  state.fuel = Math.max(55, 120 - state.level * 3);
  state.bombs = UNLIMITED_BOMBS ? 0 : 42 + state.level * 4;
  state.scrollSpeed = (3.4 + state.level * 0.16) * SCROLL_SPEED_SCALE;

  state.player.x = WIDTH * 0.3;
  state.player.y = HEIGHT * 0.45;
  state.player.vx = 0;
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
  if (state.player.cooldown > 0 || state.gameOver || state.cleared) return;
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
      state.score += 48 + state.level * 10;
      spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 18);
      state.enemies.splice(i, 1);
    }
  }

  spawnShockwave(x, y, radius, 18, "#9cf4ff");
  spawnExplosion(x, y, "#b8f9ff", 42);
}

function spawnEnemy() {
  const corridor = corridorBoundsAtScreenX(WIDTH - 12);
  const minY = corridor.ceiling + 22;
  const maxY = corridor.floor - 22;
  const y = randi(minY, Math.max(minY + 4, maxY));
  const hp = 16 + state.level * 3;
  state.enemies.push({
    x: WIDTH + 24,
    y,
    w: randi(18, 26),
    h: randi(10, 14),
    hp,
    maxHp: hp,
    vx: rand(2.2, 3.5) + state.level * 0.1,
    wobble: rand(0, Math.PI * 2),
    drift: rand(0.35, 0.9)
  });
}

function updatePlayer() {
  if (state.gameOver || state.cleared) return;

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
  if (keys.bomb) spawnBomb();
  if (state.player.shotCooldown > 0) {
    state.player.shotCooldown -= 1;
  } else {
    spawnShot();
    state.player.shotCooldown = Math.max(5, 10 - Math.floor(state.level * 0.35));
  }

  state.fuel -= 0.014 + state.level * 0.0009;
  if (state.fuel <= 0) {
    state.fuel = 0;
    state.gameOver = true;
    state.message = "Out of fuel. Press R to retry.";
  }
}

function updateEnemies() {
  state.enemySpawnTimer -= 1;
  if (state.enemySpawnTimer <= 0) {
    spawnEnemy();
    const base = 74 - state.level * 2;
    state.enemySpawnTimer = clamp(randi(base - 14, base + 8), 26, 82);
  }

  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    enemy.x -= enemy.vx + state.scrollSpeed * 0.2;
    enemy.wobble += enemy.drift * 0.04;
    enemy.y += Math.sin(enemy.wobble) * 0.65;
    const corridor = corridorBoundsAtScreenX(enemy.x);
    enemy.y = clamp(enemy.y, corridor.ceiling + 14, corridor.floor - 14);

    const dx = Math.abs(enemy.x - state.player.x);
    const dy = Math.abs(enemy.y - state.player.y);
    if (dx < (enemy.w + state.player.w) * 0.45 && dy < (enemy.h + state.player.h) * 0.55) {
      if (state.shieldLevel > 0) {
        state.shieldLevel -= 1;
        spawnShockwave(state.player.x, state.player.y, 44, 14, "#97f7ff");
        showToast(state.shieldLevel > 0 ? "Shield Hit" : "Shield Down");
      } else {
        state.fuel = Math.max(0, state.fuel - 14);
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
      hit = true;
      if (enemy.hp <= 0) {
        state.score += 55 + state.level * 12;
        spawnExplosion(enemy.x, enemy.y, "#9fd5ff", 18);
        state.enemies.splice(ei, 1);
      }
      break;
    }

    if (hit || shot.x > WIDTH + 16) state.shots.splice(i, 1);
  }
}

function updateUpgradeDrops() {
  for (let i = state.upgradeDrops.length - 1; i >= 0; i -= 1) {
    const drop = state.upgradeDrops[i];
    drop.x -= state.scrollSpeed * 0.9;
    drop.bobPhase += 0.08;
    drop.y += Math.sin(drop.bobPhase) * 0.45;

    const dx = Math.abs(drop.x - state.player.x);
    const dy = Math.abs(drop.y - state.player.y);
    if (dx < state.player.w * 0.55 && dy < state.player.h * 0.55) {
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

  state.scrollOffset += state.scrollSpeed;

  for (const bunker of state.bunkers) bunker.x -= state.scrollSpeed;

  while (state.scrollOffset >= CELL_W) {
    state.scrollOffset -= CELL_W;
    state.terrain.shift();
    state.terrain.push(makeColumn(state.nextTerrainCol, state.level));
    state.nextTerrainCol += 1;
  }

  const kept = [];
  for (const bunker of state.bunkers) {
    if (bunker.x < -20) {
      state.score = Math.max(0, state.score - 75);
      state.fuel = Math.max(0, state.fuel - 4);
      continue;
    }
    kept.push(bunker);
  }
  state.bunkers = kept;
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
      if (bunker.containsUpgrade && bunker.upgradeType) {
        spawnUpgradeDrop(bunker.x, bunker.y, bunker.upgradeType);
      }
    }
  }

  if (destroyed > 0) {
    state.combo = clamp(state.combo + destroyed * 0.18, 1, 4.5);
    state.comboTimer = 210;
    state.score += Math.floor(bounty * state.combo);
  }

  state.bunkers = state.bunkers.filter((b) => b.hp > 0);
}

function explodeBomb(bomb, impactY) {
  const col = columnAtScreenX(bomb.x);
  const blastCols = Math.ceil(bomb.blast / 14);

  for (let i = col - blastCols; i <= col + blastCols; i += 1) {
    if (i < 0 || i >= state.terrain.length) continue;
    const distance = Math.abs(i - col);
    const power = bomb.blast * (1 - distance * 0.11);
    if (power <= 0) continue;
    const dug = digColumn(i, power);
    state.score += Math.floor(dug * 8);
  }

  damageBunkers(bomb.x, impactY, bomb.blast * 2.15, bomb.blast * 0.9);
  spawnExplosion(bomb.x, impactY, "#ffc866", 78);
  spawnShockwave(bomb.x, impactY, bomb.blast * 1.45, 24, "#ffefb8");
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

  if (!UNLIMITED_BOMBS && !state.gameOver && !state.cleared && state.bombs <= 0 && state.bombsFalling.length === 0 && state.bunkers.length > 0) {
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
  if (state.pulseLevel <= 0 || state.gameOver || state.cleared) return;
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

function checkWin() {
  if (state.cleared || state.gameOver) return;
  if (state.bunkers.length === 0) {
    state.cleared = true;
    const bombBonus = UNLIMITED_BOMBS ? 0 : state.bombs * 5;
    state.score += 250 + Math.floor(state.fuel * 3) + bombBonus;
    state.message = "Wave cleared. Press Space for next level.";
    spawnExplosion(state.player.x, state.player.y - 8, "#6dffa8", 64);
  }
}

function drawStars() {
  for (let i = 0; i < 110; i += 1) {
    const drift = state.tick * (0.55 + (i % 5) * 0.18);
    const x = WIDTH - ((i * 91 + drift) % (WIDTH + 16));
    const y = (i * 53 + (state.level * 29) % HEIGHT) % HEIGHT;
    ctx.fillStyle = i % 3 === 0 ? "#a5d9ff" : "#ffffff";
    ctx.fillRect(x, y, 1.2, 1.2);
  }
}

function drawPlayer() {
  const p = state.player;
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
    ctx.fillStyle = "#a9e6ff";
    ctx.fillRect(shot.x - 1, shot.y - 1, 8, 2);
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
    ctx.fillStyle = "#ff7f5f";
    ctx.fillRect(enemy.x - enemy.w / 2, enemy.y - enemy.h / 2, enemy.w, enemy.h);
    ctx.fillStyle = "#ffd6b0";
    ctx.fillRect(enemy.x - enemy.w / 2 + 3, enemy.y - 1, enemy.w - 6, 2);
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
  ui.level.textContent = `Level ${state.level}`;
  ui.score.textContent = `Score ${Math.floor(state.score)}`;
  ui.best.textContent = `Best ${Math.floor(state.highScore)}`;
  ui.combo.textContent = `Combo x${state.combo.toFixed(1)}`;
  ui.power.textContent = `Power W${state.weaponLevel} B${state.bombLevel} S${state.speedLevel} D${state.shieldLevel} P${state.pulseLevel}`;
  ui.fuel.textContent = `Fuel ${Math.floor(state.fuel)}`;
  ui.bombs.textContent = UNLIMITED_BOMBS ? "Bombs ∞" : `Bombs ${state.bombs}`;
}

function update() {
  if (state.paused) return;

  state.tick += 1;

  if (state.cleared && keys.bomb) {
    state.level += 1;
    initLevel();
  }

  updatePlayer();
  scrollWorld();
  updateEnemies();
  updateShots();
  updateUpgradeDrops();
  updateBombs();
  updateParticles();
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
  drawBombs();
  drawShots();
  drawPlayer();
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
    state.level = 1;
    state.score = 0;
    state.weaponLevel = 1;
    state.bombLevel = 1;
    state.speedLevel = 1;
    state.shieldLevel = 0;
    state.pulseLevel = 0;
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
