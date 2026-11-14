/**
 * 宏录制（反馈#354）
 *
 * 面板里的「宏录制」把界面上的一串操作录下来，存成 `.bbmacro` 文件（JSON），之后对当前标签页
 * 重放，也可以对同一文件夹里的模型批量重放。
 *
 * ## 录制口径
 * - **动作**：界面上凡是走 `BarItem.trigger()` 的按钮都算——顶部菜单、工具栏、面板里的按钮
 *   （`create_texture`、`convert_format`、`delete`、`screenshot_model`…）都是同一个入口，
 *   录制时监听每个 BarItem 的 `trigger` 事件即可全部覆盖，不需要逐面板适配。
 *   开关类（`Toggle`/`BarSelect`）连当时的取值一起记，回放时先把取值设回去再触发。
 * - **对话框参数**：动作弹出对话框时，用户点确认那一刻把整张表单的填写值记进这一步；
 *   回放时自动填表并确认（导出选项、创建纹理、转换格式等），不需要人工再点一遍。
 *   没有表单的**组件式对话框**（纹理的亮度/对比度、饱和度/色调调整等）记的是组件 data
 *   里的原始值，回放时写回后触发组件的 `change()` 再确认，效果与录制时一致。
 * - **选择状态**：每一步记下当时选中的组/元素名字，回放前按名字重建选区——所以「删掉 root 组」
 *   这类步骤换到别的模型上仍然删的是那个同名组；名字一个都对不上时跳过该步骤并记日志，
 *   不会拿别的选中物去执行删除。
 * - **导出与截屏**：录制时记下实际落盘的路径（导出 → `export` 步骤，图片 → `screenshot` 步骤），
 *   路径里可以用 `${name}`（模型名）与 `${file}`（模型文件路径）占位；批量处理时按模型替换，
 *   因此一套宏可以给整批模型各自输出到不同文件。默认文件名就是模型名，录制时这一段自动换成
 *   `${name}`，避免所有模型都写同一个文件互相顶掉（用户自己改过的文件名保持原样）。
 * - **模式切换**：编辑/绘制/动画模式切换记成独立步骤，回放按录制顺序切换。
 *
 * ## 回放
 * - 顺序执行，每步之间让出事件循环；面板高亮当前步骤，失败/跳过的步骤写进面板日志。
 * - 批量：选一个文件夹，逐个打开其中的 `.bbmodel` 后重放同一套步骤，导出/截屏按占位符
 *   替换后的路径写盘。宏里没有导出步骤时批量只改内存里的模型，不会回写原文件。
 */
import { fs } from "../native_apis";
import type { FormResultValue } from "./form";

export type MacroStepType = 'action' | 'mode' | 'export' | 'screenshot';
/** 组件式对话框的参数字面量：只记原始类型，对象（纹理列表、画布等）回放时由动作自己重建 */
export type MacroComponentValue = string | number | boolean;

export interface MacroSelection {
	groups: string[]
	elements: {name: string, type: string}[]
}

export interface MacroStep {
	type: MacroStepType
	/** action 步骤的动作 id；mode 步骤的模式 id */
	id?: string
	/** 显示名（保存翻译键或动作原名，显示时再 tl()） */
	name?: string
	/** Toggle / BarSelect 录制时的取值 */
	value?: unknown
	/** 对话框表单原文，回放时自动填写 */
	form?: Record<string, FormResultValue>
	/** 表单所属对话框 id，避免把值填进回放途中弹出的其它对话框 */
	dialog_id?: string
	/**
	 * 组件式对话框（`component` 而非 `form`）录制时的内容状态（反馈#356）：
	 * 这类对话框的表单就是组件自身（纹理的亮度/对比度/饱和度调整等），参数挂在
	 * `content_vue` 的 data 上，没有 `dialog.form` 可读。回放时先写回这些值再触发组件的
	 * `change()`，最后确认对话框。
	 */
	component_state?: Record<string, MacroComponentValue>
	/** 录制时选中的组/元素（按名字） */
	selection?: MacroSelection
	/** export / screenshot：落盘路径，支持 ${name} ${file} 占位 */
	path?: string
	/** export：导出用的 codec id */
	codec_id?: string
}

interface MacroFile {
	name: string
	format: 'bbmacro'
	version: 1
	created: number
	steps: MacroStep[]
}

const MACRO_FORMAT = 'bbmacro';
const MACRO_VERSION = 1;
/** 录制时忽略的动作：宏自身、撤销/重做（回放到别的模型上没有意义且危险） */
const IGNORED_ACTIONS: Record<string, true> = {
	macro_record: true, macro_play: true, macro_save: true, macro_load: true,
	macro_batch: true, macro_clear: true, undo: true, redo: true,
};
/**
 * 回放要用的最小动作接口：`BarItems` 里混装 Action / Toggle / BarSelect / Tool，基类
 * `BarItem` 的类型里没有暴露 `trigger()` 与 `set()`，这里按实际能力声明一份。
 */
interface TriggerableBarItem {
	condition?: ConditionResolvable
	set?(value: unknown): void
	trigger(): boolean
}
/**
 * 录到落盘路径时按导出/截屏处理的动作：Blockbench 的导出是**每个编码器一个动作**
 * （`export_blockmodel`、`export_bedrock`、`export_image`…），另有工程保存 `save_project*`
 * 与三个截屏动作，一律按前缀/名单识别。
 */
function isExportAction(id: string): boolean {
	return id.startsWith('export_') || id.startsWith('save_project')
		|| id == 'screenshot_model' || id == 'screenshot_app' || id == 'advanced_screenshot';
}

function wait(ms: number) {
	const {promise, resolve} = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}
function snapshotSelection(): MacroSelection {
	let selection: MacroSelection = {groups: [], elements: []};
	if (typeof Outliner == 'undefined') return selection;
	selection.groups = Group.multi_selected.map(group => group.name);
	selection.elements = Outliner.selected.map(element => ({name: element.name, type: element.type}));
	return selection;
}
/**
 * 组件式对话框（反馈#356）的参数快照：只收 `content_vue` data 里的原始值。
 * 纹理列表、画布、对话框自身的引用一律跳过——它们由动作在回放时重新构造，
 * 记下来既无意义又会让 `.bbmacro` 反序列化后指向旧对象。
 */
function snapshotComponentState(vue: unknown): Record<string, MacroComponentValue> | undefined {
	if (!vue || typeof vue != 'object' || !('$data' in vue)) return undefined;
	let data = (vue as {$data: Record<string, unknown>}).$data;
	if (!data || typeof data != 'object') return undefined;
	let state: Record<string, MacroComponentValue> = {};
	let count = 0;
	for (let key in data) {
		let value = data[key];
		if (typeof value == 'string' || typeof value == 'number' || typeof value == 'boolean') {
			state[key] = value;
			count++;
		}
	}
	return count ? state : undefined;
}
/**
 * 把录制下来的落盘路径里「以当前模型名命名的文件名」换成 `${name}` 占位符（反馈#357）。
 * 导出/截屏的默认文件名就是模型名，照原样记下来会让所有模型都往同一个文件写、
 * 互相顶掉；换成占位符后一套宏给整批模型跑，每个模型落到自己的文件名上。
 * 用户自己改过名的文件保持原样（那是明确的意图）。`ModelA.geo.json` 这类多段扩展名
 * 也按「模型名 + 第一个点之后」拼接，`Armor.png` 这种同前缀的其它名字不会被误换。
 */
function replaceModelNamePlaceholder(path: string, model_name: string): string {
	if (!model_name) return path;
	let separator_index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	let filename = path.slice(separator_index + 1);
	if (filename.slice(0, model_name.length) != model_name) return path;
	let rest = filename.slice(model_name.length);
	if (rest !== '' && rest[0] != '.') return path;
	return path.slice(0, separator_index + 1) + '${name}' + rest;
}
/** 从 .bbmodel JSON 里取出模型格式 id（批量打开时先按它建一个干净工程） */
function readModelFormat(data: unknown): string | undefined {
	if (!data || typeof data != 'object' || !('meta' in data)) return undefined;
	let meta = data.meta;
	if (!meta || typeof meta != 'object' || !('model_format' in meta)) return undefined;
	return typeof meta.model_format == 'string' ? meta.model_format : undefined;
}
function readMacroFile(content: string): MacroStep[] {
	let data: unknown = JSON.parse(content);
	if (!data || typeof data != 'object' || !('steps' in data) || !(data.steps instanceof Array)) {
		throw new Error('steps missing');
	}
	return data.steps.filter((step): step is MacroStep => (
		!!step && typeof step == 'object' && 'type' in step && typeof step.type == 'string'
	));
}

const MacroRecorder = {
	recording: false,
	playing: false,
	/** 正在回放的步骤下标，-1 = 没在回放 */
	step_index: -1,
	steps: [] as MacroStep[],
	macro_name: 'macro',
	/** 回放/批量的过程记录，面板只显示最后几条 */
	log: [] as string[],
	/** 录制中：最近一步动作，用来挂对话框表单与导出路径 */
	pending_step: null as MacroStep | null,
	/** 回放中：当前步骤（对话框自动填表要用） */
	current_step: null as MacroStep | null,
	current_context: null as {file?: string, name?: string} | null,
	action_listeners: [] as Deletable[],
	mode_listener: null as Deletable | null,
	hooks_installed: false,

	pushLog(line: string) {
		this.log.push(line);
		if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
		this.changed();
	},
	clearLog() {
		this.log.length = 0;
		this.changed();
	},
	/** 面板没有响应式数据源，改动后强制重渲染 */
	changed() {
		if (typeof Panels != 'undefined' && Panels.macro?.vue) {
			Panels.macro.vue.$forceUpdate();
		}
	},

	// MARK: 录制
	start() {
		if (this.playing || this.recording) return;
		this.installHooks();
		this.recording = true;
		this.subscribeActions();
		Blockbench.showQuickMessage(tl('message.macro.recording_started'), 2000);
		this.changed();
	},
	stop() {
		if (!this.recording) return;
		this.recording = false;
		this.unsubscribeActions();
		this.pending_step = null;
		Blockbench.showQuickMessage(tl('message.macro.recording_stopped', [this.steps.length]), 2500);
		this.changed();
	},
	toggleRecord() {
		if (this.recording) this.stop();
		else this.start();
	},
	clear() {
		if (this.recording) this.stop();
		this.steps = [];
		this.pending_step = null;
		this.clearLog();
	},
	removeStep(index: number) {
		if (index < 0 || index >= this.steps.length) return;
		this.steps.splice(index, 1);
		this.changed();
	},
	moveStep(index: number, offset: number) {
		let target = index + offset;
		if (index < 0 || index >= this.steps.length) return;
		if (target < 0 || target >= this.steps.length) return;
		let [step] = this.steps.splice(index, 1);
		this.steps.splice(target, 0, step);
		this.changed();
	},
	setStepPath(index: number, path: string) {
		let step = this.steps[index];
		if (!step) return;
		step.path = path;
		this.changed();
	},
	pushStep(step: MacroStep) {
		this.steps.push(step);
		this.changed();
		return step;
	},
	subscribeActions() {
		this.unsubscribeActions();
		for (let key in BarItems) {
			let item = BarItems[key];
			if (!item || typeof item.on != 'function' || !item.id) continue;
			if (IGNORED_ACTIONS[item.id]) continue;
			this.action_listeners.push(item.on('trigger', (event: {condition_met?: boolean}) => {
				if (!this.recording || !event?.condition_met) return;
				this.recordAction(item);
			}));
		}
		this.mode_listener = Blockbench.on('select_mode', ({mode}) => {
			if (!this.recording || !mode) return;
			this.pending_step = null;
			this.pushStep({type: 'mode', id: mode.id, name: mode.name});
		});
	},
	unsubscribeActions() {
		for (let listener of this.action_listeners) listener.delete();
		this.action_listeners.length = 0;
		this.mode_listener?.delete();
		this.mode_listener = null;
	},
	recordAction(item: BarItem) {
		let step: MacroStep = {
			type: 'action',
			id: item.id,
			name: item.name || item.id,
			selection: snapshotSelection(),
		};
		if (typeof Toggle != 'undefined' && item instanceof Toggle) {
			step.value = item.value;
		} else if (typeof BarSelect != 'undefined' && item instanceof BarSelect) {
			step.value = item.get();
		}
		this.pending_step = this.pushStep(step);
	},

	// MARK: 钩子（对话框 / 导出）
	installHooks() {
		if (this.hooks_installed) return;
		this.hooks_installed = true;

		let original_show = Dialog.prototype.show;
		Dialog.prototype.show = function (...args) {
			let result = original_show.apply(this, args);
			MacroRecorder.onDialogShown(this);
			return result;
		};

		let original_export = Blockbench.export;
		Blockbench.export = function (options, callback) {
			return original_export.call(Blockbench, options, path => {
				MacroRecorder.onExported(path, options);
				if (typeof callback == 'function') callback(path);
			});
		};
	},
	/** 录制：确认时把表单值记进当前步骤；回放：按记录值填表并自动确认 */
	onDialogShown(dialog: Dialog) {
		if (this.recording && this.pending_step && (dialog.form || dialog.content_vue)) {
			let step = this.pending_step;
			if (step.form || step.component_state) return;
			let original_close = dialog.close.bind(dialog);
			dialog.close = (button?: number, event?: Event) => {
				if (button === dialog.confirmIndex) {
					if (dialog.form) {
						step.form = dialog.getFormResult();
						step.dialog_id = dialog.id;
					} else {
						// 组件式对话框没有 form（反馈#356）：参数在 content_vue 的 data 上
						let state = snapshotComponentState(dialog.content_vue);
						if (state) {
							step.component_state = state;
							step.dialog_id = dialog.id;
						}
					}
					this.changed();
				}
				return original_close(button, event);
			};
			return;
		}
		if (!this.playing || !this.current_step) return;
		let step = this.current_step;
		if (!dialog.form && !dialog.content_vue) return;
		if (step.dialog_id && step.dialog_id != dialog.id) return;
		if (dialog.form) {
			if (!step.form) return;
			setTimeout(() => {
				try {
					dialog.setFormValues(step.form!, false);
					dialog.confirm();
				} catch (error) {
					this.pushLog(tl('message.macro.log_dialog_failed', [step.name ?? step.id ?? '']));
				}
			}, 0);
			return;
		}
		// 组件式对话框（反馈#356）：先写回录制时的参数，再让组件按新参数重算——调整类对话框的
		// 实际改动发生在 change() 里，最后 confirm 由对话框自己的 onConfirm 收尾（提交 undo）
		if (!step.component_state) return;
		let component_state = step.component_state;
		setTimeout(() => {
			try {
				let vue = dialog.content_vue as unknown as Record<string, unknown> & {change?: () => void};
				for (let key in component_state) {
					if (key in vue) vue[key] = component_state[key];
				}
				vue.change?.();
				dialog.confirm();
			} catch (error) {
				this.pushLog(tl('message.macro.log_dialog_failed', [step.name ?? step.id ?? '']));
			}
		}, 0);
	},
	/** 录制：把当前动作步骤换成带落盘路径的导出/截屏步骤 */
	onExported(path: string, options: {savetype?: unknown, type?: unknown, extensions?: unknown}) {
		if (!this.recording || !path) return;
		let step = this.pending_step;
		if (!step || step.type != 'action') return;
		if (!isExportAction(step.id ?? '')) {
			this.pushLog(tl('message.macro.log_export_untracked', [path]));
			return;
		}
		if (options?.savetype == 'image') {
			step.type = 'screenshot';
			step.path = replaceModelNamePlaceholder(path, Project?.name ?? '');
			this.changed();
			return;
		}
		// 只有能找出对应编码器的导出才能回放：模型/材质等导出都由编码器编译内容，
		// 而像「导出按键表」这类动作是直接内联 content 调 Blockbench.export，没有编码器可复用，
		// 于是保留成动作步骤、回放时照原样触发（保存对话框会再次出现），并记一条日志说明。
		let type = typeof options?.type == 'string' ? options.type : undefined;
		let extension = Array.isArray(options?.extensions) && typeof options.extensions[0] == 'string'
			? options.extensions[0] : undefined;
		let codec = Object.values(Codecs).find(candidate => (
			(type !== undefined && candidate.name == type) || (extension !== undefined && candidate.extension == extension)
		));
		if (!codec) {
			this.pushLog(tl('message.macro.log_export_untracked', [path]));
			return;
		}
		step.type = 'export';
		step.codec_id = codec.id;
		step.path = replaceModelNamePlaceholder(path, Project?.name ?? '');
		this.changed();
	},

	// MARK: 回放
	resolvePath(path: string, context: {file?: string, name?: string} | null): string {
		let model_name = context?.name ?? Project?.name ?? 'model';
		return path
			.replace(/\$\{name\}/g, model_name)
			.replace(/\$\{file\}/g, context?.file ?? '');
	},
	/**
	 * 按录制的名字重建选区。录制时没选中任何东西、或录制的节点**全部**都在时返回 true。
	 * 只命中一部分时不执行该步骤：拿别的选中物去跑删除/剪切这类动作，改的就是另一个模型了；
	 * 批量处理里「有的模型没有 root 组」正是靠这条规则变成「跳过并记日志」。
	 */
	applySelection(selection: MacroSelection): boolean {
		let missing: string[] = [];
		// 先元素后组：选中组内的元素会把组本身标记成未选中，反过来的话「删掉这个组」就会
		// 退化成「只删掉组里那个块」，组留在原地（选中的顺序就是执行顺序的语义）
		let nodes: OutlinerNode[] = [];
		for (let entry of selection.elements ?? []) {
			let node: OutlinerNode | undefined = Outliner.elements.find(candidate => (
				candidate.name === entry.name && candidate.type === entry.type
			)) ?? Group.all.find(candidate => candidate.name === entry.name);
			if (!node) {
				missing.push(entry.name);
				continue;
			}
			nodes.push(node);
		}
		let groups: Group[] = [];
		for (let name of selection.groups ?? []) {
			let group = Group.all.find(node => node.name === name);
			if (!group) {
				missing.push(name);
				continue;
			}
			groups.push(group);
		}
		// 先全部解析、再统一落地：缺节点时前面已经改过的选区会让「跳过该步骤」变成半成品状态
		if (missing.length) {
			this.pushLog(tl('message.macro.log_missing_nodes', [missing.join(', ')]));
			return false;
		}
		// 直接跑底层实现：`unselect_all` / `delete` 这类动作的界面条件会被残留对话框挡住
		SharedActions.run('unselect_all');
		// 反馈#355：不能逐个调用 `node.select()`——它每调一次都会先取消其它选中项（录制的多选
		// 最后只剩一个节点），并且在默认设置 `outliner_reveal_on_select` 下每调一次都排一个
		// 大纲自动滚动动画，几百个节点连发时大纲会来回猛抖（回放「全选」后的步骤就是这个现象）。
		// 这里按节点直接标记选中，最后统一 `updateSelection()`，选区与滚动位置都与数量无关。
		for (let node of nodes) {
			if (node instanceof Group) node.multiSelect();
			else node.markAsSelected();
		}
		for (let group of groups) group.multiSelect();
		updateSelection();
		return true;
	},
	exportToPath(step: MacroStep, context: {file?: string, name?: string} | null) {
		if (!isApp) {
			this.pushLog(tl('message.macro.log_desktop_only', [this.stepLabel(step)]));
			return;
		}
		if (!step.path) {
			this.pushLog(tl('message.macro.log_export_no_path', [this.stepLabel(step)]));
			return;
		}
		let codec = (step.codec_id ? Codecs[step.codec_id] : null) ?? Format.codec;
		if (!codec) {
			this.pushLog(tl('message.macro.log_export_no_codec', [this.stepLabel(step)]));
			return;
		}
		let path = this.resolvePath(step.path, context);
		try {
			Blockbench.writeFile(path, {content: codec.compile()}, written => {
				this.pushLog(tl('message.macro.log_exported', [written]));
			});
		} catch (error) {
			this.pushLog(tl('message.macro.log_export_failed', [String(error)]));
		}
	},
	screenshotToPath(step: MacroStep, context: {file?: string, name?: string} | null) {
		if (!isApp) {
			this.pushLog(tl('message.macro.log_desktop_only', [this.stepLabel(step)]));
			return;
		}
		if (!step.path) {
			this.pushLog(tl('message.macro.log_export_no_path', [this.stepLabel(step)]));
			return;
		}
		let path = this.resolvePath(step.path, context);
		try {
			Preview.selected.screenshot({}, (dataurl: string) => {
				Blockbench.writeFile(path, {content: dataurl, savetype: 'image'}, written => {
					this.pushLog(tl('message.macro.log_exported', [written]));
				});
			});
		} catch (error) {
			this.pushLog(tl('message.macro.log_export_failed', [String(error)]));
		}
	},
	async runStep(step: MacroStep) {
		let context = this.current_context;
		// 回放是无人值守的：上一步残留的对话框会让后续动作的界面条件恒为假（删除、选择类动作
		// 都要求 `!Dialog.open`），静默跳过整段步骤。这里先关掉它并留日志。
		if (Dialog.open) {
			this.pushLog(tl('message.macro.log_dialog_closed', [Dialog.open.id]));
			Dialog.open.cancel();
			await wait(30);
		}
		if (step.type == 'mode') {
			let mode = Modes.options[step.id ?? ''];
			if (mode) mode.select();
			else this.pushLog(tl('message.macro.log_missing_mode', [step.id ?? '']));
			await wait(60);
			return;
		}
		if (step.type == 'export') {
			this.exportToPath(step, context);
			await wait(60);
			return;
		}
		if (step.type == 'screenshot') {
			this.screenshotToPath(step, context);
			await wait(60);
			return;
		}
		if (step.selection && !this.applySelection(step.selection)) {
			this.pushLog(tl('message.macro.log_skipped_selection', [this.stepLabel(step)]));
			return;
		}
		let item = (step.id ? BarItems[step.id] : null) as unknown as TriggerableBarItem | null;
		if (!item) {
			this.pushLog(tl('message.macro.log_missing_action', [step.id ?? '']));
			return;
		}
		if (step.value !== undefined && typeof item.set == 'function') {
			item.set(step.value);
		}
		if (!Condition(item.condition)) {
			this.pushLog(tl('message.macro.log_skipped_condition', [this.stepLabel(step)]));
			return;
		}
		item.trigger();
		// 动作可能同步弹对话框、也可能异步继续：给后续流程一点时间
		await wait((step.form || step.component_state) ? 120 : 60);
	},
	async play(context: {file?: string, name?: string} | null = null) {
		if (this.playing) return;
		if (this.recording) this.stop();
		if (!this.steps.length) {
			Blockbench.showQuickMessage(tl('message.macro.empty'), 2000);
			return;
		}
		this.installHooks();
		this.playing = true;
		this.current_context = context;
		this.clearLog();
		try {
			for (let i = 0; i < this.steps.length; i++) {
				this.step_index = i;
				this.current_step = this.steps[i];
				this.changed();
				await this.runStep(this.steps[i]);
			}
		} finally {
			this.current_step = null;
			this.step_index = -1;
			this.playing = false;
			this.current_context = null;
			this.changed();
		}
		Blockbench.showQuickMessage(tl('message.macro.played', [this.steps.length]), 2500);
	},
	/** 批量：文件夹里全部 .bbmodel 逐个打开后重放同一套步骤 */
	async playBatch() {
		if (!isApp) {
			Blockbench.showQuickMessage(tl('message.macro.batch_desktop_only'), 2500);
			return;
		}
		if (!this.steps.length) {
			Blockbench.showQuickMessage(tl('message.macro.empty'), 2000);
			return;
		}
		let directory = Blockbench.pickDirectory({resource_id: 'macro_batch', title: tl('action.macro_batch')});
		if (!directory) return;
		let separator = directory.includes('\\') ? '\\' : '/';
		if (!directory.endsWith(separator)) directory += separator;
		let files: string[] = [];
		try {
			files = fs.readdirSync(directory).filter((file: string) => file.toLowerCase().endsWith('.bbmodel'));
		} catch (error) {
			this.pushLog(tl('message.macro.log_batch_failed', [String(error)]));
			return;
		}
		if (!files.length) {
			Blockbench.showQuickMessage(tl('message.macro.batch_no_files'), 2500);
			return;
		}
		this.clearLog();
		for (let i = 0; i < files.length; i++) {
			let file_path = directory + files[i];
			Blockbench.setStatusBarText(tl('message.macro.batch_progress', [i + 1, files.length, files[i]]));
			Blockbench.setProgress(i / files.length);
			try {
				// 工程编码器的 parse 吃的是「已解析的对象」（见 auto_backup / edit_sessions 的用法），
				// 传字符串会被当成无效模型文件并弹出错误框；而且它是往**当前工程**里载入，
				// 所以先按文件里的模型格式建一个干净工程，否则上一批模型的内容会累加到下一个模型里。
				let data = JSON.parse(fs.readFileSync(file_path, 'utf8'));
				if (Blockbench.Project instanceof ModelProject) Blockbench.Project.saved = true;
				newProject(Formats[readModelFormat(data) ?? ''] ?? Formats.free);
				Codecs.project.parse(data, file_path);
				if (Blockbench.Project instanceof ModelProject) Blockbench.Project.saved = true;
			} catch (error) {
				this.pushLog(tl('message.macro.log_batch_failed', [files[i] + ': ' + String(error)]));
				continue;
			}
			await this.play({file: file_path, name: files[i].replace(/\.bbmodel$/i, '')});
		}
		Blockbench.setProgress(0);
		Blockbench.setStatusBarText('');
		this.pushLog(tl('message.macro.batch_done', [files.length]));
	},

	// MARK: 文件
	serialize(): MacroFile {
		return {
			name: this.macro_name,
			format: MACRO_FORMAT,
			version: MACRO_VERSION,
			created: Date.now(),
			steps: this.steps.slice(),
		};
	},
	save() {
		if (!this.steps.length) {
			Blockbench.showQuickMessage(tl('message.macro.empty'), 2000);
			return;
		}
		Blockbench.export({
			resource_id: 'macro',
			type: tl('macro.file_type'),
			extensions: [MACRO_FORMAT],
			name: (this.macro_name || 'macro') + '.' + MACRO_FORMAT,
			content: JSON.stringify(this.serialize(), null, 2),
		});
	},
	load() {
		Blockbench.import({
			resource_id: 'macro',
			type: tl('macro.file_type'),
			extensions: [MACRO_FORMAT, 'json'],
			readtype: 'text',
		}, files => {
			if (!files?.length) return;
			let content = files[0].content;
			if (typeof content != 'string') return;
			try {
				let steps = readMacroFile(content);
				if (this.recording) this.stop();
				this.steps = steps;
				this.clearLog();
				Blockbench.showQuickMessage(tl('message.macro.loaded', [steps.length]), 2500);
			} catch (error) {
				Blockbench.showQuickMessage(tl('message.macro.load_failed'), 3000);
			}
			this.changed();
		});
	},

	// MARK: 显示
	stepLabel(step: MacroStep): string {
		if (step.type == 'export') return tl('macro.step.export') + ' → ' + (step.path ?? '');
		if (step.type == 'screenshot') return tl('macro.step.screenshot') + ' → ' + (step.path ?? '');
		if (step.type == 'mode') return tl('macro.step.mode') + ': ' + tl(step.name ?? '');
		return tl(step.name ?? '') || (step.id ?? '');
	},
	stepIcon(step: MacroStep): string {
		if (step.type == 'export') return 'save_alt';
		if (step.type == 'screenshot') return 'photo_camera';
		if (step.type == 'mode') return 'dashboard';
		return 'play_circle_outline';
	},
};

declare global {
	interface Window {
		MacroRecorder: typeof MacroRecorder
	}
}
Object.assign(window, {MacroRecorder});

// MARK: 面板
Interface.definePanels(() => {
	new Panel('macro', {
		icon: 'done_all',
		growable: true,
		resizable: true,
		optional: true,
		default_position: {
			slot: 'hidden',
			float_position: [0, 0],
			float_size: [320, 360],
			height: 260,
			folded: false,
			sidebar_index: 10,
		},
		toolbars: [
			new Toolbar('macro_panel', {
				children: ['macro_record', 'macro_play', 'macro_batch', 'macro_save', 'macro_load', 'macro_clear'],
			}),
		],
		component: {
			name: 'panel-macro',
			data() {
				return {
					recorder: MacroRecorder,
				};
			},
			methods: {
				t(key: string) {
					return tl(key);
				},
				label(step: MacroStep) {
					return MacroRecorder.stepLabel(step);
				},
				icon(step: MacroStep) {
					return MacroRecorder.stepIcon(step);
				},
				hasPath(step: MacroStep) {
					return step.type == 'export' || step.type == 'screenshot';
				},
				remove(index: number) {
					MacroRecorder.removeStep(index);
				},
				move(index: number, offset: number) {
					MacroRecorder.moveStep(index, offset);
				},
				setPath(index: number, event: Event) {
					MacroRecorder.setStepPath(index, (event.target as HTMLInputElement).value);
				},
			},
			template: `
				<div id="macro_panel">
					<p class="macro_status" v-if="recorder.recording">
						<i class="material-icons">fiber_manual_record</i>
						{{ t('macro.recording') }}
					</p>
					<ul class="list macro_steps" v-if="recorder.steps.length">
						<li
							v-for="(step, index) in recorder.steps"
							:key="index"
							class="macro_step"
							:class="{playing: index === recorder.step_index}"
						>
							<span class="macro_step_index">{{ index + 1 }}</span>
							<i class="material-icons macro_step_icon">{{ icon(step) }}</i>
							<span class="macro_step_label">{{ label(step) }}</span>
							<input
								v-if="hasPath(step)"
								class="macro_step_path"
								type="text"
								:value="step.path || ''"
								:placeholder="t('macro.path_placeholder')"
								@change="setPath(index, $event)"
							>
							<span class="macro_step_controls">
								<i class="material-icons" @click="move(index, -1)">arrow_upward</i>
								<i class="material-icons" @click="move(index, 1)">arrow_downward</i>
								<i class="material-icons" @click="remove(index)">delete</i>
							</span>
						</li>
					</ul>
					<p class="macro_hint" v-else>{{ t('macro.empty_hint') }}</p>
					<p class="macro_hint">{{ t('macro.path_hint') }}</p>
					<ul class="macro_log" v-if="recorder.log.length">
						<li v-for="(line, index) in recorder.log.slice(-6)" :key="index">{{ line }}</li>
					</ul>
				</div>
			`,
		},
	});
});

// MARK: 动作
BARS.defineActions(() => {
	new Action('macro_record', {
		name: 'action.macro_record',
		icon: 'fiber_manual_record',
		category: 'tools',
		condition: () => !!Project,
		click() {
			MacroRecorder.toggleRecord();
		},
	});
	new Action('macro_play', {
		name: 'action.macro_play',
		icon: 'play_arrow',
		category: 'tools',
		condition: () => !!Project && !MacroRecorder.playing,
		click() {
			MacroRecorder.play();
		},
	});
	new Action('macro_batch', {
		name: 'action.macro_batch',
		icon: 'folder_copy',
		category: 'tools',
		condition: () => isApp && !MacroRecorder.playing,
		click() {
			MacroRecorder.playBatch();
		},
	});
	new Action('macro_save', {
		name: 'action.macro_save',
		icon: 'save',
		category: 'tools',
		click() {
			MacroRecorder.save();
		},
	});
	new Action('macro_load', {
		name: 'action.macro_load',
		icon: 'folder_open',
		category: 'tools',
		click() {
			MacroRecorder.load();
		},
	});
	new Action('macro_clear', {
		name: 'action.macro_clear',
		icon: 'delete_sweep',
		category: 'tools',
		click() {
			MacroRecorder.clear();
		},
	});
});
