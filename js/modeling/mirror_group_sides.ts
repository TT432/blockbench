/**
 * 一键镜像组（反馈 #301）
 *
 * 名称里带左右（left/right）或前后（front/back）标记的组，如果工程里只存在其中一侧，
 * 就按**当前翻转轴面的位置与旋转角**自动生成另一侧的镜像组：
 *
 * 1. 候选检测：对名称做一次侧别翻转（复用 `flipNameOnAxis` 的 left/right、front/back 词表，
 *    含 R/L、rear 等变体），翻不动的组不算候选；对侧已经有对应组（含只差末尾编号的副本）的组跳过。
 * 2. 全部候选中，如果一个候选是另一个候选的后代，则只保留最外层——外层复制会带走整棵子树，
 *    子树里的侧别名称在镜像时一并翻转。
 * 3. 操作前弹面板列出将要复制的组（默认全选），取消勾选的组不复制。
 * 4. 确认后对每个候选 `duplicate()` 出副本（与 Ctrl+D 同一条路径），
 *    再用 `reflectNodesAboutFlipPlane()` 把副本整体镜像到对侧——该函数与工具栏「翻转」共用
 *    同一套轴面语义，所以倾斜的轴面（反馈#299）同样成立。
 * 5. 副本的名字由本模块按「源名侧别翻转 + 保留末尾编号」统一改写（反馈#310），
 *    不再沿用复制/镜像过程中的临时编号，因此不会出现 `rightfoot3` 这种没有前序编号的跳号。
 *
 * 整次操作只产生一条 Undo 记录。
 */
import { reflectNodesAboutFlipPlane } from "./transform";
import { SIDE_AXES, nameOnOtherSide, pairingStem, uniqueName } from "./mirror_naming";

interface MirrorGroupCandidate {
	group: Group,
	axis: number,
	/** 镜像后这一组应有的名字（供面板展示与兜底改名） */
	name: string,
}

/**
 * 该组在 axis 上是否已经有对应的一侧（只差末尾编号也算）。
 * 反馈#310：按完整名称比对时，重复复制/翻转留下的 `left_finger1_2` 与 `right_finger1_2`、
 * 或历史错误命名产生的 `right_finger1_` 互相认不出，于是同一条手臂被反复复制出来；
 * 归一化键 = 去掉末尾编号，三者在这条判据下都是同一对。
 */
function hasCounterpart(group: Group, axis: number, groups: Group[]): boolean {
	let key = pairingStem(nameOnOtherSide(group.name, axis));
	return groups.some(other => other !== group && pairingStem(other.name) === key);
}
/** 按左右、前后的顺序找该组能翻到哪一侧；已有对侧或没有侧别标记时返回 null */
function getMirrorTarget(group: Group, groups: Group[]) {
	for (let axis of SIDE_AXES) {
		let other = nameOnOtherSide(group.name, axis);
		if (other === group.name) continue;
		if (hasCounterpart(group, axis, groups)) return null;
		return {axis, name: other};
	}
	return null;
}
/**
 * 反馈#310：副本按「正常的复制 + 翻转」定名——源名称侧别翻转、保留末尾编号，撞名才进位。
 * 源与副本子树结构一一对应（`duplicate()` 按原顺序挂子节点），按下标并行遍历。
 */
function renameMirroredCopy(source: OutlinerNode, copy: OutlinerNode, axis: number, taken: Set<string>) {
	let desired = nameOnOtherSide(source.name, axis);
	if (copy instanceof Group) {
		if (desired !== source.name) {
			copy.name = uniqueName(desired, taken);
			taken.add(copy.name.toLowerCase());
		}
		if (source instanceof Group) {
			for (let i = 0; i < copy.children.length; i++) {
				let source_child = source.children[i];
				if (source_child) renameMirroredCopy(source_child, copy.children[i], axis, taken);
			}
		}
	} else if (desired !== source.name) {
		// 块/元素不参与唯一命名（与 Ctrl+D 一致）：对侧同名是常态，不做进位
		copy.name = desired;
	}
}
function getMirrorGroupCandidates(): MirrorGroupCandidate[] {
	let groups = Group.all.slice();
	let candidates: MirrorGroupCandidate[] = [];
	for (let group of groups) {
		let target = getMirrorTarget(group, groups);
		if (target) candidates.push({group, axis: target.axis, name: target.name});
	}
	// 外层候选会把后代一起复制并翻转名称，后代候选不再单独列出
	return candidates.filter(candidate => !candidates.some(other => {
		if (other === candidate) return false;
		return typeof candidate.group.isChildOf == 'function' && candidate.group.isChildOf(other.group, 128);
	}));
}
/**
 * 反馈#301：确认面板——列出将要复制出来的镜像组，默认全选。
 */
function showMirrorGroupSidesDialog(candidates: MirrorGroupCandidate[]) {
	let form = {};
	candidates.forEach((candidate, index) => {
		form['group_' + index] = {
			label: `${candidate.group.name} → ${candidate.name}`,
			type: 'checkbox',
			value: true,
		};
	});
	new Dialog('mirror_group_sides', {
		title: 'action.mirror_group_sides',
		width: 420,
		lines: [tl('dialog.mirror_group_sides.hint', [candidates.length])],
		form,
		onConfirm(result) {
			if (!result) return;
			let chosen = candidates.filter((candidate, index) => result['group_' + index]);
			if (!chosen.length) return;
			let created_groups: Group[] = [];
			let created_elements: OutlinerElement[] = [];
			// 反馈#310：唯一命名的占用表在复制前采样（副本的临时编号不参与），
			// 副本名字统一由 renameMirroredCopy 按「侧别翻转 + 保留编号」重写
			let taken = new Set(Group.all.map(group => group.name.toLowerCase()));
			Undo.initEdit({outliner: true, elements: [], groups: [], selection: true});
			for (let candidate of chosen) {
				if (!candidate.group.parent || !OutlinerNode.uuids[candidate.group.uuid]) continue;
				let copy = candidate.group.duplicate();
				if (!copy) continue;
				let targets = reflectNodesAboutFlipPlane([copy], candidate.axis);
				renameMirroredCopy(candidate.group, copy, candidate.axis, taken);
				created_groups.push(...targets.groups);
				created_elements.push(...targets.elements);
			}
			if (!created_groups.length) {
				Undo.cancelEdit();
				return;
			}
			Undo.finishEdit('Mirror groups', {
				outliner: true,
				elements: created_elements,
				groups: created_groups,
				selection: true,
			});
			updateSelection();
			Blockbench.showQuickMessage(tl('message.mirror_group_sides.done', [chosen.length]), 2500);
		},
	}).show();
}

BARS.defineActions(() => {
	new Action('mirror_group_sides', {
		name: 'action.mirror_group_sides',
		description: 'action.mirror_group_sides.desc',
		icon: 'flip',
		category: 'edit',
		condition: () => Modes.edit,
		click() {
			let candidates = getMirrorGroupCandidates();
			if (!candidates.length) {
				Blockbench.showQuickMessage(tl('message.mirror_group_sides.empty'), 2500);
				return;
			}
			showMirrorGroupSidesDialog(candidates);
		},
	});
});
