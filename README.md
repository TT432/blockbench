# Blockbench

Blockbench is a free and open source model editor for low-poly models with pixel art textures.
Models can be exported into standardized formats, to be shared, rendered, 3D-printed, or used in game engines. There are also multiple dedicated formats for Minecraft Java and Bedrock Edition with format-specific features. 

Blockbench features a modern and beginner friendly interface, but also offers lots of customization and advanced features for experienced 3D artists. Plugins can extend the functionality of the program even further.

Website and download: [blockbench.net](https://www.blockbench.net)


![Interface](https://web.blockbench.net/content/front_page_app.png)


## 社区版（Community Edition）

本仓库是社区版 [Blockbench](https://github.com/TT432/blockbench) 的工作副本：在官方上游版本的基础上追加社区功能、问题修复与中文文案，发版走本仓库的 GitHub Releases。每个版本的改动见软件内「帮助 → 社区版更新日志」。

### 制作插件

插件就是一个 JS 文件，不需要构建工具。**文件名必须等于插件 id**（`my_plugin.js` → id `my_plugin`），内容用 IIFE 包裹，末尾注册：

```javascript
(function () {
	'use strict';

	BBPlugin.register('my_plugin', {
		title: '示例插件',
		author: '你的名字',
		description: '一句话说明这个插件做什么',
		icon: 'sports_esports',        // Material Symbols 图标名
		version: '0.1.0',              // 合法 semver
		variant: 'both',               // both | desktop | web
		min_version: '5.2.0',
		tags: ['Animation'],           // 最多 3 个
		onload() {
			// 注册 Action / 菜单 / 对话框
		},
		onunload() {
			// 撤销 onload 里做的全部改动（删 Action、移除 CSS、清监听）
		}
	});
})();
```

常用 API：

- 菜单与按钮：`new BarMenu(id, items, {name})`、`new Action(id, {name, icon, click, condition})`。
- 对话框：`new Dialog({id, title, component: {template, data}, buttons}).show()`，模板里用 `` `${tl('key')}` `` 取翻译。
- 工程数据：`new Property(ModelProject, 'object' | 'string' | 'number', 'namespace', {exposed: false})`，数据随 `.bbmodel` 保存与加载。
- 样式 / 提示：`Blockbench.addCSS(css)`、`Blockbench.showQuickMessage()`、`Blockbench.showMessageBox()`。
- 撤销：`Undo.initEdit({...})` → 改数据 → `Undo.finishEdit('说明')`。注意 `initEdit` 的快照会把数组里的元素替换成 JSON 深拷贝，**`initEdit` 之后要按 uuid 重新查找对象，不要沿用之前拿到的引用**。
- 事件：`Blockbench.on('select_project', cb)`（另有 `finished_edit`、`update_selection`、`new_project`、`load_project`、`undo`、`redo` 等）。
- 桌面端 Node 能力：5.x 桌面版插件里**没有全局 `fs` / `require`**，需要时按作用域自行请求——

  ```javascript
  const fs = require('fs', {scope: 'D:/some/folder'});  // 首次调用弹出原生权限对话框
  ```

  「总是允许」会把该目录记进 `<userData>/plugin_permissions.json`；作用域换了会重新询问。

本地调试：打开插件商店，用对话框顶部的「从文件加载插件」/「从 URL 加载插件」装载，也可以用 `帮助 → 开发者 → 重新加载插件`（改了文件后重载）。开发版（`npm run dev`）可以直接在 DevTools 控制台调用全局 API 试验。

参考：官方插件教程 <https://www.blockbench.net/wiki/docs/plugin>，API 参考 <https://web.blockbench.net/docs>，类型补全 `npm i --save-dev blockbench-types`（配合 VS Code / TypeScript 有自动补全）。完整示例见社区插件仓库的 [yss_animation_controller](https://github.com/TT432/blockbench-plugins/tree/master/plugins/yss_animation_controller)（单文件、桌面端、约 2000 行）。

### 向社区插件仓库投稿

社区插件注册表是 [TT432/blockbench-plugins](https://github.com/TT432/blockbench-plugins)，经 jsDelivr 提供服务；社区版客户端把该源与官方源合并展示在同一个插件商店里。审查细则（规则层词表、自动合并边界、维护者配置）见该仓库的 [docs/plugin-review.md](https://github.com/TT432/blockbench-plugins/blob/master/docs/plugin-review.md)。

**1. 准备文件**（`<id>` 在文件名、目录名、`BBPlugin.register` 三处必须一致）：

```text
plugins/<id>/<id>.js          主文件，文件名必须与 id 一致
plugins/<id>/about.md         商店「关于」页（Markdown，写安装与使用说明）
plugins/<id>/changelog.json   版本变更记录
plugins/<id>/icon.png         可选图片图标（≤320 KB；不用图片时 plugins.json 里写 Material 图标名）
plugins.json                  新增 / 更新该 id 的条目
updates.json                  新增 / 更新该 id 的条目
```

`plugins.json` 条目示例：

```json
{
	"my_plugin": {
		"title": "示例插件",
		"author": "你的名字",
		"description": "一句话说明",
		"icon": "sports_esports",
		"version": "0.1.0",
		"variant": "both",
		"min_version": "5.2.0",
		"tags": ["Animation"],
		"new_repository_format": true,
		"has_changelog": true,
		"creation_date": "2026-10-27",
		"repository": "https://github.com/你的账号/你的插件仓库",
		"bug_tracker": "https://github.com/你的账号/你的插件仓库/issues"
	}
}
```

**2. 必须显式给出 `repository` 与 `bug_tracker`**，指向你自己的仓库；不写会回落到官方仓库。其余必填：`title`、`author`、`description`、`icon`、`version`、`variant`、`min_version`、`tags`、`new_repository_format: true`。

**3. 版本三处一致**：`BBPlugin.register` 的 `version`、`plugins.json` 的 `version`、`updates.json` 的 `version` 必须相同且是合法 semver。发新版时同时改这三个文件并往 `changelog.json` 头部追加条目。

**4. 提 PR**：fork → 新建分支 → **一个 PR 只改一个插件**。PR 只允许触及 `plugins/**`、`plugins.json`、`updates.json`；`.github/**` 与 `scripts/**` 一律拒绝。

**5. 自动审查**：PR 会触发 GitHub Actions，结果以评论回写（同一条评论就地更新）并打标签：

| 标签 | 含义 |
|---|---|
| `review-passed` | 通过，自动 squash 合并，随后经 jsDelivr 对客户端生效 |
| `review-failed` | 评论列出阻断项；改完再 push 会自动重审 |
| `review-manual` | 删除类 PR 或审查异常，转人工 |

审查分两层：**规则层**（清单与注册一致性、体量上限、危险 API、外联域名、混淆特征、绝对路径、提示注入、违规词）与**内容层**（恶意代码 / 政治敏感 / 色情赌博毒品 / 违法 / 歧视）。

**6. 会被规则层拦下的写法**：`child_process`、`eval` / `new Function`、`process.binding`、cookie 与剪贴板读取、`net` / `tls` / `vm` 模块；明文 HTTP 外联（域名白名单只有 jsDelivr 与 GitHub）；混淆代码（hex 变量名、密集转义、超长 base64、密集 `fromCharCode`）；发布产物中出现本机绝对路径（`C:\...`、`/home/...`、`/Users/...`）。插件需要联网或读写文件时，把域名、目录说明写进 `about.md`，方便审查与用户判断。

**7. 提交前自测**（规则层，无需 API key）：

```bash
node scripts/review/review.mjs --base origin/master --head HEAD --rules-only
# 退出码 0 通过 / 1 不通过 / 2 需人工；产出 review-report.md、review-verdict.json
```

**8. CDN 缓存**：文件经 jsDelivr 加载，新文件即时生效；已缓存的同名文件更新后需要 purge：

```bash
curl "https://purge.jsdelivr.net/gh/TT432/blockbench-plugins/plugins.json"
```

发版后逐一 curl 校验 `plugins.json`、`updates.json`、`plugins/<id>/<id>.js`、`plugins/<id>/about.md`、`plugins/<id>/changelog.json` 五个 URL 均为新内容（purge 后瞬时 503 属正常，重试到 200）。



## Contribution

[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.0-4baaaa.svg)](CODE_OF_CONDUCT.MD)

Check out the [Contribution Guidelines](CONTRIBUTING.md).



## Launching Blockbench

To launch Blockbench from source, you can clone the repository, navigate to the correct branch and launch the program in development mode using the instructions below.
If you just want to use the latest version, please download the app from the website.

### Setup Repository
* Install [NodeJS](https://nodejs.org/en/).
* Then install all dependencies via
`npm install`


### Run in Electron
Use this command or press Ctrl + Shift + B to launch Blockbench in Electron:

`npm run dev`

To enable debugging in VS Code, switch to the **Run & Debug** tab, select the **"Debug Renderer"** configuration, and press the green arrow button to launch.
Now you can set breakpoints and debug inside VSCode.


### Run the web app
Use this command to launch the web app locally:

`npm run serve`

Now you can open the web app in your browser under http://localhost:3000


## Plugins

Blockbench supports Javascript-based plugins. Learn more about creating plugins on [https://www.blockbench.net/wiki/docs/plugin](https://www.blockbench.net/wiki/docs/plugin).



## License

* The Blockbench source-code is licensed under the GPL license version 3. See `LICENSE.MD`.
* Modifications to the source code can be made under the terms of that license.
* Blockbench plugins (external scripts) and themes (theme files to customize the design) that interact with the Blockbench API are an exception. Plugins and themes can be created and/or published as open source, proprietary or paid software.
* All assets created with Blockbench (models, textures, animations, screenshots etc.) are your own!
