// 社区版功能手册（反馈#191）：帮助菜单里的「社区版功能」入口。
// 左右布局的说明书：左侧按工作区域聚类 + 关键词搜索，右侧显示某条功能的
// 入口指引、功能说明、与原版 Blockbench 的差异、以及设置里的开关位置。
// 内容数据维护在同目录的 community_features_data.ts。
import { Interface } from "./interface";
import { ScrollMemory } from "./scroll_memory";
import { COMMUNITY_FEATURES, COMMUNITY_FEATURE_AREAS, CommunityFeature, CommunityFeatureArea } from "./community_features_data";

/** 手册里的当前选择（总览 / 某个区域 / 某条功能） */
interface ManualSelection {
	kind: string
	area: string
	id: string
}

/**
 * 反馈#238：记住上次点开的条目。一页里条目很多，重开手册时回到总览很难接着看；
 * 只在内存里（进程生命周期内有效，重启清零），与 ScrollMemory 的滚动记忆配套。
 */
let last_selection: ManualSelection = {kind: 'overview', area: '', id: ''};


const MANUAL_CSS = `
.cf_manual {
	display: flex;
	height: min(64vh, 580px);
	margin-top: 4px;
}
.cf_sidebar {
	width: 232px;
	flex: 0 0 232px;
	display: flex;
	flex-direction: column;
	border-right: 1px solid var(--color-border);
	padding-right: 10px;
	min-height: 0;
}
.cf_search input {
	width: 100%;
	box-sizing: border-box;
}
.cf_tree {
	flex: 1;
	overflow-y: auto;
	margin-top: 8px;
	padding-right: 2px;
	min-height: 0;
}
.cf_tree_wrapper {
	flex: 1;
	display: flex;
	min-height: 0;
}
.cf_overview,
.cf_item {
	padding: 3px 8px;
	border-radius: 4px;
	cursor: pointer;
	line-height: 1.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.cf_overview {
	font-weight: 600;
	margin-bottom: 4px;
}
.cf_item {
	font-size: 13px;
	padding-left: 16px;
	color: var(--color-subtle_text);
}
.cf_overview:hover,
.cf_item:hover {
	background-color: var(--color-button);
}
.cf_overview.selected,
.cf_item.selected {
	background-color: var(--color-selected);
	color: var(--color-text);
}
.cf_area {
	display: flex;
	align-items: baseline;
	gap: 6px;
	margin-top: 10px;
	padding: 2px 8px;
	font-size: 11.5px;
	font-weight: 600;
	letter-spacing: 0.06em;
	color: var(--color-subtle_text);
	cursor: pointer;
	text-transform: none;
}
.cf_area:hover {
	color: var(--color-text);
}
.cf_area.selected {
	color: var(--color-accent);
}
.cf_count {
	font-weight: 400;
	opacity: 0.7;
}
.cf_empty {
	margin: 16px 8px;
	color: var(--color-subtle_text);
}
.cf_content_wrapper {
	flex: 1;
	display: flex;
	min-width: 0;
	min-height: 0;
}
.cf_content {
	flex: 1;
	overflow-y: auto;
	padding: 0 6px 0 14px;
	min-height: 0;
}
.cf_detail h2 {
	margin: 0 0 6px;
	font-size: 17px;
}
.cf_badges {
	display: flex;
	gap: 6px;
	margin-bottom: 12px;
}
.cf_badge {
	font-size: 11px;
	padding: 1px 7px;
	border-radius: 9px;
	background-color: var(--color-button);
	color: var(--color-subtle_text);
}
.cf_badge.cf_kind_new {
	background-color: var(--color-accent);
	color: var(--color-accent_text);
}
.cf_section_title {
	margin: 14px 0 3px;
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	color: var(--color-accent);
}
.cf_content p {
	margin: 0;
	line-height: 1.65;
}
.cf_entry {
	font-family: var(--font-code, monospace);
	font-size: 12.5px;
}
.cf_muted {
	color: var(--color-subtle_text);
}
.cf_area_body h3 {
	margin: 0 0 10px;
	font-size: 16px;
}
.cf_area_row {
	padding: 8px 10px;
	margin-bottom: 6px;
	border-radius: 5px;
	border: 1px solid var(--color-border);
	cursor: pointer;
}
.cf_area_row:hover {
	border-color: var(--color-accent);
}
.cf_area_row_title {
	display: flex;
	align-items: center;
	gap: 8px;
	font-weight: 600;
	margin-bottom: 2px;
}
.cf_area_row p {
	color: var(--color-subtle_text);
	font-size: 12.5px;
}
.cf_legend {
	margin: 10px 0 0;
	color: var(--color-subtle_text);
	font-size: 12.5px;
	line-height: 1.7;
}
`;

function ensureManualCSS() {
	if (document.getElementById('community_features_css')) return;
	document.head.append(Interface.createElement('style', {id: 'community_features_css'}, MANUAL_CSS));
}

BARS.defineActions(() => {
	new Action('community_features', {
		icon: 'menu_book',
		category: 'blockbench',
		click() {
			ensureManualCSS();
			let features = COMMUNITY_FEATURES;
			new Dialog({
				id: 'community_features',
				title: 'menu.help.community_features',
				width: 820,
				buttons: ['dialog.close'],
				component: {
					data() {
						return {
							query: '',
							selection: {...last_selection} as {kind: string, area: string, id: string},
						}
					},
					computed: {
						groups(): {area: CommunityFeatureArea, features: CommunityFeature[]}[] {
							let query = this.query.trim().toLowerCase();
							let groups: {area: CommunityFeatureArea, features: CommunityFeature[]}[] = [];
							for (let area of COMMUNITY_FEATURE_AREAS) {
								let list = features.filter(feature => {
									if (feature.area != area) return false;
									if (!query) return true;
									return [feature.name, feature.area, feature.entry, feature.summary, feature.compare, feature.toggle]
										.filter(text => !!text).join(' ').toLowerCase().includes(query);
								});
								if (list.length) groups.push({area, features: list});
							}
							return groups;
						},
						current_feature(): CommunityFeature | undefined {
							return features.find(feature => feature.id == this.selection.id);
						},
						current_area(): {area: CommunityFeatureArea, features: CommunityFeature[]} | undefined {
							return this.groups.find(group => group.area == this.selection.area);
						},
						total_count(): number {
							return features.length;
						},
					},
					created() {
						// 反馈#235：按「当前选择」记忆详情列的滚动位置，只存在内存里
						this.scroll_memory = new ScrollMemory({
							getKey: () => `community_features/${this.selection.kind}/${this.selection.area}/${this.selection.id}`,
							getContainer: () => this.$refs.content ?? null,
							getLabel: () => tl('dialog.settings.scroll_to_top'),
							isFiltered: () => !!this.query.trim(),
						});
						// 反馈#235：左侧功能树（83 条的长列表）单独记忆；它不随选择重建，只需恢复
						this.tree_memory = new ScrollMemory({
							getKey: () => 'community_features/tree',
							getContainer: () => this.$refs.tree ?? null,
							getLabel: () => tl('dialog.settings.scroll_to_top'),
							isFiltered: () => !!this.query.trim(),
						});
					},
					mounted() {
						this.scroll_memory.attach(this.$refs.scroll_area ?? null);
						this.scroll_memory.restore();
						this.tree_memory.attach(this.$refs.sidebar ?? null);
						this.tree_memory.restore();
					},
					watch: {
						query() {
							// 反馈#235：过滤会重建详情内容与功能树，此时回到顶部，不用陈旧位置
							this.$nextTick(() => {
								this.scroll_memory.restore();
								this.tree_memory.restore();
							});
						}
					},
					methods: {
						applySelection(selection: {kind: string, area: string, id: string}) {
							// 反馈#235：切走前记下当前选择的滚动位置，切完恢复目标选择的位置
							this.scroll_memory.save();
							// 反馈#238：同时记住这次点开的条目，下次打开手册直接回到这里
							last_selection = {...selection};
							this.selection = selection;
							this.$nextTick(() => this.scroll_memory.restore());
						},
						selectOverview() {
							this.applySelection({kind: 'overview', area: '', id: ''});
						},
						selectArea(area: CommunityFeatureArea) {
							this.applySelection({kind: 'area', area, id: ''});
						},
						selectFeature(feature: CommunityFeature) {
							this.applySelection({kind: 'feature', area: feature.area, id: feature.id});
						},
					},
					template: `
						<div class="cf_manual">
							<div class="cf_sidebar">
								<div class="cf_search">
									<input type="text" class="dark_bordered" placeholder="${ tl('community_features.search') }" v-model="query">
								</div>
								<div class="cf_tree_wrapper" ref="sidebar">
								<div class="cf_tree" ref="tree">
									<div class="cf_overview" :class="{selected: selection.kind == 'overview'}" @click="selectOverview()">
										${ tl('community_features.overview') }
									</div>
									<template v-for="group in groups">
										<div class="cf_area" :class="{selected: selection.kind == 'area' && selection.area == group.area}" @click="selectArea(group.area)">
											{{ group.area }}<span class="cf_count">{{ group.features.length }}</span>
										</div>
										<div
											class="cf_item"
											v-for="feature in group.features"
											:class="{selected: selection.kind == 'feature' && selection.id == feature.id}"
											:title="feature.name"
											@click="selectFeature(feature)"
										>{{ feature.name }}</div>
									</template>
									<div class="cf_empty" v-if="!groups.length">${ tl('community_features.no_match') }</div>
								</div>
								</div>
							</div>
							<div class="cf_content_wrapper" ref="scroll_area">
							<div class="cf_content" ref="content">
								<div class="cf_detail" v-if="selection.kind == 'overview'">
									<h2>${ tl('community_features.overview') }</h2>
									<div class="cf_badges">
										<span class="cf_badge">${ tl('community_features.total') }：{{ total_count }}</span>
									</div>
									<p>${ tl('community_features.overview.desc') }</p>
									<p class="cf_legend">
										${ tl('community_features.overview.legend') }
									</p>
								</div>
								<div class="cf_area_body" v-else-if="selection.kind == 'area' && current_area">
									<h3>{{ current_area.area }}</h3>
									<div class="cf_area_row" v-for="feature in current_area.features" @click="selectFeature(feature)">
										<div class="cf_area_row_title">
											{{ feature.name }}
											<span class="cf_badge" :class="{'cf_kind_new': feature.kind == '新增'}">{{ feature.kind }}</span>
										</div>
										<p>{{ feature.summary }}</p>
									</div>
								</div>
								<div class="cf_detail" v-else-if="selection.kind == 'feature' && current_feature">
									<h2>{{ current_feature.name }}</h2>
									<div class="cf_badges">
										<span class="cf_badge">{{ current_feature.area }}</span>
										<span class="cf_badge" :class="{'cf_kind_new': current_feature.kind == '新增'}">{{ current_feature.kind }}</span>
									</div>
									<h4 class="cf_section_title">${ tl('community_features.entry') }</h4>
									<p class="cf_entry">{{ current_feature.entry }}</p>
									<h4 class="cf_section_title">${ tl('community_features.summary') }</h4>
									<p>{{ current_feature.summary }}</p>
									<template v-if="current_feature.compare">
										<h4 class="cf_section_title">${ tl('community_features.compare') }</h4>
										<p>{{ current_feature.compare }}</p>
									</template>
									<h4 class="cf_section_title">${ tl('community_features.toggle') }</h4>
									<p v-if="!current_feature.toggle" class="cf_muted">${ tl('community_features.toggle.none.desc') }</p>
									<p v-else class="cf_entry">{{ current_feature.toggle }}</p>
								</div>
							</div>
							</div>
						</div>
					`
				}
			}).show();
		}
	});
});
