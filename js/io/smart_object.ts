/**
 * 智能对象（反馈 #205、#210–#213、#215）
 *
 * 一个标签页仍对应一个 ModelProject，但智能对象标签只是主工程中某个根组的内容视图：
 * - 子页不包含根组，Outliner.root 就是根组的 children；根组变换只属于主工程。
 * - 主工程与它的所有子页共享一个 SmartUndoSystem。切页同步只物化状态，不产生历史。
 * - 子页历史只附加可投影到主工程根组的结构 Outliner；原生 aspect 仍由 UndoSystem 回放。
 * - 元素 uuid 全程保留，重建子树时继续走 detachNode，不解绑主工程动画器。
 */

type SmartTabState = {
	parent_uuid: UUID
	group_uuid: UUID
	/** 最近一次从主工程生成、或已经成功推回主工程的内容签名 */
	parent_signature: string
};

type OutlinerSaveItem = UUID | {uuid: UUID, isOpen?: boolean, children: OutlinerSaveItem[]};
type PendingPush = {tab_uuid: UUID, fragment: SmartFragment};
type SmartProjection = {root_uuid: UUID, outliner: OutlinerSaveItem[]};
type LegacySmartProjection = {root_uuid: UUID, fragment: SmartFragment};
type SmartUndoSave = UndoSave & {
	smart_owner_uuid?: UUID
	smart_projection?: SmartProjection | LegacySmartProjection
};
type SmartSelectionSave = UndoSelectionSave & {smart_owner_uuid?: UUID};
type TransientUndoSystem = UndoSystem & {current_selection_save?: SmartSelectionSave};

/** 贴图同步载荷：getUndoCopy 的推断类型缺少索引签名，这里显式命名用到的字段 */
export type TextureSyncCopy = {
	image_data?: string
	source?: string
	name?: string
	uv_width?: number
	uv_height?: number
} & Record<string, unknown>;

/** 内容快照。根组只由 root_uuid 标识，绝不携带根组属性或变换。 */
export type SmartFragment = {
	root_uuid: UUID
	elements: Record<string, unknown>[]
	groups: Group[]
	outliner: OutlinerSaveItem[]
	textures: {uuid: UUID, copy: TextureSyncCopy}[]
};

const tab_states = new Map<UUID, SmartTabState>();
/** 待推送：key = 主工程 uuid，按来源标签页去重（保留最新一份），按入队顺序应用 */
const pending_pushes = new Map<UUID, PendingPush[]>();
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
	const parent = ModelProject.all.find(project => project.uuid == parent_uuid);
	if (parent) parent.saved = false;
}
function removePendingPush(tab_uuid: UUID | undefined, parent_uuid?: UUID, group_uuid?: UUID) {
	const parents = parent_uuid ? [parent_uuid] : Array.from(pending_pushes.keys());
	for (const uuid of parents) {
		const queue = pending_pushes.get(uuid);
		if (!queue) continue;
		const filtered = queue.filter(entry => {
			if (entry.tab_uuid == tab_uuid) return false;
			return !(group_uuid && entry.fragment.root_uuid == group_uuid);
		});
		if (filtered.length) pending_pushes.set(uuid, filtered);
		else pending_pushes.delete(uuid);
	}
}
function isGroupNode(node: OutlinerNode): node is Group {
	return !!node && node.type == 'group';
}
function isSaveGroup(item: unknown): item is {uuid: UUID, isOpen?: boolean, children: OutlinerSaveItem[]} {
	return typeof item == 'object' && item !== null && 'uuid' in item;
}
function saveOutliner(nodes: OutlinerNode[]): OutlinerSaveItem[] {
	return nodes.map(node => isGroupNode(node)
		? {uuid: node.uuid, isOpen: !!node.isOpen, children: saveOutliner(node.children)}
		: node.uuid);
}
function cloneOutliner(nodes: OutlinerSaveItem[]): OutlinerSaveItem[] {
	return nodes.map(item => isSaveGroup(item)
		? {uuid: item.uuid, isOpen: item.isOpen, children: cloneOutliner(item.children)}
		: item);
}
function normalizeProjection(save?: UndoSave): SmartProjection | undefined {
	const target = save as SmartUndoSave | undefined;
	const stored = target?.smart_projection;
	if (!stored) return;
	if ('fragment' in stored) {
		const projection = {root_uuid: stored.root_uuid, outliner: stored.fragment.outliner};
		target.smart_projection = projection;
		return projection;
	}
	return stored;
}
function setProjectUndo(project: ModelProject, undo: SmartUndoSystem) {
	// _static 本身冻结，但 properties 容器是既有的可变工程属性表。
	project._static.properties.undo = undo;
}

/**
 * 主工程拥有的共享时间线。子页发起的 undo/redo 先物化到主工程再执行，
 * 避免子页局部 Outliner 快照直接在主工程回放。
 */
class SmartUndoSystem extends UndoSystem {
	parent_uuid: UUID;
	replaying = false;

	constructor(parent_uuid: UUID, source?: UndoSystem) {
		super();
		this.parent_uuid = parent_uuid;
		if (source) {
			this.history = source.history;
			this.index = source.index;
		}
	}
	replayInParent(direction: 'undo' | 'redo', remote?: boolean, amended?: boolean): boolean {
		if (this.replaying || !(Project instanceof ModelProject) || Project.uuid == this.parent_uuid) return false;
		const tab = Project;
		const parent = ModelProject.all.find(project => project.uuid == this.parent_uuid);
		if (!parent) return false;

		this.replaying = true;
		const old_index = this.index;
		try {
			// select 会先把所有子页的最新内容物化到主工程，且不会增加历史。
			if (!parent.select()) return true;
			if (direction == 'undo') this.undo(remote, amended);
			else this.redo(remote, amended);

			if (ModelProject.all.includes(tab) && tab_states.has(tab.uuid)) {
				tab.select();
				// 选择历史同样返回到子页；不存在的 UUID 会被 selectionSave 自己过滤。
				if (this.index != old_index) {
					const entry = direction == 'undo' ? this.history[this.index] : this.history[this.index - 1];
					const selection = direction == 'undo' ? entry?.selection_before : entry?.selection_post;
					if (selection && typeof selection.load == 'function') selection.load();
				}
			}
		} finally {
			this.replaying = false;
		}
		return true;
	}
	undo(remote?: boolean, amended?: boolean): void {
		if (this.replayInParent('undo', remote, amended)) return;
		super.undo(remote, amended);
	}
	redo(remote?: boolean, amended?: boolean): void {
		if (this.replayInParent('redo', remote, amended)) return;
		super.redo(remote, amended);
	}
	loadSave(save: UndoSave, reference: UndoSave, mode?: 'session'): void {
		const target = save as SmartUndoSave;
		const projection = normalizeProjection(target);
		if (projection && Project instanceof ModelProject && Project.uuid == this.parent_uuid) {
			// 子页局部 Outliner 不能覆盖主工程。先嵌入现存智能根，再让原生回放处理所有 aspect。
			const projected_outliner = SmartObject.resolveProjectionOutliner(projection);
			const outliner_save = target as unknown as {outliner?: OutlinerSaveItem[]};
			const had_outliner = Object.prototype.hasOwnProperty.call(outliner_save, 'outliner');
			const original_outliner = outliner_save.outliner;
			outliner_save.outliner = projected_outliner || undefined;
			try {
				super.loadSave(target, reference, mode);
			} finally {
				if (had_outliner) outliner_save.outliner = original_outliner;
				else delete outliner_save.outliner;
			}
			if (!projected_outliner) SmartObject.invalidateGroup(Project.uuid, projection.root_uuid);
			return;
		}
		super.loadSave(save, reference, mode);
	}
}

function needsSharedUndo(project: ModelProject): boolean {
	if (project.undo instanceof SmartUndoSystem || pending_pushes.has(project.uuid)) return true;
	if (project.groups.some(group => group.smart_object)) return true;
	if (ModelProject.all.some(tab => stateOf(tab)?.parent_uuid == project.uuid)) return true;
	return project.undo.history.some(entry =>
		!!((entry.before as SmartUndoSave)?.smart_projection || (entry.post as SmartUndoSave)?.smart_projection));
}

function ensureSharedUndo(parent: ModelProject): SmartUndoSystem {
	parent.undo.history.forEach(entry => {
		normalizeProjection(entry.before);
		normalizeProjection(entry.post);
	});
	if (parent.undo instanceof SmartUndoSystem) {
		const shared = parent.undo;
		ModelProject.all.forEach(tab => {
			if (stateOf(tab)?.parent_uuid == parent.uuid) setProjectUndo(tab, shared);
		});
		return shared;
	}
	SmartObject.settleTransient(parent);
	parent.undo.closeAmendEditMenu();
	const shared = new SmartUndoSystem(parent.uuid, parent.undo);
	setProjectUndo(parent, shared);
	ModelProject.all.forEach(tab => {
		if (stateOf(tab)?.parent_uuid == parent.uuid) setProjectUndo(tab, shared);
	});
	return shared;
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
	// 入口 / 生命周期
	// =========================================================================
	markGroup(group: Group) {
		if (!group || group.smart_object) return;
		const group_uuid = group.uuid;
		Undo.initEdit({groups: [group]});
		const current = Project.groups.find(item => item.uuid == group_uuid);
		if (current) current.smart_object = true;
		Undo.finishEdit('Create smart object');
		Outliner.updateNodeDisplayRules();
	},
	/** 大纲右键 →「创建为智能对象」：打标记并打开编辑标签页 */
	createFromGroup(group: Group) {
		if (!group || group.type != 'group') return;
		const group_uuid = group.uuid;
		this.markGroup(group);
		const current = Project.groups.find(item => item.uuid == group_uuid);
		if (current) this.openGroup(current);
	},
	/** 打开（或切换到）智能对象的编辑标签页 */
	openGroup(group: Group) {
		if (!group) return;
		if (!group.smart_object) this.markGroup(group);
		const parent = Project;
		if (this.isSmartTab(parent)) return;
		const group_uuid = group.uuid;
		const current_group = parent.groups.find(item => item.uuid == group_uuid);
		if (!current_group) return;

		const shared_undo = ensureSharedUndo(parent);
		const existing = this.getTab(parent.uuid, group_uuid);
		if (existing) {
			existing.select();
			return existing;
		}

		// 快照必须在主工程选中时生成（保存拷贝依赖全局 Texture.all 等）
		const fragment = this.buildFragment(parent, group_uuid);
		if (!fragment) return;
		const parent_uuid = parent.uuid;
		const tab_name = current_group.name || tl('data.group');

		setupProject(parent.format);
		const tab = Project;
		tab_states.set(tab.uuid, {
			parent_uuid,
			group_uuid,
			parent_signature: this.fragmentSignature(fragment),
		});
		setProjectUndo(tab, shared_undo);
		tab.name = tab_name;
		tab.box_uv = parent.box_uv;
		tab.texture_width = parent.texture_width;
		tab.texture_height = parent.texture_height;
		tab.mode = 'edit';
		this.applyFragment(tab, fragment);
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
	/** 主动退化：先合并内容，再以普通 Undo transaction 去除标记，最后关闭标签。 */
	demoteGroup(group: Group) {
		if (!group || !group.smart_object || this.isSmartTab()) return;
		const parent = Project;
		const group_uuid = group.uuid;
		this.pushPending(parent);
		const current = parent.groups.find(item => item.uuid == group_uuid);
		if (!current) {
			this.invalidateGroup(parent.uuid, group_uuid);
			return;
		}
		Undo.initEdit({groups: [current]});
		const edited = parent.groups.find(item => item.uuid == group_uuid);
		if (edited) edited.smart_object = false;
		Undo.finishEdit('Demote smart object');
		this.invalidateGroup(parent.uuid, group_uuid);
		Outliner.updateNodeDisplayRules();
	},
	/** 供 Group.remove 在真正移除前调用。已删除/退化的对象不允许由旧队列复活。 */
	onGroupRemoved(group: Group) {
		if (!group || !(Project instanceof ModelProject) || this.isSmartTab(Project)) return;
		this.invalidateGroup(Project.uuid, group.uuid);
	},
	invalidateGroup(parent_uuid: UUID, group_uuid: UUID) {
		removePendingPush(undefined, parent_uuid, group_uuid);
		const tab = this.getTab(parent_uuid, group_uuid);
		if (tab) this.discardTab(tab);
	},

	// =========================================================================
	// 快照 / 应用
	// =========================================================================
	/** 生成内容快照（源工程必须是当前选中工程）。子页以 Outliner.root 为虚拟根。 */
	buildFragment(project: ModelProject, root_uuid?: UUID): SmartFragment | null {
		if (!root_uuid) return null;
		const tab_state = stateOf(project);
		let content: OutlinerNode[];
		if (tab_state) {
			if (tab_state.group_uuid != root_uuid) return null;
			content = project.outliner;
		} else {
			const root = project.groups.find(group => group.uuid == root_uuid);
			if (!root) return null;
			content = root.children;
		}

		const meta = syncMeta();
		const elements: Record<string, unknown>[] = [];
		const groups: Group[] = [];
		const texture_uuids = new Set<UUID>();

		const collectNodes = (nodes: OutlinerNode[]) => {
			for (const node of nodes) {
				if (isGroupNode(node)) {
					groups.push(structuredClone(node.getSaveCopy(false)));
					if (node.texture) texture_uuids.add(node.texture);
					collectNodes(node.children);
				} else {
					const copy = structuredClone(node.getSaveCopy(meta)) as Record<string, unknown>;
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
			}
		};
		collectNodes(content);

		const textures: SmartFragment['textures'] = [];
		project.textures.forEach(texture => {
			if (texture_uuids.has(texture.uuid)) {
				textures.push({uuid: texture.uuid, copy: texture.getUndoCopy(true) as TextureSyncCopy});
			}
		});

		return {
			root_uuid,
			elements,
			groups,
			outliner: saveOutliner(content),
			textures,
		};
	},
	/** 把内容快照物化到目标工程；永不创建根组、写 Undo 或同步根组变换。 */
	applyFragment(project: ModelProject, fragment?: SmartFragment | null): boolean {
		if (!fragment || Project !== project) return false;
		const tab_state = stateOf(project);
		let root: Group | undefined;
		if (tab_state) {
			const parent = ModelProject.all.find(item => item.uuid == tab_state.parent_uuid);
			if (!parent?.groups.some(group => group.uuid == tab_state.group_uuid)) {
				this.discardTab(project);
				return false;
			}
		} else {
			root = project.groups.find(group => group.uuid == fragment.root_uuid);
			if (!root) {
				this.invalidateGroup(project.uuid, fragment.root_uuid);
				return false;
			}
		}
		const old_elements: OutlinerElement[] = [];
		const old_groups: Group[] = [];
		const collectOld = (nodes: OutlinerNode[]) => {
			for (const node of nodes) {
				if (isGroupNode(node)) {
					old_groups.push(node);
					collectOld(node.children);
				} else {
					old_elements.push(node);
				}
			}
		};
		collectOld(root ? root.children : project.outliner);

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

		// 2. 清掉旧内容（不走 node.remove()：它会解绑动画器）
		old_elements.concat(old_groups).forEach(node => this.detachNode(node, project));

		// 3. 按快照重建元素与后代组（uuid 保留）
		fragment.elements.forEach(copy => {
			OutlinerElement.fromSave(copy, true);
		});
		fragment.groups.forEach(copy => {
			new Group(copy, copy.uuid).init();
		});

		// 4. 主工程挂到现存根组，子页挂到 Outliner.root 虚拟根
		if (root) {
			root.children.empty();
			this.attachOutliner(fragment.outliner, root);
		} else {
			project.outliner.empty();
			this.attachOutliner(fragment.outliner, null);
		}

		Canvas.updateAllFaces();
		Canvas.updateAllBones();
		Canvas.updateAllPositions();
		Outliner.updateNodeDisplayRules();
		updateSelection();
		if (!Modes.animate && !Modes.pose) Animator.showDefaultPose(true);
		return true;
	},
	/** 把子页结构嵌入主工程当前大纲；返回新树，原生回放不会改写历史中的 projection。 */
	resolveProjectionOutliner(projection: SmartProjection): OutlinerSaveItem[] | null {
		const full_outliner = Outliner.toJSON() as OutlinerSaveItem[];
		const embed = (nodes: OutlinerSaveItem[]): boolean => {
			for (const item of nodes) {
				if (!isSaveGroup(item)) continue;
				if (item.uuid == projection.root_uuid) {
					item.children = cloneOutliner(projection.outliner);
					return true;
				}
				if (embed(item.children)) return true;
			}
			return false;
		};
		return embed(full_outliner) ? full_outliner : null;
	},
	attachOutliner(list: OutlinerSaveItem[], parent: Group | null) {
		const children = parent ? parent.children : Outliner.root;
		for (const item of list) {
			const node = OutlinerNode.uuids[isSaveGroup(item) ? item.uuid : item];
			if (!node) continue;
			node.removeFromParent();
			children.push(node);
			node.parent = parent || Outliner.ROOT;
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
	// 双向同步（只物化状态，不写历史）
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
		// 展开状态是每个标签自己的视图状态，不参与内容相等判断。
		const groups = fragment.groups.map(group => Object.assign({}, group, {isOpen: undefined}));
		const outliner = (nodes: OutlinerSaveItem[]): unknown[] => nodes.map(item => {
			if (!isSaveGroup(item)) return item;
			return [item.uuid, outliner(item.children)];
		});
		return JSON.stringify([
			fragment.elements,
			groups,
			outliner(fragment.outliner),
			texture_signature,
		]);
	},
	/** 结束当前工程尚未完成的事务，绝不让共享 current_save 跨工程提交。 */
	settleTransient(project: ModelProject) {
		const undo = project.undo as TransientUndoSystem;
		if (!undo) return;
		const current_save = undo.current_save as SmartUndoSave | undefined;
		if (current_save) {
			if (current_save.smart_owner_uuid && current_save.smart_owner_uuid != project.uuid) {
				delete undo.current_save;
			} else {
				undo.cancelEdit(true);
			}
		}
		const selection_save = undo.current_selection_save;
		if (selection_save) {
			if (selection_save.smart_owner_uuid && selection_save.smart_owner_uuid != project.uuid) {
				delete undo.current_selection_save;
			} else {
				undo.cancelSelection(true);
			}
		}
	},
	/** 离开某个工程前抓快照（此时它仍是选中工程） */
	onProjectUnselected(project: ModelProject) {
		if (project.undo instanceof SmartUndoSystem) this.settleTransient(project);
		const state = stateOf(project);
		if (state) {
			const fragment = this.buildFragment(project, state.group_uuid);
			const parent = this.parentProject(project);
			if (parent && fragment && this.fragmentSignature(fragment) != state.parent_signature) {
				queuePush(parent.uuid, project.uuid, fragment);
			}
		}
		const invalid_tabs: ModelProject[] = [];
		ModelProject.all.slice().forEach(tab => {
			const tab_state = stateOf(tab);
			if (tab_state && tab_state.parent_uuid == project.uuid) {
				const fragment = this.buildFragment(project, tab_state.group_uuid);
				if (fragment) {
					pending_pulls.set(tab.uuid, fragment);
					tab_state.parent_signature = this.fragmentSignature(fragment);
				} else {
					invalid_tabs.push(tab);
				}
			}
		});
		invalid_tabs.forEach(tab => this.discardTab(tab));
	},
	/** 进入某个工程后应用待同步快照（此时它是选中工程） */
	onProjectLoaded(project: ModelProject) {
		if (project.undo instanceof SmartUndoSystem) this.settleTransient(project);
		const state = stateOf(project);
		if (state) {
			const parent = this.parentProject(project);
			if (!parent?.groups.some(group => group.uuid == state.group_uuid)) {
				this.discardTab(project);
				return;
			}
			const fragment = pending_pulls.get(project.uuid);
			pending_pulls.delete(project.uuid);
			if (!fragment) return;
			// 本标签页还有未合并回主工程的改动时，它的数据更新，不能被主工程旧状态覆盖。
			const queued = pending_pushes.get(state.parent_uuid);
			if (queued && queued.some(entry => entry.tab_uuid == project.uuid)) return;
			const current = this.buildFragment(project, state.group_uuid);
			if (this.fragmentSignature(fragment) == this.fragmentSignature(current)) return;
			this.applyFragment(project, fragment);
		} else {
			if (needsSharedUndo(project)) ensureSharedUndo(project);
			this.pushPending(project);
		}
	},
	pushPending(project: ModelProject): boolean {
		const queue = pending_pushes.get(project.uuid);
		if (!queue || !queue.length || Project !== project) return false;
		pending_pushes.delete(project.uuid);
		let changed = false;
		for (const entry of queue) {
			const current = this.buildFragment(project, entry.fragment.root_uuid);
			if (!current) {
				this.invalidateGroup(project.uuid, entry.fragment.root_uuid);
				continue;
			}
			const signature = this.fragmentSignature(entry.fragment);
			if (signature == this.fragmentSignature(current)) {
				const state = tab_states.get(entry.tab_uuid);
				if (state) state.parent_signature = signature;
				continue;
			}
			if (this.applyFragment(project, entry.fragment)) {
				changed = true;
				const state = tab_states.get(entry.tab_uuid);
				if (state) state.parent_signature = signature;
			}
		}
		if (changed) project.saved = false;
		return changed;
	},
	/** 智能对象标签里保存 = 把改动推回主工程并保存主工程 */
	saveFromTab() {
		const tab = Project;
		const parent = this.parentProject(tab);
		if (!parent || !parent.select()) return;
		parent.saved = false;
		BarItems.save_project.trigger();
		if (ModelProject.all.includes(tab) && tab_states.has(tab.uuid)) tab.select();
	},
	/** 关闭前处理：标签页抓快照，主工程应用待推送快照 */
	onBeforeClose(project: ModelProject) {
		if (project.undo instanceof SmartUndoSystem) this.settleTransient(project);
		const state = stateOf(project);
		if (state) {
			const fragment = this.buildFragment(project, state.group_uuid);
			const parent = this.parentProject(project);
			if (parent && fragment && this.fragmentSignature(fragment) != state.parent_signature) {
				queuePush(parent.uuid, project.uuid, fragment);
			}
			project.saved = true;
		} else {
			this.pushPending(project);
		}
	},
	/** 正常关闭子页保留最后 push；关闭主工程则丢弃它的所有子页和队列。 */
	onProjectClosed(project: ModelProject) {
		const state = stateOf(project);
		if (state) {
			tab_states.delete(project.uuid);
			pending_pulls.delete(project.uuid);
			return;
		}
		pending_pushes.delete(project.uuid);
		ModelProject.all.slice().filter(tab => stateOf(tab)?.parent_uuid == project.uuid)
			.forEach(tab => this.discardTab(tab));
	},
	/** 失效关闭：先删状态与 pending，再处理当前标签，避免关闭钩子重新入队。 */
	discardTab(tab: ModelProject) {
		if (!tab) return;
		const state = stateOf(tab);
		tab_states.delete(tab.uuid);
		pending_pulls.delete(tab.uuid);
		removePendingPush(tab.uuid);

		if (Project === tab) {
			const parent = state && ModelProject.all.find(project => project.uuid == state.parent_uuid);
			if (parent) parent.select();
			else {
				tab.close(true);
				return;
			}
		}
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
// 共享 Undo 快照钩子
// =========================================================================
Blockbench.on('create_undo_save', ({save}) => {
	if (!(Project instanceof ModelProject)) return;
	const target = save as SmartUndoSave;
	target.smart_owner_uuid = Project.uuid;
	const state = stateOf(Project);
	if (!state || !(Project.undo instanceof SmartUndoSystem)) return;
	target.smart_projection = {
		root_uuid: state.group_uuid,
		outliner: saveOutliner(Project.outliner),
	} satisfies SmartProjection;
});
// smart_object 先于 bbmodel codec 初始化；首次 load_project 时 codec 已存在，且仍早于 parsed。
Blockbench.once('load_project', () => {
	Codecs.project.on('parsed', () => {
		if (Project instanceof ModelProject && !stateOf(Project) && needsSharedUndo(Project)) ensureSharedUndo(Project);
	});
});
Blockbench.on('init_selection_change', ({save}) => {
	if (Project instanceof ModelProject) (save as SmartSelectionSave).smart_owner_uuid = Project.uuid;
});

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
	new Action('demote_smart_object', {
		icon: 'folder',
		category: 'edit',
		condition: () => Modes.edit && !SmartObject.isSmartTab() &&
			Group.first_selected instanceof Group &&
			!!Group.first_selected.smart_object,
		click() {
			const group = Group.first_selected;
			if (group instanceof Group) SmartObject.demoteGroup(group);
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
