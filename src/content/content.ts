import { DEFAULT_DICTIONARY } from '../core/dictionary.ts';
import { createEngine } from '../core/redaction.ts';
import { redactDocx, redactXlsx, toArrayBuffer } from '../core/office.ts';
import type { DictionaryConfig, RedactionEngine } from '../core/types.ts';

interface UiElements {
  host: HTMLDivElement | null;
  root: ShadowRoot | null;
  toolbar: HTMLDivElement | null;
  status: HTMLSpanElement | null;
  modal: HTMLDivElement | null;
}

interface FileEntry {
  original: File;
  redacted: File | null;
  error?: unknown;
}

interface StoredState {
  enabled?: boolean;
  dictionary?: DictionaryConfig | null;
  dictionarySource?: string;
}

const ui: UiElements = {
  host: null,
  root: null,
  toolbar: null,
  status: null,
  modal: null
};

const targets = new Map<string, HTMLElement>();
const TEXT_EXTENSIONS = new Set(['md', 'txt', 'csv', 'xml', 'yml', 'yaml', 'sql']);
const CODE_EXTENSIONS = new Set(['js', 'ts', 'py', 'java', 'go']);
const MIME_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  xml: 'text/xml',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  sql: 'text/sql',
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
  java: 'text/x-java-source',
  go: 'text/x-go',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

let enabled = true;
let engine: RedactionEngine = createEngine(DEFAULT_DICTIONARY);
let engineSource = 'builtin';
let hideTimer = 0;
let lastEditableTarget: HTMLElement | null = null;
let modalEntries: FileEntry[] = [];

async function loadState(): Promise<void> {
  const stored = await chrome.storage.local.get({
    enabled: true,
    dictionary: null,
    dictionarySource: ''
  }) as StoredState;
  let dictionary = stored.dictionary || null;
  if (dictionary && !stored.dictionarySource) {
    await chrome.storage.local.remove('dictionary');
    dictionary = null;
  }
  enabled = Boolean(stored.enabled);
  engineSource = dictionary ? stored.dictionarySource || 'manual' : 'builtin';
  engine = createEngine(dictionary || DEFAULT_DICTIONARY);
  updateDebug();
  if (!enabled) {
    hideToolbar();
    closeModal();
  }
}

chrome.storage.onChanged.addListener(() => {
  void loadState();
});
void loadState();

function updateDebug(): void {
  if (!ui.host) {
    return;
  }
  ui.host.dataset.localRedactionDebug = JSON.stringify({
    enabled,
    source: engineSource,
    dictionaryState: engine.diagnostics.dictionary,
    rules: engine.rules.map(rule => ({
      id: rule.ruleId,
      type: rule.type
    })),
    politicalCount: engine.rules.filter(rule => rule.ruleId.startsWith('political-')).length
  });
}

function ensureRoot(): ShadowRoot {
  if (ui.root) {
    return ui.root;
  }
  ui.host = document.createElement('div');
  ui.host.dataset.localRedactionHost = 'true';
  ui.root = ui.host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font-family: system-ui, sans-serif; }
    .toolbar {
      position: fixed; z-index: 2147483647; display: none; gap: 6px;
      max-width: calc(100vw - 16px);
      padding: 6px; border: 1px solid #d0d7de; border-radius: 6px;
      background: #fff; color: #1f2328; box-shadow: 0 4px 16px rgba(0,0,0,.14);
    }
    button {
      min-width: 78px; height: 30px; padding: 0 10px; border: 1px solid #d0d7de;
      border-radius: 4px; background: #f6f8fa; color: #1f2328; font-size: 12px; cursor: pointer;
    }
    button:hover { background: #eef1f4; }
    button.primary { background: #0f5c46; border-color: #0f5c46; color: #fff; }
    button.danger { background: #fff; border-color: #cf222e; color: #cf222e; }
    .status { align-self: center; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #57606a; }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483647; display: none;
      align-items: center; justify-content: center; padding: 20px; background: rgba(20,24,28,.45);
    }
    .dialog { width: min(560px, 100%); padding: 18px; border-radius: 6px; background: #fff; color: #1f2328; box-shadow: 0 12px 40px rgba(0,0,0,.24); }
    h2 { margin: 0 0 6px; font-size: 17px; font-weight: 650; letter-spacing: 0; }
    p { margin: 0 0 12px; font-size: 13px; color: #57606a; }
    .files { max-height: 180px; overflow: auto; margin: 0 0 14px; padding: 0; list-style: none; border: 1px solid #d0d7de; border-radius: 4px; }
    li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; font-size: 12px; }
    li + li { border-top: 1px solid #eaeef2; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .notice { color: #9a6700; }
  `;
  ui.root.append(style);
  document.documentElement.append(ui.host);
  buildToolbar();
  buildModal();
  updateDebug();
  return ui.root;
}

function buildToolbar(): void {
  if (!ui.root) {
    return;
  }
  ui.toolbar = document.createElement('div');
  ui.toolbar.className = 'toolbar';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '脱敏复制';
  copy.dataset.action = 'copy';
  const replace = document.createElement('button');
  replace.type = 'button';
  replace.textContent = '脱敏替换';
  replace.dataset.action = 'replace';
  ui.status = document.createElement('span');
  ui.status.className = 'status';
  ui.toolbar.append(copy, replace, ui.status);
  ui.toolbar.addEventListener('mousedown', event => event.preventDefault());
  ui.toolbar.addEventListener('click', handleToolbarClick);
  ui.root.append(ui.toolbar);
}

function buildModal(): void {
  if (!ui.root) {
    return;
  }
  ui.modal = document.createElement('div');
  ui.modal.className = 'backdrop';
  ui.modal.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true" aria-label="上传前本地脱敏">
      <h2>上传前本地脱敏</h2>
      <p>文件仅在浏览器内解析，不会上传。请选择使用脱敏副本或取消。</p>
      <ul class="files"></ul>
      <p class="notice"></p>
      <div class="actions">
        <button type="button" class="danger" data-action="cancel">取消</button>
        <button type="button" data-action="download">下载脱敏副本</button>
        <button type="button" class="primary" data-action="upload">使用脱敏副本上传</button>
      </div>
    </div>
  `;
  ui.modal.addEventListener('click', handleModalClick);
  ui.root.append(ui.modal);
}

function isEditable(element: Element | null): element is HTMLElement {
  if (!element) {
    return false;
  }
  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    return true;
  }
  if (element instanceof HTMLInputElement) {
    return ['text', 'search', 'email', 'url', 'password', 'number'].includes(element.type);
  }
  return false;
}

function selectedRange(element: HTMLElement): { start: number; end: number } | Range | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart || 0;
    const end = element.selectionEnd || 0;
    return start === end ? null : { start, end };
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  return selection.getRangeAt(0);
}

function elementValue(element: HTMLElement): string {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }
  return element.innerText || element.textContent || '';
}

function setElementValue(element: HTMLElement, value: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  element.textContent = value;
  element.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function getTextForAction(element: HTMLElement): string {
  const range = selectedRange(element);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (range && !(range instanceof Range)) {
      return element.value.slice(range.start, range.end);
    }
    return element.value;
  }
  if (range instanceof Range) {
    return range.toString();
  }
  return elementValue(element);
}

function replaceElementSelection(element: HTMLElement, value: string): void {
  const range = selectedRange(element);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = range && !(range instanceof Range) ? range.start : 0;
    const end = range && !(range instanceof Range) ? range.end : element.value.length;
    const next = element.value.slice(0, start) + value + element.value.slice(end);
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, next);
    element.setSelectionRange(start + value.length, start + value.length);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (range instanceof Range) {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!document.execCommand('insertText', false, value)) {
      range.deleteContents();
      range.insertNode(document.createTextNode(value));
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    return;
  }
  setElementValue(element, value);
}

function setStatus(text: string): void {
  if (!ui.status) {
    return;
  }
  ui.status.textContent = text;
  if (text) {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (ui.status) {
        ui.status.textContent = '';
      }
    }, 2600);
  }
}

async function handleToolbarClick(event: MouseEvent): Promise<void> {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) {
    return;
  }
  const button = eventTarget.closest<HTMLButtonElement>('button[data-action]');
  const element = getTarget(ui.toolbar?.dataset.targetId);
  if (!button || !element) {
    return;
  }
  const result = engine.redact(getTextForAction(element));
  if (button.dataset.action === 'copy') {
    await navigator.clipboard.writeText(result.text);
    setStatus(`已复制 ${result.hits.length} 处脱敏`);
    return;
  }
  replaceElementSelection(element, result.text);
  setStatus(result.hits.length
    ? `已替换 ${result.hits.length} 处`
    : '未命中规则，请导入包含该词的词库');
}

function showToolbar(element: Element): void {
  if (!enabled || !isEditable(element)) {
    hideToolbar();
    return;
  }
  const targetId = registerTarget(element);
  ensureRoot();
  if (!ui.toolbar) {
    return;
  }
  ui.toolbar.dataset.targetId = targetId;
  const rect = element.getBoundingClientRect();
  const margin = 6;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  ui.toolbar.style.visibility = 'hidden';
  ui.toolbar.style.display = 'grid';
  ui.toolbar.style.gridAutoFlow = 'column';
  ui.toolbar.style.alignItems = 'center';
  const toolbarHeight = ui.toolbar.offsetHeight;
  const toolbarWidth = ui.toolbar.offsetWidth;
  const spaceAbove = rect.top - margin;
  const spaceBelow = viewportHeight - rect.bottom - margin;
  const placeBelow = spaceAbove < toolbarHeight && spaceBelow >= toolbarHeight;
  const top = placeBelow ? rect.bottom + margin : Math.max(8, rect.top - toolbarHeight - margin);
  const left = Math.max(8, Math.min(rect.left, viewportWidth - toolbarWidth - 8));
  ui.toolbar.style.top = `${top}px`;
  ui.toolbar.style.left = `${left}px`;
  ui.toolbar.style.visibility = 'visible';
}

function hideToolbar(): void {
  if (ui.toolbar) {
    ui.toolbar.style.display = 'none';
    delete ui.toolbar.dataset.targetId;
  }
}

function registerTarget(target: HTMLElement): string {
  const targetId = `target-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  targets.set(targetId, target);
  return targetId;
}

function getTarget(targetId?: string): HTMLElement | undefined {
  return targetId ? targets.get(targetId) : undefined;
}

function fileExtension(name: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(name.toLowerCase())?.[1] || '';
}

function redactedName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? `${name}.redacted` : `${name.slice(0, dot)}.redacted${name.slice(dot)}`;
}

async function decodeTextFile(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('gbk').decode(data);
  }
}

async function redactFile(file: File): Promise<Blob> {
  const extension = fileExtension(file.name);
  if (extension === 'docx') {
    const output = await redactDocx(new Uint8Array(await file.arrayBuffer()), engine);
    return new Blob([toArrayBuffer(output)], { type: MIME_TYPES.docx });
  }
  if (extension === 'xlsx') {
    const output = await redactXlsx(new Uint8Array(await file.arrayBuffer()), engine);
    return new Blob([toArrayBuffer(output)], { type: MIME_TYPES.xlsx });
  }
  if (TEXT_EXTENSIONS.has(extension) || CODE_EXTENSIONS.has(extension)) {
    const input = await decodeTextFile(file);
    const result = CODE_EXTENSIONS.has(extension) ? engine.redactCode(input) : engine.redact(input);
    return new Blob([result.text], {
      type: `${MIME_TYPES[extension] || 'text/plain'};charset=utf-8`
    });
  }
  throw new Error(`暂不支持 ${file.name}`);
}

function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function showModal(files: File[], targetId: string, mode: 'change' | 'drop'): Promise<void> {
  ensureRoot();
  if (!ui.modal) {
    return;
  }
  ui.modal.dataset.targetId = targetId;
  ui.modal.dataset.mode = mode;
  ui.modal.dataset.active = 'true';
  const list = ui.modal.querySelector<HTMLUListElement>('.files');
  const notice = ui.modal.querySelector<HTMLParagraphElement>('.notice');
  if (!list || !notice) {
    return;
  }
  list.replaceChildren();
  notice.textContent = '正在本地解析文件...';
  ui.modal.style.display = 'flex';
  modalEntries = [];
  for (const file of files) {
    try {
      const blob = await redactFile(file);
      const redacted = new File([blob], redactedName(file.name), { type: blob.type });
      modalEntries.push({ original: file, redacted });
      const item = document.createElement('li');
      item.innerHTML = `<span>${redacted.name}</span><span>${formatSize(redacted.size)}</span>`;
      list.append(item);
    } catch (error) {
      modalEntries.push({ original: file, redacted: null, error });
      const item = document.createElement('li');
      item.textContent = `${file.name}：${error instanceof Error ? error.message : '处理失败'}`;
      list.append(item);
    }
  }
  notice.textContent = modalEntries.some(entry => !entry.redacted)
    ? '部分文件无法本地脱敏，不会替换上传内容。'
    : '脱敏副本已生成。';
  const upload = ui.modal.querySelector<HTMLButtonElement>('[data-action="upload"]');
  if (upload) {
    upload.disabled = modalEntries.some(entry => !entry.redacted);
  }
}

function closeModal(): void {
  if (ui.modal) {
    ui.modal.style.display = 'none';
    ui.modal.dataset.active = '';
  }
  modalEntries = [];
}

async function handleModalClick(event: MouseEvent): Promise<void> {
  const eventTarget = event.target;
  if (!(eventTarget instanceof Element)) {
    return;
  }
  const action = eventTarget.closest<HTMLButtonElement>('button[data-action]')?.dataset.action;
  if (!action || !ui.modal) {
    return;
  }
  const target = getTarget(ui.modal.dataset.targetId);
  if (action === 'cancel') {
    closeModal();
    return;
  }
  if (action === 'download') {
    for (const entry of modalEntries) {
      if (!entry.redacted) {
        continue;
      }
      const url = URL.createObjectURL(entry.redacted);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = entry.redacted.name;
      anchor.rel = 'noopener';
      anchor.click();
      URL.revokeObjectURL(url);
    }
    closeModal();
    return;
  }
  if (action === 'upload') {
    const usable = modalEntries.flatMap(entry => entry.redacted ? [entry.redacted] : []);
    if (!usable.length || !target) {
      closeModal();
      return;
    }
    const transfer = new DataTransfer();
    usable.forEach(file => transfer.items.add(file));
    target.dataset.localRedactionDispatch = 'true';
    try {
      if (target instanceof HTMLInputElement && target.type === 'file') {
        target.files = transfer.files;
        target.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        target.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        }));
      }
    } finally {
      delete target.dataset.localRedactionDispatch;
    }
    closeModal();
  }
}

document.addEventListener('focusin', event => {
  if (ui.host && event.composedPath().includes(ui.host)) {
    return;
  }
  if (event.target instanceof Element && isEditable(event.target)) {
    lastEditableTarget = event.target;
  }
  if (event.target instanceof Element) {
    showToolbar(event.target);
  }
});

document.addEventListener('focusout', () => {
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!ui.toolbar?.matches(':focus-within')) {
      hideToolbar();
    }
  }, 120);
});

window.addEventListener('scroll', () => hideToolbar(), { passive: true, capture: true });
window.addEventListener('resize', () => hideToolbar());

window.addEventListener('change', event => {
  const input = event.target;
  if (!enabled || !(input instanceof HTMLInputElement) || input.type !== 'file') {
    return;
  }
  if (input.dataset.localRedactionDispatch === 'true' || !input.files?.length) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  const files = Array.from(input.files);
  input.value = '';
  showModal(files, registerTarget(input), 'change');
}, true);

window.addEventListener('drop', event => {
  const target = event.target instanceof HTMLElement ? event.target : document.body;
  if (!enabled || target.dataset.localRedactionDispatch === 'true') {
    return;
  }
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  showModal(files, registerTarget(target), 'drop');
}, true);

chrome.runtime.onMessage.addListener((
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => {
  if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'LOCAL_REDACTION_ACTION') {
    return;
  }
  const action = 'action' in message ? String(message.action) : '';
  const active = document.activeElement instanceof HTMLElement && isEditable(document.activeElement)
    ? document.activeElement
    : lastEditableTarget;
  if (!enabled || !active) {
    sendResponse({ ok: false, reason: '未找到输入框，或插件已关闭' });
    return;
  }
  const result = engine.redact(elementValue(active));
  if (action === 'copy') {
    navigator.clipboard.writeText(result.text).then(
      () => sendResponse({ ok: true, hits: result.hits.length, text: result.text }),
      () => sendResponse({ ok: false, reason: '剪贴板访问被拒绝' })
    );
    return true;
  }
  if (action === 'replace') {
    setElementValue(active, result.text);
    sendResponse({ ok: true, hits: result.hits.length, text: result.text });
    return;
  }
  sendResponse({ ok: false, reason: '未知动作' });
});
