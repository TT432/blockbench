// 全局合批渲染（方案A v2，见 渲染侧合批优化方案.md）
//
// 机制：把全部符合条件的 Cube 合并为每材质一个的全局 Mesh（顶点为 model_3d 空间，
// 每帧按需从 cube.mesh.matrixWorld 重烘焙），模型渲染从每 cube 一个 draw call
// 降为每材质一个。原 cube mesh 保留在场景树并移到 SOURCE_LAYER（任何相机都不渲染），
// 射线拾取/选择框/gizmo/绘画投影继续作用于原 mesh，语义零改动。
// three.js 的 layers 按对象判定（不层级传播），cube mesh 的子节点
// （outline、grid_box、vertex_points）留在 layer 0 照常渲染。
//
// 为什么不用按骨骼预变换合批（v1）：transparent pass 按对象位置做画家排序，
// 共面叠层（发饰/皮肤贴片）的深度平局由绘制先后决定，按骨骼合批会改变跨骨骼的
// 平局胜负，产生用户可见的稳定差异（实测凋灵娘头部整块贴片翻转）。
// 全局单网格内三角形按场景遍历顺序光栅化，与上游稳定排序的平局裁决一致；
// 非平局由深度缓冲裁决，与绘制顺序无关（贴图 alpha 二值 + depthWrite:true）。
//
// 帧成本：静止（编辑模式空闲/状态机静态姿态快速路径）零重烘焙；
// 播放/编辑拖拽时重烘焙全部合批顶点（~15k 顶点矩阵变换，无分配）。

const SOURCE_LAYER = 7; // 0-6 已被默认层/侧网格(1-3)/gizmo(4-6) 占用

const BoneBatcher = {
	SOURCE_LAYER,
	enabled: true,
	_initialized: false,
	// material_uuid -> {mesh, geometry, cubes: [{uuid, vertex_start, vertex_count, local_pos, local_nor}], material}
	meshes: new Map(),
	// cube_uuid -> {record, vertex_start, vertex_count}
	cube_entry: new Map(),
	// 在任意工程动画中被 BoneAnimator 直接驱动的 cube（永不参与合批，姿态由 mesh 实时决定）
	element_animated: new Set(),
	structural_dirty: true,	// 合并网格结构（cube 集合/局部几何/UV/材质桶）需重建
	rebake_requested: true,	// 顶点位置需重烘焙（骨骼/cube 变换、undo、工程切换后）
	_rebaked_this_frame: -1,

	eligible(cube) {
		if (!(cube instanceof Cube)) return false;
		if (cube.render_order && cube.render_order !== 'default') return false;
		let mesh = cube.mesh;
		if (!mesh || !mesh.geometry) return false;
		// 多材质（逐面不同贴图）暂不合批
		if (Array.isArray(mesh.material)) return false;
		if (!mesh.material) return false;
		// 被动画直接驱动的 cube 姿态逐帧变化，保持独立 mesh
		if (this.element_animated.has(cube.uuid)) return false;
		// 半透明 painter 排序语义：显示半透明 texel 的元素不参与合批。
		// 全局网格按遍历顺序光栅化，虽然平局裁决与上游一致，但半透明像素需要
		// 与背景按远→近混合，单网格无法复现逐 cube 的排序位置。
		let tex = Texture.all && Texture.all.find(t => t.material === mesh.material);
		if (tex && typeof tex.elementHasTranslucency === 'function' && tex.elementHasTranslucency(cube)) return false;
		let geo = mesh.geometry;
		if (!geo.index || !geo.attributes.position || !geo.attributes.normal || !geo.attributes.uv) return false;
		return true;
	},

	markStructuralDirty() {
		if (!window.Project) return;
		this.structural_dirty = true;
		this.rebake_requested = true;
	},

	requestRebake() {
		this.rebake_requested = true;
	},

	// 结构重建：收集可合批 cube（场景遍历顺序，保证平局裁决与上游一致），
	// 提取局部空间顶点数据，按材质桶装配全局网格。
	//
	// 共面冲突排除：精确共面且同向重叠的面片对，上游由逐对象 Float32 变换的
	// 舍入噪声裁决深度胜负，合并网格的 Float64 烘焙路径无法逐比特复现该噪声，
	// 深度胜负会翻转（叠层皮肤/盔甲互换）。这类 cube 对双方都必须保持独立 mesh
	// （上游渲染路径），才能保持逐像素一致。同世界矩阵的重复体两边都是精确平局、
	// 顺序裁决一致，无害。
	_cola_v1: new THREE.Vector3(),
	_cola_v2: new THREE.Vector3(),
	_cola_u: new THREE.Vector3(),
	_cola_n: new THREE.Vector3(),
	_cola_m3: new THREE.Matrix3(),
	detectCoplanarConflicts(candidates) {
		const D_TOL = 5e-4;		// 平面偏移容差（覆盖 f32 光栅化噪声 ~2-3 深度量子）
		const DOT_TOL = 1e-6;	// 法线同向容差
		const OVERLAP_MIN = 5e-4;	// 面片重叠最小边长（排除边缘相触）
		let items = [];
		for (let cube of candidates) {
			let mesh = cube.mesh;
			mesh.updateWorldMatrix(true, false);
			let geo = mesh.geometry;
			geo.computeBoundingBox();
			let box = geo.boundingBox;
			let m = mesh.matrixWorld;
			let nm = this._cola_m3.getNormalMatrix(m);
			let faces = [];
			for (let a = 0; a < 3; a++) {
				let b = (a + 1) % 3, c = (a + 2) % 3;
				for (let side = 0; side < 2; side++) {
					let n = new THREE.Vector3().setComponent(a, side ? 1 : -1).applyMatrix3(nm).normalize();
					let corners = [];
					for (let bi = 0; bi < 2; bi++) for (let ci = 0; ci < 2; ci++) {
						let p = new THREE.Vector3();
						p.setComponent(a, side ? box.max.getComponent(a) : box.min.getComponent(a));
						p.setComponent(b, bi ? box.max.getComponent(b) : box.min.getComponent(b));
						p.setComponent(c, ci ? box.max.getComponent(c) : box.min.getComponent(c));
						corners.push(p.applyMatrix4(m));
					}
					faces.push({n, d: n.dot(corners[0]), corners});
				}
			}
			let aabb = new THREE.Box3();
			for (let f of faces) for (let p of f.corners) aabb.expandByPoint(p);
			items.push({uuid: cube.uuid, faces, aabb, mw: m.elements});
		}
		// x 轴扫描线剪枝
		items.sort((p, q) => p.aabb.min.x - q.aabb.min.x);
		let conflicted = new Set();
		let rectsOverlap = (cornersA, cornersB, n) => {
			let u = this._cola_u.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
			let v = this._cola_v2.crossVectors(n, u);
			let minAu = 1e30, maxAu = -1e30, minAv = 1e30, maxAv = -1e30;
			for (let p of cornersA) {
				let pu = p.dot(u), pv = p.dot(v);
				if (pu < minAu) minAu = pu; if (pu > maxAu) maxAu = pu;
				if (pv < minAv) minAv = pv; if (pv > maxAv) maxAv = pv;
			}
			let minBu = 1e30, maxBu = -1e30, minBv = 1e30, maxBv = -1e30;
			for (let p of cornersB) {
				let pu = p.dot(u), pv = p.dot(v);
				if (pu < minBu) minBu = pu; if (pu > maxBu) maxBu = pu;
				if (pv < minBv) minBv = pv; if (pv > maxBv) maxBv = pv;
			}
			return minAu < maxBu - OVERLAP_MIN && minBu < maxAu - OVERLAP_MIN
				&& minAv < maxBv - OVERLAP_MIN && minBv < maxAv - OVERLAP_MIN;
		};
		for (let i = 0; i < items.length; i++) {
			for (let j = i + 1; j < items.length; j++) {
				if (items[j].aabb.min.x > items[i].aabb.max.x) break;
				if (!items[i].aabb.intersectsBox(items[j].aabb)) continue;
				// 同世界矩阵：两条渲染路径同为精确平局，顺序裁决一致，无害
				if (items[i].mw.every((v, k) => v === items[j].mw[k])) continue;
				let hit = false;
				for (let fa of items[i].faces) {
					for (let fb of items[j].faces) {
						let dot = fa.n.dot(fb.n);
						if (dot < 1 - DOT_TOL) continue; // 反向共面有一侧必被背面剔除
						if (Math.abs(fa.d - fb.d) > D_TOL) continue;
						if (!rectsOverlap(fa.corners, fb.corners, fa.n)) continue;
						hit = true;
						break;
					}
					if (hit) break;
				}
				if (hit) {
					conflicted.add(items[i].uuid);
					conflicted.add(items[j].uuid);
				}
			}
		}
		return conflicted;
	},
	rebuild() {
		for (let record of this.meshes.values()) {
			if (record.mesh.parent) record.mesh.parent.remove(record.mesh);
			record.geometry.dispose();
		}
		this.meshes.clear();
		this.cube_entry.clear();
		if (!this.enabled || !window.Project || !window.Outliner) return;
		this.ensureTexturePatched();

		// 场景遍历顺序 = 上游 render list 插入顺序（平局裁决的依据）
		let ordered = [];
		Project.model_3d.traverse(obj => {
			if (obj.isElement && obj.type === 'cube') {
				let node = OutlinerNode.uuids[obj.name];
				if (node instanceof Cube) ordered.push(node);
			}
		});

		let candidates = [];
		for (let cube of ordered) {
			if (!this.eligible(cube)) {
				if (cube.mesh) cube.mesh.layers.set(0);
				continue;
			}
			if (cube.visibility === false) {
				// 自身隐藏：mesh 已 invisible 且不可见，无需合批；保持 layer 0 无影响
				continue;
			}
			candidates.push(cube);
		}
		// 共面冲突对双方保持独立 mesh（上游逐对象渲染路径，保证逐像素一致）
		let conflicted = candidates.length > 1 ? this.detectCoplanarConflicts(candidates) : new Set();
		this.last_conflicted_count = conflicted.size;
		let by_material = new Map();
		for (let cube of candidates) {
			if (conflicted.has(cube.uuid)) {
				if (cube.mesh) cube.mesh.layers.set(0);
				continue;
			}
			let mat = cube.mesh.material;
			if (!by_material.has(mat.uuid)) by_material.set(mat.uuid, {material: mat, cubes: []});
			by_material.get(mat.uuid).cubes.push(cube);
		}

		for (let {material, cubes} of by_material.values()) {
			if (!cubes.length) continue;
			let vert_total = 0, index_total = 0;
			for (let cube of cubes) {
				vert_total += cube.mesh.geometry.attributes.position.count;
				index_total += cube.mesh.geometry.index.count;
			}
			let positions = new Float32Array(vert_total * 3);
			let normals = new Float32Array(vert_total * 3);
			let uvs = new Float32Array(vert_total * 2);
			let highlights = new Uint8Array(vert_total);
			let indices = vert_total > 65535 ? new Uint32Array(index_total) : new Uint16Array(index_total);
			let cube_entries = [];

			let v_off = 0, i_off = 0;
			for (let cube of cubes) {
				let geo = cube.mesh.geometry;
				let count = geo.attributes.position.count;
				// 局部顶点数据保留引用副本，供每帧重烘焙
				let local_pos = geo.attributes.position.array.slice();
				let local_nor = geo.attributes.normal.array.slice();
				positions.set(local_pos, v_off * 3);
				normals.set(local_nor, v_off * 3);
				uvs.set(geo.attributes.uv.array.slice(0, count * 2), v_off * 2);
				let hl = geo.attributes.highlight;
				if (hl) highlights.fill(hl.array[0], v_off, v_off + count);
				let idx = geo.index;
				for (let i = 0; i < idx.count; i++) {
					indices[i_off + i] = idx.getX(i) + v_off;
				}
			let entry = {record: null, vertex_start: v_off, vertex_count: count, index_start: i_off, index_count: idx.count, local_pos, local_nor, uuid: cube.uuid, mesh_id: cube.mesh.id};
				cube_entries.push(entry);
				this.cube_entry.set(cube.uuid, entry);
				cube.mesh.layers.set(SOURCE_LAYER);
				v_off += count;
				i_off += idx.count;
			}

			let geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
			geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
			geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
			geometry.setAttribute('highlight', new THREE.BufferAttribute(highlights, 1));
			geometry.setIndex(new THREE.BufferAttribute(indices, 1));

			let mesh = new THREE.Mesh(geometry, material);
			mesh.name = 'bone_batch:global:' + material.uuid;
			mesh.no_export = true;
			mesh.frustumCulled = false; // 单网格含全部 cube，视锥剔除无意义且包围盒需逐帧维护
			mesh.renderOrder = -1; // 透明 pass 中最先绘制：后续透明对象（半透明排除项/网格线）深度测试后覆盖，与上游一致
			Project.model_3d.add(mesh);

			let record = {mesh, geometry, cubes: cube_entries, material};
			for (let entry of cube_entries) entry.record = record;
			this.meshes.set(material.uuid, record);
		}
	},

	// 透明材质的画家排序复现：上游按 cube 枢轴的视深 z 远→近绘制，
	// 合并网格内通过重排索引块（每 cube 的索引连续，值不变）复现同一顺序。
	// 近平共面叠层（from==to 的 0.001 薄片）在深度精度下退化为平局，
	// 上游由 z-sort 的对象位置裁决，必须与索引顺序一致，否则整块贴片翻转。
	_sort_z: [],
	_sort_psm: new THREE.Matrix4(),
	_last_sort_cam: new Float64Array(32),	// 必须与 Matrix4.elements 同精度：Float32 截断使缓存永不命中，每帧白排 1ms
	_rebaked_this_render: false,
	sortIndices(camera) {
		// 渲染前 matrixWorldInverse 可能滞后一帧，手动刷新（视图矩阵 = 世界矩阵的逆）
		camera.updateMatrixWorld();
		camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
		// 与渲染器一致的投影视图矩阵：_projScreenMatrix = projection × view
		let psm = this._sort_psm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
		// 缓存键含投影矩阵（zoom/FOV 切换改变 NDC z）
		let cam_key = this._last_sort_cam;
		let same = true;
		for (let i = 0; i < 16; i++) {
			if (cam_key[i] !== camera.projectionMatrix.elements[i] || cam_key[16 + i] !== camera.matrixWorldInverse.elements[i]) { same = false; break; }
		}
		for (let record of this.meshes.values()) {
			if (!record.material.transparent) continue; // 不透明材质由深度缓冲裁决，无需排序
			// 相机未动且本渲染周期未重烘焙时跳过
			if (!this._rebaked_this_render && same) continue;
			let entries = record.cubes;
			let n = entries.length;
			if (this._sort_z.length < n) this._sort_z = new Array(n);
			let zs = this._sort_z;
			let order = new Array(n);
			for (let i = 0; i < n; i++) {
				let cube = OutlinerNode.uuids[entries[i].uuid];
				let e = cube && cube.mesh ? cube.mesh.matrixWorld.elements : null;
				if (e) {
					// 与 Vector3.applyMatrix4(_projScreenMatrix) 相同的运算顺序：Float64 NDC z
					let px = e[12], py = e[13], pz = e[14];
					let w = 1 / (psm[3] * px + psm[7] * py + psm[11] * pz + psm[15]);
					zs[i] = (psm[2] * px + psm[6] * py + psm[10] * pz + psm[14]) * w;
				} else {
					zs[i] = 0;
				}
				order[i] = i;
			}
			// 上游 reversePainterSortStable：z 降序（远先），平局按 mesh.id 升序
			order.sort((a, b) => (zs[b] - zs[a]) || (entries[a].mesh_id - entries[b].mesh_id));
			let index_attr = record.geometry.index;
			let dst = index_attr.array;
			let src = dst.slice(); // 块重排需副本
			let out = 0;
			for (let i = 0; i < n; i++) {
				let entry = entries[order[i]];
				dst.set(src.subarray(entry.index_start, entry.index_start + entry.index_count), out);
				entry.index_start = out; // 块已移动：再次排序必须从当前位置读取，否则按原始偏移错块
				out += entry.index_count;
			}
			index_attr.needsUpdate = true;
		}
		cam_key.set(camera.projectionMatrix.elements);
		cam_key.set(camera.matrixWorldInverse.elements, 16);
	},

	// 顶点重烘焙：局部顶点 × (model_3d⁻¹ · cube.matrixWorld) → model_3d 空间
	_rebake_model_inv: new THREE.Matrix4(),
	_rebake_rel: new THREE.Matrix4(),
	_rebake_normal: new THREE.Matrix3(),
	_rebake_vec: new THREE.Vector3(),
	rebake() {
		if (!this.meshes.size || !window.Project) return;
		// 渲染循环里动画先写骨骼局部变换、matrixWorld 由渲染器稍后重组；
		// 烘焙必须基于本帧矩阵，否则合并网格落后一帧（逐 cube 沿父链刷新，避免全场景 2.8ms 级联）
		Project.model_3d.updateWorldMatrix(true, false);
		this._rebake_model_inv.copy(Project.model_3d.matrixWorld).invert();
		for (let record of this.meshes.values()) {
			let pos_attr = record.geometry.attributes.position;
			let nor_attr = record.geometry.attributes.normal;
			for (let entry of record.cubes) {
				let cube = OutlinerNode.uuids[entry.uuid];
				if (!cube || !cube.mesh) continue;
				cube.mesh.updateWorldMatrix(true, false); // r129 无返回值，不可链式
				let rel = this._rebake_rel.multiplyMatrices(this._rebake_model_inv, cube.mesh.matrixWorld);
				let nm = this._rebake_normal.getNormalMatrix(rel);
				let src_p = entry.local_pos, src_n = entry.local_nor;
				let dst_p = pos_attr.array, dst_n = nor_attr.array;
				let base = entry.vertex_start * 3;
				let v = this._rebake_vec;
				for (let i = 0; i < src_p.length; i += 3) {
					v.set(src_p[i], src_p[i + 1], src_p[i + 2]).applyMatrix4(rel);
					dst_p[base + i] = v.x;
					dst_p[base + i + 1] = v.y;
					dst_p[base + i + 2] = v.z;
					v.set(src_n[i], src_n[i + 1], src_n[i + 2]).applyMatrix3(nm).normalize();
					dst_n[base + i] = v.x;
					dst_n[base + i + 1] = v.y;
					dst_n[base + i + 2] = v.z;
				}
			}
			pos_attr.needsUpdate = true;
			nor_attr.needsUpdate = true;
		}
	},

	mirrorHighlight(cube) {
		let entry = this.cube_entry.get(cube.uuid);
		if (!entry || !entry.record) return;
		let src = cube.mesh.geometry.attributes.highlight;
		if (!src) return;
		let attr = entry.record.geometry.attributes.highlight;
		attr.array.fill(src.array[0], entry.vertex_start, entry.vertex_start + entry.vertex_count);
		attr.needsUpdate = true;
	},

	// 本帧是否需要重烘焙：结构重建后、显式请求后，或动画/状态机可能驱动骨骼时
	needsRebake() {
		if (this.rebake_requested) return true;
		if (!Animator.open) return false;
		// 状态机静态姿态快速路径（_controller_static_pose_clean）命中时骨骼不动
		if (Animator._controller_static_pose_clean) return false;
		if (Timeline.playing) return true;
		let ctrl = AnimationController.selected;
		if (ctrl && ctrl.selected_state && BarItems.animation_controller_preview_mode.value === 'play') return true;
		return false;
	},

	beforeRender(preview) {
		if (!this.enabled || !window.Project || !window.Outliner) return;
		// 射线拾取需命中 SOURCE_LAYER 上的原 cube mesh（相机不渲染该层）。
		// 原 render_frame 全局监听已移除（破坏静态姿态快速路径基线），改在渲染钩子内补启用。
		if (preview.raycaster && !(preview.raycaster.layers.mask & (1 << SOURCE_LAYER))) {
			preview.raycaster.layers.enable(SOURCE_LAYER);
		}
		this._rebaked_this_render = false;
		let frame = Blockbench.LAST_FRAME_ID = (Blockbench.LAST_FRAME_ID || 0) + 1;
		let first_render_this_frame = this._rebaked_this_frame !== frame;
		if (first_render_this_frame) {
			if (this.structural_dirty) {
				this.structural_dirty = false;
				this.recomputeAnimatedSetQuiet();
				this.rebuild();
			}
			if (this.needsRebake()) {
				this.rebake();
				this.rebake_requested = false;
				this._rebaked_this_frame = frame;
				this._rebaked_this_render = true;
			}
		}
		// 透明材质每渲染调用按当前相机重排索引（不同预览相机各自排序）
		if (preview && preview.camera) this.sortIndices(preview.camera);
	},
	recomputeAnimatedSetQuiet() {
		// rebuild 前的资格集合刷新（recomputeAnimatedSet 会标脏，此处内联避免循环）
		let set = new Set();
		if (Project.animations) {
			for (let anim of Project.animations) {
				if (!anim.animators) continue;
				for (let uuid in anim.animators) {
					let node = OutlinerNode.uuids[uuid];
					if (node instanceof Cube) set.add(uuid);
				}
			}
		}
		this.element_animated = set;
	},

	setEnabled(value) {
		this.enabled = !!value;
		if (!this.enabled) {
			for (let record of this.meshes.values()) {
				if (record.mesh.parent) record.mesh.parent.remove(record.mesh);
				record.geometry.dispose();
				for (let entry of record.cubes) {
					let node = OutlinerNode.uuids[entry.uuid];
					if (node instanceof Cube && node.mesh) node.mesh.layers.set(0);
				}
			}
			this.meshes.clear();
			this.cube_entry.clear();
			this.structural_dirty = true;
		} else {
			this.markStructuralDirty();
		}
	},

	reset() {
		// 工程切换/关闭：旧工程的 model_3d 不会被销毁（标签页常驻内存），
		// 必须主动移除并 dispose 代理网格——否则切回时 rebuild 新建一套，
		// 旧代理成为孤儿滞留场景，模型渲染双份（不可选中、不可编辑）
		for (let record of this.meshes.values()) {
			if (record.mesh.parent) record.mesh.parent.remove(record.mesh);
			record.geometry.dispose();
		}
		this.meshes.clear();
		this.cube_entry.clear();
		this.element_animated.clear();
		this.structural_dirty = true;
		this.rebake_requested = true;
	},

	init() {
		if (this._initialized) return;
		this._initialized = true;

		// 结构脏化钩子：几何/UV/面/可见性/增删/渲染顺序变化
		let ctrl = Cube.preview_controller;
		ctrl.on('setup', () => this.markStructuralDirty());
		ctrl.on('remove', () => this.markStructuralDirty());
		ctrl.on('update_visibility', () => this.markStructuralDirty());
		ctrl.on('update_all', () => this.markStructuralDirty());
		// 变换只影响顶点位置，重烘焙即可（无需结构重建）
		ctrl.on('update_transform', () => this.requestRebake());
		for (let key of ['updateGeometry', 'updateUV', 'updateFaces', 'updateRenderOrder']) {
			let original = ctrl[key];
			if (typeof original !== 'function') continue;
			ctrl[key] = (element, ...args) => {
				let result = original.call(ctrl, element, ...args);
				this.markStructuralDirty();
				return result;
			};
		}
		let original_highlight = ctrl.updateHighlight;
		ctrl.updateHighlight = (element, ...args) => {
			let result = original_highlight && original_highlight.call(ctrl, element, ...args);
			this.mirrorHighlight(element);
			return result;
		};
		// 骨骼变换驱动 cube 世界矩阵 → 重烘焙
		Group.preview_controller.on('update_transform', () => this.requestRebake());

		// 工程生命周期
		Blockbench.on('select_project new_project load_project close_project', () => this.reset());
		Blockbench.on('load_undo_save undo redo', () => {
			this.markStructuralDirty();
		});
		Blockbench.on('finished_edit', () => {
			// 编辑可能新增元素级 animator 或改变几何，保守重建
			this.markStructuralDirty();
		});

		// 渲染前钩子：结构重建 + 顶点重烘焙（所有预览共享，每帧至多一次）
		let original_render = Preview.prototype.render;
		Preview.prototype.render = function(...args) {
			BoneBatcher.beforeRender(this);
			return original_render.apply(this, args);
		};

	},

	// 贴图像素变化会改变元素的半透明分类（elementHasTranslucency），
	// refreshTranslucency 只刷新 render_order 元素，合批侧需要重建以重跑资格判定。
	// Texture 模块在 main.ts 中晚于本模块加载，故补丁延迟到首次 rebuild 时打。
	ensureTexturePatched() {
		if (this._texture_patched || typeof Texture === 'undefined') return;
		this._texture_patched = true;
		let original_refresh = Texture.prototype.refreshTranslucency;
		Texture.prototype.refreshTranslucency = function(...args) {
			let result = original_refresh.apply(this, args);
			BoneBatcher.markStructuralDirty();
			return result;
		};
	}
};

// 急切初始化：render_frame 监听器会破坏静态姿态快速路径的插件监听基线
// （canReuseStaticControllerPose 要求 render_frame 监听数为 0），故不用事件触发。
BoneBatcher.init();

new Setting('preview_bone_batching', {
	category: 'preview',
	value: true,
	onChange(value) {
		BoneBatcher.init();
		BoneBatcher.setEnabled(value);
	}
});

export { BoneBatcher, SOURCE_LAYER };
Object.assign(window, { BoneBatcher });
