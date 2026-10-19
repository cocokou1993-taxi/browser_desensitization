import { DEFAULT_DICTIONARY } from './dictionary.ts';
import type {
  CompiledRule,
  DictionaryConfig,
  MaskType,
  MatchCandidate,
  RedactionDiagnostics,
  RedactionEngine,
  RedactionResult,
  RedactionRule,
  RuleGroup,
  RuleType
} from './types.ts';

const FALLBACK_CONFIG: DictionaryConfig = {
  version: '1.0.0',
  updatedAt: '2026-10-19',
  groups: [
    {
      id: 'political',
      name: '政治合规词库',
      priority: 100,
      builtin: true,
      rules: []
    },
    {
      id: 'pii',
      name: '个人敏感信息',
      priority: 10,
      builtin: true,
      rules: [
        { type: 'regex', value: '(?<![A-Za-z0-9_-])1[3-9]\\d{9}(?![0-9])', mask: 'phone' },
        { type: 'regex', value: '(?<![0-9Xx])\\d{17}[\\dXx](?![0-9Xx])', mask: 'idcard' },
        { type: 'regex', value: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', mask: 'email' },
        { type: 'regex', value: '(?<![A-Za-z0-9_-])(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}', mask: 'apikey' }
      ]
    }
  ],
  whitelist: [],
  customKeywords: []
};

const diagnostics: RedactionDiagnostics = {
  dictionary: 'loaded'
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeFullWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

function maskPhone(value: string): string {
  if (value.length === 11) {
    return `${value.slice(0, 3)}****${value.slice(-4)}`;
  }
  return '*'.repeat(value.length);
}

function maskIdCard(value: string): string {
  if (value.length === 18) {
    return `${value.slice(0, 6)}${'*'.repeat(value.length - 10)}${value.slice(-4)}`;
  }
  return '*'.repeat(value.length);
}

function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at < 1) {
    return '*'.repeat(value.length);
  }
  return `${value[0]}***${value.slice(at)}`;
}

export function applyMask(value: string, mask: MaskType): string {
  if (mask === 'phone') {
    return maskPhone(value);
  }
  if (mask === 'idcard') {
    return maskIdCard(value);
  }
  if (mask === 'email') {
    return maskEmail(value);
  }
  if (mask === 'star3') {
    return '***';
  }
  if (mask === 'apikey') {
    const prefixLength = value.indexOf('-') + 1;
    return value.slice(0, prefixLength) + '*'.repeat(Math.max(0, value.length - prefixLength));
  }
  return '*'.repeat(value.length);
}

function compileRule(group: RuleGroup, rule: RedactionRule, index: number): CompiledRule | null {
  if (!rule.value) {
    return null;
  }
  const priority = Number(group.priority || 0);
  const ruleId = group.id || `group-${index}`;
  const type: RuleType = rule.type === 'regex' ? 'regex' : 'keyword';
  const source = type === 'regex' ? rule.value : escapeRegExp(rule.value);
  try {
    return {
      ruleId,
      group: group.id,
      priority,
      builtin: Boolean(group.builtin),
      type,
      mask: rule.mask || (type === 'regex' ? 'char' : 'star3'),
      source,
      regex: new RegExp(source, 'giu')
    };
  } catch {
    return null;
  }
}

function overlaps(match: MatchCandidate, selected: MatchCandidate[]): boolean {
  return selected.some(item => match.start < item.end && item.start < match.end);
}

function mergeBuiltinRules(groups: RuleGroup[]): void {
  for (const builtinGroup of DEFAULT_DICTIONARY.groups.filter(group => group.builtin)) {
    const groupIndex = groups.findIndex(group => group.id === builtinGroup.id);
    if (groupIndex === -1) {
      groups.push({
        ...builtinGroup,
        rules: builtinGroup.rules.map(rule => ({ ...rule }))
      });
      continue;
    }
    const group = groups[groupIndex];
    if (!group) {
      continue;
    }
    const rules = Array.isArray(group.rules) ? group.rules.slice() : [];
    const seenRules = new Set(rules.map(rule => `${rule.type || 'keyword'}:${rule.value}`));
    for (const rule of builtinGroup.rules) {
      const signature = `${rule.type || 'keyword'}:${rule.value}`;
      if (!seenRules.has(signature)) {
        rules.push({ ...rule });
        seenRules.add(signature);
      }
    }
    groups[groupIndex] = { ...group, rules };
  }
}

export function createEngine(config?: DictionaryConfig | null): RedactionEngine {
  const source = config || DEFAULT_DICTIONARY;
  const groups: RuleGroup[] = Array.isArray(source.groups)
    ? source.groups.map(group => ({
        ...group,
        rules: Array.isArray(group.rules) ? group.rules.slice() : []
      }))
    : [];

  mergeBuiltinRules(groups);

  if (!groups.some(group => group.id === 'pii')) {
    const builtinPii = FALLBACK_CONFIG.groups.find(group => group.id === 'pii');
    if (builtinPii) {
      groups.push({
        ...builtinPii,
        rules: builtinPii.rules.slice()
      });
    }
  }

  const whitelist = new Set((source.whitelist || []).map(item => String(item)));
  if (Array.isArray(source.customKeywords) && source.customKeywords.length) {
    groups.push({
      id: 'custom',
      name: '自定义敏感词',
      priority: 20,
      rules: source.customKeywords.map(rule => ({ ...rule }))
    });
  }

  const allRules = groups.flatMap((group, groupIndex) => {
    return group.rules
      .map(rule => compileRule(group, rule, groupIndex))
      .filter((rule): rule is CompiledRule => rule !== null);
  });
  const keywordRules = allRules.filter(rule => rule.type === 'keyword');

  function isWhitelisted(value: string): boolean {
    return Array.from(whitelist).some(item => value.toLowerCase().includes(item.toLowerCase()));
  }

  function collectMatches(text: string): MatchCandidate[] {
    const selected: MatchCandidate[] = [];
    const input = String(text || '');
    const normalized = normalizeFullWidth(input);
    const scanTexts = normalized === input ? [input] : [input, normalized];
    for (const scanText of scanTexts) {
      for (const rule of allRules) {
        rule.regex.lastIndex = 0;
        let match = rule.regex.exec(scanText);
        while (match) {
          const candidate: MatchCandidate = {
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
            priority: rule.priority,
            ruleId: rule.ruleId,
            mask: rule.mask
          };
          const isPolitical = rule.priority >= 100;
          if ((isPolitical || !isWhitelisted(candidate.text)) && !overlaps(candidate, selected)) {
            selected.push(candidate);
          }
          if (match.index === rule.regex.lastIndex) {
            rule.regex.lastIndex += 1;
          }
          match = rule.regex.exec(scanText);
        }
      }
    }
    return selected.sort((a, b) => a.start - b.start);
  }

  function redact(text: string): RedactionResult {
    const input = String(text || '');
    const matches = collectMatches(input);
    let output = '';
    let cursor = 0;
    const hits: RedactionResult['hits'] = [];
    for (const match of matches) {
      output += input.slice(cursor, match.start);
      output += applyMask(match.text, match.mask);
      hits.push({
        start: match.start,
        end: match.end,
        length: match.text.length,
        ruleId: match.ruleId
      });
      cursor = match.end;
    }
    output += input.slice(cursor);
    return { text: output, hits };
  }

  function redactCode(text: string): RedactionResult {
    const sourceText = String(text || '');
    const keywordPattern = keywordRules
      .filter(rule => rule.priority < 100)
      .map(rule => rule.regex.source)
      .join('|');
    if (!keywordPattern) {
      return redact(sourceText);
    }
    const renames = new Map<string, string>();
    let renameCount = 0;
    const identifierRenamed = sourceText.replace(new RegExp(keywordPattern, 'giu'), keyword => {
      if (!renames.has(keyword)) {
        renameCount += 1;
        renames.set(keyword, `redacted${renameCount}`);
      }
      return renames.get(keyword) as string;
    });
    return redact(identifierRenamed);
  }

  return {
    redact,
    redactCode,
    collectMatches,
    rules: allRules,
    whitelist,
    diagnostics
  };
}
