import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/core/redaction.ts';
import { parseDictionaryConfig } from '../src/core/config.ts';
import type { DictionaryConfig } from '../src/core/types.ts';
import {
  buildZip,
  readZip,
  redactDocx,
  redactXlsx,
  type ZipEntry
} from '../src/core/office.ts';

function config(overrides: Partial<DictionaryConfig> = {}): DictionaryConfig {
  return {
    version: 'test',
    updatedAt: '2026-10-19',
    groups: [],
    whitelist: [],
    customKeywords: [],
    ...overrides
  };
}

function zip(entries: ZipEntry[]): Uint8Array {
  return buildZip(entries);
}

function xml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decode(value: Uint8Array | undefined): string {
  assert.ok(value);
  return new TextDecoder().decode(value);
}

test('local rules mask common PII without network calls', () => {
  const engine = createEngine(config());
  const result = engine.redact('联系 13812345678，邮箱 a.b@example.com，key sk-abcdefghij1234567890。');
  assert.match(result.text, /联系 138\*\*\*\*5678/);
  assert.match(result.text, /a\*\*\*@example\.com/);
  assert.match(result.text, /sk-\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*/);
});

test('priority order is political words, whitelist, then normal rules', () => {
  const engine = createEngine(config({
    groups: [
      {
        id: 'political',
        name: '政治合规词库',
        priority: 100,
        builtin: true,
        rules: [{ type: 'keyword', value: '受限词', mask: 'char' }]
      },
      {
        id: 'business',
        name: '业务词库',
        priority: 10,
        rules: [{ type: 'keyword', value: '业务词', mask: 'star3' }]
      }
    ],
    whitelist: ['业务词']
  }));
  const result = engine.redact('受限词和业务词');
  assert.equal(result.text, '***和业务词');
  assert.equal(result.hits.filter(hit => hit.ruleId === 'political').length, 1);
});

test('code identifiers are renamed consistently and executable syntax is preserved', () => {
  const engine = createEngine(config({
    customKeywords: [{ type: 'keyword', value: 'Acme', mask: 'star3' }]
  }));
  const source = 'const AcmeUser = "Acme"; // Acme phone 13812345678';
  const result = engine.redactCode(source);
  assert.doesNotMatch(result.text, /Acme/);
  assert.match(result.text, /const redacted1User = "redacted1"; \/\/ redacted1 phone 138\*\*\*\*5678/);
});

test('full width digits and symbols are normalized before matching', () => {
  const engine = createEngine(config());
  assert.equal(engine.redact('电话１３８１２３４５６７８').text, '电话138****5678');
});

test('bundled dictionary is available without requiring a manual import', () => {
  const engine = createEngine();
  assert.equal(engine.redact('习近平测试').text, '***测试');
});

test('compact dictionary contains all expected groups and rules', () => {
  const engine = createEngine();
  assert.equal(engine.rules.length, 69);
  assert.deepEqual(
    engine.rules.reduce<Record<string, number>>((counts, rule) => {
      counts[rule.ruleId] = (counts[rule.ruleId] || 0) + 1;
      return counts;
    }, {}),
    {
      'political-official': 4,
      'political-ethnic': 13,
      'political-territory': 4,
      'political-international': 11,
      'discriminatory-language': 10,
      'advertising-medical': 15,
      'offensive-language': 4,
      'business-compliance': 4,
      pii: 4
    }
  );
});

test('imported dictionaries keep built-in political rules and add new terms', () => {
  const engine = createEngine(config({
    groups: [
      {
        id: 'political',
        name: '旧导入政治词库',
        priority: 100,
        builtin: true,
        rules: [{ type: 'keyword', value: '旧敏感词', mask: 'char' }]
      }
    ]
  }));
  assert.equal(engine.redact('索饭和旧敏感词').text, '**和****');
});

test('compact dictionary uses group defaults and removes duplicate keywords', () => {
  const parsed = parseDictionaryConfig({
    schema: 'compact-v1',
    version: '2.0.0',
    updatedAt: '2026-10-19',
    defaults: { type: 'keyword', mask: 'char' },
    groups: [
      {
        id: 'political',
        name: '政治合规词库',
        priority: 100,
        builtin: true,
        keywords: ['重复词', '重复词', '另一个词']
      },
      {
        id: 'business',
        name: '业务敏感词',
        priority: 20,
        mask: 'star3',
        keywords: ['工资']
      }
    ],
    whitelist: [],
    customKeywords: []
  });
  assert.deepEqual(parsed.groups[0]?.rules.map(rule => rule.value), ['重复词', '另一个词']);
  assert.equal(parsed.groups[1]?.rules[0]?.mask, 'star3');
  assert.equal(createEngine(parsed).redact('重复词和工资').text, '***和***');
});

test('legacy rules format remains supported', () => {
  const parsed = parseDictionaryConfig({
    version: '1.0.0',
    updatedAt: '2026-10-19',
    groups: [
      {
        id: 'legacy',
        name: '旧词库',
        priority: 30,
        rules: [{ type: 'keyword', value: '旧词', mask: 'star3' }]
      }
    ],
    whitelist: [],
    customKeywords: []
  });
  assert.equal(parsed.groups[0]?.rules[0]?.value, '旧词');
});

test('docx and xlsx XML text parts are redacted in a rebuilt zip', async () => {
  const engine = createEngine(config());
  const docx = zip([
    { name: 'word/document.xml', data: xml('<w:document><w:t>phone 13812345678</w:t></w:document>') }
  ]);
  const docxEntries = await readZip(await redactDocx(docx, engine));
  assert.equal(
    decode(docxEntries.get('word/document.xml')),
    '<w:document><w:t>phone 138****5678</w:t></w:document>'
  );

  const xlsx = zip([
    { name: 'xl/sharedStrings.xml', data: xml('<sst><si><t>a.b@example.com</t></si></sst>') }
  ]);
  const xlsxEntries = await readZip(await redactXlsx(xlsx, engine));
  assert.equal(
    decode(xlsxEntries.get('xl/sharedStrings.xml')),
    '<sst><si><t>a***@example.com</t></si></sst>'
  );

  const numericXlsx = zip([
    {
      name: 'xl/worksheets/sheet1.xml',
      data: xml('<row><c r="A1"><v>13812345678</v></c><c r="A2" t="s"><v>0</v></c></row>')
    }
  ]);
  const numericEntries = await readZip(await redactXlsx(numericXlsx, engine));
  assert.equal(
    decode(numericEntries.get('xl/worksheets/sheet1.xml')),
    '<row><c r="A1" t="str"><v>138****5678</v></c><c r="A2" t="s"><v>0</v></c></row>'
  );
});
