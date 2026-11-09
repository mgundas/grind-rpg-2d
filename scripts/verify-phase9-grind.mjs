#!/usr/bin/env node
/**
 * Phase-9 balance check. Extends the Phase-3 grind simulation to level 60 and
 * adds tier-appropriate weapon attack, then asserts that every 10-level band
 * stays inside playable kills-per-minute and hits-to-kill bounds.
 *
 * Usage: node --import tsx scripts/verify-phase9-grind.mjs
 */
import {
  applyXpGain,
  critChance,
  hitChance,
  levelXpMultiplier,
  physicalAttack,
} from "../packages/shared/src/formulas.ts";
import { getClass } from "../packages/data/src/classes.ts";
import { getMonster } from "../packages/data/src/monsters.ts";
import { getSpawnGroup } from "../packages/data/src/spawnGroups.ts";

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) {
    failures += 1;
  }
}

const warrior = getClass("warrior");
const stats = { ...warrior.stats };

/** Weapon attack a player is expected to have unlocked at each band. */
const WEAPON_AT_LEVEL = [
  { min: 1, attack: 6 },
  { min: 10, attack: 24 },
  { min: 20, attack: 62 },
  { min: 30, attack: 92 },
  { min: 45, attack: 132 },
  { min: 60, attack: 196 },
];
function weaponAttack(level) {
  let attack = 0;
  for (const tier of WEAPON_AT_LEVEL) {
    if (level >= tier.min) attack = tier.attack;
  }
  return attack;
}

function expectedSwing(level, monster) {
  const attack = physicalAttack({ classId: "warrior", stats, level, weaponAttack: weaponAttack(level) });
  const chance = hitChance({
    attackerDex: stats.dex + level,
    defenderDex: monster.dex,
    attackerLevel: level,
    defenderLevel: monster.level,
  });
  const damage = Math.max(1, attack - monster.defense * 0.7);
  const crit = critChance(stats.dex + level);
  return { chance, expected: chance * (damage * (1 - crit) + damage * 2 * crit) };
}

function swingsToKill(level, monster) {
  const { expected } = expectedSwing(level, monster);
  return Math.ceil(monster.hp / Math.max(1, expected));
}

// Representative monster per band (the level-appropriate grind target).
const BANDS = [
  [1, "wild_dog"],
  [11, "ash_wolf"],
  [21, "highland_ogre"],
  [31, "valley_spirit"],
  [41, "bone_walker"],
  [51, "spiderling"],
];

for (const [bandStart, monsterId] of BANDS) {
  const monster = getMonster(monsterId);
  const level = bandStart + 5;
  const swings = swingsToKill(level, monster);
  const killSeconds = (swings * warrior.attack.cooldownMs) / 1000;
  const killsPerMinute = 60 / killSeconds;
  check(
    `band ${bandStart}–${bandStart + 9}: ${monsterId} dies in 2–16 hits`,
    swings >= 2 && swings <= 16,
    `${swings} hits`,
  );
  check(
    `band ${bandStart}–${bandStart + 9}: kill pace 2–45/min`,
    killsPerMinute >= 2 && killsPerMinute <= 45,
    `${killsPerMinute.toFixed(1)} kills/min`,
  );
}

// Full 1→60 grind with real XP curve and gap multiplier (unspent stats).
let level = 1;
let xp = 0;
let kills = 0;
let seconds = 0;
const TARGETS = [
  "wild_dog", "gray_wolf", "alpha_wolf", "wild_boar", "corrupted_deer",
  "brown_bear", "bandit_thug", "bandit_archer", "lesser_spirit",
  "ash_wolf", "wind_boar", "highland_bandit", "ridge_archer", "highland_ogre",
  "echo_wolf", "valley_spirit", "echo_bandit", "bone_walker", "echo_wraith",
  "forest_stalker", "corrupt_deer", "spiderling", "spider_matriarch",
  "corrupted_treant",
];
while (level < 60 && kills < 500_000) {
  const monsterId = TARGETS[Math.min(level - 1, TARGETS.length - 1)];
  const monster = getMonster(monsterId);
  const swings = swingsToKill(level, monster);
  seconds += (swings * warrior.attack.cooldownMs) / 1000;
  const gained = Math.max(1, Math.floor(monster.xp * levelXpMultiplier(monster.level, level)));
  const result = applyXpGain(level, xp, gained);
  level = result.level;
  xp = result.xp;
  kills += 1;
}
const hours = seconds / 3600;
check(
  "solo Warrior can reach level 60 in a reasonable grind",
  level === 60 && hours >= 6 && hours <= 120,
  `${kills} kills ≈ ${hours.toFixed(1)} h`,
);

// Every designed boss group must contain a boss monster and a long timer.
for (const group of ["field_boss", "gale_highlands_boss", "tide_highlands_boss", "valley_boss", "forest_boss", "cave_boss"]) {
  const info = getSpawnGroup(group);
  check(
    `${group}: contains exactly one boss and a long respawn`,
    info.members.length === 1 && getMonster(info.members[0].monsterId).isBoss && info.respawnMinMs >= 15 * 60 * 1000,
  );
}

if (failures > 0) {
  console.error(`\n${failures} Phase-9 balance check(s) failed.`);
  process.exit(1);
}
console.log("\nPhase-9 grind simulation passed.");
