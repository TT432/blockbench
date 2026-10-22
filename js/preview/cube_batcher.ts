// 社区版 cube 静态合批渲染（community_cube_batching，默认开）。
//
// 机制：把全部符合条件的 Cube 按共享材质分桶，顶点用 cube.mesh.matrixWorld
// 烘焙进每材质一个的全局 Mesh（model_3d 空间，跟随 model_3d 变换），模型渲染从
// 每 cube 一个 draw call 降为每材质一个。原 cube mesh 保留在场景树并移到
// SOURCE_LAYER（相机不渲染该层；three.js 的 layers 按对象判定不层级传播，
// outline/grid_box 等子节点留在 layer 0 照常渲染）。射线拾取继续作用于原 mesh
// （raycaster 启用 SOURCE_LAYER），faceIndex/uv/point 语义零改动，无需映射表。
//
// 与 BoneBatcher（bone_batch.js，preview_bone_batching）的关系：本模块是其
// 取代者——BoneBatcher 的共面冲突排除在密集体素模型上会把绝大多数 cube 排除
// 在合批外（6340 cube 模型实测仅 972 入批，仍有 ~3700 draw call）。本模块启用时
// 会压制 BoneBatcher（两个系统同时隐藏 cube 会互相干扰）；本开关关闭时也不恢复
// BoneBatcher，保证「关闭=完全原始渲染路径」。
//
// 材质策略：BB 贴图材质恒为 transparent:true（上游设计），直接合批会丢失逐 cube
// 的 painter 排序。本模块按内容分流——cube 各面 UV 区域内无半透明 texel
// （0<alpha<255）时视为镂空/不透明，批次使用共享的不透明变体材质（clone 共享
// uniforms，transparent:false；shader 对 alpha<0.01 discard）；含半透明 texel 的
// cube 不合批，保持逐 cube 原渲染。贴图像素编辑（refreshTranslucency 清 alpha
// 缓存）或 UV 移入半透明区域会在 watcher 中触发重建重查资格。
//
// 绘制顺序（updateDrawOrder，等价于「按深度分层、层内保序」）：上游把每个 cube 各自
// 放进透明通道，three 的 reversePainterSortStable 按「renderOrder → 相机投影 z 由大到小
// （即由远到近）→ 对象 id」排序；合批后整个批次只画一次，共面/重叠面由索引顺序决定，
// 顺序不同就会在分层衣服这类共面处翻出不同结果（实测 1483 cube 模型 gt32 从 8201 降到
// 3711，关掉深度测试后仅剩 3 像素，即顺序已与上游一致）。这里按同一排序键把每个批次
// 的索引块重排：顶点布局不动，只移动 36 个 index 的块，且只重写序号变化的块。
// 相机矩阵或几何位置不变时不重算；实测静止 0 次重排、绕行时开销在测量噪声内。
// 两点已知边界：① 不同材质的批次之间仍由渲染器按材质排序，上游是跨材质按距离交错；
// ② 顶点在 JS 侧以 float64 变换后写回 float32，与上游在顶点着色器里对
//    view·matrixWorld 做 float32 组合的末位舍入不同，因此共面面片的深度平局偶尔翻面
//    （开深度测试后残余 gt32≈0.1% 像素，关掉深度测试即归零）。
//
// 逐帧 watcher（渲染前执行，静止时 <1ms）：对 Cube.all 逐 cube 对比缓存——
// matrixWorld 16 元素、geometry/index/attribute 引用、attribute version
// （position/normal/uv/highlight）、material 引用、mesh.visible。命中变化的
// 只重烘该 cube 的 24 顶点范围（updateRange 局部上传）；visible 切换把该 cube 的
// 36 个 index 写成退化三角形（全 0）；新增 cube 复用空闲槽位或尾部追加（超容量
// 才重建该 batch）；删除 cube 通过 preview_controller 'remove' 事件释放槽位；
// 材质引用变化/资格变化标脏，同帧末全量重建。
import { THREE } from '../lib/libs';
import { Setting, settings } from '../interface/settings';

const SOURCE_LAYER = 7; // 0-6 已被默认层/侧网格(1-3)/gizmo(4-6) 占用（同 bone_batch）

const VERT_STRIDE = 24;   // cube geometry 固定 24 顶点（BoxGeometry 1x1x1）
const INDEX_STRIDE = 36;  // 6 面 × 2 三角形 × 3 顶点

type CubeMesh = Cube['mesh'];

interface BatchSlot {
	uuid: string
	batch: BatchRecord
	slot_index: number
	// 直接引用缓存：cube.mesh / Cube.all 都是重建型 getter（实测 6340 cube 全取约 4ms），
	// watcher 热路径只允许读 slot 上的缓存引用；对象替换由 undo/setup/remove 事件兜底
	cube: Cube
	mesh: CubeMesh
	mwSrc: ArrayLike<number> // mesh.matrixWorld.elements（数组引用稳定）
	// 缓存引用/版本
	matRef: THREE.Material
	// 合批资格依赖的镂空贴图（材质 transparent:true 但内容仅不透明/镂空）；
	// 非镂空合批（材质本身不透明）为 null。alpha 缓存失效（_has_translucency
	// 被 refreshTranslucency 删除）时 watcher 标脏重建以重跑资格判定。
	cutoutTex: Texture | null
	geoRef: THREE.BufferGeometry
	geoPosRef: THREE.BufferAttribute
	geoNorRef: THREE.BufferAttribute
	geoUvRef: THREE.BufferAttribute
	geoHlRef: THREE.BufferAttribute
	geoIndexRef: THREE.BufferAttribute
	posVer: number
	norVer: number
	uvVer: number
	hlVer: number
	visible: boolean
	flip: boolean
	composedFrame: boolean // 本帧矩阵已被合批遍历重组（需重烘）
	mw: Float64Array // 16, matrixWorld 缓存
	localPos: Float32Array // 72
	localNor: Float32Array // 72
	indexTemplate: ArrayLike<number>
	indexCount: number
	draw_rank: number // 索引块位置 = 绘制顺序里的序号（见 updateDrawOrder）
	draw_z: number // 上一帧相机投影 z（排序键）
	pending_rank: number // 重排时的目标序号（避免交换时互相覆盖）
}

interface DirtyRange {
	min: number
	max: number
}

interface BatchRecord {
	material: THREE.Material
	mesh: THREE.Mesh
	geometry: THREE.BufferGeometry
	slots: (BatchSlot | null)[]
	free: number[]
	usedSlots: number // 高水位（含已释放槽位）
	capacitySlots: number
	draw_count: number // 本帧存活槽位数（updateDrawOrder 内自增）
	posAttr: THREE.BufferAttribute
	norAttr: THREE.BufferAttribute
	uvAttr: THREE.BufferAttribute
	hlAttr: THREE.BufferAttribute
	idxAttr: THREE.BufferAttribute
	posRange: DirtyRange
	norRange: DirtyRange
	uvRange: DirtyRange
	hlRange: DirtyRange
	idxRange: DirtyRange
}

function freshRange(): DirtyRange {
	return {min: Infinity, max: -1};
}

// three 的 geometry.attributes 索引签名是 BufferAttribute | InterleavedBufferAttribute
// 联合；cube 几何体由 Cube.preview_controller.setup 自建，均为普通 BufferAttribute
function getAttr(geometry: THREE.BufferGeometry, name: string): THREE.BufferAttribute {
	const attr = geometry.attributes[name] as THREE.BufferAttribute;
	return attr;
}

function cubeOf(uuid: string): Cube | undefined {
	let node = OutlinerNode.uuids[uuid];
	return node instanceof Cube ? node : undefined;
}

export const CubeBatcher = {
	SOURCE_LAYER,
	enabled: true,
	_initialized: false,
	_bone_suppressed: false,
	_scene_matrices_fresh: false,
	structural_dirty: true,

	batches: new Map<string, BatchRecord>(), // material.uuid -> record
	cube_entry: new Map<string, BatchSlot>(), // cube uuid -> slot
	_slot_list: new Array<BatchSlot>(), // watcher 迭代用（Map 迭代器有额外开销）
	_discovery_pending: true, // setup 事件/数量变化时做一次新 cube 发现扫描
	_last_cube_count: -1,
	_frame_no: 0,
	_group_cache: new Map<string, Float64Array>(), // 组 mesh uuid -> 局部矩阵缓存（内容对比用）
	_transform_dirty: new Set<string>(), // update_transform 事件标记的 cube uuid
	_matrices_tracked: false, // 本帧矩阵由合批遍历更新（可精确追踪重组）；否则用矩阵对比兜底
	element_animated: new Set<string>(),

	// 调试/实测用
	stats: {watch_ms: 0, rebaked: 0, rebuilt: 0, reordered: 0},

	// 镂空贴图 → 不透明变体材质（getBatchMaterial 缓存；贴图对象回收时随 WeakMap 释放）
	_cutout_variants: new WeakMap<Texture, THREE.ShaderMaterial>(),

	// 复用临时对象（重烘内循环零分配）
	_tmpRel: new THREE.Matrix4(),
	_tmpModelInv: new THREE.Matrix4(),
	_tmpM3: new THREE.Matrix3(),
	_tmpProjScreen: new THREE.Matrix4(),
	_tmpVec: new THREE.Vector3(),

	// 绘制顺序（见 updateDrawOrder）：相机/几何变化才重算，顺序不变不重写索引
	_order_dirty: true,
	_order_camera: null as {view: Float64Array, proj: Float64Array} | null,
	_order_scratch: new Array<BatchSlot>(),
	_order_changed: new Array<BatchSlot>(),

	get active(): boolean {
		return this.enabled && this.batches.size > 0;
	},

	eligible(cube: Cube): boolean {
		if (!Project || !(cube instanceof Cube)) return false;
		let mesh = cube.mesh;
		if (!mesh || !mesh.geometry) return false;
		// 只处理当前工程场景树内的 cube（Cube.all 可能短暂混入其他标签页元素）
		if (Project.nodes_3d[cube.uuid] !== mesh) return false;
		// 多材质（逐面不同贴图）不合批
		if (Array.isArray(mesh.material) || !mesh.material) return false;
		if (cube.render_order && cube.render_order !== 'default') return false;
		// 半透明/镂空材质：仅内容可证明无需 painter 排序时可合批（见 getBatchMaterial）
		if (!this.getBatchMaterial(cube)) return false;
		let geo = mesh.geometry;
		let pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
		if (!pos || !nor || !uv || !geo.index || !geo.attributes.highlight) return false;
		if (pos.count !== VERT_STRIDE) return false;
		if (geo.index.count > INDEX_STRIDE) return false;
		return true;
	},

	markStructuralDirty() {
		if (!Project) return;
		this.structural_dirty = true;
	},

	// 合批用材质解析：不透明材质原样返回；BB 贴图材质恒为 transparent:true
	// （上游设计：贴图可能含 alpha），此时仅当该 cube 显示的 texel 全部为
	// 不透明/镂空（无 0<alpha<255）才可合批——批次使用共享的不透明变体
	// （clone + transparent:false + 共享 uniforms；shader 对 alpha<0.01 一律
	// discard，镂空视觉与上游一致，深度/平局裁决与 BoneBatcher 头部注释的
	// 论证相同）。含半透明 texel 的 cube 保持逐 cube 原渲染（painter 排序）。
	getBatchMaterial(cube: Cube): {material: THREE.Material, cutoutTex: Texture | null} | null {
		let mesh = cube.mesh;
		if (!mesh || Array.isArray(mesh.material) || !mesh.material) return null;
		let material = mesh.material as THREE.Material;
		if (!material.transparent) return {material, cutoutTex: null};
		if (typeof Texture === 'undefined' || !Texture.all) return null;
		let tex = Texture.all.find(t => t.material === material);
		if (!tex || typeof tex.elementHasTranslucency !== 'function') return null;
		if (tex.elementHasTranslucency(cube)) return null;
		// 贴图材质是 ShaderMaterial；非 ShaderMaterial 的 transparent 材质不合批
		if (!(material instanceof THREE.ShaderMaterial)) return null;
		let opaque = this._cutout_variants.get(tex);
		if (!opaque) {
			opaque = material.clone();
			opaque.uniforms = material.uniforms; // 共享 uniforms：换贴图/光照/着色即时生效
			opaque.transparent = false;
			opaque.depthWrite = true;
			opaque.needsUpdate = true;
			opaque.name = material.name + '_batch_opaque';
			this._cutout_variants.set(tex, opaque);
		}
		return {material: opaque, cutoutTex: tex};
	},

	// MARK: 槽位操作
	copySlotUV(slot: BatchSlot) {
		if (!slot.mesh.geometry) return;
		let src = getAttr(slot.mesh.geometry, 'uv');
		slot.batch.uvAttr.array.set(src.array.subarray(0, VERT_STRIDE * 2), slot.slot_index * VERT_STRIDE * 2);
		slot.uvVer = src.version;
		this.markRange(slot.batch.uvRange, slot.slot_index * VERT_STRIDE * 2, VERT_STRIDE * 2);
	},

	copySlotHighlight(slot: BatchSlot) {
		if (!slot.mesh.geometry) return;
		let src = getAttr(slot.mesh.geometry, 'highlight');
		slot.batch.hlAttr.array.set(src.array.subarray(0, VERT_STRIDE), slot.slot_index * VERT_STRIDE);
		slot.hlVer = src.version;
		this.markRange(slot.batch.hlRange, slot.slot_index * VERT_STRIDE, VERT_STRIDE);
	},

	// 顶点重烘：局部顶点 × (model_3d⁻¹ · cube.matrixWorld) → model_3d 空间
	bakeSlotVertices(slot: BatchSlot) {
		let mesh = slot.mesh;
		let rel4 = this._tmpRel.multiplyMatrices(this._tmpModelInv, mesh.matrixWorld);
		let rel = rel4.elements;
		let nm = this._tmpM3.getNormalMatrix(rel4).elements;
		let sp = slot.localPos, sn = slot.localNor;
		let batch = slot.batch;
		let dp = batch.posAttr.array, dn = batch.norAttr.array;
		let off = slot.slot_index * VERT_STRIDE * 3;
		for (let i = 0; i < VERT_STRIDE * 3; i += 3) {
			let x = sp[i], y = sp[i + 1], z = sp[i + 2];
			dp[off + i]     = rel[0] * x + rel[4] * y + rel[8] * z + rel[12];
			dp[off + i + 1] = rel[1] * x + rel[5] * y + rel[9] * z + rel[13];
			dp[off + i + 2] = rel[2] * x + rel[6] * y + rel[10] * z + rel[14];
			let nx = sn[i], ny = sn[i + 1], nz = sn[i + 2];
			let tx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
			let ty = nm[1] * nx + nm[4] * ny + nm[7] * nz;
			let tz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
			let il = 1 / Math.sqrt(tx * tx + ty * ty + tz * tz);
			dn[off + i] = tx * il;
			dn[off + i + 1] = ty * il;
			dn[off + i + 2] = tz * il;
		}
		slot.mw.set(slot.mwSrc);
		this.markRange(batch.posRange, off, VERT_STRIDE * 3);
		this.markRange(batch.norRange, off, VERT_STRIDE * 3);
		// 负尺寸 cube（镜像矩阵）翻转三角形环绕方向，保持正面朝向正确
		let flip = rel4.determinant() < 0;
		if (flip !== slot.flip) {
			slot.flip = flip;
			this.writeSlotIndices(slot);
		}
	},

	// 写槽位的 36 个 index：可见按模板（含环绕翻转），隐藏写退化三角形（全 0）。
	// 块位置用 draw_rank（绘制顺序序号）而不是 slot_index：两者只在顺序变化时不同。
	writeSlotIndices(slot: BatchSlot) {
		this.writeSlotIndicesAt(slot, slot.draw_rank);
	},

	writeSlotIndicesAt(slot: BatchSlot, rank: number, mark = true) {
		let batch = slot.batch;
		let dst = batch.idxAttr.array;
		let base = rank * INDEX_STRIDE;
		if (!slot.visible) {
			dst.fill(0, base, base + INDEX_STRIDE);
		} else {
			let t = slot.indexTemplate;
			let vertBase = slot.slot_index * VERT_STRIDE;
			let n = slot.indexCount;
			if (slot.flip) {
				for (let i = 0; i < n; i += 3) {
					dst[base + i] = t[i] + vertBase;
					dst[base + i + 1] = t[i + 2] + vertBase;
					dst[base + i + 2] = t[i + 1] + vertBase;
				}
			} else {
				for (let i = 0; i < n; i++) dst[base + i] = t[i] + vertBase;
			}
			if (n < INDEX_STRIDE) dst.fill(0, base + n, base + INDEX_STRIDE);
		}
		if (mark) this.markRange(batch.idxRange, base, INDEX_STRIDE);
	},

	zeroIndexBlock(batch: BatchRecord, rank: number) {
		let base = rank * INDEX_STRIDE;
		batch.idxAttr.array.fill(0, base, base + INDEX_STRIDE);
		this.markRange(batch.idxRange, base, INDEX_STRIDE);
	},

	/**
	 * 复刻上游（关闭合批）的绘制顺序：每个方块各自进透明通道，three 的 reversePainterSortStable
	 * 按「相机投影 z 由远到近、同 z 按对象 id」排序。合批后整个批次只画一次，共面/重叠面
	 * 由索引顺序决定，顺序不同就会在分层衣服这类共面处翻出不同结果。
	 *
	 * 这里按同一排序键把每个批次的索引块重排（顶点布局不动，只移动 36 个 index 的块），
	 * 于是同一批次内的绘制顺序与上游一致；跨批次（不同材质）仍由渲染器按材质排序，
	 * 与上游跨材质交错的情况仍有偏差（见模块头注释）。
	 *
	 * 只有在相机矩阵或几何位置变化后才重算；顺序没变则不写索引。
	 */
	updateDrawOrder() {
		if (!this.enabled || !this.batches.size) return;
		if (typeof Preview == 'undefined' || !Preview.selected) return;
		let camera = Preview.selected.camera;
		if (!camera) return;
		let view = camera.matrixWorldInverse.elements;
		let proj = camera.projectionMatrix.elements;
		let cache = this._order_camera;
		let need = this._order_dirty || !cache;
		if (!need) {
			for (let i = 0; i < 16; i++) {
				if (cache.view[i] !== view[i] || cache.proj[i] !== proj[i]) { need = true; break; }
			}
		}
		if (!need) return;
		this._order_dirty = false;
		if (!cache) cache = this._order_camera = {view: new Float64Array(16), proj: new Float64Array(16)};
		cache.view.set(view);
		cache.proj.set(proj);

		let slots = this._slot_list;
		let n = slots.length;
		if (!n) return;
		let scratch = this._order_scratch;
		scratch.length = n;
		let proj_screen = this._tmpProjScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		let vec = this._tmpVec;
		for (let i = 0; i < n; i++) {
			let slot = slots[i];
			vec.setFromMatrixPosition(slot.mesh.matrixWorld).applyMatrix4(proj_screen);
			slot.draw_z = vec.z;
			scratch[i] = slot;
		}
		// 与 three 的 reversePainterSortStable 一致：renderOrder → 投影 z 由大到小（越远越大）→ 对象 id。
		// 键值口径：Vector3.applyMatrix4 会做透视除法，因此这里是 NDC z（远=大）。
		scratch.sort((a, b) => (a.mesh.renderOrder - b.mesh.renderOrder)
			|| (b.draw_z - a.draw_z)
			|| (a.mesh.id - b.mesh.id));

		for (let batch of this.batches.values()) batch.draw_count = 0;
		let changed_slots = this._order_changed;
		changed_slots.length = 0;
		for (let i = 0; i < n; i++) {
			let slot = scratch[i];
			let rank = slot.batch.draw_count++;
			slot.pending_rank = rank;
			if (slot.draw_rank !== rank) changed_slots.push(slot);
		}
		// 已释放槽位（删除后留下的尾部块）需要写退化三角形
		let stale = false;
		for (let batch of this.batches.values()) {
			if (batch.draw_count < batch.usedSlots) { stale = true; break; }
		}
		if (!changed_slots.length && !stale) return;

		if (stale) {
			for (let batch of this.batches.values()) {
				let dst = batch.idxAttr.array;
				for (let rank = batch.draw_count; rank < batch.usedSlots; rank++) {
					dst.fill(0, rank * INDEX_STRIDE, (rank + 1) * INDEX_STRIDE);
				}
				if (batch.usedSlots) this.markRange(batch.idxRange, 0, batch.usedSlots * INDEX_STRIDE);
			}
		}
		// 只重写序号变化的槽位（交换位置的两个槽位都变化，因此不会漏写）。
		// 写入内容来自 slot.indexTemplate（JS 数组），与本缓冲区无读写依赖。
		// 变化面较大时把整段索引标脏，省掉上千次 markRange。
		let whole_batch = stale || changed_slots.length * 4 > n;
		for (let slot of changed_slots) slot.draw_rank = slot.pending_rank;
		for (let slot of changed_slots) this.writeSlotIndicesAt(slot, slot.draw_rank, !whole_batch);
		if (whole_batch) {
			for (let batch of this.batches.values()) {
				if (batch.usedSlots) this.markRange(batch.idxRange, 0, batch.usedSlots * INDEX_STRIDE);
			}
		}
		this.stats.reordered++;
	},

	// geometry 整体替换（含 index 重排）：重读局部模板并重烘全部范围
	refreshSlotGeometry(slot: BatchSlot, cube: Cube) {
		let geo = cube.mesh.geometry;
		slot.geoRef = geo;
		slot.geoPosRef = getAttr(geo, 'position');
		slot.geoNorRef = getAttr(geo, 'normal');
		slot.geoUvRef = getAttr(geo, 'uv');
		slot.geoHlRef = getAttr(geo, 'highlight');
		if (!geo.index) return;
		slot.geoIndexRef = geo.index;
		slot.posVer = slot.geoPosRef.version;
		slot.norVer = slot.geoNorRef.version;
		// cube position/normal 属性均为 Float32BufferAttribute（Cube.setup 自建）
		const posArray = slot.geoPosRef.array as Float32Array;
		const norArray = slot.geoNorRef.array as Float32Array;
		slot.localPos = posArray.slice(0, VERT_STRIDE * 3);
		slot.localNor = norArray.slice(0, VERT_STRIDE * 3);
		slot.indexTemplate = geo.index.array.slice(0, geo.index.count);
		slot.indexCount = geo.index.count;
		this.copySlotUV(slot);
		this.copySlotHighlight(slot);
		this.bakeSlotVertices(slot);
		this.writeSlotIndices(slot);
	},

	markRange(range: DirtyRange, start: number, count: number) {
		if (start < range.min) range.min = start;
		if (start + count > range.max) range.max = start + count;
	},

	applyRange(attr: THREE.BufferAttribute, range: DirtyRange) {
		if (range.max < range.min) return;
		attr.updateRange.offset = range.min;
		attr.updateRange.count = range.max - range.min;
		attr.needsUpdate = true;
		range.min = Infinity;
		range.max = -1;
	},

	// 上一帧设置的 updateRange 已在渲染时消费，重置为全量语义（-1）
	resetUpdateRanges() {
		for (let batch of this.batches.values()) {
			batch.posAttr.updateRange.count = -1;
			batch.norAttr.updateRange.count = -1;
			batch.uvAttr.updateRange.count = -1;
			batch.hlAttr.updateRange.count = -1;
			batch.idxAttr.updateRange.count = -1;
		}
	},

	// MARK: 批次构建
	initSlot(batch: BatchRecord, cube: Cube, slot_index: number) {
		let mesh = cube.mesh;
		// eligible() 已排除数组材质与缺属性几何体；getBatchMaterial 保证可解析
		const material = mesh.material as THREE.Material;
		const geometry = mesh.geometry as THREE.BufferGeometry;
		let batch_info = this.getBatchMaterial(cube);
		let slot: BatchSlot = {
			uuid: cube.uuid,
			batch,
			slot_index,
			cube,
			mesh,
			mwSrc: mesh.matrixWorld.elements,
			matRef: material,
			cutoutTex: batch_info ? batch_info.cutoutTex : null,
			geoRef: geometry,
			geoPosRef: null as unknown as THREE.BufferAttribute, // refreshSlotGeometry 立即填充
			geoNorRef: null as unknown as THREE.BufferAttribute,
			geoUvRef: null as unknown as THREE.BufferAttribute,
			geoHlRef: null as unknown as THREE.BufferAttribute,
			geoIndexRef: null as unknown as THREE.BufferAttribute,
			posVer: 0, norVer: 0, uvVer: -1, hlVer: -1,
			visible: mesh.visible !== false,
			flip: false,
			composedFrame: true,
			mw: new Float64Array(16),
			localPos: new Float32Array(0),
			localNor: new Float32Array(0),
			indexTemplate: [],
			indexCount: 0,
			draw_rank: slot_index,
			draw_z: 0,
			pending_rank: slot_index,
		};
		batch.slots[slot_index] = slot;
		this.cube_entry.set(cube.uuid, slot);
		this._slot_list.push(slot);
		mesh.layers.set(SOURCE_LAYER);
		// 合批遍历按 userData 直读槽位（避免每帧 Map 查找）
		mesh.userData.cubeBatchSlot = slot;
		// #83：静态 cube 关闭自动 TRS 重组；被元素级动画直驱的 cube 必须保持自动
		let animated = this.element_animated.has(cube.uuid);
		if (mesh.matrixAutoUpdate !== animated) mesh.matrixAutoUpdate = animated;
		this.refreshSlotGeometry(slot, cube);
	},

	createBatch(material: THREE.Material, capacitySlots: number): BatchRecord {
		let verts = capacitySlots * VERT_STRIDE;
		let positions = new Float32Array(verts * 3);
		let normals = new Float32Array(verts * 3);
		let uvs = new Float32Array(verts * 2);
		let highlights = new Uint8Array(verts);
		let Indices = verts > 65535 ? Uint32Array : Uint16Array;
		let indices = new Indices(capacitySlots * INDEX_STRIDE);

		let geometry = new THREE.BufferGeometry();
		let posAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
		let norAttr = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
		let uvAttr = new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage);
		let hlAttr = new THREE.BufferAttribute(highlights, 1).setUsage(THREE.DynamicDrawUsage);
		let idxAttr = new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute('position', posAttr);
		geometry.setAttribute('normal', norAttr);
		geometry.setAttribute('uv', uvAttr);
		geometry.setAttribute('highlight', hlAttr);
		geometry.setIndex(idxAttr);
		geometry.setDrawRange(0, 0);

		let mesh = new THREE.Mesh(geometry, material);
		mesh.name = 'cube_batch:' + material.uuid;
		mesh.no_export = true;
		mesh.frustumCulled = false; // 单网格含全部 cube，视锥剔除无意义且包围盒需逐帧维护
		Project.model_3d.add(mesh);

		let batch: BatchRecord = {
			material, mesh, geometry,
			slots: new Array(capacitySlots).fill(null),
			free: [],
			usedSlots: 0,
			capacitySlots,
			draw_count: 0,
			posAttr, norAttr, uvAttr, hlAttr, idxAttr,
			posRange: freshRange(), norRange: freshRange(), uvRange: freshRange(),
			hlRange: freshRange(), idxRange: freshRange(),
		};
		this.batches.set(material.uuid, batch);
		return batch;
	},

	disposeBatches(restore_layers = true) {
		for (let batch of this.batches.values()) {
			if (batch.mesh.parent) batch.mesh.parent.remove(batch.mesh);
			batch.geometry.dispose();
		}
		this.batches.clear();
		this._slot_list.length = 0;
		if (restore_layers) {
			for (let slot of this.cube_entry.values()) {
				let mesh = slot.mesh;
				if (mesh) {
					delete mesh.userData.cubeBatchSlot;
					// undo 替换过对象时按 uuid 重查 live mesh
					let node = cubeOf(slot.uuid);
					if (node && node.mesh && node.mesh !== mesh) node.mesh.layers.set(0);
					mesh.layers.set(0);
				}
			}
		}
		this.cube_entry.clear();
	},

	recomputeAnimatedSet() {
		let set = new Set<string>();
		if (typeof Project !== 'undefined' && Project && Project.animations) {
			for (let anim of Project.animations) {
				if (!anim.animators) continue;
				for (let uuid in anim.animators) {
					if (OutlinerNode.uuids[uuid] instanceof Cube) set.add(uuid);
				}
			}
		}
		this.element_animated = set;
	},

	// 全量重建：按场景遍历顺序收集（平局裁决与上游 render list 插入顺序一致）
	rebuild() {
		this.disposeBatches();
		if (!this.enabled || !Project || typeof Outliner === 'undefined') return;

		this.recomputeAnimatedSet();
		let ordered: Cube[] = [];
		Project.model_3d.traverse((obj) => {
			if (obj.isElement && obj.type === 'cube') {
				let node = OutlinerNode.uuids[obj.name];
				if (node instanceof Cube) ordered.push(node);
			}
		});
		let by_material = new Map<string, {material: THREE.Material; cubes: Cube[]}>();
		for (let cube of ordered) {
			let mesh = cube.mesh;
			if (mesh) {
				let animated = this.element_animated.has(cube.uuid);
				if (mesh.matrixAutoUpdate !== animated) mesh.matrixAutoUpdate = animated;
			}
			if (!this.eligible(cube)) {
				if (mesh) mesh.layers.set(0);
				continue;
			}
			// eligible() 已保证可解析出合批材质（原材质或其镂空不透明变体）
			let info = this.getBatchMaterial(cube);
			if (!info) {
				if (mesh) mesh.layers.set(0);
				continue;
			}
			let bucket = by_material.get(info.material.uuid);
			if (!bucket) by_material.set(info.material.uuid, bucket = {material: info.material, cubes: []});
			bucket.cubes.push(cube);
		}
		for (let {material, cubes} of by_material.values()) {
			// 容量预留 25% 头部空间，新增 cube 免重建追加
			let batch = this.createBatch(material, Math.max(16, Math.ceil(cubes.length * 1.25)));
			for (let cube of cubes) {
				this.initSlot(batch, cube, batch.usedSlots++);
			}
			batch.geometry.setDrawRange(0, batch.usedSlots * INDEX_STRIDE);
		}
		this._discovery_pending = false;
		this._order_dirty = true;
		this.stats.rebuilt++;
	},

	// 新增 cube：复用空闲槽位或尾部追加；超容量则标脏重建
	addCube(cube: Cube) {
		let mesh = cube.mesh;
		let info = mesh ? this.getBatchMaterial(cube) : null;
		if (!mesh || !info) {
			// 解析失败说明资格判定依赖的状态与 rebuild 时不同（如贴图 alpha 已变化），重建兜底
			this.structural_dirty = true;
			return;
		}
		let material = info.material;
		let batch = this.batches.get(material.uuid);
		if (!batch || batch.material !== material) {
			batch = this.createBatch(material, 32);
		}
		let slot_index = batch.free.length
			? batch.free.pop() as number // length 已判定非空，pop 必返回值
			: (batch.usedSlots < batch.capacitySlots ? batch.usedSlots++ : -1);
		if (slot_index < 0) {
			this.structural_dirty = true;
			return;
		}
		this.initSlot(batch, cube, slot_index);
		batch.geometry.setDrawRange(0, batch.usedSlots * INDEX_STRIDE);
		this._order_dirty = true;
	},

	// 删除 cube：槽位 index 写退化三角形，槽位进空闲表
	removeCube(uuid: string) {
		let slot = this.cube_entry.get(uuid);
		if (!slot) return;
		slot.visible = false;
		this.writeSlotIndices(slot);
		slot.batch.slots[slot.slot_index] = null;
		slot.batch.free.push(slot.slot_index);
		this.cube_entry.delete(uuid);
		delete slot.mesh.userData.cubeBatchSlot;
		let i = this._slot_list.indexOf(slot);
		if (i >= 0) this._slot_list.splice(i, 1);
		// 存活块要向前压实（尾部块由 updateDrawOrder 写退化）
		this._order_dirty = true;
	},

	// MARK: 逐帧 watcher
	watch() {
		if (!Project || typeof Cube === 'undefined') return;
		let t0 = performance.now();
		this.resetUpdateRanges();

		if (this.structural_dirty) {
			this.structural_dirty = false;
			this.rebuild();
			this._last_cube_count = Cube.all.length;
			this.stats.watch_ms = performance.now() - t0;
			return;
		}
		if (!this.batches.size) return;
		this._frame_no++;

		// 新 cube 发现扫描：setup 事件触发；数量校验每 30 帧一次（Cube.all 是重建型 getter）
		if (this._discovery_pending || (this._frame_no % 30 === 0 && Cube.all.length !== this._last_cube_count)) {
			this._discovery_pending = false;
			this._last_cube_count = Cube.all.length;
			for (let cube of Cube.all) {
				if (!this.cube_entry.has(cube.uuid) && this.eligible(cube)) this.addCube(cube);
			}
		}
		if (this.structural_dirty) {
			this.structural_dirty = false;
			this.rebuild();
			this.stats.watch_ms = performance.now() - t0;
			return;
		}

		// model_3d 逆矩阵：烘到 model_3d 空间（model_3d 自身变换由批次网格继承，无需重烘）
		this._tmpModelInv.copy(Project.model_3d.matrixWorld).invert();

		let rebaked = 0;
		let slots = this._slot_list;
		for (let i = 0; i < slots.length; i++) {
			let slot = slots[i];
			let mesh = slot.mesh;
			let composed = slot.composedFrame;
			slot.composedFrame = false;
			// 材质引用变化（updateFaces / 视图模式切换）、材质失去合批资格
			// （贴图 alpha 缓存失效 = 像素已编辑，需重跑半透明判定）或失去资格：帧末全量重建
			let material = mesh.material;
			let render_order = slot.cube.render_order;
			if (material !== slot.matRef || Array.isArray(material)
				|| (material.transparent === true && (!slot.cutoutTex || slot.cutoutTex._has_translucency === undefined))
				|| (render_order !== undefined && render_order !== 'default')) {
				this.structural_dirty = true;
				continue;
			}
			let geo = mesh.geometry;
			if (geo !== slot.geoRef || geo.index !== slot.geoIndexRef
				|| geo.attributes.position !== slot.geoPosRef || geo.attributes.normal !== slot.geoNorRef
				|| geo.attributes.uv !== slot.geoUvRef || geo.attributes.highlight !== slot.geoHlRef) {
				this.refreshSlotGeometry(slot, slot.cube);
				rebaked++;
				continue;
			}
			if (slot.geoPosRef.version !== slot.posVer || slot.geoNorRef.version !== slot.norVer) {
				// 几何编辑（setShape）：重读局部模板并重烘顶点
				slot.posVer = slot.geoPosRef.version;
				slot.norVer = slot.geoNorRef.version;
				const posArray = slot.geoPosRef.array as Float32Array; // cube 自建属性，见 refreshSlotGeometry
				const norArray = slot.geoNorRef.array as Float32Array;
				slot.localPos = posArray.slice(0, VERT_STRIDE * 3);
				slot.localNor = norArray.slice(0, VERT_STRIDE * 3);
				this.bakeSlotVertices(slot);
				rebaked++;
			} else {
				// 矩阵重烘判定：合批遍历重组标记 / update_transform 事件标记；
				// 动画模式（矩阵由 Animator 全量刷新）退化为 matrixWorld 内容对比
				let changed = composed || this._transform_dirty.has(slot.uuid);
				if (!changed && !this._matrices_tracked) {
					let e = slot.mwSrc, c = slot.mw;
					for (let k = 0; k < 16; k++) {
						if (e[k] !== c[k]) { changed = true; break; }
					}
				}
				if (changed) {
					this.bakeSlotVertices(slot);
					// 位置/姿态变化会改变相机投影 z → 绘制顺序需要重算
					this._order_dirty = true;
					rebaked++;
				}
			}
			if (slot.geoUvRef.version !== slot.uvVer) {
				this.copySlotUV(slot);
				// UV 编辑可能把面移到含半透明 texel 的贴图区域：混合贴图（贴图级有半透明）
				// 需重查元素级资格；纯镂空贴图 fast-path 直接跳过
				if (slot.cutoutTex && slot.cutoutTex.hasTranslucency()
					&& slot.cutoutTex.elementHasTranslucency(slot.cube)) {
					this.structural_dirty = true;
					continue;
				}
			}
			if (slot.geoHlRef.version !== slot.hlVer) this.copySlotHighlight(slot);
			let visible = mesh.visible !== false;
			if (visible !== slot.visible) {
				slot.visible = visible;
				this.writeSlotIndices(slot);
			}
		}

		// 绘制顺序（复刻上游透明通道顺序）：必须在 applyRange 之前重写索引块范围
		this.updateDrawOrder();

		for (let batch of this.batches.values()) {
			this.applyRange(batch.posAttr, batch.posRange);
			this.applyRange(batch.norAttr, batch.norRange);
			this.applyRange(batch.uvAttr, batch.uvRange);
			this.applyRange(batch.hlAttr, batch.hlRange);
			this.applyRange(batch.idxAttr, batch.idxRange);
		}

		if (this.structural_dirty) {
			this.structural_dirty = false;
			this.rebuild();
		}
		this._transform_dirty.clear();
		this.stats.watch_ms = performance.now() - t0;
		this.stats.rebaked = rebaked;
	},

	// MARK: 选择性场景矩阵更新
	// stock scene.updateMatrixWorld 每帧无差别遍历全部 ~13k 节点（含 6340 cube mesh），
	// 实测 ~7ms。这里改为：非模型子树走标准路径；模型子树内组 mesh（matrixAutoUpdate
	// 每帧重组局部矩阵、标志位不可用）按局部矩阵内容对比判定真实变化，未变化的组
	// 整棵子树跳过；合批 cube 仅在父链脏/自身脏/动画直驱时重组并标记 composedFrame。
	// 重组检测由此处唯一负责（渲染器内遍历已被 _scene_matrices_fresh 跳过）。
	groupMatrixChanged(node: THREE.Object3D): boolean {
		let cache = this._group_cache.get(node.uuid);
		let e = node.matrix.elements;
		if (!cache) {
			cache = new Float64Array(16);
			cache.set(e);
			this._group_cache.set(node.uuid, cache);
			return true;
		}
		let changed = false;
		for (let k = 0; k < 16; k++) {
			if (e[k] !== cache[k]) { changed = true; break; }
		}
		if (changed) cache.set(e);
		return changed;
	},

	updateModelNode(node: THREE.Object3D, force: boolean) {
		let is_group = node.isGroup === true || node === Project.model_3d;
		if (node.matrixAutoUpdate) node.updateMatrix();
		let compose: boolean;
		if (force) {
			compose = true;
		} else if (is_group) {
			compose = this.groupMatrixChanged(node);
		} else {
			compose = node.matrixWorldNeedsUpdate;
		}
		if (compose) {
			if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix);
			else node.matrixWorld.copy(node.matrix);
			force = true;
		}
		node.matrixWorldNeedsUpdate = false;
			for (let child of node.children) {
			const slot: BatchSlot | undefined = child.userData.cubeBatchSlot;
			if (slot !== undefined) {
				// 合批 cube：父链未脏且自身局部矩阵未脏且非动画直驱 → 跳过矩阵重组
				if (!force && !child.matrixAutoUpdate && !child.matrixWorldNeedsUpdate) {
					// #138：但子节点不能一起跳——grid_box/outline 等 matrixAutoUpdate=false
					// 的 gizmo 是新建对象（matrixWorldNeedsUpdate=true、matrixWorld 尚为
					// 单位阵），只有这里的选择性遍历能重组它们；随 cube 子树一起跳过会让
					// 像素网格永远停在未旋转的初始姿态（"旋转归零"错位），移动方块
					// （updateTransform 强制级联）才短暂复位。
					for (let grandchild of child.children) this.updateModelNode(grandchild, false);
					continue;
				}
				child.updateMatrixWorld(force);
				slot.composedFrame = true;
			} else {
				this.updateModelNode(child, force);
			}
		}
	},

	updateSceneMatrices() {
		let scene = Canvas.scene;
		let model = Project.model_3d;
		if (scene.matrixAutoUpdate) scene.updateMatrix();
		// #138：必须与渲染器场景级联语义一致——scene 重组后 force=true 会级联到所有
		// 非模型子树。brush_outline 等 gizmo 以 matrixAutoUpdate=false + 直写 matrix
		// 的方式更新（不置 matrixWorldNeedsUpdate），只靠这个级联重组 matrixWorld；
		// 此处若以 force=false 遍历，它们会被永久冻结（笔刷光标消失/线框错位的根因）。
		let force = false;
		if (scene.matrixWorldNeedsUpdate) {
			scene.matrixWorld.copy(scene.matrix);
			scene.matrixWorldNeedsUpdate = false;
			force = true;
		}
		for (let child of scene.children) {
			if (child === model) continue;
			child.updateMatrixWorld(force);
		}
		this.updateModelNode(model, false);
	},

	// MARK: 渲染钩子（Preview.render 每帧调用）
	beforeRender(preview: Preview) {
		this.suppressBoneBatcher();
		if (!this.enabled || !Project || typeof Outliner === 'undefined') return;
		// 射线拾取需命中 SOURCE_LAYER 上的原 cube mesh（相机不渲染该层）
		if (preview.raycaster && !(preview.raycaster.layers.mask & (1 << SOURCE_LAYER))) {
			preview.raycaster.layers.enable(SOURCE_LAYER);
		}
		// 渲染循环里动画先写骨骼局部变换、matrixWorld 由渲染器稍后重组；
		// watcher 的对比/烘焙必须基于本帧矩阵。Animator.preview 已全量刷新过则
		// 走矩阵对比兜底；否则由合批的选择性遍历刷新并精确标记重组的 cube，
		// 同时置标志让 Preview.render 跳过渲染器内的重复 updateMatrixWorld。
		if (typeof Animator !== 'undefined' && Animator._scene_matrices_fresh === true) {
			this._matrices_tracked = false;
		} else {
			this.updateSceneMatrices();
			this._matrices_tracked = true;
			this._scene_matrices_fresh = true;
		}
		this.watch();
	},

	// BoneBatcher 与本模块互斥：两个系统都会隐藏原 cube mesh，同时激活会互相干扰。
	// 本模块启用期间压制 BoneBatcher；本开关关闭后不恢复它（保证「关闭=原始路径」）。
	suppressBoneBatcher() {
		if (this._bone_suppressed) return;
		this._bone_suppressed = true;
		if (typeof BoneBatcher === 'undefined' || !BoneBatcher) return;
		if (BoneBatcher.enabled) BoneBatcher.setEnabled(false);
		let original = BoneBatcher.setEnabled.bind(BoneBatcher);
		BoneBatcher.setEnabled = (value: boolean) => {
			original(!!value && !this.enabled);
		};
	},

	// RenderTargetSnapshot（绘画笔刷 GPU 拾取）用相机渲染场景换取像素：
	// 需要原 cube mesh 暂时回到渲染层、批次网格隐藏，拍完恢复。
	enterPicking() {
		if (!this.active) return;
		for (let batch of this.batches.values()) batch.mesh.visible = false;
		for (let slot of this.cube_entry.values()) {
			let node = cubeOf(slot.uuid);
			if (node && node.mesh) node.mesh.layers.set(0);
		}
	},
	exitPicking() {
		if (!this.active) return;
		for (let batch of this.batches.values()) batch.mesh.visible = true;
		for (let slot of this.cube_entry.values()) {
			let node = cubeOf(slot.uuid);
			if (node && node.mesh) node.mesh.layers.set(SOURCE_LAYER);
		}
	},

	setEnabled(value: boolean) {
		this.enabled = !!value;
		if (this.enabled) {
			this.structural_dirty = true;
			this._order_dirty = true;
		} else {
			this.disposeBatches();
			// #83 配对：元素级动画直驱的 cube 在非合批路径也需要自动矩阵更新
			this.recomputeAnimatedSet();
			if (typeof Project !== 'undefined' && Project && typeof Cube !== 'undefined') {
				for (let cube of Cube.all) {
					if (cube.mesh) cube.mesh.matrixAutoUpdate = this.element_animated.has(cube.uuid);
				}
			}
		}
	},

	reset() {
		// 工程切换/关闭：旧工程 model_3d 常驻内存，必须主动移除并 dispose
		// 代理网格并恢复原 cube 渲染层，否则切回时旧代理滞留场景
		this.disposeBatches();
		this._group_cache.clear();
		this._transform_dirty.clear();
		this.structural_dirty = true;
		this._order_dirty = true;
	},

	init() {
		if (this._initialized) return;
		this._initialized = true;

		// 新建 cube 触发发现扫描（watcher 下一帧入批）；删除 cube 释放槽位
		//（watcher 看不到已离开 Cube.all 的元素）
		Cube.preview_controller.on('setup', () => {
			this._discovery_pending = true;
		});
		Cube.preview_controller.on('remove', (data?: {element?: Cube}) => {
			let uuid = data && data.element && data.element.uuid;
			if (uuid && this.cube_entry.has(uuid)) this.removeCube(uuid);
			else if (!uuid) this.markStructuralDirty();
		});

		// cube 变换事件：编辑侧改 TRS 的可靠信号（合批遍历的重组标记之外兜底，
		// 覆盖工具链在帧中途自行 updateMatrixWorld 导致标志位被提前消费的路径）
		Cube.preview_controller.on('update_transform', (data?: {element?: Cube}) => {
			if (data && data.element) this._transform_dirty.add(data.element.uuid);
		});

		// 撤销/重做会 JSON 深拷贝替换元素对象（引用全部失效），保守全量重建
		Blockbench.on('load_undo_save undo redo', () => {
			this.markStructuralDirty();
		});
		Blockbench.on('finished_edit', () => {
			// 编辑可能新增元素级 animator；几何/材质/显隐由 watcher 覆盖
			this.recomputeAnimatedSet();
		});

		// 工程生命周期
		Blockbench.on('select_project new_project load_project close_project', () => this.reset());
	},
};

CubeBatcher.init();

new Setting('community_cube_batching', {
	category: 'community',
	value: true,
	onChange(value) {
		CubeBatcher.setEnabled(!!value);
	}
});
CubeBatcher.enabled = settings.community_cube_batching.value !== false;

Object.assign(window, { CubeBatcher });
