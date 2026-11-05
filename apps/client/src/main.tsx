import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { startGame } from "./game";

// React overlay mounts on #overlay (pointer-events: none by default, see
// index.html) so Phaser keeps full mouse control; interactive HUD widgets
// opt back in per element (see the world scene later).
createRoot(document.getElementById("overlay")!).render(<App />);

startGame();
