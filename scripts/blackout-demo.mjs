// Executable local lost-ACK / hard-runtime-restart acceptance demo.
// Build first: npm run build && npm run dev:secrets
import { runWorkerdSmoke } from './smoke-workerd.mjs';

await runWorkerdSmoke();
