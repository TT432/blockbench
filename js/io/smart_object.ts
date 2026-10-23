/**
 * 智能对象（反馈 #205）
 *
 * 模型内的一个组可以标记为「智能对象」：标记后该组在大纲里显示特殊图标，
 * 并可以在一个独立标签页里单独编辑组内的内容；两个标签页的改动互相同步，
 * 但数据始终只存在主工程的同一个文件里（智能对象标签本身不落盘）。
 *
 * 实现依据（本工程架构约束）：
 * - 一个标签页 = 一个 ModelProject；Blockbench.Project / Format / Outliner / Texture.all / Undo
 *   都是「当前标签页」的单例，因此同一个 Project 不可能同时驱动两个视图；
 * - 唯一可行的形态是「两份对象副本 + 显式同步」，与贴图的 image-editor 标签
 *   （textures.js：openInImageEditor / syncToOtherProject）同构；
 * - 同步只能发生在「目标工程是当前选中工程」的时刻（新建元素会写全局 Project 数组），
 *   所以离开标签页时先取快照，到达目标标签页后再应用；
 * - 元素 uuid 全程保留，主工程里的关键帧/动画器引用不会因为同步失效。
 */

type SmartTabState = {
	parent_uuid: UUID
	group_uuid: UUID
};

type OutlinerSaveItem = UUID | {uuid: UUID, isOpen?: boolean, children: OutlinerSaveItem[]};

/** 贴图同步载荷：getUndoCopy 的推断类型缺少索引签名，这里显式命名用到的字段 */
export type TextureSyncCopy = {
	image_data?: string
	source?: string
	name?: string
	uv_width?: number
	uv_height?: number
} & Record<string, unknown>;

export type SmartFragment = {
	root_uuid: UUID
	root: Group
	elements: Record<string, unknown>[]
	groups: Group[]
	outliner: OutlinerSaveItem[]
	textures: {uuid: UUID, copy: TextureSyncCopy}[]
};

/**
 * 智能对象标签页的运行态（不写进模型文件，也不占用 ModelProject 的字段）。
 *
 * 同步载荷单独排队而不挂在标签页对象上：标签页关闭后，它最后的改动仍要能在
 * 主工程下次被选中时合并回去。
 */
const tab_states = new Map<UUID, SmartTabState>();
/** 待推送：key = 主工程 uuid，按来源标签页去重（保留最新一份），按入队顺序应用 */
const pending_pushes = new Map<UUID, {tab_uuid: UUID, fragment: SmartFragment}[]>();
/** 待拉取：key = 智能对象标签页 uuid */
const pending_pulls = new Map<UUID, SmartFragment>();

function stateOf(project?: ModelProject): SmartTabState | undefined {
	return project ? tab_states.get(project.uuid) : undefined;
}
function syncMeta() {
	return {
		format_version: '5.0',
		model_format: Project.format.id,
		box_uv: Project.box_uv,
	};
}
function queuePush(parent_uuid: UUID, tab_uuid: UUID, fragment: SmartFragment | null) {
	if (!fragment) return;
	const queue = pending_pushes.get(parent_uuid) || [];
	const existing = queue.findIndex(entry => entry.tab_uuid == tab_uuid);
	if (existing >= 0) queue[existing] = {tab_uuid, fragment};
	else queue.push({tab_uuid, fragment});
	pending_pushes.set(parent_uuid, queue);
}
function isGroupNode(node: OutlinerNode): node is Group {
	return !!node && node.type == 'group';
}
function isSaveGroup(item: unknown): item is {uuid: UUID, isOpen?: boolean, children: OutlinerSaveItem[]} {
	return typeof item == 'object' && item !== null && 'uuid' in item;
}

export const SmartObject = {
	// =========================================================================
	// 查询
	// =========================================================================
	getTab(parent_uuid?: UUID, group_uuid?: UUID): ModelProject | undefined {
		for (const project of ModelProject.all) {
			const state = stateOf(project);
			if (state && state.parent_uuid == parent_uuid && state.group_uuid == group_uuid) return project;
		}
	},
	parentProject(project?: ModelProject): ModelProject | undefined {
		const state = stateOf(project);
		if (!state) return;
		return ModelProject.all.find(p => p.uuid == state.parent_uuid);
	},
	isSmartTab(project: ModelProject = Project): boolean {
		return !!stateOf(project);
	},
	/** 标签栏图标：智能对象标签用专用图标，其余保持原样 */
	tabIcon(project: ModelProject): string {
		if (stateOf(project)) return 'folder_special';
		return project.format ? project.format.icon : 'home';
	},

	// =========================================================================
	// 入口
	// =========================================================================
	markGroup(group: Group) {
		if (!group || group.smart_object) return;
		Undo.initEdit({groups: [group]});
		group.smart_object = true;
		Undo.finishEdit('Create smart object');
		Outliner.updateNodeDisplayRules();
	},
	/** 大纲右键 →「创建为智能对象」：打标记并打开编辑标签页 */
	createFromGroup(group: Group) {
		if (!group || group.type != 'group') return;
		this.markGroup(group);
		this.openGroup(group);
	},
	/** 打开（或切换到）智能对象的编辑标签页 */
	openGroup(group: Group) {
		if (!group) return;
		if (!group.smart_object) this.markGroup(group);
		const parent = Project;
		if (this.isSmartTab(parent)) return;

		const existing = this.getTab(parent.uuid, group.uuid);
		if (existing) {
			existing.select();
			return existing;
		}

		// 快照必须在主工程选中时生成（保存拷贝依赖全局 Texture.all 等）
		const fragment = this.buildFragment(parent, group.uuid);
		if (!fragment) return;

		const parent_uuid = parent.uuid;
		const tab_name = group.name || tl('data.group');

		setupProject(parent.format);
		const tab = Project;
		tab_states.set(tab.uuid, {
			parent_uuid,
			group_uuid: group.uuid,
		});
		tab.name = tab_name;
		tab.box_uv = parent.box_uv;
		tab.texture_width = parent.texture_width;
		tab.texture_height = parent.texture_height;
		tab.mode = 'edit';
		this.applyFragment(tab, fragment, {create_root: true, undo: false});
		tab.saved = true;
		setProjectTitle(tab_name);
		if (Interface.tab_bar) Interface.tab_bar.$forceUpdate();
		return tab;
	},
	openParentProject(project: ModelProject) {
		const parent = this.parentProject(project);
		if (parent) parent.select();
		return parent;
	},

	// =========================================================================
	// 快照 / 应用
	// =========================================================================
	/** 生成某个组子树的快照（源工程必须是当前选中工程） */
	buildFragment(project: ModelProject, root_uuid?: UUID): SmartFragment | null {
		if (!root_uuid) return null;
		const root = project.groups.find(group => group.uuid == root_uuid);
		if (!root) return null;

		const meta = syncMeta();
		const elements: Record<string, unknown>[] = [];
		const groups: Group[] = [];
		const texture_uuids = new Set<UUID>();

		const collectOutliner = (node: Group): OutlinerSaveItem[] => {
			const result: OutlinerSaveItem[] = [];
			for (const child of node.children) {
				if (isGroupNode(child)) {
					result.push({uuid: child.uuid, isOpen: !!child.isOpen, children: collectOutliner(child)});
				} else {
					result.push(child.uuid);
				}
			}
			return result;
		};

		root.forEachChild(node => {
			if (isGroupNode(node)) {
				groups.push(node.getSaveCopy(false));
				if (node.texture) texture_uuids.add(node.texture);
			} else {
				const copy = node.getSaveCopy(meta) as Record<string, unknown>;
				elements.push(copy);
				const faces = copy.faces;
				if (faces && typeof faces == 'object') {
					for (const fkey in faces) {
						const texture_uuid = (faces as Record<string, {texture?: unknown}>)[fkey]?.texture;
						if (typeof texture_uuid == 'string' && texture_uuid) texture_uuids.add(texture_uuid);
					}
				}
				if (node.texture) texture_uuids.add(node.texture);
			}
		});

		const textures: SmartFragment['textures'] = [];
		project.textures.forEach(texture => {
			if (texture_uuids.has(texture.uuid)) {
				textures.push({uuid: texture.uuid, copy: texture.getUndoCopy(true) as TextureSyncCopy});
			}
		});

		return {
			root_uuid,
			root: root.getSaveCopy(false),
			elements,
			groups,
			outliner: collectOutliner(root),
			textures,
		};
	},
	/** 把快照应用到目标工程（目标必须是当前选中工程） */
	applyFragment(project: ModelProject, fragment?: SmartFragment | null, options: {create_root?: boolean, undo?: boolean} = {}) {
		if (!fragment) return;
		const use_undo = options.undo !== false;
		const old_elements: OutlinerElement[] = [];
		const old_groups: Group[] = [];
		const new_elements: OutlinerElement[] = [];
		const new_groups: Group[] = [];
		const textures: Texture[] = [];

		let root = project.groups.find(group => group.uuid == fragment.root_uuid);

		if (use_undo) {
			if (root) {
				root.forEachChild(node => {
					if (isGroupNode(node)) old_groups.push(node);
					else old_elements.push(node);
				});
			}
			fragment.textures.forEach(entry => {
				const texture = project.textures.find(tex => tex.uuid == entry.uuid);
				if (texture) textures.push(texture);
			});
			Undo.initEdit({
				elements: old_elements,
				groups: old_groups,
				textures,
				bitmap: textures.length > 0,
				outliner: true,
			});
		}

		// 1. 贴图：同 uuid 覆盖像素与属性，缺失则新建
		fragment.textures.forEach(entry => {
			const image_data = entry.copy.image_data || entry.copy.source;
			const data = Object.assign({}, entry.copy);
			delete data.image_data;
			delete data.source;
			let texture = project.textures.find(tex => tex.uuid == entry.uuid);
			if (!texture) {
				texture = new Texture(data, entry.uuid);
				texture.add(false);
				if (image_data) texture.fromDataURL(image_data);
			} else {
				texture.extend(data);
				if (image_data) texture.updateSource(image_data);
			}
		});

		// 2. 根组自身属性
		if (!root) {
			root = new Group(fragment.root, fragment.root_uuid).init();
			if (options.create_root) {
				root.removeFromParent();
				project.outliner.push(root);
				root.parent = Outliner.ROOT;
				root.isOpen = true;
			}
		} else {
			// 大纲展开状态属于各标签页自己的视图状态，不跟着内容同步
			const is_open = root.isOpen;
			root.extend(fragment.root);
			if (fragment.root.origin) root.origin.V3_set(fragment.root.origin);
			if (fragment.root.rotation) root.rotation.V3_set(fragment.root.rotation);
			root.isOpen = is_open;
		}

		// 3. 清掉旧子树（不走 node.remove()：它会解绑动画器，主工程的关键帧必须保留）
		old_elements.concat(old_groups).forEach(node => this.detachNode(node, project));

		// 4. 按快照重建元素与子组（uuid 保留）
		fragment.elements.forEach(copy => {
			const element = OutlinerElement.fromSave(copy, true);
			if (element) new_elements.push(element);
		});
		fragment.groups.forEach(copy => {
			new_groups.push(new Group(copy, copy.uuid).init());
		});

		// 5. 重建大纲结构
		root.children.empty();
		this.attachOutliner(fragment.outliner, root);

		if (use_undo) {
			Undo.finishEdit('Sync smart object', {
				elements: old_elements.concat(new_elements),
				groups: old_groups.concat(new_groups),
				textures,
				bitmap: textures.length > 0,
				outliner: true,
			});
		}

		Canvas.updateAllFaces();
		Canvas.updateAllBones();
		Canvas.updateAllPositions();
		Outliner.updateNodeDisplayRules();
		updateSelection();
		if (!Modes.animate && !Modes.pose) Animator.showDefaultPose(true);
		return this;
	},
	attachOutliner(list: OutlinerSaveItem[], parent: Group) {
		for (const item of list) {
			const node = OutlinerNode.uuids[isSaveGroup(item) ? item.uuid : item];
			if (!node) continue;
			node.removeFromParent();
			parent.children.push(node);
			node.parent = parent;
			if (isSaveGroup(item)) {
				node.isOpen = !!item.isOpen;
				if (isGroupNode(node)) {
					node.children.empty();
					this.attachOutliner(item.children, node);
				}
			}
		}
	},
	/** 从工程里摘掉一个节点，但不动动画器绑定 */
	detachNode(node: OutlinerNode, project: ModelProject) {
		if (!node) return;
		if (node.preview_controller) node.preview_controller.remove(node);
		if (OutlinerNode.uuids[node.uuid] == node) delete OutlinerNode.uuids[node.uuid];
		node.unselect();
		node.removeFromParent();
		if (isGroupNode(node)) {
			project.groups.remove(node);
			node.children.empty();
		} else {
			project.elements.remove(node);
			project.selected_elements.remove(node);
		}
	},

	// =========================================================================
	// 双向同步
	// =========================================================================
	fragmentSignature(fragment?: SmartFragment | null): string {
		if (!fragment) return '';
		const texture_signature = fragment.textures.map(entry => {
			const data = entry.copy.image_data || entry.copy.source || '';
			let hash = 0;
			for (let i = 0; i < data.length; i += 61) {
				hash = (hash * 31 + data.charCodeAt(i)) | 0;
			}
			return [entry.uuid, entry.copy.name, entry.copy.uv_width, entry.copy.uv_height, data.length, hash];
		});
		// 大纲展开状态不同步，签名里剔除以避免切换标签页时反复重建
		const root_copy = Object.assign({}, fragment.root, {isOpen: undefined});
		return JSON.stringify([
			fragment.elements,
			fragment.groups,
			fragment.outliner,
			root_copy,
			texture_signature,
		]);
	},
	/** 离开某个工程前抓快照（此时它仍是选中工程） */
	onProjectUnselected(project: ModelProject) {
		const state = stateOf(project);
		if (state) {
			const fragment = this.buildFragment(project, state.group_uuid);
			const parent = this.parentProject(project);
			if (parent) {
				queuePush(parent.uuid, project.uuid, fragment);
				if (fragment) parent.saved = false;
			}
		}
		ModelProject.all.forEach(tab => {
			const tab_state = stateOf(tab);
			if (tab_state && tab_state.parent_uuid == project.uuid) {
				const fragment = this.buildFragment(project, tab_state.group_uuid);
				if (fragment) pending_pulls.set(tab.uuid, fragment);
			}
		});
	},
	/** 进入某个工程后应用待同步的快照（此时它是选中工程） */
	onProjectLoaded(project: ModelProject) {
		const state = stateOf(project);
		if (state) {
			const fragment = pending_pulls.get(project.uuid);
			pending_pulls.delete(project.uuid);
			if (!fragment || !this.parentProject(project)) return;
			// 本标签页还有未合并回主工程的改动时，它的数据更新，不能被主工程的旧状态覆盖
			const queued = pending_pushes.get(state.parent_uuid);
			if (queued && queued.some(entry => entry.tab_uuid == project.uuid)) return;
			const current = this.buildFragment(project, state.group_uuid);
			if (this.fragmentSignature(fragment) == this.fragmentSignature(current)) return;
			this.applyFragment(project, fragment, {create_root: false, undo: true});
			// 快照替换了工程内容，旧 undo 记录引用的对象已不存在
			this.clearUndo(project);
		} else {
			this.pushPending(project);
		}
	},
	pushPending(project: ModelProject): boolean {
		const queue = pending_pushes.get(project.uuid);
		if (!queue || !queue.length) return false;
		pending_pushes.delete(project.uuid);
		for (const entry of queue) {
			this.applyFragment(project, entry.fragment, {create_root: false, undo: true});
		}
		project.saved = false;
		return true;
	},
	clearUndo(project: ModelProject) {
		const undo = project.undo;
		if (!undo) return;
		undo.history.empty();
		undo.index = 0;
		if (undo.current_save) delete undo.current_save;
	},
	/** 智能对象标签里保存 = 把改动推回主工程并保存主工程 */
	saveFromTab() {
		const tab = Project;
		const parent = this.parentProject(tab);
		if (!parent) return;
		parent.select();	// 选中过程会把待推送快照应用到主工程
		parent.saved = false;
		BarItems.save_project.trigger();
		tab.select();
	},
	/** 关闭前处理：标签页抓快照，主工程应用待推送快照 */
	onBeforeClose(project: ModelProject) {
		const state = stateOf(project);
		if (state) {
			const fragment = this.buildFragment(project, state.group_uuid);
			const parent = this.parentProject(project);
			if (parent) {
				queuePush(parent.uuid, project.uuid, fragment);
				if (fragment) parent.saved = false;
			}
			project.saved = true;
		} else {
			this.pushPending(project);
		}
	},
	/** 主工程关闭后丢弃它的智能对象标签（内容已在 pushPending 里合并） */
	onProjectClosed(project: ModelProject) {
		pending_pushes.delete(project.uuid);
		ModelProject.all.filter(tab => {
			const state = stateOf(tab);
			return !!state && state.parent_uuid == project.uuid;
		}).forEach(tab => this.discardTab(tab));
	},
	discardTab(tab: ModelProject) {
		if (!tab || Project === tab) return;
		tab_states.delete(tab.uuid);
		const data = ProjectData[tab.uuid];
		if (data) {
			for (const uuid in data.nodes_3d) {
				const node_3d = data.nodes_3d[uuid];
				if (node_3d.parent) node_3d.parent.remove(node_3d);
				if (node_3d.geometry) node_3d.geometry.dispose();
				if (node_3d.outline && node_3d.outline.geometry) node_3d.outline.geometry.dispose();
			}
		}
		tab.textures.forEach(texture => texture.stopWatcher && texture.stopWatcher());
		ModelProject.all.remove(tab);
		delete ProjectData[tab.uuid];
	},
};

// =========================================================================
// 注册：组属性、图标、右键菜单项、动作
// =========================================================================
new Property(Group, 'boolean', 'smart_object');

Object.defineProperty(Group.prototype, 'icon', {
	configurable: true,
	get() {
		return this.smart_object ? 'folder_special' : 'folder';
	},
	set(value: string) {
		Object.defineProperty(this, 'icon', {value, configurable: true, writable: true});
	},
});

BARS.defineActions(() => {
	new Action('create_smart_object', {
		icon: 'folder_special',
		category: 'edit',
		condition: () => Modes.edit && !SmartObject.isSmartTab() &&
			Group.first_selected instanceof Group &&
			!Group.first_selected.smart_object,
		click() {
			const group = Group.first_selected;
			if (group instanceof Group) SmartObject.createFromGroup(group);
		},
	});
	new Action('edit_smart_object', {
		icon: 'folder_special',
		category: 'edit',
		condition: () => Modes.edit && !SmartObject.isSmartTab() &&
			Group.first_selected instanceof Group &&
			!!Group.first_selected.smart_object,
		click() {
			const group = Group.first_selected;
			if (group instanceof Group) SmartObject.openGroup(group);
		},
	});
	new Action('open_smart_object_parent', {
		icon: 'tab',
		category: 'file',
		condition: () => SmartObject.isSmartTab(),
		click() {
			SmartObject.openParentProject(Project);
		},
	});
});

const global = {
	SmartObject,
};
declare global {
	const SmartObject: typeof global.SmartObject
}
Object.assign(window, global);
