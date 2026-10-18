import { MolangAutocomplete } from "../../types/custom/molang";

interface MolangEditorOptions {
	autocomplete_context: MolangAutocomplete.Context
	text: string
}
export function openMolangEditor(options: MolangEditorOptions, callback: ((result: string) => void)) {
	interface VueData {
		text: string
	}
	let dialog = new Dialog('expression_editor', {
		title: 'menu.text_edit.expression_editor',
		resizable: true,
		width: 800,
		component: {
			components: {VuePrismEditor},
			data: {
				text: options.text
			},
			methods: {
				openVariableContextMenu(event: MouseEvent) {
					let entries = molangVariableMenuEntries(event);
					if (entries.length) new Menu(entries).open(event);
				},
				prettyPrint(this: VueData) {
					this.text = this.text.replace(/;\s*(?!\n)/g, ';\n');
				},
				minify(this: VueData) {
					this.text = this.text.replace(/\n/g, '').replace(/\s{2,}/g, ' ');
				},
				findReplace(this: VueData) {
					this
					let scope = this;
					new Dialog({
						id: 'find_replace',
						title: 'action.find_replace',
						form: {
							find: {label: 'dialog.find_replace.find', type: 'text'},
							replace: {label: 'dialog.find_replace.replace', type: 'text'},
							regex: {label: 'dialog.find_replace.regex', type: 'checkbox', value: false},
						},
						onConfirm(form) {
							if (!form.find) return;
							let replace_text = form.replace.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
							function replace(text: string) {
								if (form.regex) {
									let regex = new RegExp(form.find, 'g');
									return text.replace(regex, replace_text);
								} else {
									return text.split(form.find).join(replace_text);
								}
							}
							scope.text = replace(scope.text);
						}
					}).show();
				},
				autocomplete(text: string, position: number) {
					if (Settings.get('autocomplete_code') == false) return [];
					let test = options.autocomplete_context.autocomplete(text, position);
					return test;
				}
			},
			template: `
				<div>
					<div class="dialog_bar">
						<button @click="prettyPrint()">${tl('dialog.expression_editor.pretty_print')}</button>
						<button @click="minify()">${tl('dialog.expression_editor.minify')}</button>
						<button @click="findReplace()">${tl('dialog.expression_editor.find_replace')}</button>
					</div>
					<vue-prism-editor
						class="molang_input"
						id="expression_editor_prism"
						v-model="text"
						language="molang"
						:autocomplete="autocomplete"
						:ignoreTabKey="false"
						:line-numbers="true"
						@contextmenu.prevent="openVariableContextMenu($event)"
					/>
				</div>
			`
		},
		onOpen() {
			let element = document.querySelector('#expression_editor_prism.molang_input') as HTMLElement;
			element.style.height = Math.max(dialog.object.clientHeight - 148, 100) + 'px';
			element.style.maxHeight = element.style.height;
		},
		onResize() {
			let element = document.querySelector('#expression_editor_prism.molang_input') as HTMLElement;
			element.style.height = (dialog.object.clientHeight - 148) + 'px';
			element.style.maxHeight = element.style.height;
		},
		onConfirm() {
			callback(dialog.content_vue.$data.text);
		}
	})
	dialog.show();
}

// ---------------------------------------------------------------------------
// 右键 molang 中的变量 → 添加到项目变量（Project.custom_molang_variables）
// ---------------------------------------------------------------------------

const molang_variable_regex = /^(?:(?:v|variable)\s*\.\s*)?([A-Za-z_]\w*)$/i;
// temp./query./context./ct./customtemp./math. 不是项目变量，不提供该动作
const molang_non_variable_regex = /^\s*(?:t|temp|q|query|c|context|ct|customtemp|math)\s*\./i;
const molang_non_identifier_token_classes = ['string', 'number', 'operator', 'punctuation', 'keyword', 'boolean', 'function-name'];

/** 从文本片段解析项目变量名：接受 `名字` 与 `v.名字` / `variable.名字`，其余前缀返回 null */
export function molangVariableNameFromText(text: string): string | null {
	if (typeof text != 'string') return null;
	let value = text.trim();
	if (!value || molang_non_variable_regex.test(value)) return null;
	let match = value.match(molang_variable_regex);
	return match ? match[1] : null;
}

function molangVariableFromEvent(event: MouseEvent): string | null {
	let target = event.target instanceof Element ? event.target : null;
	if (!target) return null;
	// Prism 把标识符渲染成 .token 元素，右键落点直接给出名字
	let token = target.closest('.token');
	if (token) {
		let blocked = molang_non_identifier_token_classes.some(cls => token.classList.contains(cls));
		if (!blocked) {
			let from_token = molangVariableNameFromText(token.textContent || '');
			if (from_token) return from_token;
		}
	}
	// 回退一：编辑器光标处的词
	let editor = target.closest('.prism-editor-component');
	let textarea = editor ? editor.querySelector('textarea') : null;
	if (textarea) {
		let value = textarea.value || '';
		let caret = textarea.selectionStart ?? 0;
		let start = caret, end = caret;
		while (start > 0 && /[\w.]/.test(value[start - 1])) start--;
		while (end < value.length && /[\w.]/.test(value[end])) end++;
		let from_caret = molangVariableNameFromText(value.substring(start, end));
		if (from_caret) return from_caret;
	}
	// 回退二：选中文本
	let selection = window.getSelection();
	if (selection && selection.rangeCount && !selection.isCollapsed) {
		return molangVariableNameFromText(selection.toString());
	}
	return null;
}

/** 把变量名加入项目变量表（去重，忽略大小写），并刷新展开缓存与高亮 */
export function addProjectCustomVariable(name: string) {
	if (!Project || !name) return false;
	let list = Project.custom_molang_variables;
	if (list.find(entry => (entry || '').toLowerCase() == name.toLowerCase())) {
		Blockbench.showQuickMessage(tl('message.custom_variable_exists', [name]), 1500);
		return false;
	}
	list.push(name);
	Project.saved = false;
	clearCustomMolangCache();
	if (typeof updateCustomMolangVariableHighlight == 'function') updateCustomMolangVariableHighlight();
	Blockbench.dispatchEvent('update_custom_molang', {});
	Blockbench.showQuickMessage(tl('message.custom_variable_added', [name]), 1500);
	return true;
}

/**
 * molang 编辑处右键菜单的「添加到项目变量」条目。
 * 右键落点不是可识别的项目变量时返回空数组（菜单保持原样）。
 */
export function molangVariableMenuEntries(event: MouseEvent) {
	let name = molangVariableFromEvent(event);
	if (!name) return [];
	return [{
		name: 'action.add_custom_variable',
		icon: 'playlist_add',
		click: () => addProjectCustomVariable(name)
	}];
}
