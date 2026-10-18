import { rmSync } from "node:fs";

// dist is generated output; remove stale modules before compiling or packing.
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
