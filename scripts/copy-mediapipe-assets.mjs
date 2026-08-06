import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const source = path.join(
  process.cwd(),
  "node_modules",
  "@mediapipe",
  "tasks-vision",
  "wasm"
);
const destination = path.join(process.cwd(), "public", "mediapipe", "wasm");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
console.log("MediaPipe WASM assets ready.");
