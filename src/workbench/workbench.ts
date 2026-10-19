import { DEFAULT_DICTIONARY } from '../core/dictionary.ts';
import { parseDictionaryConfig } from '../core/config.ts';
import { createEngine } from '../core/redaction.ts';
import { redactDocx, redactXlsx, toArrayBuffer } from '../core/office.ts';
import type { DictionaryConfig, RedactionEngine } from '../core/types.ts';

const input = document.getElementById('input') as HTMLTextAreaElement;
const output = document.getElementById('output') as HTMLOutputElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const fileResults = document.getElementById('file-results') as HTMLUListElement;
const fileInput = document.getElementById('file') as HTMLInputElement;
const dropzone = document.getElementById('dropzone') as HTMLDivElement;
const copyButton = document.getElementById('copy') as HTMLButtonElement;
const downloadButton = document.getElementById('download') as HTMLButtonElement;
const dictionaryInput = document.getElementById('dictionary') as HTMLInputElement;

let engine: RedactionEngine = createEngine(DEFAULT_DICTIONARY);
let lastResult = '';

interface StoredState {
  dictionary?: DictionaryConfig | null;
  dictionarySource?: string;
}

function showMessage(message: string): void {
  status.textContent = message;
}

async function loadDictionary(): Promise<void> {
  const stored = await chrome.storage.local.get({
    dictionary: null,
    dictionarySource: ''
  }) as StoredState;
  const dictionary = stored.dictionary && stored.dictionarySource ? stored.dictionary : null;
  engine = createEngine(dictionary || DEFAULT_DICTIONARY);
}

input.addEventListener('input', () => {
  copyButton.disabled = false;
  downloadButton.disabled = false;
});

document.getElementById('redact')?.addEventListener('click', () => {
  const result = engine.redact(input.value);
  output.textContent = result.text;
  lastResult = result.text;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  showMessage(`本地处理完成，命中 ${result.hits.length} 处`);
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(lastResult || output.textContent || '');
  showMessage('结果已复制到剪贴板');
});

downloadButton.addEventListener('click', () => {
  const blob = new Blob([lastResult || output.textContent || ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'redacted.txt';
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
  showMessage('结果已另存');
});

function extension(name: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(name.toLowerCase())?.[1] || '';
}

function redactedName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? `${name}.redacted` : `${name.slice(0, dot)}.redacted${name.slice(dot)}`;
}

async function decodeText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('gbk').decode(data);
  }
}

async function redactFile(file: File): Promise<File> {
  const type = extension(file.name);
  let blob: Blob;
  if (type === 'docx') {
    const outputBytes = await redactDocx(new Uint8Array(await file.arrayBuffer()), engine);
    blob = new Blob([toArrayBuffer(outputBytes)], { type: file.type || 'application/octet-stream' });
  } else if (type === 'xlsx') {
    const outputBytes = await redactXlsx(new Uint8Array(await file.arrayBuffer()), engine);
    blob = new Blob([toArrayBuffer(outputBytes)], { type: file.type || 'application/octet-stream' });
  } else if (['md', 'txt', 'csv', 'xml', 'yml', 'yaml', 'sql', 'js', 'ts', 'py', 'java', 'go'].includes(type)) {
    const text = await decodeText(file);
    const result = ['js', 'ts', 'py', 'java', 'go'].includes(type)
      ? engine.redactCode(text)
      : engine.redact(text);
    blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
  } else {
    throw new Error('不支持此格式');
  }
  return new File([blob], redactedName(file.name), { type: blob.type });
}

function addResult(file: File): void {
  const item = document.createElement('li');
  const name = document.createElement('strong');
  const detail = document.createElement('small');
  const download = document.createElement('button');
  download.type = 'button';
  download.textContent = '下载';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.rel = 'noopener';
    anchor.click();
    URL.revokeObjectURL(url);
  });
  name.textContent = file.name;
  detail.textContent = `${(file.size / 1024).toFixed(1)} KB`;
  item.append(name, download, detail);
  fileResults.prepend(item);
}

async function handleFiles(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      addResult(await redactFile(file));
    } catch (error) {
      const item = document.createElement('li');
      item.textContent = `${file.name}：${error instanceof Error ? error.message : '处理失败'}`;
      fileResults.prepend(item);
    }
  }
}

fileInput.addEventListener('change', () => {
  void handleFiles(Array.from(fileInput.files || []));
});
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.add('is-active');
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, () => dropzone.classList.remove('is-active')));
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  void handleFiles(Array.from(event.dataTransfer?.files || []));
});

document.getElementById('import')?.addEventListener('click', () => dictionaryInput.click());

document.getElementById('reset')?.addEventListener('click', async () => {
  await chrome.storage.local.remove(['dictionary', 'dictionarySource']);
  await loadDictionary();
  showMessage('已恢复内置词库');
});

dictionaryInput.addEventListener('change', async () => {
  const file = dictionaryInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    const config = parseDictionaryConfig(JSON.parse(await file.text()));
    await chrome.storage.local.set({ dictionary: config, dictionarySource: 'manual' });
    await loadDictionary();
    showMessage('词库已导入');
  } catch (error) {
    showMessage(error instanceof Error ? error.message : '词库导入失败');
  } finally {
    dictionaryInput.value = '';
  }
});

document.getElementById('export')?.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get({ dictionary: null }) as StoredState;
  const config = stored.dictionary || DEFAULT_DICTIONARY;
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'local-redaction-dictionary.json';
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
  showMessage('词库已导出');
});

void loadDictionary();
