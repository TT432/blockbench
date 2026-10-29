import { AutoBackup } from "../auto_backup";
import { changeImageEditor } from "../desktop";
import { currentwindow } from "../native_apis";
import { Setting, Settings, SettingsProfile } from "./settings";
import { addStartScreenSection } from "./start_screen";

function setupSettings() {
	if (localStorage.getItem('settings') != null) {
		Settings.stored = JSON.parse(localStorage.getItem('settings'));
	}
	
	//General
	new Setting('language', {value: 'en', type: 'select', requires_restart: true, options: Language.options});
	new Setting('username', {value: '', type: 'text'});
	new Setting('streamer_mode', {value: false, onChange() {
		StartScreen.vue._data.redact_names = settings.streamer_mode.value;
		Interface.status_bar.vue.$data.streamer_mode = settings.streamer_mode.value;
		updateStreamerModeNotification();
	}});
	new Setting('classroom_mode', {value: false, requires_restart: true});
	new Setting('cdn_mirror', {value: false});
	new Setting('recovery_save_interval', {value: 30, type: 'number', min: 0, onChange() {
		clearTimeout(AutoBackup.loop_timeout);
		AutoBackup.backupProjectLoop(false);
	}});

	//Interface
	new Setting('interface_mode', 		{category: 'interface', value: 'auto', requires_restart: true, type: 'select', options: {
		'auto': tl('settings.interface_mode.auto'),
		'desktop': tl('settings.interface_mode.desktop'),
		'mobile': tl('settings.interface_mode.mobile'),
	}});
	new Setting('interface_scale', 		{category: 'interface', value: 100, min: 40, max: 200, type: 'number', condition: isApp, onChange() {
		var factor = Math.clamp(settings.interface_scale.value, 40, 200) / 100;
		currentwindow.webContents.setZoomFactor(factor)
		resizeWindow()
	}});
	new Setting('hide_tab_bar', 		{category: 'interface', value: Blockbench.isMobile, onChange() {
		updateTabBarVisibility();
	}});
	new Setting('mobile_panel_side',	{category: 'interface', value: 'right', condition: Blockbench.isMobile, type: 'select', options: {
		'right': tl('generic.right'),
		'left': tl('generic.left'),
	}, onChange() {
		document.body.classList.toggle('mobile_sidebar_left', settings.mobile_panel_side.value == 'left');
	}});
	new Setting('status_bar_modifier_keys', {category: 'interface', value: true, condition: !Blockbench.isTouch, onChange(value) {
		Interface.status_bar.vue.show_modifier_keys = value;
	}});
	new Setting('status_bar_transform_sliders', {category: 'interface', value: true, condition: Blockbench.isTouch, onChange(value) {
		updateInterface();
	}});
	new Setting('always_show_splash_art',{category: 'interface', value: true});
	new Setting('origin_size',  		{category: 'interface', value: 10, type: 'number', min: 2, max: 40});
	new Setting('control_size',  		{category: 'interface', value: 10, type: 'number', min: 2, max: 40});
	new Setting('motion_trails',  		{category: 'interface', value: true, onChange() {
		if (Animator.open) {
			Canvas.scene[this.value ? 'add' : 'remove'](Animator.motion_trail);
			Animator.showMotionTrail(null, true);
			Animator.preview();
		}
	}});
	new Setting('seethrough_outline', 	{category: 'interface', value: false, onChange(value) {
		Canvas.outlineMaterial.depthTest = !value;
		Canvas.meshOutlineMaterial.depthTest = !value;
	}});
	new Setting('outliner_colors', 		{category: 'interface', value: true});
	new Setting('preview_checkerboard',	{category: 'interface', value: true, onChange() {
		$('#center').toggleClass('checkerboard', settings.preview_checkerboard.value);
	}});
	new Setting('uv_checkerboard', 		{category: 'interface', value: true, onChange(val) {
		UVEditor.vue.checkerboard = val;
	}});
	new Setting('display_uv', 			{category: 'interface', value: 'selected_elements', type: 'select', options: {
		selected_faces: 'settings.display_uv.selected_faces',
		selected_elements: 'settings.display_uv.selected_elements',
		all_elements: 'settings.display_uv.all_elements',
	}, onChange(value) {
		BarItems.edit_mode_uv_overlay.value = value == 'all_elements';
		BarItems.edit_mode_uv_overlay.updateEnabledState();
	}});
	new Setting('timecode_frame_number',{category: 'interface', value: false, onChange() {
		Timeline.vue.updateTimecodes();
	}});
	new Setting('only_selected_bezier_handles',{category: 'interface', value: false, onChange(val) {
		Timeline.vue.show_all_handles = !val;
	}});
	new Setting('autocomplete_code',	{category: 'interface', value: true});
	
	//Preview 
	new Setting('brightness',  		{category: 'preview', value: 50, type: 'number', min: 0, max: 400, onChange() {
		Canvas.updateShading();
	}});
	new Setting('shading', 	  		{category: 'preview', value: true, onChange() {
		Canvas.updateShading()
	}});
	new Setting('antialiasing', 	{category: 'preview', value: true, requires_restart: true});
	new Setting('antialiasing_bleed_fix', 	{category: 'preview', value: true, requires_restart: true});
	new Setting('fov', 		  		{category: 'preview', value: 45, type: 'number', min: 1, max: 120, onChange(val) {
		Preview.all.forEach(preview => preview.setFOV(val));
	}});
	new Setting('camera_near_plane',{category: 'preview', value: 1, type: 'number', min: 0.01, max: 100, onChange(val) {
		Preview.all.forEach(preview => {
			preview.camPers.near = val;
			preview.camPers.updateProjectionMatrix();
		});
	}});
	new Setting('maximum_zoom_distance',{category: 'preview', value: 4000, type: 'number', min: 16, onChange(val) {
		Preview.all.forEach(preview => preview.controls.maxDistance = val);
	}});
	new Setting('render_sides', 			{category: 'preview', value: 'auto', type: 'select', options: {
		'auto': tl('settings.render_sides.auto'),
		'front': tl('settings.render_sides.front'),
		'double': tl('settings.render_sides.double'),
	}, onChange() {
		Canvas.updateRenderSides();
	}});
	// #117：负尺寸块（from>to）始终按「外面」渲染，普通块仍跟随渲染面设置
	new Setting('negative_size_front_faces', {category: 'preview', value: false, onChange() {
		if (typeof Canvas !== 'undefined') Canvas.updateAllFaces();
	}});
	new Setting('constant_outlines', 		{category: 'preview', value: false, onChange() { updateSelection() }});
	new Setting('tone_mapping', 			{category: 'preview', value: 'none', type: 'select', options: {
		none: tl('generic.none'),
		linear: 'Linear',
		reinhard: 'Reinhard',
		cineon: 'Cineon',
		aces_filmic: 'ACES Filmic',
		// agx: 'AgX',
		// neutral: 'Neutral',
	}, onChange() {
		for (let preview of Preview.all) {
			preview.updateToneMapping();
		}
		Canvas.updateShading();
		for (let model of PreviewModel.getActiveModels()) {
			model.material.needsUpdate = true;
		}
	}});
	new Setting('fps_limit',						{category: 'preview', value: 144, min: 10, max: 1024, type: 'number'});
	new Setting('background_rendering', 			{category: 'preview', value: true});
	new Setting('flipbook_textures_in_animation',	{category: 'preview', value: true});
	new Setting('particle_tick_rate',				{category: 'preview', value: 30, type: 'number', min: 1, max: 1000, onChange() {
		WinterskyScene.global_options.tick_rate = this.value;
	}});
	new Setting('volume', 							{category: 'preview', value: 80, min: 0, max: 200, type: 'number'});
	new Setting('audio_scrubbing',					{category: 'preview', value: true});
	new Setting('save_view_per_tab',				{category: 'preview', value: true});
	new Setting('display_skin',						{category: 'preview', value: false, type: 'click', icon: 'icon-player', click: function() { changeDisplaySkin() }});

	new Setting('viewport_rotate_speed',	{category: 'controls', value: 100, min: 10, max: 1000, type: 'number', onChange(value) {
		Preview.all.forEach(viewport => viewport.controls.rotateSpeed = value / 100)
	}});
	new Setting('viewport_zoom_speed',		{category: 'controls', value: 100, min: 10, max: 1000, type: 'number', onChange(value) {
		Preview.all.forEach(viewport => viewport.controls.zoomSpeed = value / 100 * 1.5)
	}});
	new Setting('editor_2d_zoom_speed',		{category: 'controls', value: 100, min: 10, max: 1000, type: 'number'});
	new Setting('gamepad_controls',			{category: 'controls', value: false});
	new Setting('double_click_switch_tools',{category: 'controls', value: true});
	new Setting('canvas_unselect',  		{category: 'controls', value: false});
	new Setting('double_click_select_reference',{category: 'controls', value: true});
	new Setting('selection_tolerance', 		{category: 'controls', value: 10, type: 'number', min: 1, max: 50});

	//Edit
	new Setting('undo_selections',			{category: 'edit', value: false});
	new Setting('undo_limit',				{category: 'edit', value: 256, type: 'number', min: 1});
	new Setting('highlight_cubes',  		{category: 'edit', value: true, onChange() {
		Canvas.updateCubeHighlights();
	}});
	new Setting('outliner_reveal_on_select', {category: 'edit', value: true})
	new Setting('allow_display_slot_mirror', {category: 'edit', value: false, onChange(value) {
		DisplayMode.vue.allow_mirroring = value;
	}})
	new Setting('local_position_values',	{category: 'edit', value: false});
	new Setting('transform_cube_from_center',{category: 'edit', value: false});
	new Setting('deactivate_size_limit',	{category: 'edit', value: false});
	new Setting('modded_entity_integer_size',{category:'edit', value: true});
	new Setting('vertex_merge_distance',	{category: 'edit', value: 0.1, step: 0.01, type: 'number', min: 0});
	new Setting('preview_paste_behavior',	{category: 'edit', value: 'always_ask', type: 'select', options: {
		'always_ask': tl('settings.preview_paste_behavior.always_ask'),
		'outliner': tl('menu.paste.outliner'),
		'face': tl('menu.paste.face'),
		'mesh_selection': tl('menu.paste.mesh_selection'),
	}});
	new Setting('stretch_linked',			{category: 'edit', value: true});
	new Setting('auto_keyframe',			{category: 'edit', value: true});
	// 社区版：复制骨骼动画时同步 molang 变量数字后缀（#136）——新旧骨骼名尾部数字不同则
	// 把复制出的关键帧里 v.xxxNN / temp.xxxNN 的两位数字后缀同步改为新骨骼的数字。默认关。
	new Setting('community_duplicate_bone_var_suffix', {category: 'edit', value: false});
	new Setting('detect_flipbook_textures',	{category: 'edit', value: true});

	//Paint
	new Setting('color_picker_style',			{category: 'paint', value: 'box', type: 'select',
		options: {
			box: 'menu.color_picker.picker_type.square',
			wheel: 'menu.color_picker.picker_type.wheel_static',
			wheel_rotate: 'menu.color_picker.picker_type.wheel',
			normal: 'menu.color_picker.picker_type.normal',
		},
		onChange(value) {
			Interface.Panels.color.vue.picker_type = value;
		}
	});
	new Setting('brush_cursor_2d',					{category: 'paint', value: true});
	new Setting('brush_cursor_3d',					{category: 'paint', value: true, onChange(value) {
		if (!value) scene.remove(Canvas.brush_outline);
	}});
	new Setting('outlines_in_paint_mode',			{category: 'paint', value: true});
	new Setting('move_with_selection_tool',			{category: 'paint', value: true});
	new Setting('pick_color_opacity',				{category: 'paint', value: false});
	new Setting('pick_combined_color',				{category: 'paint', value: false});
	new Setting('color_picker_tool_switch',			{category: 'paint', value: true});
	new Setting('paint_through_transparency',		{category: 'paint', value: true});
	new Setting('paint_side_restrict',				{category: 'paint', value: true});
	new Setting('opacity_range',					{category: 'paint', value: '255', type: 'select', options: {
		'255': '0-255',
		'100': '0-100%',
	}, onChange(value) {
		BarItems.slider_brush_opacity.update();
		BarItems.layer_opacity.update();
	}});
	new Setting('limit_brush_opacity_per_stroke',	{category: 'paint', value: true});
	new Setting('paint_with_stylus_only',			{category: 'paint', value: false});
	new Setting('brush_opacity_modifier',			{category: 'paint', value: 'none', type: 'select', options: {
		'pressure': tl('settings.brush_modifier.pressure'),
		'tilt': tl('settings.brush_modifier.tilt'),
		'none': tl('settings.brush_modifier.none'),
	}});
	new Setting('brush_size_modifier', {category: 'paint', value: 'none', type: 'select', options: {
		'pressure': tl('settings.brush_modifier.pressure'),
		'tilt': tl('settings.brush_modifier.tilt'),
		'none': tl('settings.brush_modifier.none'),
	}});
	new Setting('image_editor',  	{category: 'paint', value: false, type: 'click',
		launch_setting: true,
		condition: isApp,
		icon: 'fas.fa-pen-square',
		click: function() {changeImageEditor(null) }
	});
	
	//Grid
	new Setting('grids',				{category: 'grid', value: true, onChange() {Canvas.buildGrid()}});
	new Setting('base_grid',			{category: 'grid', value: true, onChange() {Canvas.buildGrid()}});
	new Setting('large_grid', 			{category: 'grid', value: true, onChange() {Canvas.buildGrid()}});
	new Setting('full_grid',			{category: 'grid', value: false, onChange() {Canvas.buildGrid()}});
	new Setting('large_box',			{category: 'grid', value: false, onChange() {Canvas.buildGrid()}});
	new Setting('large_grid_size',		{category: 'grid', value: 3, type: 'number', min: 0, max: 2000, onChange() {Canvas.buildGrid()}});
	//new Setting('display_grid',		{category: 'grid', value: false});
	new Setting('pixel_grid',			{category: 'grid', value: false, onChange(value) {
		Canvas.updatePixelGrid();
		UVEditor.vue.pixel_grid = value;
	}});
	new Setting('painting_grid',		{category: 'grid', value: true, onChange(value) {
		Canvas.updatePixelGrid();
		UVEditor.vue.pixel_grid = value;
	}});
	new Setting('image_editor_grid_size',{category: 'grid', type: 'number', value: 16, onChange() {
		UVEditor.vue.zoom += 0.01;
		UVEditor.vue.zoom -= 0.01;
	}});
	new Setting('ground_plane',			{category: 'grid', value: false, onChange() {
		Canvas.ground_plane.visible = this.value;
	}});
	new Setting('ground_plane_double_side',{category: 'grid', value: false, onChange() {
		Canvas.groundPlaneMaterial.side = this.value ? THREE.DoubleSide : THREE.FrontSide;
	}});
	
	//Snapping
	new Setting('edit_size',		{category: 'snapping', value: 16, type: 'number', min: 1, max: 8192, onChange() {Canvas.buildGrid()}});
	new Setting('shift_size', 		{category: 'snapping', value: 64, type: 'number', min: 1, max: 8192});
	new Setting('ctrl_size',		{category: 'snapping', value: 160, type: 'number', min: 1, max: 8192});
	new Setting('ctrl_shift_size',	{category: 'snapping', value: 640, type: 'number', min: 1, max: 8192});
	new Setting('negative_size',	{category: 'snapping', value: false});
	new Setting('nearest_rectangle_select',{category: 'snapping', value: false});
	
	//Defaults
	new Setting('default_cube_size',				{category: 'defaults', value: 2, type: 'number', min: 0, max: 32});
	new Setting('autouv',							{category: 'defaults', value: true});
	new Setting('inherit_parent_color',				{category: 'defaults', value: false});
	new Setting('create_rename', 					{category: 'defaults', value: false});
	new Setting('default_path', 					{category: 'defaults', value: false, type: 'click', condition: isApp, icon: 'burst_mode', click: function() { openDefaultTexturePath() }});
	new Setting('default_bedrock_format',			{category: 'defaults', type: 'select', value: 'entity', options: {
		entity: 'format.bedrock',
		block: 'format.bedrock_block',
	}});
	new Setting('default_java_block_version',		{category: 'defaults', type: 'select', value: 'latest', options: {
		latest: 'Latest',
		'1.21.11': '1.21.11 - 26.2',
		'1.21.6': '1.21.6 - 1.21.10',
		'1.9.0': '1.9 - 1.21.5',
	}});
	new Setting('animation_snap',					{category: 'defaults', value: 24, type: 'number'});
	new Setting('default_keyframe_interpolation',	{category: 'defaults', value: 'linear', type: 'select', options: {
		linear: 'action.keyframe_interpolation.linear',
		catmullrom: 'action.keyframe_interpolation.catmullrom',
		bezier: 'action.keyframe_interpolation.bezier',
		step: 'action.keyframe_interpolation.step',
	}});
	new Setting('uniform_keyframe',					{category: 'defaults', value: true});
	// #88：导入动画时是否自动为 molang 变量生成占位符控件（默认关，避免中间变量刷屏；手动编写的行不受影响）
	new Setting('animation_auto_variable_placeholders', {category: 'community', value: false});
	
	//Dialogs
	new Setting('new_project_dialog',		{category: 'dialogs', value: true});
	new Setting('dialog_larger_cubes', 		{category: 'dialogs', value: true, name: tl('message.model_clipping.title'), description: tl('settings.dialog.desc', [tl('message.model_clipping.title')])});
	new Setting('dialog_rotation_limit', 	{category: 'dialogs', value: true, name: tl('message.rotation_limit.title'), description: tl('settings.dialog.desc', [tl('message.rotation_limit.title')])});
	new Setting('dialog_loose_texture', 	{category: 'dialogs', value: true, name: tl('message.loose_texture.title'), description: tl('settings.dialog.desc', [tl('message.loose_texture.title')])});
	new Setting('dialog_invalid_characters',{category: 'dialogs', value: true, name: tl('message.invalid_characters.title'), description: tl('settings.dialog.desc', [tl('message.invalid_characters.title')])});
	new Setting('dialog_generated_item_model', {category: 'dialogs', value: true, name: tl('message.generated_item_model.title'), description: tl('settings.dialog.desc', [tl('message.generated_item_model.title')])});
	new Setting('dialog_save_codec',		{category: 'dialogs', value: true, name: tl('message.save_codec_selector.title'), description: tl('settings.dialog.desc', [tl('message.save_codec_selector.title')])});
	
	//Application
	new Setting('recent_projects', {category: 'application', value: 32, max: 256, min: 0, type: 'number', condition: isApp});
	new Setting('backup_interval', {category: 'application', value: 10, type: 'number', min: 0, condition: isApp});
	new Setting('backup_retain', {category: 'application', value: 30, type: 'number', min: 0, condition: isApp});
	new Setting('automatic_plugin_updates', {category: 'application', value: true, condition: isApp});
	new Setting('hardware_acceleration', {category: 'application', value: true, requires_restart: true, condition: isApp, launch_setting: true});
	new Setting('native_window_frame', {category: 'application', value: false, requires_restart: true, condition: isApp, launch_setting: true});
	
	//Export
	new Setting('json_indentation',		{category: 'export', value: 'tabs', type: 'select', options: {
		tabs: tl('settings.json_indentation.tabs'),
		spaces_4: tl('settings.json_indentation.spaces_4'),
		spaces_2: tl('settings.json_indentation.spaces_2'),
	}});
	new Setting('final_newline',		{category: 'export', value: false});
	new Setting('minifiedout',			{category: 'export', value: false});
	new Setting('export_asset_paths',	{category: 'export', condition: isApp, value: 'relative', type: 'select', options: {
		relative: tl('settings.export_asset_paths.relative'),
		absolute: tl('settings.export_asset_paths.absolute'),
		both: tl('settings.export_asset_paths.both'),
		none: tl('settings.export_asset_paths.none'),
	}});
	new Setting('embed_textures', 		{category: 'export', value: true});
	new Setting('minify_bbmodel', 		{category: 'export', value: true});
	new Setting('export_empty_groups',	{category: 'export', value: true});
	new Setting('export_groups', 		{category: 'export', value: true});
	new Setting('java_export_pivots', 	{category: 'export', value: true});
	new Setting('optifine_save_default_texture',{category: 'export', value: true});
	new Setting('obj_face_export_mode',	{category: 'export', value: 'both', type: 'select', options: {
		both: tl('settings.obj_face_export_mode.both'),
		tris: tl('settings.obj_face_export_mode.tris'),
		quads: tl('settings.obj_face_export_mode.quads'),
	}});
	new Setting('animation_sample_rate',{category: 'export', value: 24, type: 'number', min: 1, max: 640});
	new Setting('model_export_scale',	{category: 'export', value: 16, type: 'number', min: 0.0001, max: 4096});
	new Setting('sketchfab_token', 		{category: 'export', value: '', type: 'password'});
	new Setting('credit', 				{category: 'export', value: 'Made with Blockbench', type: 'text'});

	//Community（#81：社区版改原版操作的功能开关，默认开启=社区版行为，关闭=恢复上游行为）
	// 组主开关（community_group_*）：关闭整组时成员设置读取为 false（成员自身值保留，
	// 重新开组后恢复）；组 onChange 重放成员 onChange 使行为在对话框外切换时也即时生效。
	function communityGroupOnChange(group_id) {
		return function() {
			for (let id in settings) {
				let member = settings[id];
				if (member.group === group_id && typeof member.onChange === 'function') {
					member.onChange(member.value);
				}
			}
			if (Settings.dialog && Settings.dialog.content_vue) Settings.dialog.content_vue.$forceUpdate();
		};
	}

	new Setting('community_group_timeline', {category: 'community', value: true, onChange: communityGroupOnChange('community_group_timeline')});
	new Setting('community_timeline_click_seek', {category: 'community', value: true, group: 'community_group_timeline'});
	new Setting('community_timeline_double_click_keyframe', {category: 'community', value: true, group: 'community_group_timeline'});
	new Setting('community_timeline_shift_range_select', {category: 'community', value: true, group: 'community_group_timeline'});
	new Setting('community_timeline_clickthrough_playhead', {category: 'community', value: true, group: 'community_group_timeline', onChange(value) {
		document.body.classList.toggle('community_clickthrough_playhead', !!value);
	}});
	document.body.classList.toggle('community_clickthrough_playhead', !!settings.community_timeline_clickthrough_playhead.value);
	// ctrl+点击关键帧循环切换插值类型 / shift+点击删除关键帧（纯点击生效，不抢占拖拽）
	new Setting('community_keyframe_ctrl_click_interpolation', {category: 'community', value: false, group: 'community_group_timeline'});
	new Setting('community_keyframe_shift_click_delete', {category: 'community', value: false, group: 'community_group_timeline'});
	new Setting('community_keyframe_density_culling', {category: 'community', value: true, group: 'community_group_timeline', onChange() {
		if (typeof Timeline !== 'undefined' && Timeline.vue) Timeline.vue.$forceUpdate();
	}});
	new Setting('community_ruler_step_candidates', {category: 'community', value: true, group: 'community_group_timeline', onChange() {
		if (typeof Animator !== 'undefined' && Animator.open && typeof Timeline !== 'undefined' && Timeline.vue) Timeline.vue.updateTimecodes();
	}});

	new Setting('community_group_outliner', {category: 'community', value: true, onChange: communityGroupOnChange('community_group_outliner')});
	new Setting('community_animate_group_multi_select', {category: 'community', value: true, group: 'community_group_outliner'});
	// 反馈#254：锁定元素是否免疫「祖先组隐藏」。开启（默认）时，隐藏组不会连带隐藏组内被锁定的
	// 子元素——锁定语义取「完全保护」，元素自身的 visibility 标志与渲染可见性都不被祖先改写；
	// 关闭则回到上游语义（祖先隐藏优先，锁定子元素随组一起消失）。生效点见 outliner.js updateVisibility。
	new Setting('community_locked_ignore_ancestor_hide', {category: 'community', value: true, group: 'community_group_outliner', onChange() {
		if (typeof Canvas !== 'undefined') Canvas.updateVisibility();
	}});
	// 反馈#154：组隐藏固定级联到全部后代（恢复上游行为），原先的「直属限定」模式已移除。
	// #130：大纲常驻父子结构树线；关闭后回退为仅选中路径显示（#87 行为）
	new Setting('community_outliner_tree_lines', {category: 'community', value: true, group: 'community_group_outliner', onChange(value) {
		document.body.classList.toggle('community_outliner_tree_lines', !!value);
	}});
	document.body.classList.toggle('community_outliner_tree_lines', !!settings.community_outliner_tree_lines.value);

	new Setting('community_group_animations', {category: 'community', value: true, onChange: communityGroupOnChange('community_group_animations')});
	new Setting('community_animation_list_multi_select', {category: 'community', value: true, group: 'community_group_animations'});
	new Setting('community_playhead_wrap_effective_length', {category: 'community', value: true, group: 'community_group_animations'});

	new Setting('community_group_paint', {category: 'community', value: true, onChange: communityGroupOnChange('community_group_paint')});
	new Setting('community_paint_fill_multi_select', {category: 'community', value: true, group: 'community_group_paint', onChange() {
		if (typeof BARS !== 'undefined') BARS.updateConditions();
	}});
	new Setting('community_mirror_paint_block_matching', {category: 'community', value: true, group: 'community_group_paint'});
	// 反馈#163：超大选择集暂停 UV 显示的上限开关（关闭后始终显示全部 UV，大选择集可能卡顿）
	new Setting('community_paint_uv_display_cap', {category: 'community', value: true, group: 'community_group_paint', onChange() {
		if (typeof UVEditor !== 'undefined' && UVEditor.vue) UVEditor.vue.$forceUpdate();
	}});

	// 反馈#230：绘画模式按住 Alt 拖动右键调整笔刷直径（PS 风格），默认关闭。
	// 生效入口见 painter.js startBrushSizeDrag()，由 3D 视口与 UV 编辑器的 pointerdown 调用。
	new Setting('community_brush_size_rmb_drag', {category: 'community', value: false, group: 'community_group_paint'});
	// 反馈#248：上一条拖动的灵敏度（1~20，默认 10 = 原实现灵敏度（每 4px 一格）的 1/5，即每 20px 一格）。
	new Setting('community_brush_size_drag_sensitivity', {category: 'community', value: 10, type: 'number', min: 1, max: 20, step: 1, group: 'community_group_paint'});

	// 反馈#228：顶点捕捉时是否把「与其它块的相交点」也作为捕捉候选（默认关闭，保持上游行为）。
	// 开启后仅在顶点捕捉工具激活时生效，见 vertex_snap.js addIntersectionVertices()。
	// 反馈#239：定义顺序决定设置页的显示顺序，这里排在「绘画」组全部成员之后——它属于编辑/建模，
	// 夹在绘画组成员之间会被误读成绘画开关（且它并不受绘画组主开关控制）。
	new Setting('community_vertex_snap_intersections', {category: 'community', value: false, onChange() {
		if (typeof Toolbox !== 'undefined' && Toolbox.selected?.id === 'vertex_snap_tool' && typeof Vertexsnap !== 'undefined') Vertexsnap.select();
	}});

	new Setting('community_paste_with_textures', {category: 'community', value: true});
	// 反馈#193/#200：工具栏六个「旋转 X/Y/Z 轴 90°」按钮以什么为枢轴。
	// 关闭（默认，上游行为）= 居中网格格式绕世界原点、骨架构架绕首个选中组枢轴、其余绕首个选中元素枢轴；
	// 开启 = 每个被旋转的子树绕自身枢轴自转（选组绕该组枢轴、选单个方块绕该方块 origin）。
	// 旋转轴方向跟随「旋转空间」工具栏选项（全局/父级/自身，见 transform.js getRotate90Space）。
	new Setting('community_rotate_own_pivot', {category: 'community', value: false});
	new Setting('community_tab_groups', {category: 'community', value: true, onChange() {
		if (typeof Interface !== 'undefined' && Interface.tab_bar) Interface.tab_bar.$forceUpdate();
	}});

	Blockbench.onUpdateTo('5.0.0', () => {
		settings.antialiasing_bleed_fix.set(true);
	})
	// 反馈#146：这两个快捷键曾经默认开启并被写入 localStorage，仅改默认值不会迁移老配置
	// （Setting 构造优先读 Settings.stored）。升级时一次性重置为关闭，用户仍可手动再开。
	Blockbench.onUpdateTo('5.3.35', () => {
		settings.community_keyframe_ctrl_click_interpolation.set(false);
		settings.community_keyframe_shift_click_delete.set(false);
	})
	// Fail-safe
	setTimeout(() => {
		if (Preview.selected && Preview.selected.renderer.capabilities.isWebGL2 == false) {
			settings.antialiasing_bleed_fix.set(false);
			console.warn('Downgrading settings to support WebGL 1');
		}
	}, 4*1000);
}
function setupSettingsProfiles() {
	if (localStorage.getItem('settings_profiles') != null) {
		let profiles = JSON.parse(localStorage.getItem('settings_profiles'));
		profiles.forEach(profile => {
			let new_profile = new SettingsProfile(profile);
			if (profile.selected) new_profile.select(false);
		})
	}
	// 反馈#146：开关“关不掉”还有第二个来源——设置配置里的覆盖值。master 已为关，但某个
	// 激活配置仍把这两项覆盖为开，而旧界面只显示 master，于是开关看着是关的、行为仍是开的。
	// 升级到 5.3.38 时一次性清掉这两项的全部覆盖并重置为关闭（用户可再手动开启）。
	Blockbench.onUpdateTo('5.3.38', () => {
		for (let profile of SettingsProfile.all) {
			Vue.delete(profile.settings, 'community_keyframe_ctrl_click_interpolation');
			Vue.delete(profile.settings, 'community_keyframe_shift_click_delete');
		}
		settings.community_keyframe_ctrl_click_interpolation.set(false);
		settings.community_keyframe_shift_click_delete.set(false);
	})
	Settings.profile_menu_button = document.getElementById('settings_profiles_header_menu');
	Settings.profile_menu_button.addEventListener('click', event => {
		let list = [
			{
				name: 'generic.none',
				icon: SettingsProfile.selected ? 'far.fa-circle' : 'far.fa-dot-circle',
				click: () => {
					SettingsProfile.unselect();
				}
			},
			'_'
		];
		SettingsProfile.all.forEach(profile => {
			if (profile.condition.type != 'selectable') return;
			list.push({
				name: profile.name,
				icon: profile.selected ? 'far.fa-dot-circle' : 'far.fa-circle',
				color: markerColors[profile.color].standard,
				click: () => {
					profile.select();
				}
			})
		})
		new Menu(list).open(Settings.profile_menu_button);
	});
	Settings.profile_menu_button.setAttribute('title', tl('data.settings_profile'))
	Settings.updateProfileButton();
}
export function updateStreamerModeNotification() {
	$('#start_screen section#streamer_mode').detach()

	if (settings.streamer_mode.value) {
		addStartScreenSection('streamer_mode', {
			graphic: {type: 'icon', icon: 'live_tv'},
			color: 'var(--color-stream)',
			text_color: 'var(--color-light)',
			text: [
				{type: 'h2', text: tl('interface.streamer_mode_on'), click() {
					Settings.openDialog({search_term: tl('settings.streamer_mode')})
				}}
			]
		})
	}
}
setupSettings();
setupSettingsProfiles();

