import { Canvas } from "../preview/canvas";
import { autoFixMeshEdit } from "./mesh/auto_fix";
import { getGroupTransferOriginUndoNodes } from "./transform";

// 反馈#228：相交点捕捉相关常量。
// 顶点位置量化与交点去重共用 1e-4 容差：公差更大时大坐标/带小数的方块顶点会因浮点误差
// 不归并（同一条棱被拆成两条半棱，交点算不出来）；公差更小时同一位置的重复顶点分不开。
const INTERSECTION_EPSILON = 1e-4;
const INTERSECTION_EPSILON_SQ = INTERSECTION_EPSILON * INTERSECTION_EPSILON;
// 相邻两面法线夹角大于约 1° 才算特征棱；同一面上两个三角形（法线相同）之间的对角线被滤掉
const FEATURE_EDGE_COS_THRESHOLD = Math.cos(Math.PI / 180);
const FEATURE_EDGE_MAX_COUNT = 8192;	// 单元素特征棱上限（复杂导入网格的防护）
const FEATURE_EDGE_CACHE_SIZE = 512;	// 特征棱缓存的最大元素数，超出按插入顺序淘汰
const FEATURE_EDGE_CACHE_BUDGET = 65536;	// 缓存内棱数总预算（约 3MB），超出同样按插入顺序淘汰
const INTERSECTION_MAX_POINTS = 256;	// 单元素追加的交点上限
const INTERSECTION_MAX_RAYS = 8192;		// 单次调用的射线上限（线段正反两向各计一条）
// 反馈#327：单元素最多追加多少个像素网格交叉点。像素网格每面 (uv 像素数+1)^2 个交点，
// 正常 16×16 的面约 289 个；纹理很大或 UV 跨很多格时数量会爆炸，超过上限整体跳过。
const PIXEL_GRID_MAX_POINTS = 4096;

// 反馈#323：旋转模式的「对齐」与「自动缩放至顶点」记住上次使用的值，下次捕捉后面板按上次预选。
// 只是界面记忆、不是工程数据，因此写 localStorage 而不进设置项/工程文件。忽略轴不记忆（保持每次默认全不忽略）。
const ROTATE_OPTIONS_STORAGE_KEY = 'community_vertex_snap_rotate_options';
const ROTATE_ALIGN_OPTIONS = ['longest', 'direction', 'x', 'y', 'z'];
function loadRotateOptions() {
	let saved = {};
	try {
		saved = JSON.parse(localStorage.getItem(ROTATE_OPTIONS_STORAGE_KEY)) || {};
	} catch (err) {
		saved = {};
	}
	return {
		align: ROTATE_ALIGN_OPTIONS.includes(saved.align) ? saved.align : 'longest',
		// 反馈#323：自动缩放至顶点是独立开关（不再是对齐方式的一项），默认值取上次使用时的值
		auto_scale: saved.auto_scale === true,
	};
}
function saveRotateOptions(form) {
	try {
		localStorage.setItem(ROTATE_OPTIONS_STORAGE_KEY, JSON.stringify({
			align: form.align,
			auto_scale: !!form.auto_scale,
		}));
	} catch (err) {}
}
// 反馈#323：抓到的顶点在方块 8 个角里属于哪些轴的 from / to（与缩放模式同一张表）。
// 1 = 该轴用 to（正侧），0 = 用 from（负侧）。
const CORNER_AXIS_MAP = [[1,1,1],[1,1,0],[1,0,1],[1,0,0],[0,1,0],[0,1,1],[0,0,0],[0,0,1]];

/**
 * 反馈#346：把已选中组的枢轴点整体平移一段世界位移（「顶点捕捉时组枢轴点跟随」）。
 *
 * 元素与组的坐标都是绝对存储的（骨骼格式下子节点由自身 origin 定位，mesh 局部坐标按父组
 * origin 反算），所以只改组的 origin 不会带动内容——平移元素的是调用方，这里只负责让枢轴点
 * 跟着走，两边都是同一段位移，枢轴点相对内容的偏移因此保持不变。
 *
 * 世界位移 → 存储坐标的换算与 snap() 里「移动枢轴点」分支（transferOrigin）完全同一套：
 * 先按 mesh 父级的逆变换取父空间坐标，父节点用绝对位置存法时再加回父 origin。
 * 两阶段执行（先全部算好新值再写入）：同时选中父子组时，先改父组 origin 会让子组的
 * mesh 世界坐标带上这段位移，逐个写入会算成两段。
 */
function translateGroupPivots(world_delta, ignore_axis) {
	let targets = [];
	Vertexsnap.groups.forEach((group) => {
		if (!group.mesh) return;
		group.mesh.updateWorldMatrix(true, false);
		let vec = group.mesh.getWorldPosition(new THREE.Vector3()).add(world_delta);
		if (group.mesh.parent) {
			group.mesh.parent.updateWorldMatrix(true, false);
			group.mesh.parent.worldToLocal(vec);
		} else {
			vec.sub(Canvas.scene.position);
		}
		if (group.parent instanceof OutlinerNode && group.parent.getTypeBehavior('use_absolute_position')) {
			vec.x += group.parent.origin[0];
			vec.y += group.parent.origin[1];
			vec.z += group.parent.origin[2];
		}
		targets.push([group, clampIgnoredAxes(vec, group, ignore_axis)]);
	});
	targets.forEach(([group, vec]) => {
		group.origin.V3_set(vec);
	});
}

/**
 * 反馈#350：把被忽略的轴固定回节点当前的 origin 坐标，只让其余轴跟随目标点/位移。
 * `vec` 与 `node.origin` 处在同一坐标系（父空间；父节点用绝对位置时已加回父 origin）。
 */
function clampIgnoredAxes(vec, node, ignore_axis) {
	let array = vec.toArray ? vec.toArray() : vec;
	if (!ignore_axis || !Array.isArray(node.origin)) return array;
	['x', 'y', 'z'].forEach((axis, i) => {
		if (ignore_axis[axis]) array[i] = node.origin[i];
	});
	return array;
}

export const Vertexsnap = {
	step1: true,
	vertex_gizmos: new THREE.Object3D(),
	line: new THREE.Line(new THREE.BufferGeometry(), Canvas.outlineMaterial),
	elements_with_vertex_gizmos: [],
	// 反馈#228：元素 uuid → {key, edges, box}，特征棱提取结果（见 getFeatureEdges）
	feature_edge_cache: new Map(),
	feature_edge_cache_edges: 0,
	hovering: false,
	addVertices(element) {
		if (Vertexsnap.elements_with_vertex_gizmos.includes(element)) return;
		if (element.visibility === false) return;
		let {mesh} = element;

		Interface.preview.removeEventListener("mousemove", Vertexsnap.hoverCanvas)
		Interface.preview.addEventListener("mousemove", Vertexsnap.hoverCanvas)

		if (!mesh.vertex_points) {
			mesh.updateMatrixWorld()
			let vectors = [];

			if (mesh.geometry) {
				let positions = mesh.geometry.attributes.position.array;

				// If this is a spline, we need to merge the path geo into 
				// positions, so we can snap to the start or end of the spline.
				if (element instanceof SplineMesh) {
					let mesh_position = positions.slice();			
					let path_positions = mesh.pathLine.geometry.attributes.position.array;

					positions = new Float32Array(mesh_position.length + path_positions.length);
					positions.set(mesh_position);
					positions.set(path_positions, mesh_position.length);
				} else if (positions.length && (positions.length % 3) == 0) {
					for (let i = 0; i < positions.length; i += 3) {
						let vec = [positions[i], positions[i+1], positions[i+2]];
						if (!vectors.find(vec2 => vec.equals(vec2))) {
							vectors.push(vec);
						}
					}
				}
			}
			vectors.push([0, 0, 0]);
			Vertexsnap.addIntersectionVertices(element, vectors);
			Vertexsnap.addPixelGridVertices(element, vectors);
			
			let points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial().copy(Canvas.meshVertexMaterial));
			points.element_uuid = element.uuid;
			points.vertices = vectors;
			let vector_positions = [];
			vectors.forEach(vector => vector_positions.push(...vector));
			let vector_colors = [];
			vectors.forEach(vector => vector_colors.push(gizmo_colors.grid.r, gizmo_colors.grid.g, gizmo_colors.grid.b));
			points.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vector_positions), 3));
			points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(vector_colors), 3));
			points.material.transparent = true;
			mesh.vertex_points = points;
			if (mesh.outline) {
				mesh.outline.add(points);
			} else {
				mesh.add(points);
			}
		} else {
			element.preview_controller.updateGeometry(element);
		}
		mesh.vertex_points.visible = true;
		mesh.vertex_points.renderOrder = 900;
		
		Vertexsnap.elements_with_vertex_gizmos.push(element)
	},
	/**
	 * 反馈#228：提取元素的「特征棱」并缓存。
	 *
	 * 旧实现拿 geometry.boundingBox 的 12 条棱当投射源：只有「局部包围盒就是本体」的几何
	 * 才碰巧正确（未改动的方块）。顶点里已经烘进旋转的自定义网格（Mesh 元素、切刀或绕轴
	 * 旋转后的几何）得到的却是包住它的大盒子棱，棱不贴着真实表面，交线端点因此错位或缺失。
	 * 这里改为从三角形索引反推实棱：顶点位置量化到 1e-4 后建「棱 → 相邻面法线」表，只保留
	 * 相邻两面法线夹角大于阈值（约 1°）的棱，以及只接一个三角形的边界棱。方块因此恰好得到
	 * 12 条实棱，同一面上两个三角形之间的面对角线（法线相同）被过滤掉，不会产生伪候选。
	 *
	 * 缓存按元素 uuid 保存，key 含 position/index 的属性对象引用与 version、count，
	 * 几何编辑（Cube.setShape、Mesh 重建属性等）后自动重建；
	 * 元素移除后的条目由 FEATURE_EDGE_CACHE_SIZE / FEATURE_EDGE_CACHE_BUDGET 按插入顺序淘汰。
	 *
	 * @returns {{key: string, geometry: THREE.BufferGeometry, edges: number[], box: THREE.Box3}|null}
	 *   edges 每 6 个数一条棱（起点 xyz、终点 xyz），坐标是 element.mesh 的局部坐标
	 */
	getFeatureEdges(element) {
		let mesh = element.mesh;
		let geometry = mesh?.geometry;
		let position = geometry?.attributes?.position;
		if (!position) return null;

		let index = geometry.index;
		let cache = Vertexsnap.feature_edge_cache;
		// 反馈#253：方块（Cube）不走三角形反推。Cube 的位置属性始终是完整的 8 角盒
		// （updateFaces 只重设 index，不改 position），删掉的面只是少了三角形；从三角形反推
		// 会在相邻两面同时被删时丢掉这两面的公用棱（该棱已无相邻三角形可判夹角），实测
		// 六面完整 12 条 → 删两面 11 条。改用局部包围盒的 12 条棱即为真实棱。
		let box_bounds = (element instanceof Cube && geometry.boundingBox) ? geometry.boundingBox : null;
		// 缓存 key = 属性对象引用 + version/count。几何编辑要么换掉 position/index 属性对象
		// （Mesh.updateGeometry 每次都 new BufferAttribute，version 仍会重置为 0），要么就地
		// 改写数组。注意 THREE.BufferGeometry.prototype.setShape（Cube 缩放/移动）只置
		// needsUpdate、不 bump position.version，命中盒子路径时把包围盒数值并入 key，
		// 否则方块改尺寸后仍返回旧棱。
		let cache_key = [
			position.version,
			position.count,
			index ? index.count : -1,
			index ? index.version : 0,
		].join(':');
		if (box_bounds) {
			cache_key += '|' + box_bounds.min.toArray().join(',') + '|' + box_bounds.max.toArray().join(',');
		}
		let cached = cache.get(element.uuid);
		if (cached
			&& cached.geometry === geometry
			&& cached.position_attribute === position
			&& cached.index_attribute === index
			&& cached.key === cache_key) {
			return cached;
		}

		if (box_bounds) {
			return Vertexsnap.storeFeatureEdges(element, {
				key: cache_key,
				geometry,
				position_attribute: position,
				index_attribute: index,
				edges: Vertexsnap.getBoxEdges(box_bounds),
				box: box_bounds.clone(),
				box_is_box: true,
			});
		}

		let edge_map = new Map();
		let array = position.array;
		let triangle_count = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
		let pa = new THREE.Vector3();
		let pb = new THREE.Vector3();
		let pc = new THREE.Vector3();
		let ab = new THREE.Vector3();
		let ac = new THREE.Vector3();
		let normal = new THREE.Vector3();
		let corner_pos = [0, 0, 0, 0, 0, 0, 0, 0, 0];
		let corner_key = ['', '', ''];

		for (let t = 0; t < triangle_count; t++) {
			for (let c = 0; c < 3; c++) {
				let vertex = index ? index.getX(t*3 + c) : t*3 + c;
				let offset = vertex*3;
				corner_pos[c*3] = array[offset];
				corner_pos[c*3 + 1] = array[offset + 1];
				corner_pos[c*3 + 2] = array[offset + 2];
				corner_key[c] = [
					Math.round(corner_pos[c*3] / INTERSECTION_EPSILON),
					Math.round(corner_pos[c*3 + 1] / INTERSECTION_EPSILON),
					Math.round(corner_pos[c*3 + 2] / INTERSECTION_EPSILON),
				].join(',');
			}
			pa.fromArray(corner_pos, 0);
			pb.fromArray(corner_pos, 3);
			pc.fromArray(corner_pos, 6);
			normal.copy(ab.subVectors(pb, pa)).cross(ac.subVectors(pc, pa));
			let normal_length = normal.length();
			if (normal_length < 1e-12) continue; // 退化三角形
			normal.divideScalar(normal_length);

			// 三条边各自记下本三角形法线；量化后的顶点 key 排序后作为无向边的 key，
			// key 用字符串比较取最小者，保证正反两个三角形得到同一个 key
			for (let c = 0; c < 3; c++) {
				let next = c === 2 ? 0 : c + 1;
				let key = corner_key[c] < corner_key[next]
					? corner_key[c] + '|' + corner_key[next]
					: corner_key[next] + '|' + corner_key[c];
				let edge = edge_map.get(key);
				if (!edge) {
					edge = {
						a: [corner_pos[c*3], corner_pos[c*3 + 1], corner_pos[c*3 + 2]],
						b: [corner_pos[next*3], corner_pos[next*3 + 1], corner_pos[next*3 + 2]],
						normals: [],
					};
					edge_map.set(key, edge);
				}
				edge.normals.push(normal.x, normal.y, normal.z);
			}
		}

		let edges = [];
		let box = new THREE.Box3();
		for (let edge of edge_map.values()) {
			if (edges.length >= FEATURE_EDGE_MAX_COUNT*6) break;
			let normals = edge.normals;
			// 只接一个三角形的棱是边界棱（开放网格/面被隐藏），保留
			let feature = normals.length <= 3;
			for (let i = 0; i < normals.length && !feature; i += 3) {
				for (let j = i + 3; j < normals.length; j += 3) {
					let dot = normals[i]*normals[j] + normals[i+1]*normals[j+1] + normals[i+2]*normals[j+2];
					if (dot < FEATURE_EDGE_COS_THRESHOLD) {
						feature = true;
						break;
					}
				}
			}
			if (!feature) continue;
			edges.push(edge.a[0], edge.a[1], edge.a[2], edge.b[0], edge.b[1], edge.b[2]);
			box.expandByPoint(pa.fromArray(edge.a));
			box.expandByPoint(pb.fromArray(edge.b));
		}

		return Vertexsnap.storeFeatureEdges(element, {
			key: cache_key,
			geometry,
			position_attribute: position,
			index_attribute: index,
			edges,
			box,
			box_is_box: false,
		});
	},
	/**
	 * 反馈#253：局部包围盒的 12 条棱（每 6 个数一条，起点 xyz、终点 xyz）。
	 */
	getBoxEdges(box_bounds) {
		let x0 = box_bounds.min.x, y0 = box_bounds.min.y, z0 = box_bounds.min.z;
		let x1 = box_bounds.max.x, y1 = box_bounds.max.y, z1 = box_bounds.max.z;
		return [
			x0, y0, z0, x1, y0, z0,
			x1, y0, z0, x1, y0, z1,
			x1, y0, z1, x0, y0, z1,
			x0, y0, z1, x0, y0, z0,
			x0, y1, z0, x1, y1, z0,
			x1, y1, z0, x1, y1, z1,
			x1, y1, z1, x0, y1, z1,
			x0, y1, z1, x0, y1, z0,
			x0, y0, z0, x0, y1, z0,
			x1, y0, z0, x1, y1, z0,
			x1, y0, z1, x1, y1, z1,
			x0, y0, z1, x0, y1, z1,
		];
	},
	/**
	 * 把特征棱结果写入缓存。重新插入放到 Map 末尾（近似 LRU），并维护棱数总预算。
	 */
	storeFeatureEdges(element, result) {
		let cache = Vertexsnap.feature_edge_cache;
		let previous = cache.get(element.uuid);
		if (previous) Vertexsnap.feature_edge_cache_edges -= previous.edges.length / 6;
		cache.delete(element.uuid);
		cache.set(element.uuid, result);
		Vertexsnap.feature_edge_cache_edges += result.edges.length / 6;
		while (cache.size > 1 && (cache.size > FEATURE_EDGE_CACHE_SIZE || Vertexsnap.feature_edge_cache_edges > FEATURE_EDGE_CACHE_BUDGET)) {
			let oldest_uuid = cache.keys().next().value;
			Vertexsnap.feature_edge_cache_edges -= cache.get(oldest_uuid).edges.length / 6;
			cache.delete(oldest_uuid);
		}
		return result;
	},
	/**
	 * 反馈#228：特征棱的世界空间包围盒（元素对预筛用）。局部盒子转世界后仍取轴对齐包围盒，
	 * 是特征棱的保守超集，用作预筛不会漏掉真正相交的元素。
	 */
	getFeatureEdgesWorldBox(data, mesh) {
		return data.box.clone().applyMatrix4(mesh.matrixWorld);
	},
	/**
	 * 反馈#228（测试回赠：相交点显示不全）：把当前元素与其它可见、未锁定元素的相交点
	 * 追加为捕捉候选。追加坐标是 element.mesh 的局部坐标（与 mesh.geometry 顶点同一坐标系），
	 * 因此与已有角点共用同一个 vectors 数组、同一个 position 属性顺序。
	 *
	 * 双向投射（旧实现只做 A 向，其它块的棱穿过本块表面产生的交点全丢）：
	 *  A 向：本元素特征棱（世界空间线段）→ 其它元素 mesh；
	 *  B 向：其它元素特征棱（世界空间线段）→ 本元素 mesh。
	 * 每条线段再正反各投一次：材质多为 FrontSide，射线从背面接近表面时会被背面剔除，
	 * 只投单向同样会漏点。
	 *
	 * 复杂度：元素对先用几何包围盒的世界空间 AABB 做第一层预筛（不取特征棱，O(元素数) 的纯盒子比较），
	 * 通过后再用特征棱世界包围盒做第二层预筛，最后才逐线段 raycast；
	 * 单元素最多追加 256 个交点、单次调用最多 8192 条射线。
	 *
	 * 反馈#329（大模型上相交点完全不出现）：旧实现按「元素总数 > 512 就整体跳过」兜底，
	 * 逐元素取特征棱在那之前已经发生，几百个块的角色模型（元素数普遍上千）因此静默失去整个功能——
	 * 帮助文档里承诺的「相交点可捕捉」在这类模型上完全不成立。现在改成先用几何包围盒预筛，
	 * 大模型下只有真正与本块包围盒重叠的少数元素才会走到特征棱/射线路径，整体开销与元素总数近似线性且非常数因子极小。
	 *
	 * 反馈#253（删面后交点缺失）：方块元素的命中目标换成局部包围盒（见 cast_segment_box），
	 * 不再用 mesh 三角形。删面只是从 index 里去掉三角形，盒面本身与描边仍在，
	 * 因此被删面上的交点不再丢失；顺带不再受材质背面剔除影响。
	 */
	addIntersectionVertices(element, vectors) {
		if (typeof settings === 'undefined' || !settings.community_vertex_snap_intersections?.value) return;
		if (typeof Toolbox !== 'undefined' && Toolbox.selected?.id !== 'vertex_snap_tool') return;
		if (typeof Outliner === 'undefined') return;

		let mesh = element.mesh;
		let own = Vertexsnap.getFeatureEdges(element);
		if (!own || !own.edges.length) return;
		mesh.updateMatrixWorld();
		let own_box = Vertexsnap.getFeatureEdgesWorldBox(own, mesh);

		// 元素对预筛（两层）：
		// 1) 几何包围盒的世界 AABB——不取特征棱，元素再多也只是纯盒子比较，
		//    因此无需按元素总数整体跳过（反馈#329）；
		// 2) 特征棱世界包围盒——几何盒是它的超集，取到特征棱后再精筛一次。
		let candidates = [];
		let geometry_box = new THREE.Box3();
		for (let other of Outliner.elements) {
			if (other === element || other.visibility === false || other.locked === true) continue;
			let other_mesh = other.mesh;
			let other_geometry = other_mesh?.geometry;
			if (!other_geometry?.attributes?.position) continue;
			other_mesh.updateMatrixWorld();
			if (!other_geometry.boundingBox) other_geometry.computeBoundingBox();
			if (!other_geometry.boundingBox) continue;
			geometry_box.copy(other_geometry.boundingBox).applyMatrix4(other_mesh.matrixWorld);
			if (!own_box.intersectsBox(geometry_box)) continue;
			let other_edges = Vertexsnap.getFeatureEdges(other);
			if (!other_edges || !other_edges.edges.length) continue;
			if (!own_box.intersectsBox(Vertexsnap.getFeatureEdgesWorldBox(other_edges, other_mesh))) continue;
			candidates.push({
				mesh: other_mesh,
				edges: other_edges.edges,
				// 反馈#253：方块用局部包围盒当命中目标（见 cast_segment_box）
				box: other_edges.box_is_box ? other_mesh.geometry.boundingBox : null,
			});
		}
		if (!candidates.length) return;

		let raycaster = new THREE.Raycaster();
		// 合批 cube 在 layer 7，默认 layers 只命中 layer 0
		raycaster.layers.enableAll();
		let start = new THREE.Vector3();
		let end = new THREE.Vector3();
		let direction = new THREE.Vector3();
		let back_direction = new THREE.Vector3();
		let local_point = new THREE.Vector3();
		let added = 0;
		let cast_count = 0;

		// 命中点转回本元素局部坐标，按 1e-4 去重后追加（与已有顶点共用同一个 vectors 数组）
		let add_point = world_point => {
			local_point.copy(world_point);
			mesh.worldToLocal(local_point);
			for (let vector of vectors) {
				let dx = vector[0] - local_point.x;
				let dy = vector[1] - local_point.y;
				let dz = vector[2] - local_point.z;
				if (dx*dx + dy*dy + dz*dz < INTERSECTION_EPSILON_SQ) return;
			}
			vectors.push(local_point.toArray());
			added++;
		};

		let local_start = new THREE.Vector3();
		let local_end = new THREE.Vector3();
		let hit_world_point = new THREE.Vector3();
		let inverse = new THREE.Matrix4();
		let hit_p0 = [0, 0, 0];
		let hit_p1 = [0, 0, 0];
		let hit_min = [0, 0, 0];
		let hit_max = [0, 0, 0];

		// 反馈#253：方块的命中目标用局部包围盒，而不是 mesh 三角形。删面只删 index 里的三角形，
		// 盒面（含被删的面）在视觉描边里依然存在，交点也应保留；同时躲开材质背面剔除。
		// 做法：把线段两端变到目标元素局部空间，用 slab 法求线段与 AABB 的交（最多两个）。
		let cast_segment_box = target => {
			cast_count++;
			inverse.copy(target.mesh.matrixWorld).invert();
			local_start.copy(start).applyMatrix4(inverse);
			local_end.copy(end).applyMatrix4(inverse);
			hit_p0[0] = local_start.x; hit_p0[1] = local_start.y; hit_p0[2] = local_start.z;
			hit_p1[0] = local_end.x; hit_p1[1] = local_end.y; hit_p1[2] = local_end.z;
			hit_min[0] = target.box.min.x; hit_min[1] = target.box.min.y; hit_min[2] = target.box.min.z;
			hit_max[0] = target.box.max.x; hit_max[1] = target.box.max.y; hit_max[2] = target.box.max.z;
			let t_enter = -Infinity;
			let t_exit = Infinity;
			for (let axis = 0; axis < 3; axis++) {
				let p0 = hit_p0[axis];
				let delta = hit_p1[axis] - p0;
				let min = hit_min[axis];
				let max = hit_max[axis];
				if (Math.abs(delta) < 1e-9) {
					// 与该轴的两张面平行：线段必须落在两条盒面之间才可能相交
					if (p0 < min - INTERSECTION_EPSILON || p0 > max + INTERSECTION_EPSILON) return;
					continue;
				}
				let ta = (min - p0) / delta;
				let tb = (max - p0) / delta;
				if (ta > tb) {
					let swap = ta;
					ta = tb;
					tb = swap;
				}
				if (ta > t_enter) t_enter = ta;
				if (tb < t_exit) t_exit = tb;
				if (t_enter > t_exit) return;
			}
			// 只有落在 0..1 内的进/出点才是线段与盒面的真实交点；
			// 线段整段在盒内时进出点都在区间外，不产生交点
			let length = local_start.distanceTo(local_end);
			let first = t_enter >= 0 && t_enter <= 1;
			let second = t_exit >= 0 && t_exit <= 1 && (t_exit - t_enter)*length > INTERSECTION_EPSILON;
			if (!first && !second) return;
			for (let pass = 0; pass < 2; pass++) {
				if (pass === 1 && !second) return;
				if (!first && pass === 0) continue;
				if (added >= INTERSECTION_MAX_POINTS) return;
				let t = pass === 0 ? t_enter : t_exit;
				hit_world_point.set(
					hit_p0[0] + (hit_p1[0] - hit_p0[0])*t,
					hit_p0[1] + (hit_p1[1] - hit_p0[1])*t,
					hit_p0[2] + (hit_p1[2] - hit_p0[2])*t,
				).applyMatrix4(target.mesh.matrixWorld);
				add_point(hit_world_point);
			}
		};

		// 沿 start→end 线段投射到 target。正反两向各投一次：材质多为 FrontSide，
		// 射线从背面接近表面时会被背面剔除，只投单向同样会漏掉交点。
		let cast_segment = target => {
			let edge_length = direction.subVectors(end, start).length();
			if (edge_length < 1e-6) return;
			if (target.box) {
				cast_segment_box(target);
				return;
			}
			direction.divideScalar(edge_length);
			back_direction.copy(direction).negate();
			for (let pass = 0; pass < 2; pass++) {
				if (added >= INTERSECTION_MAX_POINTS || cast_count >= INTERSECTION_MAX_RAYS) return;
				cast_count++;
				raycaster.set(pass ? end : start, pass ? back_direction : direction);
				raycaster.near = 0;
				raycaster.far = edge_length;
				for (let intersection of raycaster.intersectObject(target.mesh, false)) {
					add_point(intersection.point);
					if (added >= INTERSECTION_MAX_POINTS) return;
				}
			}
		};

		// A 向：本元素特征棱 → 其它元素表面。按棱轮转所有候选，避免首个候选吃掉射线预算
		for (let i = 0; i < own.edges.length; i += 6) {
			if (added >= INTERSECTION_MAX_POINTS || cast_count >= INTERSECTION_MAX_RAYS) break;
			start.fromArray(own.edges, i).applyMatrix4(mesh.matrixWorld);
			end.fromArray(own.edges, i + 3).applyMatrix4(mesh.matrixWorld);
			for (let candidate of candidates) {
				if (added >= INTERSECTION_MAX_POINTS || cast_count >= INTERSECTION_MAX_RAYS) break;
				cast_segment(candidate);
			}
		}

		// B 向：其它元素特征棱 → 本元素表面。旧实现缺这一向，其它块的棱穿过本块表面
		// 产生的交点全部丢失（反馈#228 复查里交线末端没有绿点就是这个原因）
		let own_target = {mesh, edges: own.edges, box: own.box_is_box ? mesh.geometry.boundingBox : null};
		for (let candidate of candidates) {
			if (added >= INTERSECTION_MAX_POINTS || cast_count >= INTERSECTION_MAX_RAYS) break;
			for (let i = 0; i < candidate.edges.length; i += 6) {
				if (added >= INTERSECTION_MAX_POINTS || cast_count >= INTERSECTION_MAX_RAYS) break;
				start.fromArray(candidate.edges, i).applyMatrix4(candidate.mesh.matrixWorld);
				end.fromArray(candidate.edges, i + 3).applyMatrix4(candidate.mesh.matrixWorld);
				cast_segment(own_target);
			}
		}
	},
	/**
	 * 反馈#327：「像素网格交叉点」候选——把像素网格显示的交叉点也加进捕捉点。
	 * 口径与像素网格显示完全一致（Cube 的 preview_controller.getPixelGridGeometry），
	 * 生成的是模型空间坐标，这里减去 origin 转成 mesh 局部坐标（与 geometry 顶点同一坐标系）。
	 * 交点可能很多（每面 (uv 像素数+1)^2），单元素超过 PIXEL_GRID_MAX_POINTS 时整体跳过。
	 */
	addPixelGridVertices(element, vectors) {
		if (typeof settings == 'undefined' || !settings.community_vertex_snap_pixel_grid?.value) return;
		if (typeof Toolbox != 'undefined' && Toolbox.selected?.id !== 'vertex_snap_tool') return;
		if (!(element instanceof Cube)) return;
		let controller = element.preview_controller;
		if (typeof controller?.getPixelGridGeometry !== 'function') return;
		let grid = controller.getPixelGridGeometry(element);
		let points = grid.intersections;
		if (!points.length || points.length / 3 > PIXEL_GRID_MAX_POINTS) return;

		let origin = element.origin;
		let seen = new Set();
		let key = (x, y, z) => `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
		for (let vector of vectors) seen.add(key(vector[0], vector[1], vector[2]));
		for (let i = 0; i < points.length; i += 3) {
			let x = points[i] - origin[0];
			let y = points[i + 1] - origin[1];
			let z = points[i + 2] - origin[2];
			let id = key(x, y, z);
			if (seen.has(id)) continue;
			seen.add(id);
			vectors.push([x, y, z]);
		}
	},
	clearVertexGizmos() {
		Project.model_3d.remove(Vertexsnap.line);
		Vertexsnap.elements_with_vertex_gizmos.forEach(element => {
			if (element.mesh && element.mesh.vertex_points) {
				element.mesh.vertex_points.visible = false;
				if (element instanceof Mesh) {
					element.preview_controller.updateGeometry(element);
				} else {
					element.mesh.vertex_points.parent.remove(element.mesh.vertex_points);
					delete element.mesh.vertex_points;
				}
			}
			
		})
		Vertexsnap.elements_with_vertex_gizmos.empty();
		Interface.preview.removeEventListener("mousemove", Vertexsnap.hoverCanvas);
	},
	hoverCanvas(event) {
		let data = Canvas.raycast(event)

		Project.model_3d.remove(Vertexsnap.line);
		Vertexsnap.elements_with_vertex_gizmos.forEach(el => {
			let points = el.mesh.vertex_points;
			let colors = [];
			for (let i = 0; i < points.geometry.attributes.position.count; i++) {
				let color;
				if (data && data.element == el && data.type == 'vertex' && data.vertex_index == i) {
					color = gizmo_colors.outline;
				} else {
					color = gizmo_colors.grid;
				}
				colors.push(color.r, color.g, color.b);
			}
			points.material.depthTest = !(data.element == el);
			if (el instanceof Mesh) points.material.depthTest = true;
			points.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		})

		if (!data || data.type !== 'vertex') {
			Blockbench.setStatusBarText()
			return;
		}

		if (Vertexsnap.step1 === false) {
			let {line} = Vertexsnap;
			let {geometry} = line;

			let vertex_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...Vertexsnap.vertex_pos.toArray(), ...vertex_pos.toArray()]), 3));

			line.renderOrder = 900
			Project.model_3d.add(Vertexsnap.line);
			Vertexsnap.line.position.copy(scene.position).multiplyScalar(-1);
			//Measure
			let diff = new THREE.Vector3().copy(Vertexsnap.vertex_pos);
			diff.sub(vertex_pos);
			Blockbench.setStatusBarText(tl('status_bar.vertex_distance', [trimFloatNumber(diff.length())] ));
		}
	},
	select() {
		Vertexsnap.clearVertexGizmos()
		Outliner.selected.forEach(function(element) {
			Vertexsnap.addVertices(element)
		})
		for (let group of Group.multi_selected) {
			Vertexsnap.addVertices(group);
		}
		if (Outliner.selected.length) {
			$('#preview').css('cursor', (Vertexsnap.step1 ? 'copy' : 'alias'))
		}
	},
	cancel() {
		if (Vertexsnap.step1) return false;
		Vertexsnap.step1 = true;
		delete Vertexsnap.vertex_pos;
		delete Vertexsnap.vertex_index;
		delete Vertexsnap.vertex_element;
		delete Vertexsnap.vertex_local;
		delete Vertexsnap.move_pivot;
		delete Vertexsnap.elements;
		delete Vertexsnap.groups;
		delete Vertexsnap.selected_vertices;
		let previous_mesh_selection = Vertexsnap.previous_mesh_selection;
		delete Vertexsnap.previous_mesh_selection;
		if (previous_mesh_selection) {
			for (let uuid in Project.mesh_selection) {
				if (!previous_mesh_selection[uuid]) delete Project.mesh_selection[uuid];
			}
			for (let uuid in previous_mesh_selection) {
				Project.mesh_selection[uuid] = previous_mesh_selection[uuid];
			}
		}
		updateSelection();
		Blockbench.setStatusBarText();
		Blockbench.showQuickMessage(tl('message.vertex_snap.cancel_selection', [], 'Cancel selected vertex'));
		return true;
	},
	canvasClick(data) {
		if (!data) return;
		if (data.type !== 'vertex' && ['locator', 'null_object'].includes(data.element?.type) == false) return;

		if (Vertexsnap.step1) {
			Vertexsnap.step1 = false;
			Vertexsnap.vertex_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			Vertexsnap.vertex_index = data.vertex_index;
			// 反馈#323：旋转后再按「缩放模式」口径缩放时，要从这个元素旋转后的实时姿态
			// 取被抓顶点的新位置（世界位移 = 目标点 − 新位置），所以记住它来自哪个元素、
			// 以及它在元素上的局部坐标（clearVertexGizmos 会删掉 vertex_points，之后取不到）
			Vertexsnap.vertex_element = data.element;
			Vertexsnap.vertex_local = data.vertex instanceof Array
				? data.vertex.slice()
				: (typeof data.vertex == 'string' ? data.element.vertices?.[data.vertex]?.slice() : undefined);
			Vertexsnap.move_pivot = data.vertex instanceof Array ? data.vertex.allEqual(0) : data.vertex == undefined;
			Vertexsnap.elements = Outliner.selected.slice();
			Vertexsnap.groups = Group.multi_selected.slice();
			Vertexsnap.previous_mesh_selection = JSON.parse(JSON.stringify(Project.mesh_selection));
			if (data.element instanceof Mesh && BarItems.selection_mode.value == 'vertex') {
				let vertices = data.element.getSelectedVertices(true);
				vertices.safePush(data.vertex);
			}
			Vertexsnap.selected_vertices = JSON.parse(JSON.stringify(Project.mesh_selection));
			Vertexsnap.clearVertexGizmos()
			$('#preview').css('cursor', (Vertexsnap.step1 ? 'copy' : 'alias'))

		} else {
			// 反馈#323：旋转模式直接按「上次使用的对齐/忽略轴」先算一遍，面板的首选项与结果保持一致
			Vertexsnap.snap(data, BarItems.vertex_snap_mode.get() == 'rotate' ? loadRotateOptions() : 0)
			$('#preview').css('cursor', (Vertexsnap.step1 ? 'copy' : 'alias'))
		}
		Blockbench.setStatusBarText()
	},
	getGlobalVertexPos(element, vertex) {
		let vector = new THREE.Vector3();
		if (vertex instanceof Array) {
			vector.fromArray(vertex);
		} else if (typeof vertex == 'string') {
			vector.fromArray(element.vertices[vertex]);
		}
		element.mesh.localToWorld(vector);
		return vector;
	},
	snap(data, options = 0, amended) {
		let transfer_undo_nodes = getGroupTransferOriginUndoNodes(Vertexsnap.groups);
		transfer_undo_nodes.elements.safePush(...Vertexsnap.elements);
		Undo.initEdit({elements: transfer_undo_nodes.elements, groups: transfer_undo_nodes.groups}, amended);

		let mode = BarItems.vertex_snap_mode.get();

		function ignoreVectorAxes(vector) {
			if (options.ignore_axis?.x) vector.x = 0;
			if (options.ignore_axis?.y) vector.y = 0;
			if (options.ignore_axis?.z) vector.z = 0;
		}

		function moveElements(global_delta) {
			let moved = false;
			Vertexsnap.elements.forEach(function(obj) {
				var local_offset = new THREE.Vector3().copy(global_delta)

				if (obj instanceof Mesh && Vertexsnap.selected_vertices && Vertexsnap.selected_vertices[obj.uuid]) {
					let vertices = Vertexsnap.selected_vertices[obj.uuid].vertices;
					var q = obj.mesh.getWorldQuaternion(Reusable.quat1).invert();
					local_offset.applyQuaternion(q);
					ignoreVectorAxes(local_offset);
					let local_offset_array = local_offset.toArray();
					vertices.forEach(vkey => {
						if (obj.vertices[vkey]) obj.vertices[vkey].V3_add(local_offset_array);
					})
					moved = true;

				} else {
					if (Format.bone_rig && obj.parent instanceof Group) {
						var q = obj.mesh.parent.getWorldQuaternion(Reusable.quat1).invert();
						local_offset.applyQuaternion(q);
					}
					// 反馈#350：忽略轴必须在写 origin 之前生效——否则方块的枢轴点在被忽略的轴上
					// 仍然跟着走，与「忽略该轴」的语义相反（几何不动、枢轴点漂走）
					ignoreVectorAxes(local_offset);
					if (obj instanceof Cube && Format.rotate_cubes) {
						obj.origin.V3_add(local_offset);
					}
					if (obj.moveVector) {
						var in_box = obj.moveVector(local_offset.toArray());
						if (!in_box && Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
							Blockbench.showMessageBox({translateKey: 'canvas_limit_error'})
						}
					} else if (obj.position) {
						obj.position.V3_add(local_offset.toArray());
					}
					moved = true;
				}
			})
			// 反馈#346：内容确实平移了才动组枢轴点——空组或元素没被移动时不该让枢轴点自己跑
			if (moved && Vertexsnap.groups.length && settings.community_vertex_snap_group_pivot_follow.value) {
				// 反馈#350：忽略的轴同样不能带着组枢轴点走
				translateGroupPivots(global_delta, options.ignore_axis);
			}
		}

		/**
		 * 反馈#323：缩放模式与「自动缩放至顶点」共用的缩放执行体。
		 * 按被抓顶点所在的 8 角点轴表逐轴伸缩：世界位移换到每个方块自身的局部轴，
		 * corner[i] === 1 的轴推 to、为 0 的轴推 from（与缩放模式完全同一口径）。
		 * 多选时同一个世界位移作用于每个方块各自对应的角点（不是把每个角点都搬到目标点）。
		 */
		function scaleCornersByDelta(global_delta) {
			let m = CORNER_AXIS_MAP[Vertexsnap.vertex_index];
			if (!m) return false;
			// 只处理方块：全是网格/样条时返回 false，让调用方走绕枢轴等比缩放的退化路径
			let scaled = false;
			Vertexsnap.elements.forEach(function(obj) {
				if (obj instanceof Cube == false) return;
				scaled = true;
				var q = obj.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()
				var local_offset = new THREE.Vector3().copy(global_delta).applyQuaternion(q)
				ignoreVectorAxes(local_offset);

				for (let i=0; i<3; i++) {
					if (m[i] === 1) {
						obj.to[i] = obj.to[i] + local_offset.getComponent(i);
					} else {
						obj.from[i] = obj.from[i] + local_offset.getComponent(i);
					}
				}
				if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
					Format.cube_size_limiter.clamp(obj)
				}
				if (obj.box_uv && obj.visibility) {
					obj.preview_controller.updateUV(obj)
				}
			})
			return scaled;
		}

		if (Vertexsnap.move_pivot) {
			let world_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			let pivot_targets = Vertexsnap.groups.length ? Vertexsnap.groups : Vertexsnap.elements;
			for (let node of pivot_targets) {
				// Transform the world-space target into the space in which the node's origin
				// is expressed, with a single matrix transform instead of piecemeal offsets
				let vec = new THREE.Vector3().copy(world_pos);
				if (node.mesh.parent) {
					node.mesh.parent.updateWorldMatrix(true, false);
					node.mesh.parent.worldToLocal(vec);
				} else {
					vec.sub(Canvas.scene.position);
				}
				if (node.parent instanceof OutlinerNode && node.parent.getTypeBehavior('use_absolute_position')) {
					vec.x += node.parent.origin[0];
					vec.y += node.parent.origin[1];
					vec.z += node.parent.origin[2];
				}
				// 反馈#350：忽略轴要把枢轴点留在原坐标上，只让其余轴落到目标顶点
				node.transferOrigin(clampIgnoredAxes(vec, node, options.ignore_axis));
			}
		} else {

			let global_target_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			let global_delta = new THREE.Vector3().copy(global_target_pos).sub(Vertexsnap.vertex_pos)

			if (mode === 'scale' && !Format.integer_size && Vertexsnap.elements[0] instanceof Cube) {
				//Scale
				// 反馈#323：与旋转模式的自动缩放共用同一份执行体（同一张角点轴表、同一套逐轴口径）
				if (!scaleCornersByDelta(global_delta)) {
					// 反馈#228：交点候选的 vertex_index 落在 0..7 角点轴表之外。
					// 没有轴向信息就无法决定从哪一侧缩放（旧代码会拿 undefined 下标表直接抛错），
					// 保守地整块平移（与 move 模式一致）：pivot 走 move_pivot 分支，不会到这里。
					moveElements(global_delta);
				}
			} else if (mode === 'move') {
				moveElements(global_delta);
			} else if (mode == 'rotate') {
				// 反馈#323：先按「对齐」方式把被抓顶点的方向转到目标方向；「自动缩放至顶点」打开后，
				// 再按「缩放模式」的同一套口径（抓到的角点 + 目标点两个顶点的世界位移，逐轴推
				// from/to）把方块拉长到目标点上——等价于旋转完再手动切缩放模式点这两个顶点。
				const auto_scale = !!options.auto_scale;
				function scaleAboutPivot(obj, factor) {
					if (!factor || !isFinite(factor) || factor <= 0) return;
					let pivot = new THREE.Vector3();
					obj.mesh.getWorldPosition(pivot);
					if (obj.mesh.parent) {
						obj.mesh.parent.updateWorldMatrix(true, false);
						pivot = obj.mesh.parent.worldToLocal(pivot);
					} else {
						pivot.sub(Canvas.scene.position);
					}
					let scale_coords = (coords) => {
						for (let i = 0; i < 3; i++) {
							if (options.ignore_axis?.['xyz'[i]]) continue;
							let offset = coords[i] - pivot.getComponent(i);
							coords[i] = pivot.getComponent(i) + offset * factor;
						}
					};
					if (obj instanceof Cube) {
						scale_coords(obj.from);
						scale_coords(obj.to);
						if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
							Format.cube_size_limiter.clamp(obj)
						}
					} else if (obj.vertices) {
						for (let key in obj.vertices) {
							if (obj.vertices[key]) scale_coords(obj.vertices[key]);
						}
					} else {
						return;
					}
					obj.preview_controller?.updateGeometry?.(obj);
					if (obj.box_uv && obj.visibility) obj.preview_controller?.updateUV?.(obj);
				}
				// 旋转前的起点距离，非方块元素（没有可拆的轴边界）按等比缩放落到目标
				let rotate_distances = new Map();
				Vertexsnap.elements.forEach((obj) => {
					let local_start = obj.mesh.worldToLocal(new THREE.Vector3().copy(Vertexsnap.vertex_pos));
					let local_target = obj.mesh.worldToLocal(new THREE.Vector3().copy(global_target_pos));

					ignoreVectorAxes(local_start);
					ignoreVectorAxes(local_target);

					let start_distance = local_start.length();
					let end_distance = local_target.length();
					rotate_distances.set(obj.uuid, {start: start_distance, end: end_distance});

					// 反馈#323 后续②：对齐方式必须真的作用在模型上。早前用 `|| !amended` 把
					// 「面板还没提交过」当成用默认最长轴，于是记住的「从枢轴的方向」在第一次
					// 捕捉时被忽略——面板显示一套、模型算另一套。现在只要不是「从枢轴的方向」，
					// 每次都按所选轴修正起点（首捕与 amend 一致）；开着「自动缩放至顶点」时
					// 也一样——旋转仍按所选对齐方式，随后的缩放只负责把顶点拉到目标上。
					if (options.align != 'direction') {
						let target_distance = local_target.length();
						let longest_axis = 'x';
						if ('xyz'.includes(options.align)) {
							longest_axis = options.align;
						} else {
							if (local_start.y > local_start.x) longest_axis = 'y';
							if (local_start.z > local_start.y) longest_axis = 'z';
						}

						let off_axes = ['x', 'y', 'z'].filter(l => l != longest_axis);
						// 目标比两个非主轴的偏移还短时开方得 NaN，会把整个旋转写成 NaN 坏模型；
						// 这种情况保持原起点长度（等价于「从枢轴的方向」）
						let fixed = Math.sqrt(target_distance**2 - local_start[off_axes[0]]**2 - local_start[off_axes[1]]**2);
						if (Number.isFinite(fixed)) local_start[longest_axis] = fixed;
					}
					local_start.normalize();
					local_target.normalize();
					let rot_diff = new THREE.Quaternion().setFromUnitVectors(local_start, local_target);

					obj.mesh.quaternion.multiply(rot_diff);
					let modified_rotation = obj.mesh.rotation.toArray().slice(0, 3).map(Math.radToDeg);
					obj.extend({rotation: modified_rotation});
				})
				if (auto_scale) {
					// 合批 cube 的 mesh 矩阵由批处理器维护（matrixAutoUpdate=false），旋转后只改
					// quaternion 不会反映到 matrixWorld，取「旋转后」的顶点位置前必须先刷矩阵
					Vertexsnap.elements.forEach((obj) => {
						obj.mesh.updateMatrix();
						obj.mesh.updateWorldMatrix(true, false);
					});
					// 旋转后被抓顶点的新世界位置 → 与目标点的世界位移。缩放模式正是把这个位移
					// 逐轴摊到每个方块对应的角点上（多选时各块按自己的角点平移同一段位移），
					// 所以这里直接复用同一个执行体：旋转 + 缩放合成一次操作（反馈#323 后续①）。
					let grabbed_local = Vertexsnap.vertex_local;
					let grabbed_now = (grabbed_local && Vertexsnap.vertex_element)
						? Vertexsnap.getGlobalVertexPos(Vertexsnap.vertex_element, grabbed_local)
						: new THREE.Vector3().copy(Vertexsnap.vertex_pos);
					let auto_delta = new THREE.Vector3().copy(global_target_pos).sub(grabbed_now);
					let scaled = scaleCornersByDelta(auto_delta);
					if (!scaled) {
						// 不是方块（网格/样条）或抓到的不是 8 角点之一：没有可拆的轴边界，
						// 退化为绕枢轴等比缩放
						Vertexsnap.elements.forEach((obj) => {
							let distances = rotate_distances.get(obj.uuid);
							if (!distances || !distances.start) return;
							scaleAboutPivot(obj, distances.end / distances.start);
						});
					}
				}
			}
		}

		Vertexsnap.clearVertexGizmos()
		// Update the exact nodes that transferOrigin may have rewritten (descendant
		// elements and nested groups), not just the selection: descendant groups get
		// new origins, so their mesh positions must be refreshed too.
		let update_options = {
			elements: transfer_undo_nodes.elements,
			element_aspects: {transform: true, geometry: true},
			selection: true
		};
		if (transfer_undo_nodes.groups.length) {
			update_options.groups = transfer_undo_nodes.groups;
			update_options.group_aspects = {transform: true};
		}
		Canvas.updateView(update_options);
		if (Vertexsnap.groups.length && !Group.first_selected) {
			Vertexsnap.groups[0].select();
		}
		Undo.finishEdit('Use vertex snap');
		if (Mesh.selected[0]) {
			let vertices = Vertexsnap.selected_vertices?.[Mesh.selected[0].uuid]?.vertices;
			autoFixMeshEdit(vertices);
		}
		Vertexsnap.step1 = true;
		
		if (!amended) {
			let rotate_options = loadRotateOptions();
			Undo.amendEdit({
				align: {type: 'select', condition: mode == 'rotate', label: 'edit.vertex_snap.align', options: {
					longest: 'edit.vertex_snap.align.longest',
					direction: 'edit.vertex_snap.align.direction',
					x: tl('edit.vertex_snap.align.align_axis', 'X'),
					y: tl('edit.vertex_snap.align.align_axis', 'Y'),
					z: tl('edit.vertex_snap.align.align_axis', 'Z'),
				}, value: rotate_options.align},
				// 反馈#323：独立开关，默认取上次使用时的值；缩放形式与「缩放」模式一致（逐轴）
				auto_scale: {
					type: 'checkbox',
					condition: mode == 'rotate',
					label: 'edit.vertex_snap.auto_scale',
					description: 'edit.vertex_snap.auto_scale.desc',
					value: rotate_options.auto_scale,
				},
				ignore_axis: {type: 'inline_multi_select', label: tl('edit.vertex_snap.ignore_axis', ''),  options: {x: 'X', y: 'Y', z: 'Z'}, value: {x: false, y: false, z: false}},
			}, form => {
				// 反馈#323：记住这次用的对齐方式与自动缩放开关，下次捕捉后面板按上次预选
				saveRotateOptions(form);
				Vertexsnap.snap(data, form, true);
			})
		}
	}
}

// 反馈#228：顶点捕捉是否把「与其它块的相交点」也列为候选。
// 工具条按钮与设置项同名（linked_setting 会自动从 settings.community_vertex_snap_intersections 取名）。
new Toggle('vertex_snap_intersections', {
	category: 'edit',
	icon: 'scatter_plot',
	linked_setting: 'community_vertex_snap_intersections',
})

// 反馈#327：像素网格交叉点（与相交点并列的独立开关，默认关闭）
new Toggle('vertex_snap_pixel_grid', {
	category: 'edit',
	icon: 'grid_on',
	linked_setting: 'community_vertex_snap_pixel_grid',
})

// 反馈#346：顶点捕捉平移组内元素时，所选组的枢轴点是否跟着一起走（默认关闭，保持原版语义）
new Toggle('vertex_snap_group_pivot_follow', {
	category: 'edit',
	icon: 'my_location',
	linked_setting: 'community_vertex_snap_group_pivot_follow',
})

Object.assign(window, {
	Vertexsnap,
});
