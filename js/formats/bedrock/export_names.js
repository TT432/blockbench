/**
 * 基岩版导出名称映射
 *
 * 定义域（依据官方文档 bedrock.dev §"Setup an Entity"：All names: animations, bones, states, etc,
 * must all start with a letter and contain only alphanumerics, underscore, or period）：
 *   - 骨骼名（geometry bones[].name / parent）
 *   - 定位器名（geometry bones[].locators 的键）
 *   - 动画名（animation 文件的顶层键，以及控制器对动画的引用）
 *   - 动画控制器名（animation_controllers 文件的顶层键）
 * 这四类名称会被实体定义文件等外部文件按名称引用，因此导出时必须合规。
 *
 * 不处理：状态名、纹理名、Java 导出的通道名 —— 它们只在同一文件内部自引用，不需要外部一致。
 *
 * 编辑器内部（内存与 .bbmodel）允许任意名称；本模块只在导出编译时把不合规名称替换为自动生成的
 * 合规名称，并给出「不对称导出表」与「短名称表」。
 */

const BEDROCK_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_.]*$/;

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isLegalBedrockName(name) {
	return typeof name == 'string' && BEDROCK_NAME_REGEX.test(name);
}

/**
 * 把任意字符串压成合规名称的候选值（不含唯一性处理）
 * @param {string} name
 * @param {string} fallback 完全无法提取时使用的前缀
 */
function bedrockNameSlug(name, fallback) {
	let result = String(name ?? '')
		.replace(/[^a-zA-Z0-9_.]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^[^a-zA-Z]+/, '')
		.replace(/_+$/, '');
	if (!result) result = fallback;
	return result;
}

/**
 * 在已占用的名称集合中取得唯一名称：冲突时追加 uuid 前缀（稳定），仍冲突再追加序号
 */
function reserveName(base, used, uuid) {
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let suffix = String(uuid ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'x';
	let candidate = `${base}_${suffix}`;
	let i = 2;
	while (used.has(candidate)) {
		candidate = `${base}_${suffix}${i}`;
		i++;
	}
	used.add(candidate);
	return candidate;
}

function sortByUuid(a, b) {
	if (a.uuid == b.uuid) return 0;
	return a.uuid < b.uuid ? -1 : 1;
}

function collectNodes(getter) {
	try {
		let nodes = getter();
		return Array.isArray(nodes) ? nodes.filter(node => node && typeof node.name == 'string') : [];
	} catch (error) {
		return [];
	}
}

function createDomain(nodes, domain_label, fallback) {
	const used = new Set();
	const map = new Map();
	const byName = new Map();
	const renamed = [];
	const sorted = nodes.slice().sort(sortByUuid);

	// 第一轮：已合规的名称原样保留（避免因为别人的改名而被动改名）
	for (let node of sorted) {
		if (!isLegalBedrockName(node.name)) continue;
		if (used.has(node.name)) continue;
		used.add(node.name);
		map.set(node.uuid, node.name);
		if (!byName.has(node.name)) byName.set(node.name, node.name);
	}
	// 第二轮：不合规的名称换成自动生成的合规名称
	for (let node of sorted) {
		if (map.has(node.uuid)) continue;
		let exported = reserveName(bedrockNameSlug(node.name, fallback), used, node.uuid);
		map.set(node.uuid, exported);
		if (!byName.has(node.name)) byName.set(node.name, exported);
		renamed.push({domain: domain_label, internal: node.name, exported});
	}

	return {
		map,
		byName,
		used,
		renamed,
		get(uuid, internal_name) {
			if (map.has(uuid)) return map.get(uuid);
			if (typeof internal_name == 'string' && byName.has(internal_name)) return byName.get(internal_name);
			return typeof internal_name == 'string' ? bedrockNameSlug(internal_name, fallback) : fallback;
		},
		/** 无节点绑定（孤儿动画器）时按内部名称解析，冲突时用该动画器的 uuid 稳定消解 */
		byInternalName(internal_name, uuid) {
			if (typeof internal_name != 'string') return fallback;
			if (byName.has(internal_name)) return byName.get(internal_name);
			if (isLegalBedrockName(internal_name) && !used.has(internal_name)) return internal_name;
			let base = bedrockNameSlug(internal_name, fallback);
			if (!used.has(base)) return base;
			let suffix = String(uuid ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'x';
			return `${base}_${suffix}`;
		},
	};
}

/** 控制器状态里引用动画时使用的短名（取导出全名的最后一段；基岩版短名与几何无关，仅供实体文件引用） */
function shortNameOf(exported_full_name, fallback) {
	let segment = exported_full_name.split('.').last();
	if (!segment) segment = bedrockNameSlug(exported_full_name, fallback || 'animation');
	return segment;
}

/**
 * 构建一次导出使用的完整名称映射
 */
export function buildBedrockExportNames() {
	const bones = createDomain(collectNodes(() => Group.all), 'bone', 'bone');
	const locators = createDomain(collectNodes(() => {
		let list = [...(typeof Locator != 'undefined' ? Locator.all : [])];
		if (typeof NullObject != 'undefined') list.push(...NullObject.all);
		return list;
	}), 'locator', 'locator');
	const animations = createDomain(collectNodes(() => Animation.all), 'animation', 'animation');
	const controllers = createDomain(collectNodes(() => {
		return typeof AnimationController != 'undefined' ? AnimationController.all : [];
	}), 'controller', 'controller');

	const animation_short_by_name = new Map();
	const animation_short_by_uuid = new Map();
	animations.map.forEach((exported, uuid) => {
		let animation = Animation.all.find(a => a.uuid == uuid);
		animation_short_by_uuid.set(uuid, shortNameOf(exported, 'animation'));
		if (animation) {
			let internal_short = animation.getShortName();
			if (!animation_short_by_name.has(internal_short)) {
				animation_short_by_name.set(internal_short, animation_short_by_uuid.get(uuid));
			}
		}
	});

	const renamed = [...bones.renamed, ...locators.renamed, ...animations.renamed, ...controllers.renamed];

	// 短名称表：控制器引用到的动画 + 导出名发生变化的动画
	const short_rows = [];
	const seen = new Set();
	function pushShortRow(animation) {
		if (!animation || seen.has(animation.uuid)) return;
		seen.add(animation.uuid);
		let exported = animations.get(animation.uuid, animation.name);
		let internal_short = animation.getShortName();
		let exported_short = animation_short_by_uuid.get(animation.uuid) ?? shortNameOf(exported, 'animation');
		short_rows.push({
			internal: animation.name,
			internal_short,
			exported,
			short: exported_short,
		});
	}
	if (typeof AnimationController != 'undefined') {
		for (let controller of AnimationController.all) {
			for (let state of controller.states ?? []) {
				for (let link of state.animations ?? []) {
					let animation = link.animation ? Animation.all.find(a => a.uuid == link.animation) : null;
					if (!animation && link.key) {
						animation = Animation.all.find(a => a.getShortName() == link.key);
					}
					pushShortRow(animation);
				}
			}
		}
	}
	animations.renamed.forEach(row => {
		let animation = Animation.all.find(a => a.name == row.internal);
		pushShortRow(animation);
	});
	short_rows.sort((a, b) => (a.exported < b.exported ? -1 : a.exported > b.exported ? 1 : 0));

	return {
		bones,
		locators,
		animations,
		controllers,
		renamed,
		short_names: short_rows,
		get has_changes() {
			return renamed.length > 0;
		},
		get has_short_names() {
			return short_rows.length > 0;
		},
		bone(node) {
			return bones.get(node.uuid, node.name);
		},
		boneName(name, uuid) {
			return bones.byInternalName(name, uuid);
		},
		locator(node) {
			return locators.get(node.uuid, node.name);
		},
		locatorName(name, uuid) {
			return locators.byInternalName(name, uuid);
		},
		animation(animation) {
			return animations.get(animation.uuid, animation.name);
		},
		animationName(name) {
			return animations.byInternalName(name);
		},
		animationShort(animation) {
			return animation_short_by_uuid.get(animation.uuid) ?? shortNameOf(animations.get(animation.uuid, animation.name), 'animation');
		},
		/** 控制器里的 animation.key（内部短名 / 实体文件别名）→ 导出后的短名 */
		animationShortByLink(link) {
			let key = link.key;
			// 已合规的短名原样保留：它可能是实体文件里定义的别名（getShortName 会返回别名）
			if (key && isLegalBedrockName(key)) return key;
			let animation = link.animation ? Animation.all.find(a => a.uuid == link.animation) : null;
			if (!animation && key) {
				animation = Animation.all.find(a => a.getShortName() == key);
			}
			if (animation) return this.animationShort(animation);
			if (!key) return '';
			if (animation_short_by_name.has(key)) return animation_short_by_name.get(key);
			return bedrockNameSlug(key, 'animation');
		},
		controller(controller) {
			return controllers.get(controller.uuid, controller.name);
		},
	};
}

/** 最近一次编译使用的映射，供写盘完成后弹窗使用 */
let last_export_names = null;

export function setLastExportNames(export_names) {
	last_export_names = export_names;
}

/** 重写 bedrock_binding 等字符串字面量里引用的骨骼名（只处理能解析到现存节点的字面量） */
export function mapBindingLiterals(binding, export_names) {
	if (typeof binding != 'string') return binding;
	return binding.replace(/'([^']+)'/g, (match, name) => {
		if (!export_names.bones.byName.has(name)) return match;
		return `'${export_names.bones.byName.get(name)}'`;
	});
}

/** 重写动画关键帧里引用的定位器名（compileBedrockKeyframe 的返回值可能是对象或数组） */
export function mapKeyframeLocators(compiled, export_names) {
	let points = Array.isArray(compiled) ? compiled : [compiled];
	points.forEach(point => {
		if (point && typeof point == 'object' && typeof point.locator == 'string' && point.locator) {
			point.locator = export_names.locatorName(point.locator);
		}
	});
	return compiled;
}

function csvCell(value) {
	let text = String(value ?? '');
	if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
	return text;
}

export function createRenameCSV(export_names) {
	let rows = [['domain', 'internal_name', 'exported_name']];
	export_names.renamed.forEach(row => rows.push([row.domain, row.internal, row.exported]));
	return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function createShortNameCSV(export_names) {
	let rows = [['animation', 'exported_name', 'short_name']];
	export_names.short_names.forEach(row => rows.push([row.internal, row.exported, row.short]));
	return rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function exportCSV(file_name, content) {
	Blockbench.export({
		resource_id: 'bedrock_export_names_csv',
		type: 'CSV',
		extensions: ['csv'],
		name: file_name,
		content,
	});
}

/**
 * 导出后弹窗提示「不对称导出表」与「短名称表」，两张表都可以导出为 CSV
 */
export function showBedrockExportNameReport(export_names, force = false) {
	if (!export_names) return;
	if (!force && !export_names.has_changes) return;
	if (!export_names.has_changes && !export_names.has_short_names) return;
	if (Dialog.open && Dialog.open.id == 'bedrock_export_names') return;

	let renamed = JSON.parse(JSON.stringify(export_names.renamed));
	let short_names = JSON.parse(JSON.stringify(export_names.short_names));
	let domain_labels = {
		bone: tl('bedrock.export_names.domain.bone'),
		locator: tl('bedrock.export_names.domain.locator'),
		animation: tl('bedrock.export_names.domain.animation'),
		controller: tl('bedrock.export_names.domain.controller'),
	};
	renamed.forEach(row => row.domain_label = domain_labels[row.domain] ?? row.domain);

	new Dialog('bedrock_export_names', {
		title: tl('bedrock.export_names.title'),
		width: 720,
		buttons: [
			tl('bedrock.export_names.csv_renamed'),
			tl('bedrock.export_names.csv_short'),
			tl('dialog.close'),
		],
		onButton(button_index) {
			if (button_index === 0) {
				exportCSV('bedrock_export_names_renamed', createRenameCSV(export_names));
				return false;
			}
			if (button_index === 1) {
				exportCSV('bedrock_export_names_shorts', createShortNameCSV(export_names));
				return false;
			}
		},
		component: {
			data() {
				return {
					renamed,
					short_names,
					texts: {
						warning: tl('bedrock.export_names.warning'),
						renamed_title: tl('bedrock.export_names.renamed_title'),
						short_title: tl('bedrock.export_names.short_title'),
						empty_renamed: tl('bedrock.export_names.empty_renamed'),
						empty_short: tl('bedrock.export_names.empty_short'),
						column_domain: tl('bedrock.export_names.column.domain'),
						column_internal: tl('bedrock.export_names.column.internal'),
						column_exported: tl('bedrock.export_names.column.exported'),
						column_short: tl('bedrock.export_names.column.short'),
					}
				}
			},
			template: `
				<div style="max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:12px;">
					<p style="margin:0;">{{ texts.warning }}</p>
					<div>
						<h4 style="margin:0 0 4px;">{{ texts.renamed_title }}</h4>
						<p v-if="!renamed.length" style="margin:0;opacity:0.7;">{{ texts.empty_renamed }}</p>
						<table v-else style="width:100%;border-collapse:collapse;">
							<thead>
								<tr>
									<th style="text-align:left;border-bottom:1px solid var(--color-border);padding:2px 6px;">{{ texts.column_domain }}</th>
									<th style="text-align:left;border-bottom:1px solid var(--color-border);padding:2px 6px;">{{ texts.column_internal }}</th>
									<th style="text-align:left;border-bottom:1px solid var(--color-border);padding:2px 6px;">{{ texts.column_exported }}</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(row, i) in renamed" :key="'r' + i">
									<td style="padding:2px 6px;">{{ row.domain_label }}</td>
									<td style="padding:2px 6px;">{{ row.internal }}</td>
									<td style="padding:2px 6px;">{{ row.exported }}</td>
								</tr>
							</tbody>
						</table>
					</div>
					<div>
						<h4 style="margin:0 0 4px;">{{ texts.short_title }}</h4>
						<p v-if="!short_names.length" style="margin:0;opacity:0.7;">{{ texts.empty_short }}</p>
						<table v-else style="width:100%;border-collapse:collapse;">
							<thead>
								<tr>
									<th style="text-align:left;border-bottom:1px solid var(--color-border);padding:2px 6px;">{{ texts.column_internal }}</th>
									<th style="text-align:left;border-bottom:1px solid var(--color-border);padding:2px 6px;">{{ texts.column_exported }}</th>
									<th style="text-align:left;border-bottom:1px solid var(--color-border);padding:2px 6px;">{{ texts.column_short }}</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="(row, i) in short_names" :key="'s' + i">
									<td style="padding:2px 6px;">{{ row.internal }}</td>
									<td style="padding:2px 6px;">{{ row.exported }}</td>
									<td style="padding:2px 6px;">{{ row.short }}</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>`
		}
	}).show();
}

/** 写盘完成后调用：用最近一次编译的映射弹窗 */
export function reportExportNames() {
	showBedrockExportNameReport(last_export_names);
}

/** 随时查看「不对称导出表 / 短名称表」（无改名时也能看） */
export function openBedrockExportNameReport() {
	showBedrockExportNameReport(buildBedrockExportNames(), true);
}

new Action('bedrock_export_name_report', {
	name: tl('bedrock.export_names.action'),
	description: tl('bedrock.export_names.action.desc'),
	icon: 'table_chart',
	category: 'animation',
	condition: () => Format.id == 'bedrock' || Format.id == 'bedrock_block',
	click() {
		openBedrockExportNameReport();
	}
});
