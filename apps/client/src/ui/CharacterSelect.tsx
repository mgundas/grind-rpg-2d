import { useState } from "react";
import { CHARACTER_SLOTS, KINGDOMS, MAP_LABELS, type CharacterSummary } from "@jadethrone/shared";
import { CLASSES } from "@jadethrone/data/classes";
import { ApiError, api } from "../network/api";
import { connect, logout } from "../network/session";
import { CreateCharacter } from "./CreateCharacter";
import { CharacterPreview } from "./CharacterPreview";
import { useUiStore } from "./store";
import { Panel, styles, theme } from "./theme";

function classLabel(character: CharacterSummary): string {
  return CLASSES.find((info) => info.id === character.classId)?.name ?? character.classId;
}

/** 4-slot character select (GAME_DESIGN.md §4.1, §12 Phase 2). */
export function CharacterSelect() {
  const account = useUiStore((state) => state.account);
  const characters = useUiStore((state) => state.characters);
  const setCharacters = useUiStore((state) => state.setCharacters);
  const selectedId = useUiStore((state) => state.selectedCharacterId);
  const setSelected = useUiStore((state) => state.setSelectedCharacter);
  const connectionPhase = useUiStore((state) => state.connectionPhase);
  const connectionError = useUiStore((state) => state.connectionError);
  const kickedReason = useUiStore((state) => state.sessionKickedReason);
  const setSessionKicked = useUiStore((state) => state.setSessionKicked);

  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!account) {
    return null;
  }

  const kingdom = KINGDOMS.find((candidate) => candidate.id === account.kingdom);
  const connecting = connectionPhase === "connecting";
  const showCreate = creating || characters.length === 0;

  const play = async (character: CharacterSummary) => {
    if (connecting) {
      return;
    }
    setSelected(character.id);
    setError(null);
    try {
      await connect({ characterId: character.id, map: character.map });
    } catch {
      // `connect` already recorded the phase/error in the store.
    }
  };

  const remove = async (character: CharacterSummary) => {
    setDeletingId(null);
    setError(null);
    try {
      await api.deleteCharacter(character.id);
      const current = useUiStore.getState().characters;
      setCharacters(current.filter((candidate) => candidate.id !== character.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
    }
  };

  const created = (character: CharacterSummary) => {
    const current = useUiStore.getState().characters;
    setCharacters([...current, character]);
    setSelected(character.id);
    setCreating(false);
  };

  return (
    <Panel
      title="Choose your character"
      subtitle={`${account.username} · ${kingdom?.label ?? account.kingdom}`}
      width={640}
    >
      {kickedReason === "duplicate" ? (
        <p style={{ ...styles.error, color: theme.gold, textAlign: "center" }}>
          This character was opened in another tab.{" "}
          <button
            type="button"
            onClick={() => setSessionKicked(null)}
            style={{ ...styles.ghostButton, padding: "2px 6px" }}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {showCreate ? (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: theme.muted, textAlign: "center" }}>
            {characters.length === 0
              ? "Create your first character."
              : `Create a character (${characters.length}/${CHARACTER_SLOTS} slots used).`}
          </p>
          <CreateCharacter
            onCreated={created}
            onCancel={() => {
              if (characters.length > 0) {
                setCreating(false);
              }
            }}
          />
        </>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            {Array.from({ length: CHARACTER_SLOTS }, (_, index) => {
              const character = characters[index];
              if (!character) {
                return (
                  <button
                    key={`empty-${index}`}
                    type="button"
                    onClick={() => setCreating(true)}
                    style={{
                      minHeight: 150,
                      borderRadius: 8,
                      border: "1px dashed rgba(93,168,143,0.4)",
                      background: "rgba(14,19,17,0.4)",
                      color: theme.muted,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    Empty slot
                    <div style={{ marginTop: 4, color: theme.jade }}>+ Create</div>
                  </button>
                );
              }
              const selected = character.id === selectedId;
              const confirming = character.id === deletingId;
              return (
                <div
                  key={character.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${selected ? theme.jade : "rgba(93,168,143,0.28)"}`,
                    background: selected ? "rgba(93,168,143,0.08)" : "rgba(14,19,17,0.55)",
                  }}
                >
                  <CharacterPreview look={character} size={80} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: theme.textStrong }}>
                      {character.name}
                    </div>
                    <div style={{ fontSize: 11, color: theme.text }}>
                      {classLabel(character)} · Lv {character.level}
                    </div>
                    <div style={{ fontSize: 11, color: theme.muted }}>
                      {MAP_LABELS[character.map]}
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={connecting}
                        onClick={() => void play(character)}
                        style={{ ...styles.button, padding: "5px 10px", fontSize: 12 }}
                      >
                        {connecting && selected ? "Entering…" : "Play"}
                      </button>
                      {confirming ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void remove(character)}
                            style={{
                              ...styles.ghostButton,
                              borderColor: theme.danger,
                              color: theme.danger,
                            }}
                          >
                            Delete?
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            style={styles.ghostButton}
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeletingId(character.id)}
                          style={styles.ghostButton}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              disabled={characters.length >= CHARACTER_SLOTS}
              onClick={() => setCreating(true)}
              style={{ ...styles.ghostButton, flex: 1 }}
            >
              Create character
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              style={{ ...styles.ghostButton, flex: 1 }}
            >
              Log out
            </button>
          </div>
        </>
      )}

      {error ? <p style={styles.error}>{error}</p> : null}
      {connectionError ? <p style={styles.error}>{connectionError}</p> : null}
    </Panel>
  );
}
