/**
 * 一键镜像组（反馈 #301）
 *
 * 名称里带左右（left/right）或前后（front/back）标记的组，如果工程里只存在其中一侧，
 * 就按**当前翻转轴面的位置与旋转角**自动生成另一侧的镜像组：
 *
 * 1. 候选检测：对名称做一次侧别翻转（复用 `flipNameOnAxis` 的 left/right、front/back 词表，
 *    含 R/L、rear 等变体），翻不动的组不算候选；对侧名称已被占用的组跳过。
 * 2. 全部候选中，如果一个候选是另一个候选的后代，则只保留最外层——外层复制会带走整棵子树，
 *    子树里的侧别名称在镜像时一并翻转。
 * 3. 操作前弹面板列出将要复制的组（默认全选），取消勾选的组不复制。
 * 4. 确认后对每个候选 `duplicate()` 出副本（与 Ctrl+D 同一条路径，含唯一化命名），
 *    再用 `reflectNodesAboutFlipPlane()` 把副本整体镜像到对侧——该函数与工具栏「翻转」共用
 *    同一套轴面语义，所以倾斜的轴面（反馈#299）同样成立。
 *
 * 整次操作只产生一条 Undo 记录。
 */
import { flipNameOnAxis, reflectNodesAboutFlipPlane } from "./transform";

/** 侧别判定的轴：0 = 左右（X 轴），2 = 前后（Z 轴） */
const SIDE_AXES = [0, 2];

interface MirrorGroupCandidate {
	group: Group,
	axis: number,
	/** 镜像后这一组应有的名字（供面板展示与兜底改名） */
	name: string,
}

/**
 * 求一组名称在另一侧的名字。`flipNameOnAxis` 只依赖 node.name，这里传一个探针对象避免改动真节点。
 * 名称里没有该轴的侧别标记时返回原名。
 */
function nameOnOtherSide(name: string, axis: number): string {
	let probe = {name};
	flipNameOnAxis(probe as OutlinerNode, axis, null);
	return probe.name;
}
/** 按左右、前后的顺序找该组能翻到哪一侧；两侧都有（对侧名称已存在）或没有侧别标记时返回 null */
function getMirrorTarget(group: Group, taken_names: Set<string>) {
	for (let axis of SIDE_AXES) {
		let other = nameOnOtherSide(group.name, axis);
		if (other === group.name) continue;
		if (taken_names.has(other)) return null;
		return {axis, name: other};
	}
	return null;
}
function getMirrorGroupCandidates(): MirrorGroupCandidate[] {
	let taken_names = new Set(Group.all.map(group => group.name));
	let candidates: MirrorGroupCandidate[] = [];
	for (let group of Group.all) {
		let target = getMirrorTarget(group, taken_names);
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
			Undo.initEdit({outliner: true, elements: [], groups: [], selection: true});
			for (let candidate of chosen) {
				if (!candidate.group.parent || !OutlinerNode.uuids[candidate.group.uuid]) continue;
				let copy = candidate.group.duplicate();
				if (!copy) continue;
				let targets = reflectNodesAboutFlipPlane([copy], candidate.axis);
				// 兜底：副本名称里没有可翻转的侧别标记时（名称原样复制），直接用计算好的目标名
				if (copy.name === candidate.group.name) copy.name = candidate.name;
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
