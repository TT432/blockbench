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
 *   里的原始值（含曲线点这类嵌套的数组/对象，反馈#368），回放时写回后触发组件的
 *   `change()` 再确认，效果与录制时一致。
 * - **选择状态**：每一步记下当时选中的组/元素名字，回放前按名字重建选区——所以「删掉 root 组」
 *   这类步骤换到别的模型上仍然删的是那个同名组；名字一个都对不上时跳过该步骤并记日志，
 *   不会拿别的选中物去执行删除。录到的是「全选」时只记这个意图（反馈#359），回放时按全选
 *   重建，不比对节点名——「全选 → 创建材质」这类批量操作才不会在每个模型上都被跳过。
 * - **导出与截屏**：录制时记下实际落盘的路径（导出 → `export` 步骤，图片 → `screenshot` 步骤），
 *   路径里可以用 `${name}`（模型名）与 `${file}`（模型文件路径）占位；批量处理时按模型替换，
 *   因此一套宏可以给整批模型各自输出到不同文件。文件名整段换成 `${name}`、只保留扩展名
 *   （反馈#361）：用户改过的固定文件名会让整批模型互相顶掉。
 * - **GIF 录制**（反馈#358）：录制模型 GIF 的「设置对话框 → 点录制按钮 → 保存」整串记成一个
 *   `gif` 步骤：对话框参数照常录，点录制按钮那一刻记下帧数与耗时，保存时记下落盘路径。
 *   回放时走同一套代码（打开设置对话框 → 开始录制 → 等录到同样帧数 → 结束 → 写盘），
 *   于是批量处理里每个模型各出一份 GIF。
 * - **取景**（反馈#367）：截屏与 GIF 步骤回放前先把视角框到整个模型（与开始界面缩略图同一套
 *   取景思路：包围盒居中 + 按尺寸定距离/缩放），模型比初始视场大时不会被裁掉。
 * - **模式切换**：编辑/绘制/动画模式切换记成独立步骤，回放按录制顺序切换。
 *
 * ## 回放
 * - 顺序执行，每步都等它真正做完（对话框关闭 + undo 事务结束 + 异步贴图生成结束）再走下一步
 *   （反馈#365）。面板高亮当前步骤，失败/跳过的步骤写进面板日志。
 * - 可以用面板上的「停止」按钮中途取消回放/批量（反馈#362）：取消后当前步骤做完就退出，
 *   残留状态（播放标记、工具栏按钮）一定会复位，不会把面板卡在播放态。
 * - 面板里的步骤改动（删除/移动/清空/载入）都可以用「撤销面板操作」撤回一步（反馈#362），
 *   它与工程 undo 历史无关——宏步骤不是工程数据，混进工程 undo 会把模型一起回退。
 * - 批量：选一个文件夹，逐个打开其中的 `.bbmodel` 后重放同一套步骤，导出/截屏按占位符
 *   替换后的路径写盘。打开后等模型载入（贴图解码）完成再重放，否则截图是空白（反馈#363）。
 *   宏里没有导出步骤时批量只改内存里的模型，不会回写原文件。
 */
import { fs } from "../native_apis";
import type { FormResultValue } from "./form";

export type MacroStepType = 'action' | 'mode' | 'export' | 'screenshot' | 'gif';
/**
 * 组件式对话框的参数字面量：只记可 JSON 化的原始数据结构，对象（纹理列表、画布等）回放时由
 * 动作自己重建。数组/对象在这里是有意义的（反馈#368）：曲线调整的 `graphs.rgb.points` 就是
 * 二维数组，只记原始标量会把「调整了什么曲线」丢掉。
 */
export type MacroComponentValue = string | number | boolean | MacroComponentValue[] | {[key: string]: MacroComponentValue};

export interface MacroSelection {
	groups: string[]
	elements: {name: string, type: string}[]
	/**
	 * 录制时选区就是「全选」（反馈#359）：回放时按全选重建，不按名字逐个匹配。
	 * 名字只对录制它的那个模型有意义，全选对任何模型都等价，所以这里存意图而不是节点。
	 */
	all?: boolean
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
	/**
	 * gif（反馈#358）：录制时实际录到的帧数与耗时。回放按帧数判断何时结束录制——
	 * 用户提前点了停止的宏，回放也在同样的位置停下，GIF 长度与录制时一致。
	 */
	frames?: number
	duration?: number
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
	macro_batch: true, macro_clear: true, macro_stop: true, macro_undo: true,
	undo: true, redo: true,
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
 * `Screencam.createGif` 在录制浮层上暴露的控制接口（反馈#358）：回放时用录制时同一套开始/结束
 * 函数，而不是去模拟点击浮层里的按钮。
 */
interface GifRecordingControl {
	start(): void
	stop(): void
	is_recording(): boolean
	frames(): number
}
/**
 * 这里只用 `Screencam` 的两个成员。走 `window.Screencam` 而不是 import：`screenshot.js` 是
 * 早期模块，把它拉进 `macro_recorder` 的依赖链会改掉整包的模块求值顺序（实测会让 settings /
 * keybinds 在初始化期读到未定义的值）。
 */
interface ScreencamApi {
	returnScreenshot(dataUrl: string, callback?: (url: string) => void, blob?: Blob): void
	gif_control: GifRecordingControl | null
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
/**
 * 录制时的选区是否等于「全选」（反馈#359）。判定口径与 `SharedActions.select_all` 一致：
 * 全部未锁定元素 + 全部根组。全选状态下节点名字对别的模型毫无意义，照原样录下来会让
 * 「全选 → 创建材质」这类批量操作在每个模型上都因为名字对不上而被跳过。
 */
function isEverythingSelected(selection: MacroSelection): boolean {
	if (typeof Outliner == 'undefined') return false;
	let selectable_elements = Outliner.elements.filter(element => !element.isEffectivelyLocked());
	let root_groups = Outliner.root.filter(node => node instanceof Group);
	if (!selectable_elements.length && !root_groups.length) return false;
	if (selection.elements.length != selectable_elements.length) return false;
	if (selection.groups.length != root_groups.length) return false;
	let element_keys = new Set(selectable_elements.map(element => element.type + ':' + element.name));
	if (!selection.elements.every(entry => element_keys.has(entry.type + ':' + entry.name))) return false;
	let group_names = new Set(root_groups.map(group => group.name));
	return selection.groups.every(name => group_names.has(name));
}
function snapshotSelection(): MacroSelection {
	let selection: MacroSelection = {groups: [], elements: []};
	if (typeof Outliner == 'undefined') return selection;
	selection.groups = Group.multi_selected.map(group => group.name);
	selection.elements = Outliner.selected.map(element => ({name: element.name, type: element.type}));
	if (isEverythingSelected(selection)) selection.all = true;
	return selection;
}
/**
 * 组件式对话框（反馈#356/#368）的参数快照：只收 `content_vue` data 里能 JSON 化的值。
 * 纹理列表、画布、三维对象、对话框自身的引用一律跳过——它们由动作在回放时重新构造，
 * 记下来既无意义又会让 `.bbmacro` 反序列化后指向旧对象。
 */
function clonePlainValue(value: unknown, depth = 0): MacroComponentValue | undefined {
	if (typeof value == 'string' || typeof value == 'number' || typeof value == 'boolean') return value;
	if (depth > 8) return undefined;
	if (value instanceof Array) {
		let result: MacroComponentValue[] = [];
		for (let entry of value) {
			let cloned = clonePlainValue(entry, depth + 1);
			// 数组里混着对象（纹理、画布）时整段丢弃：保留一半会让 `points` 这类
			// 有结构意义的数据变成残缺数组，回放时算出来的曲线和录制时完全不同
			if (cloned === undefined) return undefined;
			result.push(cloned);
		}
		return result;
	}
	if (value && typeof value == 'object') {
		let prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return undefined;
		let result: {[key: string]: MacroComponentValue} = {};
		for (let key in value as Record<string, unknown>) {
			let cloned = clonePlainValue((value as Record<string, unknown>)[key], depth + 1);
			if (cloned !== undefined) result[key] = cloned;
		}
		return result;
	}
	return undefined;
}
function snapshotComponentState(vue: unknown): Record<string, MacroComponentValue> | undefined {
	if (!vue || typeof vue != 'object' || !('$data' in vue)) return undefined;
	let data = (vue as {$data: Record<string, unknown>}).$data;
	if (!data || typeof data != 'object') return undefined;
	let state: Record<string, MacroComponentValue> = {};
	let count = 0;
	for (let key in data) {
		let cloned = clonePlainValue(data[key]);
		if (cloned === undefined) continue;
		state[key] = cloned;
		count++;
	}
	return count ? state : undefined;
}
/**
 * 把录制下来的落盘路径里的文件名整段换成 `${name}` 占位符，只保留目录和扩展名（反馈#361）。
 * 导出/截屏默认文件名就是模型名，而用户改过的文件名（`render.png`、`output.geo.json`）
 * 照原样记下来会让整批模型都写同一个文件、互相顶掉；批量处理的意义就是每个模型各出一份。
 * 扩展名按「文件名里第一个点之后」保留，`ModelA.geo.json` 这类多段扩展名不会丢。
 */
function replaceFileNameWithPlaceholder(path: string): string {
	let separator_index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	let filename = path.slice(separator_index + 1);
	if (!filename) return path;
	let extension_index = filename.indexOf('.');
	let suffix = extension_index < 0 ? '' : filename.slice(extension_index);
	return path.slice(0, separator_index + 1) + '${name}' + suffix;
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
	/** 回放被用户取消（反馈#362）：当前步骤做完后退出，批量也停止 */
	cancel_requested: false,
	/** 正在回放的步骤下标，-1 = 没在回放 */
	step_index: -1,
	steps: [] as MacroStep[],
	macro_name: 'macro',
	/** 回放/批量的过程记录，面板只显示最后几条 */
	log: [] as string[],
	/** 面板步骤操作的历史快照（反馈#362）：清空/删除/移动/载入前压栈，供「撤销面板操作」还原 */
	panel_history: [] as MacroStep[][],
	/** 录制中：最近一步动作，用来挂对话框表单与导出路径 */
	pending_step: null as MacroStep | null,
	/** 录制中：gif 录制开始的时刻（回放按耗时/帧数对齐录制长度） */
	gif_started_at: 0,
	/** 回放 gif 步骤：本次录制是否已经产出结果（写盘或交给导出拦截） */
	gif_done: false,
	/** 回放中：当前步骤（对话框自动填表要用） */
	current_step: null as MacroStep | null,
	current_context: null as {file?: string, name?: string} | null,
	action_listeners: [] as Deletable[],
	mode_listener: null as Deletable | null,
	hooks_installed: false,

	pushLog(line: string) {
		// 同一条消息连着出现时不再重复（反馈#362）：批量/回放里每个被跳过的步骤都会产生同一条
		// 「节点不存在」，照原样逐条堆叠会把面板刷成一整屏重复文本
		if (this.log[this.log.length - 1] !== line) this.log.push(line);
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
	/**
	 * 压一份步骤快照供「撤销面板操作」还原（反馈#362）。只记面板里的步骤表，不碰工程 undo
	 * 历史——宏步骤不属于工程数据，混进 undo 会把模型改动一起回退。
	 */
	snapshotSteps() {
		this.panel_history.push(this.steps.map(step => ({...step})));
		if (this.panel_history.length > 20) this.panel_history.shift();
	},
	undoPanel() {
		let previous = this.panel_history.pop();
		if (!previous) return;
		this.steps = previous;
		this.pending_step = null;
		this.changed();
	},

	// MARK: 录制
	start() {
		if (this.playing || this.recording) return;
		this.installHooks();
		this.recording = true;
		this.subscribeActions();
		Blockbench.showQuickMessage(tl('message.macro.recording_started'), 2000);
		this.changed();
		this.refreshToolbar();
	},
	stop() {
		if (!this.recording) return;
		this.recording = false;
		this.unsubscribeActions();
		this.pending_step = null;
		Blockbench.showQuickMessage(tl('message.macro.recording_stopped', [this.steps.length]), 2500);
		this.changed();
		this.refreshToolbar();
	},
	toggleRecord() {
		if (this.recording) this.stop();
		else this.start();
	},
	clear() {
		if (this.recording) this.stop();
		// 回放中点清空：已经跑起来的循环必须一起停，否则它会继续往清空后的面板里写日志
		// （反馈#362 的图：步骤表空了、日志还在刷）
		if (this.playing) this.cancelPlayback();
		this.snapshotSteps();
		this.steps = [];
		this.pending_step = null;
		this.clearLog();
		this.changed();
	},
	removeStep(index: number) {
		if (index < 0 || index >= this.steps.length) return;
		this.snapshotSteps();
		this.steps.splice(index, 1);
		this.changed();
	},
	moveStep(index: number, offset: number) {
		let target = index + offset;
		if (index < 0 || index >= this.steps.length) return;
		if (target < 0 || target >= this.steps.length) return;
		this.snapshotSteps();
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
	/** 取消回放（反馈#362）：当前步骤做完就退出，播放标记与工具栏在 finally 里复位 */
	cancelPlayback() {
		if (!this.playing) return;
		this.cancel_requested = true;
		this.pushLog(tl('message.macro.log_cancelled'));
		this.refreshToolbar();
	},

	// MARK: GIF 录制（反馈#358）
	/**
	 * GIF 浮层里的「录制」按钮被点下时由 `Screencam` 回调过来：把当前这一步（`record_model_gif`
	 * 动作 + 设置对话框参数）改成 `gif` 步骤，并开始记帧数与耗时。回放时走同一套开始/结束函数。
	 */
	onGifRecordingStart() {
		if (!this.recording) return;
		let step = this.pending_step;
		if (!step || step.type != 'action' || step.id != 'record_model_gif') return;
		step.type = 'gif';
		step.frames = 0;
		step.duration = 0;
		this.gif_started_at = performance.now();
		this.changed();
	},
	/** GIF 录制结束：记下实际帧数与耗时；用户取消（没录到结果）就把这一步整个去掉 */
	onGifRecordingEnd(data: {render?: boolean, frames?: number}) {
		if (!this.recording) return;
		let step = this.pending_step;
		if (!step || step.type != 'gif') return;
		if (!data?.render) {
			this.dropPendingStep();
			return;
		}
		step.frames = data.frames ?? 0;
		step.duration = Math.max(0, Math.round(performance.now() - this.gif_started_at));
		this.changed();
	},
	/** 去掉正在录制的最后一步（用户取消了这次 GIF 录制，录制结果没有产生任何东西） */
	dropPendingStep() {
		let step = this.pending_step;
		if (!step) return;
		let index = this.steps.indexOf(step);
		if (index >= 0) this.steps.splice(index, 1);
		this.pending_step = null;
		this.changed();
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
			// 回放 gif 步骤时没有人在旁边点「保存」：导出请求直接落到步骤记录的路径上
			// （PNG 序列这类走 Blockbench.export 的 GIF 格式也一并覆盖，反馈#358）
			if (MacroRecorder.playing && MacroRecorder.current_step?.type == 'gif' && MacroRecorder.current_step.path) {
				MacroRecorder.writePlaybackExport(options, callback);
				return;
			}
			return original_export.call(Blockbench, options, path => {
				MacroRecorder.onExported(path, options);
				if (typeof callback == 'function') callback(path);
			});
		};

		// GIF/APNG 编码完不经过 Blockbench.export，而是把 dataURL 交给预览对话框；
		// 回放时在这里截住，直接写盘（反馈#358）
		let original_return = window.Screencam.returnScreenshot;
		window.Screencam.returnScreenshot = function (dataUrl: string, callback?: (url: string) => void, blob?: Blob) {
			if (MacroRecorder.playing && MacroRecorder.current_step?.type == 'gif') {
				MacroRecorder.writeGifResult(dataUrl);
				return;
			}
			return original_return.call(window.Screencam, dataUrl, callback, blob);
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
		// 已经记成 gif 步骤的只要能录到产物路径就行（GIF/APNG 走 binary，PNG 序列走 zip）
		if (step && step.type == 'gif') {
			step.path = replaceFileNameWithPlaceholder(path);
			this.changed();
			return;
		}
		if (!step || step.type != 'action') return;
		if (!isExportAction(step.id ?? '')) {
			this.pushLog(tl('message.macro.log_export_untracked', [path]));
			return;
		}
		if (options?.savetype == 'image') {
			step.type = 'screenshot';
			step.path = replaceFileNameWithPlaceholder(path);
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
		step.path = replaceFileNameWithPlaceholder(path);
		this.changed();
	},

	// MARK: 回放
	resolvePath(path: string, context: {file?: string, name?: string} | null): string {
		// 用 `||` 而不是 `??`：新建工程的名字可能是空字符串，空名字会让 `${name}` 变成空串、
		// 产出 `D:\out\.gif` 这种文件名，退回默认名更安全
		let model_name = context?.name || Project?.name || 'model';
		return path
			.replace(/\$\{name\}/g, model_name)
			.replace(/\$\{file\}/g, context?.file ?? '');
	},
	/**
	 * 按录制的名字重建选区。录制时没选中任何东西、或录制的节点**全部**都在时返回 true。
	 * 只命中一部分时不执行该步骤：拿别的选中物去跑删除/剪切这类动作，改的就是另一个模型了；
	 * 批量处理里「有的模型没有 root 组」正是靠这条规则变成「跳过并记日志」。
	 * 录的是「全选」时按意图重建（反馈#359）：名字只对录制的那个模型有意义，
	 * 全选对任何模型都等价，不该因为节点名不同就把整个步骤跳过。
	 */
	applySelection(selection: MacroSelection): boolean {
		if (selection.all) {
			SharedActions.run('unselect_all');
			SharedActions.run('select_all');
			updateSelection();
			return true;
		}
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
			// 只列前几个名字（反馈#362）：全选录制的大模型一次能有几百个名字，
			// 原样拼进一行会把面板刷成十几行滚动文本，反而看不出问题在哪
			let preview = missing.slice(0, 6).join(', ');
			if (missing.length > 6) preview += ` …(+${missing.length - 6})`;
			this.pushLog(tl('message.macro.log_missing_nodes', [preview]));
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
			this.fitPreviewToModel();
			Preview.selected.screenshot({}, (dataurl: string) => {
				Blockbench.writeFile(path, {content: dataurl, savetype: 'image'}, written => {
					this.pushLog(tl('message.macro.log_exported', [written]));
				});
			});
		} catch (error) {
			this.pushLog(tl('message.macro.log_export_failed', [String(error)]));
		}
	},
	/**
	 * 把当前预览视角框到整个模型（反馈#367）。录制时不会记录相机（画布上的转视角/缩放手势
	 * 不在录制范围内），回放到别的模型上时视角还是那个模型的构图，大模型就被裁在画面外。
	 * 这里沿用开始界面缩略图的取景思路：包围盒居中，再按模型尺寸定相机距离（透视）或缩放
	 * （正交），保持用户当前的观察方向不变。
	 */
	fitPreviewToModel() {
		if (typeof Preview == 'undefined' || !Preview.selected || typeof Canvas == 'undefined') return;
		let preview = Preview.selected;
		let box = Canvas.getModelBoundingBox();
		if (box.isEmpty()) return;
		let center = box.getCenter(new THREE.Vector3());
		let size = box.getSize(new THREE.Vector3());
		// 半对角线当包围球半径：任何朝向下都能装下整个模型
		let radius = Math.max(size.length() / 2, 0.5);
		let camera = preview.camera;
		let target = preview.controls.target;
		let direction = camera.position.clone().sub(target);
		if (direction.lengthSq() < 1e-6) direction.set(1, 1, 1);
		direction.normalize();
		target.copy(center);
		if (preview.isOrtho) {
			// 正交：`updateSize` 按面板尺寸把 top/right 设成 h/80、w/80，可视半高 = top / zoom
			let half_height = Math.max(camera.top, 1e-6);
			let half_width = Math.max(camera.right, 1e-6);
			camera.zoom = Math.min(half_height, half_width) / radius * 0.82;
			camera.position.copy(center).add(direction.multiplyScalar(Math.max(camera.position.distanceTo(center), radius * 4)));
			camera.updateProjectionMatrix();
		} else {
			let aspect = camera.aspect || (preview.width / Math.max(preview.height, 1));
			let vertical_fov = (camera.fov || 42) * Math.PI / 180;
			let horizontal_fov = 2 * Math.atan(Math.tan(vertical_fov / 2) * aspect);
			let distance = radius / Math.sin(Math.min(vertical_fov, horizontal_fov) / 2) * 1.15;
			camera.position.copy(center).add(direction.multiplyScalar(distance));
			camera.updateProjectionMatrix();
		}
		camera.lookAt(center);
		preview.controls.update?.();
		preview.render();
	},
	/** 回放 gif 步骤：把编码结果写到步骤路径（反馈#358） */
	writeGifResult(dataUrl: string) {
		let step = this.current_step;
		this.gif_done = true;
		if (!step) return;
		if (!isApp) {
			this.pushLog(tl('message.macro.log_desktop_only', [this.stepLabel(step)]));
			return;
		}
		if (!step.path) {
			this.pushLog(tl('message.macro.log_export_no_path', [this.stepLabel(step)]));
			return;
		}
		let path = this.resolvePath(step.path, this.current_context);
		try {
			Blockbench.writeFile(path, {content: dataUrl, savetype: 'image'}, written => {
				this.pushLog(tl('message.macro.log_exported', [written]));
			});
		} catch (error) {
			this.pushLog(tl('message.macro.log_export_failed', [String(error)]));
		}
	},
	/** 回放 gif 步骤里走 `Blockbench.export` 的格式（PNG 序列）：跳过保存对话框直接写盘 */
	writePlaybackExport(options: {content?: unknown, savetype?: unknown}, callback?: (path: string) => void) {
		let step = this.current_step;
		this.gif_done = true;
		if (!step?.path) return;
		let path = this.resolvePath(step.path, this.current_context);
		try {
			Blockbench.writeFile(path, {content: options?.content as string, savetype: options?.savetype as 'binary'}, written => {
				this.pushLog(tl('message.macro.log_exported', [written]));
				if (typeof callback == 'function') callback(written);
			});
		} catch (error) {
			this.pushLog(tl('message.macro.log_export_failed', [String(error)]));
		}
	},
	/** GIF 浮层出现前先等一小会儿（`createGif` 在对话框确认后才建浮层） */
	async waitForGifControl() {
		let control = (): GifRecordingControl | null => window.Screencam?.gif_control ?? null;
		let deadline = performance.now() + 3000;
		while (!control() && performance.now() < deadline) await wait(20);
		return control();
	},
	/**
	 * 回放 gif 步骤：打开录制模型 GIF 的设置对话框（表单由 `onDialogShown` 自动填写并确认）→
	 * 用录制时同一个开始函数开始录制 → 录到同样的帧数 → 结束。编码结果由
	 * `Screencam.returnScreenshot` / `Blockbench.export` 钩子直接写盘（反馈#358）。
	 */
	async replayGifStep(step: MacroStep) {
		let item = (step.id ? BarItems[step.id] : null) as unknown as TriggerableBarItem | null;
		if (!item) {
			this.pushLog(tl('message.macro.log_missing_action', [step.id ?? '']));
			return;
		}
		if (!Condition(item.condition)) {
			this.pushLog(tl('message.macro.log_skipped_condition', [this.stepLabel(step)]));
			return;
		}
		if (!step.path) {
			this.pushLog(tl('message.macro.log_export_no_path', [this.stepLabel(step)]));
			return;
		}
		this.fitPreviewToModel();
		this.gif_done = false;
		item.trigger();
		await this.waitForStepSettled(step);
		let control = await this.waitForGifControl();
		if (!control) {
			this.pushLog(tl('message.macro.log_gif_control_missing', [this.stepLabel(step)]));
			return;
		}
		control.start();
		let target_frames = step.frames ?? 0;
		let stall_deadline = performance.now() + Math.max(step.duration ?? 0, 1000) + 30000;
		while (control.is_recording?.() && (control.frames?.() ?? 0) < target_frames && performance.now() < stall_deadline) {
			await wait(20);
		}
		if (control.is_recording?.()) control.stop();
		// 等编码与写盘：GIF/APNG 走 returnScreenshot，PNG 序列走 Blockbench.export
		let finish_deadline = performance.now() + 120000;
		while (!this.gif_done && performance.now() < finish_deadline) await wait(50);
		if (!this.gif_done) this.pushLog(tl('message.macro.log_gif_timeout', [this.stepLabel(step)]));
		window.Screencam.gif_control = null;
		await wait(80);
	},
	/**
	 * 等本步骤真正做完再走下一步（反馈#365）。固定延时不可靠：动作可能弹对话框，确认之后
	 * 它自己的收尾仍是异步的（「创建纹理」在确认后还要生成贴图，耗时随模型大小波动），
	 * 下一步紧接着执行会把前一步打断（表现为材质刚建一半就被「一键镜像组」截断而失败）。
	 * 判定信号：先看有没有对话框弹出（有就等它关闭），再看 undo 事务是否还开着，最后看
	 * 贴图模板生成（异步、不经 undo）是否还在跑——大模型这一步能超过十秒，卡死上限只会让
	 * 下一步打断它（反馈#365 复报）。
	 */
	async waitForStepSettled(step: MacroStep) {
		let dialog_expected = !!(step.form || step.component_state);
		let probe_deadline = performance.now() + (dialog_expected ? 300 : 80);
		while (!Dialog.open && performance.now() < probe_deadline) await wait(15);
		if (Dialog.open) {
			let dialog_deadline = performance.now() + 5000;
			while (Dialog.open && performance.now() < dialog_deadline) await wait(20);
		}
		let undo_deadline = performance.now() + 30000;
		while (typeof Undo != 'undefined' && Undo.current_save && performance.now() < undo_deadline) await wait(20);
		if (typeof Undo != 'undefined' && Undo.current_save) {
			this.pushLog(tl('message.macro.log_settle_timeout', [this.stepLabel(step)]));
		}
		let generation_deadline = performance.now() + 120000;
		while (typeof TextureGenerator != 'undefined' && TextureGenerator.pending_generations > 0
			&& performance.now() < generation_deadline) {
			await wait(50);
		}
		await wait(40);
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
		if (step.type == 'gif') {
			try {
				await this.replayGifStep(step);
			} catch (error) {
				console.error(error);
				this.pushLog(tl('message.macro.log_step_failed', [this.stepLabel(step)]));
			}
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
		try {
			item.trigger();
			await this.waitForStepSettled(step);
		} catch (error) {
			// 单步报错不该把整段宏打断、把界面留在半路的播放态（反馈#362）：记日志后继续下一步
			console.error(error);
			this.pushLog(tl('message.macro.log_step_failed', [this.stepLabel(step)]));
		}
	},
	/**
	 * 等工程载入完成再回放（反馈#363）。批量打开模型走的是「新建工程 + 解析」，贴图是异步
	 * 解码的：解析刚返回就截图，画布上还没有内容，`autoCrop` 只能裁出 1×1 空白图。这里等所有
	 * 贴图就绪（或失败）再补一次视图更新，之后的重放（截图、导出）看到的就是已渲染的模型。
	 */
	async waitForProjectReady() {
		if (typeof Project != 'object' || typeof Canvas == 'undefined') return;
		let deadline = performance.now() + 5000;
		while (performance.now() < deadline) {
			let pending = typeof Texture != 'undefined' && Texture.all.some(texture => (
				texture.img && !texture.img.complete && !texture.error
			));
			if (!pending) break;
			await wait(50);
		}
		Canvas.updateView({elements: Project.elements, element_aspects: {transform: true, geometry: true, faces: true}});
		await wait(30);
	},
	/** 录制/播放状态会改掉工具栏按钮的显示条件，界面不会自己刷新——手动刷一次（反馈#360/#362） */
	refreshToolbar() {
		if (typeof BARS == 'undefined') return;
		BARS.updateConditions();
	},
	async play(context: {file?: string, name?: string} | null = null, reset_cancel = true) {
		if (this.playing) return;
		if (this.recording) this.stop();
		if (!this.steps.length) {
			Blockbench.showQuickMessage(tl('message.macro.empty'), 2000);
			return;
		}
		this.installHooks();
		if (reset_cancel) this.cancel_requested = false;
		this.playing = true;
		this.current_context = context;
		this.clearLog();
		this.refreshToolbar();
		try {
			// 也在 try 里：这里抛异常时 `playing` 必须复位，否则工具栏永远停在「回放中」
			// ——播放/批量按钮一起消失，面板再也回不到可用状态（反馈#362）
			await this.waitForProjectReady();
			for (let i = 0; i < this.steps.length; i++) {
				if (this.cancel_requested) break;
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
			this.refreshToolbar();
		}
		let message = this.cancel_requested ? 'message.macro.cancelled' : 'message.macro.played';
		Blockbench.showQuickMessage(tl(message, [this.steps.length]), 2500);
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
		this.cancel_requested = false;
		for (let i = 0; i < files.length; i++) {
			if (this.cancel_requested) break;
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
			// 取消标记归批量管：`play` 每轮不要把它清掉，否则「停止」只能停掉当前这一个模型
			await this.play({file: file_path, name: files[i].replace(/\.bbmodel$/i, '')}, false);
		}
		Blockbench.setProgress(0);
		Blockbench.setStatusBarText('');
		this.pushLog(tl('message.macro.batch_done', [files.length]));
		this.refreshToolbar();
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
				this.snapshotSteps();
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
		if (step.type == 'gif') {
			let parts = [tl('macro.step.gif')];
			if (step.frames) parts.push(tl('message.macro.gif_frames', [step.frames]));
			parts.push(step.path ?? tl('macro.step.gif_no_path'));
			return parts.join(' · ');
		}
		if (step.type == 'mode') return tl('macro.step.mode') + ': ' + tl(step.name ?? '');
		return tl(step.name ?? '') || (step.id ?? '');
	},
	stepIcon(step: MacroStep): string {
		if (step.type == 'export') return 'save_alt';
		if (step.type == 'screenshot') return 'photo_camera';
		if (step.type == 'gif') return 'gif_box';
		if (step.type == 'mode') return 'dashboard';
		return 'play_circle_outline';
	},
};

declare global {
	interface Window {
		MacroRecorder: typeof MacroRecorder
		Screencam: ScreencamApi
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
				children: ['macro_record', 'macro_play', 'macro_stop', 'macro_batch', 'macro_save', 'macro_load', 'macro_undo', 'macro_clear'],
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
					return step.type == 'export' || step.type == 'screenshot' || step.type == 'gif';
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
	new Action('macro_stop', {
		name: 'action.macro_stop',
		icon: 'stop',
		category: 'tools',
		// 只在回放/批量进行时出现（反馈#362）：这是从「一直在跑、只能清空宏」里脱身的出口
		condition: () => MacroRecorder.playing,
		click() {
			MacroRecorder.cancelPlayback();
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
	new Action('macro_undo', {
		name: 'action.macro_undo',
		icon: 'undo',
		category: 'tools',
		// 面板自己的步骤历史（不是工程 undo）：删除/移动/清空/载入前都留了快照（反馈#362）
		condition: () => MacroRecorder.panel_history.length > 0,
		click() {
			MacroRecorder.undoPanel();
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
