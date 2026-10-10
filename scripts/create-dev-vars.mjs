import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
const path = "apps/worker/.dev.vars";
if (existsSync(path)) {
  console.log(`${path} already exists; not overwriting`);
  process.exit(0);
}
const token = randomBytes(32).toString("hex");
writeFileSync(path, `DEMO_API_KEY=${token}\nALLOW_DEV_BOOTSTRAP=1\n`, { flag: "wx", mode: 0o600 });
console.log(`Created ${path} with a random API key. Never commit this file.`);
