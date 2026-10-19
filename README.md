# 本地敏感词脱敏助手

这是一个 Chrome 浏览器插件（Manifest V3）。所有敏感词匹配、文本替换、`docx` / `xlsx` 解析和副本生成都只在浏览器本地执行；插件不调用大模型，不请求云端服务，也不上传文本或文件。

## 安装

1. 在项目目录运行 `npm install`。
2. 运行 `npm run build`。
3. 打开 Chrome，进入 `chrome://extensions`。
4. 打开右上角「开发者模式」。
5. 选择「加载已解压的扩展程序」，加载项目中的 `dist` 目录。

TypeScript 源码位于 `src/`，Chrome 只加载编译后的 `dist/`。

## 功能

- 网页输入框聚焦后可使用「脱敏复制」和「脱敏替换」。
- 拦截文件选择和拖拽上传，确认后生成并使用 `*.redacted.*` 脱敏副本。
- 「本地脱敏工作台」支持粘贴文本、处理文件、复制和下载结果。
- 词库使用 JSON，在弹窗或工作台手动导入导出；`src/core/dictionary.ts` 是内置默认词库。
- 修改 `dictionary.example.json` 后运行 `npm run sync-dictionary`，再运行 `npm run build`。
- 如果导入过旧词库，可在弹窗或工作台点击「内置词库 / 内置」恢复当前内置词库。
- 总开关关闭后不显示页面控件，也不处理输入或文件。

## 词库格式

`dictionary.example.json` 使用紧凑格式。公共的 `type` 和 `mask` 只写一次，分组中的关键词直接使用字符串：

```json
{
  "schema": "compact-v1",
  "defaults": {
    "type": "keyword",
    "mask": "char"
  },
  "groups": [
    {
      "id": "political-official",
      "name": "政治与机构用语",
      "priority": 100,
      "keywords": ["示例词一", "示例词二"]
    },
    {
      "id": "business-compliance",
      "name": "业务合规词库",
      "priority": 20,
      "mask": "star3",
      "keywords": ["示例公司"]
    }
  ],
  "whitelist": [],
  "customKeywords": []
}
```

解析器会自动展开分组默认值、删除组内重复关键词，并继续兼容旧版 `rules` 数组格式。

## 开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

一次性执行全部检查：

```bash
npm run check
```
