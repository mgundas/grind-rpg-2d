import { useState, type FormEvent } from "react";
import {
  GENDERS,
  HAIR_COLOR_COUNT,
  HAIR_STYLE_COUNT,
  isValidCharacterName,
  type CharacterAppearance,
  type CharacterSummary,
  type ClassId,
  type Gender,
} from "@jadethrone/shared";
import { CLASSES } from "@jadethrone/data/classes";
import { ApiError, api } from "../network/api";
import { HAIR_COLORS } from "../assets/characterArt";
import { CharacterPreview } from "./CharacterPreview";
import { Field, styles, theme } from "./theme";

const HAIR_STYLE_LABELS = ["Short", "Long", "Top knot"];

/** Character creation form: name, class, gender, hair (GAME_DESIGN.md §4.1). */
export function CreateCharacter({
  onCreated,
  onCancel,
}: {
  onCreated: (character: CharacterSummary) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [classId, setClassId] = useState<ClassId>("warrior");
  const [gender, setGender] = useState<Gender>("male");
  const [hairStyle, setHairStyle] = useState(0);
  const [hairColor, setHairColor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const look: CharacterAppearance = { classId, gender, hairStyle, hairColor };
  const trimmed = name.trim();
  const nameOk = isValidCharacterName(trimmed);
  const canSubmit = nameOk && !busy;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const character = await api.createCharacter({
        name: trimmed,
        classId,
        gender,
        hairStyle,
        hairColor,
      });
      onCreated(character);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flexShrink: 0, textAlign: "center" }}>
          <CharacterPreview look={look} size={104} />
          <div style={{ fontSize: 11, color: theme.muted, marginTop: 4 }}>
            {CLASSES.find((info) => info.id === classId)?.name}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Field label="Name" htmlFor="create-name" hint="3–16 letters or numbers; unique.">
            <input
              id="create-name"
              maxLength={16}
              value={name}
              onChange={(event) => setName(event.target.value)}
              style={styles.input}
              autoFocus
            />
          </Field>

          <div style={styles.label}>Class</div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}
          >
            {CLASSES.map((info) => {
              const active = info.id === classId;
              return (
                <button
                  key={info.id}
                  type="button"
                  title={info.description}
                  onClick={() => setClassId(info.id)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontSize: 12,
                    textAlign: "left",
                    color: active ? "#0f1210" : theme.text,
                    background: active ? info.colors.trim : "transparent",
                    border: `1px solid ${active ? info.colors.trim : "rgba(93,168,143,0.35)"}`,
                  }}
                >
                  {info.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={styles.label}>Gender</div>
          <div style={{ display: "flex", gap: 6 }}>
            {GENDERS.map((candidate) => {
              const active = candidate === gender;
              return (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setGender(candidate)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontSize: 12,
                    textTransform: "capitalize",
                    color: active ? "#0f1210" : theme.text,
                    background: active ? theme.jade : "transparent",
                    border: `1px solid ${theme.jade}`,
                  }}
                >
                  {candidate}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={styles.label}>Hair style</div>
          <div style={{ display: "flex", gap: 6 }}>
            {Array.from({ length: HAIR_STYLE_COUNT }, (_, index) => {
              const active = index === hairStyle;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setHairStyle(index)}
                  style={{
                    flex: 1,
                    padding: "5px 0",
                    borderRadius: 5,
                    cursor: "pointer",
                    fontSize: 11,
                    color: active ? "#0f1210" : theme.text,
                    background: active ? theme.jade : "transparent",
                    border: `1px solid ${theme.jade}`,
                  }}
                >
                  {HAIR_STYLE_LABELS[index] ?? index + 1}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={styles.label}>Hair colour</div>
        <div style={{ display: "flex", gap: 8 }}>
          {Array.from({ length: HAIR_COLOR_COUNT }, (_, index) => {
            const active = index === hairColor;
            return (
              <button
                key={index}
                type="button"
                aria-label={`Hair colour ${index + 1}`}
                onClick={() => setHairColor(index)}
                style={{
                  width: 30,
                  height: 22,
                  borderRadius: 4,
                  cursor: "pointer",
                  background: HAIR_COLORS[index] ?? HAIR_COLORS[0],
                  border: active ? `2px solid ${theme.gold}` : "1px solid rgba(255,255,255,0.18)",
                }}
              />
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button type="submit" disabled={!canSubmit} style={{ ...styles.button, flex: 1 }}>
          {busy ? "Creating…" : "Create character"}
        </button>
        <button type="button" onClick={onCancel} style={styles.ghostButton}>
          Cancel
        </button>
      </div>
      {error ? <p style={styles.error}>{error}</p> : null}
    </form>
  );
}
