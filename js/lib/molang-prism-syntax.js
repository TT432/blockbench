Prism.languages.molang = {
	'string': /("|')(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,
    'function-name': /\b(?!\d)math\.\w+(?=[\t ]*\()/i,
    'selector': /\b(?!\d)((query|variable|temp|context|customtemp|math|ct|q|v|t|c)\.\w+(\.\w+)*)|this/i,
    'boolean': /\b(?:true|false)\b/i,
	'number': /(?:\b\d+(?:\.\d+f?)?(?:[ed][+-]\d+)?|&h[a-f\d]+)\b/i,
	'operator': /&&|\|\||[-+*/!<>]=?|[:?=]/i,
	'keyword': /\b(return|loop|for_each|break|continue)\b/i,
	'punctuation': /[.,;()[\]{}]/,
};

/**
 * 自定义 molang 变量表（Project.custom_molang_variables）高亮：
 * 表内名字在 molang 编辑器中高亮为橙色（.token.custom-variable），
 * 裸标识符与 v.名 / variable.名 形式都匹配（表语义即 v.，故优先于 selector）。
 * 自定义 molang 对话框的参数名与局部变量名（ct. 语义）经 setCustomMolangParamHighlight
 * 挂入，仅匹配裸标识符，同样橙色；对话框关闭时清空。ct. 只在自定义 molang 定义体内
 * 有效，不应污染其他 molang 输入框。
 * 变量表变化（面板编辑/项目切换）时调用本函数重建 token；编辑器下次重渲染即生效。
 */
let custom_molang_param_names = [];
let param_highlight_active = false;

function collectValidNames(list) {
	let seen = {};
	let names = [];
	(list || []).forEach(name => {
		name = (name || '').trim();
		if (!/^\w+$/.test(name)) return;
		let lower = name.toLowerCase();
		if (seen[lower]) return;
		seen[lower] = true;
		names.push(name);
	});
	names.sort((a, b) => b.length - a.length);
	return names;
}

function escapeRegExpSource(names) {
	return names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function updateCustomMolangVariableHighlight() {
	if (!Prism.languages.molang) return;
	delete Prism.languages.molang['custom-variable'];
	delete Prism.languages.molang['custom-param'];
	let tokens = {};
	let var_names = collectValidNames((typeof Project != 'undefined' && Project && Project.custom_molang_variables) || []);
	if (var_names.length) {
		// 裸名与 v./variable. 前缀形式都算自定义变量，整体橙色
		tokens['custom-variable'] = new RegExp('(?<![\\w.])(?:(?:v|variable)\\.)?(?:' + escapeRegExpSource(var_names) + ')(?![\\w.(])', 'i');
	}
	let param_names = param_highlight_active ? collectValidNames(custom_molang_param_names) : [];
	if (param_names.length) {
		tokens['custom-param'] = {
			pattern: new RegExp('(?<![\\w.])(?:' + escapeRegExpSource(param_names) + ')(?![\\w.(])', 'i'),
			alias: 'custom-variable'
		};
	}
	if (Object.keys(tokens).length) {
		// 插在 selector 之前：v.名 形式的自定义变量优先按橙色高亮；字符串在更前，引号内不高亮
		Prism.languages.insertBefore('molang', 'selector', tokens);
	}
	refreshMolangEditors();
}

// 语法表变更后强制所有已挂载的 molang 编辑器重高亮。
// VuePrismEditor 的 content 是按 codeData 缓存的 computed，语法对象不是响应式依赖，
// 不改 codeData 就不会重算。这里同步地把 codeData 改为哨兵值并读回 computed（用新语法
// 重算），再改回原值重算一次——DOM 只在最终状态异步渲染一次，无闪烁、不触发 input/undo。
function refreshMolangEditors() {
	if (typeof document == 'undefined') return;
	document.querySelectorAll('.prism-editor-component').forEach(el => {
		let vm = el.__vue__;
		if (!vm || vm.language != 'molang' || typeof vm.codeData != 'string') return;
		let original = vm.codeData;
		vm.codeData = original + '﻿';
		void vm.content;
		vm.codeData = original;
		void vm.content;
	});
}

function setCustomMolangParamHighlight(names, active = true) {
	custom_molang_param_names = names || [];
	param_highlight_active = active;
	updateCustomMolangVariableHighlight();
}

// 该文件经 esbuild 打包为模块，顶层函数不进全局，显式挂出
window.updateCustomMolangVariableHighlight = updateCustomMolangVariableHighlight;
window.setCustomMolangParamHighlight = setCustomMolangParamHighlight;
