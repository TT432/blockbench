import './mesh/attach_armature'
import { ProportionalEdit } from './mesh/proportional_edit';
import './mesh/set_vertex_weights'
import './mesh/loop_cut'
import './mesh/knife_tool'
import './mesh/add_mesh'
import './mesh/seam_tool'
import './mesh/merge_split'
import './mesh/import_obj'
import { autoFixMeshEdit } from './mesh/auto_fix'
import { sameMeshEdge } from './mesh/util';
import { getSpatialInterval } from './transform';

export function uncorruptMesh() {
	for (let mesh of Mesh.selected) {
		console.log(`Fixing mesh "${mesh.name}"`);
		for (let vkey in mesh.vertices) {
			let value = mesh.vertices[vkey];
			if (value instanceof Array == false || value.length != 3 || value.findIndex(val => isNaN(val)) != -1) {
				delete mesh.vertices[vkey];
				console.log(`Delete vertex "${vkey}" with value`, value);
			}
		}
		for (let fkey in mesh.faces) {
			let face = mesh.faces[fkey];
			let missing_vertices = face.vertices.filter(vkey => mesh.vertices[vkey] == undefined);
			if (missing_vertices.length == face.vertices.length || missing_vertices.length == face.vertices.length-1) {
				console.log(`Deleting face "${fkey}" due to not having 1 or more valid vertices`);
				delete mesh.faces[fkey];
			} else if (missing_vertices.length) {
				for (let vkey of missing_vertices) {
					face.vertices.remove(vkey);
					delete face.uv[vkey];
					console.log(`Deleting invalid vertex "${vkey}" from face "${fkey}"`);
				}
			}
		}
		Mesh.preview_controller.updateAll(mesh);
	}
	updateSelection();
}

SharedActions.add('delete', {
	condition: () => Modes.edit && Prop.active_panel == 'preview' && Mesh.selected[0] && Project.mesh_selection[Mesh.selected[0].uuid],
	run() {
		let meshes = Mesh.selected.slice();
		let keep_vertices = BarItems.delete.keybind.additionalModifierTriggered(event, 'keep_vertices');
		Undo.initEdit({elements: meshes, outliner: true, selection: true})

		Mesh.selected.forEach(mesh => {
			let selected_vertices = mesh.getSelectedVertices();
			let selected_edges = mesh.getSelectedEdges();
			let selected_faces = mesh.getSelectedFaces();

			if ((BarItems.selection_mode.value == 'face' || BarItems.selection_mode.value == 'cluster') && selected_faces.length < Object.keys(mesh.faces).length) {
				let affected_vertices = [];
				let affected_edges = [];
				selected_faces.forEach(fkey => {
					let face = mesh.faces[fkey];
					affected_vertices.safePush(...face.vertices);
					if (keep_vertices) {
						affected_edges.push(...face.getEdges());
					}
					delete mesh.faces[fkey];
				})
				if (keep_vertices) {
					edges: for (let edge of affected_edges) {
						for (let fkey in mesh.faces) {
							let vertices = mesh.faces[fkey].vertices;
							if (vertices.includes(edge[0]) && vertices.includes(edge[1])) {
								continue edges;
							}
						}
						mesh.addFaces(new MeshFace(mesh, {vertices: edge}));
					}
				} else {
					affected_vertices.forEach(vertex_key => {
						let used = false;
						for (let key in mesh.faces) {
							let face = mesh.faces[key];
							if (face.vertices.includes(vertex_key)) used = true;
						}
						if (!used) {
							delete mesh.vertices[vertex_key];
						}
					})
				}
			} else if (BarItems.selection_mode.value == 'edge') {
				for (let key in mesh.faces) {
					let face = mesh.faces[key];
					let sorted_vertices = face.getSortedVertices();
					let has_edge = sorted_vertices.find((vkey_a, i) => {
						let vkey_b = sorted_vertices[i+1] || sorted_vertices[0];
						let edge = [vkey_a, vkey_b];
						return selected_edges.find(edge2 => sameMeshEdge(edge, edge2))
					})
					if (has_edge) {
						delete mesh.faces[key];
					}
				}
				selected_edges.forEachReverse(edge => {
					edge.forEach(vkey => {
						let used = false;
						for (let key in mesh.faces) {
							let face = mesh.faces[key];
							if (face.vertices.includes(vkey)) used = true;
						}
						if (!used && !keep_vertices) {
							delete mesh.vertices[vkey];
							selected_vertices.remove(vkey);
							selected_edges.remove(edge);
						}
					})
				})

			} else if (BarItems.selection_mode.value == 'vertex' && selected_vertices.length < Object.keys(mesh.vertices).length) {
				selected_vertices.forEach(vkey => {
					for (let key in mesh.faces) {
						let face = mesh.faces[key];
						if (!face.vertices.includes(vkey)) continue;
						if (face.vertices.length > 2) {
							let initial_normal;
							if (face.vertices.length == 4) {
								initial_normal = face.getNormal();
							}
							face.vertices.remove(vkey);
							delete face.uv[vkey];
							
							if (face.vertices.length == 3 && face.getAngleTo(initial_normal) > 90) {
								face.invert();
							}
							if (face.vertices.length == 2) {
								for (let fkey2 in mesh.faces) {
									if (fkey2 != key && !face.vertices.find(vkey => !mesh.faces[fkey2].vertices.includes(vkey))) {
										delete mesh.faces[key];
										break;
									}
								}
							}
						} else {
							delete mesh.faces[key];
						}
					}
					delete mesh.vertices[vkey];
				})
			} else {
				meshes.remove(mesh);
				mesh.remove(false);
			}
		})

		Undo.finishEdit('Delete mesh part')
		Canvas.updateView({elements: meshes, selection: true, element_aspects: {geometry: true, faces: true, uv: meshes.length > 0}})
	}
})
SharedActions.add('select_all', {
	condition: () => Modes.edit && Mesh.selected.length && Mesh.selected.length === Outliner.selected.length && BarItems.selection_mode.value !== 'object',
	priority: 1,
	run() {
		let selection_mode = BarItems.selection_mode.value;
		if (selection_mode == 'vertex') {
			let unselect = Mesh.selected[0].getSelectedVertices().length == Object.keys(Mesh.selected[0].vertices).length;
			Mesh.selected.forEach(mesh => {
				if (unselect) {
					mesh.getSelectedVertices(true).empty();
				} else {
					mesh.getSelectedVertices(true).replace(Object.keys(mesh.vertices));
				}
			})
		} else if (selection_mode == 'edge') {
			let unselect = Mesh.selected[0].getSelectedVertices().length == Object.keys(Mesh.selected[0].vertices).length;
			Mesh.selected.forEach(mesh => {
				if (unselect) {
					mesh.getSelectedVertices(true).empty();
					mesh.getSelectedEdges(true).empty();
				} else {
					mesh.getSelectedVertices(true).replace(Object.keys(mesh.vertices));
					let edges = mesh.getSelectedEdges(true);
					for (let fkey in mesh.faces) {
						let face = mesh.faces[fkey];
						let f_vertices = face.getSortedVertices();
						f_vertices.forEach((vkey_a, i) => {
							let edge = [vkey_a, (f_vertices[i+1] || f_vertices[0])];
							if (edges.find(edge2 => sameMeshEdge(edge2, edge))) return;
							edges.push(edge);
						})
					}
				}
			})
		} else {
			let unselect = Mesh.selected[0].getSelectedFaces().length == Object.keys(Mesh.selected[0].faces).length;
			Mesh.selected.forEach(mesh => {
				if (unselect) {
					delete Project.mesh_selection[mesh.uuid];
				} else {
					mesh.getSelectedVertices(true).replace(Object.keys(mesh.vertices));
					mesh.getSelectedFaces(true).replace(Object.keys(mesh.faces));
				}
			})
		}
		updateSelection();
	}
})
SharedActions.add('unselect_all', {
	condition: () => Modes.edit && Mesh.selected.length && Mesh.selected.length === Outliner.selected.length && BarItems.selection_mode.value !== 'object',
	priority: 1,
	run() {
		Mesh.selected.forEach(mesh => {
			delete Project.mesh_selection[mesh.uuid];
		})
		updateSelection();
	}
})
SharedActions.add('invert_selection', {
	condition: () => Modes.edit && Mesh.selected.length && Mesh.selected.length === Outliner.selected.length && BarItems.selection_mode.value !== 'object',
	priority: 1,
	run() {
		let selection_mode = BarItems.selection_mode.value;
		if (selection_mode == 'vertex') {
			Mesh.selected.forEach(mesh => {
				let selected = mesh.getSelectedVertices();
				let now_selected = Object.keys(mesh.vertices).filter(vkey => !selected.includes(vkey));
				mesh.getSelectedVertices(true).replace(now_selected);
			})
		} else if (selection_mode == 'edge') {
			Mesh.selected.forEach(mesh => {
				let old_edges = mesh.getSelectedEdges().slice();
				let vertices = mesh.getSelectedVertices(true).empty();
				let edges = mesh.getSelectedEdges(true).empty();
				
				for (let fkey in mesh.faces) {
					let face = mesh.faces[fkey];
					let f_vertices = face.getSortedVertices();
					f_vertices.forEach((vkey_a, i) => {
						let edge = [vkey_a, (f_vertices[i+1] || f_vertices[0])];
						if (!old_edges.find(edge2 => sameMeshEdge(edge2, edge))) {
							edges.push(edge);
							vertices.safePush(edge[0], edge[1]);
						}
					})
				}
			})
		} else {
			Mesh.selected.forEach(mesh => {
				let old_faces = mesh.getSelectedFaces().slice();
				let vertices = mesh.getSelectedVertices(true).empty();
				let faces = mesh.getSelectedFaces(true).empty();
				
				for (let fkey in mesh.faces) {
					if (!old_faces.includes(fkey)) {
						let face = mesh.faces[fkey];
						faces.push(fkey);
						vertices.safePush(...face.vertices);
					}
				}
			})
		}
		updateSelection();
	}
})

BARS.defineActions(function() {
	let previous_selection_mode = 'object';
	new BarSelect('selection_mode', {
		options: {
			object: {name: true, icon: 'far.fa-gem'},
			cluster: {name: true, icon: 'link'},
			face: {name: true, icon: 'far.fa-square'},
			edge: {name: true, icon: 'pen_size_3'},
			vertex: {name: true, icon: 'fiber_manual_record'},
		},
		icon_mode: true,
		condition: () => Modes.edit && Mesh.selected.length && Toolbox.selected.id != 'knife_tool',
		onChange({value}) {
			if (value == 'cluster') value = 'face';
			if (value === previous_selection_mode) return;
			if (value === 'object') {
				Mesh.selected.forEach(mesh => {
					delete Project.mesh_selection[mesh.uuid];
				})
			} else if (value === 'face') {
				Mesh.selected.forEach(mesh => {
					let selected_faces = mesh.getSelectedFaces(true);
					selected_faces.empty();
					for (let fkey in mesh.faces) {
						let face = mesh.faces[fkey];
						if (face.isSelected(fkey)) {
							selected_faces.safePush(fkey);
						}
					}
				})
			}
			if ((value == 'face' || value == 'cluster') && ['edge', 'vertex'].includes(previous_selection_mode)) {
				Mesh.selected.forEach(mesh => {
					let vertices = mesh.getSelectedVertices();
					let faces = mesh.getSelectedFaces(true);
					for (let fkey in mesh.faces) {
						let face = mesh.faces[fkey];
						if (face.vertices.allAre(vkey => vertices.includes(vkey))) {
							faces.safePush(fkey);
						}
					}
				})
			}
			if (value == 'edge') {
				Mesh.selected.forEach(mesh => {
					let edges = mesh.getSelectedEdges(true);
					edges.empty();
				})
			}
			if (value == 'edge' && ['face', 'cluster'].includes(previous_selection_mode)) {
				Mesh.selected.forEach(mesh => {
					let edges = mesh.getSelectedEdges(true);
					let faces = mesh.getSelectedFaces(true);
					faces.forEach(fkey => {
						let face = mesh.faces[fkey];
						let vertices = face.getSortedVertices();
						vertices.forEach((vkey_a, i) => {
							let edge = [vkey_a, (vertices[i+1] || vertices[0])];
							if (!edges.find(edge2 => sameMeshEdge(edge2, edge))) {
								edges.push(edge);
							}
						})
					})
					faces.empty();
				})
			}
			if (value == 'edge' && ['vertex', 'cluster'].includes(previous_selection_mode)) {
				Mesh.selected.forEach(mesh => {
					let edges = mesh.getSelectedEdges(true);
					let vertices = mesh.getSelectedVertices();
					if (!vertices.length) return;
					for (let fkey in mesh.faces) {
						let face = mesh.faces[fkey];
						let f_vertices = face.getSortedVertices();
						f_vertices.forEach((vkey_a, i) => {
							let edge = [vkey_a, (f_vertices[i+1] || f_vertices[0])];
							if (!vertices.includes(edge[0]) || !vertices.includes(edge[1])) return;
							if (edges.find(edge2 => sameMeshEdge(edge2, edge))) return;
							edges.push(edge);
						})
					}
				})
			}
			if (value == 'vertex' && ['face', 'cluster'].includes(previous_selection_mode)) {
				Mesh.selected.forEach(mesh => {
					let faces = mesh.getSelectedFaces(true);
					faces.empty();
				})
			}
			if (value == 'vertex' && ['edge', 'cluster'].includes(previous_selection_mode)) {
				Mesh.selected.forEach(mesh => {
					let edges = mesh.getSelectedEdges(true);
					edges.empty();
				})
			}
			updateSelection();
			previous_selection_mode = value;
		}
	})
	
	new Action('create_face', {
		icon: 'fas.fa-draw-polygon',
		category: 'edit',
		keybind: new Keybind({key: 'f', shift: true}),
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedVertices().length > 1)},
		click() {
			let vec1 = new THREE.Vector3(),
				vec2 = new THREE.Vector3(),
				vec3 = new THREE.Vector3(),
				vec4 = new THREE.Vector3();
			Undo.initEdit({elements: Mesh.selected});
			let faces_to_autouv = [];
			Mesh.selected.forEach(mesh => {
				let selected_vertices = mesh.getSelectedVertices();
				let selected_faces = mesh.getSelectedFaces(true);
				selected_faces.empty();
				if (selected_vertices.length >= 2 && selected_vertices.length <= 4) {
					let reference_face;
					let reference_face_strength = 0;
					for (let key in mesh.faces) {
						let face = mesh.faces[key];
						let match_strength = face.vertices.filter(vkey => selected_vertices.includes(vkey)).length;
						if (match_strength > reference_face_strength) {
							reference_face = face;
							reference_face_strength = match_strength;
						}
						if (match_strength == face.vertices.length) {
							delete mesh.faces[key];
						}
					}
					// Split face
					if (
						reference_face &&
						(selected_vertices.length == 2 || selected_vertices.length == 3) &&
						reference_face.vertices.length == 4 &&
						reference_face.vertices.filter(vkey => selected_vertices.includes(vkey)).length == selected_vertices.length
					) {

						let sorted_vertices = reference_face.getSortedVertices();
						let unselected_vertices = sorted_vertices.filter(vkey => !selected_vertices.includes(vkey));

						let side_index_diff = Math.abs(sorted_vertices.indexOf(selected_vertices[0]) - sorted_vertices.indexOf(selected_vertices[1]));
						if (side_index_diff != 1 || selected_vertices.length == 3) {

							let new_face = new MeshFace(mesh, reference_face);
							
							new_face.vertices.remove(unselected_vertices[0]);
							delete new_face.uv[unselected_vertices[0]];

							let reference_corner_vertex = unselected_vertices[1]
								|| sorted_vertices[sorted_vertices.indexOf(unselected_vertices[0]) + 2]
								|| sorted_vertices[sorted_vertices.indexOf(unselected_vertices[0]) - 2];
							reference_face.vertices.remove(reference_corner_vertex);
							delete reference_face.uv[reference_corner_vertex];

							let [face_key] = mesh.addFaces(new_face);
							selected_faces.push(face_key);


							if (reference_face.getAngleTo(new_face) > 90) {
								new_face.invert();
							}
						}

					} else {
						
						let new_face = new MeshFace(mesh, {
							vertices: selected_vertices,
							texture: reference_face?.texture,
						} );
						let [face_key] = mesh.addFaces(new_face);
						selected_faces.push(face_key);
						faces_to_autouv.push(face_key);

						// Correct direction
						if (selected_vertices.length > 2) {
							// find face with shared line to compare
							let fixed_via_face;
							for (let key in mesh.faces) {
								let face = mesh.faces[key];
								let common = face.vertices.filter(vertex_key => selected_vertices.includes(vertex_key))
								if (common.length == 2) {
									let old_vertices = face.getSortedVertices();
									let new_vertices = new_face.getSortedVertices();
									let index_diff = old_vertices.indexOf(common[0]) - old_vertices.indexOf(common[1]);
									let new_index_diff = new_vertices.indexOf(common[0]) - new_vertices.indexOf(common[1]);
									if (index_diff == 1 - face.vertices.length) index_diff = 1;
									if (new_index_diff == 1 - new_face.vertices.length) new_index_diff = 1;

									if (Math.abs(index_diff) == 1 && Math.abs(new_index_diff) == 1) {
										if (index_diff == new_index_diff) {
											new_face.invert();
										}
										fixed_via_face = true;
										break;
									}
								}
							}
							// If no face available, orient based on camera orientation
							if (!fixed_via_face) {
								let normal = new THREE.Vector3().fromArray(new_face.getNormal());
								normal.applyQuaternion(mesh.mesh.getWorldQuaternion(new THREE.Quaternion()))
								let cam_direction = Preview.selected.camera.getWorldDirection(new THREE.Vector3());
								let angle = normal.angleTo(cam_direction);
								if (angle < Math.PI/2) {
									new_face.invert();
								}
							}
						}
					}
				} else if (selected_vertices.length > 4) {
					let reference_face;
					for (let key in mesh.faces) {
						let face = mesh.faces[key];
						if (!reference_face && face.vertices.find(vkey => selected_vertices.includes(vkey))) {
							reference_face = face;
						}
					}
					let vertices = selected_vertices.slice();
					let v1 = vec1.fromArray(mesh.vertices[vertices[1]].slice().V3_subtract(mesh.vertices[vertices[0]]));
					let v2 = vec2.fromArray(mesh.vertices[vertices[2]].slice().V3_subtract(mesh.vertices[vertices[0]]));
					let normal = v2.cross(v1);
					let plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
						normal,
						new THREE.Vector3().fromArray(mesh.vertices[vertices[0]])
					)
					let center = [0, 0];
					let vertex_uvs = {};
					vertices.forEach((vkey) => {
						let coplanar_pos = plane.projectPoint(vec3.fromArray(mesh.vertices[vkey]), vec4);
						let q = Reusable.quat1.setFromUnitVectors(normal, THREE.NormalY)
						coplanar_pos.applyQuaternion(q);
						vertex_uvs[vkey] = [
							Math.roundTo(coplanar_pos.x, 4),
							Math.roundTo(coplanar_pos.z, 4),
						]
						center[0] += vertex_uvs[vkey][0];
						center[1] += vertex_uvs[vkey][1];
					})
					center[0] /= vertices.length;
					center[1] /= vertices.length;

					vertices.forEach(vkey => {
						vertex_uvs[vkey][0] -= center[0];
						vertex_uvs[vkey][1] -= center[1];
						vertex_uvs[vkey][2] = Math.atan2(vertex_uvs[vkey][0], vertex_uvs[vkey][1]);
					})
					vertices.sort((a, b) => vertex_uvs[a][2] - vertex_uvs[b][2]);

					let start_index = 0;
					while (start_index < vertices.length) {
						let face_vertices = vertices.slice(start_index, start_index+4);
						vertices.push(face_vertices[0]);
						let new_face = new MeshFace(mesh, {vertices: face_vertices, texture: reference_face.texture});
						let [face_key] = mesh.addFaces(new_face);
						selected_faces.push(face_key);

						if (face_vertices.length < 4) break;
						start_index += 3;
					}
				}
			})
			Undo.finishEdit('Create mesh face')
			Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}, selection: true})
		}
	})
	new Action('convert_to_mesh', {
		icon: 'fa-gem',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Cube.hasSelected() || SplineMesh.hasSelected())},
		click() {
			Undo.initEdit({elements: [...Cube.selected, ...SplineMesh.selected], outliner: true});

			let new_meshes = [];
			Cube.selected.forEach(cube => {
				
				let mesh = new Mesh({
					name: cube.name,
					color: cube.color,
					origin: cube.origin,
					rotation: cube.rotation,
					vertices: []
				})
				let rotation_euler = new THREE.Euler(0, 0, 0, Format.euler_order).fromArray(cube.rotation.map(Math.degToRad));
				rotation_euler.reorder('XYZ');
				mesh.rotation.V3_set(rotation_euler.toArray().map(r => Math.roundTo(Math.radToDeg(r), 4)));

				var adjustedFrom = cube.from.slice();
				var adjustedTo = cube.to.slice();
				adjustFromAndToForInflateAndStretch(adjustedFrom, adjustedTo, cube);
				for (let i = 0; i < adjustedFrom.length; i++) {
					adjustedFrom[i] -= cube.origin[i];
					adjustedTo[i] -= cube.origin[i]
				}
				let vertex_keys = [
					mesh.addVertices([adjustedTo[0],	adjustedTo[1], 		adjustedTo[2]   ])[0],
					mesh.addVertices([adjustedTo[0],	adjustedTo[1], 		adjustedFrom[2] ])[0],
					mesh.addVertices([adjustedTo[0],	adjustedFrom[1], 	adjustedTo[2]   ])[0],
					mesh.addVertices([adjustedTo[0],	adjustedFrom[1], 	adjustedFrom[2] ])[0],
					mesh.addVertices([adjustedFrom[0],	adjustedTo[1], 		adjustedTo[2]   ])[0],
					mesh.addVertices([adjustedFrom[0],	adjustedTo[1], 		adjustedFrom[2] ])[0],
					mesh.addVertices([adjustedFrom[0],	adjustedFrom[1], 	adjustedTo[2]   ])[0],
					mesh.addVertices([adjustedFrom[0],	adjustedFrom[1], 	adjustedFrom[2] ])[0],
				];

				let unused_vkeys = vertex_keys.slice();
				function addFace(direction, vertices) {
					let cube_face = cube.faces[direction];
					if (cube_face.texture === null) return;
					let uv_points = [
						[cube_face.uv[0], cube_face.uv[1]],
						[cube_face.uv[2], cube_face.uv[1]],
						[cube_face.uv[2], cube_face.uv[3]],
						[cube_face.uv[0], cube_face.uv[3]]
					];
					let rotation = cube_face.rotation || 0;
					while (rotation > 0) {
						rotation -= 90;
						uv_points.splice(0, 0, uv_points.pop());
					}
					let uv = {
						[vertices[0]]: uv_points[1],
						[vertices[1]]: uv_points[0],
						[vertices[2]]: uv_points[2],
						[vertices[3]]: uv_points[3],
					};
					mesh.addFaces(
						new MeshFace( mesh, {
							vertices,
							uv,
							texture: cube_face.texture,
						}
					));
					vertices.forEach(vkey => unused_vkeys.remove(vkey));
				}
				addFace('east', [vertex_keys[1], vertex_keys[0], vertex_keys[3], vertex_keys[2]]);
				addFace('west', [vertex_keys[4], vertex_keys[5], vertex_keys[6], vertex_keys[7]]);
				addFace('up', [vertex_keys[1], vertex_keys[5], vertex_keys[0], vertex_keys[4]]); // 4 0 5 1
				addFace('down', [vertex_keys[2], vertex_keys[6], vertex_keys[3], vertex_keys[7]]);
				addFace('south', [vertex_keys[0], vertex_keys[4], vertex_keys[2], vertex_keys[6]]);
				addFace('north', [vertex_keys[5], vertex_keys[1], vertex_keys[7], vertex_keys[3]]);

				unused_vkeys.forEach(vkey => {
					delete mesh.vertices[vkey];
				})

				mesh.sortInBefore(cube).init();
				new_meshes.push(mesh);
				selected.push(mesh);
				cube.remove();
			});

			// Turn splines into meshes, half handled by the spline itself.
			SplineMesh.selected.forEach(spline => {
				let mesh = new Mesh({
					name: spline.name,
					color: spline.color,
					origin: spline.origin,
					rotation: spline.rotation,
					vertices: []
				})

				mesh.shading = spline.shading;

				spline.getTubeMesh(true, mesh);
				
				mesh.sortInBefore(spline).init();
				new_meshes.push(mesh);
				selected.push(mesh);
				spline.remove();
			});

			updateSelection();
			Undo.finishEdit('Convert elements to meshes', {elements: new_meshes, outliner: true});
		}
	})
	new Action('convert_mesh_to_cubes', {
		icon: 'fa-cube',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => Mesh.selected.length},
		click() {
			let tolerance = 1e-4;
			let min_plate_thickness = 1;
			let source_meshes = Mesh.selected.slice();
			let new_cubes = [];
			let used_fallback = false;

			// Checks whether the given vertices (relative to the mesh origin) form an
			// axis aligned box with exactly 8 corners and all faces flat on its 6 sides
			function matchAxisAlignedBox(mesh, vertices) {
				let vkeys = Object.keys(vertices);
				if (vkeys.length !== 8) return null;
				let from = [Infinity, Infinity, Infinity];
				let to = [-Infinity, -Infinity, -Infinity];
				vkeys.forEach(vkey => {
					for (let axis = 0; axis < 3; axis++) {
						from[axis] = Math.min(from[axis], vertices[vkey][axis]);
						to[axis] = Math.max(to[axis], vertices[vkey][axis]);
					}
				})
				for (let axis = 0; axis < 3; axis++) {
					if (to[axis] - from[axis] < tolerance) return null;
				}
				// Every vertex must be one of the 8 box corners, all corners present
				let corners = new Set();
				for (let vkey of vkeys) {
					let corner = [];
					for (let axis = 0; axis < 3; axis++) {
						let value = vertices[vkey][axis];
						if (Math.abs(value - from[axis]) <= tolerance) corner.push(0);
						else if (Math.abs(value - to[axis]) <= tolerance) corner.push(1);
						else return null;
					}
					corners.add(corner.join(''));
				}
				if (corners.size !== 8) return null;
				// Every face must lie flat on one of the 6 sides
				let side_to_direction = {
					'0-0': 'west', '0-1': 'east',
					'1-0': 'down', '1-1': 'up',
					'2-0': 'north', '2-1': 'south'
				};
				let side_faces = {north: [], south: [], west: [], east: [], up: [], down: []};
				for (let fkey in mesh.faces) {
					let face = mesh.faces[fkey];
					if (face.vertices.length < 3) return null;
					let direction;
					for (let axis = 0; axis < 3 && !direction; axis++) {
						let value = vertices[face.vertices[0]][axis];
						let side = Math.abs(value - from[axis]) <= tolerance ? 0
							: (Math.abs(value - to[axis]) <= tolerance ? 1 : -1);
						if (side == -1) continue;
						if (face.vertices.every(vkey => vertices[vkey] && Math.abs(vertices[vkey][axis] - value) <= tolerance)) {
							direction = side_to_direction[axis + '-' + side];
						}
					}
					if (!direction) return null;
					side_faces[direction].push(face);
				}
				// Each side needs faces covering all of its 4 corners
				for (let direction in side_faces) {
					if (!side_faces[direction].length) return null;
					let used_corners = new Set();
					side_faces[direction].forEach(face => face.vertices.forEach(vkey => used_corners.add(vkey)));
					if (used_corners.size < 4) return null;
				}
				return {from, to, side_faces};
			}
			function getUVBounds(faces) {
				let min = [Infinity, Infinity];
				let max = [-Infinity, -Infinity];
				let found = false;
				faces.forEach(face => {
					face.vertices.forEach(vkey => {
						let uv = face.uv[vkey];
						if (!uv) return;
						found = true;
						min[0] = Math.min(min[0], uv[0]);
						min[1] = Math.min(min[1], uv[1]);
						max[0] = Math.max(max[0], uv[0]);
						max[1] = Math.max(max[1], uv[1]);
					})
				})
				return found ? [min[0], min[1], max[0], max[1]] : null;
			}
			function convertMesh(mesh) {
				let cubes = [];
				let rotation = [0, 0, 0];
				let match = matchAxisAlignedBox(mesh, mesh.vertices);
				if (match) {
					// Exact box: carry the element rotation over to the cube
					let rotation_euler = new THREE.Euler(0, 0, 0, 'XYZ').fromArray(mesh.rotation.map(Math.degToRad));
					if (Format.euler_order != 'XYZ') rotation_euler.reorder(Format.euler_order);
					rotation = rotation_euler.toArray().slice(0, 3).map(r => Math.roundTo(Math.radToDeg(r), 4));
				} else {
					// Retry with the element rotation baked into the geometry
					let rotation_euler = new THREE.Euler(0, 0, 0, 'XYZ').fromArray(mesh.rotation.map(Math.degToRad));
					let vec = new THREE.Vector3();
					let rotated_vertices = {};
					for (let vkey in mesh.vertices) {
						rotated_vertices[vkey] = vec.fromArray(mesh.vertices[vkey]).applyEuler(rotation_euler).toArray();
					}
					match = matchAxisAlignedBox(mesh, rotated_vertices);
				}
				if (match) {
					let cube = new Cube({
						name: mesh.name,
						color: mesh.color,
						box_uv: false,
						from: match.from.map((v, axis) => Math.roundTo(v + mesh.origin[axis], 4)),
						to: match.to.map((v, axis) => Math.roundTo(v + mesh.origin[axis], 4)),
						origin: mesh.origin.slice(),
						rotation,
					});
					for (let direction in match.side_faces) {
						let faces = match.side_faces[direction];
						let cube_face = cube.faces[direction];
						let textured_face = faces.find(face => face.texture) || faces[0];
						if (textured_face.texture !== undefined) cube_face.extend({texture: textured_face.texture});
						if (!cube.box_uv) {
							let uv = getUVBounds(faces);
							if (uv) cube_face.extend({uv});
						}
					}
					cubes.push(cube);
				} else {
					// Fallback for arbitrary meshes: one flat plate cube per polygon face
					let rotation_euler = new THREE.Euler(0, 0, 0, 'XYZ').fromArray(mesh.rotation.map(Math.degToRad));
					let vec = new THREE.Vector3();
					let rotated_vertices = {};
					for (let vkey in mesh.vertices) {
						rotated_vertices[vkey] = vec.fromArray(mesh.vertices[vkey]).applyEuler(rotation_euler).toArray();
					}
					let index = 0;
					for (let fkey in mesh.faces) {
						let face = mesh.faces[fkey];
						if (face.vertices.length < 3 || !face.vertices.every(vkey => rotated_vertices[vkey])) continue;
						let from = [Infinity, Infinity, Infinity];
						let to = [-Infinity, -Infinity, -Infinity];
						face.vertices.forEach(vkey => {
							let v = rotated_vertices[vkey];
							for (let axis = 0; axis < 3; axis++) {
								from[axis] = Math.min(from[axis], v[axis]);
								to[axis] = Math.max(to[axis], v[axis]);
							}
						})
						let sizes = to.map((v, axis) => v - from[axis]);
						if (sizes.filter(size => size < tolerance).length >= 2) continue;
						let thin_axis = sizes.indexOf(Math.min(...sizes));
						if (sizes[thin_axis] < min_plate_thickness) {
							let center = (from[thin_axis] + to[thin_axis]) / 2;
							from[thin_axis] = center - min_plate_thickness / 2;
							to[thin_axis] = center + min_plate_thickness / 2;
						}
						let cube = new Cube({
							name: index == 0 ? mesh.name : `${mesh.name}_${index + 1}`,
							color: mesh.color,
							box_uv: false,
							from: from.map((v, axis) => Math.roundTo(v + mesh.origin[axis], 4)),
							to: to.map((v, axis) => Math.roundTo(v + mesh.origin[axis], 4)),
							origin: mesh.origin.slice(),
						});
						let uv = !cube.box_uv && getUVBounds([face]);
						for (let direction in cube.faces) {
							if (uv) cube.faces[direction].extend({uv});
							if (face.texture !== undefined) cube.faces[direction].extend({texture: face.texture});
						}
						cubes.push(cube);
						index++;
					}
					used_fallback = true;
				}
				return cubes;
			}

			Undo.initEdit({elements: source_meshes, outliner: true});
			source_meshes.forEach(mesh => {
				let cubes = convertMesh(mesh);
				if (!cubes.length) return;
				cubes.forEach(cube => {
					cube.sortInBefore(mesh).init();
					new_cubes.push(cube);
					selected.push(cube);
				});
				mesh.remove();
			});
			if (!new_cubes.length) {
				Undo.cancelEdit();
				return;
			}
			if (used_fallback) {
				Blockbench.showQuickMessage('action.convert_mesh_to_cubes.fallback_message', 4000);
			}
			updateSelection();
			Undo.finishEdit('Convert meshes to cubes', {elements: new_cubes, outliner: true});
		}
	})
	new Action('apply_mesh_rotation', {
		icon: 'published_with_changes',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected.length)},
		click() {
			let vec = new THREE.Vector3();
			Undo.initEdit({elements: Mesh.selected});
			Mesh.selected.forEach(mesh => {
				let rotation = mesh.mesh.rotation;
				for (let vkey in mesh.vertices) {
					vec.fromArray(mesh.vertices[vkey]);
					vec.applyEuler(rotation);
					mesh.vertices[vkey].V3_set(vec.x, vec.y, vec.z);
				}
				mesh.rotation.V3_set(0, 0, 0);
			})
			Undo.finishEdit('Apply mesh rotation')
			Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, transform: true}, selection: true})
		}
	})
	new Action('invert_face', {
		icon: 'flip_to_back',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedFaces().length)},
		click() {
			Undo.initEdit({elements: Mesh.selected});
			Mesh.selected.forEach(mesh => {
				for (let fkey in mesh.faces) {
					let face = mesh.faces[fkey];
					if (face.isSelected(fkey)) {
						face.invert();
					}
				}
			})
			Undo.finishEdit('Invert mesh faces');
			Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}});
		}
	})
	new Action('switch_face_crease', {
		icon: 'signal_cellular_off',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedFaces().find(fkey => Mesh.selected[0].faces[fkey].vertices.length == 4))},
		click() {
			Undo.initEdit({elements: Mesh.selected});
			Mesh.selected.forEach(mesh => {
				for (let fkey in mesh.faces) {
					let face = mesh.faces[fkey];
					if (face.vertices.length == 4 && face.isSelected(fkey)) {
						let new_vertices = face.getSortedVertices().slice();
						new_vertices.push(new_vertices.shift());
						face.vertices.replace(new_vertices);
					}
				}
			})
			Undo.finishEdit('Switch mesh face crease');
			Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}});
		}
	})
	new Action('extrude_mesh_selection', {
		icon: 'upload',
		category: 'edit',
		keybind: new Keybind({key: 'e', shift: true}),
		condition: {
			modes: ['edit'],
			features: ['meshes'],
			selected: {mesh: true, spline: false, armature_bone: false},
			method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedVertices().length)
		},
		click() {
			function runEdit(amended, extend = getSpatialInterval(), direction_mode, even_extend) {
				Undo.initEdit({elements: Mesh.selected, selection: true}, amended);

				Mesh.selected.forEach(mesh => {
					let original_vertices = mesh.getSelectedVertices().slice();
					let selected_edges = mesh.getSelectedEdges(true);
					let selected_face_keys = mesh.getSelectedFaces();
					let new_vertices;
					let new_face_keys = [];
					if (original_vertices.length && (BarItems.selection_mode.value == 'vertex' || BarItems.selection_mode.value == 'edge')) {
						selected_face_keys.empty();
					}
					let selected_faces = selected_face_keys.map(fkey => mesh.faces[fkey]);
					let combined_direction;

					selected_faces.forEach(face => {
						original_vertices.safePush(...face.vertices);
					})
					selected_edges.forEach(edge => {
						original_vertices.safePush(...edge);
					})

					if (original_vertices.length >= 3 && !selected_faces.length) {
						let [a, b, c] = original_vertices.slice(0, 3).map(vkey => mesh.vertices[vkey].slice());
						let normal = new THREE.Vector3().fromArray(a.V3_subtract(c));
						normal.cross(new THREE.Vector3().fromArray(b.V3_subtract(c))).normalize();

						let face;
						for (let fkey in mesh.faces) {
							let face2 = mesh.faces[fkey];
							let face_selected_vertices = face2.vertices.filter(vkey => original_vertices.includes(vkey));
							if (face_selected_vertices.length >= 2 && face_selected_vertices.length < face2.vertices.length && face2.vertices.length > 2) {
								face = face2;
								break;
							}
						}
						if (face) {
							let selected_corner = mesh.vertices[face.vertices.find(vkey => original_vertices.includes(vkey))];
							let opposite_corner = mesh.vertices[face.vertices.find(vkey => !original_vertices.includes(vkey))];
							let face_geo_dir = opposite_corner.slice().V3_subtract(selected_corner);
							if (Reusable.vec1.fromArray(face_geo_dir).angleTo(normal) < 1) {
								normal.negate();
							}
						}

						combined_direction = normal.toArray();
					}
					if (direction_mode == 'average' && selected_faces.length) {
						combined_direction = [0, 0, 0];
						for (let face of selected_faces) {
							let normal = face.getNormal(true);
							combined_direction.V3_add(normal);
						}
						combined_direction.V3_divide(selected_faces.length);
					}

					new_vertices = mesh.addVertices(...original_vertices.map(key => {
						let vector = mesh.vertices[key].slice();
						let direction;
						let count = 0;
						switch (direction_mode) {
							case 'average': direction = combined_direction; break;
							case 'y+': direction = [0, 1, 0]; break;
							case 'y-': direction = [0, -1, 0]; break;
							case 'x+': direction = [1, 0, 0]; break;
							case 'x-': direction = [-1, 0, 0]; break;
							case 'z+': direction = [0, 0, 1]; break;
							case 'z-': direction = [0, 0, -1]; break;
						}
						if (!direction) {
							let directions = [];
							selected_faces.forEach(face => {
								if (face.vertices.includes(key)) {
									count++;
									let face_normal = face.getNormal(true);
									directions.push(face_normal);
									if (!direction) {
										direction = face_normal
									} else {
										direction.V3_add(face_normal);
									}
								}
							})
							if (count > 1) {
								let magnitude = Math.sqrt(direction[0]**2 + direction[1]**2 + direction[2]**2);
								direction.V3_divide(magnitude);
								if (even_extend) {
									let a = new THREE.Vector3().fromArray(directions[0]);
									let b = new THREE.Vector3().fromArray(directions[1]);
									let angle = a.angleTo(b);
									direction.V3_divide(Math.cos(angle));
								}
							}
						}
						if (!direction) {
							let match;
							let match_level = 0;
							let match_count = 0;
							for (let key in mesh.faces) {
								let face = mesh.faces[key]; 
								let matches = face.vertices.filter(vkey => original_vertices.includes(vkey));
								if (match_level < matches.length) {
									match_level = matches.length;
									match_count = 1;
									match = face;
								} else if (match_level === matches.length) {
									match_count++;
								}
								if (match_level == 3) break;
							}
							
							if (match_level < 3 && match_count > 2 && original_vertices.length > 2) {
								// If multiple faces connect to the line, there is no point in choosing one for the normal
								// Instead, construct the normal between the first 2 selected vertices
								direction = combined_direction;

							} else if (match) {
								let difference = new THREE.Vector3();
								let signs_done = [];
								match.vertices.forEach(vkey => {
									let sign = original_vertices.includes(vkey) ? 1 : -1;
									difference.x += mesh.vertices[vkey][0] * sign;
									difference.y += mesh.vertices[vkey][1] * sign;
									difference.z += mesh.vertices[vkey][2] * sign;
									signs_done.push(sign);
								})
								direction = difference.normalize().toArray();

							} else if (match) {
								// perpendicular edge, currently unused
								direction = match.getNormal(true);
							} else {
								direction = [0, 1, 0];
							}
						}

						vector.V3_add(direction.map(v => v * extend));
						return vector;
					}))
					Project.mesh_selection[mesh.uuid].vertices.replace(new_vertices);

					// Pre-compute ALL UVs before modifying any face (faces are still unmodified)
					const vec1 = new THREE.Vector3();
					// Reusable vectors for side quad UV pre-computation
					const _ova = new THREE.Vector3(), _ovb = new THREE.Vector3(), _ovc = new THREE.Vector3();
					const _ouva = new THREE.Vector2(), _ouvb = new THREE.Vector2(), _ouvc = new THREE.Vector2();
					const _fn = new THREE.Vector3(), _ed = new THREE.Vector3(), _ip = new THREE.Vector3();
					const _poa = new THREE.Vector3(), _pob = new THREE.Vector3();
					const _pna = new THREE.Vector3(), _pnb = new THREE.Vector3();
					const _ext = new THREE.Vector3(), _prb = new THREE.Vector3();
					const _tuv = new THREE.Vector2();
					const face_old_uvs = new Map()
					const face_orig_keys = new Map()
					const face_new_uvs = new Map()
					const face_side_data = new Map()  // face -> [{a, b, orig_a, orig_b, uv_a, uv_b}, ...]
					selected_faces.forEach(face => {
						if (face.vertices.length < 3) return;
						// Save original vertex keys
						let orig_keys = [...face.vertices]
						face_orig_keys.set(face, orig_keys)
						let old_uvs = {...face.uv}
						face_old_uvs.set(face, old_uvs)
						// Cap face UVs: project new vertex positions onto old face plane
						const cap_uvs = {}
						for (const vertex_key of face.vertices) {
							const new_vertex_key = new_vertices[original_vertices.indexOf(vertex_key)];
							cap_uvs[new_vertex_key] = face.localToUV(vec1.fromArray(mesh.vertices[new_vertex_key]));
						}
						face_new_uvs.set(face, cap_uvs)
						// Side quad UVs: pre-compute using old face data
						const side_quads = []
						let sorted = face.getSortedVertices();
						if (sorted.length < 2) { face_side_data.set(face, side_quads); return; }
						// Old-face triangle for UV projection
						let tri = [orig_keys[0], orig_keys[1], orig_keys[2]];
						_ova.fromArray(mesh.vertices[tri[0]]);
						_ovb.fromArray(mesh.vertices[tri[1]]);
						_ovc.fromArray(mesh.vertices[tri[2]]);
						_ouva.fromArray(old_uvs[tri[0]]);
						_ouvb.fromArray(old_uvs[tri[1]]);
						_ouvc.fromArray(old_uvs[tri[2]]);
						_fn.crossVectors(_ovb.clone().sub(_ova), _ovc.clone().sub(_ova)).normalize();
						function oldFaceUV(world_pos, target) {
							return THREE.Triangle.getUV(world_pos, _ova, _ovb, _ovc, _ouva, _ouvb, _ouvc, target);
						}
						sorted.forEach((orig_a, i) => {
							let orig_b = sorted[i+1] || sorted[0];
							if (sorted.length == 2 && i) return;
							if (selected_faces.find(f => f != face && f.vertices.includes(orig_a) && f.vertices.includes(orig_b))) return;
							// orig_a/orig_b are old keys (face unmodified); map to new keys
							let a = new_vertices[original_vertices.indexOf(orig_a)]
							let b = new_vertices[original_vertices.indexOf(orig_b)]
							_poa.fromArray(mesh.vertices[orig_a]);
							_pob.fromArray(mesh.vertices[orig_b]);
							_ed.copy(_pob).sub(_poa).normalize();
							_ip.crossVectors(_ed, _fn);
							// Vertex a: decompose ext_vec, rotate normal into face plane
							_pna.fromArray(mesh.vertices[a]);
							_ext.copy(_pna).sub(_poa);
							let n_a = _ext.dot(_fn);
							_prb.copy(_poa)
								.add(_ext).addScaledVector(_fn, -n_a)
								.addScaledVector(_ip, n_a);
							let uv_a = oldFaceUV(_prb, _tuv).toArray();
							// Vertex b
							_pnb.fromArray(mesh.vertices[b]);
							_ext.copy(_pnb).sub(_pob);
							let n_b = _ext.dot(_fn);
							_prb.copy(_pob)
								.add(_ext).addScaledVector(_fn, -n_b)
								.addScaledVector(_ip, n_b);
							let uv_b = oldFaceUV(_prb, _tuv).toArray();
							side_quads.push({a, b, orig_a, orig_b, uv_a, uv_b});
						})
						face_side_data.set(face, side_quads)
					})

					// Now modify faces using pre-computed cap UVs
					selected_faces.forEach(face => {
						if (face.vertices.length < 3) return;
						let cap_uvs = face_new_uvs.get(face)
						face.vertices.forEach((key, index) => {
							const new_vertex_key = new_vertices[original_vertices.indexOf(key)];
							face.vertices[index] = new_vertex_key;
							delete face.uv[key];
							face.uv[new_vertex_key] = cap_uvs[new_vertex_key];
						});
					})

					// Create side quads from pre-computed data
					let remaining_vertices = new_vertices.slice();
					selected_faces.forEach((face, face_index) => {
						if (face.vertices.length < 3) return;
						let old_uvs = face_old_uvs.get(face)
						let side_quads = face_side_data.get(face)
						side_quads.forEach(q => {
							let new_face = new MeshFace(mesh, mesh.faces[selected_face_keys[face_index]]).extend({
								vertices: [q.b, q.a, q.orig_a, q.orig_b],
								uv: {[q.a]: q.uv_a, [q.b]: q.uv_b, [q.orig_a]: old_uvs[q.orig_a], [q.orig_b]: old_uvs[q.orig_b]}
							});
							let [face_key] = mesh.addFaces(new_face);
							new_face_keys.push(face_key);
							remaining_vertices.remove(q.a);
							remaining_vertices.remove(q.b);
						})
						if (face.getSortedVertices().length == 2) delete mesh.faces[selected_face_keys[face_index]];
					})

					// Create Faces for extruded edges
					let new_faces = [];
					selected_edges.forEach(edge => {
						let face, sorted_vertices;
						for (let fkey in mesh.faces) {
							let face2 = mesh.faces[fkey];
							let vertices = face2.vertices;
							if (vertices.includes(edge[0]) && vertices.includes(edge[1])) {
								face = face2;
								sorted_vertices = vertices;
								break;
							}
						}
						if (sorted_vertices[0] == edge[0] && sorted_vertices[1] != edge[1]) {
							edge.reverse();
						}
						let [a, b] = edge.map(vkey => new_vertices[original_vertices.indexOf(vkey)]);
							let [c, d] = edge;
							let new_face = new MeshFace(mesh, face).extend({
								vertices: [a, b, c, d],
								uv: {
									[a]: face.localToUV(vec1.fromArray(mesh.vertices[a])),
									[b]: face.localToUV(vec1.fromArray(mesh.vertices[b])),
									[c]: face.uv[c],
									[d]: face.uv[d]
								}
							});
						if (new_face.getAngleTo(face) > 90) {
							new_face.invert();
						}
						let [face_key] = mesh.addFaces(new_face);
						new_face_keys.push(face_key);
						new_faces.push(new_face);
						remaining_vertices.remove(a);
						remaining_vertices.remove(b);
					})

					// Create line between points
					remaining_vertices.forEach(a => {
						let b = original_vertices[new_vertices.indexOf(a)]
						let b_in_face = false;
						mesh.forAllFaces(face => {
							if (face.vertices.includes(b)) b_in_face = true;
						})
						if (selected_faces.find(f => f.vertices.includes(a)) && !b_in_face) {
							// Remove line if in the middle of other faces
							delete mesh.vertices[b];
						} else {
							let new_face = new MeshFace(mesh, {
								vertices: [b, a]
							});
							mesh.addFaces(new_face);
						}
					})

					// Update edge selection
					selected_edges.forEach(edge => {
						edge.forEach((vkey, i) => {
							edge[i] = new_vertices[original_vertices.indexOf(vkey)];
						});
					})
				})
				Undo.finishEdit('Extrude mesh selection');
				Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}, selection: true});
			}
			runEdit();

			Undo.amendEdit({
				extend: {type: 'num_slider', value: getSpatialInterval(), label: 'edit.extrude_mesh_selection.extend', interval_type: 'position'},
				direction_mode: {type: 'select', label: 'edit.extrude_mesh_selection.direction', options: {
					outwards: 'edit.extrude_mesh_selection.direction.outwards',
					average: 'edit.extrude_mesh_selection.direction.average',
					'y+': 'Y+',
					'y-': 'Y-',
					'x+': 'X+',
					'x-': 'X-',
					'z+': 'Z+',
					'z-': 'Z-',
				}},
				even_extend: {type: 'checkbox', value: false, label: 'edit.extrude_mesh_selection.even_extend'},
			}, form => {
				runEdit(true, form.extend, form.direction_mode, form.even_extend);
			})
		}
	})
	new Action('solidify_mesh_selection', {
		icon: 'bottom_panel_open',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedFaces().length)},
		click() {
			function runEdit(amended, extend = getSpatialInterval()) {
				Undo.initEdit({elements: Mesh.selected, selection: true}, amended);

				Mesh.selected.forEach(mesh => {
					let original_vertices = [];
					let new_vertices;
					let new_face_keys = [];
					let selected_face_keys = mesh.getSelectedFaces(true);
					let selected_faces = selected_face_keys.map(fkey => mesh.faces[fkey]);
					let combined_direction;

					selected_faces.forEach(face => {
						original_vertices.safePush(...face.vertices);
					})

					// Calculate direction
					if (original_vertices.length >= 3 && !selected_faces.length) {
						let [a, b, c] = original_vertices.slice(0, 3).map(vkey => mesh.vertices[vkey].slice());
						let normal = new THREE.Vector3().fromArray(a.V3_subtract(c));
						normal.cross(new THREE.Vector3().fromArray(b.V3_subtract(c))).normalize();

						let face;
						for (let fkey in mesh.faces) {
							let face2 = mesh.faces[fkey];
							let face_selected_vertices = face2.vertices.filter(vkey => original_vertices.includes(vkey));
							if (face_selected_vertices.length >= 2 && face_selected_vertices.length < face2.vertices.length && face2.vertices.length > 2) {
								face = face2;
								break;
							}
						}
						if (face) {
							let selected_corner = mesh.vertices[face.vertices.find(vkey => original_vertices.includes(vkey))];
							let opposite_corner = mesh.vertices[face.vertices.find(vkey => !original_vertices.includes(vkey))];
							let face_geo_dir = opposite_corner.slice().V3_subtract(selected_corner);
							if (Reusable.vec1.fromArray(face_geo_dir).angleTo(normal) < 1) {
								normal.negate();
							}
						}

						combined_direction = normal.toArray();
					}

					new_vertices = mesh.addVertices(...original_vertices.map(key => {
						let vector = mesh.vertices[key].slice();
						let direction;
						let count = 0;
						selected_faces.forEach(face => {
							if (face.vertices.includes(key)) {
								count++;
								if (!direction) {
									direction = face.getNormal(true);
								} else {
									direction.V3_add(face.getNormal(true));
								}
							}
						})
						if (count > 1) {
							direction.V3_divide(count);
						}
						if (!direction) {
							let match;
							let match_level = 0;
							let match_count = 0;
							for (let key in mesh.faces) {
								let face = mesh.faces[key]; 
								let matches = face.vertices.filter(vkey => original_vertices.includes(vkey));
								if (match_level < matches.length) {
									match_level = matches.length;
									match_count = 1;
									match = face;
								} else if (match_level === matches.length) {
									match_count++;
								}
								if (match_level == 3) break;
							}
							
							if (match_level < 3 && match_count > 2 && original_vertices.length > 2) {
								// If multiple faces connect to the line, there is no point in choosing one for the normal
								// Instead, construct the normal between the first 2 selected vertices
								direction = combined_direction;

							} else if (match) {
								let difference = new THREE.Vector3();
								let signs_done = [];
								match.vertices.forEach(vkey => {
									let sign = original_vertices.includes(vkey) ? 1 : -1;
									difference.x += mesh.vertices[vkey][0] * sign;
									difference.y += mesh.vertices[vkey][1] * sign;
									difference.z += mesh.vertices[vkey][2] * sign;
									signs_done.push(sign);
								})
								direction = difference.normalize().toArray();

							} else if (match) {
								// perpendicular edge, currently unused
								direction = match.getNormal(true);
							} else {
								direction = [0, 1, 0];
							}
						}

						vector.V3_add(direction.map(v => v * extend));
						return vector;
					}))
					Project.mesh_selection[mesh.uuid].vertices.replace(new_vertices);

					// Duplicate faces
					selected_faces.forEach(face => {
						// Copy face and invert
						let face_copy = new MeshFace(mesh, face);
						let [new_face_key] = mesh.addFaces(face_copy);
						selected_face_keys.push(new_face_key);
						face_copy.invert();

						// Move original face to new spot
						face.vertices.forEach((key, index) => {
							face.vertices[index] = new_vertices[original_vertices.indexOf(key)];
							let uv = face.uv[key];
							delete face.uv[key];
							face.uv[face.vertices[index]] = uv;
						})
					})

					// Create extra quads on sides
					let remaining_vertices = new_vertices.slice();
					selected_faces.forEach((face, face_index) => {
						let vertices = face.getSortedVertices();
						vertices.forEach((a, i) => {
							let b = vertices[i+1] || vertices[0];
							if (vertices.length == 2 && i) return; // Only create one quad when extruding line
							if (selected_faces.find(f => f != face && f.vertices.includes(a) && f.vertices.includes(b))) return;

							let new_face = new MeshFace(mesh, mesh.faces[selected_face_keys[face_index]]).extend({
								vertices: [
									b,
									a,
									original_vertices[new_vertices.indexOf(a)],
									original_vertices[new_vertices.indexOf(b)],
								]
							});
							let [face_key] = mesh.addFaces(new_face);
							selected_face_keys.push(face_key);
							new_face_keys.push(face_key);
							remaining_vertices.remove(a);
							remaining_vertices.remove(b);
						})

						if (vertices.length == 2) delete mesh.faces[selected_face_keys[face_index]];
					})
				})
				Undo.finishEdit('Solidify mesh selection');
				Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}, selection: true});
			}
			runEdit();

			Undo.amendEdit({
				thickness: {type: 'num_slider', value: getSpatialInterval(), label: 'edit.solidify_mesh_selection.thickness', interval_type: 'position'},
			}, form => {
				runEdit(true, form.thickness);
			})
		}
	})
	new Action('inset_mesh_selection', {
		icon: 'fa-compress-arrows-alt',
		category: 'edit',
		keybind: new Keybind({key: 'i', shift: true}),
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedVertices().length >= 3)},
		click() {
			const vec1 = new THREE.Vector3();
			function runEdit(amended, offset = 50) {
				Undo.initEdit({elements: Mesh.selected, selection: true}, amended);
				Mesh.selected.forEach(mesh => {
					let original_vertices = mesh.getSelectedVertices();
					if (original_vertices.length < 3) return;
					original_vertices = original_vertices.slice();
					let new_vertices;
					let selected_face_keys = mesh.getSelectedFaces();
					let selected_faces = selected_face_keys.map(fkey => mesh.faces[fkey]).filter(face => face.vertices.length >= 3);
					let modified_face_keys = selected_face_keys.slice();
	
					new_vertices = mesh.addVertices(...original_vertices.map(vkey => {
						let vector = mesh.vertices[vkey].slice();
						let affected_faces = selected_faces.filter(face => {
							return face.vertices.includes(vkey)
						})
						if (affected_faces.length == 0) return;
						let inset = [0, 0, 0];
						if (affected_faces.length == 3 || affected_faces.length == 1) {
							affected_faces.sort((a, b) => {
								let ax = 0;
								a.vertices.forEach(vkey => {
									ax += affected_faces.filter(face => face.vertices.includes(vkey)).length;
								})
								let bx = 0;
								b.vertices.forEach(vkey => {
									bx += affected_faces.filter(face => face.vertices.includes(vkey)).length;
								})
								return bx - ax;
							})
							affected_faces[0].vertices.forEach(vkey2 => {
								inset.V3_add(mesh.vertices[vkey2]);
							})
							inset.V3_divide(affected_faces[0].vertices.length);
							vector = vector.map((v, i) => Math.lerp(v, inset[i], offset/100));
						}
						if (affected_faces.length == 2) {
							let vkey2 = affected_faces[0].vertices.find(_vkey => _vkey != vkey && affected_faces[1].vertices.includes(_vkey));
							
							vector = vector.map((v, i) => Math.lerp(v, mesh.vertices[vkey2][i], offset/200));
						}
						return vector;
					}).filter(vec => vec instanceof Array))
					if (!new_vertices.length) return;
	
					Project.mesh_selection[mesh.uuid].vertices.replace(new_vertices);
	
					// Move Faces
					selected_faces.forEach(face => {
						// Calculate new UVs for new vertex positions before modifying face.
						const new_uvs = {}
						for (const vertex_key of face.vertices) {
							const new_vertex_key = new_vertices[original_vertices.indexOf(vertex_key)];
							const new_vertex_position = mesh.vertices[new_vertex_key];
							new_uvs[new_vertex_key] = face.localToUV(vec1.fromArray(new_vertex_position));
						}
						// Save original UVs before modification (needed for side quads)
						const old_uvs = {...face.uv}
						// Modify face after calculating UVs
						face.vertices.forEach((vertex_key, index) => {
							const new_vertex_key = new_vertices[original_vertices.indexOf(vertex_key)];
							face.vertices[index] = new_vertex_key;
							delete face.uv[vertex_key];
							face.uv[new_vertex_key] = new_uvs[new_vertex_key];
						});
						// Attach saved data for side quad creation
						face._old_uvs = old_uvs
					})
	
					// Create extra quads on sides
					let remaining_vertices = new_vertices.slice();
					selected_faces.forEach((face, face_index) => {
						let vertices = face.getSortedVertices();
						vertices.forEach((a, i) => {
							let b = vertices[i+1] || vertices[0];
							if (vertices.length == 2 && i) return; // Only create one quad when extruding line
							if (selected_faces.find(f => f != face && f.vertices.includes(a) && f.vertices.includes(b))) return;

							let new_face_vertices = [
								b,
								a,
								original_vertices[new_vertices.indexOf(a)],
								original_vertices[new_vertices.indexOf(b)],
							];
							let new_face_uv = {
								[a]: face.uv[a],
								[b]: face.uv[b],
								[new_face_vertices[2]]: face._old_uvs[original_vertices[new_vertices.indexOf(a)]],
								[new_face_vertices[3]]: face._old_uvs[original_vertices[new_vertices.indexOf(b)]],
							};
							let new_face = new MeshFace(mesh, mesh.faces[selected_face_keys[face_index]]).extend({
								vertices: new_face_vertices,
								uv: new_face_uv
							});
							let [fkey] = mesh.addFaces(new_face);
							modified_face_keys.push(fkey);
							remaining_vertices.remove(a);
							remaining_vertices.remove(b);
						})
	
						if (vertices.length == 2) delete mesh.faces[selected_face_keys[face_index]];
					})
	
					remaining_vertices.forEach(a => {
						let b = original_vertices[new_vertices.indexOf(a)];
						for (let fkey in mesh.faces) {
							let face = mesh.faces[fkey];
							if (face.vertices.includes(b)) {
								face.vertices.splice(face.vertices.indexOf(b), 1, a);
								face.uv[a] = face.uv[b];
								delete face.uv[b];
							}
						}
						delete mesh.vertices[b];
					})
				})
				Undo.finishEdit('Extrude mesh selection')
				Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}, selection: true})
			}
			runEdit();

			Undo.amendEdit({
				offset: {type: 'num_slider', value: 50, label: 'edit.loop_cut.offset', min: 0, max: 100, interval_type: 'position'},
			}, form => {
				runEdit(true, form.offset);
			})
		}
	})
	new Action('dissolve_edges', {
		icon: 'border_vertical',
		category: 'edit',
		condition: {modes: ['edit'], features: ['meshes'], method: () => (Mesh.selected[0] && Mesh.selected[0].getSelectedVertices().length > 1)},
		click() {
			Undo.initEdit({elements: Mesh.selected});
			Mesh.selected.forEach(mesh => {
				let edges = mesh.getSelectedEdges(true);
				let selected_vertices = mesh.getSelectedVertices(true);
				for (let edge of edges) {
					let adjacent_faces = [];
					let adjacent_fkeys = [];
					for (let fkey in mesh.faces) {
						let face = mesh.faces[fkey];
						if (!face.vertices.includes(edge[0]) || !face.vertices.includes(edge[1])) continue;
						
						let vertices = face.getSortedVertices();
						let index_a = vertices.indexOf(edge[0]), index_b = vertices.indexOf(edge[1]);
						if (vertices.length < 4 || (Math.abs(index_a - index_b) != 2)) {
							adjacent_faces.push(face);
							adjacent_fkeys.push(fkey);
						}
					}
					// Connect adjacent faces
					let keep_faces = adjacent_fkeys.length >= 2;
					if (keep_faces) {
						let face_a = mesh.faces[adjacent_fkeys[0]],
							face_b = mesh.faces[adjacent_fkeys[1]];
						let vertices_from_a = face_a.vertices.filter(vkey => edge.indexOf(vkey) == -1);
						
						delete mesh.faces[adjacent_fkeys[0]];
						adjacent_fkeys.remove(adjacent_fkeys[0]);

						face_b.vertices.safePush(...vertices_from_a);
						vertices_from_a.forEach((vkey, i) => {
							face_b.uv[vkey] = face_a.uv[vkey] ? face_a.uv[vkey].slice() : [0, 0];
						})
						// Ensure face has no more than 4 vertices
						edge.forEach(edge_vkey => {
							if (face_b.vertices.length > 4) {
								face_b.vertices.remove(edge_vkey);
								delete face_b.uv[edge_vkey];
							}
						})
						// Make sure orientation stays the same
						if (face_b.getAngleTo(face_a) > 90) {
							face_b.invert();
						}
					}
					
					// Remove all other faces and lines
					adjacent_fkeys.forEach((fkey, i) => {
						let face = mesh.faces[fkey];
						if (face && (i > 1 || !keep_faces)) {
							delete mesh.faces[fkey];
						}
					})
				}
				// Remove leftover vertices
				let vertices_used = [];
				for (let edge of edges) {
					vertices_used.safePush(...edge);
				}
				for (let vkey of vertices_used) {
					let used = false;
					for (let fkey in mesh.faces) {
						if (mesh.faces[fkey].vertices.includes(vkey)) {
							used = true;
							break;
						}
					}
					if (!used) {
						delete mesh.vertices[vkey];
					}
				}
				selected_vertices.empty();
			})
			Undo.finishEdit('Dissolve edges')
			Canvas.updateView({elements: Mesh.selected, element_aspects: {geometry: true, uv: true, faces: true}, selection: true})
		}
	})
})

Object.assign(window, {
	ProportionalEdit,
	autoFixMeshEdit,
	cleanupOverlappingMeshFaces,
	uncorruptMesh,
})
