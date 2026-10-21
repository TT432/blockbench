# 插件 API 索引（README-API）

本文件是**社区版 Blockbench 插件 API 的索引起点**：先在这里定位领域与权威文件，再进入对应
`types/custom/*.d.ts` 的类型声明与 JSDoc。文档编写与维护规则见
[API-DOCS-RULES.md](API-DOCS-RULES.md)。

- 类型声明的**唯一权威**是 `types/custom/`（手写）与 `types/generated/`（由 `js/` 源码生成，构建产物，不入库）。
- 运行时对象以 `js/api.ts` 的 `Blockbench` 对象、以及各模块挂在全局上的类/命名空间为准。
- 生成参考文档：`npm run generate-docs`（先 `npm run generate-types`，再由 typedoc 输出到 `docs/`，该目录不入库）。

## 1. 按领域查找

| 领域 | 权威文件 | 主要内容 |
|---|---|---|
| 主对象与环境 | `js/api.ts`、`types/custom/blockbench.d.ts` | `Blockbench`（版本、平台、消息提示、事件、CSS、文件读写入口）、全局类型声明清单 |
| 全局类型与事件 | `types/custom/global.d.ts`、`types/custom/misc.d.ts` | 全局函数（`guid`、`tl`、`bakeCSS` …）、`BlockbenchEventMap` 事件表、`VuePrismEditor` |
| 项目与格式 | `types/custom/io.d.ts`、`js/io/format.ts`、`js/io/codec.ts` | `ModelProject`、`ModelFormat`、`Codec`、导入导出流程 |
| 大纲与元素 | `types/custom/outliner.d.ts`、`cube.d.ts`、`group.d.ts`、`mesh.d.ts`、`spline_mesh.d.ts` | `OutlinerNode`、`Cube`、`Group`、`Mesh`、`SplineMesh`、`Locator` 等 |
| 纹理与绘制 | `types/custom/textures.d.ts`、`painter.d.ts`、`uveditor.d.ts`、`texture_group.d.ts` | `Texture`、`TextureLayer`、`Painter`、UV 编辑器、纹理组 |
| 动画 | `types/custom/animation.d.ts`、`animation_controller.d.ts`、`keyframe.d.ts`、`timeline.d.ts` | `Animator`、`AnimationItem`、`Keyframe`、`AnimationController`、时间轴 |
| Molang | `types/custom/molang.d.ts`、`js/animations/molang.js`、`js/util/molang.ts` | `MolangAutocomplete`（命名空间/上下文）、自定义 Molang 注册与展开 |
| 界面 | `types/custom/interface.d.ts`、`js/interface/*` | `Dialog`、`Panel`、`BarItems`、`Action`、`Menu`、`Setting`、`Toolbar` |
| 撤销 | `types/custom/undo.d.ts` | `Undo.initEdit` / `finishEdit` / `aspects` |
| 校验 | `types/custom/validator.d.ts` | `Validator`、`ValidatorCheck` |
| 桌面端 | `types/custom/desktop.d.ts` | Electron 相关能力（是否桌面端、窗口、原生模块权限） |
| 工具函数 | `types/custom/util.d.ts`、`types/custom/util/version_util.d.ts` | 条件求值、几何/数组/版本比较等通用函数 |
| 插件生命周期 | `js/plugin_loader.ts` | `Plugin`、`Plugins`（`registered`、`currently_loading`）、安装/卸载事件 |

## 2. 社区版新增的插件 API

### 2.1 注册只读自定义 Molang

插件可在 `onload` 中注册项目级同款的自定义 Molang（`new.name(args)` / `n.name(args)`），
界面中以锁标记展示，**不可修改、不可删除**，也不随 `.bbmodel` 保存：

```js
const definition = Blockbench.registerCustomMolang({
	name: 'lerp3',                       // 仅限字母/数字/下划线，忽略大小写唯一
	description: '三轴线性插值',           // 显示在面板条目与悬浮提示、Molang 手册中
	params: ['a', 'b', 't'],             // 输入变量
	outputs: ['x', 'y'],                 // 输出变量：调用处以 >左值 传入
	locals: ['tmp'],                     // 定义体局部变量（ct. 语义）
	body: 'tmp = a + (b - a) * t; x = tmp; y = tmp * 2; x',  // 方法体
});
// definition 为只读定义对象，带 delete() 可提前注销；注册失败（重名/名称非法）时返回 null
```

调用与展开规则与项目自定义 Molang **完全一致**（同一份校验与展开实现）：

- `n.lerp3(v.a, v.b, v.c, >v.x, >v.y)` → 方法体内的 `x`/`y` 改写为独立 `temp` 变量，
  调用语句后用 `v.x = temp.lerp3_out_x1; v.y = temp.lerp3_out_y1` 写回；
- 输出实参必须位于实参末尾、以 `>` 前缀、且为左值（`v.` / `variable.` / `t.` / `temp.` / `c.` / `context.`
  / 裸名字）；个数必须与 `outputs` 一致，否则调用保持原文并输出一次控制台告警；
- 输出写回依赖语句分隔（`;`），因此只能用在支持语句序列的字段（控制器 `on_entry`/`on_exit`、变量占位符、
  粒子脚本等），单表达式字段（关键帧值、过渡条件）不使用输出变量。

生命周期：注册时若处于插件 `onload` 期间，定义自动归属该插件；插件卸载/重载触发 `unloaded_plugin`
时自动移除（也可调用 `definition.delete()`）。同名（忽略大小写）与项目自定义 Molang 冲突时注册失败。

相关全局函数：`getCustomMolangDefinitions()`（项目 + 插件定义，项目优先）、
`getRegisteredCustomMolangs()`、`findCustomMolangDefinition(name)`、`unregisterCustomMolang(def)`、
`expandCustomMolang(text)`、`clearCustomMolangCache()`。

### 2.2 项目自定义 Molang 与变量表

- `Project.custom_molangs`：`{uuid, name, description, params, outputs, locals, body}` 数组，随工程保存；
- `Project.custom_molang_variables`：变量名数组，任意 molang 处按 `variable.<name>` 解析并高亮；
- 两者变化后需 `clearCustomMolangCache()`，并派发 `Blockbench.dispatchEvent('update_custom_molang', {})`
  让面板与手册刷新。

### 2.3 Molang 自动补全与手册

- `MolangAutocomplete.DefaultContext` 的 `new`/`n` 命名空间动态列出全部自定义定义（含输出 `>名字`）；
- 手册条目数据在 `js/animations/molang_manual_data.ts`，由 `js/animations/molang_manual.ts` 渲染，
  插件定义无需额外登记即可出现在手册的「插件自定义 Molang」分组。

## 3. 生成与校验

```bash
node scripts/check_api_docs.js   # 文档覆盖门禁：types/custom 逐条 JSDoc + d.ts 语法，要求 0 缺失 0 错误
npm run generate-types           # js/ → types/generated（tsc 生成声明）
npm run generate-docs            # 生成 types + typedoc 站点（docs/，不入库）
npm run build-electron           # 打包桌面端（改了打包文件后须重启实例验证）
```

> 已知：`generate-types` 目前会因 `js/preview/cube_batcher.ts`、`js/preview/preview.ts` 的既有类型错误
> 以非零退出（详见 [API-DOCS-RULES.md](API-DOCS-RULES.md) 第 6 节），文档改动不得新增报错。

插件侧开发时建议把 `types/index.d.ts` 加入编辑器/IDE 的类型引用，即可获得全部 API 的补全与悬停文档。

## 4. 约定

- 公开 API 的 JSDoc 使用英文；`README-API.md` 与 `API-DOCS-RULES.md` 使用中文。
- 标注 `@deprecated` 的 API 保留但不得在新代码中使用；替代方案写在同一条 JSDoc 中。
- 新增公开 API 时须同步：类型声明与 JSDoc → 本索引对应领域 → 软件内「帮助 → 社区版功能」条目（涉及用户可见行为时）。
- 发布产物（插件 JS / 文档 / 注册表）禁止出现本机绝对路径。
