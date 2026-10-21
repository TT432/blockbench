/// <reference types="./blockbench"/>

declare class Deletable {
	/**
	 * The ID of the plugin that created the object
	 */
	plugin?: string
	/**
	 * Deletes the object.
	 */
	delete(): void
}
/**
 * A unique identifier string.
 */
type UUID = string

/**
 * Global declarations available in the window scope.
 */
declare global {
	/**
	 * The global Blockbench settings object.
	 */
	const settings: typeof settings
}

/**
 * True if Blockbench runs as a native app
 */
declare const isApp: boolean

/**
 * The Prism code editor component used in dialogs.
 */
declare const VuePrismEditor: Vue.Component

/**
 * Maps the names of Blockbench events to their payload types.
 */
interface BlockbenchEventMap {
	/** Fires on every animation frame while the animator displays the current pose. */
	display_animation_frame: {
		/** Whether the displayed animation is looping. */
		in_loop: true
	}
	/** Fires after all animated nodes are reset to their default pose. */
	display_default_pose: {
		/** Whether the reset skipped the geometry updates. */
		reduced_updates: boolean
	}
	/** Fires when two keyframes are interpolated to build a pose. */
	interpolate_keyframes: {
		/** The animator whose keyframes are interpolated. */
		animator: BoneAnimator
		/** Normalized interpolation progress between the two keyframes. */
		t: number
		/** The timeline time being sampled. */
		time: number
		/** Whether quaternions are used for the interpolation. */
		use_quaternions: boolean
		/** The keyframe before the sampled time. */
		keyframe_before: BBKeyframe
		/** The keyframe after the sampled time. */
		keyframe_after: BBKeyframe
	}
	/** Fires before the animations of a node are stacked into a pose. */
	pre_stack_node_animations: {
		/** The node whose animations are stacked. */
		node: OutlinerNode
		/** The animations applied to the node. */
		animations: BBAnimation[]
		/** Whether the animations are displayed in a loop. */
		in_loop: boolean
		/** Per-animation blend weights supplied by animation controllers. */
		controller_blend_values: number
	}
	/** Fires before the window is closed. */
	before_closing: {}
	/** Fires when an edit session is created. */
	create_session: {
		/** The peer that hosts the session. */
		peer: Peer
		/** The token used to join the session. */
		token: string
	}
	/** Fires when the client joins an edit session. */
	join_session: {
		/** The data connection to the session host. */
		conn: DataConnection
	}
	/** Fires when the edit session is quit. */
	quit_session: {}
	/** Fires before data is sent to the other clients of the edit session. */
	send_session_data: {
		/** The tag type of the outgoing data. */
		type: string
		/** The payload sent to the other clients. */
		data: any
	}
	/** Fires when data from the edit session is received. */
	receive_session_data: {
		/** The tag type of the incoming data. */
		type: string
		/** The received payload. */
		data: any
	}
	/** Fires when another client joins the edit session. The payload is the joining client. */
	user_joins_session: EditSession.Client
	/** Fires when another client leaves the edit session. The payload is the leaving client. */
	user_leaves_session: EditSession.Client
	/** Fires when a chat message is processed before it is added to the chat. */
	process_chat_message: {
		/** The text of the chat message. */
		text: string
		/** The color of the chat message. */
		color: string
	}
	/** Fires after a plugin has been loaded. */
	loaded_plugin: {
		/** The plugin that was loaded. */
		plugin: BBPlugin
	}
	/** Fires after a plugin has been unloaded. */
	unloaded_plugin: {
		/** The plugin that was unloaded. */
		plugin: BBPlugin
	}
	/** Fires after a plugin has been installed. */
	installed_plugin: {
		/** The plugin that was installed. */
		plugin: BBPlugin
	}
	/** Fires after a plugin has been uninstalled. */
	uninstalled_plugin: {
		/** The plugin that was uninstalled. */
		plugin: BBPlugin
	}
	/** Fires after the settings have been saved and applied. */
	update_settings: {}
	/** Fires after the project settings have been changed. */
	update_project_settings: Record<string, any>
	/** Fires while a project is compiled for saving. */
	save_project: {
		/** The compiled model data. */
		model: any
		/** The options passed to the save operation. */
		options: any
	}
	/** Fires while a project is parsed from a file. */
	load_project: {
		/** The parsed model data. */
		model: any
		/** The path of the file the model is loaded from. */
		path: string
	}
	/** Fires after a new project has been created. */
	new_project: {
		/** The project that was created. */
		project: ModelProject
	}
	/** Fires before a project is closed. */
	close_project: {
		/** The project that is closing. */
		project: ModelProject
		/** Whether the project closes because the app is quitting. */
		on_quit: boolean
	}
	/** Fires when the saved state of a project changes. */
	saved_state_changed: {
		/** The project whose saved state changed. */
		project: ModelProject
		/** Whether the project is marked as saved. */
		saved: boolean
	}
	/** Fires while the CSS classes of an outliner node are collected. */
	get_outliner_node_classes: {
		/** The node whose classes are collected. */
		node: OutlinerNode
		/** The classes of the node; handlers may add entries. */
		classes: string[]
	}
	/** Fires after a cube has been added. */
	add_cube: {
		/** The cube that was added. */
		object: Cube
	}
	/** Fires after a mesh has been added. */
	add_mesh: {
		/** The mesh that was added. */
		object: Mesh
	}
	/** Fires after a group has been added. */
	add_group: {
		/** The group that was added. */
		object: Group
	}
	/** Fires after a texture mesh has been added. */
	add_texture_mesh: {
		/** The texture mesh that was added. */
		object: TextureMesh
	}
	/** Fires after an armature has been added. */
	add_armature: {
		/** The armature that was added. */
		object: Armature
	}
	/** Fires after an armature bone has been added. */
	add_armature_bone: {
		/** The armature bone that was added. */
		object: ArmatureBone
	}
	/** Fires after a bounding box has been added. */
	add_bounding_box: {
		/** The bounding box that was added. */
		object: BoundingBox
	}
	/** Fires after an element has been grouped into a new group. */
	group_elements: {
		/** The group that contains the elements. */
		object: Group
	}
	/** Fires after a billboard has been added. */
	add_billboard: {
		/** The billboard that was added. */
		object: Billboard
	}
	/** Fires after a spline mesh has been added. */
	add_spline: {
		/** The spline mesh that was added. */
		object: SplineMesh
	}
	/** Fires after a particle effect asset has been added to the project. */
	add_particle_asset: {
		/** The particle effect asset that was added. */
		asset: unknown
	}
	/** Fires after a sound asset has been added to the project. */
	add_sound_asset: {
		/** The sound asset that was added. */
		asset: unknown
	}
	/** Fires while a texture is being edited through `Painter.edit`, after the edit callback ran. */
	edit_texture: {
		/** The texture that is edited. */
		texture: Texture
		/** The options passed to `Painter.edit`. */
		options: TextureEditOptions
		/** The canvas of the edited texture layer. */
		canvas: HTMLCanvasElement
		/** The 2D context of `canvas`. */
		ctx: CanvasRenderingContext2D
		/** Offset of the active layer within the texture, in pixels. */
		offset: [number, number]
	}
	/** Fires after the project custom Molang definitions or the custom Molang variable table changed. */
	update_custom_molang: {}
	/** Fires after the element selection has changed. */
	update_selection: void
	/** Fires while a Bedrock animation is compiled. */
	compile_bedrock_animation: {
		/** The animation that is compiled. */
		animation: Animation
		/** The compiled animation data; handlers may modify it. */
		json: any
	}
	/** Fires while a Bedrock animation is parsed. */
	load_animation: {
		/** The animation that is parsed. */
		animation: Animation
		/** The parsed animation data. */
		json: any
	}
	/** Fires while a Bedrock animation controller is parsed. */
	load_animation_controller: {
		/** The animation controller that is parsed. */
		animation_controller: AnimationController
		/** The parsed controller data. */
		json: any
	}
	/** Fires after the keyframe selection has changed. */
	update_keyframe_selection: void
	/** Fires after all elements have been selected. */
	select_all: {}
	/** Fires after elements have been added to the selection. */
	added_to_selection: {
		/** The elements that were added. */
		added: OutlinerElement[]
	}
	/** Fires after the selection has been inverted. */
	invert_selection: {}
	/** Fires after the file path of a texture has changed. */
	change_texture_path: {
		/** The texture whose path changed. */
		texture: Texture
	}
	/** Fires after a texture has been added. */
	add_texture: {
		/** The texture that was added. */
		texture: Texture
	}
	/** Fires after a texture template has been generated. */
	generate_texture_template: {
		/** The options the template was generated with. */
		options: Record<string, any>
		/** The elements the template was generated for. */
		elements: OutlinerElement[]
		/** The texture the template is drawn into. */
		texture: Texture
		/** The multiplier used to convert UV coordinates to texture pixels. */
		resolution_multiplier: number
		/** Additional template data. */
		data: {
			/** The per-face template entries. */
			face_list: any
			/** The box UV template entries. */
			box_uv_templates: any
		}
	}
	/** Fires after the texture selection has changed. */
	update_texture_selection: void
	/** Fires when an undoable edit is started. */
	init_edit: {
		/** The aspects captured by the edit. */
		aspects: UndoAspects
		/** Whether the edit amends the previous undo entry. */
		amended: boolean
		/** The undo save taken when the edit started. */
		save: UndoSave
	}
	/** Fires when an undoable edit is finished and added to the undo history. */
	finish_edit: {
		/** The aspects recorded by the edit. */
		aspects: UndoAspects
		/** The action name of the undo entry. */
		message: string
	}
	/** Fires after an undoable edit has been added to the undo history. */
	finished_edit: {
		/** The aspects recorded by the edit. */
		aspects: UndoAspects
		/** The action name of the undo entry. */
		message: string
	} | {
		/** True when the edit was applied from a remote edit session client. */
		remote: true
	}
	/** Fires when a selection change is started. */
	init_selection_change: {
		/** The aspects captured by the selection change. */
		aspects: UndoAspects
		/** The selection save taken when the change started. */
		save: UndoSelectionSave
	}
	/** Fires when a selection change is finished and added to the undo history. */
	finish_selection_change: {
		/** The aspects recorded by the selection change. */
		aspects: UndoAspects
	}
	/** Fires after a selection change has been added to the undo history. */
	finished_selection_change: {
		/** The aspects recorded by the selection change. */
		aspects: UndoAspects
	}
	/** Fires when a selection change is cancelled. */
	cancel_selection_change: {
		/** The selection state from before the cancelled change. */
		selection_before: UndoSelectionSave
	}
	/** Fires when an undo entry is reverted. */
	undo: {
		/** The undo entry that was reverted. */
		entry: UndoEntry
	}
	/** Fires when an undo entry is applied again. */
	redo: {
		/** The undo entry that was reapplied. */
		entry: UndoEntry
	}
	/** Fires while an undo save is loaded. */
	load_undo_save: {
		/** The undo save that is loaded. */
		save: UndoSave
		/** The save the loaded state is compared against. */
		reference: UndoSave
		/** `session` when the save is loaded from a remote edit session. */
		mode: undefined | 'session'
	}
	/** Fires while an undo save is created. */
	create_undo_save: {
		/** The undo save that was created. */
		save: UndoSave
		/** The aspects captured by the save. */
		aspects: UndoAspects
	}
	/** Fires when text is dropped onto the window. */
	drop_text: {
		/** The dropped text. */
		text: string
	}
	/** Fires when text is pasted into Blockbench. */
	paste_text: {
		/** The pasted text. */
		text: string
	}
	/** Fires after a color has been changed in the color panel. */
	change_color: {
		/** The new color as a hex string. */
		color: string
		/** Whether the secondary color was changed. */
		secondary: boolean
	}
	/** Fires after a mode has been selected. */
	select_mode: {
		/** The mode that was selected. */
		mode: Mode
	}
	/** Fires after a mode has been unselected. */
	unselect_mode: {
		/** The mode that was unselected. */
		mode: Mode
	}
	/** Fires after the active panel has changed. */
	change_active_panel: {
		/** The panel that was active before. */
		last_panel: Panel
		/** The panel that is now active. */
		panel: Panel
	}
	/** Fires after the window has been resized. */
	resize_window: {
		/** The resize event, when available. */
		event: Event
	}
	/** Fires after the view mode of the preview has changed. */
	change_view_mode: {
		/** The view mode that was activated. */
		view_mode: string
		/** The view mode that was active before. */
		previous_view_mode: string
	}
	/** Fires while a key press is handled, before the default key actions run. */
	press_key: {
		/** The element that has keyboard focus, if any. */
		input_in_focus: HTMLElement
		/** The keyboard event being handled. */
		event: KeyboardEvent
		/** Marks the key press as handled and prevents the default key handling. */
		capture: () => void
	}
	/** Fires after a model format has been selected. */
	select_format: {
		/** The format that was selected. */
		format: ModelFormat
		/** The project that uses the format. */
		project: ModelProject
	}
	/** Fires after a project has been converted to another format. */
	convert_format: {
		/** The format the project was converted to. */
		format: ModelFormat
		/** The format the project used before. */
		old_format: ModelFormat
	}
	/** Fires after a model format has been constructed. */
	construct_format: {
		/** The format that was constructed. */
		format: ModelFormat
	}
	/** Fires after a model format has been deleted. */
	delete_format: {
		/** The format that was deleted. */
		format: ModelFormat
	}
	/** Fires after a project has been selected. */
	select_project: {
		/** The project that was selected. */
		project: ModelProject
	}
	/** Fires after a project has been unselected. */
	unselect_project: {
		/** The project that was unselected. */
		project: ModelProject
	}
	/** Fires after a project has been set up. */
	setup_project: {
		/** The project that was set up. */
		project: ModelProject
	}
	/** Fires after the resolution of the project has changed. */
	update_project_resolution: {
		/** The project whose resolution changed. */
		project: ModelProject
	}
	/** Fires while another model is merged into the project. */
	merge_project: {
		/** The model data that is merged. */
		model: any
		/** The path of the merged file. */
		path: string
	}
	/** Fires while the model statistics dialog is built. */
	display_model_stats: {
		/** The statistic entries shown in the dialog. */
		stats: {
			/** The display label of the statistic. */
			label: string
			/** The value of the statistic. */
			value: number | string
		}[]
	}
	/** Fires while the preview is updated. */
	update_view: UpdateViewOptions
	/** Fires after the camera of a preview has moved. */
	update_camera_position: {
		/** The preview whose camera moved. */
		preview: Preview
	}
	/** Fires after a preview frame has been rendered. */
	render_frame: {}
	/** Fires after a model loader has been constructed. */
	construct_model_loader: {
		/** The model loader that was constructed. */
		loader: ModelLoader
	}
	/** Fires after a model loader has been deleted. */
	delete_model_loader: {
		/** The model loader that was deleted. */
		loader: ModelLoader
	}
	/** Fires after the data of a recent project has been updated. */
	update_recent_project_data: {
		/** The recent project entry that was updated. */
		data: RecentProjectData
	}
	/** Fires after the thumbnail of a recent project has been updated. */
	update_recent_project_thumbnail: {
		/** The recent project entry that was updated. */
		data: RecentProjectData
		/** The path of the new thumbnail. */
		thumbnail: string
	}
	/** Fires when a project is opened from the recent projects list. */
	load_from_recent_project_data: {
		/** The recent project entry that is opened. */
		data: RecentProjectData
	}
	/** Fires after the properties of an animation have been edited. */
	edit_animation_properties: {
		/** The animation whose properties were edited. */
		animation: BBAnimation
	}
	/** Fires after a preview scene has been selected. */
	select_preview_scene: {
		/** The preview scene that was selected. */
		scene: PreviewScene
	}
	/** Fires after a preview scene has been unselected. */
	unselect_preview_scene: {
		/** The preview scene that was unselected. */
		scene: PreviewScene
	}
	/** Fires after an animation has been selected. */
	select_animation: {
		/** The animation that was selected. */
		animation: BBAnimation
	}
	/** Fires after animations have been removed. */
	remove_animation: {
		/** The animations that were removed. */
		animations: BBAnimation[]
	}
	/** Fires while an animation controller state is compiled. */
	compile_bedrock_animation_controller_state: {
		/** The controller state that is compiled. */
		state: AnimationControllerState
		/** The compiled state data; handlers may modify it. */
		json: any
	}
	/** Fires after an animation controller state has been selected. */
	select_animation_controller_state: {
		/** The controller state that was selected. */
		state: AnimationControllerState
	}
	/** Fires after an animation has been added to a controller state. */
	add_animation_controller_animation: {
		/** The controller state the animation was added to. */
		state: AnimationControllerState
	}
	/** Fires after a transition has been added to a controller state. */
	add_animation_controller_transition: {
		/** The controller state the transition was added to. */
		state: AnimationControllerState
	}
	/** Fires after a particle effect has been added to a controller state. */
	add_animation_controller_particle: {
		/** The controller state the particle effect was added to. */
		state: AnimationControllerState
	}
	/** Fires after a sound effect has been added to a controller state. */
	add_animation_controller_sound: {
		/** The controller state the sound effect was added to. */
		state: AnimationControllerState
	}
	/** Fires while a Bedrock animation controller is compiled. */
	compile_bedrock_animation_controller: {
		/** The animation controller that is compiled. */
		state: AnimationController
		/** The compiled controller data; handlers may modify it. */
		json: any
	}
	/** Fires after an animation controller has been added. */
	add_animation_controller: {
		/** The animation controller that was added. */
		state: AnimationController
	}
	/** Fires after the properties of an animation controller have been edited. */
	edit_animation_controller_properties: {
		/** The animation controller whose properties were edited. */
		state: AnimationController
	}
	/** Fires after the timeline starts playing. */
	timeline_play: {}
	/** Fires after the timeline is paused. */
	timeline_pause: {}
	/** Fires when a click outside the interface elements deselects the interface. */
	unselect_interface: {
		/** The event that caused the deselection. */
		event: Event
	}
	/** Fires after the interface layout has been reset. */
	reset_layout: {}
	/** Fires after the pressed modifier keys have changed. */
	update_pressed_modifier_keys: {
		/** The modifier key state before the change. */
		before: {
			/** Whether Shift was pressed before. */
			shift: boolean
			/** Whether Alt was pressed before. */
			alt: boolean
			/** Whether Control was pressed before. */
			ctrl: boolean
		}
		/** The current modifier key state. */
		now: {
			/** Whether Shift is pressed now. */
			shift: boolean
			/** Whether Alt is pressed now. */
			alt: boolean
			/** Whether Control is pressed now. */
			ctrl: boolean
		}
		/** The keyboard event that changed the modifier keys. */
		event: KeyboardEvent
	}
	/** Fires after a bar menu has been opened. */
	open_bar_menu: {
		/** The bar menu that was opened. */
		menu: BarMenu
	}
	/** Fires after all elements have been unselected. */
	unselect_all: {}
	/** Fires while the texture of a face is resolved. */
	get_face_texture: {
		/** The face whose texture is resolved. */
		face: Face
		/** The element that owns the face. */
		element: OutlinerElement
	}
	/** Fires after the project has been saved with the quick save action. */
	quick_save_model: {}
	/** Fires while the editor state of a project is saved. */
	save_editor_state: {
		/** The project whose editor state is saved. */
		project: ModelProject
	}
	/** Fires while the editor state of a project is loaded. */
	load_editor_state: {
		/** The project whose editor state is loaded. */
		project: ModelProject
	}
	/** Fires when no project is selected and the start screen is shown. */
	select_no_project: {}
	/** Fires before the name of a node is flipped along an axis. */
	flip_node_name: {
		/** The name pairs that are mirrored on the axis. */
		pairs: Record<string, string>
		/** The node whose name is flipped. */
		node: OutlinerNode
		/** The axis the node is mirrored on. */
		axis: axisNumber
		/** The original name, when the name has already been changed. */
		original_name: string
	}
	/** Fires after the shading of the preview scene has been updated. */
	update_scene_shading: any
	/** Fires after the properties of a texture layer have been edited. */
	edit_layer_properties: {
		/** The layer whose properties were edited. */
		layer: TextureLayerItem
	}
	/** Fires after a texture has been selected. */
	select_texture: {
		/** The texture that was selected. */
		texture: Texture
		/** The event that triggered the selection. */
		event: Event
	}
	/** Fires while the `.mcmeta` data of a texture is compiled. */
	compile_texture_mcmeta: {
		/** The compiled `.mcmeta` data; handlers may modify it. */
		mcmeta: any
	}
	/** Fires when an outliner element type is registered. */
	register_element_type: {
		/** The identifier of the element type. */
		id: string
		/** The element class registered for the type. */
		constructor: any
	}
	/** Fires after the properties of a collection have been edited. */
	edit_collection_properties: {
		/** The collection whose properties were edited. */
		collection: Collection
	}
}

/**
 * The name of a Blockbench event.
 */
type BlockbenchEventName = keyof BlockbenchEventMap

/**
 * An icon specified as a CSS class name or as an HTML element.
 */
type IconString = string | HTMLElement

/**
 * The path separator of the operating system.
 */
declare const osfs: '\\' | '/'

/**
 * Synchronizes the selection state of the elements with the selected element list.
 */
declare function updateSelection(): void

/**
 * The LZUTF8 compression library.
 */
declare var LZUTF8: any

/**
 * Unselects all elements, except the given ones.
 * @param exceptions The elements that stay selected.
 */
declare function unselectAllElements(exceptions?: OutlinerNode[]): void
/**
 * Returns the factor used to rescale an element rotated by the given angle.
 * @param angle The rotation angle in degrees.
 */
declare function getRescalingFactor(angle: number): number
/**
 * Get the world-space center of the selection
 * @param all If true, calculate the center of all elements instead of just selected
 */
declare function getSelectionCenter(all: boolean = false): ArrayVector3
/**
 * Returns the step size used to move elements for the modifier keys of the event.
 * @param event The event that provides the modifier keys.
 */
declare function getSpatialInterval(event?: Event): number;
/**
 * Returns the rotation step in degrees for the modifier keys of the event.
 * @param event The event that provides the modifier keys.
 */
declare function getRotationInterval(event?: Event): number;

/**
 * The modifier keys that are currently pressed.
 */
declare const Pressing: {
	/**
	 * Whether Shift is pressed.
	 */
	shift: boolean
	/**
	 * Whether Control is pressed.
	 */
	ctrl: boolean
	/**
	 * Whether Alt is pressed.
	 */
	alt: boolean
	/**
	 * Modifier keys that are forced by the active tool.
	 */
	overrides: {
		/**
		 * Whether Shift is forced.
		 */
		shift: boolean
		/**
		 * Whether Control is forced.
		 */
		ctrl: boolean
		/**
		 * Whether Alt is forced.
		 */
		alt: boolean
	}
}

/**
 * General properties of the editor state.
 */
declare const Prop = {
	/**
	 * The panel that is currently active.
	 */
	active_panel: string,
	/**
	 * The frame rate displayed in the preview statistics.
	 */
	fps: number,
	/**
	 * Whether the left bar is shown.
	 */
	show_left_bar: boolean,
	/**
	 * Whether the right bar is shown.
	 */
	show_right_bar: boolean,
}
/**
 * The project that is currently selected.
 */
declare const Project: ModelProject
/**
 * The color panel interface.
 */
declare const ColorPanel: any

/**
 * Returns whether the value is a number or a numeric string.
 * @param value The value to check.
 */
declare function isStringNumber(value: any): boolean

/**
 * Converts Markdown text to HTML.
 * @param text The Markdown text.
 */
declare function marked(text: string): string
/**
 * Converts Markdown text to sanitized HTML.
 * @param text The Markdown text.
 */
declare function pureMarked(text: string): string

/**
 * The spline mesh class merged with the static members of `OutlinerElement`.
 */
declare type SplineMesh = typeof OutlinerElement & Record<string, any>
/**
 * The spline mesh class.
 */
declare const SplineMesh: typeof OutlinerElement
