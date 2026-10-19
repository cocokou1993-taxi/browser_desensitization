import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sourcePath = path.join(root, 'dictionary.example.json');
const targetPath = path.join(root, 'src', 'core', 'dictionary.ts');
const dictionary = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const output = `// Generated from dictionary.example.json by scripts/sync-dictionary.mjs.
import { parseDictionaryConfig } from './config.ts';
import type { CompactDictionaryConfig } from './types.ts';

const SOURCE: CompactDictionaryConfig = ${JSON.stringify(dictionary, null, 2)};

export const DEFAULT_DICTIONARY = parseDictionaryConfig(SOURCE);
`;
fs.writeFileSync(targetPath, output, 'utf8');
