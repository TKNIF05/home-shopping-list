# 购物模块维护与菜谱接入

2026-11-07 审查并接入菜谱 v11。购物数据库和 shopping-import 协议继续使用版本 1。

## 本轮修复

- 编辑、取消、勾选和商店修改携带当前数据快照令牌，恢复或其他窗口写入后，旧编辑会被拒绝。
- 购物恢复在同一 IndexedDB 事务里保存恢复前快照。可在「导入与备份」下载上次恢复前的购物备份。
- 菜谱来源按 recipeId:ingredientId 追踪，用餐次记录 ID、材料/调料类型、稳定行 ID 组成 externalRef。相同来源已购买或已取消时，再次发送会提示，改名后也能识别。
- 单位文本上限统一为 40 字符，兼容菜谱原始家庭单位。
- 页头使用肉、青菜、菠萝，浅色配色及行程按钮对齐已交付。

## 修改定位

| 需要改什么 | 修改位置 |
| --- | --- |
| 颜色、字号、按钮、手机布局 | style.css |
| 标题和装饰 | index.html |
| 购物状态、商店匹配、合并条件 | src/domain/rules.js |
| CRUD、导入提交、恢复保护 | src/application/shopping.js |
| 数据库结构、升级、事务、恢复前记录 | src/storage/indexed-db.js |
| JSON 运行时校验、指纹、疑似重复 | src/import-export/contract.js |
| 完整备份、恢复引用及状态校验 | src/import-export/backup.js |
| 对外类型与交换 Schema | src/domain/model.d.ts、docs/shopping-import.schema.json |
| 接收菜谱转入资料 | src/adapters/recipe-inbox.js |
| 页面状态与启动 | src/ui/main.js |
| 商品和商店表单 | src/ui/forms.js |
| 行程、待购和历史 | src/ui/shopping.js |
| 导入预览和备份界面 | src/ui/exchange.js |
| 后续截图和示例 JSON | docs/ui-screenshot-rules.json |

## 菜谱接入边界

菜谱通过自身 shopping-adapter.js 输出 shopping-import v1，写入当前标签页 sessionStorage 后导航到同包 shopping/?from=recipe。购物模块先显示可修改的预览，确认后才写入。完成导入后清理暂存内容，刷新或重复发送由导入指纹继续保护。

菜谱主程序的 shopping/ 是构建产物，由 tools/prepare-shopping.mjs 从本购物项目复制运行文件。修改本购物项目后重新运行菜谱打包工具，生成的新包包含对应模块。

正式两个站点均位于 tknif05.github.io，同一浏览器中共用 home-shopping-list-v1 数据库。每台设备仍保存自己的购物资料。菜谱和购物使用各自的备份入口，菜谱库恢复或文件合并只处理菜谱资料；购物恢复在购物页面操作。

本轮继续采用每条菜单材料独立的来源需求，单位按原文保留。菜单变更后重新发送走预览和明确选择，已导入需求保持原快照。

## 验证和发布

本目录运行 npm.cmd test 与 npm.cmd run test:browser。菜谱工作区内还可运行 node tests/run-chrome.mjs --recipe 及 --upgrade，分别覆盖整合流程与正式 v10 升级。后两项需要相邻菜谱源码及 v10 基线包。

独立站点从本项目构建 dist。菜谱站点通过自身运行文件白名单打包 site.zip。发布前核对目标仓库、当前远端与实际构建内容，发布后核对 Actions 和 HTTPS 页面。

截图审阅和发布以用户当前指令为准。本次用户已明确授权审查、修复并在验证后发布。后续继续按截图规则提供有内容的功能状态预览。
