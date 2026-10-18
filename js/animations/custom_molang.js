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

function openCustomMolangDialog() {
	if (!Project) return;
	let dialog = new Dialog({
		id: 'custom_molang',
		title: 'action.create_custom_molang',
		resizable: true,
		width: 560,
		component: {
			components: {VuePrismEditor},
			data() {
				return {
					editing_uuid: '',
					name: '',
					params: [],
					body: '',
					existing: Project.custom_molangs,
				}
			},
			computed: {
				existing_options() {
					let options = {'': tl('dialog.custom_molang.new')};
					this.existing.forEach(def => {
						options[def.uuid] = 'new.' + def.name;
					});
					return options;
				}
			},
			methods: {
				loadSelected() {
					let def = this.existing.find(d => d.uuid == this.editing_uuid);
					if (def) {
						this.name = def.name;
						this.params = def.params.slice();
						this.body = def.body;
					} else {
						this.name = '';
						this.params = [];
						this.body = '';
					}
				},
				deleteSelected() {
					let index = this.existing.findIndex(d => d.uuid == this.editing_uuid);
					if (index < 0) return;
					this.existing.splice(index, 1);
					this.editing_uuid = '';
					this.name = '';
					this.params = [];
					this.body = '';
					clearCustomMolangCache();
					Project.saved = false;
					Animator.preview();
				},
				autocomplete(text, position) {
					if (Settings.get('autocomplete_code') == false) return [];
					return MolangAutocomplete.VariablePlaceholdersContext.autocomplete(text, position);
				}
			},
			template: `
				<div class="custom_molang_wrapper">
					<div class="dialog_bar" style="align-items: center;">
						<label>${tl('dialog.custom_molang.edit_existing')}</label>
						<select-input class="flexible" v-model="editing_uuid" :options="existing_options" @input="loadSelected()" />
						<div class="tool" v-if="editing_uuid" :title="'${tl('generic.delete')}'" @click="deleteSelected()"><i class="material-icons">delete</i></div>
					</div>
					<div class="dialog_bar custom_molang_name_row">
						<label class="custom_molang_prefix">new.</label>
						<input type="text" class="dark_bordered tab_target" v-model="name" :placeholder="'${tl('dialog.custom_molang.name')}'">
					</div>
					<div class="dialog_bar">
						<label>${tl('dialog.custom_molang.params')}</label>
					</div>
					<div class="dialog_bar custom_molang_param_row" v-for="(param, i) in params" :key="i">
						<input type="text" class="dark_bordered tab_target" v-model="params[i]" :placeholder="'${tl('dialog.custom_molang.param_name')}'">
						<div class="tool" :title="'${tl('generic.delete')}'" @click="params.splice(i, 1)"><i class="material-icons">clear</i></div>
					</div>
					<div class="dialog_bar">
						<button style="width: 100%;" @click="params.push('')"><i class="icon fa fa-plus"></i></button>
					</div>
					<div class="dialog_bar">
						<label>${tl('dialog.custom_molang.body')}</label>
					</div>
					<vue-prism-editor
						class="molang_input"
						id="custom_molang_body_editor"
						v-model="body"
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
			let existing = Project.custom_molangs.find(d => d.uuid == data.editing_uuid);
			if (existing) {
				existing.name = name;
				existing.params.replace(params);
				existing.body = data.body;
			} else {
				Project.custom_molangs.push({
					uuid: guid(),
					name,
					params,
					body: data.body || ''
				});
			}
			clearCustomMolangCache();
			Project.saved = false;
			Animator.preview();
		}
	});
	dialog.show();
}

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
