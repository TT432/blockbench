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
 * 自定义 molang 对话框的参数名（ct. 语义）经 setCustomMolangParamHighlight 挂入，
 * 仅匹配裸标识符，同样橙色；对话框关闭时清空。
 * 变量表变化（面板编辑/项目切换）时调用本函数重建 token；编辑器下次重渲染即生效。
 */
let custom_molang_param_names = [];

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
	let param_names = collectValidNames(custom_molang_param_names);
	if (param_names.length) {
		tokens['custom-param'] = {
			pattern: new RegExp('(?<![\\w.])(?:' + escapeRegExpSource(param_names) + ')(?![\\w.(])', 'i'),
			alias: 'custom-variable'
		};
	}
	if (!Object.keys(tokens).length) return;
	// 插在 selector 之前：v.名 形式的自定义变量优先按橙色高亮；字符串在更前，引号内不高亮
	Prism.languages.insertBefore('molang', 'selector', tokens);
}

function setCustomMolangParamHighlight(names) {
	custom_molang_param_names = names || [];
	updateCustomMolangVariableHighlight();
}

// 该文件经 esbuild 打包为模块，顶层函数不进全局，显式挂出
window.updateCustomMolangVariableHighlight = updateCustomMolangVariableHighlight;
window.setCustomMolangParamHighlight = setCustomMolangParamHighlight;
