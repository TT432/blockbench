/**
 * 批量复制（反馈 #338）
 *
 * 顶部「编辑」菜单里的「批量复制」按钮：对当前选中的块/组（含组里的定位器）一次性复制
 * 「复制数量」份结构，并可把副本上对应的动画帧按「偏移距离」逐份错开，用于一次生成
 * Wave1…WaveN 这种序列。
 *
 * 命名口径（用户决策）：
 * - 组与定位器：名字末尾的数字 + 本次序号（`Wave1` → `Wave2`、`Wave-1-1` → `Wave-1-2`）；
 *   名字没有数字时在末尾补序号（`Wave` → `Wave1`、`Wave2`）。`1` 起始，不再沿用
 *   `createUniqueName` 的「从 2 起」。
 * - 块等其它元素：只改已有末尾数字（`cube1` → `cube2`/`cube3`），没有数字时不追加，
 *   保持 Ctrl+D 复制对块名的既有处理。
 * - 名字冲突时仍走 `createUniqueName` 进位兜底，不产生重名。
 *
 * 动画：
 * - 只处理真正含源骨骼关键帧的动画（与 Ctrl+D 一致），一个动画都不需要时不动动画数据。
 * - 第 i 份副本的关键帧时间 = 原时间 + i × 偏移距离 ÷ 该动画的吸附帧率（`animation.snapping`），
 *   「相对上一份再偏一个偏移距离」因此等价于按序号累加。偏移结果小于 0 时按 0 处理。
 * - 打开「复制骨骼时同步更新 molang 变量名后缀」时，副本关键帧里的 `v.xxxNN` / `temp.xxxNN`
 *   与原版 Ctrl+D 走同一个函数（`molang_var_suffix.ts`）做后缀递增。
 *
 * 整次操作为一条 Undo 记录；副本在层级里按序号顺序紧跟在源节点之后，并成为新的选中项。
 */
import { renameMolangVarSuffixInAnimator } from "./molang_var_suffix";
import { BBAnimation } from "../animations/animation";

/** 名字末尾的数字段（`Wave1` → `1`，`Wave-1-1` → 最后一段 `1`） */
const TRAILING_NUMBER = /\d+$/;

/** 组/定位器：末尾数字 + 序号；没有数字就直接补序号（`Wave` → `Wave1`） */
function numberedName(name: string, index: number): string {
	let match = name.match(TRAILING_NUMBER);
	if (!match) return name + index;
	let number = parseInt(match[0], 10) + index;
	return name.slice(0, name.length - match[0].length) + number;
}
/** 块等元素：只改已有末尾数字，没有数字时返回 null（沿用 duplicate() 的结果） */
function numberedNameIfNumbered(name: string, index: number): string | null {
	let match = name.match(TRAILING_NUMBER);
	if (!match) return null;
	let number = parseInt(match[0], 10) + index;
	return name.slice(0, name.length - match[0].length) + number;
}

interface CopyPair {
	/** 源节点 uuid——Undo 快照会替换数组内对象，动画复制阶段一律按 uuid 重查 */
	source_uuid: string
	copy_uuid: string
}
interface CopyPlan {
	/** 本份副本的序号（1 起），同时是动画帧的偏移倍数 */
	index: number
	copy: OutlinerNode
	pairs: CopyPair[]
}

/** 深度优先遍历节点自身与全部后代（`forEachChild` 在 TS 侧没有声明，这里自带一个） */
function forEachNode(node: OutlinerNode, callback: (node: OutlinerNode) => void) {
	callback(node);
	for (let child of node.children ?? []) forEachNode(child, callback);
}

function hasSelectedAncestor(node: OutlinerNode): boolean {
	let parent: OutlinerNode | 'root' | undefined = node.parent;
	while (parent && parent !== 'root') {
		if (parent.selected) return true;
		parent = parent.parent;
	}
	return false;
}
/** 选中的最外层节点；组与元素混选时，后代不再单独复制（外层复制会带走整棵子树） */
function getSelectionRoots(): OutlinerNode[] {
	let roots: OutlinerNode[] = [];
	for (let group of Group.selected) roots.safePush(group as OutlinerNode);
	for (let element of Outliner.selected) roots.safePush(element as OutlinerNode);
	return roots.filter(node => !hasSelectedAncestor(node));
}

/**
 * 配对源树与副本树的同名节点并改名。`duplicate()` 已经把整棵子树复制好了（顺序不变），
 * 这里只做「按子节点下标并行下钻 + 改名」，**不再复制**——再调一次 duplicate 会把每个
 * 子节点各多复制一份。
 */
function renameCopyTree(source: OutlinerNode, copy: OutlinerNode, index: number, pairs: CopyPair[]) {
	pairs.push({source_uuid: source.uuid, copy_uuid: copy.uuid});
	if (source instanceof Group || source instanceof Locator) {
		// 组与定位器按「末尾数字 + 序号」重排；没有数字时补序号（Wave → Wave1）
		copy.name = numberedName(source.name, index);
		if (Condition(copy.getTypeBehavior('unique_name'))) copy.createUniqueName();
	} else {
		// 块等其它元素只在名字本来就带数字时跟着序号走，没有数字时沿用 duplicate() 的结果
		let numbered = numberedNameIfNumbered(source.name, index);
		if (numbered) copy.name = numbered;
	}
	let source_children = source.children ?? [];
	let copy_children = copy.children ?? [];
	let length = Math.min(source_children.length, copy_children.length);
	for (let i = 0; i < length; i++) {
		renameCopyTree(source_children[i], copy_children[i], index, pairs);
	}
}

/** 复制一份结构（含子树），并按序号改名；返回副本根节点 */
function duplicateWithNumbering(source: OutlinerNode, index: number, pairs: CopyPair[]): OutlinerNode | undefined {
	let copy = source.duplicate();
	if (!copy) return;
	renameCopyTree(source, copy, index, pairs);
	return copy;
}

/** 真正含源骨骼关键帧的动画（与 Ctrl+D 的 `affected_anims` 同一条判据） */
function getAffectedAnimations(uuids: string[]): BBAnimation[] {
	return BBAnimation.all.filter(animation => {
		return uuids.some(uuid => {
			let animator = animation.animators[uuid];
			return animator && animator.keyframes.length;
		});
	});
}

/** 把每份副本的骨骼动画抄进受影响的动画，按序号偏移时间；返回被改写的 molang 引用数 */
function copyAnimations(plans: CopyPlan[], affected_animations: BBAnimation[], offset_frames: number): number {
	let renamed_molang = 0;
	for (let animation of affected_animations) {
		let fps = Math.clamp(animation.snapping || Number(settings.animation_snap.value) || 24, 1, 120);
		for (let plan of plans) {
			let shift = offset_frames ? (plan.index * offset_frames) / fps : 0;
			for (let pair of plan.pairs) {
				let original_animator = animation.animators[pair.source_uuid];
				let copy_node = OutlinerNode.uuids[pair.copy_uuid];
				if (!original_animator || !original_animator.keyframes.length || !copy_node) continue;
				let new_animator = animation.getBoneAnimator(copy_node);
				if (!new_animator) continue;
				new_animator.extend(original_animator);
				for (let keyframe of original_animator.keyframes) {
					new_animator.addKeyframe(shift
						? {...keyframe, time: Math.max(0, keyframe.time + shift)}
						: keyframe
					);
				}
				if (settings.community_duplicate_bone_var_suffix?.value) {
					let source_node = OutlinerNode.uuids[pair.source_uuid];
					if (source_node) {
						renamed_molang += renameMolangVarSuffixInAnimator(new_animator, source_node.name, copy_node.name);
					}
				}
			}
		}
		animation.setLength();
	}
	return renamed_molang;
}

export function batchDuplicateSelection(count: number, offset_frames: number) {
	let roots = getSelectionRoots();
	if (!roots.length) return;
	count = Math.clamp(Math.round(count) || 1, 1, 100);
	offset_frames = Math.round(offset_frames) || 0;
	// 受影响的动画在改结构前按源 uuid 采好，Undo 快照要带上它们
	let source_uuids: string[] = [];
	roots.forEach(root => forEachNode(root, node => source_uuids.push(node.uuid)));
	let affected_animations = getAffectedAnimations(source_uuids);

	let created_elements: OutlinerElement[] = [];
	let created_groups: Group[] = [];
	Undo.initEdit({
		outliner: true,
		elements: created_elements,
		groups: created_groups,
		selection: true,
		animations: affected_animations,
	});

	let plans: CopyPlan[] = [];
	let copies: OutlinerNode[] = [];
	for (let root of roots) {
		if (!OutlinerNode.uuids[root.uuid]) continue;
		let root_copies: OutlinerNode[] = [];
		for (let index = 1; index <= count; index++) {
			let pairs: CopyPair[] = [];
			let copy = duplicateWithNumbering(root, index, pairs);
			if (!copy) continue;
			plans.push({index, copy, pairs});
			root_copies.push(copy);
			copies.push(copy);
			if (copy instanceof Group) created_groups.push(copy);
			else if (copy instanceof OutlinerElement) created_elements.push(copy);
			forEachNode(copy, child => {
				if (child === copy) return;
				if (child instanceof Group) created_groups.push(child);
				else if (child instanceof OutlinerElement) created_elements.push(child);
			});
		}
		// duplicate() 每次插在源节点之后，逐份复制会得到「倒序」；这里按序号把副本依次排回去
		for (let i = 1; i < root_copies.length; i++) {
			root_copies[i].sortInBefore(root_copies[i - 1], 1);
		}
	}

	if (!copies.length) {
		Undo.cancelEdit();
		return;
	}

	Group.multi_selected.empty();
	copies.forEach(copy => {
		if (copy instanceof Group) copy.multiSelect();
		else copy.markAsSelected();
	});
	updateSelection();

	let renamed_molang = copyAnimations(plans, affected_animations, offset_frames);

	Undo.finishEdit('Batch duplicate', {
		outliner: true,
		elements: created_elements,
		groups: created_groups,
		selection: true,
		animations: affected_animations,
	});
	Blockbench.showQuickMessage(tl('message.batch_duplicate.done', [copies.length]), 2500);
	if (renamed_molang) {
		Blockbench.showQuickMessage(tl('message.duplicate_bone_var_suffix_updated', [renamed_molang]));
	}
}

function showBatchDuplicateDialog() {
	let roots = getSelectionRoots();
	if (!roots.length) return;
	// 名字示例用最外层第一个节点，让用户在确认前看到编号走向
	let sample = roots[0].name;
	let sample_next = (roots[0] instanceof Group || roots[0] instanceof Locator)
		? numberedName(sample, 1)
		: (numberedNameIfNumbered(sample, 1) ?? sample);
	new Dialog('batch_duplicate', {
		title: 'action.batch_duplicate',
		width: 420,
		lines: [tl('dialog.batch_duplicate.hint', [roots.length, sample, sample_next])],
		form: {
			count: {label: 'dialog.batch_duplicate.count', type: 'number', value: 1, min: 1, max: 100, step: 1},
			offset: {label: 'dialog.batch_duplicate.offset', type: 'number', value: 0, min: -1000, max: 1000, step: 1},
		},
		onConfirm(result) {
			if (!result) return;
			batchDuplicateSelection(Number(result.count) || 1, Number(result.offset) || 0);
		},
	}).show();
}

BARS.defineActions(() => {
	new Action('batch_duplicate', {
		name: 'action.batch_duplicate',
		description: 'action.batch_duplicate.desc',
		icon: 'content_copy',
		category: 'edit',
		condition: () => Modes.edit && !Dialog.open && !!(Group.selected.length || Outliner.selected.length),
		click() {
			showBatchDuplicateDialog();
		},
	});
});
