/**
 * 复制骨骼动画时同步 molang 变量名的两位数字后缀（社区版 #136，#338 的「批量复制」复用）
 *
 * 复制出的骨骼名与原名只差末尾数字（createUniqueName 只改末位数字，如 sword1→sword2、
 * sword-1-1→sword-1-2），关键帧里 `v.xxxNN` / `temp.xxxNN` 这种带两位数字后缀的变量名
 * 必须跟着改，否则 N 份副本会全部驱动同一组变量。只动新关键帧（Keyframe 构造已深拷贝），
 * 原骨骼不受影响。
 *
 * 抽成独立模块的原因：Ctrl+D 复制（`outliner.js`）与批量复制（`batch_duplicate.ts`）
 * 走同一套命名口径，两处各写一份必然分叉。
 */

/** 返回被改写的变量引用数量（0 表示没有需要改的） */
export function renameMolangVarSuffixInAnimator(animator, orig_name: string, new_name: string): number {
	function trailingNumbers(name) {
		let match = name.match(/\d+(?:-\d+)*$/);
		return match ? match[0].split('-') : null;
	}
	let orig_nums = trailingNumbers(orig_name);
	let new_nums = trailingNumbers(new_name);
	if (!orig_nums || !new_nums) return 0;
	let idx = -1;
	let len = Math.min(orig_nums.length, new_nums.length);
	for (let i = 0; i < len; i++) {
		if (orig_nums[i] != new_nums[i]) { idx = i; break; }
	}
	if (idx == -1) return 0;
	let old_suffix = orig_nums[idx].padStart(2, '0');
	let new_suffix = new_nums[idx].padStart(2, '0');
	if (old_suffix == new_suffix) return 0;
	// 变量名结尾恰为旧两位后缀、且后缀前一位不是数字（避免误伤 v.xx001）
	let regex = new RegExp(`\\b(v|temp)\\.([A-Za-z_][A-Za-z0-9_]*?)(?<![0-9])${old_suffix}\\b`, 'g');
	let count = 0;
	for (let kf of animator.keyframes) {
		for (let data_point of kf.data_points) {
			for (let axis of ['x', 'y', 'z']) {
				let value = data_point[axis];
				if (typeof value != 'string' || !value.includes(old_suffix)) continue;
				let replaced = value.replace(regex, `$1.$2${new_suffix}`);
				if (replaced != value) {
					data_point[axis] = replaced;
					count++;
				}
			}
		}
	}
	return count;
}
