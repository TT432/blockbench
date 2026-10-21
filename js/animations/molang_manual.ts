// Molang 手册：可查询全部官方 Molang（query/math/context/variable/temp、关键字、
// Blockbench 扩展记号）与项目/插件自定义 Molang 的名称、签名和用法。
//
// 官方条目的名称与签名取自 MolangAutocomplete（自动补全的同一份数据，保证与编辑器一致），
// 用法说明取自同目录的 molang_manual_data.ts（官方文档中文整理，见该文件头的维护规则）。
// 自定义条目直接读取 getCustomMolangDefinitions()，因此插件注册的定义无需额外登记。
import { MOLANG_QUERY_DOCS, MOLANG_MATH_DOCS, MOLANG_EXTRA_DOCS } from "./molang_manual_data";
import { getCustomMolangDefinitions, CustomMolangDefinition } from "../util/molang";
import { Interface } from "../interface/interface";

type ManualSource = 'official' | 'project' | 'plugin';

interface MolangManualEntry {
	/** 稳定键：分组 + 名称，用于选中状态 */
	key: string
	group: string
	name: string
	/** 带别名的签名行，例如 query.anim_time / q.anim_time */
	aliases: string
	signature: string
	summary: string
	source: ManualSource
	/** 是否已进入自动补全（false = 仅官方文档收录） */
	autocomplete: boolean
	/** 插件来源 */
	provider?: string
	definition?: CustomMolangDefinition
}

const MANUAL_GROUPS = ['query', 'math', 'context', 'variable', 'temp', 'keywords', 'extensions', 'project', 'plugin'];

const MANUAL_CSS = `
.mfm_manual {
	display: flex;
	height: min(66vh, 600px);
	margin-top: 4px;
}
.mfm_sidebar {
	width: 264px;
	flex: 0 0 264px;
	display: flex;
	flex-direction: column;
	border-right: 1px solid var(--color-border);
	padding-right: 10px;
	min-height: 0;
}
.mfm_search input {
	width: 100%;
	box-sizing: border-box;
}
.mfm_tree {
	flex: 1;
	overflow-y: auto;
	margin-top: 8px;
	padding-right: 2px;
	min-height: 0;
}
.mfm_group {
	display: flex;
	align-items: baseline;
	gap: 6px;
	margin-top: 10px;
	padding: 2px 8px;
	font-size: 11.5px;
	font-weight: 600;
	letter-spacing: 0.06em;
	color: var(--color-subtle_text);
}
.mfm_count {
	font-weight: 400;
	opacity: 0.7;
}
.mfm_item {
	padding: 2px 8px;
	border-radius: 4px;
	cursor: pointer;
	font-size: 12.5px;
	line-height: 1.6;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	color: var(--color-subtle_text);
}
.mfm_item:hover {
	background-color: var(--color-button);
}
.mfm_item.selected {
	background-color: var(--color-selected);
	color: var(--color-text);
}
.mfm_empty {
	margin: 16px 8px;
	color: var(--color-subtle_text);
}
.mfm_content {
	flex: 1;
	overflow-y: auto;
	padding: 0 6px 0 14px;
	min-height: 0;
}
.mfm_detail h2 {
	margin: 0 0 6px;
	font-size: 17px;
	word-break: break-all;
}
.mfm_badges {
	display: flex;
	gap: 6px;
	margin-bottom: 12px;
	flex-wrap: wrap;
}
.mfm_badge {
	font-size: 11px;
	padding: 1px 7px;
	border-radius: 9px;
	background-color: var(--color-button);
	color: var(--color-subtle_text);
}
.mfm_badge.mfm_source_plugin {
	background-color: var(--color-accent);
	color: var(--color-accent_text);
}
.mfm_section_title {
	margin: 14px 0 3px;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	color: var(--color-accent);
}
.mfm_code {
	display: block;
	padding: 6px 8px;
	border-radius: 4px;
	background-color: var(--color-back);
	border: 1px solid var(--color-border);
	font-family: var(--font-code, monospace);
	font-size: 12.5px;
	white-space: pre-wrap;
	word-break: break-word;
	user-select: text;
}
.mfm_muted {
	color: var(--color-subtle_text);
}
.mfm_overview p {
	margin: 4px 0;
	line-height: 1.7;
}
`;

function ensureManualCSS() {
	if (document.getElementById('molang_manual_css')) return;
	document.head.append(Interface.createElement('style', {id: 'molang_manual_css'}, MANUAL_CSS));
}

function signatureWithArguments(name: string, args: string[] | undefined): string {
	if (!args || !args.length) return name;
	return `${name}(${args.join(', ')})`;
}

/** 命名空间别名（手册展示用；未登记的命名空间直接显示命名空间 id） */
const NAMESPACE_ALIASES: Record<string, string> = {
	query: 'q',
	math: 'm',
	context: 'c',
	variable: 'v',
	temp: 't',
};

/** 官方条目的用法说明：query/math 查专用表，其余命名空间查 EXTRA 表（key 为 `命名空间.名字`） */
function officialUsage(namespace_id: string, id: string): {signature: string, summary: string} | null {
	if (namespace_id == 'query') {
		return {signature: '', summary: MOLANG_QUERY_DOCS[id] || ''};
	}
	if (namespace_id == 'math') {
		let doc = MOLANG_MATH_DOCS[id];
		return doc ? {signature: doc.signature, summary: doc.summary} : null;
	}
	let doc = MOLANG_EXTRA_DOCS[`${namespace_id}.${id}`];
	return doc ? {signature: doc.signature, summary: doc.summary} : null;
}

function buildOfficialEntries(): MolangManualEntry[] {
	let entries: MolangManualEntry[] = [];
	let documented = new Set<string>();
	// 命名空间条目与自动补全同源（含插件新增的命名空间/查询，其 description 直接用于手册）
	MolangAutocomplete.DefaultContext.namespaces.forEach((namespace, namespace_id) => {
		if (namespace_id == 'new') return; // 自定义 Molang 单独成组
		namespace.queries.forEach((query, id) => {
			let usage = officialUsage(namespace_id, id);
			documented.add(`${namespace_id}.${id}`);
			let alias = NAMESPACE_ALIASES[namespace_id];
			entries.push({
				key: `${namespace_id}:${id}`,
				group: namespace_id,
				name: `${namespace_id}.${id}`,
				aliases: alias ? `${alias}.${id}` : '',
				signature: (usage && usage.signature) || signatureWithArguments(`${namespace_id}.${id}`, query.arguments),
				summary: (usage && usage.summary) || query.description || '',
				source: 'official',
				autocomplete: true,
			});
		});
	});

	// 官方文档收录但未进入自动补全的条目也纳入手册，并标注来源差异
	Object.keys(MOLANG_QUERY_DOCS).forEach(id => {
		if (documented.has(`query.${id}`)) return;
		entries.push({
			key: `query:${id}`,
			group: 'query',
			name: `query.${id}`,
			aliases: `q.${id}`,
			signature: `query.${id}`,
			summary: MOLANG_QUERY_DOCS[id],
			source: 'official',
			autocomplete: false,
		});
	});
	Object.keys(MOLANG_MATH_DOCS).forEach(id => {
		if (documented.has(`math.${id}`)) return;
		entries.push({
			key: `math:${id}`,
			group: 'math',
			name: `math.${id}`,
			aliases: `m.${id}`,
			signature: MOLANG_MATH_DOCS[id].signature,
			summary: MOLANG_MATH_DOCS[id].summary,
			source: 'official',
			autocomplete: false,
		});
	});
	Object.keys(MOLANG_EXTRA_DOCS).forEach(key => {
		// `new.<name>(...)` 是调用语法说明，归入 extensions 分组，不作为命名空间条目
		if (!key.includes('.') || key.startsWith('new.') || documented.has(key)) return;
		let namespace_id = key.substring(0, key.indexOf('.'));
		let alias = NAMESPACE_ALIASES[namespace_id];
		entries.push({
			key: `${namespace_id}:${key.substring(namespace_id.length + 1)}`,
			group: namespace_id,
			name: key,
			aliases: alias ? `${alias}.${key.substring(namespace_id.length + 1)}` : '',
			signature: MOLANG_EXTRA_DOCS[key].signature,
			summary: MOLANG_EXTRA_DOCS[key].summary,
			source: 'official',
			autocomplete: false,
		});
	});

	['true', 'false', 'this', 'loop', 'return', 'break', 'continue'].forEach(id => {
		let doc = MOLANG_EXTRA_DOCS[id];
		if (!doc) return;
		entries.push({
			key: `keywords:${id}`,
			group: 'keywords',
			name: id,
			aliases: '',
			signature: doc.signature,
			summary: doc.summary,
			source: 'official',
			autocomplete: true,
		});
	});

	['new.<name>(...)', 'toggle', 'slider', 'impulse'].forEach(id => {
		let doc = MOLANG_EXTRA_DOCS[id];
		if (!doc) return;
		entries.push({
			key: `extensions:${id}`,
			group: 'extensions',
			name: doc.signature,
			aliases: '',
			signature: doc.signature,
			summary: doc.summary,
			source: 'official',
			autocomplete: true,
		});
	});

	return entries;
}

function customEntrySignature(definition: CustomMolangDefinition): string {
	let args = [
		...(definition.params || []),
		...(definition.outputs || []).map(output => `>${output}`),
	];
	return signatureWithArguments(`new.${definition.name}`, args);
}

function buildCustomEntries(): MolangManualEntry[] {
	return getCustomMolangDefinitions().map(definition => ({
		key: `${definition.readonly ? 'plugin' : 'project'}:${definition.name}`,
		group: definition.readonly ? 'plugin' : 'project',
		name: `new.${definition.name}`,
		aliases: `n.${definition.name}`,
		signature: customEntrySignature(definition),
		summary: definition.description || '',
		source: definition.readonly ? 'plugin' : 'project',
		autocomplete: true,
		provider: definition.readonly ? (definition.plugin_id || '') : '',
		definition,
	}));
}

function buildManualEntries(): MolangManualEntry[] {
	let entries = buildOfficialEntries().concat(buildCustomEntries());
	return entries.sort((a, b) => a.group == b.group ? a.name.localeCompare(b.name) : 0);
}

function manualEntryMatches(entry: MolangManualEntry, query: string): boolean {
	if (!query) return true;
	return [entry.name, entry.aliases, entry.signature, entry.summary, entry.provider]
		.filter(text => !!text).join(' ').toLowerCase().includes(query);
}

BARS.defineActions(() => {
	new Action('open_molang_manual', {
		icon: 'menu_book',
		category: 'animation',
		condition: {modes: ['animate']},
		click() {
			openMolangManual();
		}
	})
	new Action('molang_manual', {
		icon: 'menu_book',
		category: 'blockbench',
		click() {
			openMolangManual();
		}
	});
});

function openMolangManual() {
	ensureManualCSS();
	let entries = buildManualEntries();
	new Dialog({
		id: 'molang_manual',
				title: 'menu.help.molang_manual',
				width: 860,
				buttons: ['dialog.close'],
				component: {
					data() {
						return {
							query: '',
							selection: '',
							entries,
						}
					},
					computed: {
						groups(): {group: string, label: string, entries: MolangManualEntry[]}[] {
							let query = this.query.trim().toLowerCase();
							let groups: {group: string, label: string, entries: MolangManualEntry[]}[] = [];
							// 标准分组按固定顺序；插件新增的命名空间排在其后（按 id 排序）
							let extra_groups = [...new Set(this.entries.map(entry => entry.group))]
								.filter(group => !MANUAL_GROUPS.includes(group))
								.sort();
							for (let group of MANUAL_GROUPS.concat(extra_groups)) {
								let list = this.entries.filter(entry => entry.group == group && manualEntryMatches(entry, query));
								if (!list.length) continue;
								let label = MANUAL_GROUPS.includes(group) ? tl(`molang_manual.group.${group}`) : group;
								groups.push({group, label, entries: list});
							}
							return groups;
						},
						current(): MolangManualEntry | undefined {
							return this.entries.find(entry => entry.key == this.selection);
						},
						total_count(): number {
							return this.entries.length;
						},
					},
					methods: {
						select(entry: MolangManualEntry) {
							this.selection = entry.key;
						},
						sourceLabel(entry: MolangManualEntry): string {
							if (entry.source == 'plugin') return tl('molang_manual.source.plugin', [entry.provider || '?']);
							if (entry.source == 'project') return tl('molang_manual.source.project');
							return tl('molang_manual.source.official');
						},
					},
					template: `
						<div class="mfm_manual">
							<div class="mfm_sidebar">
								<div class="mfm_search">
									<input type="text" class="dark_bordered" placeholder="${ tl('molang_manual.search') }" v-model="query">
								</div>
								<div class="mfm_tree">
									<template v-for="group in groups">
										<div class="mfm_group">{{ group.label }}<span class="mfm_count">{{ group.entries.length }}</span></div>
										<div
											class="mfm_item"
											v-for="entry in group.entries"
											:key="entry.key"
											:class="{selected: selection == entry.key}"
											:title="entry.name"
											@click="select(entry)"
										>{{ entry.name }}</div>
									</template>
									<div class="mfm_empty" v-if="!groups.length">${ tl('molang_manual.no_match') }</div>
								</div>
							</div>
							<div class="mfm_content">
								<div class="mfm_overview" v-if="!current">
									<h2>${ tl('molang_manual.title') }</h2>
									<div class="mfm_badges">
										<span class="mfm_badge">${ tl('molang_manual.total') }：{{ total_count }}</span>
									</div>
									<p>${ tl('molang_manual.overview') }</p>
									<p class="mfm_muted">${ tl('molang_manual.source_note') }</p>
								</div>
								<div class="mfm_detail" v-else>
									<h2>{{ current.name }}</h2>
									<div class="mfm_badges">
										<span class="mfm_badge">{{ tl('molang_manual.group.' + current.group) }}</span>
										<span class="mfm_badge" :class="{'mfm_source_plugin': current.source == 'plugin'}">{{ sourceLabel(current) }}</span>
										<span class="mfm_badge" v-if="!current.autocomplete">${ tl('molang_manual.not_autocomplete') }</span>
									</div>
									<h4 class="mfm_section_title">${ tl('molang_manual.signature') }</h4>
									<code class="mfm_code">{{ current.signature }}</code>
									<p class="mfm_muted" v-if="current.aliases">${ tl('molang_manual.aliases') }：{{ current.aliases }}</p>
									<h4 class="mfm_section_title">${ tl('molang_manual.usage') }</h4>
									<p v-if="current.summary">{{ current.summary }}</p>
									<p class="mfm_muted" v-else>${ tl('molang_manual.no_usage') }</p>
									<template v-if="current.definition">
										<h4 class="mfm_section_title">${ tl('molang_manual.description') }</h4>
										<p v-if="current.definition.description">{{ current.definition.description }}</p>
										<p class="mfm_muted" v-else>${ tl('molang_manual.no_description') }</p>
										<h4 class="mfm_section_title">${ tl('molang_manual.definition') }</h4>
										<p class="mfm_muted">${ tl('molang_manual.inputs') }：{{ (current.definition.params || []).join(', ') || '—' }}</p>
										<p class="mfm_muted">${ tl('molang_manual.outputs') }：{{ (current.definition.outputs || []).join(', ') || '—' }}</p>
										<p class="mfm_muted">${ tl('molang_manual.locals') }：{{ (current.definition.locals || []).join(', ') || '—' }}</p>
										<code class="mfm_code">{{ current.definition.body }}</code>
										<h4 class="mfm_section_title">${ tl('molang_manual.example') }</h4>
										<code class="mfm_code">{{ current.signature.replace('new.', 'n.') }}</code>
									</template>
								</div>
							</div>
						</div>
					`
				}
	}).show();
}
