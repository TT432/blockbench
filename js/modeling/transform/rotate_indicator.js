/**
 * 反馈#252：旋转角度扇形指示。
 *
 * 绕轴旋转拖拽时，在视口里以旋转中心为圆心画一个扇形：整圆轮廓 + 起始方向半径（实线）+
 * 当前方向半径（虚线）+ 两者之间的扇面，用来直观读出「已经转了多少度」。角度数值仍由原有
 * 状态栏读数（displayDistance）给出，这里不重复显示文本。
 *
 * 所有几何体都是单位大小（半径 1），方向由 group 的旋转给出，实际半径用 group.scale 控制，
 * 因此每次更新只需改矩阵与扇面顶点，不需要重建 BufferGeometry。
 */
export class RotateAngleIndicator {
	constructor() {
		// 扇面细分。分支数固定，拖拽时每帧只改写顶点坐标
		this.segments = 48;

		this.group = new THREE.Group();
		this.group.name = 'rotate_angle_indicator';
		this.group.visible = false;
		this.group.renderOrder = 998;

		let common = {
			transparent: true,
			opacity: 1,
			depthTest: false,
			depthWrite: false,
		};
		this.line_material = new THREE.LineBasicMaterial(common);
		this.dash_material = new THREE.LineDashedMaterial(Object.assign({
			dashSize: 0.1,
			gapSize: 0.07,
		}, common));
		this.fill_material = new THREE.MeshBasicMaterial(Object.assign({}, common, {
			opacity: 0.28,
			side: THREE.DoubleSide,
		}));

		// 整圆
		let circle_points = [];
		for (let i = 0; i < 96; i++) {
			let angle = i / 96 * Math.PI * 2;
			circle_points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
		}
		this.circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle_points), this.line_material);
		this.group.add(this.circle);

		// 起始方向半径（指向拖拽开始时鼠标所在方向）
		this.start_line = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
			this.line_material
		);
		this.group.add(this.start_line);

		// 当前方向半径（虚线，跟随鼠标）
		this.current_line = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]),
			this.dash_material
		);
		this.group.add(this.current_line);

		// 扇面：顶点 0 是圆心，其余是弧上的点
		this.fill_positions = new Float32Array((this.segments + 2) * 3);
		let fill_geometry = new THREE.BufferGeometry();
		fill_geometry.setAttribute('position', new THREE.BufferAttribute(this.fill_positions, 3));
		let fill_indices = [];
		for (let i = 0; i < this.segments; i++) fill_indices.push(0, i + 1, i + 2);
		fill_geometry.setIndex(fill_indices);
		this.fill = new THREE.Mesh(fill_geometry, this.fill_material);
		this.fill.frustumCulled = false;
		this.group.add(this.fill);

		this.group.traverse(child => { child.frustumCulled = false; });
	}
	/**
	 * 三处材质共用一个颜色，保持扇形与当前旋转轴的颜色一致
	 * @param {THREE.Color} color
	 */
	setColor(color) {
		this.line_material.color.copy(color);
		this.dash_material.color.copy(color);
		this.fill_material.color.copy(color);
	}
	attach(parent) {
		if (!parent || this.group.parent === parent) return;
		parent.add(this.group);
	}
	hide() {
		this.group.visible = false;
	}
	/**
	 * @param {object} options
	 * @param {THREE.Vector3} options.origin 旋转中心（世界坐标）
	 * @param {THREE.Vector3} options.normal 旋转平面法线（世界坐标，指向屏幕可用右手定则判断正负）
	 * @param {THREE.Vector3} options.start_dir 起始方向（世界坐标，需在旋转平面内）
	 * @param {THREE.Vector3} options.current_dir 当前方向（世界坐标，需在旋转平面内）
	 * @param {number} options.radius 扇形半径（世界单位）
	 */
	update({origin, normal, start_dir, current_dir, radius}) {
		// 基向量：局部 X 轴对齐起始方向，局部 Z 轴对齐旋转平面法线
		let z = normal.clone().normalize();
		let x = start_dir.clone().projectOnPlane(z);
		if (x.lengthSq() < 1e-8 || !(radius > 0)) {
			this.hide();
			return;
		}
		x.normalize();
		let y = new THREE.Vector3().crossVectors(z, x);

		this.group.position.copy(origin);
		this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
		this.group.scale.setScalar(radius);

		// 扫过的角度（局部 XY 平面内的有符号角）
		let current = current_dir.clone().projectOnPlane(z);
		if (current.lengthSq() < 1e-8) {
			this.hide();
			return;
		}
		current.normalize();
		let sweep = Math.atan2(current.dot(y), current.dot(x));

		// 当前方向半径
		let end_positions = this.current_line.geometry.attributes.position;
		end_positions.setXYZ(1, Math.cos(sweep), Math.sin(sweep), 0);
		end_positions.needsUpdate = true;
		this.current_line.computeLineDistances();

		// 扇面顶点
		let index = 0;
		this.fill_positions[index++] = 0;
		this.fill_positions[index++] = 0;
		this.fill_positions[index++] = 0;
		for (let i = 0; i <= this.segments; i++) {
			let angle = sweep * i / this.segments;
			this.fill_positions[index++] = Math.cos(angle);
			this.fill_positions[index++] = Math.sin(angle);
			this.fill_positions[index++] = 0;
		}
		let fill_attribute = this.fill.geometry.attributes.position;
		fill_attribute.needsUpdate = true;

		this.group.visible = true;
	}
}
