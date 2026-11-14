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
	/** 链接里最早的成员（反馈#305 后续③）：只有删除它才带走全部复制组 */
	smart_copy_initial?: boolean
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
function isInitial(group: Group): boolean {
	return (group as unknown as SmartCopyFields).smart_copy_initial === true;
}
function setInitial(group: Group, initial: boolean) {
	(group as unknown as SmartCopyFields).smart_copy_initial = initial;
}

/**
 * 反馈#351/#352：与模型结构无关的编辑不参与智能复制组同步。
 *
 * - 只有 `visibility` 字段的编辑（「仅显示所选项」/批量隐藏）：可见性是**每侧独立**的
 *   显示状态，镜像到对侧会让独显把两侧全部隐藏，功能整体失效（#351）。
 * - 不含元素/组、也不带 outliner 快照的编辑（画笔、橡皮、油漆桶、调色板、图层）：画笔
 *   不改模型几何，但早前会顺手给这条 undo 记一份完整 outliner 快照，撤销时
 *   `Outliner.loadJSON` 重建节点，动画模式下的骨骼姿态随之丢失（#352）。
 */
function syncSkipEdit(aspects: UndoAspects): boolean {
	let touches_nodes = aspects.elements != null || aspects.groups != null || aspects.group != null || !!aspects.outliner;
	if (!touches_nodes) return true;
	let fields = aspects.element_fields as string[] | undefined;
	return !!fields?.length && fields.every(field => field == 'visibility');
}

/** 镜像面坐标：与镜像建模共用同一约定 */
function mirrorCenter(): number {
	return Format.centered_grid ? 0 : 8;
}

/**
 * 反馈#305 复报第 4 轮④：两侧成员根之间的镜像基准。
 * 内容同步要在「成员根之间」做镜像：两侧互为全局镜像时基准就是 8（与旧行为完全一致）；
 * 但断开链接后用户可能移动过某一侧（两侧不再关于全局镜像面对称），这时若仍按 8 镜像，
 * 对侧的块会被写到「全局镜像位置」而不是对侧组里的相同位置。
 * 取两个成员根原点的中点作为镜像面，等价于「源块在源成员根内的位置 → 对侧成员根内的
 * 同位置」，这也是用户说的「以智能组位置为基准」。任一侧不在成员里时退回全局镜像面。
 *
 * 反馈#305 复报第 5 轮①（X 轴位移第一个块不同步）：基准必须取**编辑前**的成员根原点。
 * 组级位移时源根已经动过、对侧根要等组级同步才动，用实时坐标求中点会让位移量被「吃掉一半」：
 * 第一个被处理的块拿到 center = (源新位置 + 对侧旧位置)/2，镜像后对侧不动；等第一个块处理完
 * （createClone 会顺带把对侧根的 origin 也镜像过去），后面块的中点才回到正确值。于是现象
 * 正好是「第一个块不跟着走，Y/Z 正常（它们直接抄源值，不依赖中点的 x）」。
 *
 * 反馈#305 后续④（只支持左右对称）：镜像轴改为按两个成员根的相对位置判定——哪一轴上两者
 * 分得最开就绕哪一轴镜像。左右对称（X 差最大）结果与旧行为一致；把副本挪到模型前方（Z 差
 * 最大）之后，前后对称也能正确镜像，同一条规则同样覆盖上下（Y）。
 */
function preRootOrigin(group: Group): number[] {
	let pre = SmartCopyGroup.pre_root_origins?.get(group.uuid);
	return pre ? pre : group.origin;
}

/**
 * 一对成员之间的镜像关系（反馈#305 后续③：不再只支持单轴）。
 *
 * 每个轴独立判定：两个成员根在编辑前的原点在该轴上分得开（差值非零）就镜像该轴，
 * 否则原样沿用源坐标。于是
 * - 左右对称（只在 X 分得开）→ 只镜像 X，结果与旧行为一致；
 * - 前后对称（副本被挪到模型前方，只在 Z 分得开）→ 镜像 Z；
 * - 对角（X 与 Z 都分得开，leftfront ↔ rightback）→ 两轴一起镜像，等价于绕中点的 180° 中心对称。
 *
 * `axes` 同时给元素镜像用（逐个轴 flip）。
 */
interface MirrorSpec {
	/** 每轴符号：-1 = 该轴镜像，1 = 原样沿用 */
	signs: number[]
	/** 每轴的镜像面坐标（仅 signs 为 -1 的轴有意义） */
	centers: number[]
	/** 参与镜像的轴（升序），元素镜像按它逐个 flip */
	axes: number[]
}

function pairMirror(source_node: OutlinerNode, target_node: OutlinerNode | 'root'): MirrorSpec {
	let source_root = memberRootOf(source_node);
	let target_root = target_node instanceof OutlinerNode ? memberRootOf(target_node) : undefined;
	// 两侧原点完全重合（Ctrl+D 就地复制、不在成员里、或成员根恰好同位置）时无从判定轴向，
	// 退回 X 轴 + 全局镜像面（与旧行为一致）
	let fallback_spec = (): MirrorSpec => ({
		signs: [-1, 1, 1],
		centers: [mirrorCenter(), 0, 0],
		axes: [0],
	});
	if (!source_root || !target_root || source_root === target_root) return fallback_spec();
	let source = preRootOrigin(source_root);
	let target = preRootOrigin(target_root);
	let spec = fallback_spec();
	spec.signs = [1, 1, 1];
	spec.axes = [];
	for (let i = 0; i < 3; i++) {
		if (Math.abs(source[i] - target[i]) > 1e-6) {
			spec.signs[i] = -1;
			spec.centers[i] = (source[i] + target[i]) / 2;
			spec.axes.push(i);
		}
	}
	return spec.axes.length ? spec : fallback_spec();
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

/** 节点的祖先组里是否有 groups 中的某一个（用于判定「它只是跟着某个组一起变」） */
function hasAncestorGroupIn(node: OutlinerNode, groups: Group[]): boolean {
	let parent = node.parent;
	while (parent instanceof Group) {
		if (groups.includes(parent)) return true;
		parent = parent.parent;
	}
	return false;
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

function mirrorGroupTransform(source: Group, counterpart: Group, mirror: MirrorSpec) {
	// 逐轴按镜像关系换算（反馈#305 后续③）：镜像轴绕中轴取反，非镜像轴原样沿用源值。
	// 旋转是轴向量：绕 S 集合镜像后 r_i = det(S)·sign_i·r_i——单轴镜像时等价于
	// 「该轴保留、另两轴取反」（与 Cube.flip 同一约定），双轴镜像时两轴取反、第三轴保留。
	let det = mirror.signs[0] * mirror.signs[1] * mirror.signs[2];
	for (let i = 0; i < 3; i++) {
		counterpart.origin[i] = mirror.signs[i] === -1 ? 2 * mirror.centers[i] - source.origin[i] : source.origin[i];
		counterpart.rotation[i] = det * mirror.signs[i] * source.rotation[i];
	}
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
	 * 编辑前各成员根的原点（反馈#305 复报第 5 轮①）：镜像基准必须用编辑前的位置算，
	 * 否则「源根已移动、对侧根还没同步」的中间态会让位移的镜像量失真。
	 * 后续④起存完整坐标，用于判定镜像轴。
	 */
	pre_root_origins: null as Map<UUID, number[]> | null,
	/**
	 * 编辑前各组的变换快照（反馈#305 后续①②）：拖动组节点时 undo aspects 里可能没有 groups
	 * （gizmo 直接改 origin），只能靠这份快照判断哪些组的位移/旋转变了，才能把子组同步到对侧、
	 * 并在「成员根被移动 + 属性链接已断开」时整棵冻结该成员。
	 */
	pre_group_transforms: null as Map<UUID, {origin: number[], rotation: number[], scale?: number[]}> | null,
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
	/**
	 * 反馈#349：initEdit 为对侧节点写过 pre 快照的节点。
	 * 删除动作会在 finishEdit 之前清空 aspects 列表，pre 快照里的对侧节点于是「pre 有、post 没有」，
	 * undo 系统会把它们当成要删除的节点——重做时幸存组的内容跟着一起消失。收尾时把仍活着的补进 post。
	 */
	pre_snapshots: null as {elements: OutlinerElement[], groups: Group[]} | null,

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
		this.pre_root_origins = new Map();
		this.pre_group_transforms = new Map();
		this.created_nodes = new Set();
		this.edit_attrs_linked = true;
		// 反馈#305 复报第 4 轮③：只有「本次编辑确实编辑了成员根」才算组级编辑。
		// 不能用「当前选中的组」推断：选中元素时它的父组通常也挂着 selected，
		// 早前按选中状态判定会把「编辑组内块」误当成组级编辑，断开链接后块就不同步了。
		this.edit_group_level = (aspects.groups ?? []).some(group => group instanceof Group && memberRootOf(group) === group);
		if (typeof Group == 'undefined' || !Group.all.length) return;
		// 本次编辑涉及的链接 id：候选节点所在的成员根；结构编辑（大纲拖放/删除）在编辑前
		// 还不知道节点会被拖进哪个成员，因此把当前所有链接都记下来（反馈#305 复报第 4 轮①：
		// 从组外把元素拖进复制组时，源节点原本不在任何成员里，只看候选节点会漏掉目标链接）。
		let link_ids = new Set<UUID>();
		let add_node = (node: OutlinerNode) => {
			if (!(node instanceof OutlinerNode)) return;
			let root = memberRootOf(node);
			if (root) link_ids.add(linkId(root));
		};
		(aspects.elements ?? []).forEach(add_node);
		(aspects.groups ?? []).forEach(add_node);
		(Outliner.selected ?? []).forEach(add_node);
		Group.all.forEach(group => {
			if (group.selected) add_node(group);
		});
		if (aspects.outliner) {
			Group.all.forEach(group => {
				if (linkId(group)) link_ids.add(linkId(group));
			});
		}
		for (let id of link_ids) {
			let members = membersOf(id);
			this.edit_links.set(id, members);
			this.recordMemberOrigins(members);
			if (!members.every(member => attrsLinked(member))) this.edit_attrs_linked = false;
			let index = new Map<string, OutlinerNode>();
			this.pre_index.set(id, index);
			let walk = (current: OutlinerNode, path: number[], member: Group) => {
				this.pre_paths.set(current.uuid, path);
				this.pre_roots.set(current.uuid, member);
				index.set(member.uuid + '|' + path.join(','), current);
				if (current instanceof Group) {
					this.pre_group_transforms?.set(current.uuid, {
						origin: current.origin.slice(),
						rotation: current.rotation.slice(),
						scale: current.scale ? current.scale.slice() : undefined,
					});
					current.children.forEach((child, child_index) => walk(child, path.concat(child_index), member));
				}
			};
			members.forEach(member => walk(member, [], member));
		}
	},

	/** 记录成员根的原点（供 pairMirror 用编辑前的位置算镜像基准） */
	recordMemberOrigins(members: Group[]) {
		if (!this.pre_root_origins) return;
		for (let member of members) {
			if (!this.pre_root_origins.has(member.uuid)) {
				this.pre_root_origins.set(member.uuid, member.origin.slice());
			}
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

	/**
	 * 新节点（新建/复制/拖入）在其它成员的同一位置生成镜像副本（反馈#305 复报第 2 点）。
	 * 反馈#305 复报第 5 轮②：只建**这一层**。早前整棵深拷贝节点子树，于是「组内选中几个块
	 * Ctrl+G 到新建组」时，对侧既得到新组（含被搬进去的那几个块的副本），又保留着原来那几个块
	 * ——重复副本 + 结构不同步，撤销后这些副本还会掉回大纲根目录成幽灵。现在子节点由各自的
	 * 循环处理：既有节点走 mirrorMovedNodes 搬到对侧同一位置，真正新建的节点才新建。
	 */
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
			let clone = this.cloneMirrored(node, target, false);
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
		// 反馈#305 复报第 4 轮②：对侧节点必须全部按「编辑前的树」解析完再统一搬动。
		// 边解析边搬时，同一次重排里第二个节点的对侧会按移动后的顺序取到错误的对象
		// （交换两个元素顺序时，第二个对侧被搬回原处，结果对面完全没变）。
		// 反馈#305 复报第 5 轮②：对侧一律按 pre_index 的「编辑前快照」定位。新组可能已经在
		// 前面的阶段插进了对侧，活树的下标路径整体错位，按活树下标取会拿到别的节点。
		let operations: {counterpart: OutlinerNode, target: Group, index: number}[] = [];
		for (let uuid of node_ids) {
			let old_path = this.pre_paths.get(uuid);
			if (!old_path) continue;
			let node = OutlinerNode.uuids[uuid] as OutlinerNode | undefined;
			if (!node || !(node instanceof OutlinerNode) || !isInTree(node)) continue;
			let old_root = this.pre_roots.get(uuid);
			if (!old_root) continue;
			let link_id = linkId(old_root);
			let members = this.edit_links.get(link_id);
			if (!members) continue;
			let root = memberRootOf(node);
			if (!root || linkId(root) !== link_id) continue;
			let new_path = nodePath(node, root);
			if (!new_path || pathsEqual(old_path, new_path)) continue;
			let parent_path = new_path.slice(0, -1);
			let index = new_path[new_path.length - 1];
			let index_snapshot = this.pre_index?.get(link_id);
			for (let member of members) {
				if (member === root) continue;
				let counterpart = index_snapshot?.get(member.uuid + '|' + old_path.join(','));
				if (!counterpart || counterpart === node) continue;
				// 两侧都被用户拖动时各自保留自己的位置
				if (node_ids.has(counterpart.uuid)) continue;
				let target = nodeAtPath(member, parent_path);
				if (!(target instanceof Group)) continue;
				let current_path = nodePath(counterpart, member);
				if (current_path && pathsEqual(current_path, new_path)) continue;
				operations.push({counterpart, target, index});
			}
		}
		// 同一父级下按下标升序搬，保证多个节点搬进同一个新组时顺序与源侧一致
		operations.sort((a, b) => a.index - b.index);
		for (let {counterpart, target, index} of operations) {
			if (!isInTree(counterpart)) continue;
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
		return changed;
	},

	/**
	 * 反馈#305 复报（第 2 轮）②：删除 / 剪切组内元素时对侧没有同步。
	 * 根因：删除动作在 finishEdit 之前就把 aspects.elements/groups 清空（outliner.js 删完调
	 * `recursive_list.empty()`，而 undo 存的是同一个数组引用），到 finishEdit 时列表已空，
	 * 靠 aspects 认不出被删节点。这里改用 initEdit 的结构快照做差集；配对取快照里的路径，
	 * 不用活树的下标 —— 删除会让下标整体左移，按活树找会对错位。
	 * 只处理「最上层被删节点」：祖先也在快照里且已被删时，交给祖先整棵处理，子节点不重复删。
	 * 按「快照条目」逐个遍历、不按路径去重：同一条路径上可能只有一个成员被删（用户只删了自己那侧），
	 * 按路径去重会让先遍历到的「还在树里」的成员短路掉整条路径，其它成员于是不同步
	 * （复报第 3 轮：三成员链里删第三个成员内的块，另外两个不动）。
	 */
	mirrorDeletedNodes(aspects: UndoAspects): boolean {
		if (!this.pre_index || !this.edit_links) return false;
		let changed = false;
		for (let [id, index] of this.pre_index) {
			let members = this.edit_links.get(id) ?? membersOf(id);
			for (let [key, node] of [...index]) {
				let separator = key.indexOf('|');
				let member_uuid = key.slice(0, separator);
				let path_key = key.slice(separator + 1);
				if (isInTree(node)) continue;
				// 反馈#305 后续③：整位成员根被删时（含初始组删除全部成员），删掉的子树不再逐个同步，
				// 只由 finishEdit 的组删除分支决定是否带走其它成员。
				let member_root = this.pre_roots?.get(node.uuid);
				if (member_root && !isInTree(member_root)) continue;
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

	/**
	 * 大纲拖放 / 分组（outliner.js 的拖入、重排、Ctrl+G 新建组）不把被搬动的节点放进 aspects
	 * 列表，只有 `outliner: true`；此时用「结构快照 vs 活树」的差集找出本次真正变动的节点
	 * （复报第 3 轮③）：
	 * - 位置变了的既有成员节点 → 交给 mirrorMovedNodes 重放
	 * - 成员里新出现的节点 → 逐个浅层重放（按前序返回，父节点先建，子节点随后才有落点）
	 * 反馈#305 复报第 5 轮②：新节点不再「只取最上层由深拷贝一并复制」。深拷贝会把「被搬进
	 * 新组的既有块」也复制一份，而对侧原本就有的块又不会被搬走，于是对侧出现重复副本、
	 * 结构也对不上。现在所有层级的节点都返回，由 mirrorNewNode / mirrorMovedNodes 各管各的。
	 */
	collectStructuralChanges(): {moved: Set<UUID>, added: OutlinerNode[]} {
		let moved = new Set<UUID>();
		let added: OutlinerNode[] = [];
		if (!this.pre_paths || !this.edit_links) return {moved, added};
		let seen = new Set<UUID>();
		for (let [uuid, old_path] of this.pre_paths) {
			let node = OutlinerNode.uuids[uuid] as OutlinerNode | undefined;
			if (!node || !isInTree(node)) continue;
			let root = memberRootOf(node);
			if (!root) continue;
			let new_path = nodePath(node, root);
			if (!new_path || pathsEqual(old_path, new_path)) continue;
			moved.add(uuid);
		}
		for (let members of this.edit_links.values()) {
			for (let member of members) {
				if (!isInTree(member)) continue;
				let walk = (parent: Group) => {
					for (let child of parent.children) {
						if (!this.pre_paths.has(child.uuid)) {
							// 新节点：父子都要返回，父先子后由前序遍历保证
							if (isInTree(child) && !this.created_nodes?.has(child.uuid) && !seen.has(child.uuid)) {
								seen.add(child.uuid);
								added.push(child);
							}
						}
						if (child instanceof Group) walk(child);
					}
				};
				walk(member);
			}
		}
		return {moved, added};
	},

	/**
	 * 本次编辑的结构变化镜像到其它成员。
	 * 顺序（反馈#305 复报第 5 轮②）：先同步删除 → 再按前序建新节点（父先子后）→ 最后重放
	 * 既有节点的移动。早前是「先重放移动、再插新节点」，于是「组内的块被 Ctrl+G 搬进新建组」
	 * 时，对侧要搬动的块找不到落点（新组还不存在）被跳过，随后深拷贝又把它们复制进新组，
	 * 结果两侧都多出副本。现在新组先建好壳，被搬动的块再走既有的「搬到对侧同位置」路径。
	 */
	syncStructure(aspects: UndoAspects, edited_elements: Set<UUID>, edited_groups: Set<UUID>): boolean {
		if (!this.edit_links || !this.pre_paths) return false;
		// 注意：不能因为「断开属性链接 + 组级编辑」就整段跳过——断开只关掉位移/旋转/重命名，
		// 删除、剪切、拖入仍然是结构变化，必须继续同步（复报第 3 轮②）
		let created = this.created_nodes ?? new Set<UUID>();
		let changed = this.mirrorDeletedNodes(aspects);

		// 结构差集（大纲拖放 / Ctrl+G 分组）：这两个入口都带 `outliner: true`。被搬进新组的
		// 既有节点不在任何 aspects 列表里，只能靠差集补；普通属性编辑（拖动/改数值）不做差集，
		// 避免每次编辑都遍历成员子树。
		let diff = aspects.outliner ? this.collectStructuralChanges() : {moved: new Set<UUID>(), added: [] as OutlinerNode[]};
		let moved = new Set<UUID>([...edited_elements, ...edited_groups]);
		diff.moved.forEach(uuid => moved.add(uuid));

		// 新节点统一登记（aspects 里的候选 + 差集扫描结果），去重后按层级顺序处理
		let handled = new Set<UUID>();
		let pending_added: OutlinerNode[] = [];
		let add_pending = (node: OutlinerNode) => {
			if (!(node instanceof OutlinerNode)) return;
			if (handled.has(node.uuid)) return;
			handled.add(node.uuid);
			pending_added.push(node);
		};
		diff.added.forEach(add_pending);
		(aspects.elements ?? []).forEach(add_pending);
		(aspects.groups ?? []).forEach(add_pending);

		for (let node of pending_added) {
			if (created.has(node.uuid)) continue;
			if (!isInTree(node)) continue;
			if (this.pre_paths.has(node.uuid)) continue;
			changed = this.mirrorNewNode(node, aspects, created) || changed;
		}
		if (aspects.outliner || moved.size) {
			changed = this.mirrorMovedNodes(aspects, moved) || changed;
		}
		if (changed) Canvas.updateAll();
		return changed;
	},

	/**
	 * 反馈#305 第 2 点 / 后续⑤：复制出来的组按「软件自带镜像翻转」的规则改名——
	 * 名字里带镜像轴的侧别字样时翻到对侧（左右对称翻 left→right，前后对称翻 front→back，
	 * 对角对称两轴一起翻 leftfront→rightback），再按 Ctrl+D 的唯一命名进位去重。
	 * `exclude` 是刚建出来的副本自己，不算占用。
	 */
	mirroredName(source: string, mirror: MirrorSpec, exclude?: Group): string {
		let name = source;
		for (let axis of mirror.axes) {
			name = nameOnOtherSide(name, axis);
		}
		let taken = new Set(Group.all.filter(group => group !== exclude).map(group => group.name.toLowerCase()));
		return uniqueName(name, taken);
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

	/**
	 * 复制节点为镜像副本并挂到 parent 下。`deep`（默认 true）连子树一起复制——
	 * 「设为智能复制组」用它建首份副本；结构同步里改为逐层浅拷贝（反馈#305 复报第 5 轮②），
	 * 否则被搬进新组的既有块会被复制成第二份。
	 */
	cloneMirrored(node: OutlinerNode, parent: OutlinerNode | 'root', deep = true): OutlinerNode {
		let clone: OutlinerNode;
		let mirror = pairMirror(node, parent);
		if (node instanceof Group) {
			clone = new Group(node as unknown as OutlinerNodeData);
			mirrorGroupTransform(node, clone as Group, mirror);
			// 先建好组（有 mesh）再挂子节点，子元素的 init 需要父组已存在
			clone.addTo(parent);
			clone.init();
			// 反馈#305 后续⑤⑥：子组/新组也要按镜像轴翻名并去重，否则对侧会出现同名组
			clone.name = this.mirroredName(node.name, mirror, clone as Group);
			if (deep) {
				for (let child of node.children) {
					this.cloneMirrored(child, clone);
				}
			}
			return clone;
		}
		// @ts-expect-error 元素构造函数按类型各自定义，沿用镜像建模的做法按实例构造
		clone = new node.constructor(node);
		// 先挂到场景里（flip 会访问 mesh），再镜像
		clone.addTo(parent);
		clone.init();
		// 反馈#288：UV 随几何一起镜像（两侧读同一块纹理区域、取样方向相反）
		// 反馈#305 后续③：对角对称要在两个轴上逐个 flip（等价于绕中点的 180° 中心对称）
		for (let axis of mirror.axes) {
			clone.flip(axis, mirror.centers[axis]);
		}
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
		// 反馈#305 后续③：原始对象记为「初始组」，大纲标识与删除规则都以它为准
		setInitial(group, true);
		setInitial(counterpart, false);
		// 名字已由 cloneMirrored 按镜像轴翻转 + 去重
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
		if (members.length < 2) {
			// 反馈#349：链接里只剩自己（旧工程里对侧已被删除时留下的孤立链接）也要能取消，
			// 否则 `condition` 为真的「取消智能复制组」点了完全没反应。
			if (!linkId(group)) return;
			let aspects: UndoAspects = {outliner: true, groups: [group]};
			this.suspended = true;
			Undo.initEdit(aspects);
			this.unlinkSurvivor(group, aspects);
			Undo.finishEdit('Unlink smart copy group', aspects);
			this.suspended = false;
			updateSelection();
			Blockbench.showQuickMessage(tl('message.smart_copy.auto_unlinked'), 2500);
			return;
		}
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
			// 反馈#305 后续④：链接 id 写在每个成员身上，快照必须覆盖全部成员——
			// 只写当前组时撤销回来只有它自己恢复链接，其余成员仍停在断开态，
			// 表现为「复制组没恢复、恢复出来的组也取消不掉」。
			groups: members.concat(removed.filter(node => node instanceof Group && !members.includes(node))),
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
		// 复制出来的成员永远不是初始组（getChildlessCopy 会把该字段一起拷过来）
		setInitial(copy, false);
		let id = linkId(source);
		if (!id) return;
		setLinkId(copy, id);
		setAttrsLinked(copy, attrsLinked(source));
	},

	initEdit(aspects: UndoAspects) {
		// 上一次编辑残留的翻转标记不能带到这一条
		this.group_flip = false;
		// 本模块自己的操作（suspended）与显示/画笔类编辑（syncSkipEdit）都不记录同步状态：
		// 两者都不改模型结构，记下来只会污染 undo 快照。
		if (this.suspended || syncSkipEdit(aspects)) {
			this.edited_elements = null;
			this.edited_groups = null;
			this.edited_names = null;
			this.edit_links = null;
			this.pre_paths = null;
			this.pre_roots = null;
			this.pre_root_origins = null;
			this.pre_index = null;
			this.created_nodes = null;
			this.pre_snapshots = null;
			this.edit_attrs_linked = true;
			this.edit_group_level = false;
			return;
		}
		if (typeof Group == 'undefined' || !Group.all.length) return;
		this.pre_snapshots = {elements: [], groups: []};
		// aspects 里的数组可能正是「活选区」本身（`mirrorSelected` 传的是 Outliner.selected）。
		// 下面登记对侧节点时不再往这些数组里写，所以不必再换引用：上游存在「initEdit 先传空
		// 数组、之后向同一个数组 push」的用法（元素复制 `Duplicate elements`），换引用会让
		// 那些新节点丢失在 undo 之外（反馈#325：撤销后方块掉回根目录）。
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
		// 反馈#305 复报第 5 轮②：结构编辑（大纲拖放 / Ctrl+G 分组）只登记 outliner，没有
		// elements 列表。此时 undo 的「post 有、pre 没有 → 删除」整段会被跳过，而结构同步又可能
		// 在对侧新建元素（把组外的块拖进复制组）——撤销后这些元素既不在 pre 的 outliner 里、
		// 也不会被摘掉，Outliner.loadJSON 的兜底会把它们挂到根目录变成选不中也删不掉的幽灵。
		// 这里给 pre 侧补一个空的 elements 映射，让撤销按「本条新建的元素」正常回收。
		if (aspects.outliner && !Undo.current_save.elements) {
			Undo.current_save.elements = {};
		}

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
					// 只登记 pre：post 记录留到 finishEdit（那时才确定最终状态），不要往
					// aspects.elements 里写，见 insertElementPreSnapshot 的说明（反馈#325）
					MirrorModeling.insertElementPreSnapshot(counterpart, counterpart.getUndoCopy(aspects));
					this.pre_snapshots?.elements.push(counterpart);
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
					// 快照必须写回真 uuid，否则按 uuid 去重永远不命中，
					// 撤销时野 uuid 快照被当成新组重建、真副本被当多余节点删掉
					let before = counterpart.getChildlessCopy();
					before.uuid = counterpart.uuid;
					MirrorModeling.insertGroupPreSnapshot(before);
					this.pre_snapshots?.groups.push(counterpart);
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
		// 镜像翻转按「选中组的整棵子树」开 undo，子孙块也会进 aspects.elements；
		// 它们只是跟着组一起翻，不能镜像到对侧（复报第 3 轮④）
		let flip_groups = group_flip ? Group.all.filter(group => edited_groups.has(group.uuid)) : [];
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
			this.pre_root_origins = null;
			this.pre_group_transforms = null;
			this.pre_index = null;
			this.created_nodes = null;
			this.pre_snapshots = null;
			this.edit_attrs_linked = true;
			this.edit_group_level = false;
			return;
		}
		let changed = false;

		// 反馈#305 后续①②：gizmo 拖动组节点时 undo aspects 里只有 elements/outliner，没有 groups，
		// 所以组节点的位移要自己比对快照找出来；同时「成员根被移动 + 属性链接断开」要冻结整棵成员。
		let changed_groups = this.changedGroups();
		let frozen_members = this.frozenMembers(changed_groups);

		// 反馈#305 后续③：删除成员根的联动（删除动作会在 finishEdit 前清空 aspects，只能靠快照）
		changed = this.syncMemberDeletions(aspects) || changed;

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
				// 复报第 3 轮④：跟着组一起被翻的块不镜像到对侧（对侧应当完全不动）
				if (flip_groups.length && hasAncestorGroupIn(element, flip_groups)) continue;
				// 复报第 1 点：属性链接断开后，组级编辑（移动/枢轴）连子块的位移也不再映射。
				// 直接编辑组内的块仍然同步（那不是组级编辑）。
				if (!attrs_linked && group_level) continue;
				// 后续②：属性链接断开时移动成员根属于组级操作，整棵成员（含块与子组）都不再映射，
				// 否则对侧的块会单独跑到镜像位置、在没动的组里错位（用户看到的「对面子组跟着动」）。
				let element_root = memberRootOf(element);
				if (element_root && frozen_members.has(element_root.uuid)) continue;
				if (!MirrorModeling.cached_elements[element.uuid]?.smart_pair) continue;
				for (let counterpart of this.equivalents(element)) {
					if (!(counterpart instanceof OutlinerElement) || counterpart === element) continue;
					// 两侧都被用户编辑时各自镜像自己的改动，不再交叉同步（否则会翻两次）
					if (edited_elements.has(counterpart.uuid)) continue;
					MirrorModeling.cached_elements[element.uuid].counterpart = counterpart;
					// 反馈#305 复报第 4 轮④：以两侧成员根的相对位置为镜像基准（断开后一侧被挪走时
					// 不再把对侧的块写到全局镜像位置）；后续③：逐轴判定镜像关系，对角对称两轴一起翻。
					let mirror = pairMirror(element, counterpart);
					MirrorModeling.cached_elements[element.uuid].mirror_axes = mirror.axes;
					MirrorModeling.cached_elements[element.uuid].mirror_centers = mirror.centers;
					MirrorModeling.createClone(element, aspects);
					changed = true;
				}
			}
		}

		if (aspects.groups) {
			for (let group of aspects.groups.slice()) {
				let partners = this.equivalents(group).filter(node => node instanceof Group) as Group[];
				if (!Group.all.includes(group)) {
					// 反馈#305 后续③：删除成员根时只有「初始组」带走其它复制组；
					// 删掉复制出来的成员只删它自己，其余成员保持原样（也不能删掉组内块）
					if (linkId(group)) {
						if (isInitial(group)) {
							for (let partner of partners) {
								if (!Group.all.includes(partner)) continue;
								this.removeSubtreeWithUndo(partner, aspects);
								changed = true;
							}
						}
						continue;
					}
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
				// 只从「用户实际编辑过的组」往外镜像：initEdit 为 undo 注入的对侧副本也在
				// aspects.groups 里，把它们当成源会互相覆盖（三成员链里第二个成员被写成源的值）。
				if (!edited_groups.has(group.uuid)) continue;
				for (let partner of partners) {
					if (edited_groups.has(partner.uuid)) continue;
					// 第 4 点：断开属性链接后位移/旋转/重命名不再映射，组内容仍然同步。
					// 反馈#305 复报第 4 轮③：只有「成员根」受链接状态约束；成员里的子组是内容，
					// 断开链接后调整它仍要同步到对侧子组（否则对面完全不动）。
					let source_link = memberLinkOf(group);
					let partner_link = memberLinkOf(partner);
					if (!source_link || !partner_link || source_link.id !== partner_link.id) continue;
					let source_is_root = memberRootOf(group) === group;
					let partner_is_root = memberRootOf(partner) === partner;
					if ((source_is_root || partner_is_root) && (!source_link.linked || !partner_link.linked)) continue;
					// 反馈#305 后续②：属性链接断开时移动成员根，整棵成员冻结——包括其中的子组。
					// 少了这一条时，成员根被移动后子组仍在 aspects.groups 里，会以「组内内容」
					// 的名义同步到对侧，对侧就成了「根组不动、子组单独飞过去」（复报第 4 轮②）。
					let group_root = memberRootOf(group);
					if (group_root && frozen_members.has(group_root.uuid)) continue;
					let before = partner.getChildlessCopy();
					before.uuid = partner.uuid;
					MirrorModeling.insertGroupIntoUndo(partner, aspects, before);
					mirrorGroupTransform(group, partner, pairMirror(group, partner));
					this.syncName(group, partner, edited_names.get(group.uuid));
					aspects.groups.safePush(partner);
					changed = true;
				}
			}
		}

		// 反馈#305 后续①②：拖动组节点时不经过 aspects.groups（gizmo 直接改 origin），
		// 子组的位移/旋转要按快照比对补同步，否则断开属性链接后对侧只剩块在动、子组不动。
		// 成员根自身仍走上面的组循环（受链接状态约束）。
		if (!group_flip) {
			for (let uuid of changed_groups) {
				let group = OutlinerNode.uuids[uuid] as OutlinerNode | undefined;
				if (!(group instanceof Group) || !isInTree(group)) continue;
				if (this.created_nodes?.has(uuid) || edited_groups.has(uuid)) continue;
				let root = memberRootOf(group);
				if (!root || root === group) continue;
				if (frozen_members.has(root.uuid)) continue;
				for (let partner of this.equivalents(group).filter(node => node instanceof Group) as Group[]) {
					if (!isInTree(partner) || changed_groups.has(partner.uuid) || edited_groups.has(partner.uuid)) continue;
					let before = partner.getChildlessCopy();
					before.uuid = partner.uuid;
					MirrorModeling.insertGroupIntoUndo(partner, aspects, before);
					mirrorGroupTransform(group, partner, pairMirror(group, partner));
					changed = true;
				}
			}
		}

		// 反馈#349：initEdit 写过 pre 快照、且仍然活着的对侧节点，post 里也必须有记录。
		// 删除动作在 finishEdit 之前清空了 aspects 列表，这些节点于是「pre 有、post 没有」，
		// 重做时会被当成待删除节点——幸存组里的块跟着一起消失。
		let pre_snapshots = this.pre_snapshots;
		if (pre_snapshots) {
			for (let element of pre_snapshots.elements) {
				if (isInTree(element) && aspects.elements && !aspects.elements.includes(element)) {
					aspects.elements.safePush(element);
				}
			}
			for (let group of pre_snapshots.groups) {
				if (isInTree(group) && aspects.groups && !aspects.groups.includes(group)) {
					aspects.groups.safePush(group);
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
		this.pre_root_origins = null;
		this.pre_group_transforms = null;
		this.pre_index = null;
		this.created_nodes = null;
		this.pre_snapshots = null;
		this.edit_attrs_linked = true;
		this.edit_group_level = false;
	},

	/**
	 * 反馈#305 后续③：成员根被删除时的联动。
	 * 删除动作会在 finishEdit 之前清空 aspects.elements/groups（outliner.js 的
	 * `recursive_list.empty()`），所以这里同样靠 initEdit 的结构快照判断哪个成员根没了：
	 * - 删的是「初始组」→ 其余复制组成员整棵一起删除；
	 * - 删的是复制成员 → 只删它自己（其余成员与链接原样保留）。
	 */
	syncMemberDeletions(aspects: UndoAspects): boolean {
		if (!this.edit_links) return false;
		let changed = false;
		for (let [id, members] of this.edit_links) {
			let alive = members.filter(member => isInTree(member));
			if (alive.length === members.length) continue;
			let initial = members.find(isInitial) ?? members[0];
			if (!initial || !isInTree(initial)) {
				// 删的是「初始组」→ 其余复制成员的整棵子树一起删除
				for (let partner of alive) {
					this.removeSubtreeWithUndo(partner, aspects);
					changed = true;
				}
				continue;
			}
			// 反馈#349：删掉的是复制成员，而链接里只剩最后一方——它已经没有对侧，
			// 智能复制组身份随之失效，就地解除链接。不解除时 `members()` 只剩它自己，
			// 「取消智能复制组」会因成员不足直接返回，用户永远取消不掉；它的链接 id 还会
			// 留在 undo 的 pre 里，重做时把幸存的那个组一起删掉。
			if (alive.length < 2) {
				for (let survivor of alive) {
					this.unlinkSurvivor(survivor, aspects);
					changed = true;
				}
				Blockbench.showQuickMessage(tl('message.smart_copy.auto_unlinked'), 2500);
			}
		}
		return changed;
	},

	/**
	 * 反馈#349：解除一个已无对侧的成员的链接。
	 * pre 快照必须在清除字段**之前**写入，撤销才能连同链接一起还原；成员同时进 post 的
	 * groups 列表，重做后它也保持「已解除」而不是又带着孤立链接回来。
	 */
	unlinkSurvivor(survivor: Group, aspects: UndoAspects) {
		let before = survivor.getChildlessCopy();
		before.uuid = survivor.uuid;
		MirrorModeling.insertGroupIntoUndo(survivor, aspects, before);
		setLinkId(survivor, '');
		setInitial(survivor, false);
		setAttrsLinked(survivor, true);
	},

	/** 本次编辑里位移/旋转/缩放变过的组（与 initEdit 的快照比对；删除的组不算） */
	changedGroups(): Set<UUID> {
		let changed = new Set<UUID>();
		if (!this.pre_group_transforms) return changed;
		for (let [uuid, before] of this.pre_group_transforms) {
			let node = OutlinerNode.uuids[uuid] as OutlinerNode | undefined;
			if (!(node instanceof Group) || !isInTree(node)) continue;
			let moved = node.origin.some((value, axis) => Math.abs(value - before.origin[axis]) > 1e-6)
				|| node.rotation.some((value, axis) => Math.abs(value - before.rotation[axis]) > 1e-6)
				|| (before.scale && node.scale && node.scale.some((value, axis) => Math.abs(value - before.scale[axis]) > 1e-6));
			if (moved) changed.add(uuid);
		}
		return changed;
	},

	/**
	 * 反馈#305 后续②：属性链接断开时，被移动的成员根属于「组级编辑」，它整棵子树都不参与映射。
	 * 返回这些成员根的 uuid（链接全连着时不冻结，走原有的组级镜像）。
	 */
	frozenMembers(changed_groups: Set<UUID>): Set<UUID> {
		let frozen = new Set<UUID>();
		if (!this.edit_links) return frozen;
		for (let members of this.edit_links.values()) {
			if (members.every(member => attrsLinked(member))) continue;
			for (let member of members) {
				if (changed_groups.has(member.uuid)) frozen.add(member.uuid);
			}
		}
		return frozen;
	},

	/**
	 * 反馈#305 第 6 点 / 后续⑤：改名同步到对侧。
	 * 按「这一对的镜像轴」翻名字：左右对称翻 left↔right、前后对称翻 front↔back，
	 * 对角对称两轴都翻（leftfront↔rightback）。名字里的侧别与成员根的实际相对位置对不上时
	 * （例如左右对称的那对被人改成了 Front…），退回「按名字里的侧别翻转」，保持旧行为。
	 * 两处都对不上（名字里没有侧别字样）时按 Ctrl+D 的唯一命名规则进位（`name2`、`name3`…）。
	 */
	syncName(group: Group, partner: Group, previous?: string) {
		if (previous === undefined || previous === group.name) return;
		let axes = pairMirror(group, partner).axes.filter(axis => nameOnOtherSide(group.name, axis) !== group.name);
		if (!axes.length) {
			let name_axis = sideAxisOf(group.name);
			if (name_axis != null) axes = [name_axis];
		}
		let name = group.name;
		for (let axis of axes) name = nameOnOtherSide(name, axis);
		let taken = new Set(Group.all.filter(node => node !== partner).map(node => node.name.toLowerCase()));
		partner.name = uniqueName(name, taken);
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
// 反馈#305 后续③：链接里最初的成员，删除它才会带走全部复制组
new Property(Group, 'boolean', 'smart_copy_initial', {default: false});
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


