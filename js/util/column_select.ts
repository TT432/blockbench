/**
 * contenteditable 编辑器（VuePrismEditor）的中键列选择（盒选）增强。
 *
 * 中键拖动在 pre 上画出矩形选择（覆盖层高亮），随后的按键对选区内每一行的
 * 同一列区间执行相同编辑（输入字符替换列区间、Backspace/Delete 删除列区间），
 * Ctrl+C 复制为按行拼接的文本。Escape / 左键点击 / 方向键等退出列选择。
 *
 * 编辑器是 contenteditable pre（非 textarea），DOM 选区只支持单区间，因此
 * 列选择通过覆盖层 + 拦截按键自行模拟。文本改动直接写回 v-model（options
 * 的 getText/setText），由 Vue 重新渲染；因此必须同时拦截组件自己的
 * keydown/keyup 处理（keyup 会读 pre 内容回写 model，渲染前会读到旧文本）。
 */

interface ColumnSelectOptions {
	getText: () => string
	setText: (text: string) => void
}

interface CaretPosition {
	line: number
	col: number
}

export function enableColumnSelection(root: HTMLElement, options: ColumnSelectOptions): void {
	let pre = root.querySelector('pre.prism-editor__code') as HTMLElement | null;
	let wrapper = root.querySelector('.prism-editor-wrapper') as HTMLElement | null;
	if (!pre || !wrapper) return;
	if (getComputedStyle(wrapper).position == 'static') wrapper.style.position = 'relative';

	let overlay_container = document.createElement('div');
	overlay_container.className = 'column_select_overlay';
	Object.assign(overlay_container.style, {
		position: 'absolute',
		left: '0',
		top: '0',
		pointerEvents: 'none',
		zIndex: '3',
	});
	wrapper.appendChild(overlay_container);

	let anchor: CaretPosition | null = null;
	let active: {line1: number, line2: number, col1: number, col2: number} | null = null;
	let dragging = false;
	let suppress_keyup = false;

	function getLines(): string[] {
		return options.getText().split('\n');
	}

	// 将 (textNode, offset) 映射为全文绝对偏移
	function absoluteOffset(node: Node, offset: number): number {
		let walker = document.createTreeWalker(pre!, NodeFilter.SHOW_TEXT);
		let total = 0;
		let current: Node | null;
		while ((current = walker.nextNode())) {
			if (current === node) return total + offset;
			total += (current.textContent || '').length;
		}
		return total;
	}
	// 将绝对偏移映射回 (textNode, offset)
	function nodeAtOffset(target: number): {node: Node, offset: number} | null {
		let walker = document.createTreeWalker(pre!, NodeFilter.SHOW_TEXT);
		let total = 0;
		let current: Node | null;
		while ((current = walker.nextNode())) {
			let length = (current.textContent || '').length;
			if (target <= total + length) return {node: current, offset: target - total};
			total += length;
		}
		return null;
	}
	function lineStartOffset(lines: string[], line: number): number {
		let offset = 0;
		for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
		return offset;
	}
	function caretFromPoint(x: number, y: number): CaretPosition | null {
		let doc = document as any;
		let range: Range | null = doc.caretRangeFromPoint
			? doc.caretRangeFromPoint(x, y)
			: (() => {
				let pos = doc.caretPositionFromPoint && doc.caretPositionFromPoint(x, y);
				if (!pos) return null;
				let r = document.createRange();
				r.setStart(pos.offsetNode, pos.offset);
				return r;
			})();
		if (!range || !pre!.contains(range.startContainer)) return null;
		let abs = absoluteOffset(range.startContainer, range.startOffset);
		let lines = getLines();
		let offset = 0;
		for (let i = 0; i < lines.length; i++) {
			let end = offset + lines[i].length;
			if (abs <= end) return {line: i, col: abs - offset};
			offset = end + 1;
		}
		return {line: lines.length - 1, col: lines[lines.length - 1].length};
	}
	function normalize(a: CaretPosition, b: CaretPosition) {
		let line1 = Math.min(a.line, b.line);
		let line2 = Math.max(a.line, b.line);
		let col1 = Math.min(a.col, b.col);
		let col2 = Math.max(a.col, b.col);
		return {line1, line2, col1, col2};
	}
	function renderOverlay() {
		overlay_container.replaceChildren();
		if (!active) return;
		let lines = getLines();
		let wrapper_rect = wrapper!.getBoundingClientRect();
		for (let line = active.line1; line <= active.line2 && line < lines.length; line++) {
			let line_length = lines[line].length;
			let start_offset = lineStartOffset(lines, line) + Math.min(active.col1, line_length);
			let end_offset = lineStartOffset(lines, line) + Math.min(active.col2, line_length);
			let start = nodeAtOffset(start_offset);
			let end = nodeAtOffset(end_offset);
			if (!start || !end) continue;
			let range = document.createRange();
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset);
			let rect = range.getBoundingClientRect();
			if (!rect || (!rect.width && !rect.height)) {
				// 空行或超出行尾：在行尾画一条细选区
				if (start) {
					range.setStart(start.node, start.offset);
					range.collapse(true);
					let rects = range.getClientRects();
					if (rects.length) {
						let r = rects[0];
						rect = new DOMRect(r.left, r.top, 0, r.height);
					}
				}
				if (!rect) continue;
			}
			let div = document.createElement('div');
			Object.assign(div.style, {
				position: 'absolute',
				left: (rect.left - wrapper_rect.left + wrapper!.scrollLeft) + 'px',
				top: (rect.top - wrapper_rect.top + wrapper!.scrollTop) + 'px',
				width: Math.max(rect.width, 2) + 'px',
				height: rect.height + 'px',
				backgroundColor: 'var(--color-accent)',
				opacity: '0.35',
			});
			overlay_container.appendChild(div);
		}
	}
	function clearSelection() {
		active = null;
		anchor = null;
		dragging = false;
		overlay_container.replaceChildren();
	}
	function applyEdit(produce: (line_text: string, from: number, to: number) => {text: string, new_col: number}) {
		if (!active) return;
		let lines = getLines();
		for (let line = active.line1; line <= active.line2 && line < lines.length; line++) {
			let from = Math.min(active.col1, lines[line].length);
			let to = Math.min(active.col2, lines[line].length);
			let result = produce(lines[line], from, to);
			lines[line] = result.text;
			if (line == active.line2) {
				active.col1 = active.col2 = result.new_col;
			}
		}
		options.setText(lines.join('\n'));
	}

	pre.addEventListener('mousedown', (event: MouseEvent) => {
		if (event.button == 1) {
			event.preventDefault();
			event.stopPropagation();
			let caret = caretFromPoint(event.clientX, event.clientY);
			if (!caret) return;
			anchor = caret;
			dragging = true;
			active = normalize(caret, caret);
			renderOverlay();
		} else if (active) {
			clearSelection();
		}
	}, true);
	document.addEventListener('mousemove', (event: MouseEvent) => {
		if (!dragging || !anchor) return;
		let caret = caretFromPoint(event.clientX, event.clientY);
		if (!caret) return;
		active = normalize(anchor, caret);
		renderOverlay();
	});
	document.addEventListener('mouseup', (event: MouseEvent) => {
		if (event.button == 1 && dragging) {
			dragging = false;
			if (active && active.line1 == active.line2 && active.col1 == active.col2) {
				clearSelection();
			}
		}
	});
	// 滚动或内容变化后高亮位置失效，重新绘制
	pre.addEventListener('scroll', () => { if (active) renderOverlay(); }, {passive: true});

	pre.addEventListener('keydown', (event: KeyboardEvent) => {
		if (!active) return;
		if (event.ctrlKey || event.metaKey) {
			if (event.key.toLowerCase() == 'c') {
				let lines = getLines();
				let copied: string[] = [];
				for (let line = active.line1; line <= active.line2 && line < lines.length; line++) {
					copied.push(lines[line].substring(Math.min(active.col1, lines[line].length), Math.min(active.col2, lines[line].length)));
				}
				event.preventDefault();
				event.stopPropagation();
				navigator.clipboard?.writeText(copied.join('\n'));
			}
			return;
		}
		if (event.key.length == 1) {
			event.preventDefault();
			event.stopPropagation();
			suppress_keyup = true;
			let char = event.key;
			applyEdit((line_text, from, to) => ({
				text: line_text.substring(0, from) + char + line_text.substring(to),
				new_col: from + char.length
			}));
			requestAnimationFrame(() => renderOverlay());
		} else if (event.key == 'Backspace' || event.key == 'Delete') {
			event.preventDefault();
			event.stopPropagation();
			suppress_keyup = true;
			let backward = event.key == 'Backspace';
			applyEdit((line_text, from, to) => {
				if (from < to) {
					return {text: line_text.substring(0, from) + line_text.substring(to), new_col: from};
				}
				if (backward && from > 0) {
					return {text: line_text.substring(0, from - 1) + line_text.substring(from), new_col: from - 1};
				}
				if (!backward && from < line_text.length) {
					return {text: line_text.substring(0, from) + line_text.substring(from + 1), new_col: from};
				}
				return {text: line_text, new_col: from};
			});
			requestAnimationFrame(() => renderOverlay());
		} else if (['Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
			clearSelection();
			if (event.key == 'Escape') {
				event.preventDefault();
				event.stopPropagation();
			}
		}
	}, true);
	pre.addEventListener('keyup', (event: KeyboardEvent) => {
		if (suppress_keyup) {
			suppress_keyup = false;
			event.preventDefault();
			event.stopPropagation();
		}
	}, true);
	pre.addEventListener('blur', () => clearSelection(), true);
}
