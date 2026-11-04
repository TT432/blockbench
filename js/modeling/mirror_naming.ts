/**
 * 镜像命名的共用规则（反馈 #301 / #305 / #310）
 *
 * 侧别翻转（left/right、front/back、R/L、rear 等变体，词表在 `flipNameOnAxis` 里）与
 * 「唯一命名」进位规则抽到这里，供「一键镜像组」（mirror_group_sides）与
 * 「智能复制组」（smart_copy_group）共用，避免两条路径各写一套、命名口径分叉。
 */
import { flipNameOnAxis } from "./transform";

/** 侧别判定的轴：0 = 左右（X 轴），2 = 前后（Z 轴） */
export const SIDE_AXES = [0, 2];

/** 名称末尾的编号（`_2`、` 2`、`2`） */
export const SUFFIX_PATTERN = /[_\s]?\d+$/;

/**
 * 求一组名称在另一侧的名字。
 * 反馈#310：末尾编号先剥下来、翻转后原样拼回——`flipNameOnAxis` 在不传 `original_name`
 * 时会把结尾的 `2` 当成复制编号删掉（`left_finger1_2` → `right_finger1_`），
 * 复制链里的编号一丢，对侧检测和面板展示就都对不上。
 */
export function nameOnOtherSide(name: string, axis: number): string {
	let base = name;
	let suffix = '';
	let match = name.match(SUFFIX_PATTERN);
	if (match) {
		base = name.slice(0, name.length - match[0].length);
		suffix = match[0];
	}
	let probe = {name: base};
	flipNameOnAxis(probe as OutlinerNode, axis, null, base);
	return probe.name + suffix;
}

/** 名字里带哪一轴的侧别标记；两侧都对不上时返回 null（翻转不会改名） */
export function sideAxisOf(name: string): number | null {
	for (let axis of SIDE_AXES) {
		if (nameOnOtherSide(name, axis) !== name) return axis;
	}
	return null;
}

/** 与 `OutlinerNode.createUniqueName` 同一套进位规则（去掉末尾数字后按 2、3、4… 试） */
export function uniqueName(desired: string, taken: Set<string>): string {
	if (!taken.has(desired.toLowerCase())) return desired;
	let zero_based = /[^\d]0$/.test(desired);
	let stem = desired.replace(/\d+$/, '').replace(/\s+/g, '_');
	for (let num = zero_based ? 1 : 2; num < 8e3; num++) {
		if (!taken.has((stem + num).toLowerCase())) return stem + num;
	}
	return desired;
}

/**
 * 成对判定用的归一化键：反复剥掉末尾的分隔符与数字。
 * 反馈#310：复制/翻转历史上留下过 `left_finger1_2` 与 `right_finger1_`（末尾的 `2` 被
 * `flipNameOnAxis` 的复制编号规则吞掉）两种写法，只剥一层的规则认不出它们是同一对，
 * 于是同一条手臂会被反复复制出来。
 */
export function pairingStem(name: string): string {
	let current = name.toLowerCase();
	let previous;
	do {
		previous = current;
		current = current.replace(/[_\s]+$/, '').replace(/\d+$/, '');
	} while (current !== previous);
	return current;
}
