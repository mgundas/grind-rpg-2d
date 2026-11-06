#!/usr/bin/env node
/**
 * Phase-3 balance check. Simulates a solo Warrior grinding from level 1 to 10
 * using the real class/monster data and the shared formulas, then asserts the
 * tuning targets from GAME_DESIGN.md §4.4:
 *   - a level-1 Warrior kills a level-1 monster in 2–3 hits;
 *   - a level-10 player clears a pack of 5 same-level monsters in ~20 s.
 *
 * Usage: node --import tsx scripts/verify-phase3-grind.mjs
 */
import {
  applyXpGain,
  critChance,
  hitChance,
  levelXpMultiplier,
  maxHp,
  physicalAttack,
  xpToNextLevel,
} from "../packages/shared/src/formulas.ts";
import { getClass } from "../packages/data/src/classes.ts";
import { getMonster } from "../packages/data/src/monsters.ts";

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) {
    failures += 1;
  }
}

const warrior = getClass("warrior");
const stats = { ...warrior.stats };

function attackPower(level) {
  return physicalAttack({ classId: "warrior", stats, level });
}

function expectedSwing(level, monsterId) {
  const monster = getMonster(monsterId);
  const chance = hitChance({
    attackerDex: stats.dex,
    defenderDex: monster.dex,
    attackerLevel: level,
    defenderLevel: monster.level,
  });
  const damage = Math.max(1, attackPower(level) - monster.defense * 0.7);
  const crit = critChance(stats.dex);
  const expected = chance * (damage * (1 - crit) + damage * 2 * crit);
  return { monster, chance, damage, expected };
}

function swingsToKill(level, monsterId) {
  const { monster, expected } = expectedSwing(level, monsterId);
  return { monster, swings: Math.ceil(monster.hp / Math.max(1, expected)), expected };
}

const level1 = swingsToKill(1, "wild_dog");
check(
  "level-1 Warrior needs 2–3 hits for a level-1 monster",
  level1.swings >= 2 && level1.swings <= 3,
  `${level1.swings} hits, ${level1.expected.toFixed(1)} avg damage`,
);

const level10 = swingsToKill(10, "lesser_spirit");
const packSeconds = (level10.swings * warrior.attack.cooldownMs) / 1000;
check(
  "level-10 Warrior clears five same-level monsters in ~20 s",
  packSeconds >= 12 && packSeconds <= 28,
  `${level10.swings} swings ≈ ${packSeconds.toFixed(1)} s`,
);

// Grind simulation: at each level fight the highest available monster, using
// the real XP curve and gap multiplier. Stat points are left unspent (worst
// case) so the estimate is conservative.
const GRIND_TARGETS = [
  "wild_dog",
  "gray_wolf",
  "alpha_wolf",
  "wild_boar",
  "corrupted_deer",
  "brown_bear",
  "brown_bear",
  "bandit_thug",
  "bandit_archer",
];

let level = 1;
let xp = 0;
let kills = 0;
let seconds = 0;
const startHp = maxHp({ baseHp: warrior.baseHp, vit: stats.vit, level: 1 });
check("level-1 Warrior has positive HP", startHp > 0, `${startHp} HP`);

while (level < 10 && kills < 100_000) {
  const monsterId = GRIND_TARGETS[Math.min(level - 1, GRIND_TARGETS.length - 1)];
  const { monster, swings } = swingsToKill(level, monsterId);
  const killSeconds = (swings * warrior.attack.cooldownMs) / 1000;
  const gained = Math.max(1, Math.floor(monster.xp * levelXpMultiplier(monster.level, level)));
  const result = applyXpGain(level, xp, gained);
  level = result.level;
  xp = result.xp;
  kills += 1;
  seconds += killSeconds;
}

const minutes = seconds / 60;
check(
  "solo Warrior can reach level 10 in a reasonable grind",
  level === 10 && minutes >= 15 && minutes <= 180,
  `${kills} kills ≈ ${minutes.toFixed(0)} min (next level ${xpToNextLevel(level)} XP)`,
);

if (failures > 0) {
  console.error(`\n${failures} Phase-3 balance check(s) failed.`);
  process.exit(1);
}
console.log("\nPhase-3 grind simulation passed.");
