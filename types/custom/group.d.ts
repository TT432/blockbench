/**
 * Options used to create a {@link Group}.
 */
interface GroupOptions {
	/**Group name */
	name: string
	/**Array of the group pivot point */
	origin: ArrayVector3
	/**Array of the group rotation */
	rotation: ArrayVector3
	/**If a bone, whether to reset the informations of inherited bones in bedrock edition. */
	reset: boolean
	/**Whether to shade the contents of the group */
	shade: boolean
	/**Whether the group is selected */
	selected: boolean
	/**Whether the group is visible */
	visibility: boolean
	/**Whether to export the entire group */
	export: boolean
	/**Auto UV setting for the children. Can be 0, 1 or 2. */
	autouv: 0 | 1 | 2
	/** Whether box UV of the children is mirrored across the X axis. */
	mirror_uv: boolean
	/** Index of the group color. */
	color: number
}

/**
 * An outliner node that contains other outliner nodes.
 */
declare class Group extends OutlinerNode {
	/**
	 * Creates a new group.
	 * @param options Initial group data, or the group name
	 * @param uuid UUID assigned to the group
	 */
	constructor(options: Partial<GroupOptions> | string, uuid?: UUID)
	/**
	 * Returns the directly selected groups
	 * @Note This only includes directly selected groups, not groups that are selected because the parent is selected
	 */
	static selected: Group[]
	/**
	 * The first group in {@link Group.multi_selected}
	 */
	static first_selected: Group | undefined
	/**
	 * A list of directly selected groups.
	 * @Note This only includes directly selected groups, not groups that are selected because the parent is selected
	 */
	static multi_selected: Group[]
	/**
	 * All groups in the current project
	 */
	static all: Group[]
	/** Animator class associated with groups. */
	static animator: BoneAnimator
	/**Check if any groups are in the project */
	static hasAny: () => boolean

	/** Name of the group. */
	name: string
	/** Nodes contained in the group. */
	children: OutlinerNode[]
	/** Pivot point of the group. */
	origin: ArrayVector3
	/** Rotation of the group. */
	rotation: ArrayVector3
	/** Whether the group resets the information of inherited bones in Bedrock Edition. */
	reset: boolean
	/** Whether the contents of the group are shaded. */
	shade: boolean
	/** Whether the group is selected. */
	selected: boolean
	/** Whether the group is visible. */
	visibility: boolean
	/** Auto UV setting for the children, where `0` is disabled, `1` is enabled and `2` is relative auto UV. */
	autouv: 0 | 1 | 2
	/** Whether box UV of the children is mirrored across the X axis. */
	mirror_uv: boolean
	/** Index of the group color. */
	color: number
	/** Whether the group is expanded in the outliner. */
	isOpen: boolean
	/** Whether inverse kinematics is enabled for the group. */
	ik_enabled: boolean
	/** Length of the inverse kinematics chain. */
	ik_chain_length: number
	/** Texture assigned to the group. */
	texture?: string
	/** Original pivot of the group in skin format. */
	skin_original_origin?: ArrayVector3
	/** Bedrock Edition binding expression of the group. */
	bedrock_binding?: string
	/** OptiFine CEM animations assigned to the group. */
	cem_animations?: any[]
	/** Whether the group uses OptiFine CEM attach. */
	cem_attach?: boolean
	/** OptiFine CEM model of the group. */
	cem_model?: string
	/** Scale of the OptiFine CEM model. */
	cem_scale?: number
	/** Three.js object used to display the group. */
	mesh: THREE.Object3D

	[key: string]: any

	/** Preview controller that renders the group. */
	static preview_controller: NodePreviewController

	/**
	 * Applies the provided options to the group.
	 * @param options Options to apply
	 * @returns This group
	 */
	extend(options: Partial<GroupOptions>): this
	/**
	 * Selects the children of the group.
	 * @deprecated No longer has any effect.
	 */
	selectChildren(event: Event): this
	/**
	 * Mark the group as selected
	 */
	markAsSelected(descendants?: boolean): void
	/**
	 * Selects the group.
	 * @param event Event that triggered the selection, or `true` for a plain selection
	 * @param isOutlinerClick Whether the selection was triggered from the outliner
	 * @returns This group
	 */
	select(event?: any, isOutlinerClick?: boolean): this
	/**
	 * Unselects the group.
	 * @returns This group
	 */
	unselect(): this
	/** Returns whether the group is the only selected group and all of its children are selected. */
	matchesSelection(): boolean
	/**
	 * Opens the group and all of its ancestor groups.
	 */
	openUp(): this
	/**
	 * Removes the group
	 * @param undo If true, an undo point will be created.
	 */
	remove(undo?: boolean): this
	/**
	 * Remove the group and leave all of its children in the parent array.
	 */
	resolve(): OutlinerNode[]
	/**
	 * Move the origin of a bone to a specific location without visually affecting the position of it's content.
	 */
	transferOrigin(origin: ArrayVector3): this
	/**
	 * Sort the content of the group alphabetically. This will automatically create an undo point.
	 */
	sortContent(): this
	/**
	 * Duplicate the group
	 */
	duplicate(): Group
	/** Returns a copy of the group as it is saved in the project file. */
	getSaveCopy(): any
	/** Returns a copy of the group without its children. */
	getChildlessCopy(): Group
	/**
	 * Returns the group data used when compiling the model.
	 * @param undo Whether to include data needed to restore the group when undoing
	 */
	compile(undo: boolean): any
	/**
	 * Calls a callback for every descendant of the group.
	 * @param callback Function called for each visited node
	 * @param type Only visit nodes of this type
	 * @param for_self Whether to call the callback for the group itself first
	 */
	forEachChild(callback: (any: OutlinerNode) => void, type?: any, for_self?: boolean): void
}
/** Returns all groups in the current project. */
declare function getAllGroups(): Group[]
