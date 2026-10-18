let string_num_regex = /^-?\d+(\.\d+f?)?$/;
function isStringNumber(string: string) {
	return string_num_regex.test(string);
}

export function processMolangReturn(molang: string, callback: Function): string {
	if (molang.includes('return ')) {
		return molang.replace(/return (.+?)(;|$)/g, (match: string, expression: string, end: string) => {
			return `return ${callback(expression)}${end}`;
		})
	} else {
		molang = molang.replace(/;+$/, '')
		const lastSemicolonIndex = molang.lastIndexOf(';');
		if (lastSemicolonIndex === -1) {
			if (molang.includes('=')) {
				return molang + ';' + callback('');
			} else {
				return callback(molang);
			}
		}
		const before = molang.substring(0, lastSemicolonIndex);
		const after = molang.substring(lastSemicolonIndex + 1);
		if (after.includes('=')) {
			return molang + ';' + callback('');
		} else {
			return before + ';' + callback(after);
		}
	}
}

const BRACKET_OPEN = '{([';
const BRACKET_CLOSE = '})]';
export function invertMolang(molang: string): string
export function invertMolang(molang: number): number
export function invertMolang(molang: number|string): number|string {
	if (typeof molang == 'number') {
		return -molang;
	}
	if (molang == '' || molang == '0') return molang;
	if (isStringNumber(molang)) {
		let val = parseFloat(molang);
		return (-val).toString();
	}

	return processMolangReturn(molang, (expression : string) => {
		let invert = true;
		let bracket_depth = 0;
		let last_operator: undefined | string;
		let result = '';
		for (let char of expression) {
			if (!bracket_depth) {
				let operator: undefined | string;
				let had_input = true;
				if (char == '-' && last_operator != '*' && last_operator != '/') {
					if (!invert && !last_operator) result += '+';
					invert = false;
					continue;
				} else if (char == ' ' || char == '\n') {
					had_input = false;
				} else if (char == '+' && last_operator != '*' && last_operator != '/') {
					result += '-';
					invert = false;
					continue;
				} else if ('?:'.includes(char)) {
					invert = true;
					operator = char;
				} else if (invert) {
					result += '-';
					invert = false;
				} else if ('+-*/&|'.includes(char)) {
					operator = char;
				}
				if (had_input) {
					last_operator = operator;
				}
			}
			if (BRACKET_OPEN.includes(char)) {
				bracket_depth++;
			} else if (BRACKET_CLOSE.includes(char)) {
				bracket_depth--;
			}
			result += char;
		}
		return result;
	});
}

export function negateMolang(molang: string): string
export function negateMolang(molang: number): number
export function negateMolang(molang: number|string): number|string {
	if (typeof molang == 'number') {
		return -molang;
	}
	if (molang == '' || molang == '0') return molang;
	if (isStringNumber(molang)) {
		let val = parseFloat(molang);
		return (-val).toString();
	}

	return processMolangReturn(molang, (expression : string) => {
		expression = expression.trim();
		if (expression == '' || expression == '0') return expression;
		if (isStringNumber(expression)) {
			return (-parseFloat(expression)).toString();
		}
		let wrapped = expression.match(/^-\s*\(([\s\S]*)\)$/);
		if (wrapped) {
			let depth = 0;
			let balanced = true;
			let inner = wrapped[1];
			for (let i = 0; i < inner.length; i++) {
				if (inner[i] == '(') {
					depth++;
				} else if (inner[i] == ')') {
					depth--;
					if (depth < 0) {
						balanced = false;
						break;
					}
				}
			}
			if (balanced && depth == 0) return inner;
		}
		return `-(${expression})`;
	});
}
function testInvertMolang(input: string) {
	let positive_result = Animator.MolangParser.parse(input);
	let inverted = invertMolang(input);
	let negative_result = Animator.MolangParser.parse(inverted);
	if (Math.epsilon(positive_result, -negative_result, 0.00001)) {
		return inverted
	} else {
		console.warn([positive_result, negative_result], inverted);
	}
}

// MARK: Custom Molang（项目自定义 molang，n./new. 前缀，执行/导出前文本展开）
export interface CustomMolangDefinition {
	uuid?: string
	name: string
	params: string[]
	body: string
}
const custom_molang_call_regex = /(^|[^\w.])(?:n|new)\.(\w+)\s*(\()?/gi;
const custom_molang_quick_test = /(^|[^\w.])(n|new)\.\w/i;
const custom_molang_ct_regex = /(^|[^\w.])(?:customtemp|ct)\.(\w+)/gi;
let custom_molang_cache_project: typeof Project | null = null;
let custom_molang_cache = new Map<string, string>();
// customtemp./ct. 作用域计数器：以定义名（小写）为键，每次展开该定义的调用时递增。
// 与展开缓存同生命周期（切换项目或清除缓存时重置），保证同一输入展开结果稳定。
let custom_molang_ct_counters = new Map<string, number>();

export function clearCustomMolangCache(): void {
	custom_molang_cache.clear();
	custom_molang_ct_counters.clear();
}

// 按顶层逗号拆分参数（括号内逗号不拆）
function splitCustomMolangArgs(arg_string: string): string[] {
	let args: string[] = [];
	let depth = 0, start = 0;
	for (let i = 0; i < arg_string.length; i++) {
		let char = arg_string[i];
		if (char == '(') depth++;
		else if (char == ')') depth--;
		else if (char == ',' && depth == 0) {
			args.push(arg_string.substring(start, i).trim());
			start = i + 1;
		}
	}
	let last = arg_string.substring(start).trim();
	if (last || args.length) args.push(last);
	return args;
}

/**
 * 展开文本中的项目自定义 molang 调用（n.name(...) / new.name(...)）。
 * 参数一律以括号包裹代入（保证 `n.test(v.a, v.b + 1)` → `(v.a) + (v.b + 1)` 无语义偏移）；
 * 方法体按定义原样拼接。嵌套/链式调用递归展开，深度上限防止循环定义死循环。
 * 未定义的调用保持原文（交给 molang 解析器按未知变量处理）。
 */
export function expandCustomMolang(input: string, depth = 0): string {
	if (typeof input != 'string' || depth > 16) return input;
	if (!custom_molang_quick_test.test(input)) return input;
	let defs = (typeof Project != 'undefined' && Project ? Project.custom_molangs : null) as CustomMolangDefinition[] | null;
	if (!defs || !defs.length) return input;

	if (depth == 0) {
		if (Project !== custom_molang_cache_project) {
			custom_molang_cache_project = Project;
			custom_molang_cache.clear();
			custom_molang_ct_counters.clear();
		}
		let cached_result = custom_molang_cache.get(input);
		if (cached_result !== undefined) return cached_result;
	}

	let result = '';
	let cursor = 0;
	let changed = false;
	custom_molang_call_regex.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = custom_molang_call_regex.exec(input))) {
		if (match.index < cursor) continue; // 已消费的调用内部（参数等），跳过
		let name = match[2].toLowerCase();
		let def = defs.find(d => d.name && d.name.toLowerCase() == name);
		if (!def) continue;
		let args: string[] = [];
		let end = custom_molang_call_regex.lastIndex;
		if (match[3]) {
			// 从 '(' 后平衡扫描到匹配的 ')'
			let bracket_depth = 1;
			let i = end;
			for (; i < input.length; i++) {
				let char = input[i];
				if (char == '(') bracket_depth++;
				else if (char == ')') {
					bracket_depth--;
					if (!bracket_depth) break;
				}
			}
			if (bracket_depth) continue; // 括号未闭合，保持原文
			args = splitCustomMolangArgs(input.substring(end, i));
			end = i + 1;
		} else if (def.params && def.params.length) {
			continue; // 定义要求参数但调用处无括号，保持原文
		}
		let body = (def.body || '').trim();
		(def.params || []).forEach((param, i) => {
			if (!param) return;
			let arg = args[i] !== undefined && args[i] !== '' ? args[i] : '0';
			let param_regex = new RegExp(`(?<![\\w$])${param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'gi');
			body = body.replace(param_regex, `(${arg})`);
		});
		// customtemp./ct. 作用域：方法体内的 ct.变量 以本次调用为单位展开为独立 temp 变量。
		// 第 n 次展开 new.test 的调用时，ct.a → temp.test_ct_a{n}（customtemp. 同理）。
		custom_molang_ct_regex.lastIndex = 0;
		if (custom_molang_ct_regex.test(body)) {
			let def_key = def.name.toLowerCase();
			let call_index = (custom_molang_ct_counters.get(def_key) || 0) + 1;
			custom_molang_ct_counters.set(def_key, call_index);
			body = body.replace(custom_molang_ct_regex, (_m, prefix: string, var_name: string) => {
				return `${prefix}temp.${def.name}_ct_${var_name}${call_index}`;
			});
		}
		result += input.substring(cursor, match.index) + match[1] + body;
		cursor = end;
		changed = true;
	}
	if (!changed) return input;
	result += input.substring(cursor);
	// 展开结果可能仍含自定义调用（嵌套调用、定义间互相引用），递归至收敛
	result = expandCustomMolang(result, depth + 1);
	if (depth == 0) {
		if (custom_molang_cache.size > 512) custom_molang_cache.clear();
		custom_molang_cache.set(input, result);
	}
	return result;
}


const global = {
	invertMolang,
	testInvertMolang,
	processMolangReturn,
	expandCustomMolang,
	clearCustomMolangCache
};
declare global {
	const invertMolang: typeof global.invertMolang
	const testInvertMolang: typeof global.testInvertMolang
	const processMolangReturn: typeof global.processMolangReturn
	const expandCustomMolang: typeof global.expandCustomMolang
	const clearCustomMolangCache: typeof global.clearCustomMolangCache
}
Object.assign(window, global);
