import { describe, expect, it } from "vitest";
import {
  createCharacterRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  refreshRequestSchema,
} from "@jadethrone/shared";

describe("registerRequestSchema", () => {
  const valid = {
    email: "Player@Example.com",
    username: "PlayerOne",
    password: "correct-horse",
    kingdom: "ember",
  };

  it("accepts a valid registration", () => {
    expect(registerRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid emails, usernames, passwords and kingdoms", () => {
    expect(registerRequestSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, username: "ab" }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, username: "Bad Name" }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...valid, password: "x".repeat(129) }).success).toBe(
      false,
    );
    expect(registerRequestSchema.safeParse({ ...valid, kingdom: "moon" }).success).toBe(false);
  });
});

describe("loginRequestSchema", () => {
  it("accepts an email or username and trims whitespace", () => {
    const parsed = loginRequestSchema.parse({ login: "  PlayerOne  ", password: "secret" });
    expect(parsed.login).toBe("PlayerOne");
  });

  it("rejects empty credentials", () => {
    expect(loginRequestSchema.safeParse({ login: "", password: "secret" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ login: "name", password: "" }).success).toBe(false);
  });
});

describe("refreshRequestSchema", () => {
  it("requires a token", () => {
    expect(refreshRequestSchema.safeParse({ refreshToken: "abc" }).success).toBe(true);
    expect(refreshRequestSchema.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(refreshRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("createCharacterRequestSchema", () => {
  const valid = {
    name: "Grinder",
    classId: "warrior",
    gender: "male",
    hairStyle: 0,
    hairColor: 2,
  };

  it("accepts a valid character", () => {
    expect(createCharacterRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid names, classes, genders and hair indexes", () => {
    expect(createCharacterRequestSchema.safeParse({ ...valid, name: "ab" }).success).toBe(false);
    expect(createCharacterRequestSchema.safeParse({ ...valid, name: "Bad Name" }).success).toBe(
      false,
    );
    expect(createCharacterRequestSchema.safeParse({ ...valid, classId: "paladin" }).success).toBe(
      false,
    );
    expect(createCharacterRequestSchema.safeParse({ ...valid, gender: "other" }).success).toBe(
      false,
    );
    expect(createCharacterRequestSchema.safeParse({ ...valid, hairStyle: 3 }).success).toBe(false);
    expect(createCharacterRequestSchema.safeParse({ ...valid, hairColor: 3 }).success).toBe(false);
  });
});
