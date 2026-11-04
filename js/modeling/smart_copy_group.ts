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

/** 节点当前是否还在场景树里（被删除的节点可能还留着 parent 引用） */
function isInTree(node: OutlinerNode): boolean {
	if (OutlinerNode.uuids[node.uuid] !== node) return false;
	let parent = node.parent;
	if (parent instanceof Group) return parent.children.includes(node);
	return Outliner.root.includes(node);
}

/** 节点所属成员的链接状态（断开状态只记在成员根上，子组自身没有这个字段） */
function memberLinkOf(node: OutlinerNode): {id: UUID, linked: boolean} | undefined {
	let root = memberRootOf(node);
	if (!root) return;
	return {id: linkId(root), linked: attrsLinked(root)};
}

function pathsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/** 把节点放到 parent.children 的第 index 位（越界按末尾） */
function placeAtIndex(node: OutlinerNode, parent: Group, index: number) {
	node.addTo(parent, Math.max(0, Math.min(index, parent.children.length)));
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
	/** 本次编辑涉及的链接 → 成员组（第 2 点：结构同步只在被编辑的链接上做） */
	edit_links: null as Map<UUID, Group[]> | null,
	/** 编辑前各节点相对成员根的路径与所属成员（第 2 点：新节点 / 拖动后的结构调整靠它对齐） */
	pre_paths: null as Map<UUID, number[]> | null,
	pre_roots: null as Map<UUID, Group> | null,
	/**
	 * 编辑前「成员 + 下标路径」→ 节点（复报第 2 轮）：删除动作会在 finishEdit 之前清空
	 * aspects.elements（outliner.js 的 `recursive_list.empty()`），只能靠这份快照做差集
	 * 才知道哪个节点被删了，也才能在删除造成下标位移后仍按路径找回对侧节点。
	 */
	pre_index: null as Map<UUID, Map<string, OutlinerNode>> | null,
	/** 本次编辑涉及的链接属性是否仍连着；断开后组级改动（含枢轴）不再映射（复报第 1 点） */
	edit_attrs_linked: true,
	/** 本次编辑是否在组级（组本身被选中/编辑）——断开后连子块的位移也不映射 */
	edit_group_level: false,
	/** 本次编辑由本模块新建的对侧节点，避免结构同步与几何同步重复处理 */
	created_nodes: null as Set<UUID> | null,

	/** 由 transform.js 的翻转路径调用：本次编辑的组级改动不传播到对侧 */
	markGroupFlip() {
		this.group_flip = true;
	},

	/** 本次编辑是否允许同步组级属性（镜像翻转/已断开属性链接时为 false，供镜像建模的祖先同步跳过） */
	groupSyncEnabled(): boolean {
		return !this.group_flip && this.edit_attrs_linked;
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
	 * 记录编辑开始时的结构快照（反馈#305 复报第 2 点）。配对仍按「相对成员根的下标路径」做，
	 * 因此结构变化必须在各成员上以相同下标重放，路径才会继续对齐：这份快照给出
	 * 「编辑前各节点在哪」，finishEdit 据此判断哪些是新节点、哪些被拖动过。
	 */
	recordEditState(aspects: UndoAspects) {
		this.edit_links = new Map();
		this.pre_paths = new Map();
		this.pre_roots = new Map();
		this.pre_index = new Map();
		this.created_nodes = new Set();
		this.edit_attrs_linked = true;
		this.edit_group_level = false;
		if (typeof Group == 'undefined' || !Group.all.length) return;
		let candidates: OutlinerNode[] = [];
		let push = (node: OutlinerNode) => {
			if (node instanceof OutlinerNode && !candidates.includes(node)) candidates.push(node);
		};
		(aspects.elements ?? []).forEach(push);
		(aspects.groups ?? []).forEach(push);
		(Outliner.selected ?? []).forEach(push);
		Group.all.forEach(group => {
			if (group.selected) push(group);
		});
		for (let node of candidates) {
			let root = memberRootOf(node);
			if (!root) continue;
			// 组本身被选中/编辑：本次编辑属于「组级」（断开属性链接后连子块的位移也不映射）
			if (node instanceof Group && linkId(node)) this.edit_group_level = true;
			let id = linkId(root);
			if (this.edit_links.has(id)) continue;
			let members = membersOf(id);
			this.edit_links.set(id, members);
			if (!members.every(member => attrsLinked(member))) this.edit_attrs_linked = false;
			let index = new Map<string, OutlinerNode>();
			this.pre_index.set(id, index);
			let walk = (current: OutlinerNode, path: number[], member: Group) => {
				this.pre_paths.set(current.uuid, path);
				this.pre_roots.set(current.uuid, root);
				index.set(member.uuid + '|' + path.join(','), current);
				if (current instanceof Group) {
					current.children.forEach((child, child_index) => walk(child, path.concat(child_index), member));
				}
			};
			members.forEach(member => walk(member, [], member));
		}
	},

	/** 新建的对侧节点登记进 undo：post 侧记录 → 撤销时删除、重做时重建 */
	registerCreatedNodes(node: OutlinerNode, aspects: UndoAspects) {
		for (let child of this.collectSubtree(node)) {
			if (child instanceof OutlinerElement) {
				if (!aspects.elements) aspects.elements = [];
				if (!aspects.elements.includes(child)) aspects.elements.safePush(child);
			} else if (child instanceof Group) {
				if (!aspects.groups) aspects.groups = [];
				if (!aspects.groups.includes(child)) aspects.groups.safePush(child);
			}
		}
	},

	/** 新节点（新建/复制/拖入）在其它成员的同一位置生成镜像副本（反馈#305 复报第 2 点） */
	mirrorNewNode(node: OutlinerNode, aspects: UndoAspects, created: Set<UUID>): boolean {
		if (!this.edit_links || !this.pre_paths) return false;
		let root = memberRootOf(node);
		if (!root) return false;
		// 成员根本身是本次编辑新造出来的（Ctrl+D 复制成员成链）：它的内容是那一份副本的，
		// 不该同时往老成员里再塞一遍。成员根在结构快照里 ⇒ 是本次编辑前就存在的成员。
		if (!this.pre_paths.has(root.uuid)) return false;
		let members = this.edit_links.get(linkId(root));
		if (!members) return false;
		let path = nodePath(node, root);
		if (!path || !path.length) return false;
		let parent_path = path.slice(0, -1);
		let index = path[path.length - 1];
		let changed = false;
		for (let member of members) {
			if (member === root) continue;
			let target = nodeAtPath(member, parent_path);
			if (!(target instanceof Group)) continue;
			let clone = this.cloneMirrored(node, target);
			placeAtIndex(clone, target, index);
			created.add(clone.uuid);
			this.registerCreatedNodes(clone, aspects);
			changed = true;
		}
		return changed;
	},

	/** 被拖动/重排的既有节点：把对侧在「编辑前同一位置」的节点挪到对应位置（第 2 点） */
	mirrorMovedNodes(aspects: UndoAspects, node_ids: Set<UUID>): boolean {
		if (!this.edit_links || !this.pre_paths || !this.pre_roots) return false;
		let changed = false;
		// 只重放用户实际拖动的节点：其它节点的下标变化是这次结构操作的连带结果，
		// 把「对侧节点逐个搬到新下标」会连环错位（曾把整组顺序搬乱）。
		for (let uuid of node_ids) {
			let old_path = this.pre_paths.get(uuid);
			if (!old_path) continue;
			let node = OutlinerNode.uuids[uuid] as OutlinerNode | undefined;
			if (!node || !(node instanceof OutlinerNode) || !isInTree(node)) continue;
			let old_root = this.pre_roots.get(uuid);
			if (!old_root) continue;
			let members = this.edit_links.get(linkId(old_root));
			if (!members) continue;
			let root = memberRootOf(node);
			if (!root || linkId(root) !== linkId(old_root)) continue;
			let new_path = nodePath(node, root);
			if (!new_path || pathsEqual(old_path, new_path)) continue;
			let parent_path = new_path.slice(0, -1);
			let index = new_path[new_path.length - 1];
			for (let member of members) {
				if (member === root) continue;
				let counterpart = nodeAtPath(member, old_path);
				if (!counterpart || counterpart === node) continue;
				// 两侧都被用户拖动时各自保留自己的位置
				if (node_ids.has(counterpart.uuid)) continue;
				let target = nodeAtPath(member, parent_path);
				if (!(target instanceof Group)) continue;
				let current_path = nodePath(counterpart, member);
				if (current_path && pathsEqual(current_path, new_path)) continue;
				if (counterpart instanceof Group) {
					let before = counterpart.getChildlessCopy();
					before.uuid = counterpart.uuid;
					MirrorModeling.insertGroupIntoUndo(counterpart, aspects, before);
				} else if (counterpart instanceof OutlinerElement) {
					MirrorModeling.insertElementIntoUndo(counterpart, aspects, counterpart.getUndoCopy(aspects));
				} else {
					continue;
				}
				placeAtIndex(counterpart, target, index);
				changed = true;
			}
		}
		return changed;
	},

	/**
	 * 反馈#305 复报（第 2 轮）②：删除 / 剪切组内元素时对侧没有同步。
	 * 根因：删除动作在 finishEdit 之前就把 aspects.elements/groups 清空（outliner.js 删完调
	 * `recursive_list.empty()`，而 undo 存的是同一个数组引用），到 finishEdit 时列表已空，
	 * 靠 aspects 认不出被删节点。这里改用 initEdit 的结构快照做差集；配对取快照里的路径，
	 * 不用活树的下标 —— 删除会让下标整体左移，按活树找会对错位。
	 * 只处理「最上层被删节点」：祖先也在快照里且已被删时，交给祖先整棵处理，子节点不重复删。
	 */
	mirrorDeletedNodes(aspects: UndoAspects): boolean {
		if (!this.pre_index || !this.edit_links) return false;
		let changed = false;
		for (let [id, index] of this.pre_index) {
			let members = this.edit_links.get(id) ?? membersOf(id);
			let seen_paths = new Set<string>();
			for (let [key, node] of [...index]) {
				let separator = key.indexOf('|');
				let member_uuid = key.slice(0, separator);
				let path_key = key.slice(separator + 1);
				if (seen_paths.has(path_key)) continue;
				seen_paths.add(path_key);
				if (isInTree(node)) continue;
				// 祖先也被删（或祖先就是被删的成员根）时由祖先统一处理
				if (path_key) {
					let parent_key = path_key.slice(0, path_key.lastIndexOf(','));
					let parent = index.get(member_uuid + '|' + parent_key);
					if (parent && !isInTree(parent)) continue;
				}
				for (let member of members) {
					if (member.uuid === member_uuid) continue;
					let counterpart = index.get(member.uuid + '|' + path_key);
					if (!counterpart || counterpart === node) continue;
					if (!isInTree(counterpart)) continue;
					if (this.created_nodes?.has(counterpart.uuid)) continue;
					if (counterpart instanceof Group) {
						this.removeSubtreeWithUndo(counterpart, aspects);
					} else if (counterpart instanceof OutlinerElement) {
						MirrorModeling.insertElementIntoUndo(counterpart, aspects, counterpart.getUndoCopy(aspects));
						counterpart.remove();
						// post 不记录被删副本（与正规删除一致），redo 才会重新删除它
						if (aspects.elements) aspects.elements = aspects.elements.filter(node => node !== counterpart);
					} else {
						continue;
					}
					changed = true;
				}
			}
		}
		return changed;
	},

	/** 本次编辑的结构变化镜像到其它成员（先同步删除，再重放既有节点的移动，最后插入新节点） */
	syncStructure(aspects: UndoAspects, edited_elements: Set<UUID>, edited_groups: Set<UUID>): boolean {
		if (!this.edit_links || !this.pre_paths) return false;
		// 断开属性链接后的组级改动（移动/枢轴）完全不映射，结构也不会变
		if (!this.edit_attrs_linked && this.edit_group_level) return false;
		let created = this.created_nodes ?? new Set<UUID>();
		let changed = this.mirrorDeletedNodes(aspects);
		if (aspects.outliner) {
			let moved = new Set<UUID>([...edited_elements, ...edited_groups]);
			changed = this.mirrorMovedNodes(aspects, moved) || changed;
		}
		let touched = [...(aspects.elements ?? []), ...(aspects.groups ?? [])];
		for (let node of touched.slice()) {
			if (created.has(node.uuid)) continue;
			if (!isInTree(node)) continue;
			if (this.pre_paths.has(node.uuid)) continue;
			changed = this.mirrorNewNode(node, aspects, created) || changed;
		}
		if (changed) Canvas.updateAll();
		return changed;
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

	/**
	 * 右键「取消智能复制组」（反馈#305 复报第 3 点）：默认只解除链接、保留其余复制组，
	 * 并在视图下方弹出小面板（与顶点捕捉旋转模式的 amend 面板同一形态）提供
	 * 「同时删除其余复制组」勾选；勾上就删、取消勾选就回到只解链接。
	 */
	remove(group: Group) {
		let members = this.members(group);
		if (members.length < 2) return;
		let group_uuid = group.uuid;
		let member_uuids = members.map(member => member.uuid);
		this.applyRemoval(group_uuid, member_uuids, false, false);
		Undo.amendEdit({
			delete_others: {
				type: 'checkbox',
				label: 'dialog.smart_copy.remove_others',
				description: 'dialog.smart_copy.remove_others.desc',
				value: false,
			},
		}, result => {
			this.applyRemoval(group_uuid, member_uuids, !!result.delete_others, true);
		});
	},

	/**
	 * 取消智能复制组的实际执行：解除全部成员的链接；`delete_others` 为真时把其余成员的
	 * 整棵子树一起删掉。按 uuid 重查节点，是因为 amend 面板每次改动都会先撤销上一条编辑。
	 * `amended` 为真表示这次执行来自 amend 面板（要保住面板，不把它关掉）。
	 */
	applyRemoval(group_uuid: UUID, member_uuids: UUID[], delete_others: boolean, amended: boolean) {
		let group = OutlinerNode.uuids[group_uuid];
		if (!(group instanceof Group)) return;
		let members = member_uuids
			.map(uuid => OutlinerNode.uuids[uuid])
			.filter(node => node instanceof Group) as Group[];
		if (!members.includes(group)) members.push(group);
		let others = delete_others ? members.filter(member => member !== group && isInTree(member)) : [];
		let removed: OutlinerNode[] = [];
		for (let other of others) removed.push(...this.collectSubtree(other));
		let aspects: UndoAspects = {
			outliner: true,
			elements: removed.filter(node => node instanceof OutlinerElement),
			groups: [group, ...removed.filter(node => node instanceof Group)],
		};
		this.suspended = true;
		Undo.initEdit(aspects, amended);
		for (let member of members) setLinkId(member, '');
		for (let other of others) other.remove();
		// post 不记录被删节点（与正规删除一致），redo 才会重新删除、undo 才整棵还原
		aspects.elements = aspects.elements.filter(node => !removed.includes(node));
		aspects.groups = aspects.groups.filter(node => !removed.includes(node));
		Undo.finishEdit(delete_others ? 'Remove smart copy group' : 'Unlink smart copy group', aspects);
		this.suspended = false;
		Canvas.updateAll();
		updateSelection();
		Blockbench.showQuickMessage(delete_others
			? tl('message.smart_copy.removed', [others.length])
			: tl('message.smart_copy.unlinked_only', [members.length - 1]), 2500);
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
			this.edit_links = null;
			this.pre_paths = null;
			this.pre_roots = null;
			this.pre_index = null;
			this.created_nodes = null;
			this.edit_attrs_linked = true;
			this.edit_group_level = false;
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
		// 结构快照与属性链接状态（复报第 1、2 点）：必须在任何同步注入之前记录
		this.recordEditState(aspects);
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
		let attrs_linked = this.edit_attrs_linked;
		let group_level = this.edit_group_level;
		this.edited_elements = null;
		this.edited_groups = null;
		this.edited_names = null;
		// 注意：标志位要留到元素同步之后才清——`MirrorModeling.createClone` 会读
		// `SmartCopyGroup.groupSyncEnabled()` 来决定是否顺带同步祖先组，这里提前清掉会让
		// 翻转时的祖先组同步重新生效（反馈#305 第 5 点曾被它漏掉）；
		// `edit_attrs_linked` 同理，断开属性链接后祖先组的枢轴/位移都不能再映射（复报第 1 点）。
		if (this.suspended) {
			this.group_flip = false;
			this.edit_links = null;
			this.pre_paths = null;
			this.pre_roots = null;
			this.pre_index = null;
			this.created_nodes = null;
			this.edit_attrs_linked = true;
			this.edit_group_level = false;
			return;
		}
		let changed = false;

		// 反馈#305 复报第 2 点：先把本次编辑造成的结构变化镜像到其它成员，
		// 保证随后按「下标路径」配对做几何同步时两侧结构已经对齐。
		changed = this.syncStructure(aspects, edited_elements, edited_groups) || changed;

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
				// 复报第 1 点：属性链接断开后，组级编辑（移动/枢轴）连子块的位移也不再映射。
				// 直接编辑组内的块仍然同步（那不是组级编辑）。
				if (!attrs_linked && group_level) continue;
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
					// 第 4 点：断开属性链接后位移/旋转/重命名不再映射，组内容仍然同步。
					// 断开标记只存在成员根上，子组自身不带该字段——按成员根判定，
					// 否则移动被断开的成员时，其内部子组仍会把变换映射到对侧（复报第 2 轮①）。
					let source_link = memberLinkOf(group);
					let partner_link = memberLinkOf(partner);
					if (!source_link || !partner_link || source_link.id !== partner_link.id) continue;
					if (!source_link.linked || !partner_link.linked) continue;
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
		this.edit_links = null;
		this.pre_paths = null;
		this.pre_roots = null;
		this.pre_index = null;
		this.created_nodes = null;
		this.edit_attrs_linked = true;
		this.edit_group_level = false;
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


