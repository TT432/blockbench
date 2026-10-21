// 插件 API 文档覆盖检查（types/custom 手写类型声明）。
//
// 规则来源：API-DOCS-RULES.md。检查项：
//   1. 语法：types/custom/**/*.d.ts 必须能被 TypeScript 无语法错误地解析；
//   2. 文档：每个公开声明（class/interface/namespace/function/type/enum/variable）与
//      类/接口成员（属性、方法、访问器）都必须带有紧邻的 JSDoc（`/** */`）或 `//` 注释。
//
// 用法：
//   node scripts/check_api_docs.js            # 汇总，缺注释时退出码 1
//   node scripts/check_api_docs.js --list     # 逐条列出缺失位置（文件:行 name）
//   node scripts/check_api_docs.js --file types/custom/cube.d.ts
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = 'types/custom';
const args = process.argv.slice(2);
const list_missing = args.includes('--list');
const file_filter = args.find(arg => arg.startsWith('--file='))?.slice('--file='.length);

function collectFiles(dir) {
	let files = [];
	for (let entry of fs.readdirSync(dir, {withFileTypes: true})) {
		let full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...collectFiles(full));
		else if (entry.name.endsWith('.d.ts')) files.push(full);
	}
	return files.sort();
}

/** 节点前缀（含前导空白与注释）里是否已有注释 */
function hasLeadingComment(source, node) {
	// `const X: T` 的 VariableDeclaration 从名字开始，`const` 与 JSDoc 在 VariableStatement 上
	if (ts.isVariableDeclaration(node) && node.parent && ts.isVariableDeclarationList(node.parent) && node.parent.parent) {
		return hasLeadingCommentOn(source, node.parent.parent);
	}
	return hasLeadingCommentOn(source, node);
}
function hasLeadingCommentOn(source, node) {
	let prefix = source.text.slice(node.getFullStart(), node.getStart(source));
	return prefix.includes('//') || prefix.includes('/*');
}

function isDocumentableNode(node) {
	const kinds = [
		ts.SyntaxKind.ClassDeclaration,
		ts.SyntaxKind.InterfaceDeclaration,
		ts.SyntaxKind.NamespaceDeclaration,
		ts.SyntaxKind.ModuleDeclaration,
		ts.SyntaxKind.FunctionDeclaration,
		ts.SyntaxKind.TypeAliasDeclaration,
		ts.SyntaxKind.EnumDeclaration,
		ts.SyntaxKind.VariableDeclaration,
		ts.SyntaxKind.PropertySignature,
		ts.SyntaxKind.PropertyDeclaration,
		ts.SyntaxKind.MethodSignature,
		ts.SyntaxKind.MethodDeclaration,
		ts.SyntaxKind.GetAccessor,
		ts.SyntaxKind.SetAccessor,
		ts.SyntaxKind.Constructor,
	];
	return kinds.includes(node.kind);
}

/** 匿名成员（索引签名、调用签名、构造签名）没有稳定名字，跳过 */
function nameOf(node, source) {
	if (node.name && ts.isIdentifier(node.name)) return node.name.text;
	if (node.name && ts.isStringLiteral(node.name)) return JSON.stringify(node.name.text);
	let text = source.text.slice(node.getStart(source), node.getStart(source) + 40);
	return text.split('\n')[0].trim();
}

const files = collectFiles(ROOT).filter(file => !file_filter || file.replace(/\\/g, '/').endsWith(file_filter.replace(/\\/g, '/')));
let total_declarations = 0;
let missing_total = 0;
let syntax_errors = [];
let report = [];

for (let file of files) {
	let source = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	let diagnostics = source.parseDiagnostics || [];
	for (let diagnostic of diagnostics) {
		let position = source.getLineAndCharacterOfPosition(diagnostic.start || 0);
		syntax_errors.push(`${file}:${position.line + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
	}

	let missing = [];
	function visit(node) {
		if (isDocumentableNode(node) && !node.modifiers?.some(modifier => modifier.kind == ts.SyntaxKind.PrivateKeyword)) {
			total_declarations++;
			if (!hasLeadingComment(source, node)) {
				let position = source.getLineAndCharacterOfPosition(node.getStart(source));
				missing.push({file, line: position.line + 1, name: nameOf(node, source)});
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);

	if (missing.length) {
		missing_total += missing.length;
		report.push({file, missing});
	}
}

for (let entry of report) {
	console.log(`${entry.file}: ${entry.missing.length} 处缺少文档`);
	if (list_missing) {
		for (let item of entry.missing) console.log(`  ${item.file}:${item.line}  ${item.name}`);
	}
}
for (let error of syntax_errors) console.log(`SYNTAX ${error}`);

console.log(`\n声明总数 ${total_declarations}，缺少文档 ${missing_total}，语法错误 ${syntax_errors.length}`);
if (missing_total || syntax_errors.length) process.exit(1);
