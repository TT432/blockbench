/// <reference types="./blockbench"/>
/**
 * Holds the state and the helpers of the Display Mode editor for item display transforms
 */
declare const DisplayMode: {
	/**
	 * Names of the display slots in the order they are listed in the interface
	 */
	slots: string[]
	/**
	 * `DisplaySlot` instance of the slot that is selected for editing
	 */
	slot: DisplaySlot
	/**
	 * ID of the slot that is selected for editing
	 */
	display_slot: string
	/**
	 * Object that represents the item display area in the preview
	 */
	display_area: any
	/**
	 * Object inside the display area that the reference model is placed in
	 */
	display_base: any
	/**
	 * Whether the reference model is animated in the preview
	 */
	animate_preview: Preview
	/**
	 * Applies the next frame of the ground display animation
	 */
	groundAnimation(): void
	/**
	 * Rebuilds the player reference model with the current skin
	 */
	updateDisplaySkin(): void
	/**
	 * Loads display slot transform data from a project or model JSON object
	 */
	loadJSON(json: any): void
}

/**
 * Identifier of a Minecraft Java Edition item display slot
 */
declare type DisplaySlotName =
	| 'firstperson_lefthand'
	| 'firstperson_righthand'
	| 'fixed'
	| 'ground'
	| 'gui'
	| 'head'
	| 'thirdperson_lefthand'
	| 'thirdperson_righthand'

/**
 * Transform values of a display slot, as stored in the model file
 */
interface DisplaySlotOptions {
	/**
	 * Rotation of the item in the slot, in degrees
	 */
	rotation?: ArrayVector3
	/**
	 * Translation of the item in the slot
	 */
	translation?: ArrayVector3
	/**
	 * Scale of the item in the slot
	 */
	scale?: ArrayVector3
	/**
	 * Pivot point used for the rotation of the item
	 */
	rotation_pivot?: ArrayVector3
	/**
	 * Pivot point used for the scaling of the item
	 */
	scale_pivot?: ArrayVector3
	/**
	 * Per-axis mirror flags of the item
	 */
	mirror?: [boolean, boolean, boolean]
}

/**
 * Display Slots hold the transform values for a specific item slot in the Minecraft Java Edition "Display Mode" feature
 */
declare class DisplaySlot {
	/**
	 * Creates a display slot with default values and applies the given transform data
	 */
	constructor(id: string, data: DisplaySlotOptions)
	/**
	 * Rotation of the item in the slot, in degrees
	 */
	rotation: ArrayVector3
	/**
	 * Translation of the item in the slot
	 */
	translation: ArrayVector3
	/**
	 * Scale of the item in the slot
	 */
	scale: ArrayVector3
	/**
	 * Pivot point used for the rotation of the item
	 */
	rotation_pivot: ArrayVector3
	/**
	 * Pivot point used for the scaling of the item
	 */
	scale_pivot: ArrayVector3
	/**
	 * Per-axis mirror flags of the item
	 */
	mirror: [boolean, boolean, boolean]
	/**
	 * Reset slot to default values
	 */
	default(): this
	/**
	 * Merges the given transform values into this slot and updates the interface
	 */
	extend(data: DisplaySlotOptions): this
	/**
	 * Returns a copy of the transform values of this slot
	 */
	copy(): {
		/**
		 * Copy of the rotation of the item
		 */
		rotation: ArrayVector3
		/**
		 * Copy of the translation of the item
		 */
		translation: ArrayVector3
		/**
		 * Copy of the scale of the item
		 */
		scale: ArrayVector3
		/**
		 * Copy of the rotation pivot of the item
		 */
		rotation_pivot: ArrayVector3
		/**
		 * Copy of the scale pivot of the item
		 */
		scale_pivot: ArrayVector3
		/**
		 * Copy of the mirror flags of the item
		 */
		mirror: [boolean, boolean, boolean]
	}
	/**
	 * Generate the values of the slot for export
	 */
	export():
		| {
				/**
				 * Rotation of the item, in degrees
				 */
				rotation: ArrayVector3
				/**
				 * Translation of the item
				 */
				translation: ArrayVector3
				/**
				 * Scale of the item
				 */
				scale: ArrayVector3
				/**
				 * Pivot point used for the rotation of the item
				 */
				rotation_pivot?: ArrayVector3
				/**
				 * Pivot point used for the scaling of the item
				 */
				scale_pivot?: ArrayVector3
		  }
		| undefined
	/**
	 * Visually update the UI with the data from this slot if selected
	 */
	update(): this
}

/**
 * Options that define a display reference model
 */
declare interface RefModelOptions {
	/**
	 * Icon used for the button of the model in the reference bar
	 */
	icon?: string
	/**
	 * Model definitions used to build the meshes of the reference model
	 */
	models?: DisplayReferenceModel.Model[]
	/**
	 * Condition that controls whether the model is available for the current project
	 */
	condition?: ConditionResolvable
}

/**
 * Reference models that can be displayed next to the model in Display Mode, plus the helpers to switch between them
 */
declare const displayReferenceObjects: {
	/**
	 * Reference models, indexed by their ID
	 */
	refmodels: {
		/**
		 * The player reference model
		 */
		player: refModel<'player'>
		/**
		 * The zombie reference model
		 */
		zombie: refModel<'zombie'>
		/**
		 * The armor stand reference model
		 */
		armor_stand: refModel<'armor_stand'>
		/**
		 * The baby zombie reference model
		 */
		baby_zombie: refModel<'baby_zombie'>
		/**
		 * The small armor stand reference model
		 */
		armor_stand_small: refModel<'armor_stand_small'>
		/**
		 * The fox reference model
		 */
		fox: refModel<'fox'>
		/**
		 * The monitor reference model
		 */
		monitor: refModel<'monitor'>
		/**
		 * The bow reference model
		 */
		bow: refModel<'bow'>
		/**
		 * The crossbow reference model
		 */
		crossbow: refModel<'crossbow'>
		/**
		 * The eating reference model
		 */
		eating: refModel<'eating'>
		/**
		 * The tooting reference model
		 */
		tooting: refModel<'tooting'>
		/**
		 * The block reference model
		 */
		block: refModel<'block'>
		/**
		 * The item frame reference model
		 */
		frame: refModel<'frame'>
		/**
		 * The invisible item frame reference model
		 */
		frame_invisible: refModel<'frame_invisible'>
		/**
		 * The reference model of an item frame on the top of a block
		 */
		frame_top: refModel<'frame_top'>
		/**
		 * The invisible reference model of an item frame on the top of a block
		 */
		frame_top_invisible: refModel<'frame_top_invisible'>
		/**
		 * The reference model of nine inventory slots
		 */
		inventory_nine: refModel<'inventory_nine'>
		/**
		 * The reference model of a full inventory
		 */
		inventory_full: refModel<'inventory_full'>
		/**
		 * The HUD reference model
		 */
		hud: refModel<'hud'>
	}
	/**
	 * The reference model that is currently displayed, if any
	 */
	active: refModel<keyof typeof displayReferenceObjects.refmodels>
	/* Clears the active display model */
	clear(): void
	/**
	 * Displays the reference model buttons of the given model IDs
	 * @param buttons IDs of the models that can be selected
	 */
	bar(buttons: any): void
	/**
	 * Index of the selected model button for each display slot
	 */
	ref_indexes: Record<DisplaySlotName, number>
	/**
	 * Names of the display slots in the order they are listed in the interface
	 */
	slots: DisplaySlotName[]
}

/**
 * A model that is displayed next to the model in Display Mode to show the item in context
 */
declare class refModel<ID extends string> {
	/**
	 * Creates a reference model with the given ID and options
	 */
	constructor(id: ID, options?: RefModelOptions)
	/**
	 * ID of the reference model
	 */
	id: ID
	/**
	 * Name of the reference model shown in the interface
	 */
	name: string
	/**
	 * Icon of the reference model
	 */
	icon: string
	/**
	 * Root object of the reference model in the 3D scene
	 */
	model: THREE.Mesh
	/**
	 * Model definitions used to build the meshes of the reference model
	 */
	models: DisplayReferenceModel.Model[]
	/**
	 * Condition that controls whether the model is available for the current project
	 */
	condition?: ConditionResolvable
	/**
	 * Whether the meshes of the model have been built
	 */
	initialized: boolean
	/**
	 * Player model variant that is displayed
	 */
	variant?: 'steve' | 'alex'
	/**
	 * Pose angle of the model for each display slot, in degrees
	 */
	pose_angles: Record<DisplaySlotName, number>
	/**
	 * Builds the meshes of the model and adds them to the root object
	 */
	buildModel(things: any, texture: string, texture_res?: ArrayVector2): this
	/**
	 * Shows the meshes that belong to the given player model variant
	 */
	setModelVariant(variant: string): void
	/**
	 * Displays this reference model in the preview and marks it as active
	 * @param index Index of the model button that is selected for the current slot
	 */
	load(index: any): void
	/**
	 * Builds the reference model of a player
	 * @param slim Whether to build the slim player model
	 */
	buildPlayer(slim?: boolean): void
	/**
	 * Builds the reference model of an armor stand
	 */
	buildArmorStand(): void
	/**
	 * Builds the reference model of a small armor stand
	 */
	buildArmorStandSmall(): void
	/**
	 * Builds the reference model of a fox
	 */
	buildFox(): void
	/**
	 * Builds the reference model of a zombie
	 */
	buildZombie(): void
	/**
	 * Builds the reference model of a baby zombie
	 */
	buildBabyZombie(): void
	/**
	 * Builds the reference model of a monitor
	 */
	buildMonitor(): void
	/**
	 * Builds the reference model of a block
	 */
	buildBlock(): void
	/**
	 * Builds the reference model of an item frame
	 */
	buildFrame(): void
	/**
	 * Builds the reference model of an invisible item frame
	 */
	buildFrameInvisible(): void
	/**
	 * Builds the reference model of an item frame on the top of a block
	 */
	buildFrameTop(): void
	/**
	 * Builds the reference model of an invisible item frame on the top of a block
	 */
	buildFrameTopInvisible(): void
	/**
	 * Updates the position of the model in the display area
	 */
	updateBasePosition(): void
}

/**
 * Opens the dialog that sets the skin used by the player reference model
 */
declare function changeDisplaySkin(): void
