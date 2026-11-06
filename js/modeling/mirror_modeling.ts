import { Blockbench } from "../api";
import { Armature } from "../outliner/types/armature";
import { ArmatureBone } from "../outliner/types/armature_bone";
import { Billboard } from "../outliner/types/billboard";
import { flipNameOnAxis } from "./transform";

export const MirrorModeling = {
	initial_transformer_position: 0,
	outliner_snapshot: null,
	isCentered(element: OutlinerElement) {
		let center = Format.centered_grid ? 0 : 8;
		let element_type_options = MirrorModeling.element_types[element.type];

		if (element_type_options.isCentered) {
			let result = element_type_options.isCentered(element, {center});
			if (result == false) return false;
		}

		if (element_type_options.check_parent_symmetry != false) {
			let isAsymmetrical = (parent) => {
				if (parent instanceof OutlinerNode) {
					if ("origin" in parent && parent.origin[0] != center) return true;
					if ("rotation" in parent && (parent.rotation[1] || parent.rotation[2])) return true;
					return isAsymmetrical(parent.parent);
				}
			}
			if (isAsymmetrical(element.parent)) return false;
		}

		return true;
	},
	createClone(original: OutlinerElement, undo_aspects: UndoAspects) {
		// Create or update clone
		let options = BarItems.mirror_modeling.tool_config.options;
		// 反馈#288：智能镜像组两侧要镜像对称，UV 必须跟几何一起镜像（两侧仍读同一块纹理区域，
		// 只是取样方向相反）。所以固定开启，不受镜像建模里的 UV 开关影响。
		let cached_data = MirrorModeling.cached_elements[original.uuid];
		let mirror_uv = cached_data?.smart_pair ? true : options.mirror_uv;
		// 反馈#305 复报第 4 轮④：智能复制组按「两侧成员根之间」的基准镜像内容
		let center = cached_data?.mirror_center ?? (Format.centered_grid ? 0 : 8);
		// 反馈#305 后续④：镜像轴由智能复制组按成员相对位置判定（左右/前后/上下）
		let mirror_axis = cached_data?.smart_pair ? (cached_data?.mirror_axis ?? 0) : 0;
		let mirror_element = cached_data?.counterpart;
		let element_type_options = MirrorModeling.element_types[original.type];
		let element_before_snapshot;

		if (mirror_element == original) return;
		if (mirror_element && !Outliner.elements.includes(mirror_element)) return;

		if (mirror_element) {
			element_before_snapshot = mirror_element.getUndoCopy(undo_aspects);
			mirror_element.extend(original);
			
			mirror_element.flip(mirror_axis, center);

			mirror_element.extend({
				name: element_before_snapshot.name,
				color: element_before_snapshot.color
			});
			if (!mirror_uv && element_type_options.maintainUV) {
				element_type_options.maintainUV(mirror_element, element_before_snapshot)
			}
			if (element_type_options.updateCounterpart) {
				element_type_options.updateCounterpart(original, mirror_element, {
					element_before_snapshot,
					center,
				})
			}

			// Update hierarchy up
			// 反馈#305 第 5 点：智能复制组在「镜像翻转」编辑里只同步块本身，祖先组的
			// 位移/旋转/缩放不跟着映射（SmartCopyGroup 在该次编辑里判定 group_flip）
			let sync_parents = !cached_data?.smart_pair
				|| typeof SmartCopyGroup == 'undefined'
				|| SmartCopyGroup.groupSyncEnabled();
			function updateParent(child: OutlinerNode, child_b: OutlinerNode) {
				let parent = child.parent;
				let parent_b = child_b.parent;
				if (parent == parent_b || parent == Outliner.ROOT || parent_b == Outliner.ROOT) return;
				if (parent.type != parent_b.type) return;
				if (parent instanceof OutlinerNode == false || parent.getTypeBehavior('parent') != true) return;
				if (parent_b instanceof OutlinerNode == false || parent_b.getTypeBehavior('parent') != true) return;

				let before_snapshot = parent_b instanceof Group ? parent_b.getSaveCopy() : undefined;
				MirrorModeling.updateParentNodeCounterpart(parent_b, parent, center, mirror_axis);
				if (parent_b instanceof Group) MirrorModeling.insertGroupIntoUndo(parent_b, undo_aspects, before_snapshot);

				updateParent(parent, parent_b);
			}
			if (sync_parents) updateParent(original, mirror_element);

		} else {
			function getParentMirror(child: OutlinerNode) {
				let parent = child.parent;
				if (parent instanceof OutlinerNode == false) return 'root';

				if ('origin' in parent && Math.epsilon(parent.origin[0], center) && MirrorModeling.isParentTreeSymmetrical(child, {center})) {
					return parent;
				} else {
					let mirror_group_parent = getParentMirror(parent) as OutlinerNode & OutlinerNodeParentTraits;
					// @ts-ignore
					let mirror_group = new parent.constructor(parent);

					flipNameOnAxis(mirror_group, 0, (name: string) => true, parent.name);
					mirror_group.origin[0] = MirrorModeling.flipCoord(mirror_group.origin[0]);
					mirror_group.rotation[1] *= -1;
					mirror_group.rotation[2] *= -1;
					mirror_group.isOpen = parent.isOpen;

					let parent_list = mirror_group_parent instanceof OutlinerNode ? mirror_group_parent.children : Outliner.root;
					let match = parent_list.find((node) => {
						if (node instanceof OutlinerNode == false) return false;
						if (
							(node.name == mirror_group.name || Condition(mirror_group.getTypeBehavior('unique_name'))) &&
							('rotation' in node && node.rotation instanceof Array && node.rotation.equals(mirror_group.rotation)) &&
							('origin' in node && node.origin instanceof Array && node.origin.equals(mirror_group.origin))
						) {
							return true;
						}
					})
					if (!match) {
						mirror_group.createUniqueName();
						mirror_group.addTo(mirror_group_parent).init();
						match = mirror_group;
					}
					if (match instanceof Group) {
						let before_snapshot = match != mirror_group ? match.getSaveCopy() : undefined;
						MirrorModeling.insertGroupIntoUndo(match, undo_aspects, before_snapshot);
					} else {
						MirrorModeling.insertElementIntoUndo(match as OutlinerElement, undo_aspects);
					}
					return match;
				}
			}
			let add_to = getParentMirror(original);
			// @ts-ignore
			mirror_element = new original.constructor(original);
			mirror_element.addTo(add_to).init();
			mirror_element.flip(0, center);

			if (element_type_options.updateCounterpart) {
				element_type_options.updateCounterpart(original, mirror_element, {
					options,
					center,
				})
			}
		}

		MirrorModeling.insertElementIntoUndo(mirror_element, undo_aspects, element_before_snapshot);

		let {preview_controller} = mirror_element;
		preview_controller.updateAll(mirror_element);
		return mirror_element;
	},
	/**
	 * 反馈#305 复报第 5 轮：`center` 可选，默认沿用全局镜像面。
	 * 智能复制组的成员根可能并不关于全局镜像面对称（断开后被挪过位置，或 Ctrl+D 出来的
	 * 三成员链里有两个成员在同一侧），祖先组必须按「这一对的中轴」镜像，否则内容编辑会
	 * 顺手把对侧成员根的 origin 翻到全局镜像位置——第三个成员于是和第二个重合。
	 */
	updateParentNodeCounterpart(node: OutlinerNode, original: OutlinerNode, center?: number, axis = 0) {
		node.extend({
			position: 'position' in original ? original.position : undefined,
			origin: 'origin' in original ? original.origin : undefined,
			rotation: 'rotation' in original ? original.rotation : undefined,
			scale: 'scale' in original ? original.scale : undefined,
			// color: 'color' in original ? original.color : undefined,
		});

		if ('origin' in node) {
			node.origin[axis] = center === undefined
				? MirrorModeling.flipCoord(node.origin[axis])
				: 2 * center - node.origin[axis];
		}
		if ('rotation' in node) {
			for (let i = 0; i < 3; i++) {
				if (i !== axis) node.rotation[i] *= -1;
			}
		}
	},
	getEditSide(fallback = 1) {
		return Math.sign(Transformer.position.x || MirrorModeling.initial_transformer_position) || fallback;
	},
	flipCoord(input: number): number {
		if (Format.centered_grid) {
			return -input;
		} else {
			return 16 - input;
		}
	},
	getMirrorElement(element: OutlinerElement): OutlinerElement | false {
		let element_type_options = MirrorModeling.element_types[element.type];
		let center = Format.centered_grid ? 0 : 8;
		if (element_type_options.getMirroredElement) {
			return element_type_options.getMirroredElement(element, {center});
		}
		return false;
	},
	isParentTreeSymmetrical(element: OutlinerNode, {center}) {
		if (element.parent instanceof Group && Format.bone_rig == false)  return true;
		let parents = [];
		let subject = element;
		let symmetry_axes = [0];
		let off_axes = [1, 2];
		while (subject.parent instanceof OutlinerNode) {
			subject = subject.parent;
			parents.push(subject)
		}
		return parents.allAre(parent => {
			if (parent.rotation && off_axes.some(axis => !Math.epsilon(parent.rotation[axis], 0))) return false;
			if (parent.origin && !symmetry_axes.allAre(axis => Math.epsilon(parent.origin[axis], center))) return false;
			return true;
		})
	},
	isParentTreeOpposite(element1: OutlinerNode, element2: OutlinerNode): boolean {
		const getAllAncestors = (el: OutlinerNode) => {
			let list = [];
			while (el.parent instanceof OutlinerNode && list.length < 50) {
				el = el.parent;
				list.push(el);
			}
			return list;
		}
		let e1_parents = getAllAncestors(element1);
		let e2_parents = getAllAncestors(element2);
		if (e1_parents.length != e2_parents.length) return false;
		for (let i = 0; i < e1_parents.length; i++) {
			let parent1 = e1_parents[i];
			let parent2 = e2_parents[i];
			if (parent1.type != parent2.type) return false;
			if (parent1.origin) {
				if (!Math.epsilon(parent1.origin[0], -parent2.origin[0])) return false;
				if (!Math.epsilon(parent1.origin[1], parent2.origin[1])) return false;
				if (!Math.epsilon(parent1.origin[2], parent2.origin[2])) return false;
			}
			if (parent1.rotation) {
				if (!Math.epsilon(parent1.rotation[0], parent2.rotation[0])) return false;
				if (!Math.epsilon(parent1.rotation[1], -parent2.rotation[1])) return false;
				if (!Math.epsilon(parent1.rotation[2], -parent2.rotation[2])) return false;
			}
		}
		return true;
	},
	insertElementIntoUndo(element: OutlinerElement, undo_aspects: UndoAspects, element_before_snapshot?: any) {
		// pre
		if (element_before_snapshot) {
			Undo.current_save.elements ??= {};
			if (!Undo.current_save.elements[element.uuid]) Undo.current_save.elements[element.uuid] = element_before_snapshot;
		} else {
			if (!Undo.current_save.outliner) Undo.current_save.outliner = MirrorModeling.outliner_snapshot;
		}

		// post
		if (!element_before_snapshot) undo_aspects.outliner = true;
		undo_aspects.elements ??= [];
		if (!undo_aspects.elements.includes(element)) {
			// 与 insertGroupIntoUndo 相同：换新数组，避免把对侧节点写进调用方的活选区数组
			undo_aspects.elements = [...undo_aspects.elements, element];
		}
	},
	/**
	 * 反馈#325：只登记「编辑前快照」，不把节点塞进 post 的 aspects 列表。
	 *
	 * 智能复制组在 initEdit 时需要对侧节点的旧快照，但 post 侧记录要等到 finishEdit
	 * （那时节点最终状态才确定）。旧实现直接在 initEdit 里调用 insertElementIntoUndo，
	 * 这会被迫先复制 aspects.elements，而上游存在「initEdit 先传空数组、之后向同一个
	 * 数组 push」的用法（元素复制 `Duplicate elements` 就是：先传 added_elements，
	 * 再往里 push 新副本）。换掉引用后这些新副本不会进 pre/post 快照，撤销时既不会被
	 * 删除、又不在 outliner 快照树里，最后被 loadJSON 当成「多出来的节点」挂到根目录
	 * （用户看到的「复制的方块不会消失、回到根目录」）。
	 */
	insertElementPreSnapshot(element: OutlinerElement, snapshot: unknown) {
		Undo.current_save.elements ??= {};
		if (!Undo.current_save.elements[element.uuid]) Undo.current_save.elements[element.uuid] = snapshot;
	},
	insertGroupPreSnapshot(snapshot: {uuid: UUID}) {
		Undo.current_save.groups ??= [];
		if (!Undo.current_save.groups.find(g => g.uuid == snapshot.uuid)) {
			Undo.current_save.groups.push(snapshot);
		}
	},
	insertGroupIntoUndo(group: Group, undo_aspects: UndoAspects, before_snapshop?: any) {
		// pre
		Undo.current_save.groups ??= [];
		if (before_snapshop) {
			if (!Undo.current_save.groups.find((g: any) => g.uuid == before_snapshop.uuid)) {
				Undo.current_save.groups.push(before_snapshop);
			}
		} else {
			if (!Undo.current_save.outliner) Undo.current_save.outliner = MirrorModeling.outliner_snapshot;
		}

		// post
		if (!before_snapshop) undo_aspects.outliner = true;
		undo_aspects.groups ??= [];
		if (!undo_aspects.groups.includes(group)) {
			// Must be new array so we don't accidentally change the undo input array
			undo_aspects.groups = [...undo_aspects.groups, group];
		}
	},
	element_types: {} as Record<string, MirrorModelingElementTypeOptions>,
	registerElementType(type_class: any, options: MirrorModelingElementTypeOptions) {
		new Property(type_class, 'boolean', 'allow_mirror_modeling', {default: true});
		let type = type_class.prototype.type;
		MirrorModeling.element_types[type] = options;
	},
	cached_elements: {} as Record<string, MirrorModelingCachedData>
}
/**
 * 镜像建模的缓存条目。smart_pair 相关字段由 SmartCopyGroup 写入。
 * mirror_center：反馈#305 复报第 4 轮④——智能复制组的内容镜像基准（两侧成员根原点的中点），
 * 不填时按全局镜像面（centered_grid ? 0 : 8）。
 */
interface MirrorModelingCachedData {
	counterpart?: OutlinerElement | false
	is_centered?: boolean
	is_copy?: boolean
	edit_side?: number
	pre_part_connections?: unknown
	smart_pair?: boolean
	mirror_center?: number
	mirror_axis?: number
}
interface MirrorModelingElementTypeOptions {
	check_parent_symmetry?: boolean
	isCentered?(element: OutlinerElement, options?: {center: number}): boolean
	getMirroredElement?(element: OutlinerElement, options?: {center: number}): OutlinerElement | false
	maintainUV?(element: OutlinerElement, original_data: any): void
	discoverConnectionsPreEdit?(mesh: Mesh): {faces: Record<string, string>, vertices: Record<string, string>}
	updateCounterpart?(original: OutlinerElement, counterpart: OutlinerElement, context: {}): void
	createLocalSymmetry?(element: OutlinerElement, cached_data: any): void
}


Blockbench.on('init_edit', (args) => {
	if (!BarItems.mirror_modeling.value) return;
	let aspects = args.aspects as UndoAspects;

	MirrorModeling.initial_transformer_position = Transformer.position.x;

	if (aspects.elements && aspects.mirror_modeling != false) {
		MirrorModeling.cached_elements = {};
		MirrorModeling.outliner_snapshot = aspects.outliner ? null : Outliner.toJSON();
		let edit_side = MirrorModeling.getEditSide();

		aspects.elements.forEach((element: any) => {
			if (element.allow_mirror_modeling) {
				let is_centered = MirrorModeling.isCentered(element);

				let data = MirrorModeling.cached_elements[element.uuid] = {
					is_centered,
					is_copy: false,
					edit_side: MirrorModeling.getEditSide(0),
					counterpart: false as false | OutlinerElement,
					pre_part_connections: undefined
				};
				if (!is_centered) {
					data.is_copy = Math.sign(element.getWorldCenter().x) != edit_side;
					data.counterpart = MirrorModeling.getMirrorElement(element);
					if (!data.counterpart) data.is_copy = false;
				} else {
					if (MirrorModeling.element_types[element.type]?.discoverConnectionsPreEdit) {
						data.pre_part_connections = MirrorModeling.element_types[element.type]?.discoverConnectionsPreEdit(element)
					}
				}
			}
		})
	}
	if (aspects.group || aspects.groups) {
		if (!MirrorModeling.cached_elements) MirrorModeling.cached_elements = {};
		let selected_groups = aspects.groups ?? [aspects.group];
		MirrorModeling.outliner_snapshot = aspects.outliner ? null : Outliner.toJSON();

		// update undo
		if (!Undo.current_save.outliner) Undo.current_save.outliner = Outliner.toJSON();
		aspects.outliner = true;

		selected_groups.forEach(group => {
			if (Math.epsilon(group.origin[0], (Format.centered_grid ? 0 : 8))) return;

			let mirror_group = Group.all.find(g => {
				if (
					Math.epsilon(group.origin[0], MirrorModeling.flipCoord(g.origin[0])) &&
					Math.epsilon(group.origin[1], g.origin[1]) &&
					Math.epsilon(group.origin[2], g.origin[2]) &&
					group.getDepth() == g.getDepth()
				) {
					return true;
				}
			})

			if (mirror_group) {
				MirrorModeling.cached_elements[group.uuid] = {
					counterpart: mirror_group
				}
			}
		})
	}
})
Blockbench.on('finish_edit', ({aspects}) => {
	if (!BarItems.mirror_modeling.value) return;

	if (aspects.elements && aspects.mirror_modeling != false) {
		aspects.elements = aspects.elements.slice();
		let static_elements_copy = aspects.elements.slice();
		static_elements_copy.forEach((element) => {
			let cached_data = MirrorModeling.cached_elements[element.uuid]
			// 反馈#274：智能复制组的配对由 SmartCopyGroup 统一同步，这里跳过避免翻两次
			if (cached_data?.smart_pair) return;
			if (element.allow_mirror_modeling && !element.isEffectivelyLocked()) {
				// 缓存里已有配对（智能镜像组 / 本次编辑开始时判定过）时以缓存为准
				let is_centered = cached_data ? cached_data.is_centered : MirrorModeling.isCentered(element);

				if (is_centered && MirrorModeling.element_types[element.type]?.createLocalSymmetry) {
					// Complete other side of mesh
					MirrorModeling.element_types[element.type].createLocalSymmetry(element, cached_data);
				}
				if (is_centered) {
					let mirror_element = cached_data?.counterpart;
					if (mirror_element && Outliner.elements.includes(mirror_element) && mirror_element.uuid != element.uuid) {
						MirrorModeling.insertElementIntoUndo(mirror_element, Undo.current_save.aspects, mirror_element.getUndoCopy());
						mirror_element.remove();
						aspects.elements.remove(mirror_element);
					}
				} else {
					if (cached_data?.counterpart?.selected && cached_data.is_copy) {
						// When both sides are selected, and this one is the copy, don't update
						return;
					}
					// Construct or update clone at other side of model
					MirrorModeling.createClone(element, aspects);
				}
			}
		})
		if (aspects.group || aspects.groups || aspects.outliner) {
			Canvas.updateAllBones();
		}
	}
	if (aspects.group || aspects.groups) {
		let selected_groups = aspects.groups ?? [aspects.group];

		selected_groups.forEach(group => {
			let cached_data = MirrorModeling.cached_elements[group.uuid];
			// 反馈#274：智能复制组的组级同步由 SmartCopyGroup.finishEdit 处理
			if (cached_data?.smart_pair) return;
			let mirror_group = cached_data?.counterpart;
			if (mirror_group && Group.all.includes(mirror_group)) {
				let before_snapshot = mirror_group.getChildlessCopy();
				before_snapshot.uuid = mirror_group.uuid;
				MirrorModeling.updateParentNodeCounterpart(mirror_group, group);
				MirrorModeling.insertGroupIntoUndo(mirror_group, aspects, before_snapshot);
			}
		})

		aspects.outliner = true;
		Canvas.updateAllBones();
	}
})

let symmetry_axes = [0];
let off_axes = [1, 2];
function isOppositeVector(vec1: number[], vec2: number[], center: number = 0): boolean {
	if (symmetry_axes.some(axis => !Math.epsilon(vec1[axis]-center, center-vec2[axis]))) return false;
	if (off_axes.some(axis => !Math.epsilon(vec1[axis], vec2[axis]))) return false;
	return true;
}
function isOppositeEuler(vec1: number[], vec2: number[]): boolean {
	if (symmetry_axes.some(axis => !Math.epsilon(vec1[axis], vec2[axis]))) return false;
	if (off_axes.some(axis => !Math.epsilon(vec1[axis], -vec2[axis]))) return false;
	return true;
}

// Register element types

MirrorModeling.registerElementType(Cube, {
	isCentered(element: Cube, {center}) {
		if (Math.roundTo(element.rotation[1], 3) || Math.roundTo(element.rotation[2], 3)) return false;
		if (!Math.epsilon(element.to[0], MirrorModeling.flipCoord(element.from[0]), 0.01)) return false;
		return true;
	},
	getMirroredElement(element: Cube, {center}) {
		let e = 0.01;
		let symmetry_axes = [0];
		let off_axes = [1, 2];
		if (
			symmetry_axes.find((axis) => !Math.epsilon(element.from[axis]-center, center-element.to[axis], e)) == undefined &&
			off_axes.find(axis => element.rotation[axis]) == undefined &&
			MirrorModeling.isParentTreeSymmetrical(element, {center})
		) {
			return element;
		} else {
			for (var element2 of Cube.all) {
				if (
					element2 != element &&
					Math.epsilon(element.inflate, element2.inflate, e) &&
					!off_axes.some(axis => !Math.epsilon(element.from[axis], element2.from[axis], e)) &&
					!off_axes.some(axis => !Math.epsilon(element.to[axis], element2.to[axis], e)) &&
					!symmetry_axes.some(axis => !Math.epsilon(element.size(axis), element2.size(axis), e)) &&
					!symmetry_axes.some(axis => !Math.epsilon(element.to[axis]-center, center-element2.from[axis], e)) &&
					isOppositeEuler(element.rotation, element2.rotation) &&
					element2.getDepth() == element.getDepth()
				) {
					return element2;
				}
			}
		}
		return false;
	},
	maintainUV(element: Cube, original_data) {
		element.extend({
			faces: original_data.faces,
			uv_offset: original_data.uv_offset,
			mirror_uv: original_data.mirror_uv,
			box_uv: original_data.box_uv,
			autouv: original_data.autouv
		});
	}
})
MirrorModeling.registerElementType(Mesh, {
	isCentered(element: Mesh, {center}) {
		if (Math.roundTo(element.origin[0], 3) != center) return false;
		if (Math.roundTo(element.rotation[1], 3) || Math.roundTo(element.rotation[2], 3)) return false;
		if (!MirrorModeling.isParentTreeSymmetrical(element, {center})) return false;
		return true;
	},
	getMirroredElement(element: Mesh, {center}) {
		let e = 0.01;
		let symmetry_axes = [0];
		let off_axes = [ 1, 2];
		let ep = 0.5;
		let this_center = element.getCenter(true);
		if (
			symmetry_axes.find((axis) => !Math.epsilon(element.origin[axis], center, e)) == undefined &&
			symmetry_axes.find((axis) => !Math.epsilon(this_center[axis], center, ep)) == undefined &&
			off_axes.find(axis => element.rotation[axis]) == undefined &&
			MirrorModeling.isParentTreeSymmetrical(element, {center})
		) {
			return element;
		} else {
			for (var element2 of Mesh.all) {
				let other_center = element2.getCenter(true);
				if (Object.keys(element.vertices).length !== Object.keys(element2.vertices).length) continue;
				if (
					element2 != element &&
					symmetry_axes.find(axis => !Math.epsilon(element.origin[axis]-center, center-element2.origin[axis], e)) == undefined &&
					symmetry_axes.find(axis => !Math.epsilon(this_center[axis]-center, center-other_center[axis], ep)) == undefined &&
					off_axes.find(axis => !Math.epsilon(element.origin[axis], element2.origin[axis], e)) == undefined &&
					off_axes.find(axis => !Math.epsilon(this_center[axis], other_center[axis], ep)) == undefined &&
					isOppositeEuler(element.rotation, element2.rotation) &&
					element2.getDepth() == element.getDepth()
				) {
					return element2;
				}
			}
		}
		return false;
	},
	maintainUV(element: Mesh, original_data) {
		for (let fkey in element.faces) {
			let face = element.faces[fkey];
			let face_before = original_data.faces[fkey];
			if (face_before) {
				face.texture = face_before.texture;
				for (let vkey of face_before.vertices) {
					if (face.vertices.includes(vkey) && face_before.uv[vkey]) {
						face.uv[vkey] = face_before.uv[vkey].slice();
					}
				}
			}
		}
	},
	discoverConnectionsPreEdit(mesh: Mesh) {
		let data = {
			faces: {},
			vertices: {},
			vertex_sides: {},
		}
		// Detect vertex counterparts
		for (let vkey in mesh.vertices) {
			let position = mesh.vertices[vkey];
			if (position[0]) {
				data.vertex_sides[vkey] = Math.sign(Math.round(position[0] * 200));
			}
			if (data.vertices[vkey]) continue;
			let vector = Reusable.vec1.fromArray(position);
			vector.x *= -1;
			for (let vkey2 in mesh.vertices) {
				//if (vkey == vkey2) continue;
				let distance = vector.distanceTo(Reusable.vec2.fromArray(mesh.vertices[vkey2]));
				if (distance < 0.001) {
					data.vertices[vkey] = vkey2;
					data.vertices[vkey2] = vkey;
					break;
				}
			}
		}
		// Detect face counterparts
		for (let fkey in mesh.faces) {
			if (data.faces[fkey]) continue;
			for (let fkey2 in mesh.faces) {
				if (fkey == fkey2) continue;
				let match = mesh.faces[fkey].vertices.allAre(vkey => {
					let other_vkey = data.vertices[vkey];
					if (!other_vkey) return false;
					return mesh.faces[fkey2].vertices.includes(other_vkey);
				})
				if (match) {
					data.faces[fkey] = fkey2;
					data.faces[fkey2] = fkey;
					break;
				}
			}
		}
		return data;
	},
	createLocalSymmetry(mesh: Mesh, cached_data) {
		// Create or update clone
		let edit_side = cached_data?.edit_side || MirrorModeling.getEditSide();
		let options = BarItems.mirror_modeling.tool_config.options;
		let mirror_uv = options.mirror_uv;
		let pre_part_connections = cached_data?.pre_part_connections;

		// Delete all vertices on the non-edit side
		let deleted_vertices = {};
		let deleted_vertices_by_position = {};
		function positionKey(position: ArrayVector3): string {
			return position.map(p => Math.round(p*25)/25).join(',');
		}
		for (let vkey in mesh.vertices) {
			let to_delete = pre_part_connections?.vertex_sides[vkey] != undefined
				? pre_part_connections.vertex_sides[vkey] == -edit_side
				: mesh.vertices[vkey][0] && Math.round(mesh.vertices[vkey][0] * edit_side * 50) < 0;
			if (to_delete) {
				deleted_vertices[vkey] = mesh.vertices[vkey];
				delete mesh.vertices[vkey];
				deleted_vertices_by_position[positionKey(deleted_vertices[vkey])] = vkey;
			}
		}
		// Copy existing vertices back to the non-edit side
		let added_vertices = [];
		let vertex_counterpart = {};
		let center_vertices = [];
		for (let vkey in mesh.vertices) {
			let vertex = mesh.vertices[vkey];
			if (Math.abs(mesh.vertices[vkey][0]) < 0.02) {
				// On Edge
				vertex_counterpart[vkey] = vkey;
				center_vertices.push(vkey);
			} else {
				let position = [MirrorModeling.flipCoord(vertex[0]), vertex[1], vertex[2]] as ArrayVector3;
				let vkey_new = deleted_vertices_by_position[positionKey(position)];
				if (!vkey_new) {
					vkey_new = pre_part_connections?.vertices[vkey];
					if (mesh.vertices[vkey_new]) vkey_new = undefined;
				}
				if (vkey_new) {
					mesh.vertices[vkey_new] = position;
				} else {
					vkey_new = mesh.addVertices(position)[0];
				}
				added_vertices.push(vkey_new);
				vertex_counterpart[vkey] = vkey_new;
				vertex_counterpart[vkey_new] = vkey;
			}
		}

		// Delete faces temporarily if all their vertices have been removed
		let deleted_faces = {};
		for (let fkey in mesh.faces) {
			let face = mesh.faces[fkey];
			let deleted_face_vertices = face.vertices.filter(vkey => deleted_vertices[vkey] || center_vertices.includes(vkey));
			if (deleted_face_vertices.length == face.vertices.length && !face.vertices.allAre(vkey => center_vertices.includes(vkey))) {
				deleted_faces[fkey] = mesh.faces[fkey];
				delete mesh.faces[fkey];
			}
		}

		// Create mirrored faces
		let original_fkeys = Object.keys(mesh.faces);
		for (let fkey of original_fkeys) {
			let face = mesh.faces[fkey];
			let deleted_face_vertices = face.vertices.filter(vkey => deleted_vertices[vkey]);
			if (deleted_face_vertices.length && face.vertices.length != deleted_face_vertices.length*2 && face.vertices.filter(vkey => center_vertices.includes(vkey)).length + deleted_face_vertices.length*2 != face.vertices.length) {
				// cannot flip. restore vertices instead?
				deleted_face_vertices.forEach(vkey => {
					mesh.vertices[vkey] = deleted_vertices[vkey];
					//delete deleted_vertices[vkey];
				})

			} else if (deleted_face_vertices.length) {
				// face across zero line
				//let kept_face_keys = face.vertices.filter(vkey => mesh.vertices[vkey] != 0 && !deleted_face_vertices.includes(vkey));
				let new_counterparts = face.vertices.filter(vkey => !deleted_vertices[vkey]).map(vkey => vertex_counterpart[vkey]);
				face.vertices.forEach((vkey, i) => {
					if (deleted_face_vertices.includes(vkey)) {
						// Across
						//let kept_key = kept_face_keys[i%kept_face_keys.length];
						new_counterparts.sort((a, b) => {
							let a_distance = Math.pow(mesh.vertices[a][1] - deleted_vertices[vkey][1], 2) + Math.pow(mesh.vertices[a][2] - deleted_vertices[vkey][2], 2);
							let b_distance = Math.pow(mesh.vertices[b][1] - deleted_vertices[vkey][1], 2) + Math.pow(mesh.vertices[b][2] - deleted_vertices[vkey][2], 2);
							return b_distance - a_distance;
						})

						let counterpart = new_counterparts.pop();
						if (vkey != counterpart && counterpart) {
							face.vertices.splice(i, 1, counterpart);
							face.uv[counterpart] = face.uv[vkey].slice() as ArrayVector2;
							delete face.uv[vkey];
						}
					}
				})

			} else if (deleted_face_vertices.length == 0 && face.vertices.find((vkey) => vkey != vertex_counterpart[vkey])) {
				// Recreate face as mirrored
				let new_face_key = pre_part_connections && pre_part_connections.faces[fkey];
				let original_face = deleted_faces[new_face_key];

				let new_face = new MeshFace(mesh, face);
				face.vertices.forEach((vkey, i) => {
					let new_vkey = vertex_counterpart[vkey];
					new_face.vertices.splice(i, 1, new_vkey);
					delete new_face.uv[vkey];
					if (mirror_uv || !original_face) {
						new_face.uv[new_vkey] = face.uv[vkey].slice() as ArrayVector2;
					} else {
						// change
						let original_vkey = pre_part_connections.vertices[vkey];
						if (original_face.uv[original_vkey]) {
							new_face.uv[new_vkey] = original_face.uv[original_vkey].slice();
						} else {
							new_face.uv[new_vkey] = face.uv[vkey].slice() as ArrayVector2;
						}
					}
				})
				new_face.invert();
				if (new_face_key) {
					mesh.faces[new_face_key] = new_face;
				} else {
					[new_face_key] = mesh.addFaces(new_face);
				}
			}
		}
		if ((BarItems.selection_mode as BarSelect).value != 'object') {
			let selected_vertices = mesh.getSelectedVertices(true);
			selected_vertices.replace(selected_vertices.filter(vkey => mesh.vertices[vkey]));
			let selected_edges = mesh.getSelectedEdges(true);
			selected_edges.replace(selected_edges.filter(edge => edge.allAre(vkey => mesh.vertices[vkey])));
			let selected_faces = mesh.getSelectedFaces(true);
			selected_faces.replace(selected_faces.filter(fkey => mesh.faces[fkey]));
		}

		let {preview_controller} = mesh;
		preview_controller.updateGeometry(mesh);
		preview_controller.updateFaces(mesh);
		preview_controller.updateUV(mesh);
	}
})
MirrorModeling.registerElementType(ArmatureBone, {
	isCentered(element: ArmatureBone, {center}) {
		if (Math.roundTo(element.position[0], 3) != center) return false;
		if (Math.roundTo(element.rotation[1], 3) || Math.roundTo(element.rotation[2], 3)) return false;
		if (!MirrorModeling.isParentTreeSymmetrical(element, {center})) return false;
		return true;
	},
	getMirroredElement(element: ArmatureBone, {center}) {
		let e = 0.01;
		if (
			symmetry_axes.allAre((axis) => Math.epsilon(element.position[axis], center, e)) &&
			off_axes.find(axis => element.rotation[axis]) == undefined &&
			MirrorModeling.isParentTreeSymmetrical(element, {center})
		) {
			return element;
		} else {
			for (let element2 of ArmatureBone.all) {
				if (element == element2) continue;
				if (
					isOppositeVector(element.position, element2.position, center) &&
					isOppositeEuler(element.rotation, element2.rotation) &&
					MirrorModeling.isParentTreeOpposite(element, element2) &&
					element2.getDepth() == element.getDepth()
				) {
					return element2;
				}
			}
		}
		return false;
	},
	createLocalSymmetry(element: ArmatureBone, cached_data) {
		let edit_side = MirrorModeling.getEditSide();
		let options = BarItems.mirror_modeling.tool_config.options;
	},
	updateCounterpart(original: ArmatureBone, counterpart: ArmatureBone, context: any) {
		// Update vertex weights on off-centered bones
		counterpart.extend({
			vertex_weights: context.element_before_snapshot?.vertex_weights
		})
	}
})
MirrorModeling.registerElementType(Billboard, {
	// @ts-expect-error
	isCentered(element: Billboard, {center}) {
		if (Math.roundTo(element.position[0], 3) != center) return false;
		if (!MirrorModeling.isParentTreeSymmetrical(element, {center})) return false;
		//if (Math.roundTo(element.rotation[1], 3) || Math.roundTo(element.rotation[2], 3)) return false;
		return true;
	},
	// @ts-expect-error
	getMirroredElement(element: Billboard, {center}) {
		let e = 0.01;
		let symmetry_axes = [0];
		let off_axes = [1, 2];
		if (
			symmetry_axes.allAre((axis) => Math.epsilon(element.position[axis], center, e))
			//off_axes.find(axis => element.rotation[axis]) == undefined
		) {
			return element;
		} else {
			for (let element2 of (Billboard.all as Billboard[])) {
				if (element == element2) continue;
				if (
					isOppositeVector(element.position, element2.position, center) &&
					element2.getDepth() == element.getDepth()
				) {
					return element2;
				}
			}
		}
		return false;
	},
	// @ts-expect-error
	maintainUV(element: Billboard, original_data) {
		element.extend({
			faces: original_data.faces,
		});
	}
})

function getOppositeMeshVertex(mesh: Mesh, target_mesh: Mesh, vkey: string): string | undefined {
	let position = mesh.vertices[vkey];
	for (let vkey2 in target_mesh.vertices) {
		let pos2 = target_mesh.vertices[vkey2];
		if (isOppositeVector(position, pos2)) {
			return vkey2;
		}
	}
}
export function symmetrizeArmature(armature: Armature, mesh: Mesh, affected_vkeys: Set<string>): Mesh | undefined {
	let bones = armature.getAllBones();
	let opposite_mesh: Mesh | undefined;
	let target_mesh = mesh;
	if (!MirrorModeling.element_types.mesh.isCentered(mesh, {center: 0})) {
		opposite_mesh = MirrorModeling.element_types.mesh.getMirroredElement(mesh, {center: 0}) as Mesh;
		if (!opposite_mesh) return;
		target_mesh = opposite_mesh;
	}

	// For each vkey, copy its value on each bone to the other side
	for (let vkey in mesh.vertices) {
		let position = mesh.vertices[vkey];
		if (affected_vkeys.has(vkey) == false) continue;
		if (mesh == target_mesh && Math.epsilon(position[0], 0)) continue;
		let opposite = getOppositeMeshVertex(mesh, target_mesh, vkey);
		if (!opposite) continue;
		for (let bone of bones) {
			//if (!bone.getVertexWeight(mesh, vkey)) continue;
			if (MirrorModeling.element_types.armature_bone.isCentered(bone, {center: 0})) {
				bone.setVertexWeight(target_mesh, opposite, bone.getVertexWeight(mesh, vkey));
			} else {
				let target_bone = MirrorModeling.element_types.armature_bone.getMirroredElement(bone, {center: 0}) as ArmatureBone;
				if (target_bone) {
					target_bone.setVertexWeight(target_mesh, opposite, bone.getVertexWeight(mesh, vkey));
				}
			}
		}
	}
	return opposite_mesh;
}

BARS.defineActions(() => {
	
	let toggle = new Toggle('mirror_modeling', {
		icon: 'align_horizontal_center',
		category: 'edit',
		condition: {modes: ['edit']},
		onChange() {
			Project.mirror_modeling_enabled = this.value;
			toggle.tool_config.options.enabled = this.value;
			MirrorModeling.cached_elements = {};
			updateSelection();
		},
		tool_config: new ToolConfig('mirror_modeling_options', {
			title: 'action.mirror_modeling',
			form: {
				enabled: {type: 'checkbox', label: 'menu.mirror_painting.enabled', value: false},
				mirror_uv: {type: 'checkbox', label: 'menu.mirror_modeling.mirror_uv', value: true}
			},
			onFormChange(formResult) {
				if (toggle.value != formResult.enabled) {
					toggle.trigger();
				}
			}
		})
	})
	let allow_toggle = new Toggle('allow_element_mirror_modeling', {
		icon: 'align_horizontal_center',
		category: 'edit',
		condition: {modes: ['edit'], selected: {element: true}, method: () => toggle.value},
		onChange(value) {
			Outliner.selected.forEach(element => {
				if ('allow_mirror_modeling' in (element.constructor as any).properties == false) return;
				// @ts-ignore
				element.allow_mirror_modeling = value;
			})
		}
	})
	Blockbench.on('update_selection', () => {
		if (!Condition(allow_toggle.condition)) return;
		let disabled = Outliner.selected.find(el => el.allow_mirror_modeling === false);
		if (allow_toggle.value != !disabled) {
			allow_toggle.value = !disabled;
			allow_toggle.updateEnabledState();
		}
	})
	new Action('apply_mirror_modeling', {
		icon: 'align_horizontal_right',
		category: 'edit',
		condition: {modes: ['edit']},
		click() {
			let value_before = toggle.value;
			toggle.value = true;
			Undo.initEdit({elements: Outliner.selected, groups: Group.all.filter(g => g.selected)});
			Undo.finishEdit('Applied mirror modeling');
			toggle.value = value_before;
		}
	})
})

const global = {
	MirrorModeling
};
declare global {
	const MirrorModeling: typeof global.MirrorModeling
	interface BarItemRegistry {
		mirror_modeling: Toggle
		apply_mirror_modeling: Action
	}
}
Object.assign(window, global);
