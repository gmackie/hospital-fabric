import { readFileSync, writeFileSync } from "node:fs";
const base = "apps/worker";
const paths = [
  ["CORE_MIGRATION", `${base}/migrations/core/0001_core.sql`],
  ["OPERATIONS_MIGRATION", `${base}/migrations/core/0002_operations.sql`],
  ["LIS_MIGRATION", `${base}/migrations/sim_lis/0001_lis.sql`],
];
const output = paths.map(([key, file]) => `export const ${key}: string = ${JSON.stringify(readFileSync(file, "utf8"))};`).join("\n") + "\n";
writeFileSync(`${base}/src/generated/migrations.ts`, output);
