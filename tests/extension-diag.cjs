const path = require('node:path');
const { chromium } = require('C:/Users/肖勇/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
  const extensionPath = path.resolve(__dirname, '..', 'dist');
  const context = await chromium.launchPersistentContext('', {
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    args: [
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
    viewport: { width: 1200, height: 900 }
  });
  const page = await context.newPage();
  await page.goto('chrome://extensions/');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(__dirname, 'extensions-page.png'), fullPage: true });
  const text = await page.evaluate(() => {
    function walkShadowRoots(root, callback) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode()) {
        callback(walker.currentNode);
        if (walker.currentNode.shadowRoot) {
          walkShadowRoots(walker.currentNode.shadowRoot, callback);
        }
      }
    }
    const lines = [];
    walkShadowRoots(document, element => {
      const value = (element.getAttribute?.('title') || element.textContent || '').trim();
      if (value && !lines.includes(value)) {
        lines.push(value);
      }
    });
    return lines.join('\n');
  });
  console.log(text);
  await context.close();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
