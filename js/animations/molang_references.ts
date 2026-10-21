/**
 * Molang 变量引用索引（读/写计数 + 跳转 + 项目变量扫描）
 *
 * 枚举工程内所有「可编辑 molang 位置」，按 `v.` / `variable.` 前缀统计变量引用，
 * 区分读（右侧/运算）与写（赋值左侧）。与 js/animations/molang.js 的
 * getAllMolangExpressions 互补：后者面向语法校验，只覆盖部分位置且不带字段身份。
 *
 * 位置来源：
 * - 动画属性（Property type 'molang'：anim_time_update / blend_weight / start_delay / loop_delay）
 * - 关键帧数据点（x / y / z / script）
 * - 动画控制器状态 on_entry / on_exit、动画 blend_value、过渡 condition、粒子 pre_effect_script
 * - 变量占位符面板文本（按行）
 * - 项目自定义 molang 方法体
 *
 * 粒子资产 JSON 内部的 molang 在应用内不可编辑（只能整文件替换），不计为编辑位置。
 * 插件注册的自定义 molang 不随工程保存，也不在 Project 内，同样不计入。
 */

interface MolangPropertyDefinition {
	type?: string;
	condition?: ConditionResolvable<unknown>;
}

interface MolangAnimationObject {
	name?: string;
	animators?: Record<string, MolangAnimatorObject>;
	select?: () => unknown;
	propertiesDialog?: () => unknown;
}

interface MolangAnimatorObject {
	name?: string;
	channels?: Record<string, unknown>;
}

interface MolangKeyframeObject {
	time?: number;
	data_points?: object[];
	showInTimeline?: () => unknown;
}

interface MolangControllerAnimationObject {
	uuid?: string;
	key?: string;
	blend_value?: string;
}

interface MolangControllerTransitionObject {
	uuid?: string;
	target?: string;
	condition?: string;
}

interface MolangControllerParticleObject {
	uuid?: string;
	effect?: string;
	pre_effect_script?: string;
}

interface MolangControllerStateObject {
	uuid?: string;
	name?: string;
	fold?: Record<string, boolean>;
	folded?: boolean;
	on_entry?: string;
	on_exit?: string;
	animations?: MolangControllerAnimationObject[];
	transitions?: MolangControllerTransitionObject[];
	particles?: MolangControllerParticleObject[];
	select?: () => unknown;
	scrollTo?: () => unknown;
}

interface MolangControllerObject {
	name?: string;
	states?: MolangControllerStateObject[];
	select?: () => unknown;
}

export interface MolangDefinitionObject {
	name?: string;
	body?: string;
}

declare global {
	interface Window {
		openCustomMolangDialog?: (definition: MolangDefinitionObject) => void;
	}
}

export type MolangEditLocation =
	| {type: 'animation'; animation: MolangAnimationObject; key: string}
	| {type: 'keyframe'; animation: MolangAnimationObject; animator: MolangAnimatorObject; channel: string; kf: MolangKeyframeObject; key: string}
	| {type: 'controller'; controller: MolangControllerObject; state: MolangControllerStateObject; key: 'on_entry' | 'on_exit'}
	| {type: 'controller_animation'; controller: MolangControllerObject; state: MolangControllerStateObject; entry: MolangControllerAnimationObject}
	| {type: 'controller_transition'; controller: MolangControllerObject; state: MolangControllerStateObject; transition: MolangControllerTransitionObject}
	| {type: 'controller_particle'; controller: MolangControllerObject; state: MolangControllerStateObject; particle: MolangControllerParticleObject}
	| {type: 'placeholder'; line: number; line_start: number}
	| {type: 'custom_molang'; def: MolangDefinitionObject};

export interface MolangEditField {
	value: string;
	location: MolangEditLocation;
}

export interface MolangVariableReference {
	name: string;
	name_lower: string;
	write: boolean;
	/** 引用在该字段文本内的起始下标 */
	offset: number;
	/** 引用所在字段的完整文本 */
	value: string;
	location: MolangEditLocation;
}

export interface MolangVariableReferenceGroup {
	name: string;
	reads: MolangVariableReference[];
	writes: MolangVariableReference[];
}

export type MolangVariableReferenceIndex = Record<string, MolangVariableReferenceGroup>;

// `v.name` / `variable.name`（允许点两侧空格）；前置字符不能是标识符或点，避免匹配 var.name
const variable_pattern = /(?<![\w.])(?:variable|v)\s*\.\s*([A-Za-z_]\w*)/gi;
// 名字之后紧跟赋值运算符即为写引用；`==` 等比较不算
const write_suffix_pattern = /^\s*(?:(?:[+\-*/%])=|=(?!=))/;

function isValidVariableName(name: unknown): name is string {
	return typeof name == 'string' && /^\w+$/.test(name);
}

function isMolangValue(value: unknown): value is string {
	if (typeof value != 'string' || !value) return false;
	return Number.isNaN(Number(value));
}

/** 把字符串字面量内容替换为空格（长度不变，保证下标对齐），避免统计引号内的 v.xxx */
function maskStringLiterals(text: string): string {
	let out = text.split('');
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		let char = text[i];
		if (quote) {
			out[i] = ' ';
			if (char == '\\') {
				if (i + 1 < text.length) {
					out[i + 1] = ' ';
					i++;
				}
			} else if (char == quote) {
				quote = null;
			}
		} else if (char == `'` || char == '"') {
			quote = char;
			out[i] = ' ';
		}
	}
	return out.join('');
}

interface MolangVariableToken {
	name: string;
	name_lower: string;
	offset: number;
	write: boolean;
}

function collectTokens(value: string): MolangVariableToken[] {
	let masked = maskStringLiterals(value);
	let tokens: MolangVariableToken[] = [];
	let match: RegExpExecArray | null;
	variable_pattern.lastIndex = 0;
	while ((match = variable_pattern.exec(masked))) {
		let end = match.index + match[0].length;
		tokens.push({
			name: match[1],
			name_lower: match[1].toLowerCase(),
			offset: match.index,
			write: write_suffix_pattern.test(masked.slice(end)),
		});
	}
	return tokens;
}

/** 变量占位符面板文本：优先取面板活动文本（编辑过程中 Project 同步可能滞后一帧） */
function getPlaceholderText(): string {
	let panel = (typeof Panels != 'undefined' && Panels.variable_placeholders) ? Panels.variable_placeholders : null;
	let vue = panel && panel.inside_vue;
	if (vue && typeof vue.text == 'string') return vue.text;
	if (typeof Project != 'undefined' && Project && typeof Project.variable_placeholders == 'string') {
		return Project.variable_placeholders;
	}
	return '';
}

/** 枚举所有可编辑 molang 字段（顺序稳定：动画属性 → 关键帧 → 控制器 → 占位符 → 自定义 molang） */
export function getMolangEditFields(): MolangEditField[] {
	let fields: MolangEditField[] = [];
	if (typeof Project == 'undefined' || !Project) return fields;

	let push = (value: unknown, location: MolangEditLocation) => {
		if (isMolangValue(value)) fields.push({value, location});
	};

	if (typeof Animation != 'undefined' && Array.isArray(Animation.all)) {
		// 全局类型只声明了部分字段，这里按运行时形状读注册表/通道
		let animations = Animation.all as unknown as MolangAnimationObject[];
		let animation_properties = Animation.properties as unknown as Record<string, MolangPropertyDefinition>;
		for (let animation of animations) {
			for (let key in animation_properties) {
				let property = animation_properties[key];
				if (property.type != 'molang') continue;
				if (!Condition(property.condition, animation)) continue;
				push(Reflect.get(animation, key), {type: 'animation', animation, key});
			}
			for (let animator_key in animation.animators) {
				let animator = (animation.animators || {})[animator_key];
				if (!animator || !animator.channels) continue;
				for (let channel in animator.channels) {
					// channels 只描述配置，关键帧数组挂在 animator[channel] 上
					let keyframes = Reflect.get(animator, channel);
					if (!Array.isArray(keyframes)) continue;
					(keyframes as MolangKeyframeObject[]).forEach(kf => {
						(kf.data_points || []).forEach(data_point => {
							let data_point_properties = KeyframeDataPoint.properties as unknown as Record<string, MolangPropertyDefinition>;
							for (let key in data_point_properties) {
								let property = data_point_properties[key];
								if (property.type != 'molang') continue;
								if (!Condition(property.condition, data_point)) continue;
								push(Reflect.get(data_point, key), {type: 'keyframe', animation, animator, channel, kf, key});
							}
						});
					});
				}
			}
		}
	}

	if (typeof AnimationController != 'undefined' && Array.isArray(AnimationController.all)) {
		let controllers = AnimationController.all as unknown as MolangControllerObject[];
		for (let controller of controllers) {
			for (let state of (controller.states || [])) {
				push(state.on_entry, {type: 'controller', controller, state, key: 'on_entry'});
				push(state.on_exit, {type: 'controller', controller, state, key: 'on_exit'});
				for (let entry of (state.animations || [])) {
					push(entry.blend_value, {type: 'controller_animation', controller, state, entry});
				}
				for (let transition of (state.transitions || [])) {
					push(transition.condition, {type: 'controller_transition', controller, state, transition});
				}
				for (let particle of (state.particles || [])) {
					push(particle.pre_effect_script, {type: 'controller_particle', controller, state, particle});
				}
			}
		}
	}

	let placeholder_text = getPlaceholderText();
	let line_start = 0;
	placeholder_text.split('\n').forEach((line, line_index) => {
		push(line, {type: 'placeholder', line: line_index, line_start});
		line_start += line.length + 1;
	});

	let custom_molangs = (Project.custom_molangs || []) as unknown as MolangDefinitionObject[];
	custom_molangs.forEach(def => {
		if (!def || typeof def.body != 'string') return;
		push(def.body, {type: 'custom_molang', def});
	});

	return fields;
}

/**
 * 按变量名（忽略大小写）构建读/写引用索引。
 * names 省略时索引全部 v./variable. 引用；传入变量表时只保留表内名字。
 */
export function getMolangVariableReferenceIndex(names?: string[]): MolangVariableReferenceIndex {
	let index: MolangVariableReferenceIndex = {};
	let filter: Set<string> | null = null;
	let display_names: Record<string, string> = {};
	if (Array.isArray(names)) {
		filter = new Set();
		names.forEach(name => {
			if (!isValidVariableName(name)) return;
			let lower = name.toLowerCase();
			filter!.add(lower);
			if (!display_names[lower]) display_names[lower] = name;
		});
	}

	for (let field of getMolangEditFields()) {
		for (let token of collectTokens(field.value)) {
			if (filter && !filter.has(token.name_lower)) continue;
			let group = index[token.name_lower];
			if (!group) {
				group = index[token.name_lower] = {
					name: display_names[token.name_lower] || token.name,
					reads: [],
					writes: [],
				};
			}
			let reference: MolangVariableReference = {
				name: token.name,
				name_lower: token.name_lower,
				write: token.write,
				offset: token.offset,
				value: field.value,
				location: field.location,
			};
			(token.write ? group.writes : group.reads).push(reference);
		}
	}
	return index;
}

/** 扫描工程内全部 v./variable. 引用，按首次出现顺序返回名字（忽略大小写去重） */
export function scanMolangVariableNames(): string[] {
	let seen = new Map<string, string>();
	for (let field of getMolangEditFields()) {
		for (let token of collectTokens(field.value)) {
			if (!seen.has(token.name_lower)) seen.set(token.name_lower, token.name);
		}
	}
	return Array.from(seen.values());
}

function referenceHint(reference: MolangVariableReference): string {
	let line = (reference.value.split('\n')[reference.value.slice(0, reference.offset).split('\n').length - 1] || '').trim();
	if (line.length > 60) line = line.slice(0, 57) + '…';
	return line;
}

/** 引用位置的菜单描述（不含同行片段，片段由 getMolangReferenceLabel 拼接） */
export function describeMolangReference(reference: MolangVariableReference): string {
	let location = reference.location;
	let itemName = (item: {name?: string; key?: string} | undefined) => (item && (item.name || item.key)) || '?';
	switch (location.type) {
		case 'animation':
			return `${tl('molang_reference.animation')}: ${itemName(location.animation)} › ${
				tl('menu.animation.' + location.key, undefined, location.key)
			}`;
		case 'keyframe': {
			let channel_name = tl('timeline.' + location.channel, undefined, location.channel);
			return `${tl('molang_reference.keyframe')}: ${itemName(location.animation)} › ${
				itemName(location.animator) || channel_name
			} · ${channel_name} · ${
				(typeof trimFloatNumber == 'function' ? trimFloatNumber(location.kf.time ?? 0) : location.kf.time) + 's'
			} › ${location.key}`;
		}
		case 'controller':
			return `${tl('molang_reference.controller')}: ${itemName(location.controller)} › ${
				itemName(location.state)
			} › ${tl('animation_controllers.state.' + location.key, undefined, location.key)}`;
		case 'controller_animation':
			return `${tl('molang_reference.controller_animation')}: ${itemName(location.controller)} › ${
				itemName(location.state)
			} › ${location.entry.key || itemName(location.entry)} · blend_value`;
		case 'controller_transition': {
			let target = (location.controller.states || []).find(state => state.uuid == location.transition.target);
			return `${tl('molang_reference.controller_transition')}: ${itemName(location.controller)} › ${
				itemName(location.state)
			} → ${itemName(target)} · ${tl('animation_controllers.state.condition', undefined, 'condition')}`;
		}
		case 'controller_particle':
			return `${tl('molang_reference.controller_particle')}: ${itemName(location.controller)} › ${
				itemName(location.state)
			} › ${location.particle.effect || tl('data.effect')} · ${
				tl('timeline.pre_effect_script', undefined, 'pre_effect_script')
			}`;
		case 'placeholder':
			return `${tl('molang_reference.placeholder')} · ${tl('molang_reference.line', [location.line + 1])}`;
		case 'custom_molang':
			return `${tl('molang_reference.custom_molang')}: new.${location.def.name} · ${
				tl('molang_reference.body')
			}`;
	}
	return '';
}

/** 菜单项完整文案（位置 + 同行片段，便于同名变量的多处引用区分） */
export function getMolangReferenceLabel(reference: MolangVariableReference): string {
	let hint = referenceHint(reference);
	return hint ? `${describeMolangReference(reference)} — ${hint}` : describeMolangReference(reference);
}

function revealPanel(panel_id: string) {
	if (typeof Panels == 'undefined') return;
	let panel = Panels[panel_id];
	if (!panel) return;
	if (typeof panel.fold == 'function') panel.fold(false);
	if (typeof panel.moveToFront == 'function') panel.moveToFront();
	// 选中控制器后面板条件刚变为真，需立即重算可见性（不等下一帧 updateInterface）
	if (typeof panel.update == 'function') panel.update();
	let slot = panel.position_data && panel.position_data.slot;
	if (typeof Interface != 'undefined' && typeof Prop != 'undefined') {
		if (slot == 'left_bar' && Prop.show_left_bar === false) Interface.toggleSidebar('left', true);
		if (slot == 'right_bar' && Prop.show_right_bar === false) Interface.toggleSidebar('right', true);
	}
}

/** 等编辑器渲染后聚焦并把光标放到引用处（跨模式切换/对话框构建需要重试） */
function focusMolangEditor(selectors: string[], offset: number, attempt = 0) {
	let run = (): boolean => {
		for (let selector of selectors) {
			let root = document.querySelector(selector);
			if (!root) continue;
			let focused = false;
			// Prism 编辑器不是 textarea：代码在 pre[contenteditable] 里，光标用 Selection 定位
			let textarea = root.querySelector('textarea');
			if (textarea) {
				let position = Math.max(0, Math.min(offset, textarea.value.length));
				textarea.focus();
				try {
					textarea.setSelectionRange(position, position);
				} catch (error) {}
			} else {
				let editable = root.querySelector('pre[contenteditable="true"]');
				if (!editable) continue;
				(editable as HTMLElement).focus();
				let selection = window.getSelection();
				if (selection) {
					let range = document.createRange();
					let remaining = offset;
					let walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
					let node = walker.nextNode();
					let placed = false;
					while (node) {
						let length = (node.textContent || '').length;
						if (remaining <= length) {
							range.setStart(node, remaining);
							placed = true;
							break;
						}
						remaining -= length;
						node = walker.nextNode();
					}
					if (placed) {
						range.collapse(true);
					} else {
						range.selectNodeContents(editable);
						range.collapse(false);
					}
					selection.removeAllRanges();
					selection.addRange(range);
				}
			}
			focused = root.contains(document.activeElement);
			try {
				root.scrollIntoView({block: 'nearest', inline: 'nearest'});
			} catch (error) {}
			if (focused) return true;
			break;
		}
		return false;
	};
	Vue.nextTick(() => {
		if (run()) return;
		if (attempt < 20) setTimeout(() => focusMolangEditor(selectors, offset, attempt + 1), 50);
	});
}

/** 跳转到引用所在位置：选中对象/关键帧/控制器状态，展开分区并聚焦对应编辑器 */
export function jumpToMolangReference(reference: MolangVariableReference) {
	if (!reference || !reference.location) return;
	let location = reference.location;
	switch (location.type) {
		case 'animation':
			location.animation.select?.();
			location.animation.propertiesDialog?.();
			focusMolangEditor([`#animation_properties_${location.key}`], reference.offset);
			break;
		case 'keyframe':
			location.kf.showInTimeline?.();
			revealPanel('keyframe');
			Vue.nextTick(() => {
				if (typeof updateKeyframeSelection == 'function') updateKeyframeSelection();
				focusMolangEditor([`#keyframe_bar_${location.key}`, '#keyframe_bar_uniform_scale'], reference.offset);
			});
			break;
		case 'controller':
		case 'controller_animation':
		case 'controller_transition':
		case 'controller_particle': {
			location.controller.select?.();
			location.state.folded = false;
			if (location.state.fold) {
				let section = location.type == 'controller' ? location.key
					: location.type == 'controller_animation' ? 'animations'
					: location.type == 'controller_transition' ? 'transitions'
					: 'particles';
				location.state.fold[section] = false;
			}
			location.state.select?.();
			revealPanel('animation_controllers');
			location.state.scrollTo?.();
			let selector = location.type == 'controller'
				? `#controller_state_script_${location.state.uuid}_${location.key}`
				: location.type == 'controller_animation'
					? `#controller_blend_value_${location.entry.uuid}`
					: location.type == 'controller_transition'
						? `#controller_transition_condition_${location.transition.uuid}`
						: `#controller_particle_script_${location.particle.uuid}`;
			Vue.nextTick(() => {
				location.state.scrollTo?.();
				focusMolangEditor([selector], reference.offset);
			});
			break;
		}
		case 'placeholder':
			revealPanel('variable_placeholders');
			focusMolangEditor(['#var_placeholder_area'], location.line_start + reference.offset);
			break;
		case 'custom_molang':
			window.openCustomMolangDialog?.(location.def);
			focusMolangEditor(['#custom_molang_body_editor'], reference.offset);
			break;
	}
}

Object.assign(window, {
	getMolangEditFields,
	getMolangVariableReferenceIndex,
	scanMolangVariableNames,
	describeMolangReference,
	getMolangReferenceLabel,
	jumpToMolangReference,
});
