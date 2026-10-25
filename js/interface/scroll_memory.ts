// 反馈#235：可滚动页面记忆上次滚动的具体位置，并在滚动区域右上角提供「回到顶部」按钮。
// 位置只保存在内存里（进程生命周期内有效），软件重启后自然清零，不做 localStorage /
// Setting 持久化。记忆按「对话框 + 分页（或手册里的当前选择）」分键，互不覆盖。
import { Interface } from "./interface";

const scroll_positions: Record<string, number> = {};
// 超过这个距离才显示「回到顶部」按钮，避免内容刚开始滚动时就浮出控件
const BUTTON_MIN_SCROLL = 24;
// 平滑滚动期间不要记录中间位置，动画结束后再恢复记录
const SMOOTH_SCROLL_DURATION = 500;

const SCROLL_MEMORY_CSS = `
.scroll_top_area {
	position: relative;
}
.scroll_top_button {
	position: absolute;
	top: 6px;
	right: 16px;
	z-index: 3;
	display: none;
	width: 26px;
	height: 26px;
	border-radius: 50%;
	align-items: center;
	justify-content: center;
	background-color: var(--color-button);
	border: 1px solid var(--color-border);
	color: var(--color-text);
	opacity: 0.85;
	cursor: pointer;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}
.scroll_top_button.visible {
	display: flex;
}
.scroll_top_button:hover {
	background-color: var(--color-accent);
	color: var(--color-accent_text);
	opacity: 1;
}
.scroll_top_button > i {
	font-size: 18px;
	line-height: 1;
}
`;

function ensureScrollMemoryCSS() {
	if (document.getElementById('scroll_memory_css')) return;
	document.head.append(Interface.createElement('style', {id: 'scroll_memory_css'}, SCROLL_MEMORY_CSS));
}

export interface ScrollMemoryOptions {
	/** 当前内容对应的记忆键，例如 "settings/interface" */
	getKey(): string;
	/** 真正滚动的容器（不是外面加了定位的那层） */
	getContainer(): HTMLElement | null;
	/** 「回到顶部」按钮的 title 提示 */
	getLabel(): string;
	/** 搜索/过滤中：内容已被重建，不记忆也不恢复旧位置 */
	isFiltered?(): boolean;
}

export class ScrollMemory {
	private options: ScrollMemoryOptions;
	private container: HTMLElement | null = null;
	private button: HTMLElement | null = null;
	private frame: number | null = null;
	/** 用于作废上一个还没执行的恢复，只让最后一次内容变化决定位置 */
	private token = 0;
	private scrolling_to_top = false;

	constructor(options: ScrollMemoryOptions) {
		this.options = options;
	}

	/**
	 * 绑定滚动容器，并在 wrapper（需要相对定位的那层）里插入「回到顶部」按钮。
	 * 在组件的 mounted 里调用。
	 */
	attach(wrapper: HTMLElement | null): void {
		ensureScrollMemoryCSS();
		this.container = this.options.getContainer();
		if (!this.container) return;
		this.container.addEventListener('scroll', this.onScroll, {passive: true});
		if (wrapper) {
			wrapper.classList.add('scroll_top_area');
			this.button = Interface.createElement('div', {
				class: 'scroll_top_button',
				title: this.options.getLabel(),
			}, Interface.createElement('i', {class: 'material-icons'}, 'arrow_upward'));
			this.button.addEventListener('click', () => this.toTop());
			wrapper.append(this.button);
		}
		this.update();
	}

	/** 把当前滚动位置记到当前分页的键上。切换分页/内容前调用。 */
	save(): void {
		if (!this.container || this.scrolling_to_top) return;
		if (this.options.isFiltered?.()) return;
		scroll_positions[this.options.getKey()] = this.container.scrollTop;
	}

	/**
	 * 内容重建后恢复位置。必须等 DOM 更新完再调用（Vue 里放在 $nextTick 中），
	 * 函数内部再等一帧，确保新内容已经有可滚动的高度。
	 */
	restore(): void {
		let token = ++this.token;
		requestAnimationFrame(() => {
			if (token !== this.token || !this.container) return;
			this.container.scrollTop = this.options.isFiltered?.()
				? 0
				: (scroll_positions[this.options.getKey()] ?? 0);
			this.update();
		});
	}

	/** 同步「回到顶部」按钮的可见状态 */
	update(): void {
		if (!this.container || !this.button) return;
		let scrollable = this.container.scrollHeight > this.container.clientHeight + 1;
		this.button.classList.toggle('visible', scrollable && this.container.scrollTop > BUTTON_MIN_SCROLL);
	}

	private toTop(): void {
		if (!this.container) return;
		this.scrolling_to_top = true;
		if (!this.options.isFiltered?.()) {
			scroll_positions[this.options.getKey()] = 0;
		}
		try {
			this.container.scrollTo({top: 0, behavior: 'smooth'});
		} catch {
			this.container.scrollTop = 0;
		}
		setTimeout(() => {
			this.scrolling_to_top = false;
			this.update();
		}, SMOOTH_SCROLL_DURATION);
	}

	private onScroll = () => {
		if (this.frame !== null) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = null;
			this.save();
			this.update();
		});
	};
}
