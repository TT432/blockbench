/// <reference types="./blockbench"/>
/**
 * Describes which parts of the project an undo save captures.
 */
interface UndoAspects {
	/**
	 * Save the current element selection.
	 */
	selection?: boolean
	/**
	 * Elements whose state is saved.
	 */
	elements?: OutlinerElement[]
	/**
	 * Saves the entire outliner structure and hierarchy, including all groups. This is required when adding, or removing any elements, or changing their position in the outliner.
	 */
	outliner?: boolean
	/**
	 * Save individual groups, but not their children or hierarchy position
	 */
	groups?: Group[]
	/**
	 * Saves an individual group, but not it's children or hierarchy position
	 */
	group?: Group
	/**
	 * Collections that are saved with the edit.
	 */
	collections?: Collection[]
	/**
	 * Textures to save
	 */
	textures?: Texture[]
	/**
	 * Save the order of textures in the project.
	 */
	texture_order?: boolean
	/**
	 * Texture groups to save.
	 */
	texture_groups?: TextureGroup[]
	/**
	 * Save which texture is selected
	 */
	selected_texture?: boolean
	/**
	 * Set to true to include the image content of the specified textures
	 */
	bitmap?: boolean
	/**
	 * Texture layers to save.
	 */
	layers?: TextureLayerItem[]
	/**
	 * Settings values to save.
	 */
	settings?: {}
	/**
	 * Save the UV editor state together with the texture size.
	 */
	uv_mode?: boolean
	/**
	 * Animations to save.
	 */
	animations?: BBAnimation[]
	/**
	 * Animation controllers to save.
	 */
	animation_controllers?: AnimationController[]
	/**
	 * Keyframes to save. Only applies while an animation is selected.
	 */
	keyframes?: BBKeyframe[]
	/**
	 * Display slots whose display settings are saved.
	 */
	display_slots?: string[]
	/**
	 * Save the exploded view state.
	 */
	exploded_view?: boolean
	/**
	 * Set to false to skip mirroring the edit on mirrored elements.
	 */
	mirror_modeling?: false
	/**
	 * Marks the edit as touching only the UV data of the saved elements.
	 */
	uv_only?: boolean
}
/**
 * Describes which parts of the selection a selection save captures.
 */
interface UndoSelectionAspects {
	/**
	 * Save the texture selection in the UV editor.
	 */
	texture_selection?: boolean
	/**
	 * Save the selected collections.
	 */
	collections?: boolean
	/**
	 * Save the selected keyframes and animators in the timeline.
	 */
	timeline?: boolean
}
/**
 * Snapshot of the project state, used as one side of an undo entry.
 */
type UndoSave = {
	/**
	 * The aspects this save was created from.
	 */
	aspects: UndoAspects
	/**
	 * Legacy element selection data that is no longer written to the save.
	 */
	selection?: []
	/**
	 * Group UUID stored with the save.
	 */
	selection_group?: UUID
	/**
	 * Element copies, keyed by element UUID.
	 */
	elements?: {}
	/**
	 * Snapshot of the outliner structure.
	 */
	outliner?: []
	/**
	 * Copy of a single group.
	 */
	group?: {}
	/**
	 * Copies of individual groups.
	 */
	groups?: {}[]
	/**
	 * Copies of collections, keyed by collection UUID.
	 */
	collections?: {}[]
	/**
	 * Copies of textures, keyed by texture UUID.
	 */
	textures?: {}
	/**
	 * UUIDs of all textures in the order they were saved in.
	 */
	texture_order?: UUID[]
	/**
	 * UUID of the selected texture, or `null` if no texture was selected.
	 */
	selected_texture?: UUID | null
	/**
	 * Settings values stored in the save.
	 */
	settings?: {}
	/**
	 * UV editor state stored in the save.
	 */
	uv_mode?: {
		/**
		 * Whether box UV mode was enabled.
		 */
		box_uv: boolean
		/**
		 * Texture width stored in the save.
		 */
		width: number
		/**
		 * Texture height stored in the save.
		 */
		height: number
	}
	/**
	 * Copies of animations, keyed by animation UUID.
	 */
	animations?: {}
	/**
	 * Copies of keyframes, keyed by keyframe UUID.
	 */
	keyframes?: {}
	/**
	 * Copies of display slot settings, keyed by display slot.
	 */
	display_slots?: {}
	/**
	 * Exploded view state captured by the save.
	 */
	exploded_views?: boolean
	/**
	 * Load the undo save
	 */
	load(reference: UndoSave, mode?: 'session'): void
	/**
	 * Add a texture to an undo edit during the edit
	 */
	addTexture(texture: Texture): void
	/**
	 * Add a texture to an undo edit during the edit
	 */
	addTextureOrLayer(texture: Texture): void
	/**
	 * Add elements to an undo edit during the edit
	 */
	addElements(elements: OutlinerElement[], aspects?: UndoAspects): void
}
/**
 * Snapshot of the current selection, used as one side of a selection undo entry.
 */
type UndoSelectionSave = {
	/**
	 * The aspects this selection save was created from.
	 */
	aspects: UndoSelectionAspects
	/**
	 * UUIDs of the selected outliner elements.
	 */
	elements: string[]
	/**
	 * UUIDs of the selected groups.
	 */
	groups: string[]
	/**
	 * Selected geometry of each element, keyed by element UUID.
	 */
	geometry: {
		[uuid: string]: {
			/**
			 * Selected face keys.
			 */
			faces: string[]
			/**
			 * Selected edge keys.
			 */
			edges: string[]
			/**
			 * Selected vertex keys.
			 */
			vertices: string[]
		}
	}
	/**
	 * ID of the mode the selection save was created in.
	 */
	mode: string
	/**
	 * The mesh selection mode that was active when the save was created.
	 */
	mesh_selection_mode: string
	/**
	 * UUID of the selected texture.
	 */
	texture: string
	/**
	 * Custom texture selection stored as bytes, or the flag for the default selection.
	 */
	texture_selection?: Int8Array | boolean
	/**
	 * UUID of the selected animation item.
	 */
	animation_item?: string
	/**
	 * Selected keyframes of each animator, keyed by animator key.
	 */
	timeline?: {}
	/**
	 * Channel that was open in the graph editor.
	 */
	graph_editor_channel?: string
	/**
	 * Axis that was selected in the graph editor.
	 */
	graph_editor_axis?: string
	/**
	 * Whether the graph editor was open.
	 */
	graph_editor_open?: boolean
	/**
	 * Load the selection save
	 */
	load(): void
	/**
	 * Test whether the selection save matches another selection
	 * @param other Selection save to test against
	 */
	matches(other: UndoSelectionSave): boolean
}
/**
 * One step in the undo history.
 */
type UndoEntry = {
	/**
	 * Project state before the edit.
	 */
	before?: UndoSave
	/**
	 * Project state after the edit.
	 */
	post?: UndoSave
	/**
	 * Selection state before the edit.
	 */
	selection_before?: UndoSelectionSave
	/**
	 * Selection state after the edit.
	 */
	selection_post?: UndoSelectionSave
	/**
	 * Description of the edit, shown in the undo history.
	 */
	action: string
	/**
	 * Kind of the entry: the initial project state, an edit, or a selection change.
	 */
	type: 'original' | 'edit' | 'selection'
	/**
	 * Timestamp of when the entry was created.
	 */
	time: number
}

/**
 * Stores the undo history of a project.
 */
declare class UndoSystem {
	/**
	 * Creates an empty undo history.
	 */
	constructor()
	/**
	 * Starts an edit to the current project by saving the state of the provided aspects
	 * @param aspects Aspects to save
	 */
	initEdit(aspects: UndoAspects, amended: boolean = false): UndoEntry
	/**
	 * Finishes an edit by saving the state of the project after it was changed
	 * @param action Description of the edit
	 */
	finishEdit(action: string, aspects?: UndoAspects): UndoEntry
	/**
	 * Cancels an event before it was finished and reset the project to the state before
	 */
	cancelEdit(revert_changes?: boolean = false): void
	/**
	 * Add keyframes to the current edit that were indirectly removed by moving other keyframes to their position
	 * @param keyframes Keyframes that were removed indirectly
	 */
	addKeyframeCasualties(keyframes: BBKeyframe[]): void
	/**
	 * Undoes the latest edit
	 * @param remote Set to true when the undo was triggered by a remote editing session
	 */
	undo(remote?: boolean): void
	/**
	 * Starts a selection change in the current project
	 * @param aspects Aspects to save
	 */
	initSelection(aspects?: UndoSelectionAspects): UndoEntry
	/**
	 * Finishes a selection change in the current project
	 * @param action Description of the edit
	 */
	finishSelection(action: string, aspects?: UndoSelectionAspects): UndoEntry
	/**
	 * Cancel the selection changes
	 * @param revert_changes If true, the already tracked selection changes will be reverted to the state before initSelection
	 */
	cancelSelection(revert_changes?: boolean): void
	/**
	 * Redoes the latest edit
	 * @param remote Set to true when the redo was triggered by a remote editing session
	 */
	redo(remote?: boolean): void
	/**
	 * Provides a menu to amend the latest edit with slightly changed values
	 */
	amendEdit(form: InputFormConfig, callback: (values: any, form: any) => void): void
	/**
	 * Closes the amend edit menu
	 */
	closeAmendEditMenu(): void

	/**
	 * Loads a specific undo save
	 * @param save The undo save to load
	 * @param reference The current undo save for reference
	 * @param mode The load save modes
	 */
	loadSave(save: UndoSave, reference: UndoSave, mode?: 'session'): void

	/**
	 * All entries of the undo history, oldest first.
	 */
	history: UndoEntry[]
	/**
	 * Current position in the undo history.
	 */
	index: number
	/**
	 * Save of the edit that is currently in progress.
	 */
	current_save?: UndoSave
}

/**
 * Blockbench's undo system of the current project to register edits to the project and switch between them

## Example

```javascript
Undo.initEdit({elements: []});

let new_cube = new Cube({name: 'kevin'}).init();
let other_cube = new Cube({name: 'lars'}).init();

Undo.finishEdit('Add new cubes', {elements: [new_cube, other_cube]});
```
 */
declare let Undo: UndoSystem
