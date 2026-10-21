/*
	动画效果（粒子/音频）文件引用的路径解析（反馈 #190）。

	引用字符串按用户填写的原样保存，取值只有三种：相对路径（相对 bbmodel 所在目录）、
	绝对路径、资产 uuid。需要访问文件系统或资产表时才解析成绝对路径，所以 .bbmodel 里
	存的是可随工程目录移动的相对引用，输入框也不会被改写成绝对路径。

	“相对”完全按操作系统语义判断：Windows 上以单个 `\` 或 `/` 开头（`\x`、`/x`）是
	盘符根目录的绝对路径，不按工程目录解析（与 node 的 path.isAbsolute 一致）。
*/

import { PathModule } from "../native_apis";

// 相对引用的基准目录：工程保存路径优先，其次导出路径。未保存的工程没有基准，返回空字符串。
export function getEffectPathBase() {
	let path = (typeof Project != 'undefined' && Project && (Project.save_path || Project.export_path)) || '';
	return path ? PathModule.dirname(path) : '';
}

// 是否为绝对路径（按操作系统语义，与 PathModule.isAbsolute 一致）
export function isEffectPathAbsolute(ref) {
	return typeof ref == 'string' && PathModule.isAbsolute(ref);
}

// 引用 → 绝对路径。绝对路径、资产 uuid、web 端、未保存工程（无基准）时原样返回。
export function resolveEffectPath(ref) {
	if (!ref || typeof ref != 'string') return ref;
	if (isEffectPathAbsolute(ref) || isUUID(ref) || !isApp) return ref;
	let base = getEffectPathBase();
	if (!base) return ref;
	// 逐段拼接而不是直接 resolve：`.\x`、`sub\x`、`../x` 在任何平台上都按工程目录
	// 相对处理（`.` 与空段丢弃，`..` 由 join 归一）
	let parts = ref.split(/[\\/]+/).filter(part => part && part != '.');
	if (!parts.length) return ref;
	return PathModule.join(base, ...parts);
}

// 资产表/预览查表用的规范引用：同一文件可能被写成不同大小写或分隔符，已加载的资产
// 以资产自身的引用为准（Animator.particle_effects、Timeline.waveforms 都按字符串取键）。
export function effectLookupRef(ref) {
	let resolved = resolveEffectPath(ref);
	if (!resolved || !isApp || isUUID(resolved)) return resolved;
	let asset = (typeof ParticleAsset != 'undefined' && ParticleAsset.fromRef(resolved))
		|| (typeof SoundAsset != 'undefined' && SoundAsset.fromRef(resolved));
	return asset ? asset.getRef() : resolved;
}
