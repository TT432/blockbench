import { Canvas } from "../preview/canvas";
import { gizmo_colors } from "../preview/preview";
import { autoFixMeshEdit } from "./mesh/auto_fix";
import { getEditTransformSpace } from "./transform/edit_transform";
import { FollowSpace, FOLLOW_SPACE } from "./follow_space";
import { rotateEulerBy90 } from "../util/math_util";

/**
 * 反馈#276：翻转/镜像轴面。
 * 工具栏「翻转 X/Y/Z」原本固定绕画布中心镜像（`Format.centered_grid ? 0 : 8`）。这里给每条轴
 * 加一个偏移滑条（默认 0 = 画布中心），滑条改动时视口画出对应的轴面，翻转动作按移动后的轴面镜像。
 * 偏移值就是相对画布中心的模型坐标距离。
 */
export const FlipPlane = {
	offset: [0, 0, 0],
	/**
	 * 反馈#299：每个轴面自己的旋转角（度），索引 = 该轴面的法线轴。
	 * 旋转轴循环对应：X 面绕 Z、Y 面绕 X、Z 面绕 Y（用户 2026-11-03 定案）。
	 * 与偏移合起来就是工具栏上的 6 个数值。
	 */
	rotation: [0, 0, 0],
	/**
	 * 反馈#312：是否在视口里绘制轴面网格（浮动面板里的「显示轴面」开关，默认开）。
	 * 关闭后数值改动照常生效，只是不画网格。
	 */
	visible: true,
	/** 元素数据空间里该轴镜像面的坐标（与 mirrorSelected 传给 flip() 的 center 同空间） */
	position(axis) {
		return (Format.centered_grid ? 0 : 8) + this.offset[axis];
	},
	/**
	 * 场景坐标。非居中网格下模型的 X/Z 原点在场景 (8, 0, 8)、Y 直接等于模型坐标，
	 * 因此 X/Z 轴的轴面场景坐标就是偏移本身，Y 轴还要加上画布中心。
	 */
	scenePosition(axis) {
		return axis === 1 ? this.position(1) : this.offset[axis];
	},
	/** 反馈#299：该轴面旋转所绕的轴（循环对应：X→Z、Y→X、Z→Y） */
	rotationAxis(axis) {
		return (axis + 2) % 3;
	},
	/** 反馈#299：该轴面是否仍未旋转——未旋转时走原来的轴对齐镜像，逐比特保持既有行为 */
	isAligned(axis) {
		return Math.abs(this.rotation[axis] % 360) < 1e-6;
	},
	/**
	 * 反馈#299：三个轴面共用的中心点（元素数据空间）。倾斜的轴面绕它旋转，因此三个面永远交于该点，
	 * 未旋转时它就是各轴自己的 position（其它两个分量对轴对齐平面没有意义）。
	 */
	center() {
		return [this.position(0), this.position(1), this.position(2)];
	},
	/** 反馈#299：6 个数值一起归零 */
	reset() {
		for (let axis = 0; axis < 3; axis++) {
			this.offset[axis] = 0;
			this.rotation[axis] = 0;
		}
	},
}

//Actions
export function getSelectionCenter(all = false) {
	// 反馈#234：智能根的实例 TRS 落在骨骼（bone_rig）或独立实例容器（其他格式）上，
	// 后代元素的 matrixWorld 只有渲染循环才刷新；拖动过程中按后代包围盒算中心会停在上一帧，
	// 表现为「位移轴临时错位」。整棵智能子树被选中时直接取实例枢轴（原点 + 实例位移）。
	if (Group.selected.length == 1 && !all) {
		let group = Group.first_selected;
		if (group.smart_object && (Outliner.selected.length == 0 || group.matchesSelection())) {
			let reference = group._smart_instance_container || group.mesh;
			reference.updateWorldMatrix(true, false);
			return THREE.fastWorldPosition(reference, new THREE.Vector3()).toArray();
		}
	}
	if (Group.selected.length == 1 && Outliner.selected.length == 0 && !all) {
		let vec = THREE.fastWorldPosition(Group.first_selected.mesh, new THREE.Vector3());
		return vec.toArray();
	}

	let max = [-Infinity, -Infinity, -Infinity];
	let min = [ Infinity,  Infinity,  Infinity];
	let elements = Outliner.selected.length ? Outliner.selected : Outliner.elements;
	if (Group.first_selected) {
		elements = elements.concat(Group.multi_selected);
	}
	elements.forEach(element => {
		if (element instanceof Group && !Format.bone_rig) return;
		if (element.getWorldCenter) {
			var pos = getWorldCenterUsingMatrix(element);
			min[0] = Math.min(pos.x, min[0]);	max[0] = Math.max(pos.x, max[0]);
			min[1] = Math.min(pos.y, min[1]);	max[1] = Math.max(pos.y, max[1]);
			min[2] = Math.min(pos.z, min[2]);	max[2] = Math.max(pos.z, max[2]);
		}
	})
	let center = (min[0] == Infinity) ? [0, 0, 0] : max.V3_add(min).V3_divide(2);
	
	if (!Format.centered_grid) {
		center.V3_add(8, 0, 8)
	}
	return center;
}
function getWorldCenterUsingMatrix(element) {
	if (element.from && element.to && element.origin && element.mesh) {
		return element.mesh.localToWorld(new THREE.Vector3(
			(element.from[0] + element.to[0]) / 2 - element.origin[0],
			(element.from[1] + element.to[1]) / 2 - element.origin[1],
			(element.from[2] + element.to[2]) / 2 - element.origin[2]
		));
	}
	return element.getWorldCenter();
}
// Spline Point Selection
export function selectSplinePoints(spline, handle, axis) {
	let selection = spline.getSelectedVertices(true);
	let addToPrevious = Pressing.shift;
	let toAdd = { "C1": [handle.control1], "C2": [handle.control2], "J": [handle.control1, handle.joint, handle.control2] };
	let selectionLength = 0;
	let toAddLength = 0;

	// Silly workaround because both of these don't have a length for some reason
	selection.forEach((e) => selectionLength++);
	toAdd[axis].forEach((e) => toAddLength++);

	// Determine which points to select
	if (!toAdd[axis].some((value) => selection.includes(value))) { // Selection doesn't include any of the points this axis would select.
		if (addToPrevious) {
			// Add axis points to the selection.
			selection.push(...toAdd[axis]);
		} else {
			// Replace selection.
			selection.replace(toAdd[axis]);
		}
	} else { // Selection includes some of the points this axis would select.
		if (addToPrevious) {
			if (selection.includes(handle.joint) && (axis === "C1" || axis === "C2")) {
				// Attempted to unselect one control, unselect whole handle.
				selection.remove(...toAdd["J"]);
			} 
			else if ((selection.includes(handle.control1) || selection.includes(handle.control2)) && (axis === "J")) {
				// Clicked on handle with selected controls, select whole handle.
				selection.remove(...toAdd[axis]);
				selection.push(...toAdd[axis]);
			} 
			else {
				// Simply clear this axis from the selection.
				selection.remove(...toAdd[axis]);
			}
		} else {
			if (selectionLength > toAddLength) {
				// Clicked on a control, clear and select it.
				selection.empty();
				selection.push(...toAdd[axis]);
			} 
			else if (selectionLength === toAddLength) {
				// Clicked on selected handle, unselect.
				selection.remove(...toAdd[axis]);
			} 
			else if ((selection.includes(handle.control1) || selection.includes(handle.control2)) && (axis === "J")) {
				// Clicked on handle with selected controls, select whole handle.
				selection.remove(...toAdd[axis]);
				selection.push(...toAdd[axis]);
			} 
			else {
				// Simply clear this axis from the selection.
				selection.remove(...toAdd[axis]);
			}
		}
	}

	return selection.length > 0;
}
// Spline handle tilt
export function tiltSplineHandle(modify, handle) {
	handle.tilt = modify(handle.tilt);
}
//Movement
export function moveElementsRelative(difference, index, event) { //Multiple
	if (!Preview.selected || !Outliner.selected.length) {
		return;
	}
	var _has_groups = Format.bone_rig && Group.first_selected && Toolbox.selected.transformerMode == 'translate';

	const smart_group = getSmartInstanceTransformGroup();
	Undo.initEdit({elements: smart_group ? [] : getSelectedMovingElements(), outliner: _has_groups, groups: smart_group ? [smart_group] : undefined})
	var axes = []
	// < >
	// PageUpDown
	// ^ v
	var facing = Preview.selected.getFacingDirection()
	var height = Preview.selected.getFacingHeight()
	switch (facing) {
		case 'north': axes = [0, 2, 1]; break;
		case 'south': axes = [0, 2, 1]; break;
		case 'west':  axes = [2, 0, 1]; break;
		case 'east':  axes = [2, 0, 1]; break;
	}

	if (height !== 'middle') {
		if (index === 1) {
			index = 2
		} else if (index === 2) {
			index = 1
		}
	}
	if (facing === 'south' && (index === 0 || index === 1))  difference *= -1
	if (facing === 'west'  && index === 0)  difference *= -1
	if (facing === 'east'  && index === 1)  difference *= -1
	if (index === 2 && height !== 'down') difference *= -1
	if (index === 1 && height === 'up') difference *= -1

	if (event) {
		difference *= canvasGridSize(event.shiftKey || Pressing.overrides.shift, event.ctrlOrCmd || Pressing.overrides.ctrl);
	}

	if (BarItems.proportional_editing.value) {
		Mesh.selected.forEach(mesh => {
			ProportionalEdit.calculateWeights(mesh);
		})
	}

	moveElementsInSpace(difference, axes[index]);
	updateSelection();

	Undo.finishEdit('Move elements')
	autoFixMeshEdit()
}
//Rotate
/**
 * 反馈#193：Cube/Mesh/SplineMesh.roll 内部的 rotateCoord 每步执行的坐标旋转 R_A（模型空间）。
 * axis 0 → Rx(+90°)、axis 1 → Ry(-90°)、axis 2 → Rz(+90°)。组节点的 origin/rotation 补偿必须
 * 使用同一个 R_A，否则组与其子方块会被施加不同的变换（这正是子组带自身旋转角时错位的原因）。
 */
function getRollQuaternion(axis, steps) {
	let rad = Math.PI / 2 * steps;
	let sign = axis === 1 ? -1 : 1;
	return new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0),
		sign * rad
	);
}
/**
 * 反馈#193：组的刚性 90° 旋转。
 * world = Π R_n^{o_n}·x（每个节点的 rotation 都绕自身 origin 施加在同一模型空间），因此整棵子树
 * 绕组枢轴做刚体旋转 R_A 等价于：每个节点 origin ← R_A(origin−pivot)+pivot，且 rotation ← R_A·R·R_A⁻¹。
 * 子元素（Cube/Mesh/SplineMesh）由各自 roll() 完成等价变换；组一级此前完全没被处理，
 * 于是合成出 R_A·R_sub 的错序结果。选中组自身的 rotation 若为 0 旋转后仍为 0（工具语义「不带组旋转」）。
 */
function rotateGroupRigid(group, axis, steps, pivot, q) {
	let origin_vec = new THREE.Vector3().fromArray(group.origin).sub(pivot).applyQuaternion(q).add(pivot);
	group.origin.V3_set([origin_vec.x, origin_vec.y, origin_vec.z]);
	group.rotation.V3_set(rotateEulerBy90(group.rotation, axis, steps));
}
/**
 * 收集 90° 旋转要一起变换的组节点：选中的组本身 + 其全部后代组。
 * 选中的组会把后代全部选中，但级联只置 selected，不进 Group.multi_selected，需自行展开。
 */
export function getRotateSelectedGroups() {
	let groups = [];
	let seen = new Set();
	Group.multi_selected.forEach(group => {
		if (!seen.has(group)) { seen.add(group); groups.push(group); }
		if (typeof group.forEachChild != 'function') return;
		group.forEachChild(child => {
			if (child instanceof Group && !seen.has(child)) { seen.add(child); groups.push(child); }
		});
	});
	return groups;
}
/**
 * 反馈#200：90° 旋转使用的坐标系。与旋转工具（gizmo）共用同一个「旋转空间」工具栏选项：
 * global → 世界轴；parent → 父级朝向决定的轴；local → 节点自身朝向决定的轴。
 * 该选项不可见时（当前工具不是旋转工具）仍读它保存的值，默认 local（工具栏默认值）。
 */
export function getRotate90Space() {
	let value = BarItems.rotation_space && BarItems.rotation_space.value;
	return (value === 'parent' || value === 'local') ? value : 'global';
}
/** 节点自身 rotation 的四元数（模型空间；欧拉序与预览网格一致） */
function getNodeRotationQuaternion(node) {
	if (!node || !node.rotation) return new THREE.Quaternion();
	let order = node.mesh?.rotation?.order || Format.euler_order || 'ZYX';
	return new THREE.Quaternion().setFromEuler(new THREE.Euler(
		Math.degToRad(node.rotation[0]),
		Math.degToRad(node.rotation[1]),
		Math.degToRad(node.rotation[2]),
		order
	));
}
/** 祖先链的累计旋转 A（从根往下连乘，不含节点自身） */
function getAncestorChainQuaternion(node) {
	let chain = [];
	let current = node.parent;
	while (current instanceof OutlinerNode) {
		chain.unshift(current);
		current = current.parent;
	}
	let quaternion = new THREE.Quaternion();
	chain.forEach(n => quaternion.multiply(getNodeRotationQuaternion(n)));
	return quaternion;
}
/**
 * 反馈#200：把请求的坐标系换成「数据空间里应该绕哪个轴转」的帧四元数 F（数据侧旋转 Q = F·R_A·F⁻¹）。
 * 推导依据：数据旋转 Q 在渲染后的世界侧表现为 A·Q·A⁻¹（A = 祖先链累计旋转，数据坐标由祖先链外层施加）：
 *   - 父级坐标系：世界轴 = A·e ⇒ Q 的轴就是数据空间的 e → F = 单位阵
 *   - 自身坐标系：世界轴 = A·R_node·e ⇒ Q 的轴 = R_node·e → F = R_node（与 gizmo 自身坐标系的内旋一致）
 *   - 全局坐标系：世界轴 = e ⇒ Q 的轴 = A⁻¹·e → F = A⁻¹
 */
function getRotateFrameQuaternion(node, space) {
	if (space === 'local') return getNodeRotationQuaternion(node);
	if (space === 'global') return getAncestorChainQuaternion(node).invert();
	return new THREE.Quaternion();
}
/**
 * q 等价于「绕 model 轴 axis 转 steps×90°」时返回 {axis, steps}（steps ∈ 1..3），否则 null。
 * 直角帧（组旋转都是 90° 倍数）走这条路径：方块 from/to 仍是轴对齐盒，旋转可以被「烘焙」进坐标，
 * 从而不引入任何旋转值（工具语义「不带组旋转」）。
 */
function getQuarterTurnFromQuaternion(q) {
	for (let axis = 0; axis < 3; axis++) {
		for (let steps = 1; steps < 4; steps++) {
			if (Math.abs(getRollQuaternion(axis, steps).dot(q)) > 1 - 1e-6) return {axis, steps};
		}
	}
	return null;
}
/** 子树的根：父级全部处于选中状态时继续向上（选中一组会级联选中后代） */
function getRotateSubtreeRoot(node) {
	let root = node;
	while (root.parent instanceof OutlinerNode && root.parent.selected) root = root.parent;
	return root;
}
/** 把四元数写回节点 rotation（按预览网格的欧拉序分解，避免读回时姿态不同） */
function setNodeRotationFromQuaternion(node, quaternion) {
	let order = node.mesh?.rotation?.order || Format.euler_order || 'ZYX';
	let euler = new THREE.Euler().setFromQuaternion(quaternion, order);
	node.rotation.V3_set(
		Math.roundTo(Math.radToDeg(euler.x), 6),
		Math.roundTo(Math.radToDeg(euler.y), 6),
		Math.roundTo(Math.radToDeg(euler.z), 6)
	);
	if (node instanceof Cube) {
		let non_zero = node.rotation.map(v => Math.abs(v) > 1e-4);
		let axis = non_zero.indexOf(true);
		if (axis >= 0 && non_zero.indexOf(true, axis + 1) === -1) node.rotation_axis = getAxisLetter(axis);
	}
}
/**
 * 反馈#200：帧不是直角对齐、或用「旋转值」表达网格坐标旋转时的提示（节流）。
 * 方块几何只能存轴对齐 from/to，绕非直角轴旋转 90° 后的盒子无法用坐标表达，只能改为写旋转值。
 */
function notifyRotateNotRepresentable() {
	let now = Date.now();
	if (notifyRotateNotRepresentable.last_warning && now - notifyRotateNotRepresentable.last_warning < 3000) return;
	notifyRotateNotRepresentable.last_warning = now;
	Blockbench.showQuickMessage(tl('message.rotate_90_space_fallback'), 4000);
}
export function rotateSelected(axis, steps) {
	let affected = [...Cube.selected, ...Mesh.selected, ...SplineMesh.selected];
	let groups = getRotateSelectedGroups();
	if (!affected.length && !groups.length) return;
	if (!steps) steps = 1
	let own_pivot = !!Settings.get('community_rotate_own_pivot');
	let space = getRotate90Space();
	// 关闭自身枢轴时的原版枢轴：骨架构架=首个选中组、居中网格=世界原点、其余=首个选中元素
	let legacy_origin;
	if (!own_pivot) {
		if (Group.first_selected && Format.bone_rig) {
			legacy_origin = Group.first_selected.origin.slice()
		} else if (Format.centered_grid) {
			legacy_origin = [0, 0, 0]
		} else if (affected.length) {
			legacy_origin = affected[0].origin.slice()
		} else {
			legacy_origin = groups[0].origin.slice()
		}
	}
	let base_quaternion = getRollQuaternion(axis, steps);
	let legacy_turn = {axis, steps};
	// 反馈#286：自身空间 + 旋转轴锁定开启时，「变换 → 旋转」的六个 90° 按钮共用
	// 「首个所选组/元素」的自身坐标帧，避免多选时每个块绕各自的局部轴转而出现轴向冲突
	let local_lock_frame = null;
	if (space === 'local' && BarItems.rotation_slider_local_axis_lock?.value) {
		let reference = getLocalAxisLockReference();
		if (reference?.mesh) local_lock_frame = getNodeRotationQuaternion(reference);
	}
	// 每个选中子树一份计划：枢轴（自身枢轴=子树根的 origin）+ 该坐标系下的等效模型轴旋转
	let plans = new Map();
	let getPlan = node => {
		let root = getRotateSubtreeRoot(node);
		let cached = plans.get(root);
		if (cached) return cached;
		let frame = local_lock_frame ?? getRotateFrameQuaternion(root, space);
		let pivot = own_pivot ? root.origin.slice() : legacy_origin;
		let quarter_turn = frame.clone().multiply(base_quaternion).multiply(frame.clone().invert());
		let plan = {
			root,
			pivot,
			turn: getQuarterTurnFromQuaternion(quarter_turn),
			node_rotation: null,
		};
		if (!plan.turn) {
			let pivot_is_own = pivot[0] === root.origin[0] && pivot[1] === root.origin[1] && pivot[2] === root.origin[2];
			// 单轴旋转限制格式的方块无法表达任意欧拉角（组不受限）
			let limited_cube = Format.rotation_limit === true && root instanceof Cube;
			if (pivot_is_own && !limited_cube) {
				// 帧非直角：方块盒子坐标无法表达旋转结果，改为写子树根的旋转值。
				// 数据侧旋转 Q 写成 Q·R（世界 = A·Q·A⁻¹，子级随层级跟随，无需逐级改坐标）；
				// 枢轴必须是子树根自身的 origin —— 换枢轴时该表示不成立，走下面的兜底。
				plan.node_rotation = quarter_turn.clone().multiply(getNodeRotationQuaternion(root));
			} else {
				notifyRotateNotRepresentable();
				plan.turn = legacy_turn;
			}
		}
		plans.set(root, plan);
		return plan;
	};
	affected.forEach(getPlan);
	groups.forEach(getPlan);

	Undo.initEdit({elements: affected, groups});
	affected.forEach(function(obj) {
		let plan = getPlan(obj);
		if (plan.node_rotation) return;
		obj.roll(plan.turn.axis, plan.turn.steps, plan.pivot);
	})
	groups.forEach(function(group) {
		let plan = getPlan(group);
		if (plan.node_rotation) return;
		rotateGroupRigid(group, plan.turn.axis, plan.turn.steps, new THREE.Vector3().fromArray(plan.pivot), getRollQuaternion(plan.turn.axis, plan.turn.steps));
	})
	let baked = false;
	plans.forEach(plan => {
		if (!plan.node_rotation) {
			baked = true;
			return;
		}
		setNodeRotationFromQuaternion(plan.root, plan.node_rotation);
		if (plan.root instanceof Group) {
			Canvas.updateView({groups: [plan.root], group_aspects: {transform: true}});
		} else {
			Canvas.updateView({elements: [plan.root], element_aspects: {transform: true, geometry: false}});
		}
	});
	if (baked && groups.length) Canvas.updateView({elements: affected, groups});
	updateSelection();
	Undo.finishEdit('Rotate elements')
}
//Mirror
export function flipNameOnAxis(node, axis, check, original_name) {
	const flip_pairs = {
		0: {
			right: 'left',
			Right: 'Left',
			RIGHT: 'LEFT',
			R: 'L',
			r: 'l',
		},
		1: {
			top: 'bottom',
			Top: 'Bottom',
			TOP: 'BOTTOM',
		},
		2: {
			back: 'front',
			rear: 'front',
			Back: 'Front',
			Rear: 'Front',
			BACK: 'FRONT',
			REAR: 'FRONT',
		}
	};
	function matchAndReplace(a, b, order) {
		if (!node.name.includes(a)) return false;
		let name = original_name ?? node.name;
		let regex_filter = a;
		if (a.length == 1) {
			regex_filter = new RegExp(`(?<=^|[_. -])${a}(?=[_. -]|$)`);
		}
		name = name.replace(regex_filter, b);
		if (name == (original_name ?? node.name)) return false;

		if (!original_name) {
			name = name.replace(/2$/, '');
		}
		if (!check || check(name, order)) node.name = name;
		return node.name;
	}
	let pairs = flip_pairs[axis];
	Blockbench.dispatchEvent('flip_node_name', {pairs, node, axis, original_name});
	for (let a in pairs) {
		let b = pairs[a];
		if (matchAndReplace(a, b, 0)) break;
		if (matchAndReplace(b, a, 1)) break;
	}
	return node.name;
}
/**
 * 反馈#299：轴对齐（未旋转）时的镜像主体，不含 Undo 记录——倾斜轴面要在旋转后的坐标系里复用它。
 */
function flipSelectionOnAxisPlane(axis) {
	// 反馈#305 第 5 点：镜像翻转不传播到智能复制组的对侧（组级属性不同步），组内单位照常同步
	if (typeof SmartCopyGroup != 'undefined') SmartCopyGroup.markGroupFlip();
	// 反馈#276：镜像面取滑条偏移后的翻转轴面（偏移为 0 时就是原来的画布中心）
	let center = FlipPlane.position(axis);
	if (Format.bone_rig) {
		for (let group of Group.multi_selected) {
			function flipGroup(group) {
				for (let i = 0; i < 3; i++) {
					if (i === axis) {
						// 骨骼格式的原点坐标本来就是居中的（画布中心 = 0），轴面偏移直接叠加
						group.origin[i] = FlipPlane.offset[axis] * 2 - group.origin[i]
					} else {
						group.rotation[i] *= -1
					}
				}
				flipNameOnAxis(group, axis, name => (!Group.all.find(g => g.name == name)), group.temp_data.old_name);
				Canvas.updateAllBones([group]);
			}
			flipGroup(group);
			group.forEachChild(flipGroup, Group);
		}
	}
	Outliner.selected.forEach(function(obj) {
		if (obj instanceof Mesh) {
			obj.flipSelection(axis);
		} else {
			obj.flip(axis, center, false);
		}
	})
}
/**
 * 反馈#299：锁面/镜像要一起参与刚性旋转的节点——选区元素 + 骨骼格式下被镜像的选中组。
 * 组的后代由 rotateNodesRigidly 自己展开（它按子树根遍历，不会重复变换）。
 */
function getFlipPlaneRotationNodes() {
	let nodes = Outliner.selected.slice();
	if (Format.bone_rig) {
		for (let group of Group.multi_selected) {
			if (!nodes.includes(group)) nodes.push(group);
		}
	}
	return nodes;
}
/**
 * 反馈#299：把节点列表展开成「组 + 元素」两个集合（组按子树根遍历，重复引用只算一次）。
 * 既给刚性旋转用，也给 Undo 快照用——倾斜镜像会改到选中组的后代节点，快照必须覆盖它们。
 */
function collectSubtreeNodes(nodes) {
	let groups = [];
	let elements = [];
	let visited = new Set();
	function visit(node) {
		if (!node || visited.has(node)) return;
		visited.add(node);
		if (node instanceof Group) {
			groups.push(node);
			for (let child of node.children) visit(child);
		} else if (node.rotation && node.origin) {
			elements.push(node);
		}
	}
	nodes.forEach(visit);
	return {groups, elements};
}
/**
 * 反馈#299：把节点（含组内后代）绕 pivot 做一次刚性旋转。
 * - 组：rotation ← R·rotation·R⁻¹、origin ← R(origin−pivot)+pivot（层级各自在本层坐标系里共轭，
 *   嵌套也成立）。
 * - 元素：rotation ← R·rotation、origin ← R(origin−pivot)+pivot；方块的 from/to 与网格的顶点是绝对坐标
 *   （渲染时只减去 origin 得到局部几何），枢轴换位置后必须按同一个增量平移，否则方块整体错位。
 * 先绕 pivot 转 −θ、跑原有轴对齐镜像、再转回 +θ，合成结果正是倾斜轴面的反射 R(θ)·D·R(−θ)。
 */
function rotateNodesRigidly(nodes, quaternion, pivot) {
	let {groups, elements} = collectSubtreeNodes(nodes);
	if (!groups.length && !elements.length) return;
	let inverse = quaternion.clone().invert();
	function rotatedOrigin(node) {
		return new THREE.Vector3().fromArray(node.origin).sub(pivot).applyQuaternion(quaternion).add(pivot);
	}
	groups.forEach(group => {
		let origin = rotatedOrigin(group);
		let rotation = quaternion.clone().multiply(getNodeRotationQuaternion(group)).multiply(inverse);
		group.origin.V3_set([origin.x, origin.y, origin.z]);
		setNodeRotationFromQuaternion(group, rotation);
	});
	elements.forEach(element => {
		let origin = rotatedOrigin(element);
		let delta = [origin.x - element.origin[0], origin.y - element.origin[1], origin.z - element.origin[2]];
		let rotation = quaternion.clone().multiply(getNodeRotationQuaternion(element));
		element.origin.V3_set([origin.x, origin.y, origin.z]);
		setNodeRotationFromQuaternion(element, rotation);
		if (element.from && element.to) {
			for (let i = 0; i < 3; i++) {
				element.from[i] += delta[i];
				element.to[i] += delta[i];
			}
		} else if (element.vertices) {
			for (let key in element.vertices) {
				let vertex = element.vertices[key];
				if (!vertex) continue;
				for (let i = 0; i < 3; i++) vertex[i] += delta[i];
			}
		}
	});
	Canvas.updateView({elements, groups});
	if (Format.bone_rig) Canvas.updateAllBones(groups);
}
/**
 * 反馈#301：按轴对齐镜像面镜像「给定节点集合」（含组内后代），不写 Undo、不读选区。
 * 元素沿用各自 flip()/flipSelection()（几何、面 UV、旋转、名称一起翻），组按 D·R·D 翻转
 * （ZYX 欧拉序下等价于把另外两个分量取反）并镜像 origin，名称按左右/前后翻到对侧。
 */
function mirrorNodesOnAxisPlane(nodes, axis) {
	// 反馈#305 第 5 点：翻转不传播到智能复制组的对侧（组级属性不同步）
	if (typeof SmartCopyGroup != 'undefined') SmartCopyGroup.markGroupFlip();
	let center = FlipPlane.position(axis);
	let {groups, elements} = collectSubtreeNodes(nodes);
	elements.forEach(element => {
		if (element instanceof Mesh) {
			element.flipSelection(axis, center, false);
		} else if (element.flip) {
			element.flip(axis, center, false);
		}
	});
	groups.forEach(group => {
		for (let i = 0; i < 3; i++) {
			if (i === axis) {
				group.origin[i] = center * 2 - group.origin[i];
			} else {
				group.rotation[i] *= -1;
			}
		}
		flipNameOnAxis(group, axis, name => !Group.all.find(g => g.name == name));
	});
	Canvas.updateView({elements, groups});
	if (Format.bone_rig) Canvas.updateAllBones(groups);
	return {groups, elements};
}
/**
 * 反馈#299/#301：把给定节点集合按当前翻转轴面（含位置与旋转角）镜像一次。
 * 轴面未旋转时就是轴对齐镜像；旋转过时先刚性转 −θ、按轴对齐镜像、再转回 +θ，合成倾斜面的反射。
 * 返回被改动的 {groups, elements}，供调用方写 Undo 后置快照。
 */
export function reflectNodesAboutFlipPlane(nodes, axis) {
	if (FlipPlane.isAligned(axis)) return mirrorNodesOnAxisPlane(nodes, axis);
	let pivot = new THREE.Vector3().fromArray(FlipPlane.center());
	let rotation_axis = FlipPlane.rotationAxis(axis);
	let axis_vector = new THREE.Vector3(
		rotation_axis === 0 ? 1 : 0,
		rotation_axis === 1 ? 1 : 0,
		rotation_axis === 2 ? 1 : 0
	);
	let rad = Math.degToRad(FlipPlane.rotation[axis]);
	rotateNodesRigidly(nodes, new THREE.Quaternion().setFromAxisAngle(axis_vector, -rad), pivot);
	let targets = mirrorNodesOnAxisPlane(nodes, axis);
	rotateNodesRigidly(nodes, new THREE.Quaternion().setFromAxisAngle(axis_vector, rad), pivot);
	return targets;
}
export function mirrorSelected(axis) {
	if (Modes.animate && Timeline.selected.length) {

		Undo.initEdit({keyframes: Timeline.selected})
		for (var kf of Timeline.selected) {
			kf.flip(axis)
		}
		Undo.finishEdit('Flipped keyframes');
		updateKeyframeSelection();
		Animator.preview();

	} else if (Modes.edit && (Outliner.selected.length || Group.first_selected)) {
		// 反馈#299：倾斜轴面的镜像会顺带刚性旋转选中组的后代，快照要覆盖这些节点
		let tilt_nodes = FlipPlane.isAligned(axis) ? null : collectSubtreeNodes(getFlipPlaneRotationNodes());
		let undo_elements = Outliner.selected;
		if (tilt_nodes && tilt_nodes.elements.length) {
			undo_elements = undo_elements.slice();
			for (let element of tilt_nodes.elements) {
				if (!undo_elements.includes(element)) undo_elements.push(element);
			}
		}
		let undo_groups = Format.bone_rig
			? Group.all.filter(g => g.selected)
			: (tilt_nodes && tilt_nodes.groups.length ? tilt_nodes.groups : undefined);
		Undo.initEdit({
			elements: undo_elements,
			groups: undo_groups,
			outliner: Format.bone_rig || Group.first_selected,
			selection: true
		});
		// 反馈#299：轴面旋转过时走斜向反射（转 −θ → 轴对齐镜像 → 转回 +θ），未旋转时保持原路径
		if (!tilt_nodes) {
			flipSelectionOnAxisPlane(axis);
		} else {
			let pivot = new THREE.Vector3().fromArray(FlipPlane.center());
			let rotation_axis = FlipPlane.rotationAxis(axis);
			let rotation_axis_vector = new THREE.Vector3(
				rotation_axis === 0 ? 1 : 0,
				rotation_axis === 1 ? 1 : 0,
				rotation_axis === 2 ? 1 : 0
			);
			let rad = Math.degToRad(FlipPlane.rotation[axis]);
			let nodes = getFlipPlaneRotationNodes();
			rotateNodesRigidly(nodes, new THREE.Quaternion().setFromAxisAngle(rotation_axis_vector, -rad), pivot);
			flipSelectionOnAxisPlane(axis);
			rotateNodesRigidly(nodes, new THREE.Quaternion().setFromAxisAngle(rotation_axis_vector, rad), pivot);
		}
		updateSelection()
		Undo.finishEdit('Flip selection')
		autoFixMeshEdit()
	}
}
/** 把选区公共镜像中心从模型空间转换到元素数据所使用的父级空间。 */
function getSharedCenterAlongAxis(element, axis, selection_center) {
	let point = new THREE.Vector3().fromArray(selection_center);
	if (!Format.centered_grid) point.sub(new THREE.Vector3(8, 0, 8));
	element.mesh.parent.updateWorldMatrix(true, false);
	element.mesh.parent.worldToLocal(point);
	if (element.parent instanceof Group && element.parent.getTypeBehavior('use_absolute_position')) {
		point.x += element.parent.origin[0];
		point.y += element.parent.origin[1];
		point.z += element.parent.origin[2];
	}
	return point.getComponent(axis);
}
/**
 * 单元素就地翻转使用几何自身中心（#192）；多元素使用整个选区的中心（#216）。
 */
function getCubeCenterAlongAxis(cube, axis, selection_center) {
	if (selection_center && cube.mesh?.parent) {
		return getSharedCenterAlongAxis(cube, axis, selection_center);
	}
	if (!cube.mesh) return Math.lerp(cube.from[axis], cube.to[axis], 0.5);
	let offset = new THREE.Vector3(
		(cube.from[0] + cube.to[0]) / 2 - cube.origin[0],
		(cube.from[1] + cube.to[1]) / 2 - cube.origin[1],
		(cube.from[2] + cube.to[2]) / 2 - cube.origin[2],
	);
	offset.multiply(cube.mesh.scale);
	offset.applyQuaternion(cube.mesh.quaternion);
	return cube.origin[axis] + offset.getComponent(axis);
}
export function mirrorSelectedInPlace(axis) {
	if (!Modes.edit) return;
	if (!(Outliner.selected.length || Group.first_selected)) return;
	Undo.initEdit({
		elements: Outliner.selected,
		groups: Format.bone_rig ? Group.all.filter(g => g.selected) : undefined,
		outliner: Format.bone_rig || Group.first_selected,
		selection: true
	});
	const selection_center = Outliner.selected.length > 1 && (BarItems.selection_mode.value == 'object' || Group.first_selected)
		? getSelectionCenter()
		: null;
	if (Format.bone_rig) {
		for (let group of Group.multi_selected) {
			function flipGroup(group) {
				for (let i = 0; i < 3; i++) {
					if (i !== axis) {
						group.rotation[i] *= -1
					}
				}
				flipNameOnAxis(group, axis, name => (!Group.all.find(g => g.name == name)), group.temp_data.old_name);
				Canvas.updateAllBones([group]);
			}
			flipGroup(group);
			group.forEachChild(flipGroup, Group);
		}
	}
	Outliner.selected.forEach(function(obj) {
		if (obj instanceof Mesh) {
			let center = selection_center ? getSharedCenterAlongAxis(obj, axis, selection_center) : obj.origin[axis];
			obj.flipSelection(axis, center, !selection_center);
		} else if (obj instanceof Cube) {
			obj.flip(axis, getCubeCenterAlongAxis(obj, axis, selection_center), false);
		} else {
			obj.flip(axis, obj.origin[axis], true);
		}
	})
	updateSelection();
	Undo.finishEdit('Flip selection in place');
	autoFixMeshEdit();
}

//Center
/** Convert a world-space displacement to the data space of a node's parent, including nested scale. */
function getWorldDeltaInParentSpace(node, world_delta, own_geometry = false) {
	let transform = own_geometry ? node.mesh : node.mesh?.parent;
	if (!transform) return world_delta.clone();
	transform.updateWorldMatrix(true, false);
	let inverse = new THREE.Matrix4().copy(transform.matrixWorld).invert();
	let e = inverse.elements;
	// A displacement has w = 0: apply only the inverse linear transform, not its translation.
	return new THREE.Vector3(
		e[0] * world_delta.x + e[4] * world_delta.y + e[8] * world_delta.z,
		e[1] * world_delta.x + e[5] * world_delta.y + e[9] * world_delta.z,
		e[2] * world_delta.x + e[6] * world_delta.y + e[10] * world_delta.z
	);
}
function getLocalAxisLockReference() {
	if (Group.first_selected) return Group.first_selected;
	// #220：不再只认方块——单个网格/样条网格也可以作为自身轴锁定的参考
	return Outliner.selected.find(el => el.mesh);
}
export function getLocalAxisInWorld(node, axis) {
	node.mesh.updateWorldMatrix(true, false);
	return new THREE.Vector3().setFromMatrixColumn(node.mesh.matrixWorld, axis).normalize();
}
/** #220：位置/旋转的自身轴锁定开关（按工具取；其它工具没有锁定）。 */
export function getAxisLockToggle(tool_id) {
	if (tool_id === 'move_tool') return BarItems.position_slider_local_axis_lock;
	if (tool_id === 'rotate_tool') return BarItems.rotation_slider_local_axis_lock;
}
/** #220：锁定生效时的参考元素（首个所选方块或组）；开关关闭或不在自身空间时为 undefined。 */
export function getAxisLockReference(tool_id = Toolbox.selected?.id) {
	let toggle = getAxisLockToggle(tool_id);
	if (!toggle || !toggle.value) return;
	let space = tool_id === 'rotate_tool' ? BarItems.rotation_space?.value : BarItems.transform_space?.value;
	if (space !== 'local') return;
	let reference = getLocalAxisLockReference();
	return reference?.mesh ? reference : undefined;
}
/** Apply one world-space delta to selected roots, baking bone-rig descendants into absolute model data. */
export function moveSelectionInWorldAxis(difference, world_axis) {
	let world_delta = world_axis.clone().multiplyScalar(difference);
	let selected_groups = Group.multi_selected.slice();
	let root_groups = selected_groups.filter(group => !group.parent?.selected);
	let groups = [];
	let direct_elements = Outliner.selected.filter(element => !selected_groups.some(group => element.isChildOf(group, 128)));
	let elements = [];
	function moveElement(obj, local_delta) {
		if (obj.from) {
			obj.from.V3_add(local_delta.x, local_delta.y, local_delta.z);
			if (obj.to) obj.to.V3_add(local_delta.x, local_delta.y, local_delta.z);
		} else if (obj.position) {
			obj.position.V3_add(local_delta.x, local_delta.y, local_delta.z);
		}
		if (obj.getTypeBehavior('rotatable') && !obj.position && obj instanceof TextureMesh == false) {
			obj.origin.V3_add(local_delta.x, local_delta.y, local_delta.z);
		}
		if (obj instanceof Cube && obj.autouv == 2) obj.mapAutoUV();
	}
	for (let group of root_groups) {
		let local_delta = getWorldDeltaInParentSpace(group, world_delta);
		if (Format.bone_rig) {
			// 骨骼格式中组与元素的坐标都是绝对数据；只改根组 origin 会让后代在下次完整刷新时回弹。
			group.forEachChild(node => {
				if (node instanceof Group) {
					node.origin.V3_add(local_delta.x, local_delta.y, local_delta.z);
					groups.safePush(node);
				} else {
					moveElement(node, local_delta);
					elements.safePush(node);
				}
			}, undefined, true);
		} else {
			group.origin.V3_add(local_delta.x, local_delta.y, local_delta.z);
			groups.safePush(group);
		}
	}
	for (let obj of direct_elements) {
		moveElement(obj, getWorldDeltaInParentSpace(obj, world_delta));
		elements.safePush(obj);
	}
	Canvas.updateView({
		elements,
		groups,
		element_aspects: {transform: true},
		group_aspects: {transform: true},
		selection: true,
	});
}
export function centerElements(axis, update) {
	if (!Outliner.selected.length) return;
	let center = getSelectionCenter()[axis];
	var difference = (Format.centered_grid ? 0 : 8) - center
	let world_delta = new THREE.Vector3();
	world_delta.setComponent(axis, difference);

	Outliner.selected.forEach(function(obj) {
		let local_delta = getWorldDeltaInParentSpace(obj, world_delta);
		if (obj.getTypeBehavior('movable')) obj.origin.V3_add(local_delta.x, local_delta.y, local_delta.z);
		if (obj.from) obj.from.V3_add(local_delta.x, local_delta.y, local_delta.z);
		if (obj.to) obj.to.V3_add(local_delta.x, local_delta.y, local_delta.z);
		if (obj instanceof Cube && Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
			Format.cube_size_limiter.move(obj);
		}
	})
	Group.all.forEach(group => {
		if (!group.selected) return;
		if (!Format.bone_rig && Outliner.selected.length) return;
		let local_delta = getWorldDeltaInParentSpace(group, world_delta);
		group.origin.V3_add(local_delta.x, local_delta.y, local_delta.z);
	})
	Canvas.updateView({
		elements: Outliner.selected,
		groups: Group.all.filter(g => g.selected),
		element_aspects: {transform: true},
		group_aspects: {transform: true},
		selection: true
	})
}

//Move
/** 仅单独直接选中一个智能根时，整组变换写入实例层；其它选择保持原生烘焙行为。 */
export function getSmartInstanceTransformGroup() {
	const group = Group.first_selected;
	if (!group?.smart_object || Group.multi_selected.length != 1) return;
	return (Outliner.selected.length == 0 || group.matchesSelection()) ? group : undefined;
}
export function scaleSmartInstance(group, factors, origin) {
	const old_scale = group.temp_data.old_smart_scale || group.smart_object_scale;
	const old_position = group.temp_data.old_smart_position || group.smart_object_position;
	for (let i = 0; i < 3; i++) {
		const factor = factors[i];
		group.smart_object_scale[i] = old_scale[i] * factor;
		if (origin) {
			group.smart_object_position[i] = old_position[i] * factor + (origin[i] - group.origin[i]) * (1 - factor);
		}
	}
	group.preview_controller.updateTransform(group);
	// 反馈#234：同一帧内 gizmo/选择中心会立即读世界矩阵，实例层自己刷新，不等渲染循环
	(group._smart_instance_container || group.mesh).updateWorldMatrix(true, false);
}

//Move
export function moveElementsInSpace(difference, axis, space = getEditTransformSpace()) {
	let groups;
	var group_m;
	let quaternion = new THREE.Quaternion();
	let vector = new THREE.Vector3();
	let world_axis = axis instanceof THREE.Vector3;
	const smart_group = getSmartInstanceTransformGroup();
	if (smart_group) {
		if (world_axis) {
			vector.copy(axis).multiplyScalar(difference);
		} else {
			vector.set(0, 0, 0)[getAxisLetter(axis)] = difference;
		}
		if (space === 0 || world_axis) {
			vector.copy(getWorldDeltaInParentSpace(smart_group, vector));
		} else if (space === 2) {
			vector.applyQuaternion(smart_group.mesh.quaternion);
		}
		smart_group.smart_object_position.V3_add(vector.x, vector.y, vector.z);
		smart_group.preview_controller.updateTransform(smart_group);
		// 反馈#234：拖动过程中 gizmo/选择中心立刻读世界矩阵，必须在本帧内刷新实例层
		(smart_group._smart_instance_container || smart_group.mesh).updateWorldMatrix(true, false);
		return;
	}
	if (Format.bone_rig && Group.first_selected && (Group.multi_selected.length > 1 || Group.first_selected.matchesSelection())) {
		groups = Group.multi_selected;
	}

	if (groups) {
		for (let group of groups) {
			if (space === 0) {
				if (world_axis) {
					let world_delta = axis.clone().multiplyScalar(difference);
					group_m = getWorldDeltaInParentSpace(group, world_delta);
				} else {
					group_m = vector.set(0, 0, 0);
					group_m[getAxisLetter(axis)] = difference;

					let rotation = new THREE.Quaternion();
					groups[0].mesh.parent.getWorldQuaternion(rotation);
					group_m.applyQuaternion(rotation.invert());
				}

				group.forEachChild(g => {
					g.origin.V3_add(group_m.x, group_m.y, group_m.z);
				}, Group, true)

			} else if (space === 2) {
				group_m = new THREE.Vector3();
				group_m[getAxisLetter(axis)] = difference;

				group_m.applyQuaternion(group.mesh.quaternion);

				group.forEachChild(g => {
					g.origin.V3_add(group_m.x, group_m.y, group_m.z);
				}, Group, true)

			} else {
				group.forEachChild(g => {
					g.origin[axis] += difference
				}, Group, true)
			}
			Group.preview_controller.updateTransform(group);
		}
	}

	Outliner.selected.forEach(el => {

		if (el.getTypeBehavior('movable') == false) return;
		if (!el.getTypeBehavior('use_absolute_position') && el.parent?.selected && el.parent.getTypeBehavior('movable') && !el.parent.getTypeBehavior('use_absolute_position')) {
			return;
		}

		// General Vertex translation (Mesh & SplineMesh)
		if (!group_m && (el instanceof Mesh || el instanceof SplineMesh) && (el.getSelectedVertices().length > 0 || space >= 2)) {

			let selection_rotation = space == 3 && el.getSelectionRotation();
			let selected_vertices = el.getSelectedVertices();
			if (!selected_vertices.length) selected_vertices = Object.keys(el.vertices);

			let difference_vec = [0, 0, 0];
			if (space == 2) {
				difference_vec[axis] += difference;

			} else if (space == 3) {
				let m = vector.set(0, 0, 0);
				m[getAxisLetter(axis)] = difference;
				m.applyEuler(selection_rotation);
				difference_vec.V3_set(m.x, m.y, m.z);

			} else if (space instanceof OutlinerNode) {
				let m = vector.set(0, 0, 0);
				m[getAxisLetter(axis)] = difference;
				m.applyQuaternion(new THREE.Quaternion().copy(el.mesh.quaternion).invert());
				difference_vec.V3_set(m.x, m.y, m.z);

			} else {
				let m;
				if (world_axis) {
					m = getWorldDeltaInParentSpace(el, axis.clone().multiplyScalar(difference), true);
				} else {
					m = vector.set(0, 0, 0);
					m[getAxisLetter(axis)] = difference;
					m.applyQuaternion(el.mesh.getWorldQuaternion(quaternion).invert());
				}
				difference_vec.V3_set(m.x, m.y, m.z);
			}

			// Perform vertex movement
			selected_vertices.forEach(vkey => {
				el.vertices[vkey].V3_add(difference_vec);
				if (el instanceof SplineMesh) el.applyHandleModeOnVertex(vkey);
			})

			// mirror modeling: Snap to middle to connect
			if (el instanceof SplineMesh) return; // Spline meshes don't support mirror modeling, or proportional editing (TODO ?)
			if (
				BarItems.mirror_modeling.value &&
				difference_vec[0] &&
				selected_vertices.allAre(vkey => Math.epsilon(el.vertices[vkey][0], el.vertices[selected_vertices[0]][0], 0.02)) && // All vertices same X
				Math.sign(el.vertices[selected_vertices[0]][0]) != Math.sign(el.vertices[selected_vertices[0]][0] - difference_vec[0]) && // movement crossed center
				el.vertices[selected_vertices[0]][0] && (el.vertices[selected_vertices[0]][0] - difference_vec[0])
			) {
				selected_vertices.forEach(vkey => {
					el.vertices[vkey][0] = 0;
				})
			}

			ProportionalEdit.editVertices(el, (vkey, blend) => {
				el.vertices[vkey].V3_add(difference_vec[0] * blend, difference_vec[1] * blend, difference_vec[2] * blend);
			})

		}
		else {

			let old_position = el.position?.slice();
		
			if (space == 2 && !group_m) {
				if (el.position) {
					let m = vector.set(0, 0, 0);
					m[getAxisLetter(axis)] = difference;
					m.applyQuaternion(el.mesh.quaternion);
					el.position.V3_add(m.x, m.y, m.z);

				} else if (el instanceof TextureMesh) {
					el.local_pivot[axis] += difference;

				} else {
					if (el.getTypeBehavior('movable')) el.from[axis] += difference;
					if (el.getTypeBehavior('resizable') && el.to) el.to[axis] += difference;
					
					if (el instanceof Cube && Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
						Format.cube_size_limiter.move(el);
					}
				}
				
			} else if (space instanceof OutlinerNode) {
				if (el.getTypeBehavior('movable') && el.from instanceof Array) {
					el.from[axis] += difference;
				} else if (el.getTypeBehavior('movable') && el.position) {
					el.position[axis] += difference;
				}
				if (el.getTypeBehavior('resizable') && el.to instanceof Array) el.to[axis] += difference;
				if (el.getTypeBehavior('rotatable') && !el.position) el.origin[axis] += difference;
			} else {
				let move_origin = !!groups;
				if (group_m && !world_axis) {
					var m = group_m
				} else if (world_axis) {
					var m = getWorldDeltaInParentSpace(el, axis.clone().multiplyScalar(difference));
					move_origin = true;
				} else {
					var m = vector.set(0, 0, 0);
					m[getAxisLetter(axis)] = difference;
					
					let parent = el.parent;
					while (parent instanceof Group) {
						if (!parent.rotation.allEqual(0)) break;
						parent = parent.parent;
					}

					if (parent == 'root') {
						// If none of the parent groups are rotated, move origin.
						move_origin = true;
					} else {
						var rotation = new THREE.Quaternion();
						if (el.mesh && !el.position && el instanceof Mesh == false) {
							el.mesh.getWorldQuaternion(rotation);
						} else if (el.parent instanceof Group) {
							el.parent.mesh.getWorldQuaternion(rotation);
						}
						m.applyQuaternion(rotation.invert());
					}
				}

				if (el.from) {
					el.from.V3_add(m.x, m.y, m.z);
					if (el.to) el.to.V3_add(m.x, m.y, m.z);
				} else if (el instanceof Mesh && move_origin) {
					el.position.V3_add(m.x, m.y, m.z);
					
				} else if (el.position) {
					el.position.V3_add(m.x, m.y, m.z);
				} 
				if (move_origin) {
					if (el.getTypeBehavior('rotatable') && !el.position && el instanceof TextureMesh == false) {
						el.origin.V3_add(m.x, m.y, m.z);
					}
				}
			}

			// Counter child positions
			if (el.getTypeBehavior('parent') && el.getTypeBehavior('movable') && !el.getTypeBehavior('use_absolute_position')) {
				for (let child of el.children) {
					if (child.selected || !el.position) continue;
					let position_delta = Reusable.vec2.fromArray(el.position.slice().V3_subtract(old_position));
					position_delta.applyQuaternion(Reusable.quat1.copy(el.mesh.quaternion).invert());
					child.position.V3_subtract(position_delta.toArray());

					child.preview_controller.updateTransform(child);
				}
			}
		}
		if (el instanceof Cube && el.autouv == 2) {
			el.mapAutoUV()
		}
		if (el instanceof SplineMesh && BarItems.spline_selection_mode.value == "handles") {
			el.refreshTubeFaces();
		}
	})
	Canvas.updateView({
		elements: Outliner.selected,
		element_aspects: {transform: true, geometry: true},
		groups: Group.all.filter(g => g.selected),
		group_aspects: {transform: true}
	})
}
/**
 * Apply local offset, including children
 */
function changeNodeLocalPosition(obj, vector) {
	// Needs cleaning up

	let absolute_position = Format.bone_rig &&
		obj.parent instanceof OutlinerNode &&
		obj.parent.getTypeBehavior('parent') &&
		obj.parent.getTypeBehavior('use_absolute_position');
	if (absolute_position) {
		vector.x += obj.parent.origin[0];
		vector.y += obj.parent.origin[1];
		vector.z += obj.parent.origin[2];
	}

	let position_arr = vector.toArray();
	if (obj.smart_object) {
		obj.smart_object_position.V3_set(position_arr.slice().V3_subtract(obj.origin));
		obj.preview_controller.updateTransform(obj);
		return;
	}
	
	// Offset children
	if ('forEachChild' in obj && obj.getTypeBehavior('use_absolute_position')) {
		let difference = position_arr.slice().V3_subtract(obj.origin);
		obj.forEachChild(child => {
			/*if (child instanceof Mesh) {
				for (let vkey in child.vertices) {
					child.vertices[vkey].V3_add(difference);
				}
			}*/
			if (child.from) child.from.V3_add(difference);
			if (child.to) child.to.V3_add(difference);
			if (child.origin) child.origin.V3_add(difference);
		})
	}

	// Offset self
	if (obj.getTypeBehavior('movable')) {
		if (obj.from && obj.to) {
			position_arr.V3_subtract(obj.origin);
			obj.from.V3_add(position_arr);
			obj.to.V3_add(position_arr);
			if (obj.origin) obj.origin.V3_add(position_arr);
		} else if (obj.position) {
			obj.position.V3_set(position_arr);
		} else if (obj.origin) {
			obj.origin.V3_set(position_arr);
		}
	}
}

export function getSelectedMovingElements() {
	let selection = Outliner.selected.filter(el => el.movable || el.getTypeBehavior('movable'));
	for (let el of selection.slice()) {
		if (el.getTypeBehavior('parent') && !el.getTypeBehavior('use_absolute_position')) {
			selection.safePush(...el.children);
		}
	}
	return selection;
}

/**
 * Collects everything that Group.transferOrigin mutates besides the passed groups
 * themselves: all descendant elements (from/to/origin) and nested groups (origin).
 * Undo snapshots of transferOrigin edits must include these nodes, otherwise undoing
 * restores only the selected group's origin and leaves the compensation offsets on
 * its children, visibly displacing the model whenever the group has a rotation.
 */
export function getGroupTransferOriginUndoNodes(selected_groups) {
	let groups = selected_groups.slice();
	let elements = [];
	for (let group of selected_groups) {
		group.forEachChild(child => {
			if (child instanceof Group) {
				groups.safePush(child);
			} else {
				elements.safePush(child);
			}
		});
	}
	return {elements, groups};
}

export function getSpatialInterval(event = 0) {
	return canvasGridSize(event.shiftKey || Pressing.overrides.shift, event.ctrlOrCmd || Pressing.overrides.ctrl);
}
//Rotate
export function getRotationInterval(event) {
	if (Format.rotation_snap) {
		return 22.5;
	} else if ((event.shiftKey || Pressing.overrides.shift) && (event.ctrlOrCmd || Pressing.overrides.ctrl)) {
		return 0.25;
	} else if (event.shiftKey || Pressing.overrides.shift) {
		return 22.5;
	} else if (event.ctrlOrCmd || Pressing.overrides.ctrl) {
		return 1;
	} else {
		return 2.5;
	}
}
export function getRotationObjects() {
	if (Format.bone_rig && Group.first_selected) return Group.multi_selected.filter(g => !g.parent?.selected);
	let elements = Outliner.selected.filter(element => {
		if (!element.getTypeBehavior('rotatable')) return false;
		if (!(element instanceof Cube == false || Format.rotate_cubes)) return false;
		if (element.parent instanceof OutlinerElement && element.parent.selected) return false;
		return true;
	})
	if (elements.length) return elements;
}
export function getPivotObjects() {
	if (Format.bone_rig && Group.first_selected) return Group.multi_selected;
	let elements = Outliner.selected.filter(element => {
		return (element.getTypeBehavior('has_pivot')) && (element instanceof Cube == false || Format.rotate_cubes);
	})
	if (elements.length) return elements;
}
export function getParentTransformSpace() {
	if (Format.bone_rig && Group.first_selected && Group.first_selected.matchesSelection()) {
		if (Group.first_selected.parent instanceof Group) {
			return Group.first_selected.parent;
		} else {
			return 0;
		}
	}
	let bone = 0;
	if (Outliner.selected.length) {
		bone = Outliner.selected[0].parent;
	} else if (Group.first_selected && Group.first_selected.parent instanceof Group) {
		bone = Group.first_selected.parent;
	}
	for (var el of Outliner.selected) {
		if (el.parent !== bone) {
			bone = 0;
			break;
		}
	}
	return bone instanceof OutlinerNode ? bone : 0;
}
/**
 * 编号68「固定世界位置」：组旋转时让后代吸收逆旋转，世界几何保持不变。
 * q̃ = q_new⁻¹·q_old（组局部旋转增量的逆）。直接子级：origin 绕组枢轴施加 q̃，
 * rotation 属性左乘 q̃（旋转值变化，但世界位置与姿态不变）；from/to/vertices 是
 * 绝对几何坐标，只随 origin 的位移差平移——绝不能旋转它们：块的 from/to 只是
 * 轴对齐盒的两个角点，旋转角点后按轴对齐盒重建会改变尺寸/形状（#76 平行六面体变形）。
 * 更深后代的局部关系不变，绝对坐标随直接子组枢轴的位移差平移（其局部旋转值保持不变）。
 * 数学依据：world = M_g·ΠP_i，P' 链满足 ΠP' = (M_g'⁻¹M_g)·ΠP = q̃·ΠP，
 * 仅需对直接子级 P_1 左乘 q̃，且保持几何点与 origin 的相对偏移 v'-o' = v-o 即可精确保持世界。
 */
export function compensateGroupRotationFixedWorld(group, q_old, q_new) {
	if (q_old.angleTo(q_new) < 1e-7) return;
	let q_tilde = q_new.clone().invert().multiply(q_old);
	let pivot = new THREE.Vector3().fromArray(group.origin);
	let vec = new THREE.Vector3();
	let order = group.mesh?.rotation?.order || Format.euler_order || 'ZYX';
	let elements_updated = [];
	let groups_updated = [];
	let unsupported_cubes = [];
	group.children.forEach(child => {
		if (!child.origin) return;
		let old_origin = child.origin.slice();
		vec.fromArray(old_origin).sub(pivot).applyQuaternion(q_tilde).add(pivot);
		let diff = [vec.x - old_origin[0], vec.y - old_origin[1], vec.z - old_origin[2]];
		let has_diff = Math.abs(diff[0]) + Math.abs(diff[1]) + Math.abs(diff[2]) > 1e-9;

		// 旋转吸收：q_c' = q̃·q_c（直接子级旋转值变化，世界姿态不变）
		let rotatable = (child instanceof Group) || (child.getTypeBehavior && child.getTypeBehavior('rotatable'));
		let new_rotation;
		if (rotatable && child.rotation) {
			let child_order = child.mesh?.rotation?.order || order;
			let qc = new THREE.Quaternion().setFromEuler(new THREE.Euler(
				Math.degToRad(child.rotation[0]),
				Math.degToRad(child.rotation[1]),
				Math.degToRad(child.rotation[2]),
				child_order
			));
			qc.premultiply(q_tilde);
			let e = new THREE.Euler().setFromQuaternion(qc, child_order);
			new_rotation = [
				Math.roundTo(Math.radToDeg(e.x), 4),
				Math.roundTo(Math.radToDeg(e.y), 4),
				Math.roundTo(Math.radToDeg(e.z), 4)
			];
		}
		// 单轴旋转限制格式的块无法表达任意补偿旋转：放弃补偿（随组刚性旋转），
		// 给出明确提示，而不是写入非法欧拉角造成静默变形
		if (new_rotation && child instanceof Cube && Format.rotation_limit && child.getTypeBehavior('cube_rotation_limit')) {
			if (new_rotation.filter(v => Math.abs(v) > 1e-4).length > 1) {
				unsupported_cubes.push(child);
				return;
			}
		}

		child.origin.V3_set(vec.x, vec.y, vec.z);
		if (has_diff) {
			// 几何坐标只随 origin 平移，保持 v'-o' = v-o，世界几何精确不变
			if (child.from) {
				child.from.V3_add(diff);
				child.to.V3_add(diff);
			}
			if (child.vertices) {
				for (let vkey in child.vertices) {
					child.vertices[vkey].V3_add(diff);
				}
			}
		}
		if (new_rotation) {
			child.rotation.V3_set(new_rotation[0], new_rotation[1], new_rotation[2]);
			if (child instanceof Cube) {
				let non_zero = new_rotation.map(v => Math.abs(v) > 1e-4);
				let axis = non_zero.indexOf(true);
				if (axis >= 0 && non_zero.indexOf(true, axis + 1) === -1) {
					child.rotation_axis = getAxisLetter(axis);
				}
			}
		}
		if (child instanceof Group) {
			groups_updated.push(child);
			if (has_diff) {
				child.forEachChild(desc => {
					if (desc.origin) desc.origin.V3_add(diff);
					if (desc.from) desc.from.V3_add(diff);
					if (desc.to) desc.to.V3_add(diff);
					if (desc.vertices) {
						for (let vkey in desc.vertices) desc.vertices[vkey].V3_add(diff);
					}
					if (desc instanceof Group) groups_updated.safePush(desc); else elements_updated.safePush(desc);
				});
			}
		} else {
			elements_updated.push(child);
		}
	})
	if (unsupported_cubes.length) {
		let now = Date.now();
		if (!compensateGroupRotationFixedWorld.last_warning || now - compensateGroupRotationFixedWorld.last_warning > 1500) {
			compensateGroupRotationFixedWorld.last_warning = now;
			Blockbench.showQuickMessage(tl('message.fixed_world_position_unsupported', [unsupported_cubes.length]), 3000);
		}
	}
	Canvas.updateView({
		elements: elements_updated,
		element_aspects: {geometry: true, transform: true},
		groups: groups_updated,
		group_aspects: {transform: true},
	});
}
/**
 * 编号68：旋转 undo 范围。固定世界位置打开时，组旋转补偿会改写全部后代的
 * origin/from/to/vertices/rotation，undo 必须扩展到后代元素与后代组
 *（Group.multi_selected 只含直接选中的组，选择级联不进该列表）。
 */
export function getRotationUndoAspects() {
	let elements = Outliner.selected.filter(el => el.getTypeBehavior('rotatable')).slice();
	let groups = Group.multi_selected.slice();
	if (Modes.edit && BarItems.fixed_world_position?.value) {
		let rotated = getRotationObjects() || [];
		let rotated_groups = rotated.filter(o => o instanceof Group);
		if (rotated_groups.length) {
			let nodes = getGroupTransferOriginUndoNodes(rotated_groups);
			nodes.elements.forEach(el => elements.safePush(el));
			nodes.groups.forEach(g => groups.safePush(g));
		}
	}
	return {elements, groups};
}
export function rotateOnAxis(modify, axis, slider, lock_local_axis = false) {
	var things = getRotationObjects();
	if (!things) return;
	if (things instanceof Array == false) things = [things];
	//Warning
	if (Format.rotation_limit && settings.dialog_rotation_limit.value && !Dialog.open) {
		var i = 0;
		while (i < Cube.selected.length) {
			if (Cube.selected[i].rotation[(axis+1)%3] ||
				Cube.selected[i].rotation[(axis+2)%3]
			) {
				i = Infinity

				let format_version_message = 'You can also switch to a newer format version in your project settings if you are targeting Minecraft 1.21.11 or newer.';
				Blockbench.showMessageBox({
					title: tl('message.rotation_limit.title'),
					icon: 'rotate_right',
					message: tl('message.rotation_limit.message') + '\n\n' + format_version_message,
					checkboxes: {
						dont_show_again: {value: false, text: 'dialog.dontshowagain'}
					}
				}, (button, checkboxes = {}) => {
					if (checkboxes.dont_show_again) {
						settings.dialog_rotation_limit.set(false);
					}
				})
				return;
				//Gotta stop the numslider here
			}
			i++;
		}
	}
	if (lock_local_axis && BarItems.rotation_space.value == 'local') {
		let reference = getLocalAxisLockReference();
		if (reference?.mesh) {
			let old_value = reference.rotation[axis];
			let angle = modify(old_value) - old_value;
			axis = getLocalAxisInWorld(reference, axis);
			modify = () => angle;
			slider = false;
		} else {
			lock_local_axis = false;
		}
	}
	// 反馈#275：跟随空间——旋转轴取跟随源的自身轴（与自身轴锁定同一套换算，只是参考元素换成源）。
	// 滑条输入的读数是所选元素自己的分量，无法换算成绕源的转角，因此只接管 gizmo 拖动。
	if (!slider && BarItems.rotation_space?.value == 'follow') {
		let reference = FollowSpace.getReference();
		if (reference) {
			let old_value = reference.rotation[axis];
			let angle = modify(old_value) - old_value;
			axis = getLocalAxisInWorld(reference, axis);
			modify = () => angle;
			slider = false;
		}
	}
	var axis_letter = getAxisLetter(axis)
	var origin = things[0].origin
	things.forEach(function(obj, i) {
		if (!obj.rotation.allEqual(0)) {
			origin = obj.origin
		}
	})

	let space = getEditTransformSpace()
	if (axis instanceof THREE.Vector3) space = 0;
	things.forEach(obj => {
		let mesh = obj.mesh;
		// 编号68：固定世界位置——捕获组旋转前朝向，分支写值后补偿后代
		let fwp_q_old;
		if (obj instanceof Group && Modes.edit && BarItems.fixed_world_position?.value && obj.children.length) {
			let order = obj.mesh?.rotation?.order || Format.euler_order || 'ZYX';
			fwp_q_old = new THREE.Quaternion().setFromEuler(new THREE.Euler(
				Math.degToRad(obj.rotation[0]),
				Math.degToRad(obj.rotation[1]),
				Math.degToRad(obj.rotation[2]),
				order
			));
		}
		if (obj instanceof Cube && !Format.bone_rig) {
			if (obj.origin.allEqual(0)) {
				obj.origin.V3_set(origin)
			}
		}

		let mesh_cond = obj instanceof Mesh && Project.mesh_selection[obj.uuid] && Project.mesh_selection[obj.uuid].vertices.length;
		let spline_cond = obj instanceof SplineMesh && Project.spline_selection[obj.uuid] && Project.spline_selection[obj.uuid].vertices.length;
		if (!lock_local_axis && !Group.first_selected && (mesh_cond || spline_cond)) {

			// Mesh or spline
			let normal = axis == 0 ? THREE.NormalX : (axis == 1 ? THREE.NormalY : THREE.NormalZ)
			let rotWorldMatrix = new THREE.Matrix4();
			rotWorldMatrix.makeRotationAxis(normal, Math.degToRad(modify(0)))
			if (space instanceof OutlinerNode || space == 'root') {
				rotWorldMatrix.multiply(mesh.matrix);
			} else if (space == 0) {
				rotWorldMatrix.multiply(mesh.matrixWorld);
			}
			let q = new THREE.Quaternion().setFromRotationMatrix(rotWorldMatrix);
			if (space instanceof OutlinerNode || space == 'root') {
				q.premultiply(mesh.quaternion.invert());
				mesh.quaternion.invert();
			} else if (space == 0) {
				let quat = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
				q.premultiply(quat);
			}

			let vector = new THREE.Vector3();
			let local_pivot = obj.mesh.worldToLocal(new THREE.Vector3().copy(Transformer.position))

			let verts;
			if (mesh_cond) verts = Project.mesh_selection[obj.uuid].vertices
			if (spline_cond) verts = Project.spline_selection[obj.uuid].vertices
			verts.forEach(vkey => {
				vector.fromArray(obj.vertices[vkey]);
				vector.sub(local_pivot);
				vector.applyQuaternion(q);
				vector.add(local_pivot);
				obj.vertices[vkey].V3_set(vector.x, vector.y, vector.z);
				if (obj instanceof SplineMesh) {
					obj.applyHandleModeOnVertex(vkey);
				}
			})
			if (obj instanceof Mesh) {
				ProportionalEdit.editVertices(obj, (vkey, blend) => {
					let initial = obj.vertices[vkey].slice();
					vector.fromArray(initial);
					vector.sub(local_pivot);
					vector.applyQuaternion(q);
					vector.add(local_pivot);
					obj.vertices[vkey].V3_set(
						Math.lerp(initial[0], vector.x, blend),
						Math.lerp(initial[1], vector.y, blend),
						Math.lerp(initial[2], vector.z, blend)
					);
				})
			}

		} else if (slider || (space == 2 && Format.rotation_limit)) {
			var obj_val = modify(obj.rotation[axis]);
			obj_val = Math.trimDeg(obj_val)
			if (Format.rotation_limit && obj instanceof Cube) {
				//Limit To 1 Axis
				obj.rotation[(axis+1)%3] = 0
				obj.rotation[(axis+2)%3] = 0
				//Limit Angle
				if (Format.rotation_snap) {
					obj_val = Math.round(obj_val/22.5)*22.5
				}
				if (obj_val > 45 || obj_val < -45) {
	
					let f = obj_val > 45
					let can_roll = obj.roll(axis, f!=(axis==1) ? 1 : 3);
					if (can_roll) {
						let roll_angle = Format.rotation_snap ? 22.5 : 90 - Math.abs(obj_val)
						obj_val = f ? -roll_angle : roll_angle;
					} else {
						obj_val = Math.clamp(obj_val, -45, 45);
					}
				}
			}
			obj.rotation[axis] = obj_val
			if (obj instanceof Cube) {
				obj.rotation_axis = axis_letter
			}
		} else if (space == 2) {
			// 反馈#132：自身坐标系旋转 = 绕物体当前自身的轴旋转（四元数后乘 = 内旋），
			// 写回时按网格欧拉序分解。#104 的单分量累加在已有他轴旋转时实际绕欧拉中间轴
			// 旋转，视觉歪斜；原上游「阈值+欧拉序重排」路径则是真局部轴但有阈值两侧不一致
			// 问题。统一为四元数路径：任何初始姿态下绕同一环旋转结果一致。注意：真局部轴
			// 旋转在欧拉分量上的表现就是多个分量同时变化，这是数学必然，不是串轴。
			let angle = Math.degToRad(modify(0));
			let q_axis = new THREE.Quaternion().setFromAxisAngle(
				axis == 0 ? THREE.NormalX : (axis == 1 ? THREE.NormalY : THREE.NormalZ), angle);
			let order = mesh.rotation.order || Format.euler_order || 'ZYX';
			let q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
				Math.degToRad(obj.rotation[0]),
				Math.degToRad(obj.rotation[1]),
				Math.degToRad(obj.rotation[2]),
				order
			));
			q.multiply(q_axis);
			let e = new THREE.Euler().setFromQuaternion(q, order);
			obj.rotation[0] = Math.trimDeg(Math.radToDeg(e.x));
			obj.rotation[1] = Math.trimDeg(Math.radToDeg(e.y));
			obj.rotation[2] = Math.trimDeg(Math.radToDeg(e.z));

		} else if (space instanceof OutlinerNode) {
			let normal = axis == 0 ? THREE.NormalX : (axis == 1 ? THREE.NormalY : THREE.NormalZ)
			let rotWorldMatrix = new THREE.Matrix4();
			rotWorldMatrix.makeRotationAxis(normal, Math.degToRad(modify(0)))
			rotWorldMatrix.multiply(mesh.matrix)
			mesh.matrix.copy(rotWorldMatrix)
			mesh.setRotationFromMatrix(rotWorldMatrix)
			let e = mesh.rotation;
			obj.rotation[0] = Math.radToDeg(e.x);
			obj.rotation[1] = Math.radToDeg(e.y);
			obj.rotation[2] = Math.radToDeg(e.z);

		} else if (space == 0) {
			let normal = axis instanceof THREE.Vector3
				? axis
				: axis == 0 ? THREE.NormalX : (axis == 1 ? THREE.NormalY : THREE.NormalZ)
			let rotWorldMatrix = new THREE.Matrix4();
			rotWorldMatrix.makeRotationAxis(normal, Math.degToRad(modify(0)))
			rotWorldMatrix.multiply(mesh.matrixWorld)

			let inverse = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert()
			rotWorldMatrix.premultiply(inverse)

			mesh.matrix.copy(rotWorldMatrix)
			mesh.setRotationFromMatrix(rotWorldMatrix)
			let e = mesh.rotation;
			obj.rotation[0] = Math.radToDeg(e.x);
			obj.rotation[1] = Math.radToDeg(e.y);
			obj.rotation[2] = Math.radToDeg(e.z);
			
		}
		if (fwp_q_old) {
			let order = obj.mesh?.rotation?.order || Format.euler_order || 'ZYX';
			let q_new = new THREE.Quaternion().setFromEuler(new THREE.Euler(
				Math.degToRad(obj.rotation[0]),
				Math.degToRad(obj.rotation[1]),
				Math.degToRad(obj.rotation[2]),
				order
			));
			compensateGroupRotationFixedWorld(obj, fwp_q_old, q_new);
		}
		if (obj instanceof Group) {
			Canvas.updateView({groups: [obj]});
		}
	})
}
export function afterRotateOnAxis() {
	if (Format.cube_size_limiter && Format.cube_size_limiter.rotation_affected && !settings.deactivate_size_limit.value) {
		Cube.all.forEach(cube => {
			Format.cube_size_limiter.move(cube);
			Format.cube_size_limiter.clamp(cube);
		})
		Canvas.updateView({elements: Cube.selected, element_aspects: {transform: true, geometry: true}})
	}
	SplineMesh.selected.forEach((spline) => {
		if (BarItems.spline_selection_mode.value == "handles") {
			spline.refreshTubeFaces();
		}
	});
}

BARS.defineActions(function() {


	new BarSelect('transform_space', {
		condition: {
			modes: ['edit', 'animate'],
			tools: ['move_tool', 'resize_tool'],
			method: () => !(Toolbox && Toolbox.selected.id === 'resize_tool' && (Mesh.all.length === 0 && SplineMesh.all.length === 0))
		},
		category: 'transform',
		value: 'parent',
		options: {
			global: true,
			parent: true,
			local: true,
			// 反馈#275：第四种空间「跟随」——轴向取 Ctrl 选定的跟随源（见 FollowSpace）
			// 反馈#303：社区版开关 community_follow_space 控制是否出现（默认关闭）
			follow: {condition: {modes: ['edit'], method: () => Settings.get('community_follow_space')}, name: true},
			normal: {condition: () => Mesh.selected.length || SplineMesh.selected.length, name: true}
		},
		onChange() {
			FollowSpace.syncHint();
			// 反馈#283：切空间时立刻清/显跟随源红框（该路径不派发 update_view）
			FollowSpace.updateHighlight();
			updateSelection();
		}
	})
	new BarSelect('rotation_space', {
		condition: {modes: ['edit', 'animate'], tools: ['rotate_tool']},
		category: 'transform',
		value: 'local',
		options: {
			global: 'action.transform_space.global',
			parent: 'action.transform_space.parent',
			local: 'action.transform_space.local',
			// 反馈#281：复用移动空间的翻译键，避免下拉显示 action.rotation_space.follow 原文
			// 反馈#303：同上，跟随空间开关关闭时不出现
			follow: {condition: {modes: ['edit'], method: () => Settings.get('community_follow_space')}, name: 'action.transform_space.follow'}
		},
		onChange() {
			FollowSpace.syncHint();
			FollowSpace.updateHighlight();
			updateSelection();
		}
	})
	new BarSelect('transform_pivot_space', {
		condition: {
			modes: ['edit', 'animate'],
			tools: ['pivot_tool']
		},
		category: 'transform',
		value: 'parent',
		options: {
			global: 'action.transform_space.global',
			parent: 'action.transform_space.parent',
			local: 'action.transform_space.local',
		},
		onChange() {
			updateSelection();
		}
	})
	new BarSelect('vertex_snap_mode', {
		options: {
			move: true,
			scale: {condition: () => !Format.integer_size, name: true},
			rotate: true
		},
		category: 'edit'
	})

	/**
	 * 反馈#231：自身轴锁定拖动位置滑块时，滑块读数在「读数节点的父空间」里（`getPos`），
	 * 而位移沿自身轴的世界方向。父级带旋转/缩放时（套组），沿自身轴移动 d 只让读数变化
	 * d*cosθ；直接把读数差当位移会让读数追不上拖动，反向拖动时出现大幅回弹。
	 * 这里把读数差换算成沿轴的实际距离。
	 */
	function getAxisLockDistance(delta, axis, axis_lock_reference) {
		if (!delta) return delta;
		// 与 getPos 的读数节点保持同源（有选中组时读组 origin，否则读首个所选元素）
		let node = Group.first_selected || Outliner.selected[0];
		if (!node?.mesh) return delta;
		let local_axis = getWorldDeltaInParentSpace(node, getLocalAxisInWorld(axis_lock_reference, axis));
		let component = local_axis[getAxisLetter(axis)];
		// 轴向几乎垂直于读数轴（例如父级转了 90°）时没有可靠换算，保持旧行为
		if (!isFinite(component) || Math.abs(component) < 1e-4) return delta;
		return delta / component;
	}
	function moveOnAxis(modify, axis) {
		let axis_lock_reference = toggle_pos_axis_lock.value && BarItems.transform_space.value == 'local' && getLocalAxisLockReference();
		if (axis_lock_reference?.mesh) {
			let old_value = getPos(axis);
			let new_value = modify(old_value);
			let distance = getAxisLockDistance(new_value - old_value, axis, axis_lock_reference);
			if (getSmartInstanceTransformGroup()) {
				moveElementsInSpace(distance, getLocalAxisInWorld(axis_lock_reference, axis), 0);
			} else {
				moveSelectionInWorldAxis(distance, getLocalAxisInWorld(axis_lock_reference, axis));
			}
			updateSelection();
			return;
		}
		if (getSmartInstanceTransformGroup()) {
			let old_value = getPos(axis);
			let new_value = modify(old_value);
			moveElementsInSpace(new_value - old_value, axis, getParentTransformSpace());
			updateSelection();
			return;
		}
		if (toggle_pos_per_element.value == false) {
			let old_value = getPos(axis);
			let new_value = modify(old_value);
			moveElementsInSpace(new_value - old_value, axis, getParentTransformSpace());
			updateSelection();
			return;
		}
		Outliner.selected.forEach(function(obj, i) {
			let space_offset = 0;
			if (settings.local_position_values.value &&
				obj.parent instanceof OutlinerNode &&
				obj.parent.getTypeBehavior('use_absolute_position')
			) {
				space_offset = -obj.parent.origin[axis];
			}
			let modifyInSpace = (real_value) => {
				return modify(real_value + space_offset) - space_offset;
			}

			if ((obj instanceof Mesh || obj instanceof SplineMesh) && obj.getSelectedVertices().length) {

				let vertices = obj.getSelectedVertices();
				vertices.forEach(vkey => {
					let before = obj.vertices[vkey][axis];
					obj.vertices[vkey][axis] = modifyInSpace(before);
				
					if (obj instanceof SplineMesh) {
						obj.applyHandleModeOnVertex(vkey);
					}
				})
				obj.preview_controller.updateGeometry(obj);

			} else if (obj.getTypeBehavior('movable')) {
				if (settings.transform_cube_from_center.value && obj.from && obj.to) {
					let before = Math.lerp(obj.from[axis], obj.to[axis], 0.5);
					var val = modifyInSpace(before);
					obj.from[axis] += val - before;
					obj.to[axis] += val - before;
				} else {
					let main_pos = obj.from || obj.position;
					let before = main_pos[axis];
					var val = modifyInSpace(before);
					main_pos[axis] = val;
					if (obj.to) {
						obj.to[axis] += (val - before);
					}
				}
				if (obj instanceof Cube) {
					if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
						Format.cube_size_limiter.move(obj);
					}
					obj.mapAutoUV()
				}
				obj.preview_controller.updateTransform(obj);
				if (obj.preview_controller.updateGeometry) obj.preview_controller.updateGeometry(obj);
			}
		})
		TickUpdates.selection = true;
	}
	function getPos(axis) {
		const smart_group = getSmartInstanceTransformGroup();
		if (smart_group) {
			let value = smart_group.origin[axis] + smart_group.smart_object_position[axis];
			if (settings.local_position_values.value && smart_group.parent instanceof Group) value -= smart_group.parent.origin[axis];
			return value;
		}
		// 反馈#231：自身轴锁定（套组场景）下移动的是所选组本身（`moveSelectionInWorldAxis` 移动组 origin），
		// 读数必须同源，否则滑块停在子元素的局部坐标上、拖动时数值回弹。
		const axis_lock_reads_group = toggle_pos_axis_lock.value && BarItems.transform_space.value == 'local';
		if ((toggle_pos_per_element.value == false || axis_lock_reads_group) && Group.first_selected) {
			return Group.first_selected.origin[axis];
		}
		let element = Outliner.selected[0];
		let value = 0;
		if ((element instanceof Mesh || element instanceof SplineMesh) && element.getSelectedVertices().length) {
			let vertices = element.getSelectedVertices();
			let sum = 0;
			vertices.forEach(vkey => sum += element.vertices[vkey][axis]);
			value = sum / vertices.length;

		} else if (element.from && element.to && settings.transform_cube_from_center.value) {
			value = Math.lerp(element.from[axis], element.to[axis], 0.5);
		} else if (element.from) {
			value = element.from[axis];
		} else {
			value = element.origin[axis]
		}
		if (settings.local_position_values.value &&
			element.parent instanceof OutlinerNode &&
			element.parent.getTypeBehavior('use_absolute_position')
		) {
			value -= element.parent.origin[axis];
		}
		return value;
	}
	function getPositionSliderUndoGroups() {
		const smart_group = getSmartInstanceTransformGroup();
		if (smart_group) return [smart_group];
		if (toggle_pos_axis_lock.value && BarItems.transform_space.value == 'local' && Format.bone_rig && Group.first_selected) {
			let groups = [];
			for (let group of Group.multi_selected) {
				group.forEachChild(child => groups.safePush(child), Group, true);
			}
			return groups;
		}
		return toggle_pos_per_element.value ? [] : Group.all.filter(g => g.selected);
	}
	function getPositionSliderUndoElements() {
		let elements = Outliner.selected.slice();
		if (toggle_pos_axis_lock.value && BarItems.transform_space.value == 'local' && Format.bone_rig) {
			for (let group of Group.multi_selected) {
				group.forEachChild(child => {
					if (child instanceof Group == false) elements.safePush(child);
				});
			}
		}
		return elements;
	}
	const slider_pos_common_options = {
		category: 'transform',
		condition: () => (Outliner.selected.length && Modes.edit),
		getInterval: getSpatialInterval,
		onBefore: function() {
			const smart_group = getSmartInstanceTransformGroup();
			Undo.initEdit({
				elements: smart_group ? [] : getPositionSliderUndoElements(),
				groups: getPositionSliderUndoGroups()
			})
		},
		onAfter: function() {
			Undo.finishEdit('Change element position')
			autoFixMeshEdit()
		}
	}
	new NumSlider('slider_pos_x', {
		name: tl('action.slider_pos', ['X']),
		description: tl('action.slider_pos.desc', ['X']),
		color: 'x',
		get() {
			return getPos(0);
		},
		change(modify) {
			moveOnAxis(modify, 0)
		},
		...slider_pos_common_options
	}) 
	new NumSlider('slider_pos_y', {
		name: tl('action.slider_pos', ['Y']),
		description: tl('action.slider_pos.desc', ['Y']),
		color: 'y',
		get() {
			return getPos(1);
		},
		change(modify) {
			moveOnAxis(modify, 1)
		},
		...slider_pos_common_options
	}) 
	new NumSlider('slider_pos_z', {
		name: tl('action.slider_pos', ['Z']),
		description: tl('action.slider_pos.desc', ['Z']),
		color: 'z',
		get() {
			return getPos(2);
		},
		change(modify) {
			moveOnAxis(modify, 2)
		},
		...slider_pos_common_options
	})
	let slider_vector_pos = [BarItems.slider_pos_x, BarItems.slider_pos_y, BarItems.slider_pos_z];
	slider_vector_pos.forEach(slider => slider.slider_vector = slider_vector_pos);

	let toggle_pos_per_element = new Toggle('position_slider_per_element', {
		icon: 'shuffle',
		// 反馈#202：默认开启（原版手感），需要「整组一起移动」时手动关掉
		default: true,
		category: 'transform',
		condition: slider_pos_common_options.condition,
		onChange() {
			if (Condition(BarItems.slider_pos_x.condition)) {
				BarItems.slider_pos_x.update();
				BarItems.slider_pos_y.update();
				BarItems.slider_pos_z.update();
			}
		}
	})

	let toggle_pos_axis_lock = new Toggle('position_slider_local_axis_lock', {
		icon: 'lock',
		default: false,
		category: 'transform',
		condition: slider_pos_common_options.condition,
	})


	function resizeOnAxis(modify, axis) {
		const smart_group = getSmartInstanceTransformGroup();
		if (smart_group) {
			smart_group.smart_object_scale[axis] = modify(smart_group.smart_object_scale[axis]);
			smart_group.preview_controller.updateTransform(smart_group);
			return;
		}
		Outliner.selected.forEach(function(obj, i) {
			if (obj.getTypeBehavior('resizable')) {
				let bidirectional = obj instanceof Mesh;
				let center = (obj.from && obj.to) && Math.lerp(obj.from[axis], obj.to[axis], 0.5);
				obj.resize(modify, axis, false, true, bidirectional);
				if (obj.from && obj.to && settings.transform_cube_from_center.value) {
					let offset = Math.lerp(obj.from[axis], obj.to[axis], 0.5) - center;
					obj.from[axis] -= offset;
					obj.to[axis] -= offset;
					obj.preview_controller.updateGeometry(obj);
				}
			} else if (obj.getTypeBehavior('scalable')) {
				obj.scale[axis] = modify(obj.scale[axis]);
				obj.preview_controller.updateTransform(obj);
				if (obj.preview_controller.updateGeometry) obj.preview_controller.updateGeometry(obj);
			}
		})
		if (ArmatureBone.hasSelected()) updateNslideValues();
	}
	new NumSlider('slider_size_x', {
		name: tl('action.slider_size', ['X']),
		description: tl('action.slider_size.desc', ['X']),
		color: 'x',
		category: 'transform',
		condition: () => ((getSmartInstanceTransformGroup() || (Outliner.selected[0] && (Outliner.selected[0].getTypeBehavior('resizable') || Outliner.selected[0].getTypeBehavior('scalable')))) && Modes.edit),
		getInterval: getSpatialInterval,
		get: function() {
			const smart_group = getSmartInstanceTransformGroup();
			if (smart_group) return smart_group.smart_object_scale[0];
			if (Outliner.selected[0].getTypeBehavior('scalable')) {
				return Outliner.selected[0].scale[0]
			} else if (Outliner.selected[0].size instanceof Array) {
				return Outliner.selected[0].size[0];
			} else if (Outliner.selected[0].getTypeBehavior('resizable')) {
				return Outliner.selected[0].getSize(0, true);
			}
		},
		change: function(modify) {
			resizeOnAxis(modify, 0)
		},
		onBefore: function() {
			const smart_group = getSmartInstanceTransformGroup();
			Undo.initEdit({elements: smart_group ? [] : Outliner.selected.filter(el => el.getTypeBehavior('resizable')), groups: smart_group ? [smart_group] : undefined});
		},
		onAfter: function() {
			Undo.finishEdit('Change element size')
			autoFixMeshEdit()
		}
	})
	new NumSlider('slider_size_y', {
		name: tl('action.slider_size', ['Y']),
		description: tl('action.slider_size.desc', ['Y']),
		color: 'y',
		category: 'transform',
		condition: () => ((getSmartInstanceTransformGroup() || (Outliner.selected[0] && (Outliner.selected[0].getTypeBehavior('resizable') || Outliner.selected[0].getTypeBehavior('scalable')))) && Modes.edit),
		getInterval: getSpatialInterval,
		get: function() {
			const smart_group = getSmartInstanceTransformGroup();
			if (smart_group) return smart_group.smart_object_scale[1];
			if (Outliner.selected[0].getTypeBehavior('scalable')) {
				return Outliner.selected[0].scale[1]
			} else if (Outliner.selected[0].size instanceof Array) {
				return Outliner.selected[0].size[1];
			} else if (Outliner.selected[0].getTypeBehavior('resizable')) {
				return Outliner.selected[0].getSize(1, true);
			}
		},
		change: function(modify) {
			resizeOnAxis(modify, 1)
		},
		onBefore: function() {
			const smart_group = getSmartInstanceTransformGroup();
			Undo.initEdit({elements: smart_group ? [] : Outliner.selected.filter(el => el.getTypeBehavior('resizable')), groups: smart_group ? [smart_group] : undefined});
		},
		onAfter: function() {
			Undo.finishEdit('Change element size')
			autoFixMeshEdit()
		}
	})
	new NumSlider('slider_size_z', {
		name: tl('action.slider_size', ['Z']),
		description: tl('action.slider_size.desc', ['Z']),
		color: 'z',
		category: 'transform',
		condition: () => ((getSmartInstanceTransformGroup() || (Outliner.selected[0] && (Outliner.selected[0].getTypeBehavior('resizable') || Outliner.selected[0].getTypeBehavior('scalable')) && !(Outliner.selected[0] instanceof Billboard))) && Modes.edit),
		getInterval: getSpatialInterval,
		get: function() {
			const smart_group = getSmartInstanceTransformGroup();
			if (smart_group) return smart_group.smart_object_scale[2];
			if (Outliner.selected[0].getTypeBehavior('scalable')) {
				return Outliner.selected[0].scale[2]
			} else if (Outliner.selected[0].size instanceof Array) {
				return Outliner.selected[0].size[2];
			} else if (Outliner.selected[0].getTypeBehavior('resizable')) {
				return Outliner.selected[0].getSize(2, true);
			}
		},
		change: function(modify) {
			resizeOnAxis(modify, 2)
		},
		onBefore: function() {
			const smart_group = getSmartInstanceTransformGroup();
			Undo.initEdit({elements: smart_group ? [] : Outliner.selected.filter(el => el.getTypeBehavior('resizable')), groups: smart_group ? [smart_group] : undefined});
		},
		onAfter: function() {
			Undo.finishEdit('Change element size')
			autoFixMeshEdit()
		}
	})
	let slider_vector_size = [BarItems.slider_size_x, BarItems.slider_size_y, BarItems.slider_size_z];
	slider_vector_size.forEach(slider => slider.slider_vector = slider_vector_size);
	//Inflate
	new NumSlider('slider_inflate', {
		category: 'transform',
		condition: function() {return Cube.selected.length && Modes.edit},
		getInterval: getSpatialInterval,
		get: function() {
			return Cube.selected[0].inflate
		},
		change: function(modify) {
			Cube.selected.forEach(function(obj, i) {
				let v_before = obj.inflate;
				var v = modify(obj.inflate);

				if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
					if (Format.cube_size_limiter.coordinate_limits) {
						let limits = Format.cube_size_limiter.coordinate_limits;
						v = obj.from[0] - Math.clamp(obj.from[0]-v, limits[0], limits[1]);
						v = obj.from[1] - Math.clamp(obj.from[1]-v, limits[0], limits[1]);
						v = obj.from[2] - Math.clamp(obj.from[2]-v, limits[0], limits[1]);
						v = Math.clamp(obj.to[0]+v, limits[0], limits[1]) - obj.to[0];
						v = Math.clamp(obj.to[1]+v, limits[0], limits[1]) - obj.to[1];
						v = Math.clamp(obj.to[2]+v, limits[0], limits[1]) - obj.to[2];

						obj.inflate = v;
					} else {
						if (Format.cube_size_limiter.test(obj, {inflate: v}) == false) {
							obj.inflate = v;
						} else {
							let step = Math.sign(v - v_before) * 0.1;
							let steps = (v - v_before) / step;
							for (let i = 0; i < steps; i++) {
								if (Format.cube_size_limiter.test(obj, {inflate: v_before + i * (steps+1)}) == false) {
									obj.inflate = v_before + i * steps;
									break;
								}
							}
						}
					}
				} else {
					obj.inflate = v;
				}
			})
			Canvas.updatePositions()
		},
		onBefore: function() {
			Undo.initEdit({elements: Cube.selected})
		},
		onAfter: function() {
			Undo.finishEdit('Inflate elements')
		}
	})

	//Stretch
	new NumSlider('slider_stretch_x', {
		name: tl('action.slider_stretch', ['X']),
		description: tl('action.slider_stretch.desc', ['X']),
		color: 'x',
		settings: {default: 1},
		category: 'transform',
		condition: function() {return Format.stretch_cubes && Cube.selected.length && Modes.edit},
		getInterval: event => getSpatialInterval(event) / 8,
		get: function() {
			return Cube.selected[0].stretch[0]
		},
		change: function(modify) {
			Cube.selected.forEach(function(obj, i) {
				let v_before = obj.stretch[0];
				var v = modify(obj.stretch[0]);

				if (settings.stretch_linked.value === true) {
					obj.stretch.forEach(function (stretch, axis) {
						obj.stretch[axis] = v;
					});
				} else {
					obj.stretch[0] = v;
				}
			})
			Canvas.updatePositions()
		},
		onBefore: function() {
			Undo.initEdit({elements: Cube.selected})
		},
		onAfter: function() {
			Undo.finishEdit('Stretch elements')
		}
	})

	new NumSlider('slider_stretch_y', {
		name: tl('action.slider_stretch', ['Y']),
		description: tl('action.slider_stretch.desc', ['Y']),
		color: 'y',
		settings: {default: 1},
		category: 'transform',
		condition: function() {return Format.stretch_cubes && Cube.selected.length && Modes.edit},
		getInterval: event => getSpatialInterval(event) / 8,
		get: function() {
			return Cube.selected[0].stretch[1]
		},
		change: function(modify) {
			Cube.selected.forEach(function(obj, i) {
				let v_before = obj.stretch[1];
				var v = modify(obj.stretch[1]);

				if (settings.stretch_linked.value === true) {
					obj.stretch.forEach(function (stretch, axis) {
						obj.stretch[axis] = v;
					});
				} else {
					obj.stretch[1] = v;
				}				
			})
			Canvas.updatePositions()
		},
		onBefore: function() {
			Undo.initEdit({elements: Cube.selected})
		},
		onAfter: function() {
			Undo.finishEdit('Stretch elements')
		}
	})

	new NumSlider('slider_stretch_z', {
		name: tl('action.slider_stretch', ['Z']),
		description: tl('action.slider_stretch.desc', ['Z']),
		color: 'z',
		settings: {default: 1},
		category: 'transform',
		condition: function() {return Format.stretch_cubes && Cube.selected.length && Modes.edit},
		getInterval: event => getSpatialInterval(event) / 8,
		get: function() {
			return Cube.selected[0].stretch[2]
		},
		change: function(modify) {
			Cube.selected.forEach(function(obj, i) {
				let v_before = obj.stretch[2];
				var v = modify(obj.stretch[2]);

				if (settings.stretch_linked.value === true) {
					obj.stretch.forEach(function (stretch, axis) {
						obj.stretch[axis] = v;
					});
				} else {
					obj.stretch[2] = v;
				}
			})
			Canvas.updatePositions()
		},
		onBefore: function() {
			Undo.initEdit({elements: Cube.selected})
		},
		onAfter: function() {
			Undo.finishEdit('Stretch elements')
		}
	})

	let slider_vector_stretch = [BarItems.slider_stretch_x, BarItems.slider_stretch_y, BarItems.slider_stretch_z];
	slider_vector_stretch.forEach(slider => slider.slider_vector = slider_vector_stretch);

	//Rotation
	/**
	 * 反馈#280：旋转滑条的绝对赋值（复制/粘贴向量、重置向量）。
	 * 滑条的 `change` 传的是增量函数，自身轴锁定与局部空间会把它解释成「绕当前自身轴再转 N 度」，
	 * 三个轴依次转还会各自绕当时的局部轴，粘贴出来的姿态与粘贴值不符。
	 * 绝对赋值走 rotateOnAxis 的直写分支（slider = true、不传锁定），把该轴欧拉值直接设为 N。
	 */
	function setRotationComponentAbsolute(axis, value) {
		rotateOnAxis(() => value, axis, true, false)
		Canvas.updatePositions()
	}
	new NumSlider('slider_rotation_x', {
		name: tl('action.slider_rotation', ['X']),
		description: tl('action.slider_rotation.desc', ['X']),
		color: 'x',
		category: 'transform',
		condition: () => ((Modes.edit || Modes.pose) && getRotationObjects()),
		get: function() {
			if (Format.bone_rig && Group.first_selected) {
				return Group.first_selected.rotation[0];
			}
			let ref = Outliner.selected.find(el => {
				return el.getTypeBehavior('rotatable') && (Format.rotate_cubes || el instanceof Cube == false)
			})
			if (ref) return ref.rotation[0];
		},
		change: function(modify) {
			rotateOnAxis(modify, 0, true, toggle_rotation_axis_lock.value)
			Canvas.updatePositions()
		},
		setAbsolute: function(value) {
			setRotationComponentAbsolute(0, value)
		},
		onBefore: function() {
			// 编号68：固定世界位置打开时 undo 范围扩展到被补偿的后代（getRotationUndoAspects）
			Undo.initEdit(getRotationUndoAspects())
		},
		onAfter: function() {
			afterRotateOnAxis();
			Undo.finishEdit(getRotationObjects()?.find(el => el instanceof Group) ? 'Rotate group' : 'Rotate elements');
		},
		getInterval: getRotationInterval
	})
	new NumSlider('slider_rotation_y', {
		name: tl('action.slider_rotation', ['Y']),
		description: tl('action.slider_rotation.desc', ['Y']),
		color: 'y',
		category: 'transform',
		condition: () => ((Modes.edit || Modes.pose) && getRotationObjects()),
		get: function() {
			if (Format.bone_rig && Group.first_selected) {
				return Group.first_selected.rotation[1];
			}
			let ref = Outliner.selected.find(el => {
				return el.getTypeBehavior('rotatable') && (Format.rotate_cubes || el instanceof Cube == false)
			})
			if (ref) return ref.rotation[1];
		},
		change: function(modify) {
			rotateOnAxis(modify, 1, true, toggle_rotation_axis_lock.value)
			Canvas.updatePositions()
		},
		setAbsolute: function(value) {
			setRotationComponentAbsolute(1, value)
		},
		onBefore: function() {
			// 编号68：固定世界位置打开时 undo 范围扩展到被补偿的后代（getRotationUndoAspects）
			Undo.initEdit(getRotationUndoAspects())
		},
		onAfter: function() {
			afterRotateOnAxis();
			Undo.finishEdit(getRotationObjects()?.find(el => el instanceof Group) ? 'Rotate group' : 'Rotate elements');
		},
		getInterval: getRotationInterval
	})
	new NumSlider('slider_rotation_z', {
		name: tl('action.slider_rotation', ['Z']),
		description: tl('action.slider_rotation.desc', ['Z']),
		color: 'z',
		category: 'transform',
		condition: () => ((Modes.edit || Modes.pose) && getRotationObjects()),
		get: function() {
			if (Format.bone_rig && Group.first_selected) {
				return Group.first_selected.rotation[2];
			}
			let ref = Outliner.selected.find(el => {
				return el.getTypeBehavior('rotatable') && (Format.rotate_cubes || el instanceof Cube == false)
			})
			if (ref) return ref.rotation[2];
		},
		change: function(modify) {
			rotateOnAxis(modify, 2, true, toggle_rotation_axis_lock.value)
			Canvas.updatePositions()
		},
		setAbsolute: function(value) {
			setRotationComponentAbsolute(2, value)
		},
		onBefore: function() {
			// 编号68：固定世界位置打开时 undo 范围扩展到被补偿的后代（getRotationUndoAspects）
			Undo.initEdit(getRotationUndoAspects())
		},
		onAfter: function() {
			afterRotateOnAxis();
			Undo.finishEdit(getRotationObjects()?.find(el => el instanceof Group) ? 'Rotate group' : 'Rotate elements');
		},
		getInterval: getRotationInterval
	})
	let slider_vector_rotation = [BarItems.slider_rotation_x, BarItems.slider_rotation_y, BarItems.slider_rotation_z];
	slider_vector_rotation.forEach(slider => slider.slider_vector = slider_vector_rotation);

	let toggle_rotation_axis_lock = new Toggle('rotation_slider_local_axis_lock', {
		icon: 'lock',
		default: false,
		category: 'transform',
		condition: () => ((Modes.edit || Modes.pose) && getRotationObjects()),
	})

	// 反馈#276：翻转轴面偏移滑条 + 轴面可视化 + 「以块中心为翻转轴面」
	// 反馈#299：每个轴面再加一个旋转角（X 面绕 Z、Y 面绕 X、Z 面绕 Y），可视化按倾斜后的面绘制
	let flip_plane_group = null;
	let flip_plane_grids = [];
	function updateFlipPlaneVisual() {
		if (!Canvas.scene) return;
		if (!flip_plane_group) {
			let size = 16 * 16;
			let colors = [gizmo_colors.r, gizmo_colors.g, gizmo_colors.b];
			// 网格一律按「法线」摆姿态：GridHelper 默认躺在 XZ 平面（法线 +Y）
			flip_plane_grids = colors.map((color, axis) => {
				let grid = new THREE.GridHelper(size, 32, new THREE.LineBasicMaterial({
					color,
					transparent: true,
					opacity: 0.45,
					depthWrite: false,
				}));
				grid.visible = false;
				return grid;
			});
			flip_plane_group = new THREE.Group();
			flip_plane_group.name = 'flip_plane';
			flip_plane_grids.forEach(grid => flip_plane_group.add(grid));
			Canvas.scene.add(flip_plane_group);
			Canvas.gizmos.push(flip_plane_group);
		}
		// 数据空间的法线换算到场景空间：借模型根节点的世界矩阵（含画布 Y 轴转换与居中网格平移）
		let model_matrix = null;
		if (typeof Project !== 'undefined' && Project && Project.model_3d) {
			Project.model_3d.updateWorldMatrix(true, false);
			model_matrix = Project.model_3d.matrixWorld;
		}
		flip_plane_grids.forEach((grid, axis) => {
			let angle = FlipPlane.rotation[axis];
			// 偏移为 0（画布中心）且未旋转时不画，避免默认视角被三个面糊住；改过数值才出现并跟随
			// 反馈#312：面板里的「显示轴面」关闭时一律不画（数值照常生效）
			let visible = FlipPlane.visible && (FlipPlane.offset[axis] != 0 || Math.abs(angle % 360) > 1e-6);
			grid.visible = visible;
			if (!visible) return;
			// 三个面共用同一中心点（元素数据空间 → 场景坐标）
			grid.position.set(
				FlipPlane.scenePosition(0),
				FlipPlane.scenePosition(1),
				FlipPlane.scenePosition(2)
			);
			let normal = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0);
			if (Math.abs(angle) > 1e-6) {
				let rotation_axis = FlipPlane.rotationAxis(axis);
				normal.applyAxisAngle(
					new THREE.Vector3(
						rotation_axis === 0 ? 1 : 0,
						rotation_axis === 1 ? 1 : 0,
						rotation_axis === 2 ? 1 : 0
					),
					Math.degToRad(angle)
				);
			}
			if (model_matrix) normal.transformDirection(model_matrix);
			grid.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
		});
	}
	function updateFlipPlaneSliders() {
		['x', 'y', 'z'].forEach(key => {
			let offset_slider = BarItems['slider_flip_plane_' + key];
			if (offset_slider) offset_slider.update();
			let rotation_slider = BarItems['slider_flip_plane_rotation_' + key];
			if (rotation_slider) rotation_slider.update();
		});
	}

	// 反馈#284：每条轴一个锁定按钮（排在数值右侧），锁定后该轴的轴面数值不再变化
	let flip_plane_locks = ['x', 'y', 'z'].map((key, axis) => new Toggle('flip_plane_lock_' + key, {
		name: tl('action.flip_plane_lock', ['XYZ'[axis]]),
		description: 'action.flip_plane_lock.desc',
		icon: 'fas.fa-lock-open',
		default: false,
		category: 'transform',
		condition: () => Modes.edit,
		onChange() {
			let toggle = BarItems['flip_plane_lock_' + 'xyz'[axis]];
			toggle.setIcon(toggle.value ? 'fas.fa-lock' : 'fas.fa-lock-open');
			toggle.updateEnabledState();
			updateFlipPlaneSliders();
		},
	}));
	function isFlipPlaneLocked(axis) {
		let toggle = BarItems['flip_plane_lock_' + 'xyz'[axis]];
		return !!toggle && toggle.value;
	}

	// 反馈#284：轴面偏移进 Undo（纯运行时状态，用现有 save 钩子挂字段，避免 undo.js 反向依赖）
	// 反馈#299：旋转角同样入栈——6 个数值要么一起回退，要么一起前进
	Blockbench.on('create_undo_save', ({save, aspects}) => {
		if (!aspects.flip_plane) return;
		save.flip_plane = FlipPlane.offset.slice();
		save.flip_plane_rotation = FlipPlane.rotation.slice();
	});
	Blockbench.on('load_undo_save', ({save}) => {
		// 只回读「本条记录自己存的」快照：没存过轴面的记录（几何编辑等）不改动当前轴面
		if (!Array.isArray(save.flip_plane)) return;
		for (let axis = 0; axis < 3; axis++) FlipPlane.offset[axis] = save.flip_plane[axis] ?? 0;
		if (Array.isArray(save.flip_plane_rotation)) {
			for (let axis = 0; axis < 3; axis++) FlipPlane.rotation[axis] = save.flip_plane_rotation[axis] ?? 0;
		}
		updateFlipPlaneVisual();
		updateFlipPlaneSliders();
	});
	// 一次滑动 = 一条 undo；锁定轴不产生空记录
	let flip_plane_undo_skip = [false, false, false];
	function beginFlipPlaneEdit(axis) {
		flip_plane_undo_skip[axis] = isFlipPlaneLocked(axis);
		if (flip_plane_undo_skip[axis]) return;
		Undo.initEdit({flip_plane: true, keep_saved: true});
	}
	function endFlipPlaneEdit(axis) {
		if (flip_plane_undo_skip[axis]) {
			flip_plane_undo_skip[axis] = false;
			return;
		}
		Undo.finishEdit('Flip plane offset', {flip_plane: true, keep_saved: true});
	}

	function setFlipPlaneOffset(axis, value) {
		if (isFlipPlaneLocked(axis)) {
			updateFlipPlaneSliders();
			return;
		}
		FlipPlane.offset[axis] = value;
		updateFlipPlaneVisual();
	}
	/**
	 * 反馈#299：轴面旋转角（度）。收敛到 (−180, 180]，避免连续拖动后数值无限增长；
	 * 锁定与偏移共用同一个轴锁。
	 */
	function setFlipPlaneRotation(axis, value) {
		if (isFlipPlaneLocked(axis)) {
			updateFlipPlaneSliders();
			return;
		}
		let angle = ((value + 180) % 360 + 360) % 360 - 180;
		FlipPlane.rotation[axis] = Math.round(angle * 1000) / 1000;
		updateFlipPlaneVisual();
	}
	let flip_plane_sliders = [0, 1, 2].map(axis => new NumSlider('slider_flip_plane_' + 'xyz'[axis], {
		name: tl('action.slider_flip_plane', ['XYZ'[axis]]),
		description: 'action.slider_flip_plane.desc',
		color: 'xyz'[axis],
		category: 'transform',
		condition: () => Modes.edit,
		get: function() {
			return FlipPlane.offset[axis];
		},
		change: function(modify) {
			setFlipPlaneOffset(axis, modify(FlipPlane.offset[axis]));
			updateFlipPlaneVisual();
		},
		setAbsolute: function(value) {
			setFlipPlaneOffset(axis, value);
			updateFlipPlaneVisual();
		},
		onBefore() {
			beginFlipPlaneEdit(axis);
		},
		onAfter() {
			endFlipPlaneEdit(axis);
		},
	}));
	flip_plane_sliders.forEach(slider => slider.slider_vector = flip_plane_sliders);
	let flip_plane_rotation_sliders = [0, 1, 2].map(axis => new NumSlider('slider_flip_plane_rotation_' + 'xyz'[axis], {
		name: tl('action.slider_flip_plane_rotation', ['XYZ'[axis]]),
		description: 'action.slider_flip_plane_rotation.desc',
		color: 'xyz'[axis],
		category: 'transform',
		condition: () => Modes.edit,
		get: function() {
			return FlipPlane.rotation[axis];
		},
		change: function(modify) {
			setFlipPlaneRotation(axis, modify(FlipPlane.rotation[axis]));
		},
		setAbsolute: function(value) {
			setFlipPlaneRotation(axis, value);
		},
		onBefore() {
			beginFlipPlaneEdit(axis);
		},
		onAfter() {
			endFlipPlaneEdit(axis);
		},
	}));
	flip_plane_rotation_sliders.forEach(slider => slider.slider_vector = flip_plane_rotation_sliders);

	/**
	 * 反馈#312：翻转轴面的全部控件（偏移、旋转、每轴锁定、对齐所选中心、重置轴面 + 「显示轴面」开关）
	 * 从元素面板搬进这个浮动面板。面板形态与「预览选项」一致：无遮罩、贴着入口按钮弹出、改动即时生效。
	 * 懒创建——`Toolbars.flip_plane*` 由 toolbars.ts 里的 defineActions 建出来，太早取会是 undefined。
	 */
	let flip_plane_panel = null;
	function getFlipPlanePanel() {
		if (!flip_plane_panel) {
			flip_plane_panel = new ConfigDialog('flip_plane_options', {
				title: 'panel.element.flip_plane',
				width: 360,
				form: {
					show_flip_planes: {
						label: 'dialog.flip_plane.show',
						type: 'checkbox',
						style: 'toggle_switch',
						value: true,
						description: 'dialog.flip_plane.show.desc',
					},
				},
				toolbars: {
					flip_plane: Toolbars.flip_plane,
					flip_plane_rotation: Toolbars.flip_plane_rotation,
				},
				onOpen() {
					this.setFormValues({show_flip_planes: FlipPlane.visible});
				},
				onFormChange(result) {
					if (typeof result.show_flip_planes != 'boolean') return;
					FlipPlane.visible = result.show_flip_planes;
					updateFlipPlaneVisual();
				},
			});
		}
		return flip_plane_panel;
	}
	new Action('flip_plane_panel', {
		name: 'panel.element.flip_plane',
		description: 'action.flip_plane_panel.desc',
		icon: 'flip',
		category: 'transform',
		// 不挂模式条件：入口按钮常驻在视口右上角，面板里的滑条/开关各自带条件
		click() {
			// 入口是视口右上角那个按钮，面板贴着它弹出（与「预览选项」同一套定位）
			let anchor = document.querySelector('.preview .preview_flip_plane');
			getFlipPlanePanel().show(anchor instanceof HTMLElement ? anchor : undefined);
		}
	})

	new Action('flip_plane_to_center', {
		name: 'action.flip_plane_to_center',
		description: 'action.flip_plane_to_center.desc',
		icon: 'filter_center_focus',
		category: 'transform',
		condition: {modes: ['edit'], method: () => !!(Outliner.selected.length || Group.first_selected)},
		click() {
			let nodes = Outliner.selected.slice();
			if (Group.first_selected) nodes.push(Group.first_selected);
			// 多轴旋转过的元素没有确定的镜像面：翻转只按欧拉分量取反，绕自身中心镜像会得到歪斜结果
			let multi_axis = nodes.find(node => node.rotation && node.rotation.filter(n => Math.abs(n) > 1e-6).length > 1);
			if (multi_axis) {
				Blockbench.showQuickMessage(tl('message.flip_plane_center.multi_axis'), 2500);
				return;
			}
			let center = getSelectionCenter();
			if (!center) return;
			let base = Format.centered_grid ? 0 : 8;
			// 反馈#284：锁定的轴跳过，整次对齐进 Undo
			let locked = [0, 1, 2].filter(axis => isFlipPlaneLocked(axis));
			if (locked.length == 3) {
				Blockbench.showQuickMessage(tl('message.flip_plane_center.all_locked'), 2500);
				return;
			}
			Undo.initEdit({flip_plane: true, keep_saved: true});
			for (let axis = 0; axis < 3; axis++) {
				if (isFlipPlaneLocked(axis)) continue;
				FlipPlane.offset[axis] = Math.round((center[axis] - base) * 1000) / 1000;
			}
			// 反馈#299：轴面的角度同时对齐到选中对象的单轴旋转角。X 面绕 Z 转，就取对象的 Z 旋转值，
			// 于是倾斜后的 X 面正好贴上该方块自己的 X 轴。
			let reference = nodes.find(node => node.rotation);
			for (let axis = 0; axis < 3; axis++) {
				if (isFlipPlaneLocked(axis)) continue;
				let angle = reference ? (reference.rotation[FlipPlane.rotationAxis(axis)] ?? 0) : 0;
				FlipPlane.rotation[axis] = Math.round(angle * 1000) / 1000;
			}
			updateFlipPlaneVisual();
			updateFlipPlaneSliders();
			Undo.finishEdit('Move flip planes to selection center', {flip_plane: true, keep_saved: true});
			Blockbench.showQuickMessage(tl('message.flip_plane_center.set'));
		}
	})
	// 反馈#299：「轴面对齐所选中心」右侧的重置按钮——偏移与旋转共 6 个数值一键归零
	new Action('flip_plane_reset', {
		name: 'action.flip_plane_reset',
		description: 'action.flip_plane_reset.desc',
		icon: 'restart_alt',
		category: 'transform',
		condition: () => Modes.edit,
		click() {
			if (!FlipPlane.offset.some(value => value) && !FlipPlane.rotation.some(value => value)) return;
			Undo.initEdit({flip_plane: true, keep_saved: true});
			FlipPlane.reset();
			updateFlipPlaneVisual();
			updateFlipPlaneSliders();
			Undo.finishEdit('Reset flip planes', {flip_plane: true, keep_saved: true});
			Blockbench.showQuickMessage(tl('message.flip_plane_reset'));
		}
	})

	// 编号68：固定世界位置——打开后旋转组时，内部块/组的世界位置保持不变（旋转值相应吸收逆旋转）
	new Toggle('fixed_world_position', {
		icon: 'fas.fa-anchor',
		default: false,
		category: 'transform',
		condition: () => Modes.edit && Format.bone_rig && !!Group.first_selected,
	})

	//Origin
	function moveOriginOnAxis(modify, axis) {
		const lock = !origin_slider_direct_values.value;
		var rotation_objects = getPivotObjects();

		let modifyInSpace = (real_value, obj) => {
			let space_offset = 0;
			if (settings.local_position_values.value &&
				obj.parent instanceof OutlinerNode &&
				obj.parent.getTypeBehavior('use_absolute_position')
			) {
				space_offset = -obj.parent.origin[axis];
			}
			return modify(real_value + space_offset) - space_offset;
		}

		if (rotation_objects && rotation_objects[0] instanceof Group) {
			let elements_to_update = [];
			for (let group of rotation_objects) {
				let val = modifyInSpace(group.origin[axis], group);
				if (lock) {
					let origin_copy = group.origin.slice();
					origin_copy[axis] = val;
					group.transferOrigin(origin_copy);
				} else {
					group.origin[axis] = val;
				}
				group.forEachChild(element => elements_to_update.safePush(element), OutlinerElement);
			}
			Canvas.updateView({
				groups: rotation_objects,
				group_aspects: {transform: true},
				elements: elements_to_update,
				element_aspects: {transform: true},
				selection: true
			});
			if (Format.bone_rig) {
				Canvas.updateAllBones();
			}
		} else {
			rotation_objects.forEach(function(obj, i) {
				let val = modifyInSpace(obj.origin[axis], obj);
				if (obj.transferOrigin && (!obj.getTypeBehavior('use_absolute_position') || lock)) {
					let origin_copy = obj.origin.slice();
					origin_copy[axis] = val;
					obj.transferOrigin(origin_copy);
				} else {
					obj.origin[axis] = val;
				}
			})
			Canvas.updateView({
				elements: rotation_objects,
				element_aspects: {transform: true, geometry: true},
				groups: Group.all,
				group_aspects: {transform: true},
				selection: true
			})
		}
		if (Modes.animate) {
			Animator.preview();
		}
	}
	function getOrigin(axis) {
		// Display the origin of the first object that the slider actually writes to,
		// so the read and write object sets stay consistent
		let pivot_objects = getPivotObjects();
		let node = pivot_objects && pivot_objects[0];
		let value = node ? node.origin[axis] : 0;

		if (settings.local_position_values.value &&
			node?.parent instanceof OutlinerNode &&
			node.parent.getTypeBehavior('use_absolute_position')
		) {
			value -= node.parent.origin[axis];
		}
		return value;
	}
	const slider_origin_common_options = {
		category: 'transform',
		condition: () => (Modes.edit || Modes.animate || Modes.pose) && getPivotObjects() && (Group.first_selected || Outliner.selected.length > Locator.selected.length),
		getInterval: getSpatialInterval,
		onBefore: function() {
			let transfer_undo_nodes = getGroupTransferOriginUndoNodes(Group.all.filter(g => g.selected));
			transfer_undo_nodes.elements.safePush(...Outliner.selected);
			Undo.initEdit({elements: transfer_undo_nodes.elements, groups: transfer_undo_nodes.groups})
		},
		onAfter: function() {
			Undo.finishEdit('Change pivot point')
		}
	};
	let origin_slider_direct_values = new Toggle('origin_slider_direct_values', {
		icon: 'view_real_size',
		// 反馈#202：默认开启（原版手感）：枢轴滑块直接写枢轴值
		default: true,
		category: slider_origin_common_options.category,
		condition: () => {
			if (!slider_origin_common_options.condition()) return false;
			if (Group.first_selected) return true;
			let first_element = Outliner.selected[0];
			if (!first_element) return false;
			return first_element.getTypeBehavior('has_pivot') && first_element.getTypeBehavior('use_absolute_position');
		},
	})
	new NumSlider('slider_origin_x', {
		name: tl('action.slider_origin', ['X']),
		description: tl('action.slider_origin.desc', ['X']),
		color: 'x',
		...slider_origin_common_options,
		get() {
			return getOrigin(0);
		},
		change: function(modify) {
			if (Modes.pose) return;
			moveOriginOnAxis(modify, 0)
		},
	})
	new NumSlider('slider_origin_y', {
		name: tl('action.slider_origin', ['Y']),
		description: tl('action.slider_origin.desc', ['Y']),
		color: 'y',
		...slider_origin_common_options,
		get() {
			return getOrigin(1);
		},
		change: function(modify) {
			if (Modes.pose) return;
			moveOriginOnAxis(modify, 1)
		},
	})
	new NumSlider('slider_origin_z', {
		name: tl('action.slider_origin', ['Z']),
		description: tl('action.slider_origin.desc', ['Z']),
		color: 'z',
		...slider_origin_common_options,
		get() {
			return getOrigin(2);
		},
		change: function(modify) {
			if (Modes.pose) return;
			moveOriginOnAxis(modify, 2)
		},
	})
	let slider_vector_origin = [BarItems.slider_origin_x, BarItems.slider_origin_y, BarItems.slider_origin_z];
	slider_vector_origin.forEach(slider => slider.slider_vector = slider_vector_origin);
	
	new NumSlider('slider_spline_handle_tilt', {
		name: tl('action.slider_spline_handle_tilt'),
		description: tl('action.slider_spline_handle_tilt.desc'),
		category: 'transform',
		condition: () => Modes.edit && SplineMesh.selected.length && SplineMesh.selected[0].getSelectedHandles().length,
		getInterval: getSpatialInterval,
		get: function () {
			let hKey = SplineMesh.selected[0].getSelectedHandles()[0];
			return SplineMesh.selected[0].handles[hKey].tilt;
		},
		change: function (modify) {
			SplineMesh.selected.forEach((obj, i) => {
				obj.getSelectedHandles().forEach((hKey, i) => {
					let handle = obj.handles[hKey];
					var v = modify(handle.tilt);
					handle.tilt = v;
					obj.preview_controller.updateGeometry(obj);
					obj.refreshTubeFaces();
				})
			})
		},
		onBefore: function () {
			Undo.initEdit({ elements: SplineMesh.selected })
		},
		onAfter: function () {
			Undo.finishEdit('Adjust tilt of selected handle')
		}
	})
	new NumSlider('slider_spline_handle_size', {
		name: tl('action.slider_spline_handle_size'),
		description: tl('action.slider_spline_handle_size.desc'),
		category: 'transform',
		condition: () => Modes.edit && SplineMesh.selected.length && SplineMesh.selected[0].getSelectedHandles().length,
		getInterval: getSpatialInterval,
		get: function () {
			let hKey = SplineMesh.selected[0].getSelectedHandles()[0];
			return SplineMesh.selected[0].handles[hKey].size;
		},
		change: function (modify) {
			SplineMesh.selected.forEach((obj, i) => {
				obj.getSelectedHandles().forEach((hKey, i) => {
					let handle = obj.handles[hKey];
					var v = modify(handle.size);
					handle.size = Math.max(0, v);
					obj.preview_controller.updateGeometry(obj);
					obj.refreshTubeFaces();
				})
			})
		},
		onBefore: function () {
			Undo.initEdit({ elements: SplineMesh.selected })
		},
		onAfter: function () {
			Undo.finishEdit('Adjust tilt of selected handle')
		}
	})
	let slider_vector_spline_resolution = [BarItems.slider_spline_handle_tilt, BarItems.slider_spline_handle_size];
	slider_vector_spline_resolution.forEach(slider => slider.slider_vector = slider_vector_spline_resolution);

	new Action('rotate_x_cw', {
		name: tl('action.rotate_cw', 'X'),
		icon: 'rotate_right',
		color: 'x',
		category: 'transform',
		click() {
			rotateSelected(0, 1);
		}
	})
	new Action('rotate_x_ccw', {
		name: tl('action.rotate_ccw', 'X'),
		icon: 'rotate_left',
		color: 'x',
		category: 'transform',
		click() {
			rotateSelected(0, 3);
		}
	})
	new Action('rotate_y_cw', {
		name: tl('action.rotate_cw', 'Y'),
		icon: 'rotate_right',
		color: 'y',
		category: 'transform',
		click() {
			rotateSelected(1, 1);
		}
	})
	new Action('rotate_y_ccw', {
		name: tl('action.rotate_ccw', 'Y'),
		icon: 'rotate_left',
		color: 'y',
		category: 'transform',
		click() {
			rotateSelected(1, 3);
		}
	})
	new Action('rotate_z_cw', {
		name: tl('action.rotate_cw', 'Z'),
		icon: 'rotate_right',
		color: 'z',
		category: 'transform',
		click() {
			rotateSelected(2, 1);
		}
	})
	new Action('rotate_z_ccw', {
		name: tl('action.rotate_ccw', 'Z'),
		icon: 'rotate_left',
		color: 'z',
		category: 'transform',
		click() {
			rotateSelected(2, 3);
		}
	})

	new Action('flip_x', {
		name: tl('action.flip', 'X'),
		icon: 'icon-mirror_x',
		color: 'x',
		category: 'transform',
		condition: {modes: ['edit', 'animate']},
		click() {
			mirrorSelected(0);
		}
	})
	new Action('flip_y', {
		name: tl('action.flip', 'Y'),
		icon: 'icon-mirror_y',
		color: 'y',
		category: 'transform',
		modes: ['edit', 'animate'],
		click() {
			mirrorSelected(1);
		}
	})
	new Action('flip_z', {
		name: tl('action.flip', 'Z'),
		icon: 'icon-mirror_z',
		color: 'z',
		category: 'transform',
		modes: ['edit', 'animate'],
		click() {
			mirrorSelected(2);
		}
	})

	new Action('flip_in_place_x', {
		name: tl('action.flip_in_place', 'X'),
		icon: 'icon-mirror_x',
		color: 'x',
		category: 'transform',
		condition: {modes: ['edit']},
		click() {
			mirrorSelectedInPlace(0);
		}
	})
	new Action('flip_in_place_y', {
		name: tl('action.flip_in_place', 'Y'),
		icon: 'icon-mirror_y',
		color: 'y',
		category: 'transform',
		condition: {modes: ['edit']},
		click() {
			mirrorSelectedInPlace(1);
		}
	})
	new Action('flip_in_place_z', {
		name: tl('action.flip_in_place', 'Z'),
		icon: 'icon-mirror_z',
		color: 'z',
		category: 'transform',
		condition: {modes: ['edit']},
		click() {
			mirrorSelectedInPlace(2);
		}
	})

	new Action('center_x', {
		name: tl('action.center', 'X'),
		icon: 'vertical_align_center',
		color: 'x',
		category: 'transform',
		click() {
			Undo.initEdit({elements: Outliner.selected, groups: Group.all.filter(g => g.selected)});
			centerElements(0, true);
			Undo.finishEdit('Center selection on X axis')
		}
	})
	new Action('center_y', {
		name: tl('action.center', 'Y'),
		icon: 'vertical_align_center',
		color: 'y',
		category: 'transform',
		click() {
			Undo.initEdit({elements: Outliner.selected, groups: Group.all.filter(g => g.selected)});
			centerElements(1, true);
			Undo.finishEdit('Center selection on Y axis')
		}
	})
	new Action('center_z', {
		name: tl('action.center', 'Z'),
		icon: 'vertical_align_center',
		color: 'z',
		category: 'transform',
		click() {
			Undo.initEdit({elements: Outliner.selected, groups: Group.all.filter(g => g.selected)});
			centerElements(2, true);
			Undo.finishEdit('Center selection on Z axis')
		}
	})
	new Action('center_lateral', {
		icon: 'filter_center_focus',
		category: 'transform',
		click() {
			Undo.initEdit({elements: Outliner.selected, groups: Group.all.filter(g => g.selected)});
			centerElements(0, false);
			centerElements(2, true);
			Undo.finishEdit('Center selection')
		}
	})

	//Move Cube Keys
	new Action('move_up', {
		icon: 'arrow_upward',
		category: 'transform',
		condition: {modes: ['edit'], method: () => (!open_menu && selected.length)},
		keybind: new Keybind({key: 38, ctrl: null, shift: null}),
		click(e) {
			if (Prop.active_panel === 'uv') {
				UVEditor.moveSelection([0, -1], e)
			} else {
				moveElementsRelative(-1, 2, e)
			}
		}
	})
	new Action('move_down', {
		icon: 'arrow_downward',
		category: 'transform',
		condition: {modes: ['edit'], method: () => (!open_menu && selected.length)},
		keybind: new Keybind({key: 40, ctrl: null, shift: null}),
		click(e) {
			if (Prop.active_panel === 'uv') {
				UVEditor.moveSelection([0, 1], e)
			} else {
				moveElementsRelative(1, 2, e)
			}
		}
	})
	new Action('move_left', {
		icon: 'arrow_back',
		category: 'transform',
		condition: {modes: ['edit'], method: () => (!open_menu && selected.length)},
		keybind: new Keybind({key: 37, ctrl: null, shift: null}),
		click(e) {
			if (Prop.active_panel === 'uv') {
				UVEditor.moveSelection([-1, 0], e)
			} else {
				moveElementsRelative(-1, 0, e)
			}
		}
	})
	new Action('move_right', {
		icon: 'arrow_forward',
		category: 'transform',
		condition: {modes: ['edit'], method: () => (!open_menu && selected.length)},
		keybind: new Keybind({key: 39, ctrl: null, shift: null}),
		click(e) {
			if (Prop.active_panel === 'uv') {
				UVEditor.moveSelection([1, 0], e)
			} else {
				moveElementsRelative(1, 0, e)
			}
		}
	})
	new Action('move_forth', {
		icon: 'keyboard_arrow_up',
		category: 'transform',
		condition: {modes: ['edit'], method: () => (!open_menu && selected.length)},
		keybind: new Keybind({key: 33, ctrl: null, shift: null}),
		click(e) {moveElementsRelative(-1, 1, e)}
	})
	new Action('move_back', {
		icon: 'keyboard_arrow_down',
		category: 'transform',
		condition: {modes: ['edit'], method: () => (!open_menu && selected.length)},
		keybind: new Keybind({key: 34, ctrl: null, shift: null}),
		click(e) {moveElementsRelative(1, 1, e)}
	})

	new Toggle('toggle_visibility', {
		icon: 'visibility',
		category: 'transform',
		onChange() {toggleElementProperty('visibility')}
	})
	new Toggle('toggle_locked', {
		icon: 'fas.fa-lock',
		category: 'transform',
		onChange() {toggleElementProperty('locked')}
	})
	new Toggle('toggle_export', {
		icon: 'save',
		category: 'transform',
		onChange() {toggleElementProperty('export')}
	})
	new Toggle('toggle_autouv', {
		icon: 'fullscreen_exit',
		category: 'transform',
		condition: {modes: ['edit']},
		onChange() {toggleElementProperty('autouv')}
	})
	new Toggle('toggle_shade', {
		icon: 'wb_sunny',
		category: 'transform',
		condition: () => Format.java_cube_shading_properties && !Format.java_cube_shade_direction_override && Modes.edit,
		onChange() {toggleElementProperty('shade')}
	})
	new Toggle('toggle_mirror_uv', {
		icon: 'icon-mirror_x',
		category: 'transform',
		condition: () => (Modes.edit || Modes.paint) && UVEditor.isBoxUV(),
		onChange() {toggleElementProperty('mirror_uv')}
	})
	function updateToggle(toggle, key) {
		if (!Condition(toggle.condition)) return;
		let first = Outliner.selected.find(element => element[key] != undefined);
		let value = first && first[key];
		toggle.value = !!value;
		toggle.updateEnabledState();
	}
	Blockbench.on('update_selection', () => {
		updateToggle(BarItems.toggle_visibility, 'visibility');
		updateToggle(BarItems.toggle_locked, 'locked');
		updateToggle(BarItems.toggle_export, 'export');
		updateToggle(BarItems.toggle_autouv, 'autouv');
		updateToggle(BarItems.toggle_shade, 'shade');
		updateToggle(BarItems.toggle_mirror_uv, 'mirror_uv');
	})
	new Action('update_autouv', {
		icon: 'brightness_auto',
		category: 'transform',
		condition: () => !Modes.edit && UVEditor.isFaceUV(),
		click() {
			if (Cube.selected.length) {
				Undo.initEdit({elements: Cube.selected[0].forSelected(), selection: true})
				Cube.selected[0].forSelected(function(cube) {
					cube.mapAutoUV()
				})
				Undo.finishEdit('Update auto UV')
			}
		}
	})
	new Toggle('toggle_stretch_linked', {
		icon: 'fas.fa-link',
		category: 'transform',
		linked_setting: 'stretch_linked',
		condition: () => Format.stretch_cubes && Cube.selected.length && Modes.edit
	})
	new Action('origin_to_geometry', {
		icon: 'filter_center_focus',
		category: 'transform',
		condition: {modes: ['edit', 'animate'], selected: {outliner: true}},
		click() {
			if (Format.bone_rig && Group.first_selected) {
				let {elements, groups} = getGroupTransferOriginUndoNodes(Group.multi_selected);
				Undo.initEdit({elements, groups})

				for (let group of Group.multi_selected) {
					let position = new THREE.Vector3();
					let amount = 0;
					group.forEachChild(function(obj) {
						if (obj.getWorldCenter) {
							position.add(obj.getWorldCenter());
							amount++;
						}
					}, OutlinerElement);
					if (amount === 0) continue;
					position.divideScalar(amount);
					group.mesh.parent.worldToLocal(position);
					if (group.parent instanceof Group) {
						position.x += group.parent.origin[0];
						position.y += group.parent.origin[1];
						position.z += group.parent.origin[2];
					}
					group.transferOrigin(position.toArray());
				}

			} else if (Outliner.selected[0]) {
				Undo.initEdit({elements: Outliner.selected})

				var center = getSelectionCenter();
				var original_center = center.slice();
				
				Outliner.selected.forEach(element => {
					if (!element.transferOrigin) return;
					if (Format.bone_rig && element.parent instanceof Group) {
						var v = new THREE.Vector3().fromArray(original_center);
						element.parent.mesh.worldToLocal(v);
						v.x += element.parent.origin[0];
						v.y += element.parent.origin[1];
						v.z += element.parent.origin[2];
						center = v.toArray();
						element.transferOrigin(center)
					} else {
						element.transferOrigin(original_center)
					}
				})
			}
			Canvas.updateView({
				elements: Outliner.selected,
				element_aspects: {transform: true, geometry: true},
				groups: Group.multi_selected,
				selection: true
			});
			Undo.finishEdit('Center pivot');
		}
	})
	new Action('center_individual_pivots', {
		icon: 'center_focus_weak',
		category: 'transform',
		condition: {modes: ['edit', 'animate'], selected: {outliner: true}},
		click() {
			let transfer_undo_nodes = getGroupTransferOriginUndoNodes(Group.all.filter(group => group.selected));
			transfer_undo_nodes.elements.safePush(...Outliner.selected);
			Undo.initEdit({outliner: true, elements: transfer_undo_nodes.elements, groups: transfer_undo_nodes.groups})
			for (let group of Group.all) {
				if (!group.selected) continue;
				let position = new THREE.Vector3();
				let amount = 0;
				group.children.forEach((obj) => {
					if (obj.getWorldCenter) {
						position.add(obj.getWorldCenter());
						amount++;
					}
				})
				position.divideScalar(amount);
				group.mesh.parent.worldToLocal(position);
				if (group.parent instanceof Group) {
					position.x += group.parent.origin[0];
					position.y += group.parent.origin[1];
					position.z += group.parent.origin[2];
				}
				group.transferOrigin(position.toArray());

			}
			for (let element of Outliner.selected) {
				if (!element.getWorldCenter || !element.transferOrigin) continue;
				let center = element.getWorldCenter().toArray();
				let original_center = center.slice();
				
				if (Format.bone_rig && element.parent instanceof Group) {
					let v = new THREE.Vector3().fromArray(original_center);
					element.parent.mesh.worldToLocal(v);
					v.x += element.parent.origin[0];
					v.y += element.parent.origin[1];
					v.z += element.parent.origin[2];
					center = v.toArray();
					element.transferOrigin(center)
				} else {
					element.transferOrigin(original_center)
				}
			}
			Canvas.updateView({
				elements: Outliner.selected,
				element_aspects: {transform: true, geometry: true},
				groups: Group.multi_selected,
				selection: true
			});
			Undo.finishEdit('Center individual pivots');
		}
	})
	new Action('bone_reset_toggle', {
		icon: 'check_box_outline_blank',
		category: 'transform',
		condition: function() {return Format.bone_rig && Group.first_selected;},
		click() {
			Undo.initEdit({groups: Group.multi_selected})
			for (let group of Group.multi_selected) {
				group.reset = !Group.first_selected.reset
			}
			updateNslideValues()
			Undo.finishEdit('Toggle bone reset')
		}
	})

	new Action('remove_blank_faces', {
		icon: 'cancel_presentation',
		condition: () => !Format.box_uv,
		click() {
			let elements = Outliner.selected.filter(el => el.faces);
			Undo.initEdit({elements})
			var arr = elements.slice()
			var empty_elements = [];
			var cleared_total = 0;
			unselectAllElements()
			arr.forEach(element => {
				var clear_count = 0;
				var original_face_count = Object.keys(element.faces).length
				for (var face in element.faces) {
					var face_tag = element.faces[face];
					if (face_tag.texture == false) {
						if (element instanceof Cube) {
							face_tag.texture = null;
						} else {
							delete element.faces[face];
						}
						clear_count++;
						cleared_total++;
					}
				}
				if (clear_count == original_face_count) {
					empty_elements.push(element);
				}
			})
			updateSelection();
			Blockbench.showQuickMessage(tl('message.removed_faces', [cleared_total]))
			if (empty_elements.length) {
				Blockbench.showMessageBox({
					title: tl('message.cleared_blank_faces.title'),
					icon: 'rotate_right',
					message: tl('message.cleared_blank_faces.message', [empty_elements.length]),
					buttons: ['generic.remove', 'dialog.cancel'],
					confirm: 0,
					cancel: 1,
				}, function(r) {
					empty_elements.forEach(element => {
						if (r == 0) {
							element.remove();
							elements.remove(element)
						} else {
							for (var face in element.faces) {
								element.faces[face].texture = false;
							}
						}
					})
					updateSelection();
					Canvas.updateView({elements, element_aspects: {geometry: true, faces: true, uv: true}})
					Undo.finishEdit('Remove blank faces');
				})
			} else {
				Canvas.updateView({elements, element_aspects: {geometry: true, faces: true, uv: true}})
				Undo.finishEdit('Remove blank faces');
			}
		}
	})
	new Action('auto_set_cullfaces', {
		icon: 'smart_button',
		condition: () => Modes.edit && Format.cullfaces,
		click() {
			if (!Cube.selected.length) {
				BarItems.select_all.click();
			}
			Undo.initEdit({elements: Cube.selected});
			
			Cube.selected.forEach(cube => {
				let vertices = cube.getGlobalVertexPositions();
				['east', 'up', 'south', 'west', 'down', 'north'].forEach((fkey, index) => {
					let axis = index % 3;
					let face = cube.faces[fkey];
					if (face.texture === null) return;
					let face_corners = face.getVertexIndices().map(vindex => vertices[vindex]);
					let offset = index < 3 ? [15.98, 32] : [-16, 0.02];

					let culled = face_corners.allAre(corner => {
						let off_axes = [0, 1, 2].filter(v => axis !== v);
						return (corner[axis] > offset[0] && corner[axis] < offset[1]
							&& corner[off_axes[0]] >= 0 && corner[off_axes[0]] <= 16
							&& corner[off_axes[1]] >= 0 && corner[off_axes[1]] <= 16
						);
					})
					face.cullface = culled ? fkey : '';
				});
			})

			updateSelection();
			Undo.finishEdit('Automatically set cullfaces');
		}
	})
})

Object.assign(window, {
	getSelectionCenter,
	moveElementsRelative,
	rotateSelected,
	flipNameOnAxis,
	mirrorSelected,
	FlipPlane,
	centerElements,
	moveElementsInSpace,
	changeNodeLocalPosition,
	getSpatialInterval,
	getRotationInterval,
	getRotationObjects,
	getPivotObjects,
	getParentTransformSpace,
	getRotate90Space,
	rotateOnAxis,
	afterRotateOnAxis,
	selectSplinePoints,
	tiltSplineHandle
});
