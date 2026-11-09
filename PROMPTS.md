# Jade Throne: Prompt Playbook

Copy and paste these prompts into OpenCode. Replace anything in `<angle brackets>`.

## The loop for every phase

| Step | Mode | Prompt |
|---|---|---|
| 1. Plan the phase | **Plan** (Tab to switch) | [A. Plan](#a-plan-the-phase) + that phase's [focus notes](#phase-focus-notes) |
| 2. Save plan and build | **Build** (same session) | [B. Start building](#b-start-building) |
| 3. Keep going in a new session | Build | [C. Continue](#c-continue-in-a-new-session) |
| 4. If it crashed mid-task | Build | [D. Resume after an interruption](#d-resume-after-an-interruption) |
| 5. If something is stuck | Build | [E. Stuck](#e-something-is-stuck) |
| 6. Review | Build | [F. Review the phase](#f-review-the-phase) |
| 7. You test it yourself | | [G. Manual testing checklist](#g-manual-testing-checklist) |
| 8. Report problems you found | Build | [H. Bug report](#h-report-a-bug-you-found-while-playing) |
| 9. Close the phase | Build | [I. Close the phase](#i-close-the-phase) |

Start a **new session** (fresh chat) at every step marked "new session", and any time the context bar passes about 60%.

---

## First time only: Phase 0 kickoff

Use this instead of A for Phase 0. Plan mode.

```
Read AGENTS.md and GAME_DESIGN.md completely. This is an empty project and
we are starting Phase 0 (Foundation).

Write a step-by-step plan for Phase 0 only:
- exact package versions to install (check npm for the current Phaser 4.x
  and Colyseus 0.17 releases, do not guess)
- the full folder and file structure
- the root scripts for pnpm dev, build, test, typecheck and lint
- how the asset manifest and procedural placeholder system will work
- a numbered task list, each task small enough to finish and commit alone
- how you will verify each acceptance criterion of Phase 0

Do not write any code yet.
```

Then continue with [B. Start building](#b-start-building).

---

## A. Plan the phase

**Plan mode, new session.** Paste this, then add the focus notes for the phase from the bottom of this file.

```
Read AGENTS.md, GAME_DESIGN.md, PROGRESS.md and DECISIONS.md. Look at the
current code structure with @explore.

We are starting Phase 9: The wider world from GAME_DESIGN.md section 12.

Write a detailed plan for this phase only:
1. A summary of what already exists that this phase builds on.
2. A numbered task list in a sensible order. Each task must be small enough
   to finish, type-check and commit on its own.
3. For each task: files to create or change, and the key functions or
   components.
4. For hard systems (networking, AI, combat, inventory, transactions), the
   exact approach and the edge cases to handle.
5. Tests to write.
6. How each acceptance criterion will be verified.
7. Risks: anything likely to go wrong and how to avoid it.

Check library APIs in node_modules type definitions before planning around
them. Do not write code.

Extra focus for this phase:
<paste the phase focus notes here>
```

Read the plan. If something looks wrong or missing, tell it in Plan mode before moving on.

## B. Start building

**Switch to Build mode (Tab) in the same session.**

```
Save the plan above to docs/plans/phase-9.md and add the task list to
PROGRESS.md under a "Phase 9" heading with checkboxes.

Then start working through the tasks in order. After each task: run
typecheck and the relevant tests, tick the checkbox in PROGRESS.md, and
commit. Call @architect before any hard system as AGENTS.md says.

Keep going until all tasks are done or you finish 3 tasks, whichever comes
first, then stop and tell me what is done and what is next.
```

## C. Continue in a new session

**Build mode, new session.** Use this every time you start a fresh session in the middle of a phase.

```
Read AGENTS.md, PROGRESS.md, DECISIONS.md and docs/plans/phase-<N>.md.
Only read the GAME_DESIGN.md sections needed for the current task.
Run `git log --oneline -10` and `git status`.

Continue with the next unchecked task of Phase <N>. Same rules: typecheck,
test, tick the box, commit after each task. Stop after 3 tasks or when the
phase task list is finished, and tell me where you are.
```

## D. Resume after an interruption

**Build mode, new session (switch model if the old one keeps failing).**

```
The previous session was interrupted in the middle of a task. Read AGENTS.md,
PROGRESS.md, DECISIONS.md and docs/plans/phase-5.md.

Run `git status` and `git diff` to see uncommitted work. Decide whether that
work is correct and complete:
- if it is usable, finish it, verify it, and commit it
- if it is broken or half done, discard it with `git checkout . && git clean -fd`
  and redo the task cleanly

Then continue with the remaining tasks as in the plan.
```

## E. Something is stuck

**Build mode.** Use when the same error keeps coming back, or the agent is going in circles.

```
Stop trying to fix this yourself. Call @debugger with:
- the exact error or wrong behaviour
- the command that reproduces it
- what you already tried and why it did not work
- the files involved

After it reports back, verify the fix by running typecheck and the tests,
update PROGRESS.md and commit.
```

If it is a design problem rather than a bug (the approach itself is wrong):

```
Stop. This approach is not working. Call @architect: explain the goal, the
current approach, and why it fails. Ask for a better design. Record the new
decision in DECISIONS.md, update docs/plans/phase-<N>.md, then implement it.
```

## F. Review the phase

**Build mode, new session**, when all tasks are ticked.

```
Read AGENTS.md, PROGRESS.md and docs/plans/phase-<N>.md. All tasks for
Phase <N> should be done.

1. Run pnpm typecheck, pnpm lint, pnpm test and pnpm build. Fix anything
   that fails.
2. Call @reviewer to review Phase <N>.
3. Fix every problem it marks as important. List the minor ones in
   PROGRESS.md under "Known issues" instead of fixing them now.
4. Start the full stack with pnpm dev and check each acceptance criterion of
   Phase <N> yourself as far as you can without a human.
5. Commit, then write the phase report: what was built, how to run it, exact
   steps for me to test each acceptance criterion by hand, and known issues.
```

## G. Manual testing checklist

Not a prompt. Do this yourself after the report:

1. `pnpm install` then `pnpm dev`. Note any errors.
2. Follow the report's test steps for every acceptance criterion.
3. Open the browser console (F12) and look for red errors.
4. For multiplayer phases, open two browser windows side by side.
5. Ask yourself: **is it fun and does it feel smooth?** Write down anything that feels off, even if it technically works.

## H. Report a bug you found while playing

**Build mode.** One bug per message works best.

```
I found a problem while testing Phase <N>.

What I did: <steps>
What I expected: <expected>
What happened instead: <actual>
Browser console errors: <paste or "none">
Server terminal errors: <paste or "none">

Find the root cause and fix it. Add a test that would have caught it if
possible. Commit when done and tell me how to verify the fix.
```

For things that work but feel bad:

```
This works but does not feel good: <describe, e.g. "attacks feel weak",
"other players stutter when they turn", "the inventory is confusing">.

Check GAME_DESIGN.md section 11 (game feel) and suggest 3 concrete
improvements. Implement the ones that fit this phase, then commit.
```

## I. Close the phase

**Build mode**, when your manual testing passes.

```
Phase <N> is accepted. Please:
1. Mark Phase <N> as complete in PROGRESS.md with today's date.
2. Make sure DECISIONS.md and ASSETS.md are up to date.
3. Commit with the message "Phase <N> complete" and create a git tag
   phase-<N>.

Do not start the next phase.
```

The tag lets you roll back to a working state later with `git checkout phase-<N>`.

---

## Phase focus notes

Paste the matching block into prompt A.

**Phase 0: Foundation**
Use the kickoff prompt at the top instead.

**Phase 1: Walk together**
```
- Movement step and collision must live in packages/shared and run
  identically on client and server. Plan the prediction, reconciliation and
  interpolation code with @architect before writing it.
- Verify the exact Colyseus 0.17 StateView and schema callback APIs in
  node_modules before using them.
- The map generator must output valid Tiled JSON that looks good: plan the
  tile choices and layout rules carefully.
- Include the dev flag for simulated latency from the start, so smoothness
  can be tested.
```

**Phase 2: Accounts and characters**
```
- Plan the Drizzle schema for all of section 10.3 now, even tables used in
  later phases, so migrations stay simple.
- Security: argon2, JWT with refresh tokens, rate-limited login, one session
  per account. Never trust the client.
- The login and character select screens must already look like the final
  game (section 2 UI style), not like a default form.
```

**Phase 3: Combat and monsters**
```
- Combat must feel punchy: implement every item from section 11 that
  applies to combat in this phase, not later.
- Monster AI must sleep when no player is near, to keep the tick fast.
- Write formula tests first, then tune numbers until a level 1 Warrior kills
  a level 1 monster in 2 to 3 hits.
- Add a dev command to give XP or levels, so testing levels 1 to 10 is fast.
```

**Phase 4: Items and economy**
```
- Every item change must happen in a database transaction and write to
  item_log. Think through duplication exploits (double pickup, drop while
  trading, disconnect mid-action) and prevent each one.
- Multi-cell inventory placement needs thorough unit tests.
- Equipped items must visibly change the character's appearance.
```

**Phase 5: Admin panel**
```
- Protect every admin route and the Colyseus monitor with the same role
  check. Log every admin action to admin_log.
- Changes made in the admin panel (give item, ban, gold) must reach an
  online player immediately, without relogging.
```

**Phase 6: Spirit stones, skills, parties**
```
- Design all 4 classes' skills in packages/data/skills.json first and make
  each class feel clearly different to play.
- Each skill needs its own particle effect and sound. Reuse a small effect
  system rather than one-off code per skill.
- Party XP sharing must be tested.
```

**Phase 7: Upgrades, bonuses, trading**
```
- Upgrade and trade logic are the highest-risk code for item duplication.
  Use @architect for both and test them heavily with seeded RNG.
- Trade must be atomic: both sides succeed or nothing changes, even if a
  player disconnects mid-trade.
- The upgrade suspense animation and result effects matter for fun.
```

**Phase 8: Social and progression depth**
```
- Guild and friend data must survive server restarts and map changes.
- PvP rules must be enforced on the server, including safe zones.
- Day/night and weather must not drop the frame rate.
```

**Phase 9: The wider world**
```
- Each map must look clearly different (biome, colors, decoration) and the
  generator must stay reproducible.
- Channels and dungeon instances must not leak memory when empty rooms
  are disposed.
- Balance monsters and items for levels 15 to 60 using the existing
  formulas, and update the formula tests.
```

**Phase 10: Polish, performance and deployment**
```
- Profile before optimizing: measure frame time on the client and tick time
  on the server with 150 load-test bots, and report numbers.
- Production Docker setup must work behind nginx-proxy-manager with
  WebSockets. Write DEPLOY.md for someone who is not a developer.
```

---

## Handy extra prompts

**Add real art you downloaded or generated**
```
I added new art files to apps/client/public/assets/<folder>. Update
manifest.json so the game uses them instead of placeholders, following
ASSETS.md. Check frame sizes and animation rows match. Commit.
```

**Change game balance**
```
<describe, e.g. "Leveling from 10 to 20 is too slow" or "Wolves hit too hard">.
Adjust the values in packages/data or formulas.ts only, update affected
tests, and explain what you changed and why.
```

**Understand something**
```
Explain in simple terms, for someone who is not a developer, how <system>
works in this codebase and which files are involved. Do not change anything.
```

**Undo a bad session**
```
The last changes made things worse. Show me `git log --oneline -15` and
explain each commit in one line. Then revert to <commit or tag> safely,
keeping PROGRESS.md accurate.
```
