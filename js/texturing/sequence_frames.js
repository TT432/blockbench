import { Filesystem } from "../file_system";

// 反馈 #92/#94：序列帧导入
// 从序列帧贴图（竖条/横条，文件或剪贴板）或多方块模型生成嵌套帧组结构：
// 根组 `<组名>1` → 中间组 `<组名>-1` → 每帧一个子组 `<组名>-<帧号>-1`（各含一个方块），
// UV 自动排布到目标贴图的空闲区域。

const FACE_KEYS = ['up', 'down', 'north', 'south', 'east', 'west'];

function loadImage(source) {
	return new Promise((resolve, reject) => {
		let img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));
		img.src = source;
	});
}

function normalizeRect(uv) {
	return [
		Math.min(uv[0], uv[2]),
		Math.min(uv[1], uv[3]),
		Math.max(uv[0], uv[2]),
		Math.max(uv[1], uv[3]),
	];
}

// 统计目标贴图上已被各元素面占用的 UV 格（参照 texture_generator 追加模板的做法）
function buildOccupancyMap(texture) {
	let fill_map = {};
	Outliner.elements.forEach(element => {
		if (!element.faces) return;
		for (let fkey in element.faces) {
			let face = element.faces[fkey];
			if (face.getTexture() !== texture) continue;
			let rect = face.getBoundingRect();
			let face_matrix = face instanceof MeshFace ? face.getOccupationMatrix(false) : null;
			for (let x = Math.floor(rect.ax); x < Math.ceil(rect.bx); x++) {
				if (face_matrix && !face_matrix[x]) continue;
				for (let y = Math.floor(rect.ay); y < Math.ceil(rect.by); y++) {
					if (face_matrix && !face_matrix[x][y]) continue;
					if (!fill_map[x]) fill_map[x] = {};
					fill_map[x][y] = true;
				}
			}
		}
	});
	return fill_map;
}

// 在 fill_map 中沿对角线扫描 w×h 的空闲位置，找到即占位并返回 [x, y]
function placeRect(fill_map, width, height, max_x, max_y) {
	width = Math.max(1, Math.ceil(width));
	height = Math.max(1, Math.ceil(height));
	function fits(x, y) {
		if (x + width > max_x || y + height > max_y) return false;
		for (let ix = x; ix < x + width; ix++) {
			for (let iy = y; iy < y + height; iy++) {
				if (fill_map[ix] && fill_map[ix][iy]) return false;
			}
		}
		return true;
	}
	function occupy(x, y) {
		for (let ix = x; ix < x + width; ix++) {
			if (!fill_map[ix]) fill_map[ix] = {};
			for (let iy = y; iy < y + height; iy++) {
				fill_map[ix][iy] = true;
			}
		}
		return [x, y];
	}
	for (let line = 0; line < 2e3; line++) {
		for (let space = 0; space <= line; space++) {
			if (fits(space, line)) return occupy(space, line);
			if (space != line && fits(line, space)) return occupy(line, space);
		}
	}
	return null;
}

// 在目标贴图画布上绘制（调用方需已 Undo.initEdit 并处理 bitmap 快照）
function paintOnTexture(texture, draw) {
	if (!texture.internal) texture.convertToInternal();
	let {canvas, ctx} = texture.getActiveCanvas();
	ctx.imageSmoothingEnabled = false;
	draw(ctx, canvas);
	texture.updateChangesAfterEdit();
}

function computeStripDefaults(img, direction) {
	if (!img) return {frame_width: 16, frame_height: 16, frame_count: 1};
	if (direction == 'horizontal') {
		let fh = img.naturalHeight;
		let fw = fh;
		return {frame_width: fw, frame_height: fh, frame_count: Math.max(1, Math.floor(img.naturalWidth / fw))};
	} else {
		let fw = img.naturalWidth;
		let fh = fw;
		return {frame_width: fw, frame_height: fh, frame_count: Math.max(1, Math.floor(img.naturalHeight / fh))};
	}
}

function createFrameGroups(base_name, count, groups) {
	let root = new Group({name: base_name + '1'}).init();
	let mid = new Group({name: base_name + '-1'}).init().addTo(root);
	// addTo 只改数据层，需手动重挂 THREE 层级（约定见 outliner.js place()）
	mid.preview_controller.updateTransform(mid);
	groups.push(root, mid);
	let frame_groups = [];
	for (let i = 0; i < count; i++) {
		let frame_group = new Group({name: `${base_name}-${i + 1}-1`}).init().addTo(mid);
		frame_group.preview_controller.updateTransform(frame_group);
		groups.push(frame_group);
		frame_groups.push(frame_group);
	}
	return {root, mid, frame_groups};
}

// #92：序列帧贴图导入
function importStripFrames(form, source) {
	let img = source.image;
	let vertical = form.direction != 'horizontal';
	let fw = Math.round(form.frame_width);
	let fh = Math.round(form.frame_height);
	let count = Math.round(form.frame_count);
	let base_name = (form.group_name || '').trim() || 'frames';

	if (!(fw > 0) || !(fh > 0) || !(count > 0)) {
		Blockbench.showQuickMessage(tl('message.sequence_frames.invalid_frames'));
		return false;
	}
	if (vertical ? (fw > img.naturalWidth || fh * count > img.naturalHeight)
	             : (fh > img.naturalHeight || fw * count > img.naturalWidth)) {
		Blockbench.showQuickMessage(tl('message.sequence_frames.invalid_frames'));
		return false;
	}

	// 解析目标贴图：单贴图格式用默认贴图（没有则新建），否则按选择
	let target_texture = null;
	if (Format.single_texture) {
		target_texture = Texture.getDefault() || null;
	} else if (form.texture != 'new') {
		target_texture = Texture.all.find(t => t.uuid == form.texture) || null;
		if (!target_texture) {
			Blockbench.showQuickMessage(tl('message.sequence_frames.no_space'));
			return false;
		}
	}
	// 共享工程 UV 空间的格式：工程已有内容时保持工程 UV 尺寸，避免影响既有元素的 UV 映射
	let has_content = Texture.all.length > 0 || Outliner.elements.some(el => el.faces);
	let adjust_project_uv = !Format.per_texture_uv_size && !target_texture && !has_content;

	// 纯计算：占用图与帧 UV 位置（在 Undo.initEdit 之前完成，失败可直接退出）
	// 追加到已有贴图时图像像素 1:1 映射到贴图像素；新建贴图时贴图即图像本身
	let uv_w, uv_h, fill_map, tex_px_w, tex_px_h, frame_positions;
	if (target_texture) {
		uv_w = target_texture.getUVWidth();
		uv_h = target_texture.getUVHeight();
		tex_px_w = target_texture.width;
		tex_px_h = target_texture.display_height || target_texture.height;
		fill_map = buildOccupancyMap(target_texture);
	} else if (Format.per_texture_uv_size || adjust_project_uv) {
		uv_w = img.naturalWidth;
		uv_h = img.naturalHeight;
		tex_px_w = img.naturalWidth;
		tex_px_h = img.naturalHeight;
		fill_map = {};
	} else {
		// 共享 UV 空间且已有内容：帧 UV 按图像在工程 UV 空间中的占比计算
		uv_w = Project.texture_width;
		uv_h = Project.texture_height;
		tex_px_w = img.naturalWidth;
		tex_px_h = img.naturalHeight;
		fill_map = {};
	}
	let uv_per_px_x = uv_w / tex_px_w;
	let uv_per_px_y = uv_h / tex_px_h;
	let fw_uv = Math.max(1, Math.round(fw * uv_per_px_x));
	let fh_uv = Math.max(1, Math.round(fh * uv_per_px_y));
	frame_positions = [];
	for (let i = 0; i < count; i++) {
		let sx = vertical ? 0 : i * fw;
		let sy = vertical ? i * fh : 0;
		let pos;
		if (target_texture) {
			pos = placeRect(fill_map, fw_uv, fh_uv, uv_w, uv_h);
			if (!pos) {
				Blockbench.showQuickMessage(tl('message.sequence_frames.no_space'));
				return false;
			}
		} else {
			pos = [Math.round(sx * uv_per_px_x), Math.round(sy * uv_per_px_y)];
		}
		frame_positions.push({pos, sx, sy});
	}

	// #122：非内容面共享一个 1x1 UV，节省贴图空间；追加到已有贴图时占一个真实空闲 texel
	let blank_x = 0, blank_y = 0;
	if (target_texture) {
		let blank_pos = placeRect(fill_map, 1, 1, uv_w, uv_h);
		if (blank_pos) [blank_x, blank_y] = blank_pos;
	}

	// 开始实际修改
	let cubes = [];
	let groups = [];
	Undo.initEdit({
		elements: cubes,
		groups,
		outliner: true,
		textures: target_texture ? [target_texture] : [],
		bitmap: !!target_texture,
		uv_mode: adjust_project_uv,
	});

	let texture;
	if (target_texture) {
		// initEdit 快照会替换活跃数组内的对象，需按 uuid 重查
		texture = Texture.all.find(t => t.uuid == target_texture.uuid);
	} else {
		texture = source.file
			? new Texture({name: source.file.name}).fromFile(source.file).fillParticle()
			: new Texture({name: base_name, mode: 'bitmap', keep_size: true, folder: 'block'}).fromDataURL(source.data_url).fillParticle();
		texture.add(false, true);
		if (Format.per_texture_uv_size) {
			texture.uv_width = img.naturalWidth;
			texture.uv_height = img.naturalHeight;
		} else if (adjust_project_uv) {
			Project.texture_width = img.naturalWidth;
			Project.texture_height = img.naturalHeight;
		}
	}

	// 追加到已有贴图时，把各帧像素绘制到排布位置
	if (target_texture) {
		paintOnTexture(texture, (ctx, canvas) => {
			let px_per_uv_x = canvas.width / uv_w;
			let px_per_uv_y = canvas.height / uv_h;
			frame_positions.forEach(({pos, sx, sy}) => {
				ctx.drawImage(img, sx, sy, fw, fh,
					pos[0] * px_per_uv_x, pos[1] * px_per_uv_y,
					fw_uv * px_per_uv_x, fh_uv * px_per_uv_y);
			});
		});
	}

	let pixel_size = (Format.cube_size_limiter && !Format.integer_size) ? 16 / Math.max(fw, fh) : 1;
	// #122：块中心对齐工程原点，平躺卡片（内容在顶/底面），厚度沿 Y
	let w = fw * pixel_size, h = fh * pixel_size, t = pixel_size;
	let {frame_groups} = createFrameGroups(base_name, count, groups);
	frame_positions.forEach(({pos}, i) => {
		let [x, y] = pos;
		let blank_face = () => ({uv: [blank_x, blank_y, blank_x + 1, blank_y + 1], texture});
		let faces = {
			up:		{uv: [x, y, x + fw_uv, y + fh_uv], texture},
			down:	form.single_face ? blank_face() : {uv: [x + fw_uv, y, x, y + fh_uv], texture},
			north:	blank_face(),
			south:	blank_face(),
			east:	blank_face(),
			west:	blank_face(),
		};
		let cube = new Cube({
			name: frame_groups[i].name,
			autouv: 0,
			box_uv: false,
			from: [-w / 2, -t / 2, -h / 2],
			to: [w / 2, t / 2, h / 2],
			origin: [0, 0, 0],
			faces
		}).init();
		cube.addTo(frame_groups[i]);
		cube.preview_controller.updateTransform(cube);
		cubes.push(cube);
	});
	Outliner.selected.replace(cubes);
	Undo.finishEdit('Import sequence frames', {
		elements: cubes,
		groups,
		outliner: true,
		textures: [texture],
		bitmap: !!target_texture,
		uv_mode: adjust_project_uv,
	});
}

// #94：从模型元素提取每帧各面的 UV 矩形与像素来源
function extractFrameFaces(el, model) {
	let single_texture_uuid = (model.textures && model.textures.length == 1) ? model.textures[0].uuid : null;
	if (el.box_uv) {
		let w = el.to[0] - el.from[0];
		let h = el.to[1] - el.from[1];
		let d = el.to[2] - el.from[2];
		let [u, v] = el.uv_offset || [0, 0];
		// 标准 Box UV 模板布局
		let rects = {
			up:		[u + d, v, u + d + w, v + d],
			down:	[u + d + w, v, u + d + w + w, v + d],
			north:	[u + d, v + d, u + d + w, v + d + h],
			south:	[u + d + w + d + w, v + d, u + d + w + d + w + w, v + d + h],
			west:	el.mirror_uv ? [u + d + w, v + d, u + d + w + d, v + d + h] : [u, v + d, u + d, v + d + h],
			east:	el.mirror_uv ? [u, v + d, u + d, v + d + h] : [u + d + w, v + d, u + d + w + d, v + d + h],
		};
		return FACE_KEYS.map(fkey => ({
			fkey,
			uv_rect: rects[fkey],
			tex_uuid: single_texture_uuid,
			rotation: 0,
			enabled: true,
		}));
	}
	let result = [];
	for (let fkey of FACE_KEYS) {
		let face = (el.faces || {})[fkey];
		if (!face || !(face.uv instanceof Array)) continue;
		// bbmodel 中 face.texture 可能是贴图下标（数字）或 uuid（字符串）
		let tex_uuid = null;
		if (typeof face.texture == 'string') {
			tex_uuid = face.texture;
		} else if (typeof face.texture == 'number' && model.textures && model.textures[face.texture]) {
			tex_uuid = model.textures[face.texture].uuid;
		}
		result.push({
			fkey,
			uv_rect: normalizeRect(face.uv),
			tex_uuid,
			rotation: face.rotation || 0,
			enabled: face.enabled !== false,
		});
	}
	return result;
}

// 从来源贴图裁出某面的像素，返回小画布（无来源像素时返回 null）
function extractFacePixels(face_info, source_textures) {
	if (!face_info.tex_uuid) return null;
	let entry = source_textures[face_info.tex_uuid];
	if (!entry) return null;
	let [ax, ay, bx, by] = face_info.uv_rect;
	let scale_x = entry.canvas.width / entry.uv_w;
	let scale_y = entry.canvas.height / entry.uv_h;
	let sx = Math.round(ax * scale_x), sy = Math.round(ay * scale_y);
	let sw = Math.round((bx - ax) * scale_x), sh = Math.round((by - ay) * scale_y);
	if (sw <= 0 || sh <= 0) return null;
	let canvas = document.createElement('canvas');
	canvas.width = sw;
	canvas.height = sh;
	let ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(entry.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
	return canvas;
}

// #94：模型帧导入（每个方块视为一帧）
function importModelFrames(form, model, source_textures) {
	let elements = (model.elements || []).filter(el => (!el.type || el.type == 'cube') && el.from && el.to);
	if (!elements.length) {
		Blockbench.showQuickMessage(tl('message.sequence_frames.no_cubes'));
		return;
	}
	// 反馈#123：模型模式的帧数设置——每个方块一帧，限制只取前 N 个方块
	let frame_limit = Math.floor(form.frame_limit) || 0;
	if (frame_limit > 0 && elements.length > frame_limit) {
		elements = elements.slice(0, frame_limit);
	}
	// 反馈#123：无限制且数量异常大时先确认，避免误选普通模型后一次创建上千个帧组
	if (elements.length > 200 && !form._frames_confirmed) {
		Blockbench.showMessageBox({
			title: tl('dialog.sequence_frames.title'),
			message: tl('message.sequence_frames.too_many_frames', [elements.length]),
			icon: 'warning',
			buttons: ['dialog.confirm', 'dialog.cancel'],
		}, button => {
			if (button === 0) {
				importModelFrames(Object.assign({}, form, {_frames_confirmed: true}), model, source_textures);
			}
		});
		return;
	}
	let base_name = (form.group_name || '').trim() || 'frames';
	let copy_first = form.uv_mode != 'blank';

	let frames = elements.map(el => ({el, faces: extractFrameFaces(el, model)}));
	// 首帧各面的像素内容（copy_first 时复制到所有帧）
	let first_face_canvases = {};
	if (copy_first && frames[0]) {
		frames[0].faces.forEach(face_info => {
			first_face_canvases[face_info.fkey] = extractFacePixels(face_info, source_textures);
		});
	}

	// 解析目标贴图：单贴图格式用默认贴图（没有则新建），否则按选择
	let target_texture = null;
	if (Format.single_texture) {
		target_texture = Texture.getDefault() || null;
	} else if (form.texture != 'new') {
		target_texture = Texture.all.find(t => t.uuid == form.texture) || null;
		if (!target_texture) {
			Blockbench.showQuickMessage(tl('message.sequence_frames.no_space'));
			return;
		}
	}
	// 共享工程 UV 空间的格式：工程已有内容时保持工程 UV 尺寸，避免影响既有元素的 UV 映射
	let has_content = Texture.all.length > 0 || Outliner.elements.some(el => el.faces);
	let adjust_project_uv = !Format.per_texture_uv_size && !target_texture && !has_content;

	// 纯计算：排布所有帧的所有面
	let fill_map, uv_w, uv_h, extent_x = 0, extent_y = 0;
	if (target_texture) {
		uv_w = target_texture.getUVWidth();
		uv_h = target_texture.getUVHeight();
		fill_map = buildOccupancyMap(target_texture);
	} else if (Format.per_texture_uv_size || adjust_project_uv) {
		uv_w = 16384;
		uv_h = 16384;
		fill_map = {};
	} else {
		// 共享 UV 空间且已有内容：新贴图沿用工程 UV 尺寸
		uv_w = Project.texture_width;
		uv_h = Project.texture_height;
		fill_map = {};
	}
	for (let frame of frames) {
		for (let face_info of frame.faces) {
			let w = Math.max(1, Math.ceil(face_info.uv_rect[2] - face_info.uv_rect[0]));
			let h = Math.max(1, Math.ceil(face_info.uv_rect[3] - face_info.uv_rect[1]));
			let pos = placeRect(fill_map, w, h, uv_w, uv_h);
			if (!pos) {
				Blockbench.showQuickMessage(tl('message.sequence_frames.no_space'));
				return;
			}
			face_info.width = w;
			face_info.height = h;
			face_info.pos = pos;
			extent_x = Math.max(extent_x, pos[0] + w);
			extent_y = Math.max(extent_y, pos[1] + h);
		}
	}

	let cubes = [];
	let groups = [];
	Undo.initEdit({
		elements: cubes,
		groups,
		outliner: true,
		textures: target_texture ? [target_texture] : [],
		bitmap: !!target_texture,
		uv_mode: adjust_project_uv,
	});

	let texture;
	if (target_texture) {
		// initEdit 快照会替换活跃数组内的对象，需按 uuid 重查
		texture = Texture.all.find(t => t.uuid == target_texture.uuid);
		if (copy_first) {
			paintOnTexture(texture, (ctx, canvas) => {
				let r_x = canvas.width / uv_w;
				let r_y = canvas.height / uv_h;
				frames.forEach(frame => {
					frame.faces.forEach(face_info => {
						let src = first_face_canvases[face_info.fkey];
						if (!src || !face_info.pos) return;
						ctx.drawImage(src, 0, 0, src.width, src.height,
							face_info.pos[0] * r_x, face_info.pos[1] * r_y,
							face_info.width * r_x, face_info.height * r_y);
					});
				});
			});
		}
	} else {
		// 新建贴图：先组好画布再创建，避免异步加载竞争
		let tex_w, tex_h;
		if (Format.per_texture_uv_size || adjust_project_uv) {
			tex_w = Math.max(16, Math.ceil(extent_x / 16) * 16);
			tex_h = Math.max(16, Math.ceil(extent_y / 16) * 16);
		} else {
			tex_w = Project.texture_width;
			tex_h = Project.texture_height;
		}
		let canvas = document.createElement('canvas');
		canvas.width = tex_w;
		canvas.height = tex_h;
		let ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = false;
		if (copy_first) {
			frames.forEach(frame => {
				frame.faces.forEach(face_info => {
					let src = first_face_canvases[face_info.fkey];
					if (!src || !face_info.pos) return;
					ctx.drawImage(src, 0, 0, src.width, src.height,
						face_info.pos[0], face_info.pos[1], face_info.width, face_info.height);
				});
			});
		}
		texture = new Texture({
			mode: 'bitmap',
			keep_size: true,
			name: base_name,
			folder: 'block',
		}).fromDataURL(canvas.toDataURL('image/png', 1)).fillParticle();
		texture.add(false, true);
		if (Format.per_texture_uv_size) {
			texture.uv_width = tex_w;
			texture.uv_height = tex_h;
		} else if (adjust_project_uv) {
			Project.texture_width = tex_w;
			Project.texture_height = tex_h;
		}
	}

	let {frame_groups} = createFrameGroups(base_name, frames.length, groups);
	frames.forEach((frame, i) => {
		let faces_data = {};
		frame.faces.forEach(face_info => {
			if (!face_info.pos) return;
			let data = {
				uv: [face_info.pos[0], face_info.pos[1], face_info.pos[0] + face_info.width, face_info.pos[1] + face_info.height],
				texture,
				rotation: face_info.rotation,
			};
			if (face_info.enabled === false) data.enabled = false;
			faces_data[face_info.fkey] = data;
		});
		// 退化面（零尺寸）不设贴图，避免占用默认 UV
		for (let fkey of FACE_KEYS) {
			if (!faces_data[fkey]) faces_data[fkey] = {uv: [0, 0, 0, 0], texture: null};
		}
		let cube = new Cube({
			name: frame.el.name || frame_groups[i].name,
			autouv: 0,
			box_uv: false,
			from: frame.el.from.slice(),
			to: frame.el.to.slice(),
			rotation: (frame.el.rotation || [0, 0, 0]).slice(),
			origin: (frame.el.origin || [0, 0, 0]).slice(),
			faces: faces_data
		}).init();
		cube.addTo(frame_groups[i]);
		cube.preview_controller.updateTransform(cube);
		cubes.push(cube);
	});
	Outliner.selected.replace(cubes);
	Undo.finishEdit('Import model frames', {
		elements: cubes,
		groups,
		outliner: true,
		textures: [texture],
		bitmap: !!target_texture,
		uv_mode: adjust_project_uv,
	});
}

function prepareModelImport(form, model) {
	let sources = (model.textures || []).filter(t => t && typeof t.source == 'string' && t.source.startsWith('data:'));
	Promise.all(sources.map(t => {
		return loadImage(t.source).then(img => {
			let canvas = document.createElement('canvas');
			canvas.width = img.naturalWidth;
			canvas.height = img.naturalHeight;
			canvas.getContext('2d').drawImage(img, 0, 0);
			return {uuid: t.uuid, canvas, uv_w: t.uv_width || img.naturalWidth, uv_h: t.uv_height || img.naturalHeight};
		}).catch(() => null);
	})).then(entries => {
		let source_textures = {};
		entries.forEach(entry => {
			if (entry) source_textures[entry.uuid] = entry;
		});
		importModelFrames(form, model, source_textures);
	});
}

function runModelImport(form, preset_model) {
	if (preset_model) {
		prepareModelImport(form, preset_model);
		return;
	}
	if (form.model_source == 'file') {
		Blockbench.import({
			resource_id: 'model',
			extensions: ['bbmodel'],
			type: 'Blockbench Project',
		}, function(files) {
			if (!files || !files[0]) return;
			let model = autoParseJSON(files[0].content);
			if (!model) return;
			prepareModelImport(form, model);
		});
		return;
	}
	let project = ModelProject.all.find(p => p.uuid == form.model_source);
	if (!project) {
		Blockbench.showQuickMessage(tl('message.sequence_frames.no_project'));
		return;
	}
	let current_project = Project;
	project.select();
	let model = JSON.parse(Codecs.project.compile());
	current_project.select();
	prepareModelImport(form, model);
}

let current_dialog = null;

function openDialog(source) {
	if (current_dialog && current_dialog.object) current_dialog.object.remove();
	let img = source ? source.image : null;
	let preset_model = source ? source.preset_model : null;

	let texture_options = {new: 'dialog.sequence_frames.texture.new'};
	Texture.all.forEach(t => {
		texture_options[t.uuid] = t.name;
	});
	let model_options = {file: 'dialog.sequence_frames.model_source.file'};
	ModelProject.all.forEach(p => {
		if (p != Project) model_options[p.uuid] = p.getDisplayName();
	});

	let defaults = computeStripDefaults(img, 'vertical');
	let last_direction = 'vertical';
	let default_name = (source && source.default_name) || (source && source.file ? source.file.name.replace(/\.[^.]+$/, '') : 'frames');

	let dialog = new Dialog({
		id: 'sequence_frames_import',
		title: 'dialog.sequence_frames.title',
		buttons: ['dialog.confirm', 'dialog.cancel'],
		width: 520,
		form: {
			mode: {
				label: 'dialog.sequence_frames.mode',
				type: 'inline_select',
				options: {
					strip: 'dialog.sequence_frames.mode.strip',
					model: 'dialog.sequence_frames.mode.model',
				},
				value: preset_model ? 'model' : 'strip',
				condition: () => !preset_model || !!img,
			},
			direction: {
				label: 'dialog.sequence_frames.direction',
				type: 'select',
				options: {
					vertical: 'dialog.sequence_frames.direction.vertical',
					horizontal: 'dialog.sequence_frames.direction.horizontal',
				},
				value: 'vertical',
				condition: (form) => form.mode == 'strip' && !!img,
			},
			frame_width: {
				label: 'dialog.sequence_frames.frame_width',
				type: 'number',
				value: defaults.frame_width,
				min: 1,
				condition: (form) => form.mode == 'strip' && !!img,
			},
			frame_height: {
				label: 'dialog.sequence_frames.frame_height',
				type: 'number',
				value: defaults.frame_height,
				min: 1,
				condition: (form) => form.mode == 'strip' && !!img,
			},
			frame_count: {
				label: 'dialog.sequence_frames.frame_count',
				type: 'number',
				value: defaults.frame_count,
				min: 1,
				condition: (form) => form.mode == 'strip' && !!img,
			},
			single_face: {
				label: 'dialog.sequence_frames.single_face',
				type: 'checkbox',
				value: false,
				condition: (form) => form.mode == 'strip' && !!img,
			},
			model_source: {
				label: 'dialog.sequence_frames.model_source',
				type: 'select',
				options: model_options,
				condition: (form) => form.mode == 'model' && !preset_model,
			},
			frame_limit: {
				label: 'dialog.sequence_frames.frame_limit',
				type: 'number',
				value: 0,
				min: 0,
				condition: (form) => form.mode == 'model',
			},
			uv_mode: {
				label: 'dialog.sequence_frames.uv_mode',
				type: 'select',
				options: {
					copy_first: 'dialog.sequence_frames.uv_mode.copy_first',
					blank: 'dialog.sequence_frames.uv_mode.blank',
				},
				value: 'copy_first',
				condition: (form) => form.mode == 'model',
			},
			texture: {
				label: 'dialog.sequence_frames.texture',
				type: 'select',
				options: texture_options,
				value: (Texture.selected && texture_options[Texture.selected.uuid]) ? Texture.selected.uuid : 'new',
				condition: () => !Format.single_texture,
			},
			group_name: {
				label: 'dialog.sequence_frames.group_name',
				value: default_name,
			},
		},
		onFormChange(form) {
			if (img && form.mode == 'strip' && form.direction != last_direction) {
				last_direction = form.direction;
				let d = computeStripDefaults(img, form.direction);
				dialog.setFormValues({
					frame_width: d.frame_width,
					frame_height: d.frame_height,
					frame_count: d.frame_count,
				});
			}
		},
		onConfirm(form) {
			if (form.mode == 'model' || (preset_model && !img)) {
				runModelImport(form, preset_model);
				return;
			}
			if (!img) return false;
			return importStripFrames(form, source);
		}
	});
	current_dialog = dialog;
	dialog.show();
}

function readClipboardImage(callback) {
	if (isApp) {
		let image = clipboard.readImage();
		if (!image || image.isEmpty()) {
			Blockbench.showQuickMessage(tl('message.sequence_frames.no_clipboard_image'));
			return;
		}
		callback(image.toDataURL());
	} else {
		navigator.clipboard.read().then(content => {
			let item = content && content[0];
			let type = item && item.types && item.types.find(t => t.startsWith('image/'));
			if (!type) {
				Blockbench.showQuickMessage(tl('message.sequence_frames.no_clipboard_image'));
				return;
			}
			item.getType(type).then(blob => {
				let reader = new FileReader();
				reader.onload = () => callback(reader.result);
				reader.onerror = () => Blockbench.showQuickMessage(tl('message.sequence_frames.no_clipboard_image'));
				reader.readAsDataURL(blob);
			});
		}).catch(() => {
			Blockbench.showQuickMessage(tl('message.sequence_frames.no_clipboard_image'));
		});
	}
}

BARS.defineActions(function() {
	let condition = () => (Project && Format.edit_mode !== false && (!Project.box_uv || Format.optional_box_uv));
	new Action('import_sequence_frames', {
		icon: 'movie',
		category: 'file',
		condition,
		click() {
			Blockbench.import({
				resource_id: 'texture',
				readtype: (file) => (typeof file == 'string' && file.endsWith('.bbmodel')) ? 'text' : 'image',
				type: tl('dialog.sequence_frames.title'),
				extensions: Texture.getAllExtensions().concat(['bbmodel']),
			}, function(files) {
				let file = files && files[0];
				if (!file) return;
				if (file.name.endsWith('.bbmodel')) {
					let model = autoParseJSON(file.content);
					if (!model) return;
					openDialog({preset_model: model, default_name: file.name.replace(/\.[^.]+$/, '')});
					return;
				}
				loadImage(Filesystem.getImageSource(file)).then(img => {
					openDialog({image: img, file});
				}).catch(() => {
					Blockbench.showQuickMessage(tl('message.sequence_frames.invalid_image'));
				});
			})
		}
	})
	new Action('import_sequence_frames_clipboard', {
		icon: 'content_paste',
		category: 'file',
		condition,
		click() {
			readClipboardImage(data_url => {
				loadImage(data_url).then(img => {
					openDialog({image: img, data_url});
				}).catch(() => {
					Blockbench.showQuickMessage(tl('message.sequence_frames.invalid_image'));
				});
			});
		}
	})
})
