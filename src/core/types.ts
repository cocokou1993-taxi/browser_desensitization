export type RuleType = 'keyword' | 'regex';

export type MaskType =
  | 'phone'
  | 'idcard'
  | 'email'
  | 'char'
  | 'star3'
  | 'apikey';

export interface RedactionRule {
  type: RuleType;
  value: string;
  mask: MaskType;
}

export interface RuleGroup {
  id: string;
  name: string;
  priority: number;
  builtin?: boolean;
  rules: RedactionRule[];
}

export interface DictionaryConfig {
  version: string;
  updatedAt: string;
  groups: RuleGroup[];
  whitelist: string[];
  customKeywords: RedactionRule[];
}

export interface RuleDefaults {
  type?: RuleType;
  mask?: MaskType;
}

export interface CompactRuleGroup extends RuleDefaults {
  id: string;
  name: string;
  priority: number;
  builtin?: boolean;
  keywords?: Array<string | RedactionRule>;
  rules?: Array<string | RedactionRule>;
}

export interface CompactDictionaryConfig {
  schema?: 'compact-v1' | string;
  version?: string;
  updatedAt?: string;
  defaults?: RuleDefaults;
  groups: CompactRuleGroup[];
  whitelist?: unknown[];
  customKeywords?: Array<string | RedactionRule>;
}

export interface CompiledRule {
  ruleId: string;
  group?: string;
  priority: number;
  builtin: boolean;
  type: RuleType;
  mask: MaskType;
  source: string;
  regex: RegExp;
}

export interface MatchCandidate {
  start: number;
  end: number;
  text: string;
  priority: number;
  ruleId: string;
  mask: MaskType;
}

export interface RedactionHit {
  start: number;
  end: number;
  length: number;
  ruleId: string;
}

export interface RedactionResult {
  text: string;
  hits: RedactionHit[];
}

export interface RedactionDiagnostics {
  dictionary?: string;
}

export interface RedactionEngine {
  redact(text: string): RedactionResult;
  redactCode(text: string): RedactionResult;
  collectMatches(text: string): MatchCandidate[];
  rules: CompiledRule[];
  whitelist: Set<string>;
  diagnostics: RedactionDiagnostics;
}
