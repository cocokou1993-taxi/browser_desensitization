const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { chromium } = require('C:/Users/肖勇/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
  const extensionPath = path.resolve(__dirname, '..', 'dist');
  const context = await chromium.launchPersistentContext('', {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: false,
    args: [
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
    viewport: { width: 1000, height: 720 }
  });
  context.on('console', message => console.log('CONSOLE', message.type(), message.text()));
  context.on('pageerror', error => console.log('PAGEERROR', error.stack || error.message));
  const page = await context.newPage();
  const server = http.createServer(async (_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await fs.readFile(path.join(__dirname, 'page.html')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);
  await page.waitForTimeout(2000);
  console.log('SERVICE_WORKERS', context.serviceWorkers().map(worker => worker.url()));
  console.log('BACKGROUND_PAGES', context.backgroundPages().map(page => page.url()));
  console.log('PAGE_STATE', await page.evaluate(() => ({
    localRedaction: typeof window.LocalRedaction,
    dictionary: typeof window.LOCAL_REDACTION_DICTIONARY,
    scripts: Array.from(document.scripts).map(script => script.src),
    host: Boolean(document.querySelector('[data-local-redaction-host]'))
  })));
  const dictionary = JSON.parse(fsSync.readFileSync(path.join(__dirname, '..', 'dictionary.example.json'), 'utf8'));
  const rule = dictionary.groups
    .flatMap(group => group.keywords || group.rules || [])
    .map(item => typeof item === 'string' ? { type: 'keyword', value: item } : item)
    .find(item => item.type === 'keyword');
  if (!rule) {
    throw new Error('dictionary has no keyword rule');
  }
  const inputText = `${rule.value}测试`;
  await page.fill('#search', inputText);
  await page.click('#search');

  const host = page.locator('[data-local-redaction-host]');
  await host.waitFor({ state: 'attached' });
  const status = page.locator('[data-local-redaction-host] .status');
  const replaceButton = page.locator('[data-local-redaction-host] button', { hasText: '脱敏替换' });
  await replaceButton.click();
  const value = await page.inputValue('#search');
  const statusText = await status.textContent();
  const debug = await host.getAttribute('data-local-redaction-debug');
  console.log(JSON.stringify({ rule: rule.value, inputText, value, statusText, debug }));
  await page.screenshot({ path: path.join(__dirname, 'browser-repro.png') });
  await context.close();
  await new Promise(resolve => server.close(resolve));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
