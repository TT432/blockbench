/**
 * 智能复制组（反馈 #305，前身「智能镜像组」#274/#288）
 *
 * 右键组「设为智能复制组」后，在同级里紧邻原组创建一个镜像副本（原地镜像，不改动模型
 * 其他内容），两侧组在 `smart_copy_id` 里记同一个链接 id。此后：
 *
 * - **内容同步**：任一成员的块/组几何、UV 编辑都会镜像同步到其他成员（走镜像建模引擎）。
 * - **属性链接**：组的位移/旋转/缩放与名称也同步；「断开组属性链接」后只停这一层，
 *   组内容仍然同步，再「恢复组属性链接」即恢复（反馈#305 第 4 点）。
 * - **复制链**：Ctrl+D 复制任一成员时副本继承同一个链接 id，继续参与同步（第 3 点）。
 * - **翻转不传播**：对任一成员做镜像翻转只影响它自己（组内单位照常同步，第 5 点）。
 *   `transform.js` 翻转前调用 `markGroupFlip()`，`finishEdit` 据此跳过组级同步。
 * - **命名**：副本按 Ctrl+D 的唯一命名 + 左右/前后侧别翻转（第 2 点，不再加「（镜像）」）；
 *   任一方重命名时若名字带 left/right、front/back，对侧自动翻到另一侧，否则走唯一命名
 *   进位（第 6 点）。
 *
 * 成员之间按「相对成员根的子节点下标路径」配对，因此三个以上复制链也能对齐；结构分叉后
 * 找不到对应节点的条目直接跳过，不做猜测。同步复用镜像建模的更新路径：`init_edit` 把
 * 配对写进 `MirrorModeling.cached_elements` 并登记 undo 前快照，`finish_edit` 由本模块驱动。
 */
import { MirrorModeling } from "./mirror_modeling";
import { nameOnOtherSide, sideAxisOf, uniqueName } from "./mirror_naming";
import { guid } from "../util/math_util";

/** 组上的智能复制组字段（由下方 Property 注册，随工程保存） */
interface SmartCopyFields {
	smart_copy_id?: UUID
	smart_copy_linked?: boolean
	/** 旧版「智能镜像组」的成对 uuid，只在迁移旧工程时使用 */
	smart_mirror?: UUID
}

function linkId(group: Group): UUID {
	return (group as unknown as SmartCopyFields).smart_copy_id ?? '';
}
function attrsLinked(group: Group): boolean {
	return (group as unknown as SmartCopyFields).smart_copy_linked !== false;
}
function setLinkId(group: Group, id: UUID) {
	(group as unknown as SmartCopyFields).smart_copy_id = id;
}
function setAttrsLinked(group: Group, linked: boolean) {
	(group as unknown as SmartCopyFields).smart_copy_linked = linked;
}

/** 镜像面坐标：与镜像建模共用同一约定 */
function mirrorCenter(): number {
	return Format.centered_grid ? 0 : 8;
}

function membersOf(id: UUID): Group[] {
	if (!id) return [];
	return Group.all.filter(group => linkId(group) === id);
}

/** 节点所属成员：最近的带链接 id 的祖先组（含自身） */
function memberRootOf(node: OutlinerNode): Group | undefined {
	let current: OutlinerNode | 'root' = node;
	while (current instanceof OutlinerNode) {
		if (current instanceof Group && linkId(current)) return current;
		current = current.parent;
	}
	return;
}

/** 节点相对成员根的路径（子节点下标序列）；不在成员内时返回 undefined */
function nodePath(node: OutlinerNode, root: Group): number[] | undefined {
	let path: number[] = [];
	let current: OutlinerNode = node;
	while (current !== root) {
		let parent = current.parent;
		if (!(parent instanceof Group)) return;
		let index = parent.children.indexOf(current);
		if (index < 0) return;
		path.unshift(index);
		current = parent;
	}
	return path;
}

function nodeAtPath(root: Group, path: number[]): OutlinerNode | undefined {
	let current: OutlinerNode = root;
	for (let index of path) {
		if (!(current instanceof Group)) return;
		let child = current.children[index];
		if (!child) return;
		current = child;
	}
	return current;
}

/** 把新建节点挪到源节点紧随其后，保持各成员子树的结构顺序一致 */
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

export const SmartCopyGroup = {
	/** 本模块自己登记 undo 的动作（建立/删除/断开链接）置位，两个钩子直接跳过 */
	suspended: false,
	/** 本次编辑包含「镜像翻转」：组级属性不同步（反馈#305 第 5 点） */
	group_flip: false,
	/** init_edit 时用户实际编辑的节点（不含为 undo 注入的副本） */
	edited_elements: null as Set<UUID> | null,
	edited_groups: null as Set<UUID> | null,
	/** 编辑前的名字快照，用于判断本次编辑是否改了名字（第 6 点） */
	edited_names: null as Map<UUID, string> | null,

	/** 由 transform.js 的翻转路径调用：本次编辑的组级改动不传播到对侧 */
	markGroupFlip() {
		this.group_flip = true;
	},

	/** 本次编辑是否允许同步组级属性（镜像翻转编辑里为 false，供镜像建模的祖先同步跳过） */
	groupSyncEnabled(): boolean {
		return !this.group_flip;
	},

	/** 该组所在链接的全部成员（旧工程的成对 `smart_mirror` 在这里就地迁移成链接 id） */
	members(group: Group): Group[] {
		let fields = group as unknown as SmartCopyFields;
		if (!fields.smart_copy_id && fields.smart_mirror) {
			let legacy = OutlinerNode.uuids[fields.smart_mirror];
			fields.smart_mirror = '';
			if (legacy instanceof Group) {
				let id = linkId(legacy) || guid();
				setLinkId(group, id);
				setLinkId(legacy, id);
				(legacy as unknown as SmartCopyFields).smart_mirror = '';
			}
		}
		return membersOf(linkId(group));
	},

	/** 与 node 结构位置相同的其它成员节点（不含自身） */
	equivalents(node: OutlinerNode): OutlinerNode[] {
		let root = memberRootOf(node);
		if (!root) return [];
		let path = nodePath(node, root);
		if (!path) return [];
		let result: OutlinerNode[] = [];
		for (let member of membersOf(linkId(root))) {
			if (member === root) continue;
			let target = nodeAtPath(member, path);
			if (target) result.push(target);
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
	 * 复制源名称得到副本名称：Ctrl+D 的唯一命名规则 + 左右/前后侧别翻转（反馈#305 第 2 点）。
	 * `exclude` 是刚建出来、名字还等于源名的副本自己，不算占用。
	 */
	copyName(source: string, exclude?: Group): string {
		let axis = sideAxisOf(source);
		let desired = axis == null ? source : nameOnOtherSide(source, axis);
		let taken = new Set(Group.all.filter(group => group !== exclude).map(group => group.name.toLowerCase()));
		return uniqueName(desired, taken);
	},

	/**
	 * 反馈#288/F3：把副本连同子树登记进本条 undo 后删除。
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
		}
		// @ts-expect-error 元素构造函数按类型各自定义，沿用镜像建模的做法按实例构造
		clone = new node.constructor(node);
		// 先挂到场景里（flip 会访问 mesh），再镜像
		clone.addTo(parent);
		clone.init();
		// 反馈#288：UV 随几何一起镜像（两侧读同一块纹理区域、取样方向相反）
		clone.flip(0, mirrorCenter());
		clone.name = node.name;
		return clone;
	},

	/** 右键「设为智能复制组」：建镜像副本、两侧写同一个链接 id */
	setup(group: Group) {
		if (!Modes.edit || !(group instanceof Group)) return;
		if (linkId(group)) {
			Blockbench.showQuickMessage(tl('message.smart_copy.already_set'), 2000);
			return;
		}
		this.suspended = true;
		// post 快照要包含新建的子树（元素+组），撤销才能整棵删掉；pre 侧显式给空的
		// elements —— 缺这个字段时 undo 里「post 有、pre 没有 → 删除」整段被跳过，
		// 镜像组被删掉而子元素只被摘掉 parent、掉回场景根部（用户看到的「散开」）。
		Undo.initEdit({outliner: true, elements: [], groups: [group]});
		let counterpart = this.cloneMirrored(group, group.parent) as Group;
		insertAfter(counterpart, group);
		let id = guid();
		setLinkId(group, id);
		setLinkId(counterpart, id);
		setAttrsLinked(group, true);
		setAttrsLinked(counterpart, true);
		counterpart.name = this.copyName(group.name, counterpart);
		counterpart.isOpen = group.isOpen;
		Canvas.updateAll();
		let subtree = this.collectSubtree(counterpart);
		Undo.finishEdit('Set up smart copy group', {
			outliner: true,
			elements: subtree.filter(node => node instanceof OutlinerElement),
			groups: [group, ...subtree.filter(node => node instanceof Group)],
		});
		this.suspended = false;
		Blockbench.showQuickMessage(tl('message.smart_copy.created', [counterpart.name]), 3000);
	},

	/** 右键「取消智能复制组」：删除其它成员并清掉链接 id */
	remove(group: Group) {
		let others = this.members(group).filter(member => member !== group);
		if (!others.length) return;
		this.suspended = true;
		let removed: OutlinerNode[] = [];
		for (let other of others) removed.push(...this.collectSubtree(other));
		let aspects: UndoAspects = {
			outliner: true,
			elements: removed.filter(node => node instanceof OutlinerElement),
			groups: [group, ...removed.filter(node => node instanceof Group)],
		};
		Undo.initEdit(aspects);
		setLinkId(group, '');
		for (let other of others) other.remove();
		// post 不记录被删节点（与正规删除一致），redo 才会重新删除、undo 才整棵还原
		aspects.elements = aspects.elements.filter(node => !removed.includes(node));
		aspects.groups = aspects.groups.filter(node => !removed.includes(node));
		Undo.finishEdit('Remove smart copy group', aspects);
		this.suspended = false;
		Canvas.updateAll();
		updateSelection();
		Blockbench.showQuickMessage(tl('message.smart_copy.removed', [others.length]), 2500);
	},

	/** 断开 / 恢复组属性链接（反馈#305 第 4 点）：只切这一层开关，组内容照旧同步 */
	setLinkState(group: Group, linked: boolean) {
		let members = this.members(group);
		if (members.length < 2) return;
		let aspects: UndoAspects = {outliner: true, groups: members};
		this.suspended = true;
		Undo.initEdit(aspects);
		for (let member of members) setAttrsLinked(member, linked);
		Undo.finishEdit(linked ? 'Restore smart copy group link' : 'Break smart copy group link', aspects);
		this.suspended = false;
		updateSelection();
		Blockbench.showQuickMessage(tl(linked ? 'message.smart_copy.linked' : 'message.smart_copy.unlinked'), 2500);
	},

	/** 反馈#305 第 3 点：Ctrl+D 复制成员时副本继承链接 id，继续参与同步 */
	onDuplicate(source: OutlinerNode, copy: OutlinerNode) {
		if (!(source instanceof Group) || !(copy instanceof Group)) return;
		let id = linkId(source);
		if (!id) return;
		setLinkId(copy, id);
		setAttrsLinked(copy, attrsLinked(source));
	},

	initEdit(aspects: UndoAspects) {
		// 上一次编辑残留的翻转标记不能带到这一条
		this.group_flip = false;
		if (this.suspended) {
			this.edited_elements = null;
			this.edited_groups = null;
			this.edited_names = null;
			return;
		}
		if (typeof Group == 'undefined' || !Group.all.length) return;
		// 清掉上一次编辑留下的标记，避免跨编辑误跳过/误同步
		for (let uuid in MirrorModeling.cached_elements) {
			if (MirrorModeling.cached_elements[uuid]?.smart_pair) delete MirrorModeling.cached_elements[uuid];
		}
		// 用户实际编辑的节点（在把副本注入 aspects 之前记录，用于识别「两侧同时被编辑」）
		this.edited_elements = new Set((aspects.elements ?? []).map(element => element.uuid));
		this.edited_groups = new Set((aspects.groups ?? []).map(group => group.uuid));
		this.edited_names = new Map((aspects.groups ?? []).map(group => [group.uuid, group.name]));
		if (!Group.all.some(group => linkId(group))) return;
		// 本条编辑可能连带删除副本，先把「编辑前」的树补进 pre 快照，
		// 否则撤销时 Outliner.loadJSON 没有位置挂回被删子树
		Undo.current_save.outliner ??= Outliner.toJSON();

		if (aspects.elements) {
			for (let element of aspects.elements.slice()) {
				let counterparts = this.equivalents(element).filter(node => node instanceof OutlinerElement) as OutlinerElement[];
				if (!counterparts.length) continue;
				let cached = MirrorModeling.cached_elements[element.uuid] ??= {} as MirrorModelingCachedData;
				cached.counterpart = counterparts[0];
				cached.is_centered = false;
				cached.is_copy = false;
				cached.edit_side = 0;
				cached.smart_pair = true;
				for (let counterpart of counterparts) {
					MirrorModeling.insertElementIntoUndo(counterpart, aspects, counterpart.getUndoCopy(aspects));
				}
			}
		}
		if (aspects.groups) {
			for (let group of aspects.groups.slice()) {
				let counterparts = this.equivalents(group).filter(node => node instanceof Group) as Group[];
				if (!counterparts.length) continue;
				let cached = MirrorModeling.cached_elements[group.uuid] ??= {} as MirrorModelingCachedData;
				cached.counterpart = counterparts[0] as unknown as OutlinerElement;
				cached.smart_pair = true;
				for (let counterpart of counterparts) {
					// 快照必须写回真 uuid，否则 insertGroupIntoUndo 的按 uuid 去重永远不命中，
					// 撤销时野 uuid 快照被当成新组重建、真副本被当多余节点删掉
					let before = counterpart.getChildlessCopy();
					before.uuid = counterpart.uuid;
					MirrorModeling.insertGroupIntoUndo(counterpart, aspects, before);
				}
			}
		}
	},

	finishEdit(aspects: UndoAspects) {
		let edited_elements = this.edited_elements ?? new Set<UUID>();
		let edited_groups = this.edited_groups ?? new Set<UUID>();
		let edited_names = this.edited_names ?? new Map<UUID, string>();
		let group_flip = this.group_flip;
		this.edited_elements = null;
		this.edited_groups = null;
		this.edited_names = null;
		// 注意：标志位要留到元素同步之后才清——`MirrorModeling.createClone` 会读
		// `SmartCopyGroup.groupSyncEnabled()` 来决定是否顺带同步祖先组，这里提前清掉会让
		// 翻转时的祖先组同步重新生效（反馈#305 第 5 点曾被它漏掉）
		if (this.suspended) {
			this.group_flip = false;
			return;
		}
		let changed = false;

		if (aspects.elements) {
			for (let element of aspects.elements.slice()) {
				if (!Outliner.elements.includes(element)) {
					// 源被删除：其它成员的同一位置节点一起删除（副本同样进 undo，可一起撤销）
					for (let counterpart of this.equivalents(element)) {
						if (!(counterpart instanceof OutlinerElement) || !Outliner.elements.includes(counterpart)) continue;
						MirrorModeling.insertElementIntoUndo(counterpart, aspects, counterpart.getUndoCopy(aspects));
						counterpart.remove();
						// post 快照不记录被删副本，否则 redo 不会重新删除它
						aspects.elements = aspects.elements.filter(node => node !== counterpart);
						changed = true;
					}
					continue;
				}
				if (!MirrorModeling.cached_elements[element.uuid]?.smart_pair) continue;
				for (let counterpart of this.equivalents(element)) {
					if (!(counterpart instanceof OutlinerElement) || counterpart === element) continue;
					// 两侧都被用户编辑时各自镜像自己的改动，不再交叉同步（否则会翻两次）
					if (edited_elements.has(counterpart.uuid)) continue;
					MirrorModeling.cached_elements[element.uuid].counterpart = counterpart;
					MirrorModeling.createClone(element, aspects);
					changed = true;
				}
			}
		}

		if (aspects.groups) {
			for (let group of aspects.groups.slice()) {
				let partners = this.equivalents(group).filter(node => node instanceof Group) as Group[];
				if (!Group.all.includes(group)) {
					// 反馈#288：整棵子树连同结构登记进 undo，撤销才能还原、redo 才能再删
					for (let partner of partners) {
						if (!Group.all.includes(partner)) continue;
						this.removeSubtreeWithUndo(partner, aspects);
						changed = true;
					}
					continue;
				}
				// 反馈#305 第 5 点：本次编辑是镜像翻转 → 组级属性不传播（组内单位照常同步）
				if (group_flip) continue;
				for (let partner of partners) {
					if (edited_groups.has(partner.uuid)) continue;
					// 第 4 点：断开属性链接后位移/旋转/重命名不再映射，组内容仍然同步
					if (!attrsLinked(group) || !attrsLinked(partner)) continue;
					let before = partner.getChildlessCopy();
					before.uuid = partner.uuid;
					MirrorModeling.insertGroupIntoUndo(partner, aspects, before);
					mirrorGroupTransform(group, partner);
					this.syncName(group, partner, edited_names.get(group.uuid));
					aspects.groups.safePush(partner);
					changed = true;
				}
			}
		}

		if (changed) {
			Canvas.updateAllBones();
			updateSelection();
		}
		this.group_flip = false;
	},

	/**
	 * 反馈#305 第 6 点：改名同步到对侧。名字带 left/right、front/back 时翻到另一侧，
	 * 没有侧别字样时按 Ctrl+D 的唯一命名规则进位（同级已被占用的名字 → `name2`、`name3`…）。
	 */
	syncName(group: Group, partner: Group, previous?: string) {
		if (previous === undefined || previous === group.name) return;
		let axis = sideAxisOf(group.name);
		let taken = new Set(Group.all.filter(node => node !== partner).map(node => node.name.toLowerCase()));
		partner.name = uniqueName(axis == null ? group.name : nameOnOtherSide(group.name, axis), taken);
	},
};

// 镜像建模的缓存条目加上智能复制组的标记（镜像建模自身的钩子据此跳过，由本模块统一处理）
interface MirrorModelingCachedData {
	counterpart?: OutlinerElement
	is_centered?: boolean
	is_copy?: boolean
	edit_side?: number
	smart_pair?: boolean
}

Blockbench.on('init_edit', ({aspects}) => {
	SmartCopyGroup.initEdit(aspects);
});
Blockbench.on('finish_edit', ({aspects}) => {
	SmartCopyGroup.finishEdit(aspects);
});

new Property(Group, 'string', 'smart_copy_id', {default: ''});
new Property(Group, 'boolean', 'smart_copy_linked', {default: true});
// 旧版「智能镜像组」字段：保留注册，旧工程载入不报未知属性，值只在 members() 里迁移一次
new Property(Group, 'string', 'smart_mirror', {default: ''});

BARS.defineActions(() => {
	new Action('setup_smart_copy_group', {
		name: 'action.smart_copy',
		description: 'action.smart_copy.desc',
		icon: 'link',
		category: 'edit',
		condition: () => Modes.edit && Group.multi_selected.length == 1,
		click() {
			let group = Group.first_selected || Group.multi_selected[0];
			if (group) SmartCopyGroup.setup(group);
		},
	});
	// 反馈#305 第 4 点：断开 / 恢复组属性链接
	new Action('break_smart_copy_link', {
		name: 'action.smart_copy_break',
		description: 'action.smart_copy_break.desc',
		icon: 'link_off',
		category: 'edit',
		condition: () => {
			if (!Modes.edit || Group.multi_selected.length != 1) return false;
			let group = Group.first_selected || Group.multi_selected[0];
			return !!(group && linkId(group) && attrsLinked(group));
		},
		click() {
			let group = Group.first_selected || Group.multi_selected[0];
			if (group) SmartCopyGroup.setLinkState(group, false);
		},
	});
	new Action('restore_smart_copy_link', {
		name: 'action.smart_copy_restore',
		description: 'action.smart_copy_restore.desc',
		icon: 'link',
		category: 'edit',
		condition: () => {
			if (!Modes.edit || Group.multi_selected.length != 1) return false;
			let group = Group.first_selected || Group.multi_selected[0];
			return !!(group && linkId(group) && !attrsLinked(group));
		},
		click() {
			let group = Group.first_selected || Group.multi_selected[0];
			if (group) SmartCopyGroup.setLinkState(group, true);
		},
	});
	// 反馈#288：取消智能复制组（删除其它成员并解除链接）
	new Action('remove_smart_copy', {
		name: 'action.remove_smart_copy',
		description: 'action.remove_smart_copy.desc',
		icon: 'link_off',
		category: 'edit',
		condition: () => {
			if (!Modes.edit || Group.multi_selected.length != 1) return false;
			let group = Group.first_selected || Group.multi_selected[0];
			return !!(group && linkId(group));
		},
		click() {
			let group = Group.first_selected || Group.multi_selected[0];
			if (group) SmartCopyGroup.remove(group);
		},
	});
});

const global = {
	SmartCopyGroup,
};
declare global {
	interface Window {
		SmartCopyGroup: typeof SmartCopyGroup
	}
}
Object.assign(window, global);


