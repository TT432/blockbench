# 插件 API 文档规则（API-DOCS-RULES）

本规则适用于社区版 Blockbench 中**插件可使用的公开 API** 及其文档。索引起点是
[README-API.md](README-API.md)。文档覆盖由 `node scripts/check_api_docs.js` 强制检查。

## 1. 权威来源与文件归属

| 内容 | 位置 | 说明 |
|---|---|---|
| 运行时真相 | `js/**`（`js/api.ts` 的 `Blockbench` 对象、各模块全局导出） | 行为以源码为准 |
| 手写类型声明 | `types/custom/**/*.d.ts` | 文档的主要载体，**必须逐条注释** |
| 生成类型声明 | `types/generated/**` | `npm run generate-types` 产物，**不入库、不手改** |
| 参考文档站点 | `docs/`（typedoc，不入库） | 由 `types/custom` + `types/generated` 生成 |
| 索引 | `README-API.md` | 按领域指向权威文件 |
| 软件内功能手册 | `js/interface/community_features_data.ts` | 面向用户的功能说明（中文） |
| Molang 手册数据 | `js/animations/molang_manual_data.ts` | 官方 Molang 用法（中文整理） |

## 2. 语言与语气

- **`types/custom` 的 JSDoc 用英文**：这些声明会随 typedoc 发布给插件开发者，与上游保持一致。
- **本规则、`README-API.md`、社区版功能手册、Molang 手册数据用中文**。
- 动词开头的一句话摘要（`Returns …` / `Adds …` / `Called when …`），句末带句号。
- 只描述**可观察行为**；不写实现细节（内部缓存、迭代顺序、私有字段名）。
- 不写「大致」「通常」等无法验证的措辞；不确定的语义只描述结构（例如
  `The animator that owns this keyframe.`），不猜业务含义。

## 3. 必须注释的声明

`scripts/check_api_docs.js` 会遍历 `types/custom/**/*.d.ts` 的 AST，下列节点缺少紧邻注释即判为未覆盖：

- `class` / `interface` / `namespace` / `function` / `type` / `enum` / `const` 声明；
- 类与接口的成员：属性、方法、`get`/`set` 访问器、`constructor`。

不得通过的「伪文档」：与声明不相邻的注释（中间夹空行或别的声明）、仅有一行 `//` 且与声明无关的注释。

## 4. 注释格式

````ts
/**
 * One-line summary in imperative or present tense.
 * Optional second line for non-obvious behavior, invariants or side effects.
 * @param name What the argument is, when the type alone is not enough.
 * @returns What the value represents, when the type alone is not enough.
 * @deprecated Use `Other.method()` instead.
 */
````

- 缩进与声明一致（成员用 1 个 Tab，嵌套命名空间按层级）。
- `@param` / `@returns` 只在类型不足以表达语义时添加；不重复类型。
- 默认值、取值范围、单位必须能在源码中找到依据，否则不写。
- 已有注释只做**补充或纠错**；不删除历史说明（除非与源码矛盾，矛盾时改注释并在提交说明里指出）。
- 注释内的代码标识符用反引号；不写 Markdown 标题、不写外链。

## 5. 新增或修改公开 API 的流程

1. 在 `js/` 中实现；
2. 更新 `types/custom` 声明并写 JSDoc（生成类型由 `generate-types` 产出，不手改）；
3. 在 `README-API.md` 的对应领域补一行入口，新领域则新增小节；
4. 涉及用户可见行为时，在 `js/interface/community_features_data.ts` 补条目（中文，写清入口/功能/与原版差异）；
5. 涉及 Molang 官方条目时同步 `js/animations/molang_manual_data.ts`（见第 7 节）；
6. 发版说明只写在 `js/interface/community_changelog.ts` 的 `COMMUNITY_CHANGELOG`（发版流程见项目 AGENTS.md）。

## 6. 校验

```bash
node scripts/check_api_docs.js          # 文档覆盖 + d.ts 语法：必须 0 缺失、0 语法错误（本次改动强制门禁）
npm run generate-types                  # tsc 生成 types/generated
npm run generate-docs                   # 生成 typedoc 站点（docs/ 不入库）
```

`check_api_docs.js --list` 可逐条列出 `文件:行 名称`，`--file=types/custom/cube.d.ts` 只看单文件。

已知既有问题（与本次文档工作无关，修复不属于文档任务）：`generate-types` 会因
`js/preview/cube_batcher.ts`（`ArrayLike<number>` 的使用、空格分隔的事件名）与
`js/preview/preview.ts`（`Group.syncDirectlySelectedFlags`、`AnimationController.getActivePreviewController`
未声明）报错并以非零退出；脚本用 `&&` 串联，因此 `generate-docs` 随之中断。tsc 仍会产出
`types/generated`，但 `convert_types.js` 不会执行。判断文档改动是否引入新问题，以
`check_api_docs.js` 的 0 缺失 / 0 语法错误为准；修复上述类型错误后应恢复 `generate-types` 全绿。

## 7. Molang 手册数据维护规则

`js/animations/molang_manual_data.ts` 是「帮助 → Molang 手册」的数据源：

- `MOLANG_QUERY_DOCS`：key 必须与 `js/animations/molang.js` 中 `query` 命名空间的条目一一对应；
- `MOLANG_MATH_DOCS`：key 为去掉 `math.` 前缀的函数名，`signature` 使用官方文档写法；
- `MOLANG_EXTRA_DOCS`：关键字、`context`/`variable` 命名空间、Blockbench 扩展记号（`toggle`/`slider`/`impulse`/`new.<name>`）；
- 条目缺失时手册显示「官方文档未收录用法说明」；**新增或改名官方条目必须同步本表**；
- 用法文字忠于 Minecraft 官方 Molang 文档（bedrock.dev / learn.microsoft.com）的中文改写，不添加原文没有的结论。

## 8. 禁止事项

- 禁止在 `types/generated/**` 手写或修改文档；
- 禁止把本机绝对路径、内部测试路径写进公开文档或发布产物；
- 禁止用「见源码」「TODO」代替说明；
- 禁止为了让检查通过而写与声明不符的注释。
