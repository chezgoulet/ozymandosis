// Writes docs/DATA-INVENTORY.md from src/lib/inventory.ts (npm run inventory -w apps/play).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './lib/inventory.js';
export const DOC = fileURLToPath(new URL('../../../docs/DATA-INVENTORY.md', import.meta.url));
writeFileSync(DOC, renderMarkdown() + '\n');
console.log('wrote', DOC);
