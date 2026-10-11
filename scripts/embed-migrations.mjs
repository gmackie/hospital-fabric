import { readFileSync, writeFileSync } from "node:fs";
const base = "apps/worker";
const paths = [
  ["CORE_MIGRATION", `${base}/migrations/core/0001_core.sql`],
  ["OPERATIONS_MIGRATION", `${base}/migrations/core/0002_operations.sql`],
  ["PUBLIC_DEMO_MIGRATION", `${base}/migrations/core/0003_public_demo.sql`],
  ["REAL_DEMO_MIGRATION", `${base}/migrations/core/0004_real_demo.sql`],
  ["HOSPITAL_MIGRATION", `${base}/migrations/core/0005_hospital_simulation.sql`],
  ["RESULT_CURSOR_MIGRATION", `${base}/migrations/core/0006_result_intake_cursor.sql`],
  ["LIS_MIGRATION", `${base}/migrations/sim_lis/0001_lis.sql`],
];
// D1 exec splits on newlines, not SQL statement boundaries. Emit one complete
// statement per line, preserving quoted text and removing SQL comments.
// These static bootstrap migrations do not contain compound CREATE TRIGGER bodies.
function forD1Exec(sql) {
  return sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|\s+|;/g,
    token => {
      if (token.startsWith('--') || token.startsWith('/*')) return ' ';
      if (/^\s/.test(token)) return ' ';
      if (token === ';') return ';\n';
      if (/[\r\n]/.test(token)) throw new Error('D1 exec cannot embed multiline SQL literals');
      return token;
    },
  ).split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}
const output = paths.map(([key, file]) => `export const ${key}: string = ${JSON.stringify(forD1Exec(readFileSync(file, "utf8")))};`).join("\n") + "\n";
writeFileSync(`${base}/src/generated/migrations.ts`, output);
