import { describe, expect, it } from "vitest";
import { getSkill, hasSkill, SKILLS, skillsForDoctrine } from "@jadethrone/data/skills";
import { CLASSES, getClass } from "@jadethrone/data/classes";

describe("skills.json", () => {
  it("defines twelve Warrior skills, six per doctrine", () => {
    const warrior = SKILLS.filter((skill) => skill.classId === "warrior");
    expect(warrior).toHaveLength(12);
    expect(skillsForDoctrine("warrior", "blade")).toHaveLength(6);
    expect(skillsForDoctrine("warrior", "iron_body")).toHaveLength(6);
  });

  it("defines twelve Assassin skills, six per doctrine", () => {
    expect(SKILLS.filter((skill) => skill.classId === "assassin")).toHaveLength(12);
    expect(skillsForDoctrine("assassin", "shadow")).toHaveLength(6);
    expect(skillsForDoctrine("assassin", "hawk")).toHaveLength(6);
  });

  it("defines twelve Hexblade skills, six per doctrine", () => {
    expect(SKILLS.filter((skill) => skill.classId === "hexblade")).toHaveLength(12);
    expect(skillsForDoctrine("hexblade", "cursed_steel")).toHaveLength(6);
    expect(skillsForDoctrine("hexblade", "dark_arts")).toHaveLength(6);
  });

  it("defines twelve Mystic skills, six per doctrine", () => {
    expect(SKILLS.filter((skill) => skill.classId === "mystic")).toHaveLength(12);
    expect(skillsForDoctrine("mystic", "dragon")).toHaveLength(6);
    expect(skillsForDoctrine("mystic", "grace")).toHaveLength(6);
  });

  it("covers every class doctrine with exactly six skills", () => {
    expect(SKILLS).toHaveLength(48);
    for (const info of CLASSES) {
      for (const doctrine of info.doctrines) {
        const skills = skillsForDoctrine(info.id, doctrine.id);
        expect(skills).toHaveLength(6);
        expect(new Set(skills.map((skill) => skill.fx)).size).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses unique ids and existing doctrines", () => {
    expect(new Set(SKILLS.map((skill) => skill.id)).size).toBe(SKILLS.length);
    for (const skill of SKILLS) {
      const info = getClass(skill.classId);
      expect(info.doctrines.some((doctrine) => doctrine.id === skill.doctrineId)).toBe(true);
    }
  });

  it("keeps unlock levels ascending from 5 to 30", () => {
    for (const skill of SKILLS) {
      expect(skill.unlockLevel).toBeGreaterThanOrEqual(5);
      expect(skill.unlockLevel).toBeLessThanOrEqual(30);
      expect(skill.maxRank).toBe(20);
      expect(skill.mpCost.base).toBeGreaterThanOrEqual(0);
      expect(skill.cooldownMs).toBeGreaterThan(0);
      expect(skill.iconKey.startsWith("icon.skill.")).toBe(true);
    }
    for (const doctrineId of ["blade", "iron_body"]) {
      const levels = skillsForDoctrine("warrior", doctrineId).map((skill) => skill.unlockLevel);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      expect(levels[0]).toBe(5);
      expect(levels[levels.length - 1]).toBe(30);
    }
    for (const doctrineId of ["shadow", "hawk"]) {
      const levels = skillsForDoctrine("assassin", doctrineId).map((skill) => skill.unlockLevel);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      expect(levels[0]).toBe(5);
      expect(levels[levels.length - 1]).toBe(30);
    }
    for (const doctrineId of ["cursed_steel", "dark_arts"]) {
      const levels = skillsForDoctrine("hexblade", doctrineId).map((skill) => skill.unlockLevel);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      expect(levels[0]).toBe(5);
      expect(levels[levels.length - 1]).toBe(30);
    }
    for (const doctrineId of ["dragon", "grace"]) {
      const levels = skillsForDoctrine("mystic", doctrineId).map((skill) => skill.unlockLevel);
      expect(levels).toEqual([...levels].sort((a, b) => a - b));
      expect(levels[0]).toBe(5);
      expect(levels[levels.length - 1]).toBe(30);
    }
  });

  it("requires heals for heal skills and damage for offensive ones", () => {
    for (const skill of SKILLS) {
      if (skill.type === "heal") {
        expect(skill.heal).toBeDefined();
      }
      if (skill.type === "melee_aoe" || skill.type === "area") {
        expect(skill.damage).toBeDefined();
        expect(skill.radiusPx).toBeGreaterThan(0);
      }
      if (skill.type === "buff") {
        expect(skill.effects.length).toBeGreaterThan(0);
      }
    }
  });

  it("looks skills up by id", () => {
    expect(hasSkill("warrior_blade_whirlwind")).toBe(true);
    expect(hasSkill("missing_skill")).toBe(false);
    expect(getSkill("warrior_iron_body_unbreakable").type).toBe("heal");
    expect(() => getSkill("missing_skill")).toThrow(/unknown skill/);
  });
});
