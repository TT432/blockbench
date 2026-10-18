import { Property } from "../../util/property";
import { Face } from "../abstract/face";

export class CubeFace extends Face {
	constructor(direction, data, cube) {
		super();
		this.texture = false;
		this.direction = direction || 'north';
		this.cube = cube;
		this.element = cube;
		this.uv = [0, 0, canvasGridSize(), canvasGridSize()]
		this.rotation = 0;

		if (data) {
			this.extend(data)
		}
	}
	get uv_size() {
		return [
			this.uv[2] - this.uv[0],
			this.uv[3] - this.uv[1]
		]
	}
	set uv_size(arr) {
		this.uv[2] = arr[0] + this.uv[0];
		this.uv[3] = arr[1] + this.uv[1];
	}
	get element() {
		return this.cube;
	}
	extend(data) {
		super.extend(data);
		if (data.uv) {
			Merge.number(this.uv, data.uv, 0)
			Merge.number(this.uv, data.uv, 1)
			Merge.number(this.uv, data.uv, 2)
			Merge.number(this.uv, data.uv, 3)
		}
		return this;
	}
	reset() {
		super.reset();
		this.rotation = 0;
		return this;
	}
	getBoundingRect() {
		return getRectangle(...this.uv);
	}
	getVertexIndices() {
		switch (this.direction) {
			case 'north': 	return [1, 4, 6, 3];
			case 'east': 	return [0, 1, 3, 2];
			case 'south': 	return [5, 0, 2, 7];
			case 'west': 	return [4, 5, 7, 6];
			case 'up': 		return [4, 1, 0, 5];
			case 'down': 	return [7, 2, 3, 6];
		}
	}
	texelToLocalMatrix(uv, truncate_factor = [1, 1], truncated_uv) {
		uv = truncated_uv == null || truncated_uv[0] == null || truncated_uv[1] == null ? [...uv] : [...truncated_uv];

		let texel_pos = this.UVToLocal(uv);
		let texel_x_axis = this.UVToLocal([uv[0] + truncate_factor[0], uv[1]]);
		let texel_y_axis = this.UVToLocal([uv[0], uv[1] + truncate_factor[1]]);

		texel_x_axis.sub(texel_pos);
		texel_y_axis.sub(texel_pos);

		let matrix = new THREE.Matrix4();
		matrix.makeBasis(texel_x_axis, texel_y_axis, new THREE.Vector3(0, 0, 1));
		matrix.setPosition(texel_pos);
		return matrix;
	}
	UVToLocal(point) {
		let from = this.cube.from.slice()
		let to = this.cube.to.slice()
		adjustFromAndToForInflateAndStretch(from, to, this.cube);

		let vector = new THREE.Vector3().fromArray(from);

		let lerp_x = Math.getLerp(this.uv[0], this.uv[2], point[0]);
		let lerp_y = Math.getLerp(this.uv[1], this.uv[3], point[1]);

		for (let i = 0; i < this.rotation; i += 90) {
			[lerp_x, lerp_y] = [1-lerp_y, lerp_x];
		}

		if (this.direction == 'east') {
			vector.x = to[0];
			vector.y = Math.lerp(to[1], from[1], lerp_y);
			vector.z = Math.lerp(to[2], from[2], lerp_x);
		}
		if (this.direction == 'west') {
			vector.y = Math.lerp(to[1], from[1], lerp_y);
			vector.z = Math.lerp(from[2], to[2], lerp_x);
		}
		if (this.direction == 'up') {
			vector.y = to[1];
			vector.z = Math.lerp(from[2], to[2], lerp_y);
			vector.x = Math.lerp(from[0], to[0], lerp_x);
		}
		if (this.direction == 'down') {
			vector.z = Math.lerp(to[2], from[2], lerp_y);
			vector.x = Math.lerp(from[0], to[0], lerp_x);
		}
		if (this.direction == 'south') {
			vector.z = to[2];
			vector.y = Math.lerp(to[1], from[1], lerp_y);
			vector.x = Math.lerp(from[0], to[0], lerp_x);
		}
		if (this.direction == 'north') {
			vector.y = Math.lerp(to[1], from[1], lerp_y);
			vector.x = Math.lerp(to[0], from[0], lerp_x);
		}
		vector.x -= this.cube.origin[0];
		vector.y -= this.cube.origin[1];
		vector.z -= this.cube.origin[2];
		return vector;
	}
}
CubeFace.prototype.is_rectangular = true;
new Property(CubeFace, 'number', 'rotation', {default: 0});
new Property(CubeFace, 'number', 'tint', {default: -1});
new Property(CubeFace, 'enum', 'cullface', {values: ['', 'north', 'south', 'west', 'east', 'up', 'down']});
new Property(CubeFace, 'string', 'material_name');
new Property(CubeFace, 'boolean', 'enabled', {default: true});
// 编号65：锁定后该面在新建/追加贴图（重排 UV）时不改变自身 UV 大小范围
new Property(CubeFace, 'boolean', 'uv_lock', {default: false});

CubeFace.opposite = {
	north: 'south',
	south: 'north',
	east: 'west',
	west: 'east',
	down: 'up',
	up: 'down'
}

export class Cube extends OutlinerElement {
	constructor(data, uuid) {
		super(data, uuid)
		let size = Settings.get('default_cube_size');
		this.shade = true;
		this.mirror_uv = false;
		this.color = Math.floor(Math.random()*markerColors.length);
		this.uv_offset = [0,0]
		this.inflate = 0;
		this.stretch = [1, 1, 1];
		this.visibility = true;
		this.autouv = 0;

		for (var key in Cube.properties) {
			Cube.properties[key].reset(this);
		}
		Object.assign(this._static.properties, {
			faces: {
				north: 	new CubeFace('north', null, this),
				east: 	new CubeFace('east', null, this),
				south: 	new CubeFace('south', null, this),
				west: 	new CubeFace('west', null, this),
				up: 	new CubeFace('up', null, this),
				down: 	new CubeFace('down', null, this)
			},
			from: [0, 0, 0],
			to: [size, size, size],
			rotation: [0, 0, 0],
			origin: [0, 0, 0],
		})
		
		for (var key in Cube.properties) {
			Cube.properties[key].reset(this);
		}

		this.box_uv = Project.box_uv;
		if (data && typeof data === 'object') {
			this.extend(data)
		}
	}
	get faces() {return this._static.properties.faces};
	get from() {return this._static.properties.from};
	get to() {return this._static.properties.to};
	get rotation() {return this._static.properties.rotation};
	get origin() {return this._static.properties.origin};
	set faces(v) {this._static.properties.faces = v};
	set from(v) {this._static.properties.from = v};
	set to(v) {this._static.properties.to = v};
	set rotation(v) {this._static.properties.rotation = v};
	set origin(v) {this._static.properties.origin = v};
	extend(object) {
		for (var key in Cube.properties) {
			Cube.properties[key].merge(this, object)
		}

		this.sanitizeName();
		Merge.boolean(this, object, 'shade')
		Merge.boolean(this, object, 'mirror_uv')
		Merge.number(this, object, 'inflate')
		Merge.number(this, object, 'autouv')
		Merge.number(this, object, 'color')
		Merge.boolean(this, object, 'export')
		Merge.boolean(this, object, 'visibility')
		if (object.from) {
			Merge.number(this.from, object.from, 0)
			Merge.number(this.from, object.from, 1)
			Merge.number(this.from, object.from, 2)
		}
		if (object.to) {
			Merge.number(this.to, object.to, 0)
			Merge.number(this.to, object.to, 1)
			Merge.number(this.to, object.to, 2)
		}
		if (object.size) {
			if (typeof object.size[0] == 'number' && !isNaN(object.size[0])) this.to[0] = this.from[0] + object.size[0]
			if (typeof object.size[1] == 'number' && !isNaN(object.size[1])) this.to[1] = this.from[1] + object.size[1]
			if (typeof object.size[2] == 'number' && !isNaN(object.size[2])) this.to[2] = this.from[2] + object.size[2]
		}
		if (object.uv_offset) {
			Merge.number(this.uv_offset, object.uv_offset, 0)
			Merge.number(this.uv_offset, object.uv_offset, 1)
		}
		if (object.stretch) {
			Merge.number(this.stretch, object.stretch, 0)
			Merge.number(this.stretch, object.stretch, 1)
			Merge.number(this.stretch, object.stretch, 2)
		}
		if (object.rotation instanceof Array) {
			Merge.number(this.rotation, object.rotation, 0)
			Merge.number(this.rotation, object.rotation, 1)
			Merge.number(this.rotation, object.rotation, 2)
		}
		if (object.rotated) {
			Merge.number(this.rotation, object.rotated, 0)
			Merge.number(this.rotation, object.rotated, 1)
			Merge.number(this.rotation, object.rotated, 2)
		}
		if (object.origin) {
			Merge.number(this.origin, object.origin, 0)
			Merge.number(this.origin, object.origin, 1)
			Merge.number(this.origin, object.origin, 2)
		}
		Merge.string(this, object, 'rotation_axis', (v) => (v === 'x' || v === 'y' || v === 'z'))
		if (object.faces) {
			for (var face in this.faces) {
				if (this.faces.hasOwnProperty(face) && object.faces.hasOwnProperty(face)) {
					this.faces[face].extend(object.faces[face])
				}
			}
		}
		return this;
	}
	init() {
		super.init();
		if (Format.single_texture && Texture.getDefault()) {
			for (var face in this.faces) {
				if (this.faces[face].texture !== null) {
					this.faces[face].texture = Texture.getDefault().uuid
				}
			}
		}
		return this;
	}
	markAsSelected(...args) {
		let was_selected = this.selected;
		super.markAsSelected(...args);
		if (!was_selected && Cube.selected[0]) {
			let other_selected_faces = UVEditor.selected_faces.slice();
			let own_selected_faces = UVEditor.getSelectedFaces(this, true);
			if (other_selected_faces?.length && !own_selected_faces?.length) {
				own_selected_faces.replace(other_selected_faces.filter(fkey => this.faces[fkey]));
			}
		}
		return this;
	}
	size(axis, floored) {
		var scope = this;
		let epsilon = 0.0000001;
		function getA(axis) {
			if (floored == true) {
				return Math.floor(scope.to[axis] - scope.from[axis] + epsilon);

			} else if (floored == 'box_uv' && Format.box_uv_float_size != true) {
				// 箱型 UV 尺寸向下取整（floor，与上游一致；逐面 UV 仍为 round）。
				// +epsilon 使浮点噪声的整数值（5.9999999）按显示的 6 处理
				return Math.floor(scope.to[axis] - scope.from[axis] + epsilon);

			} else {
				return scope.to[axis] - scope.from[axis]
			}
		}
		if (axis !== undefined) {
			return getA(axis);
		} else {
			return [
				getA(0),
				getA(1),
				getA(2)
			]
		}
	}
	getSize(axis, selection_only) {
		return this.size(axis);
	}
	rotationAxis() {
		for (var axis = 0; axis < 3; axis++) {
			if (this.rotation[axis] !== 0) {
				this.rotation_axis = getAxisLetter(axis);
				return this.rotation_axis;
			}
		}
		return this.rotation_axis;
	}
	getMesh() {
		return this.mesh;
	}
	get mesh() {
		return Project.nodes_3d[this.uuid];
	}
	getUndoCopy(aspects = 0) {
		let copy = {};

		for (var key in Cube.properties) {
			Cube.properties[key].copy(this, copy);
		}

		copy.from = this.from.slice();
		copy.to = this.to.slice();
		copy.stretch = this.stretch.slice();
		copy.inflate = this.inflate;
		copy.rotation = this.rotation.slice();
		copy.origin = this.origin.slice();
		copy.uv_offset = this.uv_offset.slice();
		copy.autouv = this.autouv;
		copy.color = this.color;
		copy.visibility = this.visibility;
		copy.export = this.export;
		copy.shade = this.shade;
		copy.mirror_uv = this.mirror_uv;

		copy.faces = {};
		for (let face_id in this.faces) {
			copy.faces[face_id] = this.faces[face_id].getUndoCopy();
		}

		copy.uuid = this.uuid
		copy.type = this.type;
		return copy;
	}
	getSaveCopy() {
		var el = {}
		
		for (var key in Cube.properties) {
			Cube.properties[key].copy(this, el)
		}

		el.from = this.from;
		el.to = this.to;
		el.autouv = this.autouv;
		el.color = this.color;

		if (!this.visibility) el.visibility = false;
		if (!this.export) el.export = false;
		if (!this.shade) el.shade = false;
		if (this.mirror_uv) el.mirror_uv = true;
		if (this.inflate) el.inflate = this.inflate;
		if (this.isStretched()) el.stretch = this.stretch;
		if (!this.rotation.allEqual(0)) el.rotation = this.rotation;
		el.origin = this.origin;
		if (!this.uv_offset.allEqual(0)) el.uv_offset = this.uv_offset;
		el.faces = {}
		for (var face in this.faces) {
			el.faces[face] = this.faces[face].getSaveCopy()
		}
		el.type = this.type;
		el.uuid = this.uuid;
		return el;
	}
	roll(axis, steps, origin) {
		if (!origin) {origin = this.origin}
		function rotateCoord(array) {
			if (origin === undefined) {
				origin = [8, 8, 8]
			}
			var a, b;
			array.forEach(function(s, i) {
				if (i == axis) {
					//
				} else {
					if (a == undefined) {
						a = s - origin[i]
						b = i
					} else {
						array[b] = s - origin[i]
						array[b] = origin[b] - array[b]
						array[i] = origin[i] + a;
					}
				}
			})
			return array
		}

		// Check limits
		if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
			let from = this.from.slice(), to = this.to.slice();
			for (let check_steps = steps; check_steps > 0; check_steps--) {
				switch(axis) {
					case 0: [from[2], to[2]] = [to[2], from[2]]; break;
					case 1: [from[2], to[2]] = [to[2], from[2]]; break;
					case 2: [from[1], to[1]] = [to[1], from[1]]; break;
				}
				from.V3_set(rotateCoord(from));
				to.V3_set(rotateCoord(to));
			}
			if (Format.cube_size_limiter.test(this, {from, to})) {
				return false;
			}
		}

		//Rotations
		var i = 0;
		var temp_rot = undefined;
		var temp_i = undefined;
		while (i < 3) {
			if (i !== axis) {
				if (temp_rot === undefined) {
					temp_rot = this.rotation[i]
					temp_i = i
				} else {
					this.rotation[temp_i] = -this.rotation[i]
					this.rotation[i] = temp_rot
				}
			}
			i++;
		}

		function rotateUVFace(number, iterations) {
			if (!Format.uv_rotation) return 0;
			if (!number) number = 0;
			number += iterations * 90;
			return number % 360;
		}
		while (steps > 0) {
			steps--;
			//Swap coordinate thingy
			switch(axis) {
				case 0: [this.from[2], this.to[2]] = [this.to[2], this.from[2]]; break;
				case 1: [this.from[2], this.to[2]] = [this.to[2], this.from[2]]; break;
				case 2: [this.from[1], this.to[1]] = [this.to[1], this.from[1]]; break;
			}
			this.from.V3_set(rotateCoord(this.from))
			this.to.V3_set(rotateCoord(this.to))
			if (origin != this.origin) {
				this.origin.V3_set(rotateCoord(this.origin))
			}
			if (Format.stretch_cubes) {
				let off_axes = [0,1,2].filter(i => i != axis);
				[this.stretch[off_axes[0]], this.stretch[off_axes[1]]] = [this.stretch[off_axes[1]], this.stretch[off_axes[0]]];
			}
			if (!this.box_uv) {
				if (axis === 0) {
					this.faces.west.rotation = rotateUVFace(this.faces.west.rotation, 1)
					this.faces.east.rotation = rotateUVFace(this.faces.east.rotation, 3)
					this.faces.north.rotation= rotateUVFace(this.faces.north.rotation, 2)
					this.faces.down.rotation = rotateUVFace(this.faces.down.rotation, 2)

					var temp = new CubeFace(true, this.faces.north)
					this.faces.north.extend(this.faces.down)
					this.faces.down.extend(this.faces.south)
					this.faces.south.extend(this.faces.up)
					this.faces.up.extend(temp)

				} else if (axis === 1) {

					this.faces.up.rotation= rotateUVFace(this.faces.up.rotation, 1)
					this.faces.down.rotation = rotateUVFace(this.faces.down.rotation, 3)

					var temp = new CubeFace(true, this.faces.north)
					this.faces.north.extend(this.faces.west)
					this.faces.west.extend(this.faces.south)
					this.faces.south.extend(this.faces.east)
					this.faces.east.extend(temp)

				} else if (axis === 2) {

					this.faces.north.rotation = rotateUVFace(this.faces.north.rotation, 1)
					this.faces.south.rotation= rotateUVFace(this.faces.south.rotation, 3)

					this.faces.up.rotation= rotateUVFace(this.faces.up.rotation, 3)
					this.faces.east.rotation= rotateUVFace(this.faces.east.rotation, 3)
					this.faces.west.rotation = rotateUVFace(this.faces.west.rotation, 3)
					this.faces.down.rotation = rotateUVFace(this.faces.down.rotation, 3)

					var temp = new CubeFace(true, this.faces.east)
					this.faces.east.extend(this.faces.down)
					this.faces.down.extend(this.faces.west)
					this.faces.west.extend(this.faces.up)
					this.faces.up.extend(temp)
				}
			}
		}
		this.preview_controller.updateTransform(this);
		this.preview_controller.updateGeometry(this);
		this.preview_controller.updateFaces(this);
		this.preview_controller.updateUV(this);
		return this;
	}
	flip(axis, center, skipUV) {
		var scope = this;

		this.rotation[(axis+1)%3] *= -1
		this.rotation[(axis+2)%3] *= -1

		var from = this.from[axis]
		this.from[axis] = center - (this.to[axis] - center)
		this.to[axis] = center - (from - center)
		this.origin[axis] = center - (this.origin[axis] - center)
		
		flipNameOnAxis(this, axis);

		if (!skipUV) {

			if (this.box_uv && axis === 0) {
				this.mirror_uv = !this.mirror_uv;
			}
			function mirrorUVX(face, skip_rot) {
				var f = scope.faces[face]
				if (skip_rot) {}
				if (!skip_rot && (f.rotation == 90 || f.rotation == 270)) {
					return mirrorUVY(face, true)
				}
				return [f.uv[2], f.uv[1], f.uv[0], f.uv[3]]
			}
			function mirrorUVY(face, skip_rot) {
				var f = scope.faces[face]
				if (skip_rot) {}
				if (!skip_rot && (f.rotation == 90 || f.rotation == 270)) {
					return mirrorUVX(face, true)
				}
				return [f.uv[0], f.uv[3], f.uv[2], f.uv[1]]
			}
			//Faces
			var switchFaces;
			switch(axis) {
				case 0: switchFaces = ['west', 'east']; break;
				case 1: switchFaces = ['up', 'down']; break;
				case 2: switchFaces = ['south', 'north']; break;
			}
			var x = new CubeFace(switchFaces[1], this.faces[switchFaces[0]])
			this.faces[switchFaces[0]].extend(this.faces[switchFaces[1]])
			this.faces[switchFaces[1]].extend(x)

			//UV
			if (axis === 1) {
				this.faces.north.uv = 	mirrorUVY('north')
				this.faces.south.uv = 	mirrorUVY('south')
				this.faces.east.uv = 	mirrorUVY('east')
				this.faces.west.uv = 	mirrorUVY('west')
			} else {
				this.faces.north.uv = 	mirrorUVX('north')
				this.faces.south.uv = 	mirrorUVX('south')
				this.faces.east.uv = 	mirrorUVX('east')
				this.faces.west.uv = 	mirrorUVX('west')
			}
			if (axis === 0) {
				this.faces.up.uv = 		mirrorUVX('up')
				this.faces.down.uv = 	mirrorUVX('down')
			} else {
				this.faces.up.uv = 		mirrorUVY('up')
				this.faces.down.uv = 	mirrorUVY('down')
			}
		}
		this.preview_controller.updateTransform(this);
		this.preview_controller.updateGeometry(this);
		this.preview_controller.updateFaces(this);
		this.preview_controller.updateUV(this);
	}
	transferOrigin(origin, update = true) {
		if (!this.mesh) return;
		var q = Reusable.quat1.copy(this.mesh.quaternion)
		var shift = Reusable.vec1.set(
			this.origin[0] - origin[0],
			this.origin[1] - origin[1],
			this.origin[2] - origin[2],
		)
		var dq = Reusable.vec2.copy(shift)
		dq.applyQuaternion(q)
		shift.sub(dq)
		shift.applyQuaternion(q.invert())
		
		this.moveVector(shift, null, update)

		this.origin.V3_set(origin);

		this.preview_controller.updateTransform(this);
		this.preview_controller.updateGeometry(this);
		return this;
	}
	getWorldCenter() {
		var m = this.mesh;
		var pos = new THREE.Vector3(
			this.from[0] + this.size(0)/2,
			this.from[1] + this.size(1)/2,
			this.from[2] + this.size(2)/2
		)
		pos.x = (pos.x - this.origin[0]) * m.scale.x;
		pos.y = (pos.y - this.origin[1]) * m.scale.y;
		pos.z = (pos.z - this.origin[2]) * m.scale.z;

		if (m) {
			var r = m.getWorldQuaternion(Reusable.quat1)
			pos.applyQuaternion(r)
			pos.add(THREE.fastWorldPosition(m, Reusable.vec2))
		}
		return pos;
	}
	getGlobalVertexPositions() {
		var adjustedFrom = this.from.slice();
		var adjustedTo = this.to.slice();
		adjustFromAndToForInflateAndStretch(adjustedFrom, adjustedTo, this);
		
		let vertices = [
			[adjustedTo[0]	,  adjustedTo[1]  ,  adjustedTo[2]	],
			[adjustedTo[0]  ,  adjustedTo[1]  ,  adjustedFrom[2]],
			[adjustedTo[0]  ,  adjustedFrom[1],  adjustedTo[2]	],
			[adjustedTo[0]  ,  adjustedFrom[1],  adjustedFrom[2]],
			[adjustedFrom[0],  adjustedTo[1]  ,  adjustedFrom[2]],
			[adjustedFrom[0],  adjustedTo[1]  ,  adjustedTo[2]	],
			[adjustedFrom[0],  adjustedFrom[1],  adjustedFrom[2]],
			[adjustedFrom[0],  adjustedFrom[1],  adjustedTo[2]	],
		];
		let vec = new THREE.Vector3();
		return vertices.map(coords => {
			vec.set(...coords.V3_subtract(this.origin));
			vec.applyMatrix4( this.mesh.matrixWorld );
			vec.sub(scene.position)
			return vec.toArray();
		})
	}
	setUVMode(box_uv) {
		if (this.box_uv == !!box_uv) return this;
		this.box_uv = !!box_uv;
		if (this.box_uv) {
			if (this.faces.west.uv[2] < this.faces.east.uv[0]) {
				this.mirror_uv = true;
				this.uv_offset[0] = Math.round(this.faces.west.uv[2]);
			} else {
				this.mirror_uv = false;
				this.uv_offset[0] = Math.round(this.faces.east.uv[0]);
			}
			this.uv_offset[1] = Math.round(this.faces.up.uv[3]);
			let texture = Texture.getDefault();
			for (let fkey in this.faces) {
				if (this.faces[fkey].texture) {
					texture = this.faces[fkey].getTexture();
				}
			}
			for (let fkey in this.faces) {
				if (this.faces[fkey].texture === null) {
					this.faces[fkey].extend({texture: texture || false});
				}
			}
			for (let fkey in this.faces) {
				this.faces[fkey].rotation = 0;
			}
			this.preview_controller.updateFaces(this);
		}
		this.preview_controller.updateUV(this);
		return this;
	}
	setColor(index) {
		this.color = index;
		if (this.visibility) {
			this.preview_controller.updateFaces(this);
		}
		return this;
	}
	applyTexture(texture, faces) {
		if (faces === true || this.box_uv) {
			var sides = ['north', 'east', 'south', 'west', 'up', 'down']
		} else if (faces === undefined) {
			var sides = [UVEditor.face]
		} else {
			var sides = faces
		}
		let value = null;
		if (texture) {
			value = texture.uuid
		} else if (texture === false || texture === null) {
			value = texture;
		}
		sides.forEach((side) => {
			if (this.faces[side].texture !== null) {
				this.faces[side].texture = value;
			}
		})
		if (Outliner.selected.indexOf(this) === 0) {
			UVEditor.loadData()
		}
		this.preview_controller.updateFaces(this);
		this.preview_controller.updateUV(this);
	}
	mapAutoUV(options = {}) {
		if (this.box_uv) return;
		var scope = this;
		if (scope.autouv === 2) {
			//Relative UV
			var all_faces = ['north', 'south', 'west', 'east', 'up', 'down']
			let offset = Format.centered_grid ? 8 : 0;
			all_faces.forEach(function(side) {
				var uv = scope.faces[side].uv.slice()
				let texture = scope.faces[side].getTexture();
				let uv_width = Project.getUVWidth(texture);
				let uv_height = Project.getUVHeight(texture);

				switch (side) {
					case 'north':
					uv = [
						uv_width - (scope.to[0]+offset),
						uv_height - scope.to[1],
						uv_width - (scope.from[0]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'south':
					uv = [
						(scope.from[0]+offset),
						uv_height - scope.to[1],
						(scope.to[0]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'west':
					uv = [
						(scope.from[2]+offset),
						uv_height - scope.to[1],
						(scope.to[2]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'east':
					uv = [
						uv_width - (scope.to[2]+offset),
						uv_height - scope.to[1],
						uv_width - (scope.from[2]+offset),
						uv_height - scope.from[1],
					];
					break;
					case 'up':
					uv = [
						(scope.from[0]+offset),
						(scope.from[2]+offset),
						(scope.to[0]+offset),
						(scope.to[2]+offset),
					];
					break;
					case 'down':
					uv = [
						(scope.from[0]+offset),
						uv_height - (scope.to[2]+offset),
						(scope.to[0]+offset),
						uv_height - (scope.from[2]+offset),
					];
					break;
				}
				// Clamp to UV map boundaries
				if (Math.max(uv[0], uv[2]) > uv_width) {
					let offset = Math.max(uv[0], uv[2]) - uv_width;
					uv[0] -= offset;
					uv[2] -= offset;
				}
				if (Math.min(uv[0], uv[2]) < 0) {
					let offset = Math.min(uv[0], uv[2]);
					uv[0] = Math.clamp(uv[0] - offset, 0, uv_width);
					uv[2] = Math.clamp(uv[2] - offset, 0, uv_width);
				}
				if (Math.max(uv[1], uv[3]) > uv_height) {
					let offset = Math.max(uv[1], uv[3]) - uv_height;
					uv[1] -= offset;
					uv[3] -= offset;
				}
				if (Math.min(uv[1], uv[3]) < 0) {
					let offset = Math.min(uv[1], uv[3]);
					uv[1] = Math.clamp(uv[1] - offset, 0, uv_height);
					uv[3] = Math.clamp(uv[3] - offset, 0, uv_height);
				}
				scope.faces[side].uv = uv;
			})
			scope.preview_controller.updateUV(scope)
		} else if (scope.autouv === 1) {

			function calcAutoUV(fkey, dimension_axes, world_directions) {
				let size = dimension_axes.map(axis => scope.size(axis));
				let face = scope.faces[fkey];
				size[0] = Math.roundTo(Math.abs(size[0]), 2);
				size[1] = Math.roundTo(Math.abs(size[1]), 2);
				let sx = face.uv[0];
				let sy = face.uv[1];
				let previous_size = face.uv_size;
				let rot = face.rotation;

				let texture = face.getTexture();
				let uv_width = Project.getUVWidth(texture);
				let uv_height = Project.getUVHeight(texture);
				let clamp = UVEditor.isUVClamped(texture);

				//Match To Rotation
				if (rot === 90 || rot === 270) {
					size.reverse()
					dimension_axes.reverse()
					world_directions.reverse()
				}
				if (rot == 180 || rot === 270) {
					world_directions[0] *= -1;
					world_directions[1] *= -1;
				}
				if (rot === 270) {
					//world_directions[0] *= -1;
					world_directions[1] *= -1;
				}
				if (clamp) {
					size[0] = Math.clamp(size[0], -uv_width, uv_width);
					size[1] = Math.clamp(size[1], -uv_height, uv_height);
				}
				size[0] *= Math.sign(previous_size[0]) || 1;
				size[1] *= Math.sign(previous_size[1]) || 1;

				if (options && typeof options.axis == 'number') {
					if (options.axis == dimension_axes[0] && options.direction == world_directions[0]) {
						sx += previous_size[0] - size[0];
					}
					if (options.axis == dimension_axes[1] && options.direction == world_directions[1]) {
						sy += previous_size[1] - size[1];
					}
					if (options.axis == dimension_axes[0] && options.direction == 0) {
						sx += (previous_size[0] - size[0]) / 2;
					}
					if (options.axis == dimension_axes[1] && options.direction == 0) {
						sy += (previous_size[1] - size[1]) / 2;
					}
				}


				//Prevent Negative
				if (clamp && sx < 0) sx = 0
				if (clamp && sy < 0) sy = 0
				//Calculate End Points
				let endx = sx + size[0];
				let endy = sy + size[1];
				//Prevent overflow
				if (clamp && endx > uv_width) {
					sx = uv_width - (endx - sx)
					endx = uv_width
				}
				if (clamp && endy > uv_height) {
					sy = uv_height - (endy - sy)
					endy = uv_height
				}
				//Return
				return [sx, sy, endx, endy]
			}
			scope.faces.north.uv = calcAutoUV('north', [0, 1], [1, 1]);
			scope.faces.east.uv =  calcAutoUV('east',  [2, 1], [1, 1]);
			scope.faces.south.uv = calcAutoUV('south', [0, 1], [-1, 1]);
			scope.faces.west.uv =  calcAutoUV('west',  [2, 1], [-1, 1]);
			scope.faces.up.uv =	   calcAutoUV('up',	   [0, 2], [-1, -1]);
			scope.faces.down.uv =  calcAutoUV('down',  [0, 2], [-1, 1]);

			scope.preview_controller.updateUV(scope)
		}
	}
	moveVector(arr, axis, update = true) {
		if (typeof arr == 'number') {
			var n = arr;
			arr = [0, 0, 0];
			arr[axis||0] = n;
		} else if (arr instanceof THREE.Vector3) {
			arr = arr.toArray();
		}
		var scope = this;
		var in_box = true;
		arr.forEach((val, i) => {

			var size = scope.size(i);
			val += scope.from[i];

			var val_before = val;
			if (Math.abs(val_before - val) >= 1e-4) in_box = false;
			val -= scope.from[i]

			scope.from[i] += val;
			scope.to[i] += val;
		})
		if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
			Format.cube_size_limiter.move(this);
		}
		if (update) {
			this.mapAutoUV()
			this.preview_controller.updateTransform(this);
			this.preview_controller.updateGeometry(this);
		}
		TickUpdates.selection = true;
		return in_box;
	}
	resize(val, axis, negative, allow_negative, bidirectional) {
		let before = this.temp_data.old_size != undefined ? this.temp_data.old_size : this.size(axis);
		if (before instanceof Array) before = before[axis];
		let is_inverted = before < 0;
		if (is_inverted && allow_negative == null) negative = !negative;
		let modify = val instanceof Function ? val : n => (n + val);

		if (bidirectional) {

			let center = this.temp_data.oldCenter[axis] || 0;
			let difference = modify(before) - before;
			if (negative) difference *= -1;

			let from = center - (before/2) - difference;
			let to = center + (before/2) + difference;

			if (Format.integer_size) {
				from = Math.round(from-this.from[axis])+this.from[axis];
				to = Math.round(to-this.to[axis])+this.to[axis];
			}
			this.from[axis] = from;
			this.to[axis] = to;
			if (from > to && !(settings.negative_size.value || allow_negative)) {
				this.from[axis] = this.to[axis] = (from + to) / 2;
			}

		} else if (!negative) {
			let pos = this.from[axis] + modify(before);
			if (Format.integer_size) {
				pos = Math.round(pos-this.from[axis])+this.from[axis];
			}
			if (pos >= this.from[axis] || settings.negative_size.value || allow_negative) {
				this.to[axis] = pos;
			} else {
				this.to[axis] = this.from[axis];
			}
		} else {
			let pos = this.to[axis] + modify(-before);
			if (Format.integer_size) {
				pos = Math.round(pos-this.to[axis])+this.to[axis];
			}
			if (pos <= this.to[axis] || settings.negative_size.value || allow_negative) {
				this.from[axis] = pos;
			} else {
				this.from[axis] = this.to[axis];
			}
		}
		if (Format.cube_size_limiter && !settings.deactivate_size_limit.value) {
			Format.cube_size_limiter.clamp(this, {}, axis, bidirectional ? null : !!negative);
		}
		this.mapAutoUV({axis, direction: bidirectional ? 0 : (negative ? -1 : 1)});
		if (this.box_uv) {
			if (axis == 2) {
				let difference = before - this.size(axis);
				if (!Format.box_uv_float_size) difference = Math.ceil(difference);
				this.uv_offset[0] = (this.temp_data.oldUVOffset ? this.temp_data.oldUVOffset[0] : this.uv_offset[0]) + difference;
				this.uv_offset[1] = (this.temp_data.oldUVOffset ? this.temp_data.oldUVOffset[1] : this.uv_offset[1]) + difference;
			} else if (axis == 0 && (!negative || bidirectional)) {
				let difference = before - this.size(axis);
				if (!Format.box_uv_float_size) difference = Math.ceil(difference);
				this.uv_offset[0] = (this.temp_data.oldUVOffset ? this.temp_data.oldUVOffset[0] : this.uv_offset[0]) + difference;
			}
			this.preview_controller.updateUV(this);
		}
		this.preview_controller.updateGeometry(this);
		TickUpdates.selection = true;
		return this;
	}
	isStretched() {
		return !this.stretch.allEqual(1);
	}

	static behavior = {
		select_faces: 'enum',
		cube_faces: true,
		support_box_uv: true,
		rotatable: true,
		movable: true,
		resizable: true,
		has_pivot: true,
		use_absolute_position: true,
		stretchable: true,
		cube_rotation_limit: true,
		cube_size_limit: true,
		marker_color: true,
		unique_name: false,
	}
}
	Cube.prototype.title = tl('data.cube');
	Cube.prototype.type = 'cube';
	Cube.prototype.icon = 'fa-cube';
	Cube.prototype.menu = new Menu([
		...Outliner.control_menu_group,
		new MenuSeparator('settings'),
		'convert_to_mesh',
		'update_autouv',
		'cube_uv_mode',
		'allow_element_mirror_modeling',
		'set_element_marker_color',
		"randomize_marker_colors",
		{name: 'menu.cube.texture', icon: 'collections', condition: () => !Format.single_texture && !Format.per_group_texture, children: function() {
			var arr = [
				{icon: 'crop_square', name: Format.single_texture_default ? 'menu.cube.texture.default' : 'menu.cube.texture.blank', click(cube) {
					cube.forSelected(function(obj) {
						obj.applyTexture(false, true)
					}, 'texture blank', Format.per_group_texture ? 'all_in_group' : null)
				}}
			];
			let applied_texture;
			main_loop: for (let cube of Cube.selected) {
				face_loop: for (let fkey in cube.faces) {
					let texture = cube.faces[fkey].getTexture();
					if (texture) {
						if (!applied_texture) {
							applied_texture = texture;
						} else if (applied_texture != texture) {
							applied_texture = null;
							break main_loop;
							break face_loop;
						}
					}
				}
			}
			Texture.all.forEach(function(t) {
				arr.push({
					name: t.name,
					icon: (t.mode === 'link' ? t.img : t.source),
					marked: t == applied_texture,
					click: function(cube) {
						cube.forSelected(function(obj) {
							obj.applyTexture(t, true)
						}, 'apply texture', Format.per_group_texture ? 'all_in_group' : null)
					}
				})
			})
			return arr;
		}},
		'edit_material_instances',
		'element_render_order',
		'check_overlapping_cubes',
		new MenuSeparator('manage'),
		'rename',
		'toggle_visibility',
		'delete'
	]);
	Cube.prototype.buttons = [
		Outliner.buttons.autouv,
		Outliner.buttons.mirror_uv,
		Outliner.buttons.shade,
		Outliner.buttons.export,
		Outliner.buttons.locked,
		Outliner.buttons.visibility,
	];

new Property(Cube, 'string', 'name', {default: 'cube'});
new Property(Cube, 'boolean', 'box_uv', {merge_validation: (value) => Format.optional_box_uv || value === Format.box_uv});
new Property(Cube, 'enum', 'render_order', {
	default: 'default',
	values: ['default', 'behind', 'in_front'],
	inputs: {
		element_panel: {
			input: {label: 'action.element_render_order.short', description: 'action.element_render_order.desc', type: 'select', options: {
				default: 'action.element_render_order.default',
				behind: 'action.element_render_order.behind',
				in_front: 'action.element_render_order.in_front'
			}},
			onChange() {
				Cube.selected.forEach(element => {
					element.preview_controller.updateRenderOrder(element);
				});
			}
		}
	}
});
new Property(Cube, 'boolean', 'rescale', {
	condition: {features: ['java_cube_shading_properties']},
	inputs: {
		element_panel: {
			input: {label: 'cube.rescale', description: 'cube.rescale.desc', type: 'checkbox'},
			onChange() {
				Canvas.updateView({elements: Cube.all, element_aspects: {transform: true}})
			}
		}
	}
});
new Property(Cube, 'boolean', 'locked');
// 编号65：锁定后方块在新建/追加贴图（重排 UV）时不改变自身 UV 大小范围与位置
// 编号66：开关从元素面板移到 UV 编辑器底部滑块栏（uv.js 的 uv_lock_size Toggle）
new Property(Cube, 'boolean', 'uv_lock', {default: false});
new Property(Cube, 'boolean', 'shade', {
	default: true,
	condition: {features: ['java_cube_shading_properties'], method: () => !Format.java_cube_shade_direction_override},
	inputs: {
		element_panel: {
			input: {label: 'switches.shade', type: 'checkbox'},
		}
	}
});
new Property(Cube, 'enum', 'shade_direction_override', {
	default: '',
	condition: {features: ['java_cube_shading_properties', 'java_cube_shade_direction_override']},
	inputs: {
		element_panel: {
			input: {label: 'cube.shade_direction_override', description: 'cube.shade_direction_override.desc', type: 'select', options: {
				'': 'generic.none',
				north: 'face.north',
				south: 'face.south',
				west: 'face.west',
				east: 'face.east',
				up: 'face.up',
				down: 'face.down',
			}},
		}
	}
});
new Property(Cube, 'number', 'light_emission', {
	condition: {features: ['java_cube_shading_properties']},
	inputs: {
		element_panel: {
			input: {label: 'action.cube_light_emission', type: 'number', min: 0, max: 15, step: 1, force_step: true},
		}
	}
});

OutlinerElement.registerType(Cube, 'cube');

export function adjustFromAndToForInflateAndStretch(from, to, element) {
	var halfSize = element.size().slice();
	halfSize.forEach((v, i) => {
		halfSize[i] /= 2;
	});
	var center = [
		element.from[0] + halfSize[0],
		element.from[1] + halfSize[1],
		element.from[2] + halfSize[2]
	];

	for (let i = 0; i < from.length; i++) {
		from[i] = center[i] - (halfSize[i] + element.inflate) * element.stretch[i];
		to[i] = center[i] + (halfSize[i] + element.inflate) * element.stretch[i];
	}
}

function getRescalingFactor(angle) {
	angle = Math.abs(angle);
	if (angle > 45) angle = 90-angle;
	return 1 / Math.cos(Math.degToRad(angle));
}

new NodePreviewController(Cube, {
	setup(element) {
		let mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), Canvas.emptyMaterials[0]);
		Project.nodes_3d[element.uuid] = mesh;
		mesh.name = element.uuid;
		mesh.type = 'cube';
		mesh.isElement = true;
		mesh.visible = element.visibility;
		mesh.rotation.order = Format.euler_order
		// #83 性能：cube mesh 的局部变换只在编辑时变化（播放动画驱动的是骨骼组）。
		// 默认 matrixAutoUpdate 会让渲染循环对每立方体每帧重做 TRS compose
		// （YSM 级模型 6k+ 立方体时占帧耗 ~8%），改为关闭并在 updateTransform 里
		// 显式 updateMatrix。被元素级动画直接驱动的 cube 由 BoneBatcher.rebuild
		// 恢复为自动更新。
		mesh.matrixAutoUpdate = false;

		mesh.geometry.setAttribute('highlight', new THREE.BufferAttribute(new Uint8Array(24).fill(0), 1));

		// Outline
		let geometry = new THREE.BufferGeometry();
		let line = new THREE.Line(geometry, Canvas.outlineMaterial);
		line.no_export = true;
		line.name = element.uuid+'_outline';
		line.visible = element.selected;
		line.renderOrder = 2;
		line.frustumCulled = false;
		line.matrixAutoUpdate = false;
		line.updateMatrix();
		mesh.outline = line;
		mesh.add(line);

		// Update
		this.updateTransform(element);
		this.updateGeometry(element);
		this.updateFaces(element);
		this.updateUV(element);
		this.updateRenderOrder(element);

		this.dispatchEvent('setup', {element});
	},
	updateTransform(element) {
		NodePreviewController.prototype.updateTransform.call(this, element);

		let mesh = element.mesh;

		if (Format.rotate_cubes && element.rescale === true) {
			let rescale = element.rotation.map(angle => getRescalingFactor(angle));
			mesh.scale.set(
				rescale[1] * rescale[2],
				rescale[0] * rescale[2],
				rescale[0] * rescale[1],
			)
		} else {
			mesh.scale.set(1, 1, 1);
		}

		// matrixAutoUpdate=false（见 setup）：TRS/scale 变更后显式重组局部矩阵并刷新世界矩阵
		mesh.updateMatrix();
		mesh.updateMatrixWorld();

		this.dispatchEvent('update_transform', {element});
	},
	updateGeometry(element) {
		let mesh = element.mesh;
		var from = element.from.slice()
		var to = element.to.slice()

		adjustFromAndToForInflateAndStretch(from, to, element);

		from.forEach((v, i) => {
			from[i] -= element.origin[i];
		})
		to.forEach((v, i) => {
			to[i] -= element.origin[i];
			if (from[i] === to[i]) {
				to[i] += 0.001
			}
		})
		mesh.geometry.setShape(from, to)
		mesh.geometry.computeBoundingBox()
		mesh.geometry.computeBoundingSphere()

		// Update outline
		var vs = [0,1,2,3,4,5,6,7].map(i => {
			return mesh.geometry.attributes.position.array.slice(i*3, i*3 + 3)
		});
		let points = [
			vs[2], vs[3],
			vs[6], vs[7],
			vs[2], vs[0],
			vs[1], vs[4],
			vs[5], vs[0],
			vs[5], vs[7],
			vs[6], vs[4],
			vs[1], vs[3]
		].map(a => new THREE.Vector3().fromArray(a))
		mesh.outline.geometry.setFromPoints(points);

		this.updatePixelGrid(element);

		this.dispatchEvent('update_geometry', {element});
	},
	updateFaces(element) {
		let {mesh} = element;

		let indices = [];
		let j = 0;
		mesh.geometry.faces = [];
		mesh.geometry.clearGroups();
		let last_tex;
		Canvas.face_order.forEach((fkey, i) => {
			if (element.faces[fkey].texture !== null) {
				indices.push(0 + i*4, 2 + i*4, 1 + i*4, 2 + i*4, 3 + i*4, 1 + i*4);
				if (last_tex && element.faces[fkey].texture === last_tex) {
					mesh.geometry.groups[mesh.geometry.groups.length-1].count += 6;
				} else {
					mesh.geometry.addGroup(j*6, 6, j)
					last_tex = element.faces[fkey].texture;
				}
				mesh.geometry.faces.push(fkey)
				j++;
			}
		})
		mesh.geometry.setIndex(indices)

		if (Project.view_mode === 'solid') {
			mesh.material = Canvas.monochromaticSolidMaterial
		
		} else if (Project.view_mode === 'colored_solid') {
			mesh.material = Canvas.getSolidColorMaterial(element.color)
		
		} else if (Project.view_mode === 'wireframe') {
			mesh.material = Canvas.wireframeMaterial
		
		} else if (Project.view_mode === 'normal') {
			mesh.material = Canvas.normalHelperMaterial
		
		} else if (Project.view_mode === 'uv') {
			mesh.material = Canvas.uvHelperMaterial

		} else if ((Format.single_texture || Format.single_texture_default) && Texture.all.length >= 2 && Texture.all.find(t => t.render_mode == 'layered')) {
			mesh.material = Canvas.getLayeredMaterial();

		} else if (Format.single_texture && !Project.getMultiFileRuleset()) {
			let tex = Texture.getDefault();
			mesh.material = tex ? tex.getMaterial(element.render_order, element) : Canvas.getEmptyMaterial(element.color);

		} else {
			let materials = [];
			Canvas.face_order.forEach(function(face) {
				if (element.faces[face].texture !== null) {
					let tex = element.faces[face].getTexture();
					if (tex && tex.uuid) {
						materials.push(tex.getMaterial(element.render_order, element))
					} else {
						materials.push(Canvas.getEmptyMaterial(element.color))
					}
				}
			})
			if (materials.allEqual(materials[0])) materials = materials[0];
			mesh.material = materials;
		}
		Texture.splitRenderOrderPasses(mesh);

		if (!mesh.material) mesh.material = Canvas.transparentMaterial;

		Cube.preview_controller.dispatchEvent('update_faces', {element});
	},
	updateUV(element, animation = true) {
		let mesh = element.mesh
		if (mesh === undefined || !mesh.geometry) return;

		if (element.box_uv) {

			let size = element.size(undefined, 'box_uv');
			
			let face_list = [   
				{face: 'east',	from: [0, size[2]],				   		size: [size[2],  size[1]]},
				{face: 'west',	from: [size[2] + size[0], size[2]],   	size: [size[2],  size[1]]},
				{face: 'up', 	from: [size[2]+size[0], size[2]],	 	size: [-size[0], -size[2]]},
				{face: 'down',	from: [size[2]+size[0]*2, 0],		 	size: [-size[0], size[2]]},
				{face: 'south',	from: [size[2]*2 + size[0], size[2]], 	size: [size[0],  size[1]]},
				{face: 'north',	from: [size[2], size[2]],			 	size: [size[0],  size[1]]},
			]

			if (element.mirror_uv) {
				face_list.forEach(function(f) {
					f.from[0] += f.size[0]
					f.size[0] *= -1
				})
				//East+West
				
				let p = {}

				p.from = face_list[0].from.slice()
				p.size = face_list[0].size.slice()

				face_list[0].from = face_list[1].from.slice()
				face_list[0].size = face_list[1].size.slice()

				face_list[1].from = p.from.slice()
				face_list[1].size = p.size.slice()

			}
			face_list.forEach(function(f, fIndex) {

				if (element.faces[f.face].texture == null) return;

				let uv= [
					f.from[0]			 +  element.uv_offset[0],
					f.from[1]			 +  element.uv_offset[1],
					f.from[0] + f.size[0] + element.uv_offset[0],
					f.from[1] + f.size[1] + element.uv_offset[1]
				]
				uv.forEach(function(s, si) {
					uv[si] *= 1
				})

				element.faces[f.face].uv[0] = uv[0]
				element.faces[f.face].uv[1] = uv[1]
				element.faces[f.face].uv[2] = uv[2]
				element.faces[f.face].uv[3] = uv[3]
			})

		}

		Canvas.face_order.forEach((fkey, index) => {
			let face = element.faces[fkey];
			if (face.texture === null) return;

			let stretch = 1;
			let frame = 0;
			let tex = face.getTexture();
			let uv = face.uv;
			let vertex_uvs = mesh.geometry.attributes.uv;
			let pw = Project.texture_width;
			let ph = Project.texture_height;
			if (tex && Format.per_texture_uv_size && Project.view_mode !== 'uv') {
				pw = tex.getUVWidth();
				ph = tex.getUVHeight();
			}

			if (tex instanceof Texture && tex.frameCount !== 1) {
				stretch = tex.frameCount || 1;
				if (animation === true && tex.currentFrame) {
					frame = tex.currentFrame;
				}
			}
			stretch *= -1;

			// Box UV fight texture bleeding
			if (element.box_uv) {
				uv = uv.slice();
				for (let si = 0; si < 2; si++) {
					let margin = 1/64;
					if (uv[si] > uv[si+2]) {
						margin = -margin
					}
					uv[si] += margin
					uv[si+2] -= margin
				}
			}

			let arr = [
				[uv[0]/pw, (uv[1]/ph)/stretch+1],
				[uv[2]/pw, (uv[1]/ph)/stretch+1],
				[uv[0]/pw, (uv[3]/ph)/stretch+1],
				[uv[2]/pw, (uv[3]/ph)/stretch+1],
			]
			if (frame > 0 && stretch !== -1) {
				//Animate
				let offset = (1/stretch) * frame
				arr[0][1] += offset
				arr[1][1] += offset
				arr[2][1] += offset
				arr[3][1] += offset
			}
			let rot = (face.rotation+0)
			while (rot > 0) {
				let a = arr[0];
				arr[0] = arr[2];
				arr[2] = arr[3];
				arr[3] = arr[1];
				arr[1] = a;
				rot = rot-90;
			}
			vertex_uvs.array.set(arr[0], index*8 + 0);  //0,1
			vertex_uvs.array.set(arr[1], index*8 + 2);  //1,1
			vertex_uvs.array.set(arr[2], index*8 + 4);  //0,0
			vertex_uvs.array.set(arr[3], index*8 + 6);  //1,0
		})

		mesh.geometry.attributes.uv.needsUpdate = true;

		this.dispatchEvent('update_uv', {element});

		this.updatePixelGrid(element);

		return mesh.geometry;
	},
	updateHighlight(element, hover_cube, force_off) {
		var mesh = element.mesh;
		let highlighted = (
			Settings.get('highlight_cubes') &&
			((hover_cube == element && !Transformer.dragging) || element.selected) &&
			Modes.edit &&
			!force_off
		) ? 1 : 0;

		if (mesh.geometry.attributes.highlight.array[0] != highlighted) {
			mesh.geometry.attributes.highlight.array.set(Array(mesh.geometry.attributes.highlight.count).fill(highlighted));
			mesh.geometry.attributes.highlight.needsUpdate = true;
		}

		this.dispatchEvent('update_highlight', {element});
	},
	updatePixelGrid(cube) {
		var mesh = cube.mesh;
		if (mesh === undefined) return;
		let grid_enabled = (Modes.paint && settings.painting_grid.value) || (Modes.edit && settings.pixel_grid.value)
		// #87：无既有网格且当前不需要网格时直接返回，避免模式切换时对每个元素做 remove/dispose
		if (!grid_enabled && !mesh.grid_box) return;
		mesh.remove(mesh.grid_box);
		if (mesh.grid_box?.geometry) mesh.grid_box.geometry.dispose();
		if (cube.visibility == false) return;

		if (!grid_enabled) return;

		var from = cube.from.slice();
		var to = cube.to.slice();
		if (cube.inflate || cube.isStretched()) {
			adjustFromAndToForInflateAndStretch(from, to, cube);
		}
		for (let i = 0; i < 3; i++) {
			if (to[i] < from[i]) {
				let x = to[i];
				to[i] = from[i];
				from[i] = x;
			}
		}

		var vertices = [];
		var epsilon = 0.0001
		function getVector2(arr, axis) {
			switch (axis) {
				case 0: return [arr[1], arr[2]]; break;
				case 1: return [arr[0], arr[2]]; break;
				case 2: return [arr[0], arr[1]]; break;
			}
		}
		function addVector(u, v, axis, w) {
			switch (axis) {
				case 0: vertices.push(w, u, v); break;
				case 1: vertices.push(u, w, v); break;
				case 2: vertices.push(u, v, w); break;
			}
		}

		function addFace(name, uv_offset, axis, side) {

			var start = getVector2(from, axis)
			var end = getVector2(to, axis)
			var face = cube.faces[name];
			var texture = face.getTexture();
			if (texture === null) return;

			var px_x = texture ? texture.uv_width / texture.width : 1;
			var px_y = texture ? texture.uv_height / texture.height : 1;
			var uv_size = [
				Math.abs(face.uv_size[0]),
				Math.abs(face.uv_size[1])
			]
			uv_offset = [
				uv_offset[0] == true
					? (face.uv_size[0] > 0 ? (px_x-face.uv[2]) : (	   face.uv[2]))
					: (face.uv_size[0] > 0 ? (     face.uv[0]) : (px_x-face.uv[0])),
				uv_offset[1] == true
					? (face.uv_size[1] > 0 ? (px_y-face.uv[3]) : (	   face.uv[3]))
					: (face.uv_size[1] > 0 ? (     face.uv[1]) : (px_y-face.uv[1]))
			]
			uv_offset[0] = uv_offset[0] % px_x;
			uv_offset[1] = uv_offset[1] % px_y;
			
			if ((face.rotation % 180 == 90) != (axis == 0)) {
				uv_size.reverse();
				uv_offset.reverse();
			}

			var w = side == 0 ? from[axis] : to[axis]

			//Columns
			var width = end[0]-start[0];
			var step = Math.abs( width / uv_size[0] );
			if (texture) step *= texture.uv_width / texture.width;
			if (step < epsilon) step = epsilon;

			for (var col = start[0] - uv_offset[0]; col <= end[0]; col += step) {
				if (col >= start[0]) {
					addVector(col, start[1], axis, w);
					addVector(col, end[1], axis, w);
				}
			}

			//lines
			var height = end[1]-start[1];
			var step = Math.abs( height / uv_size[1] );
			if (texture) {
				let tex_height = texture.frameCount ? (texture.height / texture.frameCount) : texture.height;
				step *= texture.uv_height / tex_height;
			}
			if (step < epsilon) step = epsilon;

			for (var line = start[1] - uv_offset[1]; line <= end[1]; line += step) {
				if (line >= start[1]) {
					addVector(start[0], line, axis, w);
					addVector(end[0], line, axis, w);
				}
			}
		}

		addFace('north', [true,  true],  2, 0);
		addFace('south', [false, true],  2, 1);
		addFace('west',  [false, true],  0, 0);
		addFace('east',  [true,  true],  0, 1);
		addFace('down',  [false, true],  1, 0);
		addFace('up',    [false, false], 1, 1);


		var geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );

		let box = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color: gizmo_colors.grid}));
		box.geometry.translate(-cube.origin[0], -cube.origin[1], -cube.origin[2]);
		box.no_export = true;

		box.name = cube.uuid+'_grid_box';
		box.renderOrder = 2;
		box.frustumCulled = false;
		box.matrixAutoUpdate = false;
		box.updateMatrix();
		mesh.grid_box = box;
		mesh.add(box);

		this.dispatchEvent('update_painting_grid', {element: cube});
	},
	viewportRectangleOverlap(element, {projectPoint, rect_start, rect_end, preview}) {
		let {mesh} = element;
		let vector = Reusable.vec2;
		var adjustedFrom = element.from.slice();
		var adjustedTo = element.to.slice();
		adjustFromAndToForInflateAndStretch(adjustedFrom, adjustedTo, element);

		let vertices = [
			[adjustedFrom[0] , adjustedFrom[1] , adjustedFrom[2] ],
			[adjustedFrom[0] , adjustedFrom[1] , adjustedTo[2]   ],
			[adjustedFrom[0] , adjustedTo[1]   , adjustedTo[2]   ],
			[adjustedFrom[0] , adjustedTo[1]   , adjustedFrom[2] ],
			[adjustedTo[0]   , adjustedFrom[1] , adjustedFrom[2] ],
			[adjustedTo[0]   , adjustedFrom[1] , adjustedTo[2]   ],
			[adjustedTo[0]   , adjustedTo[1]   , adjustedTo[2]   ],
			[adjustedTo[0]   , adjustedTo[1]   , adjustedFrom[2] ],
		].map(coords => {
			coords.V3_subtract(element.origin);
			vector.fromArray(coords);
			mesh.localToWorld(vector);
			return projectPoint(vector);
		})
		let is_on_screen = vertices.find(vertex => {
			return (vertex[0] >= 0 && vertex[0] <= preview.width
				 && vertex[1] >= 0 && vertex[1] <= preview.height);
		})
		return is_on_screen && (
			   lineIntersectsReactangle(vertices[0], vertices[1], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[1], vertices[2], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[2], vertices[3], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[3], vertices[0], rect_start, rect_end)

			|| lineIntersectsReactangle(vertices[4], vertices[5], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[5], vertices[6], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[6], vertices[7], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[7], vertices[4], rect_start, rect_end)

			|| lineIntersectsReactangle(vertices[0], vertices[4], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[1], vertices[5], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[2], vertices[6], rect_start, rect_end)
			|| lineIntersectsReactangle(vertices[3], vertices[7], rect_start, rect_end)
		);
	}
})

BARS.defineActions(function() {
	// 反馈#135：负尺寸描边——为选中的块/选中的组内所有块，创建各轴扩大「宽度」格的
	// 负尺寸壳块（from > to，游戏里反面渲染形成描边），并按参数填充颜色与分配 UV。
	// 反馈#144：负尺寸壳块（from > to）在视觉上把该轴两端互换（东面渲染在西侧），
	// 因此壳块某个目标面的删除状态应取自源块的「对面」；源块自身该轴已是负尺寸时
	// 两侧同为负，取同名面。
	const negative_outline_face_axis = {east: 0, west: 0, up: 1, down: 1, south: 2, north: 2};
	function negativeOutlineSourceFace(cube, target_key) {
		let axis = negative_outline_face_axis[target_key];
		return cube.from[axis] > cube.to[axis] ? target_key : CubeFace.opposite[target_key];
	}
	new Action('negative_outline', {
		icon: 'border_outer',
		category: 'edit',
		condition: () => Modes.edit && Project && Format.edit_mode !== false && !Format.image_editor
			&& (Outliner.selected.some(el => el instanceof Cube) || Group.multi_selected.length > 0),
		click: function () {
			let targets = new Set();
			Outliner.selected.forEach(el => { if (el instanceof Cube) targets.add(el); });
			Group.multi_selected.forEach(g => {
				g.forEachChild(el => { if (el instanceof Cube) targets.add(el); });
			});
			if (!targets.size) return;
			new Dialog({
				id: 'negative_outline',
				title: 'action.negative_outline',
				width: 520,
				form: {
					width: {label: 'dialog.negative_outline.width', type: 'number', value: 1, min: 0.01, step: 0.01},
					uv_mode: {label: 'dialog.negative_outline.uv_mode', type: 'select', value: 'individual', options: {
						individual: 'dialog.negative_outline.uv_mode.individual',
						shared: 'dialog.negative_outline.uv_mode.shared',
					}},
					// 反馈#162：UV 大小可选「每面 1 格」或「与原模型该面 UV 同大小」
					uv_size: {label: 'dialog.negative_outline.uv_size', type: 'select', value: 'cell', options: {
						cell: 'dialog.negative_outline.uv_size.cell',
						source: 'dialog.negative_outline.uv_size.source',
					}},
					// 反馈#158：UV 排列起点（四角）与排列方式（按行 / 紧凑近似正方形）
					corner: {label: 'dialog.negative_outline.corner', type: 'select', value: 'top_left', options: {
						top_left: 'dialog.negative_outline.corner.top_left',
						top_right: 'dialog.negative_outline.corner.top_right',
						bottom_left: 'dialog.negative_outline.corner.bottom_left',
						bottom_right: 'dialog.negative_outline.corner.bottom_right',
					}},
					layout: {label: 'dialog.negative_outline.layout', type: 'select', value: 'rows', options: {
						rows: 'dialog.negative_outline.layout.rows',
						compact: 'dialog.negative_outline.layout.compact',
					}},
					color: {label: 'dialog.negative_outline.color', type: 'color', value: ColorPanel.get(), condition: (form) => !form.empty_color},
					// 反馈#158：勾选后不用前景色，而是把分配的 UV 区域擦成纯透明
					empty_color: {label: 'dialog.negative_outline.empty_color', type: 'checkbox', value: false},
					read_deleted: {label: 'dialog.negative_outline.read_deleted', type: 'checkbox', value: true},
					// 反馈#162：按源面 UV 中的有色像素，在描边贴图上生成对应的绘画选区
					create_selection: {label: 'dialog.negative_outline.create_selection', type: 'checkbox', value: false},
				},
				onConfirm(form) {
					let w = Math.max(0.01, Number(form.width) || 0);
					let color = form.color;
					let cube_list = [...targets];
					let face_keys = ['up', 'down', 'north', 'south', 'east', 'west'];

					Undo.initEdit({elements: [], outliner: true, textures: Texture.getDefault() ? [Texture.getDefault()] : [], bitmap: true});

					// 目标贴图：默认贴图，没有则新建 16x16
					let texture = Texture.getDefault();
					if (!texture) {
						let canvas = document.createElement('canvas');
						canvas.width = canvas.height = 16;
						texture = new Texture({name: 'outline', mode: 'bitmap', keep_size: true, folder: 'block'})
							.fromDataURL(canvas.toDataURL('image/png')).fillParticle();
						texture.add(false, true);
						if (Format.per_texture_uv_size) {
							texture.uv_width = 16;
							texture.uv_height = 16;
						}
					} else {
						// initEdit 快照会替换活跃数组内的对象，按 uuid 重查
						texture = Texture.all.find(t => t.uuid == texture.uuid);
					}
					let uv_w = texture.getUVWidth();
					let uv_h = texture.getUVHeight();

					// 反馈#152：UV 单元从贴图上「未被已有 UV 占用」的位置取用，
					// 避免描边 UV（及其填充色）与原模型已有 UV 区域重叠冲突。
					let occupied = new Set();
					let markUsed = face => {
						if (!face || face.texture === null) return;
						let u0 = Math.floor(Math.min(face.uv[0], face.uv[2]));
						let u1 = Math.ceil(Math.max(face.uv[0], face.uv[2]));
						let v0 = Math.floor(Math.min(face.uv[1], face.uv[3]));
						let v1 = Math.ceil(Math.max(face.uv[1], face.uv[3]));
						for (let u = Math.max(0, u0); u < u1 && u < uv_w; u++) {
							for (let v = Math.max(0, v0); v < v1 && v < uv_h; v++) {
								occupied.add(u + ',' + v);
							}
						}
					};
					Outliner.elements.forEach(el => {
						if (!(el instanceof Cube)) return;
						for (let fkey in el.faces) {
							let face = el.faces[fkey];
							if (face && face.texture !== null && face.getTexture() === texture) markUsed(face);
						}
					});

					// 反馈#158：排列起点（四角，扫描坐标 → 贴图坐标时翻转）与排列方式（按行 / 紧凑）
					let corner = ['top_right', 'bottom_left', 'bottom_right'].includes(form.corner) ? form.corner : 'top_left';
					let flip_u = corner.endsWith('right');
					let flip_v = corner.startsWith('bottom');
					let compact_layout = form.layout == 'compact';
					let source_uv_size = form.uv_size == 'source';
					let source_size_cache = new Map();

					// 反馈#162：每面所需的 UV 矩形尺寸（UV 单位，整数格）
					function faceRectSize(cube, fkey) {
						let key = cube.uuid + ':' + fkey;
						if (source_size_cache.has(key)) return source_size_cache.get(key);
						let size = [1, 1];
						if (source_uv_size) {
							let face = cube.faces[negativeOutlineSourceFace(cube, fkey)];
							if (face && face.uv && face.uv.length == 4) {
								size = [
									Math.max(1, Math.ceil(Math.abs(face.uv[2] - face.uv[0]) - 1e-6)),
									Math.max(1, Math.ceil(Math.abs(face.uv[3] - face.uv[1]) - 1e-6)),
								];
							}
						}
						source_size_cache.set(key, size);
						return size;
					}
					// 扫描坐标（从选定角起算）→ 贴图 UV 坐标
					function scanToUV(su, sv, rw, rh) {
						return [flip_u ? uv_w - su - rw : su, flip_v ? uv_h - sv - rh : sv];
					}
					function rectFree(u, v, rw, rh) {
						if (u < 0 || v < 0 || u + rw > uv_w || v + rh > uv_h) return false;
						for (let x = u; x < u + rw; x++) {
							for (let y = v; y < v + rh; y++) {
								if (occupied.has(x + ',' + y)) return false;
							}
						}
						return true;
					}
					function claimRect(su, sv, rw, rh) {
						let [u, v] = scanToUV(su, sv, rw, rh);
						for (let x = u; x < u + rw; x++) {
							for (let y = v; y < v + rh; y++) {
								occupied.add(x + ',' + y);
							}
						}
						return [u, v, rw, rh];
					}
					function allocRect(rw, rh) {
						if (compact_layout) {
							// 紧凑：从选定角向外按「远边距离」一圈圈扩展，整体接近正方形
							for (let d = Math.max(rw, rh); d <= uv_w + uv_h; d++) {
								let su = d - rw;
								if (su >= 0 && su + rw <= uv_w) {
									for (let sv = 0; sv + rh <= d && sv + rh <= uv_h; sv++) {
										let [u, v] = scanToUV(su, sv, rw, rh);
										if (rectFree(u, v, rw, rh)) return claimRect(su, sv, rw, rh);
									}
								}
								let sv = d - rh;
								if (sv >= 0 && sv + rh <= uv_h) {
									for (let su2 = 0; su2 + rw < d && su2 + rw <= uv_w; su2++) {
										let [u, v] = scanToUV(su2, sv, rw, rh);
										if (rectFree(u, v, rw, rh)) return claimRect(su2, sv, rw, rh);
									}
								}
							}
						} else {
							// 按行：从选定角开始横向填满一行再换行（原有行为）
							for (let sv = 0; sv + rh <= uv_h; sv++) {
								for (let su = 0; su + rw <= uv_w; su++) {
									let [u, v] = scanToUV(su, sv, rw, rh);
									if (rectFree(u, v, rw, rh)) return claimRect(su, sv, rw, rh);
								}
							}
						}
						return null;
					}

					// 分配：individual（默认）= 每块的每个面独占一个 UV 矩形；shared = 所有块的所有面共用一个矩形
					let rect_map = [];   // rect_map[cube_index][fkey] = [u, v, w, h]
					let shared_rect = null;
					let exhausted = false;
					if (form.uv_mode == 'shared') {
						let max_w = 1, max_h = 1;
						cube_list.forEach(cube => face_keys.forEach(fkey => {
							let [rw, rh] = faceRectSize(cube, fkey);
							max_w = Math.max(max_w, rw);
							max_h = Math.max(max_h, rh);
						}));
						shared_rect = allocRect(max_w, max_h);
						if (!shared_rect) {
							shared_rect = [0, 0, max_w, max_h];
							exhausted = true;
						}
					}
					cube_list.forEach(cube => {
						let map = {};
						face_keys.forEach(fkey => {
							if (shared_rect) {
								map[fkey] = shared_rect;
								return;
							}
							let [rw, rh] = faceRectSize(cube, fkey);
							let rect = allocRect(rw, rh);
							if (!rect) {
								// 贴图 UV 空间耗尽：退化为复用左上角（填充色一致，仅无法逐面独立）
								rect = [0, 0, rw, rh];
								exhausted = true;
							}
							map[fkey] = rect;
						});
						rect_map.push(map);
					});
					if (exhausted) {
						Blockbench.showQuickMessage('dialog.negative_outline.uv_full', 4000);
					}

					// 填充颜色到分配的贴图像素（直绘画布：texture.edit 会自建独立撤销条目，
					// 与本动作的撤销拆分；外层 Undo.initEdit 已含 bitmap 快照）
					if (!texture.internal) texture.convertToInternal();
					let {canvas: tex_canvas} = texture.getActiveCanvas();
					let tex_ctx = tex_canvas.getContext('2d');
					tex_ctx.imageSmoothingEnabled = false;
					tex_ctx.fillStyle = color;
					// 反馈#158：空颜色 = 擦成纯透明；图层纹理需要逐层擦除，否则其他层的像素仍会显示
					let clear_layers = (form.empty_color && texture.layers_enabled)
						? texture.layers.filter(l => l.type == 'pixel_layer' && l.visible)
						: null;
					let filled = new Set();
					rect_map.forEach(map => face_keys.forEach(fkey => {
						let [u, v, rw, rh] = map[fkey];
						let key = u + ',' + v + ',' + rw + ',' + rh;
						if (filled.has(key)) return;
						filled.add(key);
						let px = Math.round(u * tex_canvas.width / uv_w);
						let py = Math.round(v * tex_canvas.height / uv_h);
						let pw = Math.max(1, Math.round(rw * tex_canvas.width / uv_w));
						let ph = Math.max(1, Math.round(rh * tex_canvas.height / uv_h));
						if (clear_layers) {
							clear_layers.forEach(layer => {
								layer.ctx.clearRect(px - layer.offset[0], py - layer.offset[1], pw, ph);
							});
						} else if (form.empty_color) {
							tex_ctx.clearRect(px, py, pw, ph);
						} else {
							tex_ctx.fillRect(px, py, pw, ph);
						}
					}));
					texture.updateChangesAfterEdit();

					let new_cubes = [];
					cube_list.forEach((cube, i) => {
						let faces_data = {};
						face_keys.forEach(fkey => {
							// 读取删除面：按负尺寸的镜像置换取源面，源面被删除（texture=null）时壳块该面同样删除
							let source_face = cube.faces[negativeOutlineSourceFace(cube, fkey)];
							if (form.read_deleted && source_face && source_face.texture === null) {
								faces_data[fkey] = {texture: null};
								return;
							}
							let [u, v, rw, rh] = rect_map[i][fkey];
							faces_data[fkey] = {uv: [u, v, u + rw, v + rh], texture};
						});
						// 反馈#152：源块可能带「膨胀」（从中心向六个方向扩张/收缩，可为负）与拉伸，
						// 壳块必须包住膨胀后的实际体积，否则描边会陷进模型内部。
						let src_from = cube.from.slice();
						let src_to = cube.to.slice();
						adjustFromAndToForInflateAndStretch(src_from, src_to, cube);
						let shell = new Cube({
							name: (cube.name || 'cube') + '_outline',
							autouv: 0,
							box_uv: false,
							// 负尺寸：from > to；用 max/min 计算以兼容源块本身已是负尺寸的情况
							from: [Math.max(src_from[0], src_to[0]) + w, Math.max(src_from[1], src_to[1]) + w, Math.max(src_from[2], src_to[2]) + w],
							to: [Math.min(src_from[0], src_to[0]) - w, Math.min(src_from[1], src_to[1]) - w, Math.min(src_from[2], src_to[2]) - w],
							rotation: cube.rotation.slice(),
							origin: cube.origin.slice(),
							faces: faces_data,
						}).init();
						shell.addTo(cube.parent instanceof Group ? cube.parent : undefined);
						shell.preview_controller.updateTransform(shell);
						new_cubes.push(shell);
					});
					Outliner.selected.replace(new_cubes);

					// 反馈#162：勾选「创建选区」时，按源面贴图有色（alpha>0）像素在描边贴图上生成绘画选区。
					// 源像素 → 目标 UV 矩形按比例映射，只标记源图形覆盖到的目标像素。
					if (form.create_selection && texture.width && texture.height) {
						let src_cache = new Map();
						function getSourcePixels(src_tex) {
							if (src_cache.has(src_tex.uuid)) return src_cache.get(src_tex.uuid);
							let entry = null;
							let canvas = src_tex.canvas;
							if (src_tex.layers_enabled) src_tex.updateLayerChanges(false);
							if (canvas && canvas.width && canvas.height) {
								try {
									entry = {
										width: canvas.width,
										height: canvas.height,
										data: canvas.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, canvas.width, canvas.height).data,
									};
								} catch (err) {
									entry = null;
								}
							}
							src_cache.set(src_tex.uuid, entry);
							return entry;
						}
						let selection = texture.selection;
						selection.changeSize(texture.width, texture.height);
						selection.setOverride(null);
						cube_list.forEach((cube, i) => {
							face_keys.forEach(fkey => {
								let src_face = cube.faces[negativeOutlineSourceFace(cube, fkey)];
								if (!src_face || src_face.texture === null || !src_face.uv || src_face.uv.length != 4) return;
								let src_tex = src_face.getTexture();
								if (!(src_tex instanceof Texture)) return;
								let pixels = getSourcePixels(src_tex);
								if (!pixels) return;
								let suw = src_tex.getUVWidth() || pixels.width;
								let suh = src_tex.getUVHeight() || pixels.height;
								let su0 = Math.min(src_face.uv[0], src_face.uv[2]);
								let su1 = Math.max(src_face.uv[0], src_face.uv[2]);
								let sv0 = Math.min(src_face.uv[1], src_face.uv[3]);
								let sv1 = Math.max(src_face.uv[1], src_face.uv[3]);
								let sx0 = Math.max(0, Math.floor(su0 * pixels.width / suw));
								let sx1 = Math.min(pixels.width, Math.ceil(su1 * pixels.width / suw));
								let sy0 = Math.max(0, Math.floor(sv0 * pixels.height / suh));
								let sy1 = Math.min(pixels.height, Math.ceil(sv1 * pixels.height / suh));
								if (sx1 <= sx0 || sy1 <= sy0) return;
								let [u, v, rw, rh] = rect_map[i][fkey];
								let px0 = Math.max(0, Math.round(u * texture.width / uv_w));
								let px1 = Math.min(texture.width, Math.round((u + rw) * texture.width / uv_w));
								let py0 = Math.max(0, Math.round(v * texture.height / uv_h));
								let py1 = Math.min(texture.height, Math.round((v + rh) * texture.height / uv_h));
								if (px1 <= px0 || py1 <= py0) return;
								// 反向映射：每个描边贴图像素回采源面 UV 对应像素，保证选区覆盖整个目标 UV 区域
								for (let ty = py0; ty < py1; ty++) {
									let fy = (ty + 0.5 - py0) / (py1 - py0);
									let sy = Math.min(sy1 - 1, Math.max(sy0, Math.floor(sy0 + fy * (sy1 - sy0))));
									for (let tx = px0; tx < px1; tx++) {
										let fx = (tx + 0.5 - px0) / (px1 - px0);
										let sx = Math.min(sx1 - 1, Math.max(sx0, Math.floor(sx0 + fx * (sx1 - sx0))));
										if (pixels.data[(sy * pixels.width + sx) * 4 + 3] == 0) continue;
										selection.set(tx, ty, 1);
									}
								}
							});
						});
						if (Texture.selected != texture) texture.select();
						UVEditor.updateSelectionOutline();
					}

					Undo.finishEdit('Create negative outline', {elements: new_cubes, outliner: true, textures: [texture], bitmap: true});
				}
			}).show();
		}
	})
	new Action({
		id: 'add_cube',
		icon: 'add_box',
		category: 'edit',
		condition: () => Modes.edit,
		click: function () {
			
			Undo.initEdit({outliner: true, elements: [], selection: true});
			var base_cube = new Cube({
				autouv: (settings.autouv.value ? 1 : 0)
			}).init()
			if (!base_cube.box_uv) base_cube.mapAutoUV()
			let group = getCurrentGroup();
			if (group) {
				base_cube.addTo(group)
				base_cube.scope = group.scope;
				if (settings.inherit_parent_color.value) base_cube.color = group.color;
			}

			if (Texture.all.length && Format.single_texture) {
				for (var face in base_cube.faces) {
					base_cube.faces[face].texture = Texture.getDefault().uuid
				}
				UVEditor.loadData()
			}
			if (Format.bone_rig) {
				var pos1 = group ? group.origin.slice() : [0, 0, 0];
				let size = Settings.get('default_cube_size');
				if (size % 2 == 0) {
					base_cube.extend({
						from:[ pos1[0] - size/2, pos1[1] - 0,    pos1[2] - size/2 ],
						to:[   pos1[0] + size/2, pos1[1] + size, pos1[2] + size/2 ],
						origin: pos1.slice()
					})
				} else {
					base_cube.extend({
						from:[ pos1[0], pos1[1], pos1[2] ],
						to:[   pos1[0]+size, pos1[1]+size, pos1[2]+size ],
						origin: pos1.slice()
					})
				}
			}

			unselectAllElements()
			base_cube.select()
			Canvas.updateView({elements: [base_cube], element_aspects: {transform: true, geometry: true, faces: true}})
			Undo.finishEdit('Add cube', {outliner: true, elements: Outliner.selected, selection: true});
			Blockbench.dispatchEvent( 'add_cube', {object: base_cube} )

			Vue.nextTick(function() {
				if (settings.create_rename.value) {
					base_cube.rename()
				}
			})
			return base_cube
		}
	})

	new Action({
		id: 'edit_material_instances',
		icon: 'fas.fa-adjust',
		category: 'edit',
		condition: {modes: ['edit'], formats: ['bedrock_block'], method: () => Cube.selected.length && !Cube.selected.find(cube => cube.box_uv)},
		click: function () {
			let form = {};

			let first = Cube.selected[0];
			for (var key in first.faces) {
				let face = first.faces[key];
				if (face.texture != null) {
					form[key] = {
						label: `face.${key}`,
						value: face.material_name
					}
				}
			}

			let dialog = new Dialog({
				id: 'material_instances',
				title: 'dialog.material_instances.title',
				width: 460,
				form,
				onConfirm: form_data => {
					dialog.hide();
					
					Undo.initEdit({elements: Cube.selected});
					Cube.selected.forEach(cube => {
						for (var key in cube.faces) {
							let face = cube.faces[key];
							if (face.texture != null && typeof form_data[key] == 'string') {
								face.material_name = form_data[key];
							}
						}
					})
					Undo.finishEdit('Edit material instances')
				}
			})
			dialog.show();
		}
	})

	new BarSelect('cube_uv_mode', {
		name: 'dialog.project.uv_mode',
		category: 'uv',
		condition: () => Cube.selected.length && Format.optional_box_uv,
		options: {
			face_uv: 'dialog.project.uv_mode.face_uv',
			box_uv: 'dialog.project.uv_mode.box_uv',
		},
		onChange() {
			let box_uv = this.value == 'box_uv';
			Undo.initEdit({elements: Cube.selected, uv_only: true});
			Cube.selected.forEach(cube => {
				cube.setUVMode(box_uv);
			})
			Undo.finishEdit('Change UV mode')
			updateSelection();
		}
	})
	Blockbench.on('update_selection', () => {
		if (Condition(BarItems.cube_uv_mode)) {
			BarItems.cube_uv_mode.set(Cube.selected[0].box_uv ? 'box_uv' : 'face_uv');
		}
	})

	new BarSelect('element_render_order', {
		name: 'action.element_render_order',
		category: 'edit',
		condition: () => Outliner.selected.find(e => e.render_order) && Texture.all.length,
		options: {
			default: 'action.element_render_order.default',
			behind: 'action.element_render_order.behind',
			in_front: 'action.element_render_order.in_front',
		},
		onChange() {
			let elements = Outliner.selected.filter(e => e.render_order);
			Undo.initEdit({elements});
			elements.forEach(element => {
				element.render_order = this.value;
				element.preview_controller.updateRenderOrder(element);
			})
			Undo.finishEdit('Change render order')
			updateSelection();
		}
	})
	Blockbench.on('update_selection', () => {
		let element = Outliner.selected.find(e => e.render_order);
		if (element) {
			BarItems.element_render_order.set(element.render_order);
		}
	})

	new NumSlider('cube_light_emission', {
		category: 'edit',
		condition: {features: ['java_cube_shading_properties']},
		settings: {
			min: 0, max: 15, default: 0,
			show_bar: true
		},
		getInterval(event) {
			return 1;
		},
		get() {
			return Cube.selected[0]?.light_emission ?? 0;
		},
		change(modify) {
			for (let cube of Cube.selected) {
				cube.light_emission = modify(cube.light_emission);
			}
		},
		onBefore() {
			Undo.initEdit({elements: Cube.selected});
		},
		onAfter() {
			Undo.finishEdit('Change cube light emission');
		}
	})
	Blockbench.on('update_selection', () => {
		let value = Cube.selected[0]?.light_emission ?? 0;
		BarItems.cube_light_emission.setValue(value);
	})
})


Object.assign(window, {
	CubeFace,
	Cube,
	adjustFromAndToForInflateAndStretch
});
