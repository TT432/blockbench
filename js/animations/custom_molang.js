/**
 * 项目自定义 molang（反馈功能：n./new. 前缀中间格式）
 *
 * 用户以 new.name(param1, param2) = 方法体 的形式定义项目级自定义 molang，
 * 调用处写 n.name(...) 或 new.name(...)，执行（Molang.parse 全局钩子）与导出
 * （exportMolang / compileBedrockKeyframe / 动画控制器 compileForBedrock）时
 * 由 js/util/molang.ts 的 expandCustomMolang 文本展开为普通 molang。
 * 定义存于 Project.custom_molangs，随 .bbmodel 持久化（bbmodel.js codec）。
 */

import { enableColumnSelection } from '../util/column_select';
import { molangVariableMenuEntries } from './molang_editor';

function sanitizeParams(params) {
	let seen = new Set();
	let result = [];
	params.forEach(p => {
		p = (p || '').trim();
		if (!p || !/^\w+$/.test(p)) return;
		let lower = p.toLowerCase();
		if (seen.has(lower)) return;
		seen.add(lower);
		result.push(p);
	});
	return result;
}

/**
 * 新建自定义 molang 对话框（语义：仅新建）。编辑已有定义时传入 edit_def，
 * 此时对话框预填并按 uuid 更新——编辑入口在变量占位符面板的条目右键菜单。
 */
function openCustomMolangDialog(edit_def) {
	if (!Project) return;
	let dialog = new Dialog({
		id: 'custom_molang',
		title: edit_def ? 'dialog.custom_molang.edit_title' : 'action.create_custom_molang',
		resizable: true,
		width: 560,
		component: {
			components: {VuePrismEditor},
			data() {
				return {
					editing_uuid: edit_def ? edit_def.uuid : '',
					name: edit_def ? edit_def.name : '',
					params: edit_def ? edit_def.params.slice() : [],
					locals: edit_def ? (edit_def.locals || []).slice() : [],
					body: edit_def ? edit_def.body : '',
				}
			},
			methods: {
				autocomplete(text, position) {
					if (Settings.get('autocomplete_code') == false) return [];
					return MolangAutocomplete.VariablePlaceholdersContext.autocomplete(text, position);
				},
				// v-model="params[i]" 是数组下标赋值，Vue 2 侦测不到，须在交互点手动同步高亮
				updateParamHighlight() {
					this.updateHighlight();
				},
				updateHighlight() {
					setCustomMolangParamHighlight(this.params.concat(this.locals));
				},
				addParam() {
					this.params.push('');
					this.updateHighlight();
				},
				removeParam(i) {
					this.params.splice(i, 1);
					this.updateHighlight();
				},
				addLocal() {
					this.locals.push('');
					this.updateHighlight();
				},
				// 方法体编辑器右键：命中的若是项目变量，提供「添加到项目变量」
				openBodyContextMenu(event) {
					let entries = molangVariableMenuEntries(event);
					if (!entries.length) return;
					new Menu(entries).open(event);
				},
				removeLocal(i) {
					this.locals.splice(i, 1);
					this.updateHighlight();
				}
			},
			// close() 不销毁 Vue 实例，beforeDestroy 不可靠；确认/取消时显式清空参数高亮
			beforeDestroy() {
				setCustomMolangParamHighlight([], false);
			},
			template: `
				<div class="custom_molang_wrapper">
					<div class="dialog_bar custom_molang_name_row">
						<label class="custom_molang_prefix">new.</label>
						<input type="text" class="dark_bordered tab_target" v-model="name" :placeholder="'${tl('dialog.custom_molang.name')}'">
					</div>
					<div class="dialog_bar">
						<label>${tl('dialog.custom_molang.params')}</label>
					</div>
					<div class="dialog_bar custom_molang_param_row" v-for="(param, i) in params" :key="i">
						<input type="text" class="dark_bordered tab_target" v-model="params[i]" @input="updateParamHighlight" :placeholder="'${tl('dialog.custom_molang.param_name')}'">
						<div class="tool" :title="'${tl('generic.delete')}'" @click="removeParam(i)"><i class="material-icons">clear</i></div>
					</div>
					<div class="dialog_bar">
						<button style="width: 100%;" @click="addParam"><i class="icon fa fa-plus"></i></button>
					</div>
					<div class="dialog_bar">
						<label :title="'${tl('dialog.custom_molang.locals.desc')}'">${tl('dialog.custom_molang.locals')}</label>
					</div>
					<div class="dialog_bar custom_molang_param_row" v-for="(local_name, i) in locals" :key="'local_'+i">
						<input type="text" class="dark_bordered tab_target" v-model="locals[i]" @input="updateHighlight" :placeholder="'${tl('dialog.custom_molang.param_name')}'">
						<div class="tool" :title="'${tl('generic.delete')}'" @click="removeLocal(i)"><i class="material-icons">clear</i></div>
					</div>
					<div class="dialog_bar">
						<button style="width: 100%;" @click="addLocal"><i class="icon fa fa-plus"></i></button>
					</div>
					<div class="dialog_bar">
						<label>${tl('dialog.custom_molang.body')}</label>
					</div>
					<vue-prism-editor
						class="molang_input"
						id="custom_molang_body_editor"
						v-model="body"
						@contextmenu.prevent="openBodyContextMenu($event)"
						language="molang"
						:autocomplete="autocomplete"
						:ignoreTabKey="false"
						:line-numbers="true"
					/>
					<p class="dialog_custom_molang_hint">${tl('dialog.custom_molang.hint')}</p>
				</div>
			`
		},
		onOpen() {
			let element = document.querySelector('#custom_molang_body_editor.molang_input');
			if (element) {
				let vue_data = dialog.content_vue && dialog.content_vue.$data;
				enableColumnSelection(element, {
					getText: () => vue_data ? vue_data.body : '',
					setText: (text) => {
						if (vue_data) vue_data.body = text;
					}
				});
			}
			// 编辑已有时参数预填，打开即挂参数/局部变量高亮
			if (dialog.content_vue) dialog.content_vue.updateHighlight();
		},
		onConfirm() {
			let data = dialog.content_vue.$data;
			let name = (data.name || '').trim().replace(/^(new|n)\./i, '');
			if (!name || !/^\w+$/.test(name)) {
				Blockbench.showQuickMessage('dialog.custom_molang.invalid_name');
				return false;
			}
			let lower = name.toLowerCase();
			let duplicate = Project.custom_molangs.find(d => d.name.toLowerCase() == lower && d.uuid != data.editing_uuid);
			if (duplicate) {
				Blockbench.showQuickMessage('dialog.custom_molang.duplicate_name');
				return false;
			}
			let params = sanitizeParams(data.params);
			let locals = sanitizeParams(data.locals);
			let existing = Project.custom_molangs.find(d => d.uuid == data.editing_uuid);
			if (existing) {
				existing.name = name;
				existing.params.replace(params);
				existing.locals = locals;
				existing.body = data.body;
			} else {
				Project.custom_molangs.push({
					uuid: guid(),
					name,
					params,
					locals,
					body: data.body || ''
				});
			}
			clearCustomMolangCache();
			Project.saved = false;
			Animator.preview();
			Blockbench.dispatchEvent('update_custom_molang', {});
			setCustomMolangParamHighlight([], false);
		},
		onCancel() {
			setCustomMolangParamHighlight([], false);
		}
	});
	dialog.show();
}
Object.assign(window, {openCustomMolangDialog});

BARS.defineActions(function() {
	new Action('create_custom_molang', {
		icon: 'fa-square-root-variable',
		category: 'animation',
		condition: {modes: ['animate']},
		click() {
			openCustomMolangDialog();
		}
	})
})
