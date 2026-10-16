// 社区版 #137：分辨率转换
// 贴图内容不变，按倍数缩放：贴图分辨率参数（texture_width/height）、所有方块的位移/尺寸/UV、
// 组枢轴、动画的位移关键帧。箱型 UV 方块先转逐面（faces[*].uv 已由 Canvas.updateUV 写好箱型布局坐标，
// 直接翻转 box_uv 标志即可保留原映射），UV 保留一位小数避免 15/2=7.5 丢像素。
(function() {

	function roundTo(value, decimals) {
		let m = Math.pow(10, decimals);
		return Math.round(value * m) / m;
	}

	// 缩放单个关键帧值：纯数字直接乘；molang 表达式整体括起来乘
	function scaleKeyframeValue(value, factor) {
		if (typeof value == 'number') return roundTo(value * factor, 4);
		if (typeof value != 'string' || !value.trim()) return value;
		let trimmed = value.trim();
		if (!isNaN(Number(trimmed))) return roundTo(parseFloat(trimmed) * factor, 4);
		return `(${trimmed}) * ${factor}`;
	}

	function convertResolution(factor) {
		// 旧版基岩格式强制箱型 UV，无法逐面转换 → 整体中止，不做半成品
		if (Cube.all.find(cube => cube.box_uv) && Format.box_uv && !Format.optional_box_uv) {
			Blockbench.showQuickMessage(tl('message.convert_resolution.box_uv_format'));
			return;
		}

		let aspects = {
			elements: Cube.all.slice(),
			groups: Group.all.slice(),
			uv_mode: true,
		};
		if (Animation.all.length) aspects.animations = Animation.all.slice();
		Undo.initEdit(aspects);

		// 方块：转逐面 + 缩放几何与 UV
		for (let cube of Cube.all) {
			if (cube.box_uv) {
				cube.preview_controller.updateUV(cube); // 刷新 faces[*].uv 为箱型布局坐标
				cube.box_uv = false;
			}
			for (let axis = 0; axis < 3; axis++) {
				cube.from[axis] = roundTo(cube.from[axis] * factor, 4);
				cube.to[axis] = roundTo(cube.to[axis] * factor, 4);
				cube.origin[axis] = roundTo(cube.origin[axis] * factor, 4);
			}
			if (typeof cube.inflate == 'number' && cube.inflate) {
				cube.inflate = roundTo(cube.inflate * factor, 4);
			}
			for (let fkey in cube.faces) {
				let uv = cube.faces[fkey].uv;
				for (let i = 0; i < 4; i++) uv[i] = roundTo(uv[i] * factor, 1);
			}
		}

		// 组枢轴
		for (let group of Group.all) {
			for (let axis = 0; axis < 3; axis++) {
				group.origin[axis] = roundTo(group.origin[axis] * factor, 4);
			}
		}

		// 贴图分辨率参数
		Project.texture_width = Math.max(1, Math.round(Project.texture_width * factor));
		Project.texture_height = Math.max(1, Math.round(Project.texture_height * factor));

		// 动画位移帧（仅 position 通道；旋转/缩放与分辨率无关）
		for (let animation of Animation.all) {
			for (let uuid in animation.animators) {
				let animator = animation.animators[uuid];
				if (!(animator instanceof BoneAnimator)) continue;
				for (let kf of animator.position || []) {
					for (let data_point of kf.data_points) {
						for (let axis of ['x', 'y', 'z']) {
							data_point[axis] = scaleKeyframeValue(data_point[axis], factor);
						}
					}
				}
			}
		}

		Undo.finishEdit('Convert resolution', aspects);
		Canvas.updateAll();
		if (Modes.animate) Animator.preview();
		Blockbench.showQuickMessage(tl('message.convert_resolution.done', [factor]));
	}

	new Action('convert_resolution', {
		icon: 'photo_size_select_large',
		category: 'file',
		condition: () => !!Project,
		click() {
			let form = {
				text: {type: 'info', text: tl('dialog.convert_resolution.text')},
				factor: {
					label: 'dialog.convert_resolution.factor',
					type: 'number',
					value: 2,
					min: 0.01,
					step: 0.5,
				},
			};
			if (Mesh.all.length) {
				form.mesh_warning = {type: 'info', text: tl('dialog.convert_resolution.mesh_warning')};
			}
			let dialog = new Dialog({
				id: 'convert_resolution',
				title: 'dialog.convert_resolution.title',
				width: 480,
				form,
				onConfirm(result) {
					let factor = parseFloat(result.factor);
					if (!(factor > 0)) return;
					convertResolution(factor);
				}
			});
			dialog.show();
		}
	});
})();
