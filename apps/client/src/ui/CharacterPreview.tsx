import { useEffect, useRef } from "react";
import type { CharacterAppearance } from "@jadethrone/shared";
import { drawCharacterToCanvas } from "../assets/characterArt";

/** Canvas preview using the same painter as the in-world texture. */
export function CharacterPreview({
  look,
  size = 96,
}: {
  look: CharacterAppearance;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { classId, gender, hairStyle, hairColor } = look;

  useEffect(() => {
    if (canvasRef.current) {
      drawCharacterToCanvas(canvasRef.current, { classId, gender, hairStyle, hairColor });
    }
  }, [classId, gender, hairStyle, hairColor, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        imageRendering: "pixelated",
        background: "radial-gradient(circle at 50% 70%, rgba(93,168,143,0.16), transparent 70%)",
        borderRadius: 6,
      }}
    />
  );
}
