/**
 * 面块优化（反馈#307）
 *
 * 移植第三方插件「块面优化 1.3.7」的算法为内置工具：
 * 逐面求其它方块在该面平面上的截面多边形，用「水平带裁剪」从面矩形里挖掉被覆盖区域，
 * 覆盖面积达到阈值就把该面 texture 置为 null；6 面全空则删除方块；另外删除世界几何完全相同的重复方块。
 *
 * 反馈#307 新增两个开关：
 * - 「不删除块」：只清面、不删方块。完全被遮挡的方块仍留在结构里（6 面无贴图也不 remove()，
 *   名称/UV/父子关系全部保留），重复方块也不做去重删除——即本开关下整次优化只做「删面 + 面剔除」。
 * - 「以每组为单位删除面/块」：遮挡判定与重复检测只在同一个直接父组内部进行
 *   （按 cube.parent 的身份分桶，root 也算一个桶），跨组互不算遮挡，
 *   从而保留组间接触面 / 关节面 / 防穿模面。分桶后逐桶跑原算法，粗筛与裁剪都在桶内。
 *
 * 面轴顺序固定为 west/down/north/east/up/south，与 cube 局部轴的换算：
 * x = (faceAxis + 2) % 3、y = faceAxis % 3、z = (faceAxis + 1) % 3。
 */
import { THREE } from "../lib/libs";

/** 面剔除细缝容差：默认 0.002（覆盖常见防 z-fighting 的微缩量），随 epsilon 增大而增大 */
let optimize_slop = 0.002;

/** 面轴顺序 */
const OPTIMIZE_FACES = ['west', 'down', 'north', 'east', 'up', 'south'] as const;

/** 一个方块的世界变换信息（本地 from/to + 世界矩阵及其逆） */
interface OptimizeWorldInfo {
	mesh: THREE.Object3D | null
	matrix: THREE.Matrix4 | null
	inverse: THREE.Matrix4 | null
	from: number[]
	to: number[]
	origin: number[]
}

/** 选项面板的回填值 */
interface OptimizeOptions {
	restrict: boolean
	culling: boolean
	epsilon: number
	coverage: number
	keep_cubes: boolean
	per_group: boolean
}

interface OptimizeCounters {
	removed_faces: number
	deleted_cubes: number
	culled_faces: number
}

/** 单个分组桶的预计算数据（粗筛、裁剪、去重都只在桶内） */
interface OptimizeBucket {
	cubes: Cube[]
	world_corners: Record<string, number[][]>
	world_aabbs: Record<string, number[]>
	face_aabbs: Record<string, number[][][]>
	delete_set: Record<string, Cube>
}

/** Blockbench 的 3D 节点附加标记（group 节点带 isGroup / type） */
interface OptimizeBoneNode extends THREE.Object3D {
	isGroup?: boolean
	type: string
}

function optimizeIsCube(node: unknown): node is Cube {
	if (node instanceof Cube) return true;
	return typeof node == 'object' && node !== null && 'type' in node && node.type == 'cube';
}

function optimizeFromToInflate(cube: Cube): [number[], number[]] {
	const inflate = cube.inflate || 0;
	return [
		[cube.from[0] - inflate, cube.from[1] - inflate, cube.from[2] - inflate],
		[cube.to[0] + inflate, cube.to[1] + inflate, cube.to[2] + inflate],
	];
}

function optimizeRotatePoint(position: number[], origin: number[], axis: number, angle: number): number[] {
	if (angle == 0 || axis == -1) {
		return position;
	}
	let sin: number;
	let cos: number;
	if (angle == 45) {
		sin = 0.7071067812;
		cos = 0.7071067812;
	} else if (angle == -45) {
		sin = -0.7071067812;
		cos = 0.7071067812;
	} else if (angle == 22.5) {
		sin = 0.3826834324;
		cos = 0.9238795325;
	} else if (angle == -22.5) {
		sin = -0.3826834324;
		cos = 0.9238795325;
	} else {
		sin = Math.sin(angle * Math.PI / 180);
		cos = Math.cos(angle * Math.PI / 180);
	}
	const new_position = [0, 0, 0];
	const x = axis;
	const y = (axis + 1) % 3;
	const z = (axis + 2) % 3;
	new_position[x] = position[x];
	new_position[y] = origin[y] + (position[y] - origin[y]) * cos - (position[z] - origin[z]) * sin;
	new_position[z] = origin[z] + (position[z] - origin[z]) * cos + (position[y] - origin[y]) * sin;
	return new_position;
}

function optimizeGetAngleAxis(rotation: number[]): [number, number] {
	for (let axis = 0; axis < 3; axis++) {
		if (rotation[axis] != 0) {
			return [rotation[axis], axis];
		}
	}
	return [0, -1];
}

function optimizeGetWorldInfo(cube: Cube): OptimizeWorldInfo {
	let mesh: THREE.Object3D | null = null;
	try {
		mesh = cube.mesh || Project.nodes_3d[cube.uuid] || null;
	} catch (e) {}
	let matrix: THREE.Matrix4 | null = null;
	let inverse: THREE.Matrix4 | null = null;
	if (mesh && mesh.matrixWorld) {
		matrix = mesh.matrixWorld;
		inverse = new THREE.Matrix4().copy(matrix).invert();
	}
	const from_to = optimizeFromToInflate(cube);
	return {
		mesh,
		matrix,
		inverse,
		from: from_to[0],
		to: from_to[1],
		origin: cube.origin,
	};
}

/** cube 本地坐标 -> 模型世界坐标 */
function optimizeToWorld(info: OptimizeWorldInfo, point: number[]): number[] {
	if (!info.matrix) return point.slice();
	const v = new THREE.Vector3(point[0], point[1], point[2]);
	v.sub(new THREE.Vector3(info.origin[0], info.origin[1], info.origin[2]));
	v.applyMatrix4(info.matrix);
	if (Canvas.scene && Canvas.scene.position) {
		v.sub(Canvas.scene.position);
	}
	return [v.x, v.y, v.z];
}

/** 模型世界坐标 -> cube 本地坐标 */
function optimizeToLocal(info: OptimizeWorldInfo, point: number[]): number[] {
	if (!info.inverse) return point.slice();
	const v = new THREE.Vector3(point[0], point[1], point[2]);
	if (Canvas.scene && Canvas.scene.position) {
		v.add(Canvas.scene.position);
	}
	v.applyMatrix4(info.inverse);
	return [
		v.x + info.origin[0],
		v.y + info.origin[1],
		v.z + info.origin[2],
	];
}

/** 判断 cube 的父骨链是否存在旋转（仅用于面剔除；遮挡检测统一走世界矩阵，不依赖此判断） */
function optimizeHasBoneRotation(cube: Cube): boolean {
	let mesh: THREE.Object3D | null = null;
	try {
		mesh = cube.mesh || Project.nodes_3d[cube.uuid] || null;
	} catch (e) {}
	const eps = 0.00001;
	let node: THREE.Object3D | null = mesh ? mesh.parent : null;
	while (node) {
		const bone_node = node as OptimizeBoneNode;
		if (bone_node.isGroup || bone_node.type == 'group') {
			const q = node.quaternion;
			if (Math.abs(q.x) > eps || Math.abs(q.y) > eps || Math.abs(q.z) > eps) {
				return true;
			}
		}
		node = node.parent;
	}
	return false;
}

/** 计算凸多边形 P 在高度 z 处的 x 覆盖范围 [xl, xr]；z 处无覆盖时返回 [Infinity, -Infinity] */
function optimizeXlXrAt(z: number, P: number[][]): [number, number] {
	const cr: number[] = [];
	for (let i = 0; i < P.length; i++) {
		const p1 = P[i];
		const p2 = P[(i + 1) % P.length];
		if (Math.min(p1[1], p2[1]) <= z + 1e-5 && Math.max(p1[1], p2[1]) >= z - 1e-5) {
			if (Math.abs(p2[1] - p1[1]) < 1e-5) {
				cr.push(p1[0]);
				continue;
			}
			const t = (z - p1[1]) / (p2[1] - p1[1]);
			cr.push(p1[0] + (p2[0] - p1[0]) * t);
		}
	}
	if (cr.length === 0) return [Infinity, -Infinity];
	return [Math.min.apply(null, cr), Math.max.apply(null, cr)];
}

/** 矩形 R=[x1,z1,x2,z2] 减去凸多边形 P（面内坐标）：水平带扫描 + 段内边界跨越切分 */
function optimizeSubtractRectByPoly(R: number[], P: number[][]): number[][] {
	const result: number[][] = [];
	const x1 = R[0];
	const z1 = R[1];
	const x2 = R[2];
	const z2 = R[3];
	const zpts = [z1, z2];
	for (let p = 0; p < P.length; p++) {
		if (P[p][1] > z1 + 1e-5 && P[p][1] < z2 - 1e-5) zpts.push(P[p][1]);
	}
	zpts.sort((a, b) => a - b);
	for (let k = 0; k < zpts.length - 1; k++) {
		const za = zpts[k];
		const zb = zpts[k + 1];
		if (zb - za < 1e-5) continue;
		// 段内多边形左/右边界可能在段中跨越矩形边界(x1/x2)，需在跨越处切分
		const ra = optimizeXlXrAt(za, P);
		const rb = optimizeXlXrAt(zb, P);
		const cuts = [za, zb];
		if (isFinite(ra[0]) && isFinite(rb[0]) && ra[0] !== rb[0]) {
			const zc = za + (zb - za) * (x1 - ra[0]) / (rb[0] - ra[0]);
			if (zc > za + 1e-5 && zc < zb - 1e-5) cuts.push(zc);
		}
		if (isFinite(ra[1]) && isFinite(rb[1]) && ra[1] !== rb[1]) {
			const zc2 = za + (zb - za) * (x2 - ra[1]) / (rb[1] - ra[1]);
			if (zc2 > za + 1e-5 && zc2 < zb - 1e-5) cuts.push(zc2);
		}
		cuts.sort((a, b) => a - b);
		for (let m = 0; m < cuts.length - 1; m++) {
			const ca = cuts[m];
			const cb = cuts[m + 1];
			if (cb - ca < 1e-5) continue;
			const mid = (ca + cb) / 2;
			const rr = optimizeXlXrAt(mid, P);
			const xl = rr[0];
			const xr = rr[1];
			if (!isFinite(xl)) {
				// 该段无覆盖 → 整段保留
				if (cb - ca > optimize_slop && x2 - x1 > optimize_slop) result.push([x1, ca, x2, cb]);
				continue;
			}
			if (xr < xl) continue;
			// 丢弃零宽度/细缝退化块（覆盖到边界时的残余）
			if (xl > x1 + 1e-5 && Math.min(xl, x2) - x1 > optimize_slop && cb - ca > optimize_slop) {
				result.push([x1, ca, Math.min(xl, x2), cb]);
			}
			if (xr < x2 - 1e-5 && x2 - Math.max(xr, x1) > optimize_slop && cb - ca > optimize_slop) {
				result.push([Math.max(xr, x1), ca, x2, cb]);
			}
		}
	}
	return result;
}

/** cube 的 8 个世界角点（本地 from/to -> 世界，用于 AABB 粗筛与重复方块检测） */
function optimizeWorldCorners(info: OptimizeWorldInfo): number[][] {
	const f = info.from;
	const t = info.to;
	const corners: number[][] = [];
	for (let ca = 0; ca < 2; ca++) for (let cb = 0; cb < 2; cb++) for (let cd = 0; cd < 2; cd++) {
		corners.push(optimizeToWorld(info, [
			f[0] + (t[0] - f[0]) * ca,
			f[1] + (t[1] - f[1]) * cb,
			f[2] + (t[2] - f[2]) * cd,
		]));
	}
	return corners;
}

/** 8 角点的轴对齐包围盒 [x1,y1,z1,x2,y2,z2] */
function optimizeCornersAABB(corners: number[][]): number[] {
	const mn = [Infinity, Infinity, Infinity];
	const mx = [-Infinity, -Infinity, -Infinity];
	for (let c = 0; c < corners.length; c++) for (let a = 0; a < 3; a++) {
		mn[a] = Math.min(mn[a], corners[c][a]);
		mx[a] = Math.max(mx[a], corners[c][a]);
	}
	return [mn[0], mn[1], mn[2], mx[0], mx[1], mx[2]];
}

/**
 * 判断两个 cube 是否完全重复（8 个世界角点逐点一致，容差 1e-4）。
 * 用世界几何而非参数：旋转中心(pivot)在旋转轴方向的分量不影响旋转结果，
 * 两个视觉相同的 cube 参数可能不同。
 */
function optimizeIsIdenticalCube(corners_a: number[][], corners_b: number[][]): boolean {
	const e = 0.0001;
	for (let i = 0; i < 8; i++) {
		for (let j = 0; j < 3; j++) {
			if (Math.abs(corners_a[i][j] - corners_b[i][j]) > e) return false;
		}
	}
	return true;
}

/** cube 的 6 个面（OPTIMIZE_FACES 顺序）的世界 AABB，返回 [[min],[max]] 共 6 项 */
function optimizeFaceWorldAABB(info: OptimizeWorldInfo): number[][][] {
	const F = info.from;
	const T = info.to;
	const face_local = [
		[[F[0], F[1], F[2]], [F[0], T[1], F[2]], [F[0], F[1], T[2]], [F[0], T[1], T[2]]],
		[[F[0], F[1], F[2]], [T[0], F[1], F[2]], [F[0], F[1], T[2]], [T[0], F[1], T[2]]],
		[[F[0], F[1], F[2]], [T[0], F[1], F[2]], [F[0], T[1], F[2]], [T[0], T[1], F[2]]],
		[[T[0], F[1], F[2]], [T[0], T[1], F[2]], [T[0], F[1], T[2]], [T[0], T[1], T[2]]],
		[[F[0], T[1], F[2]], [T[0], T[1], F[2]], [F[0], T[1], T[2]], [T[0], T[1], T[2]]],
		[[F[0], F[1], T[2]], [T[0], F[1], T[2]], [F[0], T[1], T[2]], [T[0], T[1], T[2]]],
	];
	const faces: number[][][] = [];
	for (let fa = 0; fa < 6; fa++) {
		const mn = [Infinity, Infinity, Infinity];
		const mx = [-Infinity, -Infinity, -Infinity];
		for (let p = 0; p < 4; p++) {
			const w = optimizeToWorld(info, face_local[fa][p]);
			for (let a = 0; a < 3; a++) {
				mn[a] = Math.min(mn[a], w[a]);
				mx[a] = Math.max(mx[a], w[a]);
			}
		}
		faces.push([mn, mx]);
	}
	return faces;
}

/** 按直接父组（cube.parent 的身份）分桶；root 也算一个桶 */
function optimizeBuildBuckets(cubes: Cube[], per_group: boolean): Cube[][] {
	if (!per_group) return [cubes];
	const buckets = new Map<unknown, Cube[]>();
	for (const cube of cubes) {
		const key = cube.parent;
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = [];
			buckets.set(key, bucket);
		}
		bucket.push(cube);
	}
	return Array.from(buckets.values());
}

/** 为单个桶预计算世界信息、粗筛 AABB 与重复方块集合 */
function optimizePrepareBucket(cubes: Cube[], infos: Record<string, OptimizeWorldInfo>): OptimizeBucket {
	const bucket: OptimizeBucket = {
		cubes,
		world_corners: {},
		world_aabbs: {},
		face_aabbs: {},
		delete_set: {},
	};
	for (const cube of cubes) {
		const corners = optimizeWorldCorners(infos[cube.uuid]);
		bucket.world_corners[cube.uuid] = corners;
		bucket.world_aabbs[cube.uuid] = optimizeCornersAABB(corners);
		bucket.face_aabbs[cube.uuid] = optimizeFaceWorldAABB(infos[cube.uuid]);
	}
	// 检测完全重复的 cube（按世界几何）：删除排序靠下的重复 cube，保留靠上的
	for (let di = 0; di < cubes.length; di++) {
		for (let dj = di + 1; dj < cubes.length; dj++) {
			if (optimizeIsIdenticalCube(bucket.world_corners[cubes[di].uuid], bucket.world_corners[cubes[dj].uuid])) {
				bucket.delete_set[cubes[dj].uuid] = cubes[dj];
			}
		}
	}
	return bucket;
}

/** 对单个桶跑遮挡裁剪（桶内的方块互为遮挡者，桶外完全不参与） */
function optimizeRunBucket(bucket: OptimizeBucket, infos: Record<string, OptimizeWorldInfo>, options: OptimizeOptions, epsilon: number, counters: OptimizeCounters): void {
	const elements = bucket.cubes;
	const delete_set = bucket.delete_set;
	for (let i = 0; i < elements.length; i++) {
		const cube1 = elements[i];
		// 重复 cube（完全相同的靠下版本）不参与剔除，最后直接删除
		if (delete_set[cube1.uuid]) continue;
		const info1 = infos[cube1.uuid];
		const bone_rotated1 = optimizeHasBoneRotation(cube1);
		const origin1 = cube1.origin;
		const angle_axis1 = optimizeGetAngleAxis(cube1.rotation);
		const angle1 = angle_axis1[0];
		const rotation_axis1 = angle_axis1[1];
		const [cube1from, cube1to] = optimizeFromToInflate(cube1);
		// 缓存 cube2 在 cube1 系的 8 角点（6 个面复用，避免重复矩阵变换）
		const local_cache: Record<string, number[][]> = {};
		for (let face_axis = 0; face_axis < 6; face_axis++) {
			const face = cube1.faces[OPTIMIZE_FACES[face_axis]];
			if (face.texture == null) continue;
			if (options.culling) {
				delete face.cullface;
			}
			const x = (face_axis + 2) % 3;
			const y = face_axis % 3;
			const z = (face_axis + 1) % 3;
			const level = face_axis < 3 ? cube1from[y] : cube1to[y];
			let planes: number[][] = [];
			if (Math.abs(cube1to[x] - cube1from[x]) < epsilon || Math.abs(cube1to[z] - cube1from[z]) < epsilon) {
				planes = [];
			} else {
				planes = [[cube1from[x], cube1from[z], cube1to[x], cube1to[z]]];
				// ===== 统一联合覆盖检测 =====
				// 对每个 cube2：用世界矩阵把其 8 角点变换到 cube1 本地系，
				// 求其与面平面(y=level)的精确截面凸多边形，再用「水平带裁剪」从 planes 中挖掉被覆盖区域。
				// 多个 cube2 依次裁剪 = 联合覆盖；精确几何（含父骨/多轴旋转），不依赖单轴扫描线近似。
				for (let j = 0; j < elements.length; j++) {
					if (i == j) continue;
					const cube2 = elements[j];
					// 重复 cube 不作为遮挡者（避免覆盖被保留的相同 cube 的面）
					if (delete_set[cube2.uuid]) continue;
					// 空间粗筛：cube2 的世界 AABB 与当前面世界 AABB 不相交则不可能遮挡该面
					const fa = bucket.face_aabbs[cube1.uuid][face_axis];
					const wa = bucket.world_aabbs[cube2.uuid];
					if (fa[0][0] > wa[3] || fa[1][0] < wa[0]
						|| fa[0][1] > wa[4] || fa[1][1] < wa[1]
						|| fa[0][2] > wa[5] || fa[1][2] < wa[2]) continue;
					// cube2 在 cube1 系的 8 角点（per cube1 缓存，6 个面复用）
					let corners2 = local_cache[cube2.uuid];
					if (!corners2) {
						const wc = bucket.world_corners[cube2.uuid];
						corners2 = [];
						for (let cw = 0; cw < 8; cw++) corners2.push(optimizeToLocal(info1, wc[cw]));
						local_cache[cube2.uuid] = corners2;
					}
					// cube2 的 12 条边与面平面求交
					const pts: number[][] = [];
					const idx = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
					for (let e = 0; e < idx.length; e++) {
						const p2 = corners2[idx[e][0]];
						const q2 = corners2[idx[e][1]];
						if ((p2[y] < level && q2[y] >= level) || (q2[y] < level && p2[y] >= level)) {
							const t = (level - p2[y]) / (q2[y] - p2[y]);
							pts.push([p2[x] + (q2[x] - p2[x]) * t, p2[z] + (q2[z] - p2[z]) * t]);
						} else if (Math.abs(p2[y] - level) < epsilon) {
							pts.push([p2[x], p2[z]]);
						} else if (Math.abs(q2[y] - level) < epsilon) {
							pts.push([q2[x], q2[z]]);
						}
					}
					// 去重
					const uniq: number[][] = [];
					for (let p = 0; p < pts.length; p++) {
						let dup = false;
						for (let u = 0; u < uniq.length; u++) {
							if (Math.abs(uniq[u][0] - pts[p][0]) < 1e-6 && Math.abs(uniq[u][1] - pts[p][1]) < 1e-6) {
								dup = true;
								break;
							}
						}
						if (!dup) uniq.push(pts[p]);
					}
					if (uniq.length < 3) continue;
					// 凸多边形排序（绕质心按角度）
					let cxm = 0;
					let czm = 0;
					for (let p = 0; p < uniq.length; p++) {
						cxm += uniq[p][0];
						czm += uniq[p][1];
					}
					cxm /= uniq.length;
					czm /= uniq.length;
					uniq.sort((a, b) => Math.atan2(a[1] - czm, a[0] - cxm) - Math.atan2(b[1] - czm, b[0] - cxm));
					// 水平带裁剪 planes
					const new_planes: number[][] = [];
					for (let pn = 0; pn < planes.length; pn++) {
						const sub = optimizeSubtractRectByPoly(planes[pn], uniq);
						for (let r = 0; r < sub.length; r++) new_planes.push(sub[r]);
					}
					planes = new_planes;
				}
			}
			let removed_now = false;
			if (planes.length == 0) {
				removed_now = true;
			} else if (options.coverage < 100) {
				// 按覆盖率阈值判定：剩余可见面积占比 <= (100-阈值)% 时视为已充分遮挡
				const orig_area = Math.abs((cube1to[x] - cube1from[x]) * (cube1to[z] - cube1from[z]));
				let rem_area = 0;
				for (let pa = 0; pa < planes.length; pa++) {
					rem_area += (planes[pa][2] - planes[pa][0]) * (planes[pa][3] - planes[pa][1]);
				}
				if (orig_area > 0 && rem_area / orig_area <= (100 - options.coverage) / 100) {
					removed_now = true;
				}
			}
			if (removed_now) {
				face.texture = null;
				counters.removed_faces++;
			} else if (options.culling && !bone_rotated1) {
				const cull_faces = [true, true, true, true, true, true];
				for (let j = 0; j < planes.length; j++) {
					for (let k = 0; k < 4; k++) {
						const corner = [0, 0, 0];
						corner[x] = planes[j][(k & 1) * 2];
						corner[z] = planes[j][(k & 2) + 1];
						corner[y] = level;
						const rotated_corner = optimizeRotatePoint(corner, origin1, rotation_axis1, angle1);
						for (let l = 0; l < 3; l++) {
							if (rotated_corner[l] > epsilon) {
								cull_faces[l] = false;
							}
							if (rotated_corner[l] < 16 - epsilon) {
								cull_faces[l + 3] = false;
							}
						}
					}
				}
				for (let j = 0; j < 6; j++) {
					if (cull_faces[j]) {
						face.cullface = OPTIMIZE_FACES[j];
						counters.culled_faces++;
						break;
					}
				}
			}
		}
	}
}

/**
 * 执行面块优化。所有修改都在一次 Undo 里完成（被删除的方块也包含在 elements 里，Ctrl+Z 可全量还原）。
 */
function runFaceOptimize(options: OptimizeOptions): void {
	optimize_slop = Math.max(0.002, options.epsilon);

	let elements: Cube[];
	const scope: unknown[] = options.restrict ? Outliner.selected : Outliner.elements;
	elements = scope.filter(optimizeIsCube);
	if (elements.length == 0) {
		Blockbench.showMessage(tl('message.face_optimize.empty'), 'center');
		return;
	}
	// 刷新世界矩阵，使其反映当前模型（含所有父骨 pivot/rotation 的变换）
	Canvas.scene.updateMatrixWorld(true);

	const infos: Record<string, OptimizeWorldInfo> = {};
	for (const cube of elements) {
		infos[cube.uuid] = optimizeGetWorldInfo(cube);
	}

	// 分桶：不勾选「以每组为单位」时整个选择就是一个桶（行为与原插件一致）
	const groups = optimizeBuildBuckets(elements, options.per_group);
	const buckets: OptimizeBucket[] = groups.map(cubes => optimizePrepareBucket(cubes, infos));

	const counters: OptimizeCounters = {removed_faces: 0, deleted_cubes: 0, culled_faces: 0};
	const undo_aspects = {elements, uv_only: false};
	Undo.initEdit(undo_aspects);

	try {
		for (const bucket of buckets) {
			optimizeRunBucket(bucket, infos, options, options.epsilon, counters);
		}
		// 「不删除块」：只清面不删方块——完全被遮挡的方块保留，重复方块也不去重删除
		if (!options.keep_cubes) {
			for (const bucket of buckets) {
				for (const cube of bucket.cubes) {
					if (bucket.delete_set[cube.uuid]) {
						cube.remove();
						counters.deleted_cubes++;
						continue;
					}
					let visible = false;
					for (let f = 0; f < 6; f++) {
						if (cube.faces[OPTIMIZE_FACES[f]].texture !== null) {
							visible = true;
							break;
						}
					}
					if (!visible) {
						cube.remove();
						counters.deleted_cubes++;
					}
				}
			}
		}
	} finally {
		updateSelection();
		Undo.finishEdit('Face optimize', undo_aspects);
		Canvas.updateAllFaces();
	}
	const message = tl('message.face_optimize.result', [counters.removed_faces, counters.deleted_cubes, counters.culled_faces]);
	Blockbench.showQuickMessage(message, 3000);
}

BARS.defineActions(() => {
	new Action('face_optimize', {
		icon: 'border_outer',
		category: 'filter',
		condition: () => Modes.edit,
		click() {
			try {
				// 反馈#313：标签文字超过 --max_label_width 时会被裁掉左半边（「浮点容差」「面剔除覆盖率」
				// 两行只剩输入框），这里加宽对话框，并把标签里的大段括号说明搬到字段的悬浮备注（title + ? 图标）
				const dialog = new Dialog({
					id: 'face_optimize_options',
					title: 'dialog.face_optimize.title',
					width: 620,
					form: {
						restrict: {label: 'dialog.face_optimize.restrict', type: 'checkbox', value: true},
						culling: {
							label: 'dialog.face_optimize.culling', type: 'checkbox', value: false,
							description: 'dialog.face_optimize.culling.desc',
						},
						epsilon: {
							label: 'dialog.face_optimize.epsilon', type: 'number', value: 0.00001, step: 0.000001, min: 0,
							description: 'dialog.face_optimize.epsilon.desc',
						},
						coverage: {
							label: 'dialog.face_optimize.coverage', type: 'number', value: 100, min: 0, max: 100, step: 1,
							description: 'dialog.face_optimize.coverage.desc',
						},
						keep_cubes: {
							label: 'dialog.face_optimize.keep_cubes', type: 'checkbox', value: false,
							description: 'dialog.face_optimize.keep_cubes.desc',
						},
						per_group: {
							label: 'dialog.face_optimize.per_group', type: 'checkbox', value: false,
							description: 'dialog.face_optimize.per_group.desc',
						},
						hint: {type: 'info', text: 'dialog.face_optimize.hint'},
					},
					onConfirm(data) {
						dialog.hide();
						const epsilon_value = parseFloat(data.epsilon);
						const epsilon = (isFinite(epsilon_value) && epsilon_value > 0) ? epsilon_value : 0.00001;
						const coverage_value = parseFloat(data.coverage);
						const coverage = isFinite(coverage_value) ? Math.min(100, Math.max(0, coverage_value)) : 100;
						runFaceOptimize({
							restrict: !!data.restrict,
							culling: !!data.culling,
							epsilon,
							coverage,
							keep_cubes: !!data.keep_cubes,
							per_group: !!data.per_group,
						});
					},
				});
				dialog.show();
			} catch (err) {
				Blockbench.showMessage(tl('message.face_optimize.error', [err && err.message || err]), 'center');
				console.error(err);
			}
		},
	});
});
