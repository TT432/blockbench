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
 * 表内名字的裸标识符在 molang 编辑器中高亮为紫色（.token.custom-variable）。
 * 变量表变化（面板编辑/项目切换）时调用本函数重建 token；编辑器下次重渲染即生效。
 */
function updateCustomMolangVariableHighlight() {
	if (!Prism.languages.molang) return;
	delete Prism.languages.molang['custom-variable'];
	let list = (typeof Project != 'undefined' && Project && Project.custom_molang_variables) || [];
	let seen = {};
	let names = [];
	list.forEach(name => {
		name = (name || '').trim();
		if (!/^\w+$/.test(name)) return;
		let lower = name.toLowerCase();
		if (seen[lower]) return;
		seen[lower] = true;
		names.push(name);
	});
	if (!names.length) return;
	names.sort((a, b) => b.length - a.length);
	let source = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
	// selector 在前，v.x 形式仍按 selector 高亮；字符串在更前，引号内不高亮
	Prism.languages.insertBefore('molang', 'boolean', {
		'custom-variable': new RegExp('(?<![\\w.])(?:' + source + ')(?![\\w.(])', 'i')
	});
}
// 该文件经 esbuild 打包为模块，顶层函数不进全局，显式挂出
window.updateCustomMolangVariableHighlight = updateCustomMolangVariableHighlight;
