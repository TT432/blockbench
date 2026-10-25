import { Canvas } from "../preview/canvas";
import { autoFixMeshEdit } from "./mesh/auto_fix";
import { getGroupTransferOriginUndoNodes } from "./transform";

export const Vertexsnap = {
	step1: true,
	vertex_gizmos: new THREE.Object3D(),
	line: new THREE.Line(new THREE.BufferGeometry(), Canvas.outlineMaterial),
	elements_with_vertex_gizmos: [],
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
	 * 反馈#228：把当前元素与其它可见、未锁定元素的相交点追加为捕捉候选。
	 * 追加的坐标是 element.mesh 的局部坐标（与 mesh.geometry 顶点同一坐标系），
	 * 因此与已有角点共用同一个 vectors 数组、同一个 position 属性顺序。
	 *
	 * 复杂度：每个元素取包围盒 12 条世界边 × 其它元素数，每条边一次 Raycaster 检测；
	 * 先用世界 AABB 相交做快速排除。单元素最多追加 256 个交点，元素总数超过 512 时整体跳过：
	 * 这种规模的模型上逐边射线检测会让悬停/选中明显卡顿，而顶点捕捉本身也已不实用。
	 */
	addIntersectionVertices(element, vectors) {
		if (typeof settings === 'undefined' || !settings.community_vertex_snap_intersections?.value) return;
		if (typeof Toolbox !== 'undefined' && Toolbox.selected?.id !== 'vertex_snap_tool') return;
		if (typeof Outliner === 'undefined' || Outliner.elements.length > 512) return;

		let mesh = element.mesh;
		let geometry = mesh?.geometry;
		if (!geometry || !geometry.attributes.position) return;
		if (!geometry.boundingBox) geometry.computeBoundingBox();
		let box = geometry.boundingBox;
		if (!box || box.isEmpty()) return;

		// 8 个局部角点，索引按 x/y/z 三个二进制位排列，方便枚举 12 条棱
		let corners = [];
		for (let i = 0; i < 8; i++) {
			corners.push(new THREE.Vector3(
				(i & 1) ? box.max.x : box.min.x,
				(i & 2) ? box.max.y : box.min.y,
				(i & 4) ? box.max.z : box.min.z,
			));
		}
		mesh.updateMatrixWorld();
		let world_corners = corners.map(corner => corner.applyMatrix4(mesh.matrixWorld));
		let world_box = new THREE.Box3().setFromPoints(world_corners);
		let edges = [];
		for (let i = 0; i < 8; i++) {
			if (!(i & 1)) edges.push([i, i | 1]);
			if (!(i & 2)) edges.push([i, i | 2]);
			if (!(i & 4)) edges.push([i, i | 4]);
		}

		let raycaster = new THREE.Raycaster();
		// 合批 cube 在 layer 7，默认 layers 只命中 layer 0
		raycaster.layers.enableAll();
		let ray_direction = new THREE.Vector3();
		let hit_local = new THREE.Vector3();
		let other_box = new THREE.Box3();
		// 位置差小于 1e-4 视为同一个点
		let duplicate_epsilon_sq = 1e-8;
		let max_added = 256;
		let added = 0;

		for (let other of Outliner.elements) {
			if (added >= max_added) break;
			if (other === element || other.visibility === false || other.locked === true) continue;
			let other_mesh = other.mesh;
			let other_geometry = other_mesh?.geometry;
			if (!other_geometry?.attributes.position) continue;

			// 世界包围盒快速排除
			if (!other_geometry.boundingBox) other_geometry.computeBoundingBox();
			if (!other_geometry.boundingBox || other_geometry.boundingBox.isEmpty()) continue;
			other_mesh.updateMatrixWorld();
			other_box.copy(other_geometry.boundingBox).applyMatrix4(other_mesh.matrixWorld);
			if (!world_box.intersectsBox(other_box)) continue;

			for (let edge of edges) {
				if (added >= max_added) break;
				let start = world_corners[edge[0]];
				let end = world_corners[edge[1]];
				ray_direction.subVectors(end, start);
				let edge_length = ray_direction.length();
				if (edge_length < 1e-6) continue;
				ray_direction.divideScalar(edge_length);

				raycaster.set(start, ray_direction);
				raycaster.near = 0;
				raycaster.far = edge_length;

				for (let intersection of raycaster.intersectObject(other_mesh, false)) {
					if (added >= max_added) break;
					hit_local.copy(intersection.point);
					mesh.worldToLocal(hit_local);

					let duplicate = false;
					for (let vector of vectors) {
						let dx = vector[0] - hit_local.x;
						let dy = vector[1] - hit_local.y;
						let dz = vector[2] - hit_local.z;
						if (dx*dx + dy*dy + dz*dz < duplicate_epsilon_sq) {
							duplicate = true;
							break;
						}
					}
					if (duplicate) continue;

					vectors.push(hit_local.toArray());
					added++;
				}
			}
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
			Vertexsnap.snap(data)
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

				} else {
					if (Format.bone_rig && obj.parent instanceof Group) {
						var q = obj.mesh.parent.getWorldQuaternion(Reusable.quat1).invert();
						local_offset.applyQuaternion(q);
					}
					if (obj instanceof Cube && Format.rotate_cubes) {
						obj.origin.V3_add(local_offset);
					}
					ignoreVectorAxes(local_offset);
					if (obj.moveVector) {
						var in_box = obj.moveVector(local_offset.toArray());
						if (!in_box && Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
							Blockbench.showMessageBox({translateKey: 'canvas_limit_error'})
						}
					} else if (obj.position) {
						obj.position.V3_add(local_offset.toArray());
					}
				}
			})
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
				node.transferOrigin(vec.toArray());
			}
		} else {

			let global_target_pos = Vertexsnap.getGlobalVertexPos(data.element, data.vertex);
			let global_delta = new THREE.Vector3().copy(global_target_pos).sub(Vertexsnap.vertex_pos)

			if (mode === 'scale' && !Format.integer_size && Vertexsnap.elements[0] instanceof Cube) {
				//Scale

				var m;
				switch (Vertexsnap.vertex_index) {
					case 0: m=[ 1,1,1 ]; break;
					case 1: m=[ 1,1,0 ]; break;
					case 2: m=[ 1,0,1 ]; break;
					case 3: m=[ 1,0,0 ]; break;
					case 4: m=[ 0,1,0 ]; break;
					case 5: m=[ 0,1,1 ]; break;
					case 6: m=[ 0,0,0 ]; break;
					case 7: m=[ 0,0,1 ]; break;
				}

				if (m) {
					Vertexsnap.elements.forEach(function(obj) {
						if (obj instanceof Cube == false) return;
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
				} else {
					// 反馈#228：交点候选的 vertex_index 落在 0..7 角点轴表之外。
					// 没有轴向信息就无法决定从哪一侧缩放（旧代码会拿 undefined 下标表直接抛错），
					// 保守地整块平移（与 move 模式一致）：pivot 走 move_pivot 分支，不会到这里。
					moveElements(global_delta);
				}
			} else if (mode === 'move') {
				moveElements(global_delta);
			} else if (mode == 'rotate') {
				Vertexsnap.elements.forEach((obj) => {
					let local_start = obj.mesh.worldToLocal(new THREE.Vector3().copy(Vertexsnap.vertex_pos));
					let local_target = obj.mesh.worldToLocal(new THREE.Vector3().copy(global_target_pos));

					ignoreVectorAxes(local_start);
					ignoreVectorAxes(local_target);

					if (options.align != 'direction' || !amended) {
						let target_distance = local_target.length();
						let longest_axis = 'x';
						if ('xyz'.includes(options.align)) {
							longest_axis = options.align;
						} else {
							if (local_start.y > local_start.x) longest_axis = 'y';
							if (local_start.z > local_start.y) longest_axis = 'z';
						}

						let off_axes = ['x', 'y', 'z'].filter(l => l != longest_axis);
						local_start[longest_axis] = Math.sqrt(target_distance**2 - local_start[off_axes[0]]**2 - local_start[off_axes[1]]**2);
					}
					local_start.normalize();
					local_target.normalize();
					let rot_diff = new THREE.Quaternion().setFromUnitVectors(local_start, local_target);
					
					obj.mesh.quaternion.multiply(rot_diff);
					let modified_rotation = obj.mesh.rotation.toArray().slice(0, 3).map(Math.radToDeg);
					obj.extend({rotation: modified_rotation});
				})
			}
		}

		Vertexsnap.clearVertexGizmos()
		let update_options = {
			elements,
			element_aspects: {transform: true, geometry: true},
			selection: true
		};
		if (Vertexsnap.groups.length) {
			update_options.groups = Vertexsnap.groups;
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
			Undo.amendEdit({
				align: {type: 'select', condition: mode == 'rotate', label: 'edit.vertex_snap.align', options: {
					longest: 'edit.vertex_snap.align.longest',
					direction: 'edit.vertex_snap.align.direction',
					x: tl('edit.vertex_snap.align.align_axis', 'X'),
					y: tl('edit.vertex_snap.align.align_axis', 'Y'),
					z: tl('edit.vertex_snap.align.align_axis', 'Z'),
				}},
				ignore_axis: {type: 'inline_multi_select', label: tl('edit.vertex_snap.ignore_axis', ''),  options: {x: 'X', y: 'Y', z: 'Z'}, value: {x: false, y: false, z: false}},
			}, form => {
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

Object.assign(window, {
	Vertexsnap,
});
