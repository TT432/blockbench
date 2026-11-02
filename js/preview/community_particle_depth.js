/**
 * 反馈 #291：半透明粒子与半透明贴图互相遮挡
 *
 * wintersky 的粒子材质只有 `transparent: true` + `alphaTest: 0.2`，没有关掉深度写入，
 * 于是每个粒子面片都会往深度缓冲写值：
 * - 粒子的半透明圆环/射线（`0.2 <= a < 1` 的部分没被 alphaTest 丢弃）会剔除它后面的半透明
 *   方块 texel，表现为「粒子把方块半透明区域打洞」；
 * - 方块半透明 texel 同样写深度，方块 mesh 的排序键是方块中心，近侧面贴到粒子前面时会把
 *   粒子整片削掉。
 *
 * 这里按材质类型区分深度行为（粒子与方块因此由透明队列的由远到近排序决定叠加关系）：
 * - `particles_alpha` / `particles_opaque`：本质是 cutout（alphaTest 已丢弃空区），保留写深度；
 * - `particles_blend` / `particles_add`：真半透明 / 加法混合，关闭深度写入。
 *
 * 残余：#243 的 `depthWrite = false` 车道只覆盖 render_order 非 default 的元素，default 序列
 * 的半透明方块仍然写深度，因此粒子在玻璃后面时仍会被玻璃面裁掉（不再打洞）。
 */
import Wintersky from 'wintersky';

const TRANSLUCENT_PARTICLE_TYPES = ['particles_blend', 'particles_add'];
const emitter_prototype = Wintersky.Emitter && Wintersky.Emitter.prototype;

if (emitter_prototype && !emitter_prototype.community_particle_depth_patched) {
	emitter_prototype.community_particle_depth_patched = true;
	const original_update_material = emitter_prototype.updateMaterial;
	// Emitter 构造函数末尾与切材质时都会调 updateMaterial，改这里即可覆盖新旧实例
	emitter_prototype.updateMaterial = function (...args) {
		const result = original_update_material.apply(this, args);
		const material_type = this.config && this.config.particle_appearance_material;
		if (this.material) {
			this.material.depthWrite = TRANSLUCENT_PARTICLE_TYPES.includes(material_type) == false;
		}
		return result;
	};
}
