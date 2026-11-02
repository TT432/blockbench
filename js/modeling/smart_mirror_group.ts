/**
 * 智能镜像组（反馈 #274）
 *
 * 右键组「设为智能镜像组」后：在同一个父级里紧邻原组创建该组的镜像副本（原地镜像，
 * 不改动模型其他内容），两侧组各自在 `smart_mirror` 属性中记录对方 uuid 作为配对。
 * 此后任一节点的编辑都会镜像同步到对方（位移/旋转/缩放/几何/UV），即「常态镜像对称」。
 *
 * 镜像面 = 画布中心平面（`Format.centered_grid ? 0 : 8`，X 轴，与镜像建模同一约定），
 * 两个组绕模型中心左右对称。共用同一块 UV 纹理：副本不镜像 UV，且此后源侧的 UV 编辑
 * 直接同步到副本（`keep_uv_from_source`），两侧始终读同一块纹理区域。
 *
 * 同步复用镜像建模引擎（`MirrorModeling.createClone` 的更新路径）：`init_edit` 时把配对
 * 关系注入 `MirrorModeling.cached_elements` 并登记 undo 前快照，`finish_edit` 由本模块
 * 统一驱动。镜像建模开关自身的钩子会跳过带 `smart_pair` 标记的条目，避免两侧互相翻两次。
 */
import { MirrorModeling } from "./mirror_modeling";

/** OutlinerNode 上的智能镜像组配对字段（由下方 Property 注册，随工程保存） */
interface SmartMirrorLink {
	smart_mirror?: UUID
}

function mirrorLink(node: Group): UUID | undefined {
	return (node as unknown as SmartMirrorLink).smart_mirror;
}
function setMirrorLink(node: Group, uuid: UUID) {
	(node as unknown as SmartMirrorLink).smart_mirror = uuid;
}

/** 镜像面坐标：与镜像建模共用同一约定 */
function mirrorCenter(): number {
	return Format.centered_grid ? 0 : 8;
}

function counterpartGroup(group: Group): Group | undefined {
	let uuid = mirrorLink(group);
	if (!uuid || uuid == group.uuid) return;
	let node = OutlinerNode.uuids[uuid];
	return node instanceof Group ? node : undefined;
}

/** 把新建节点挪到源节点紧随其后，保持两份子树的结构顺序一致 */
function insertAfter(node: OutlinerNode, source: OutlinerNode) {
	let list = node.parent instanceof Group ? node.parent.children : Outliner.root;
	let index = list.indexOf(node);
	if (index >= 0) list.splice(index, 1);
	let source_index = list.indexOf(source);
	list.splice(source_index >= 0 ? source_index + 1 : list.length, 0, node);
}

function mirrorGroupTransform(source: Group, counterpart: Group) {
	let center = mirrorCenter();
	counterpart.origin[0] = 2 * center - source.origin[0];
	counterpart.origin[1] = source.origin[1];
	counterpart.origin[2] = source.origin[2];
	counterpart.rotation[0] = source.rotation[0];
	counterpart.rotation[1] = -source.rotation[1];
	counterpart.rotation[2] = -source.rotation[2];
	// scale 只有骨骼格式的组才有
	if (source.scale && counterpart.scale) {
		counterpart.scale[0] = source.scale[0];
		counterpart.scale[1] = source.scale[1];
		counterpart.scale[2] = source.scale[2];
	}
}

export const SmartMirrorGroup = {
	/** 当前编辑的配对映射（init_edit 建立，finish_edit 复用；undo/redo 后由下一次编辑重建） */
	map: null as Map<UUID, OutlinerNode> | null,
	/** init_edit 时用户实际编辑的元素/组（不含为 undo 注入的镜像副本） */
	edited: null as Set<UUID> | null,
	edited_groups: null as Set<UUID> | null,
	/** 反馈#288：「取消智能镜像组」这类整体删除动作不走同步管线，置位后两个钩子直接跳过 */
	suspended: false,

	pairs(): [Group, Group][] {
		let result: [Group, Group][] = [];
		let seen = new Set<UUID>();
		if (typeof Group == 'undefined') return result;
		for (let group of Group.all) {
			if (seen.has(group.uuid)) continue;
			let counterpart = counterpartGroup(group);
			if (!counterpart) continue;
			seen.add(group.uuid);
			seen.add(counterpart.uuid);
			result.push([group, counterpart]);
		}
		return result;
	},

	/** 子树里的全部节点（含自身），供整体删除登记 undo 用 */
	collectSubtree(node: OutlinerNode): OutlinerNode[] {
		let list: OutlinerNode[] = [node];
		if (node instanceof Group) {
			node.forEachChild(child => list.push(child));
		}
		return list;
	},

	/**
	 * 反馈#288/F3：把镜像副本连同子树登记进本条 undo 后删除。
	 * pre 里留快照（含结构 outliner），post 不记录被删节点 —— 与正规删除（outliner.js 删后
	 * 清空 recursive_list）一致，redo 才能重新删除、undo 才能整棵子树还原。
	 */
	removeSubtreeWithUndo(counterpart: Group, aspects: UndoAspects) {
		let removed = this.collectSubtree(counterpart);
		for (let node of removed) {
			if (node instanceof Group) {
				// 快照必须带真 uuid，否则撤销时会按野 uuid 重建垃圾组、并把真组当多余节点删掉
				let before = node.getChildlessCopy();
				before.uuid = node.uuid;
				MirrorModeling.insertGroupIntoUndo(node, aspects, before);
			} else if (node instanceof OutlinerElement) {
				MirrorModeling.insertElementIntoUndo(node, aspects, node.getUndoCopy(aspects));
			}
		}
		counterpart.remove();
		if (aspects.elements) aspects.elements = aspects.elements.filter(node => !removed.includes(node));
		if (aspects.groups) aspects.groups = aspects.groups.filter(node => !removed.includes(node));
	},

	/** 建立配对映射：两个子树按同构顺序配对（组/元素按类型与名称，再退回位置） */
	buildMap(): Map<UUID, OutlinerNode> {
		let map = new Map<UUID, OutlinerNode>();
		function matchChild(node: OutlinerNode, candidates: OutlinerNode[]): OutlinerNode | undefined {
			let unpaired = candidates.filter(candidate => !map.has(candidate.uuid));
			let same_name = unpaired.find(candidate => candidate.type == node.type && candidate.name == node.name);
			if (same_name) return same_name;
			let siblings = node.parent instanceof Group ? node.parent.children : Outliner.root;
			let positional = candidates[siblings.indexOf(node)];
			if (positional && !map.has(positional.uuid) && positional.type == node.type) return positional;
			return unpaired.find(candidate => candidate.type == node.type);
		}
		function walk(a: OutlinerNode, b: OutlinerNode) {
			map.set(a.uuid, b);
			map.set(b.uuid, a);
			if (!(a instanceof Group) || !(b instanceof Group)) return;
			for (let child of a.children) {
				let counterpart = matchChild(child, b.children);
				if (counterpart) walk(child, counterpart);
			}
		}
		for (let pair of SmartMirrorGroup.pairs()) walk(pair[0], pair[1]);
		return map;
	},

	/** 复制节点为镜像副本并挂到 parent 下（递归，结构顺序与源一致） */
	cloneMirrored(node: OutlinerNode, parent: OutlinerNode | 'root'): OutlinerNode {
		let clone: OutlinerNode;
		if (node instanceof Group) {
			clone = new Group(node as unknown as OutlinerNodeData);
			mirrorGroupTransform(node, clone as Group);
			// 先建好组（有 mesh）再挂子节点，子元素的 init 需要父组已存在
			clone.addTo(parent);
			clone.init();
			for (let child of node.children) {
				this.cloneMirrored(child, clone);
			}
			return clone;
		} else {
			// @ts-expect-error 元素构造函数按类型各自定义，沿用镜像建模的做法按实例构造
			clone = new node.constructor(node);
			// 先挂到场景里（flip 会访问 mesh），再镜像
			clone.addTo(parent);
			clone.init();
			clone.flip(0, mirrorCenter());
			let maintain_uv = MirrorModeling.element_types[node.type]?.maintainUV;
			// 共用同一块 UV 纹理：镜像翻转后把源元素的 UV 原样补回
			if (maintain_uv) maintain_uv(clone as OutlinerElement, node);
			clone.name = node.name;
			return clone;
		}
	},

	/** 右键「设为智能镜像组」 */
	setup(group: Group) {
		if (!Modes.edit || !(group instanceof Group)) return;
		if (mirrorLink(group)) {
			Blockbench.showQuickMessage(tl('message.smart_mirror.already_set'), 2000);
			return;
		}
		// 反馈#288：post 快照里要有新建的镜像组（撤销才能把它删掉），源组与副本都进快照
		Undo.initEdit({outliner: true, groups: [group]});
		let counterpart = this.cloneMirrored(group, group.parent) as Group;
		insertAfter(counterpart, group);
		counterpart.name = tl('message.smart_mirror.name_suffix', [group.name]);
		counterpart.createUniqueName();
		counterpart.isOpen = group.isOpen;
		setMirrorLink(group, counterpart.uuid);
		setMirrorLink(counterpart, group.uuid);
		Canvas.updateAll();
		Undo.finishEdit('Set up smart mirror group', {outliner: true, groups: [group, counterpart]});
		Blockbench.showQuickMessage(tl('message.smart_mirror.created', [counterpart.name]), 3000);
	},

	/** 右键「取消智能镜像组」：直接删除镜像副本并清掉两侧配对 */
	remove(group: Group) {
		let counterpart = counterpartGroup(group);
		if (!counterpart) return;
		// 本次动作自己登记 undo，不走同步管线（否则会把刚删的副本又推回 post 快照）
		this.suspended = true;
		let removed = this.collectSubtree(counterpart);
		let aspects: UndoAspects = {
			outliner: true,
			elements: removed.filter(node => node instanceof OutlinerElement),
			groups: [group, ...removed.filter(node => node instanceof Group)],
		};
		Undo.initEdit(aspects);
		counterpart.remove();
		setMirrorLink(group, '');
		// post 不记录被删节点（与正规删除一致），redo 才会重新删除、undo 才整棵还原
		aspects.elements = aspects.elements.filter(node => !removed.includes(node));
		aspects.groups = aspects.groups.filter(node => !removed.includes(node));
		Undo.finishEdit('Remove smart mirror group', aspects);
		this.suspended = false;
		Canvas.updateAll();
		updateSelection();
		Blockbench.showQuickMessage(tl('message.smart_mirror.removed', [counterpart.name]), 2500);
	},

	initEdit(aspects: UndoAspects) {
		// 反馈#288：整体删除类动作自行登记 undo，跳过同步管线
		if (this.suspended) {
			this.map = null;
			this.edited = null;
			this.edited_groups = null;
			return;
		}
		if (typeof Group == 'undefined' || !Group.all.length) return;
		// 清掉上一次编辑留下的智能镜像组标记，避免跨编辑误跳过/误同步
		for (let uuid in MirrorModeling.cached_elements) {
			if (MirrorModeling.cached_elements[uuid]?.smart_pair) delete MirrorModeling.cached_elements[uuid];
		}
		// 用户实际编辑的节点（在把副本注入 aspects 之前记录，用于识别「两侧同时被编辑」）
		this.edited = new Set((aspects.elements ?? []).map(element => element.uuid));
		this.edited_groups = new Set((aspects.groups ?? []).map(group => group.uuid));
		let map = this.map = this.buildMap();
		if (!map.size) return;
		// 反馈#288：本条编辑可能连带删除镜像副本，先把「编辑前」的树补进 pre 快照，
		// 否则撤销时 Outliner.loadJSON 没有位置挂回被删子树（pre 保存已在 init_edit 派发前物化）
		Undo.current_save.outliner ??= Outliner.toJSON();

		if (aspects.elements) {
			for (let element of aspects.elements.slice()) {
				let counterpart = map.get(element.uuid);
				if (!(counterpart instanceof OutlinerElement)) continue;
				let cached = MirrorModeling.cached_elements[element.uuid] ??= {} as MirrorModelingCachedData;
				cached.counterpart = counterpart;
				cached.is_centered = false;
				cached.is_copy = false;
				cached.edit_side = 0;
				cached.smart_pair = true;
				cached.keep_uv_from_source = true;
				MirrorModeling.insertElementIntoUndo(counterpart, aspects, counterpart.getUndoCopy(aspects));
			}
		}
		if (aspects.groups) {
			for (let group of aspects.groups.slice()) {
				let counterpart = map.get(group.uuid);
				if (!(counterpart instanceof Group)) continue;
				let cached = MirrorModeling.cached_elements[group.uuid] ??= {} as MirrorModelingCachedData;
				cached.counterpart = counterpart;
				cached.smart_pair = true;
				// 反馈#288：快照必须写回真 uuid，否则 insertGroupIntoUndo 的按 uuid 去重永远不命中，
				// 撤销时野 uuid 快照被当成新组重建、真镜像组被当多余节点删掉
				let before = counterpart.getChildlessCopy();
				before.uuid = counterpart.uuid;
				MirrorModeling.insertGroupIntoUndo(counterpart, aspects, before);
			}
		}
	},

	finishEdit(aspects: UndoAspects) {
		let map = this.map;
		let edited = this.edited ?? new Set<UUID>();
		let edited_groups = this.edited_groups ?? new Set<UUID>();
		this.map = null;
		this.edited = null;
		this.edited_groups = null;
		if (this.suspended || !map || !map.size) return;
		let changed = false;

		if (aspects.elements) {
			for (let element of aspects.elements.slice()) {
				let counterpart = map.get(element.uuid);
				if (!(counterpart instanceof OutlinerElement)) continue;
				if (!Outliner.elements.includes(element)) {
					// 源被删除：副本一起删除（副本同样进 undo，可一起撤销）
					if (Outliner.elements.includes(counterpart)) {
						MirrorModeling.insertElementIntoUndo(counterpart, aspects, counterpart.getUndoCopy(aspects));
						counterpart.remove();
						// post 快照不记录被删副本，否则 redo 不会重新删除它
						aspects.elements = aspects.elements.filter(node => node !== counterpart);
						changed = true;
					}
					continue;
				}
				// 两侧都被用户编辑时各自镜像自己的改动，不再交叉同步（否则会翻两次）
				if (edited.has(counterpart.uuid)) continue;
				if (!MirrorModeling.cached_elements[element.uuid]?.smart_pair) continue;
				MirrorModeling.createClone(element, aspects);
				changed = true;
			}
		}

		if (aspects.groups) {
			for (let group of aspects.groups.slice()) {
				let counterpart = map.get(group.uuid);
				if (!(counterpart instanceof Group)) continue;
				if (!Group.all.includes(group)) {
					if (Group.all.includes(counterpart)) {
						// 反馈#288：整棵子树连同结构登记进 undo，撤销才能还原、redo 才能再删
						this.removeSubtreeWithUndo(counterpart, aspects);
						changed = true;
					}
					continue;
				}
				if (edited_groups.has(counterpart.uuid)) continue;
				let before = counterpart.getChildlessCopy();
				before.uuid = counterpart.uuid;
				MirrorModeling.insertGroupIntoUndo(counterpart, aspects, before);
				mirrorGroupTransform(group, counterpart);
				aspects.groups.safePush(counterpart);
				changed = true;
			}
		}

		if (changed) {
			Canvas.updateAllBones();
			updateSelection();
		}
	},
};

// 镜像建模的缓存条目加上智能镜像组的标记（镜像建模自身的钩子据此跳过，由本模块统一处理）
interface MirrorModelingCachedData {
	counterpart?: OutlinerElement
	is_centered?: boolean
	is_copy?: boolean
	edit_side?: number
	smart_pair?: boolean
	keep_uv_from_source?: boolean
}

Blockbench.on('init_edit', ({aspects}) => {
	SmartMirrorGroup.initEdit(aspects);
});
Blockbench.on('finish_edit', ({aspects}) => {
	SmartMirrorGroup.finishEdit(aspects);
});

new Property(Group, 'string', 'smart_mirror', {default: ''});

BARS.defineActions(() => {
	new Action('setup_smart_mirror_group', {
		name: 'action.smart_mirror',
		icon: 'flip',
		category: 'edit',
		condition: () => Modes.edit && Group.multi_selected.length == 1,
		click() {
			let group = Group.first_selected || Group.multi_selected[0];
			if (group) SmartMirrorGroup.setup(group);
		},
	});
	// 反馈#288：取消智能镜像组（= 直接删除镜像副本）
	new Action('remove_smart_mirror', {
		name: 'action.remove_smart_mirror',
		description: 'action.remove_smart_mirror.desc',
		icon: 'flip_camera_android',
		category: 'edit',
		condition: () => {
			if (!Modes.edit || Group.multi_selected.length != 1) return false;
			let group = Group.first_selected || Group.multi_selected[0];
			return !!(group && mirrorLink(group));
		},
		click() {
			let group = Group.first_selected || Group.multi_selected[0];
			if (group) SmartMirrorGroup.remove(group);
		},
	});
});

const global = {
	SmartMirrorGroup,
};
declare global {
	interface Window {
		SmartMirrorGroup: typeof SmartMirrorGroup
	}
}
Object.assign(window, global);
