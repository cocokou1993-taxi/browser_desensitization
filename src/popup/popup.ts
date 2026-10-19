import { DEFAULT_DICTIONARY } from '../core/dictionary.ts';
import { parseDictionaryConfig } from '../core/config.ts';
import type { DictionaryConfig } from '../core/types.ts';

const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const statusText = document.getElementById('status') as HTMLParagraphElement;
const summary = document.getElementById('summary') as HTMLParagraphElement;
const dictionaryInput = document.getElementById('dictionary') as HTMLInputElement;

interface StoredState {
  enabled?: boolean;
  dictionary?: DictionaryConfig | null;
  dictionarySource?: string;
}

function showStatus(message: string): void {
  statusText.textContent = message;
}

async function loadState(): Promise<void> {
  const stored = await chrome.storage.local.get({
    enabled: true,
    dictionary: null,
    dictionarySource: ''
  }) as StoredState;
  const dictionary = stored.dictionary && stored.dictionarySource ? stored.dictionary : null;
  enabledInput.checked = Boolean(stored.enabled);
  const config = dictionary || DEFAULT_DICTIONARY;
  const keywordCount = config.customKeywords.length;
  summary.textContent = `${config.groups.length} 个词组 · ${keywordCount} 个自定义词 · 手动导入导出`;
}

enabledInput.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabledInput.checked });
  showStatus(enabledInput.checked ? '已开启本地脱敏' : '已关闭页面处理');
});

document.getElementById('workbench')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

async function sendAction(action: 'copy' | 'replace'): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showStatus('未找到当前页面');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'LOCAL_REDACTION_ACTION', action }, async response => {
    if (chrome.runtime.lastError) {
      showStatus('页面未注入，请刷新后重试');
      return;
    }
    if (!response?.ok) {
      showStatus(response?.reason || '处理失败');
      return;
    }
    if (action === 'copy') {
      await navigator.clipboard.writeText(response.text);
      showStatus(`已复制 ${response.hits} 处脱敏结果`);
      return;
    }
    showStatus(`已替换 ${response.hits} 处`);
  });
}

document.getElementById('copy')?.addEventListener('click', () => {
  void sendAction('copy');
});
document.getElementById('replace')?.addEventListener('click', () => {
  void sendAction('replace');
});

document.getElementById('import')?.addEventListener('click', () => dictionaryInput.click());

document.getElementById('reset')?.addEventListener('click', async () => {
  await chrome.storage.local.remove(['dictionary', 'dictionarySource']);
  await loadState();
  showStatus('已恢复内置词库');
});

dictionaryInput.addEventListener('change', async () => {
  const file = dictionaryInput.files?.[0];
  if (!file) {
    return;
  }
  try {
    const config = parseDictionaryConfig(JSON.parse(await file.text()));
    await chrome.storage.local.set({ dictionary: config, dictionarySource: 'manual' });
    await loadState();
    showStatus('词库已导入');
  } catch (error) {
    showStatus(error instanceof Error ? error.message : '词库导入失败');
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
  showStatus('词库已导出');
});

void loadState();
