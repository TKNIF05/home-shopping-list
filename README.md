# 购物清单

独立的静态购物网页。支持待购商品、商店规则、购物行程、JSON 预览导入、待购清单导出、完整备份与恢复。购物数据保存在当前浏览器的 IndexedDB。

## 本地使用

在本项目目录运行以下命令，然后打开终端打印的地址。开发环境使用 Node.js 22 或更新版本。

```sh
npm run dev
```

[架构审查与实施计划](docs/architecture.md)  
[Import Contract v1 JSON Schema](docs/shopping-import.schema.json)  
[跨浏览器验收](tests/acceptance.md)

## 示例购物 JSON

```json
{
  "format": "shopping-import",
  "version": 1,
  "items": [
    {
      "name": "醋",
      "quantity": null,
      "note": "下次去大华买",
      "optional": false,
      "storePolicy": { "mode": "required", "storeIds": ["99ranch"] }
    }
  ]
}
```

## 校验

```sh
npm test
npm run test:browser
npm run build
```

浏览器命令启动临时 Chromium 配置，测试桌面与触屏窄屏视口。若 Chrome 或 Chromium 位于其他位置，可用 `CHROME_PATH` 指向可执行文件。打包产物在 `dist/`。

## GitHub Pages

把本目录作为独立 GitHub 仓库的根目录。在该仓库的 **Settings → Pages** 将发布来源设为 **GitHub Actions**，然后运行 **Publish shopping list to GitHub Pages** 工作流。工作流只上传构建目录，页面资源使用相对路径。首次发布后，从 Actions 的发布任务打开站点地址。
