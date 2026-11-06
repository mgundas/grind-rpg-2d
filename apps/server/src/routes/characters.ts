import { Router } from "express";
import { z } from "zod";
import { createCharacterRequestSchema, type CharactersResponse } from "@jadethrone/shared";
import type { SessionRegistry } from "../auth/sessionRegistry";
import { createCharacter, deleteCharacter, listCharacters } from "../characters/characterService";
import type { Db } from "../db/client";
import { ServiceError } from "../errors";
import { authedAccount, requireAuth } from "../http/requireAuth";
import { parseBody } from "../http/validation";
import type { AuthDeps } from "../auth/accountService";

export interface CharacterRouteDeps {
  authDeps: AuthDeps;
  db: Db;
  sessionRegistry: SessionRegistry;
}

export function createCharactersRouter(deps: CharacterRouteDeps): Router {
  const router = Router();

  router.get("/", requireAuth(deps), async (_req, res) => {
    const account = authedAccount(res);
    const characters = await listCharacters(deps.db, account.id);
    const payload: CharactersResponse = { characters };
    res.json(payload);
  });

  router.post("/", requireAuth(deps), async (req, res) => {
    const account = authedAccount(res);
    const input = parseBody(createCharacterRequestSchema, req.body);
    const character = await createCharacter(deps.db, account.id, input);
    res.status(201).json({ character });
  });

  router.delete("/:id", requireAuth(deps), async (req, res) => {
    const account = authedAccount(res);
    const parsed = z.uuid().safeParse(req.params.id);
    if (!parsed.success) {
      throw new ServiceError("validation", "Invalid character id.", { id: "invalid" });
    }
    await deleteCharacter(deps.db, account.id, parsed.data, {
      isOnline: (characterId) => deps.sessionRegistry.isCharacterOnline(characterId),
    });
    res.status(204).end();
  });

  return router;
}
