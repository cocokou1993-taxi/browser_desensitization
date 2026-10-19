import type {
  DictionaryConfig,
  MaskType,
  RedactionRule,
  RuleDefaults,
  RuleGroup,
  RuleType
} from './types.ts';

const RULE_TYPES = new Set<RuleType>(['keyword', 'regex']);
const MASK_TYPES = new Set<MaskType>(['phone', 'idcard', 'email', 'char', 'star3', 'apikey']);
const DEFAULT_RULE: Required<RuleDefaults> = {
  type: 'keyword',
  mask: 'char'
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDefaults(value: unknown): RuleDefaults {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error('词库 defaults 格式错误');
  }
  const result: RuleDefaults = {};
  if (value.type !== undefined) {
    if (!RULE_TYPES.has(value.type as RuleType)) {
      throw new Error('词库默认 type 无效');
    }
    result.type = value.type as RuleType;
  }
  if (value.mask !== undefined) {
    if (!MASK_TYPES.has(value.mask as MaskType)) {
      throw new Error('词库默认 mask 无效');
    }
    result.mask = value.mask as MaskType;
  }
  return result;
}

function parseRule(value: unknown, defaults: Required<RuleDefaults>): RedactionRule {
  if (typeof value === 'string') {
    if (!value) {
      throw new Error('词库关键词不能为空');
    }
    return {
      type: defaults.type,
      value,
      mask: defaults.mask
    };
  }
  if (!isRecord(value)) {
    throw new Error('词库规则格式错误');
  }
  const type = (value.type ?? defaults.type) as RuleType;
  const mask = (value.mask ?? defaults.mask) as MaskType;
  if (!RULE_TYPES.has(type)) {
    throw new Error('词库规则 type 无效');
  }
  if (!MASK_TYPES.has(mask)) {
    throw new Error('词库规则 mask 无效');
  }
  if (typeof value.value !== 'string' || !value.value) {
    throw new Error('词库规则 value 不能为空');
  }
  return {
    type,
    value: value.value,
    mask
  };
}

function dedupeRules(rules: RedactionRule[]): RedactionRule[] {
  const seen = new Set<string>();
  return rules.filter(rule => {
    const signature = `${rule.type}:${rule.value}`;
    if (seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
}

function parseGroup(value: unknown, defaults: Required<RuleDefaults>): RuleGroup {
  if (!isRecord(value)) {
    throw new Error('词库分组格式错误');
  }
  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('词库分组名称或 ID 无效');
  }
  const groupDefaults = parseDefaults({
    type: value.type ?? defaults.type,
    mask: value.mask ?? defaults.mask
  });
  const ruleDefaults: Required<RuleDefaults> = {
    type: groupDefaults.type ?? defaults.type,
    mask: groupDefaults.mask ?? defaults.mask
  };
  const rawRules = [
    ...(Array.isArray(value.rules) ? value.rules : []),
    ...(Array.isArray(value.keywords) ? value.keywords : [])
  ];
  if (!rawRules.length) {
    throw new Error(`词库分组 ${value.id} 没有关键词或规则`);
  }
  return {
    id: value.id,
    name: value.name,
    priority: Number(value.priority || 0),
    builtin: Boolean(value.builtin),
    rules: dedupeRules(rawRules.map(rule => parseRule(rule, ruleDefaults)))
  };
}

export function parseDictionaryConfig(value: unknown): DictionaryConfig {
  if (!isRecord(value)) {
    throw new Error('词库必须是 JSON 对象');
  }
  if (!Array.isArray(value.groups)) {
    throw new Error('词库缺少 groups 数组');
  }
  const defaults = parseDefaults(value.defaults);
  const resolvedDefaults: Required<RuleDefaults> = {
    type: defaults.type ?? DEFAULT_RULE.type,
    mask: defaults.mask ?? DEFAULT_RULE.mask
  };
  const customDefaults: Required<RuleDefaults> = {
    type: defaults.type ?? DEFAULT_RULE.type,
    mask: defaults.mask ?? 'star3'
  };
  return {
    version: typeof value.version === 'string' ? value.version : '1.0.0',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    groups: value.groups.map(group => parseGroup(group, resolvedDefaults)),
    whitelist: Array.isArray(value.whitelist) ? value.whitelist.map(item => String(item)) : [],
    customKeywords: Array.isArray(value.customKeywords)
      ? dedupeRules(value.customKeywords.map(rule => parseRule(rule, customDefaults)))
      : []
  };
}
