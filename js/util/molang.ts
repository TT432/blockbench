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

// MARK: Custom Molang（项目自定义 molang + 插件注册的自定义 molang，n./new. 前缀，执行/导出前文本展开）
export interface CustomMolangDefinition {
	uuid?: string
	name: string
	/** 功能描述：显示在面板条目中，同时作为条目悬浮提示 */
	description?: string
	params: string[]
	/** 输出变量：调用处用 >左值 作为最后几个实参传入，展开后在语句末尾写回 */
	outputs?: string[]
	// 该定义的局部变量（ct. 语义）：定义体内的裸名字改写为 ct.<名字>
	locals?: string[]
	body: string
	/** 插件注册的定义：界面只读（不可修改/删除），不随项目保存 */
	readonly?: boolean
	/** 注册该定义的插件 id：插件卸载时自动移除 */
	plugin_id?: string
	/** 注销该定义（仅插件注册的定义带此方法） */
	delete?: () => boolean
}
const custom_molang_call_regex = /(^|[^\w.])(?:n|new)\.(\w+)\s*(\()?/gi;
const custom_molang_quick_test = /(^|[^\w.])(n|new)\.\w/i;
const custom_molang_ct_regex = /(^|[^\w.])(?:customtemp|ct)\.(\w+)/gi;
// 输出实参：>左值（v.名字 / variable.名字 / t.名字 / temp.名字 / c.名字 / context.名字 / 裸名字）
const custom_molang_out_arg_regex = /^>\s*(.+)$/;
const custom_molang_lvalue_regex = /^(?:(?:v|variable|t|temp|c|context)\.\w+|\w+)$/i;
let custom_molang_cache_project: typeof Project | null = null;
let custom_molang_cache = new Map<string, string>();
// customtemp./ct. 与输出变量的作用域计数器：以定义名（小写）为键，每次展开该定义的调用时递增。
// 与展开缓存同生命周期（切换项目或清除缓存时重置），保证同一输入展开结果稳定。
let custom_molang_ct_counters = new Map<string, number>();
// 插件注册的自定义 molang：不随项目保存，由注册插件负责生命周期（卸载自动移除）。
const registered_custom_molangs: CustomMolangDefinition[] = [];
// 非法调用只告警一次，避免逐帧解析刷屏
const custom_molang_warned = new Set<string>();

export function clearCustomMolangCache(): void {
	custom_molang_cache.clear();
	custom_molang_ct_counters.clear();
}

/** 名字表清洗：与自定义 molang 对话框一致（非空、仅 \w、忽略大小写去重） */
export function sanitizeCustomMolangNames(list: string[] | undefined): string[] {
	let seen = new Set<string>();
	let result: string[] = [];
	(Array.isArray(list) ? list : []).forEach(name => {
		name = String(name ?? '').trim();
		if (!name || !/^\w+$/.test(name)) return;
		let lower = name.toLowerCase();
		if (seen.has(lower)) return;
		seen.add(lower);
		result.push(name);
	});
	return result;
}

/** 已注册的插件自定义 molang（只读引用，界面展示用） */
export function getRegisteredCustomMolangs(): CustomMolangDefinition[] {
	return registered_custom_molangs;
}

/**
 * 当前生效的自定义 molang 定义：项目定义在前，插件注册的定义在后。
 * 同名（忽略大小写）时项目定义优先——注册时已拒绝与项目同名，
 * 但项目文件可能后于注册加载，故解析处按优先级去重。
 */
export function getCustomMolangDefinitions(): CustomMolangDefinition[] {
	let project_defs = (typeof Project != 'undefined' && Project && Array.isArray(Project.custom_molangs) ? Project.custom_molangs : []) as CustomMolangDefinition[];
	if (!registered_custom_molangs.length) return project_defs;
	return project_defs.concat(registered_custom_molangs.filter(def => {
		if (!def || !def.name) return false;
		return !project_defs.some(project_def => project_def && project_def.name && project_def.name.toLowerCase() == def.name.toLowerCase());
	}));
}

/** 按名字（忽略大小写，可带 new./n. 前缀）查找生效的自定义 molang 定义 */
export function findCustomMolangDefinition(name: string): CustomMolangDefinition | undefined {
	let lower = String(name || '').trim().replace(/^(new|n)\./i, '').toLowerCase();
	if (!lower) return undefined;
	return getCustomMolangDefinitions().find(def => def.name && def.name.toLowerCase() == lower);
}

function notifyCustomMolangChange(): void {
	clearCustomMolangCache();
	if (typeof Animator != 'undefined' && Animator && Animator.preview) Animator.preview();
	if (typeof Blockbench != 'undefined' && Blockbench.dispatchEvent) {
		Blockbench.dispatchEvent('update_custom_molang', {});
	}
}

export interface CustomMolangDefinitionOptions {
	name: string
	description?: string
	params?: string[]
	outputs?: string[]
	locals?: string[]
	body?: string
	uuid?: string
}

/**
 * 注册插件自定义 molang。规则与项目自定义 molang 完全一致：
 * 名称仅限 \w、忽略大小写唯一；参数/输出/局部变量走同一份清洗；方法体走同一条展开路径。
 * 名称已被占用时返回 null（不覆盖既有定义），并在控制台告警。
 * @param definition 定义
 * @param plugin_id 归属插件 id；缺省时取当前正在加载的插件
 */
export function registerCustomMolang(definition: CustomMolangDefinitionOptions, plugin_id?: string): CustomMolangDefinition | null {
	let name = String((definition && definition.name) || '').trim().replace(/^(new|n)\./i, '');
	if (!name || !/^\w+$/.test(name)) {
		console.warn('[Custom Molang] Invalid definition name:', definition && definition.name);
		return null;
	}
	let lower = name.toLowerCase();
	if (getCustomMolangDefinitions().some(def => def.name && def.name.toLowerCase() == lower)) {
		console.warn(`[Custom Molang] "${name}" is already defined. The plugin definition was not registered.`);
		return null;
	}
	let params = sanitizeCustomMolangNames(definition.params);
	let outputs = sanitizeCustomMolangNames(definition.outputs)
		.filter(output => !params.some(param => param.toLowerCase() == output.toLowerCase()));
	let locals = sanitizeCustomMolangNames(definition.locals)
		.filter(local => !params.concat(outputs).some(entry => entry.toLowerCase() == local.toLowerCase()));
	let owner_plugin = plugin_id
		|| ((typeof Plugins != 'undefined' && Plugins && Plugins.currently_loading) ? Plugins.currently_loading : '');
	let entry: CustomMolangDefinition = {
		uuid: definition.uuid || guid(),
		name,
		description: typeof definition.description == 'string' ? definition.description.trim() : '',
		params,
		outputs,
		locals,
		body: typeof definition.body == 'string' ? definition.body : '',
		readonly: true,
		plugin_id: owner_plugin,
	};
	entry.delete = () => unregisterCustomMolang(entry);
	registered_custom_molangs.push(entry);
	notifyCustomMolangChange();
	return entry;
}

/** 注销一条插件注册的自定义 molang */
export function unregisterCustomMolang(entry: CustomMolangDefinition): boolean {
	let index = registered_custom_molangs.indexOf(entry);
	if (index < 0) return false;
	registered_custom_molangs.splice(index, 1);
	notifyCustomMolangChange();
	return true;
}

/** 注销某插件注册的全部自定义 molang（插件卸载 / 重载时调用） */
export function unregisterCustomMolangsByPlugin(plugin_id: string): void {
	if (!plugin_id) return;
	let removed = false;
	for (let i = registered_custom_molangs.length - 1; i >= 0; i--) {
		if (registered_custom_molangs[i].plugin_id == plugin_id) {
			registered_custom_molangs.splice(i, 1);
			removed = true;
		}
	}
	if (removed) notifyCustomMolangChange();
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

const custom_molang_string_literal_regex = /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/g;

/**
 * 裸名改写通用实现：表内名字的裸标识符改写为 <前缀>.<名字>。
 * 字符串字面量内不改写；v./temp. 等前缀后、成员访问后、函数调用形式的同名串不受影响。
 */
function rewriteBareNames(input: string, list: string[] | undefined, prefix: string): string {
	if (!list || !list.length) return input;
	let seen = new Set<string>();
	let names: string[] = [];
	list.forEach(name => {
		name = (name || '').trim();
		if (!/^\w+$/.test(name)) return;
		let lower = name.toLowerCase();
		if (seen.has(lower)) return;
		seen.add(lower);
		names.push(name);
	});
	if (!names.length) return input;
	// 长名优先，避免短名先匹配截断（\b 已挡住大部分，双保险）
	names.sort((a, b) => b.length - a.length);
	let source = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
	let name_regex = new RegExp(`(?<![\\w.])(?:${source})(?![\\w.(])`, 'gi');
	if (!name_regex.test(input)) return input;
	name_regex.lastIndex = 0;
	let changed = false;
	let segments = input.split(custom_molang_string_literal_regex);
	for (let i = 0; i < segments.length; i += 2) {
		segments[i] = segments[i].replace(name_regex, match => {
			changed = true;
			return prefix + '.' + match;
		});
	}
	return changed ? segments.join('') : input;
}

/**
 * 自定义 molang 变量表（Project.custom_molang_variables）改写：
 * 表内名字的裸标识符在任何 molang 处视为 variable.<名字>，解析/导出前改写。
 */
function rewriteCustomMolangVariables(input: string): string {
	if (typeof Project == 'undefined' || !Project) return input;
	return rewriteBareNames(input, Project.custom_molang_variables as string[] | undefined, 'variable');
}

/**
 * 展开文本中的自定义 molang 调用（n.name(...) / new.name(...)）。
 * 参数一律以括号包裹代入（保证 `n.test(v.a, v.b + 1)` → `(v.a) + (v.b + 1)` 无语义偏移）；
 * 方法体按定义原样拼接。嵌套/链式调用递归展开，深度上限防止循环定义死循环。
 * 未定义的调用保持原文（交给 molang 解析器按未知变量处理）。
 *
 * 输出变量（def.outputs）：调用处把输出左值作为最后几个实参、以 `>` 前缀传入，
 * 例如定义 new.split(v, a, b) 带输出 a、b 时，调用写 `new.split(v.x, >v.a, >v.b)`。
 * 展开时定义体内的输出名改写为独立 temp 变量，并在调用所在语句末尾追加写回：
 * `…(v.x); v.a = temp.split_out_a1; v.b = temp.split_out_b1`。
 * 输出只能用于支持语句序列（`;`）的 molang 字段，单表达式字段不适用。
 */
export function expandCustomMolang(input: string, depth = 0): string {
	if (typeof input != 'string' || depth > 16) return input;
	let original_input = input;
	if (depth == 0) {
		// 自定义变量表（裸名字 → variable.名字）先于调用展开，保证无 n./new. 调用时也生效
		input = rewriteCustomMolangVariables(input);
	}
	if (!custom_molang_quick_test.test(input)) return input;
	let defs = getCustomMolangDefinitions();
	if (!defs.length) return input;

	if (depth == 0) {
		if (Project !== custom_molang_cache_project) {
			custom_molang_cache_project = Project;
			custom_molang_cache.clear();
			custom_molang_ct_counters.clear();
		}
		let cached_result = custom_molang_cache.get(original_input);
		if (cached_result !== undefined) return cached_result;
	}

	// 按语句（顶层 `;`）展开：输出变量的写回挂在调用所在语句的末尾
	let result = '';
	let changed = false;
	for (let statement of splitCustomMolangStatements(input)) {
		let expanded = expandCustomMolangCalls(statement.text, defs);
		if (expanded.text != statement.text) changed = true;
		result += expanded.text;
		if (expanded.outputs.length) {
			changed = true;
			result += expanded.outputs.map(assignment => `; ${assignment}`).join('');
		}
		if (statement.terminated) result += ';';
	}
	if (!changed) return input;
	// 展开结果可能仍含自定义调用（嵌套调用、定义间互相引用），递归至收敛
	result = expandCustomMolang(result, depth + 1);
	if (depth == 0) {
		// 方法体代入的文本也可能含变量表裸名字，最终结果统一改写一次
		result = rewriteCustomMolangVariables(result);
		if (custom_molang_cache.size > 512) custom_molang_cache.clear();
		custom_molang_cache.set(original_input, result);
	}
	return result;
}

/** 按顶层 `;` 切分 molang 语句（跳过字符串字面量内的分号） */
function splitCustomMolangStatements(input: string): {text: string, terminated: boolean}[] {
	let statements: {text: string, terminated: boolean}[] = [];
	let in_string: string | null = null;
	let start = 0;
	for (let i = 0; i < input.length; i++) {
		let char = input[i];
		if (in_string) {
			if (char == '\\') i++;
			else if (char == in_string) in_string = null;
			continue;
		}
		if (char == '"' || char == "'") {
			in_string = char;
		} else if (char == ';') {
			statements.push({text: input.substring(start, i), terminated: true});
			start = i + 1;
		}
	}
	statements.push({text: input.substring(start), terminated: false});
	return statements;
}

/** 单条语句内的调用展开：返回展开后的文本与需要在该语句末尾写回的输出赋值 */
function expandCustomMolangCalls(input: string, defs: CustomMolangDefinition[]): {text: string, outputs: string[]} {
	let result = '';
	let cursor = 0;
	let outputs: string[] = [];
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

		// 输出实参：定义的输出个数决定末尾参数个数；不足/多余或左值非法时保持原文并告警一次
		let declared_outputs = (def.outputs || []).filter(output => !!output);
		let out_values: string[] = [];
		if (declared_outputs.length) {
			if (args.length < declared_outputs.length) {
				warnCustomMolangCall(def, `expects ${declared_outputs.length} output argument(s) prefixed with ">"`);
				continue;
			}
			let split_index = args.length - declared_outputs.length;
			let valid = true;
			for (let i = 0; i < declared_outputs.length; i++) {
				let out_match = (args[split_index + i] || '').match(custom_molang_out_arg_regex);
				let lvalue = out_match ? out_match[1].trim() : '';
				if (!lvalue || !custom_molang_lvalue_regex.test(lvalue)) {
					valid = false;
					break;
				}
				out_values.push(lvalue);
			}
			if (!valid) {
				warnCustomMolangCall(def, 'output arguments must be lvalues prefixed with ">", e.g. >v.a');
				continue;
			}
			args = args.slice(0, split_index);
			if (args.some(arg => custom_molang_out_arg_regex.test(arg))) {
				warnCustomMolangCall(def, 'output arguments must be the last arguments of the call');
				continue;
			}
		} else if (args.some(arg => custom_molang_out_arg_regex.test(arg))) {
			warnCustomMolangCall(def, 'declares no output variables but was called with ">" arguments');
			continue;
		}

		let call_index = (custom_molang_ct_counters.get(def.name.toLowerCase()) || 0) + 1;
		custom_molang_ct_counters.set(def.name.toLowerCase(), call_index);

		let body = (def.body || '').trim();
		(def.params || []).forEach((param, i) => {
			if (!param) return;
			let arg = args[i] !== undefined && args[i] !== '' ? args[i] : '0';
			body = body.replace(
				new RegExp(`(?<![\\w$])${param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'gi'),
				`(${arg})`
			);
		});
		// 输出变量：定义体内的输出名改为本次调用的独立 temp 变量，语句末尾再写回调用处左值
		declared_outputs.forEach((output, i) => {
			let temp_name = `temp.${def.name}_out_${output}${call_index}`;
			body = body.replace(
				new RegExp(`(?<![\\w$])${output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'gi'),
				temp_name
			);
			outputs.push(`${out_values[i]} = ${temp_name}`);
		});
		// 定义的局部变量表（def.locals）：定义体内的裸名字视为 ct.<名字>，
		// 随本次调用展开为独立 temp 变量。参数代入后再改写，使实参中的表内名字同样生效。
		body = rewriteBareNames(body, def.locals as string[] | undefined, 'ct');
		// customtemp./ct. 作用域：方法体内的 ct.变量 以本次调用为单位展开为独立 temp 变量。
		// 第 n 次展开 new.test 的调用时，ct.a → temp.test_ct_a{n}（customtemp. 同理）。
		custom_molang_ct_regex.lastIndex = 0;
		if (custom_molang_ct_regex.test(body)) {
			body = body.replace(custom_molang_ct_regex, (_m, prefix: string, var_name: string) => {
				return `${prefix}temp.${def.name}_ct_${var_name}${call_index}`;
			});
		}
		result += input.substring(cursor, match.index) + match[1] + body;
		cursor = end;
	}
	return {text: result + input.substring(cursor), outputs};
}

/** 非法自定义 molang 调用只告警一次（解析器逐帧调用，避免刷屏） */
function warnCustomMolangCall(def: CustomMolangDefinition, message: string) {
	let key = `${def.name}:${message}`;
	if (custom_molang_warned.has(key)) return;
	custom_molang_warned.add(key);
	console.warn(`[Custom Molang] new.${def.name}(): ${message}`);
}


const global = {
	invertMolang,
	testInvertMolang,
	processMolangReturn,
	expandCustomMolang,
	clearCustomMolangCache,
	sanitizeCustomMolangNames,
	getRegisteredCustomMolangs,
	getCustomMolangDefinitions,
	findCustomMolangDefinition,
	registerCustomMolang,
	unregisterCustomMolang,
	unregisterCustomMolangsByPlugin
};
declare global {
	const invertMolang: typeof global.invertMolang
	const testInvertMolang: typeof global.testInvertMolang
	const processMolangReturn: typeof global.processMolangReturn
	const expandCustomMolang: typeof global.expandCustomMolang
	const clearCustomMolangCache: typeof global.clearCustomMolangCache
	const sanitizeCustomMolangNames: typeof global.sanitizeCustomMolangNames
	const getRegisteredCustomMolangs: typeof global.getRegisteredCustomMolangs
	const getCustomMolangDefinitions: typeof global.getCustomMolangDefinitions
	const findCustomMolangDefinition: typeof global.findCustomMolangDefinition
	const registerCustomMolang: typeof global.registerCustomMolang
	const unregisterCustomMolang: typeof global.unregisterCustomMolang
	const unregisterCustomMolangsByPlugin: typeof global.unregisterCustomMolangsByPlugin
}
Object.assign(window, global);
