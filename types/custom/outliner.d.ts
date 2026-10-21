/// <reference types="./blockbench"/>
/** Four numbers stored as an array, typically UV or position data. */
type ArrayVector4 = [number, number, number, number]
/** Three numbers stored as an array, typically a position or rotation. */
type ArrayVector3 = [number, number, number]
/** Two numbers stored as an array, typically a UV position. */
type ArrayVector2 = [number, number]
/**
 * Traits of outliner nodes that can contain children.
 */
declare interface OutlinerNodeParentTraits {
	/** Nodes contained in this node. */
	children: OutlinerNode[]
	/** Opens this node and all of its ancestor nodes. */
	openUp(): void
	/** Whether the node is expanded in the outliner. */
	isOpen: boolean
}

/**
 * @deprecated Use {@link Outliner.elements} instead
 */
declare const elements: OutlinerNode[]


/**
 * @private
 */
type ElementTypeConstructor = {
	/**
	 * Creates an element of this type.
	 * @param args Arguments passed to the element constructor
	 */
	new (...args: any[]): OutlinerElement;
	/** Initializes elements of this type after they are created. */
	init?(): void;
	/** Type behavior settings of this element type. */
	behavior: any;
	/** Properties registered for this element type. */
	properties: Record<string, Property<any>>
	/** Elements of this type that are currently selected. */
	selected: OutlinerElement[]
};


/**
 * Options used to create a {@link Locator}.
 */
interface LocatorOptions {
	/** Name of the locator. */
	name: string
	/** Position of the locator. */
	from: ArrayVector3
}
/**
 * An outliner element that marks a point in the model.
 */
declare class Locator extends OutlinerElement {
	/**
	 * Creates a new locator.
	 * @param options Initial locator data
	 * @param uuid UUID assigned to the locator
	 */
	constructor(options: Partial<LocatorOptions>, uuid?: string)
	/** Name of the locator. */
	name: string

	/**
	 * Applies the provided options to the locator.
	 * @param options Options to apply
	 */
	extend(options: Partial<LocatorOptions>): void
	/**
	 * Flips the locator along an axis.
	 * @param axis Axis index
	 * @param center Coordinate to flip around
	 * @returns This locator
	 */
	flip(axis: number, center: number): this
	/** Returns the world position of the locator. */
	getWorldCenter(): THREE.Vector3

	/** All locators in the current project. */
	static all: Locator[]
	/** Currently selected locators. */
	static selected: Locator[]
}

/**
 * Options used to create a {@link NullObject}.
 */
interface NullObjectOptions {
	/** Name of the null object. */
	name?: string
	/** Position of the null object. */
	position?: ArrayVector3
	/** Target of the inverse kinematics constraint. */
	ik_target?: string
	/** Whether the rotation of the inverse kinematics target is locked. */
	lock_ik_target_rotation?: boolean
}
/**
 * An outliner element used as a target for inverse kinematics.
 */
declare class NullObject extends OutlinerElement {
	/**
	 * Creates a new null object.
	 * @param options Initial null object data
	 * @param uuid UUID assigned to the null object
	 */
	constructor(options: Partial<NullObjectOptions>, uuid?: string)
	/** Position of the null object. */
	position: ArrayVector3
	/** Target of the inverse kinematics constraint. */
	ik_target: string
	/** Whether the rotation of the inverse kinematics target is locked. */
	lock_ik_target_rotation: boolean

	/**
	 * Applies the provided options to the null object.
	 * @param options Options to apply
	 */
	extend(options: Partial<NullObjectOptions>): void
	/**
	 * Flips the null object along an axis.
	 * @param axis Axis index
	 * @param center Coordinate to flip around
	 * @returns This null object
	 */
	flip(axis: number, center: number): this
	/** Returns the world position of the null object. */
	getWorldCenter(): THREE.Vector3

	/** All null objects in the current project. */
	static all: NullObject[]
	/** Currently selected null objects. */
	static selected: NullObject[]
}

/**
 * Options used to create a {@link TextureMesh}.
 */
interface TextureMeshOptions {
	/** Name of the mesh. */
	name?: string
	/** Name of the texture used by the mesh. */
	texture_name?: string
	/** Origin of the mesh. */
	origin?: ArrayVector3
	/** Local pivot of the mesh. */
	local_pivot?: ArrayVector3
	/** Rotation of the mesh. */
	rotation?: ArrayVector3
	/** Scale of the mesh. */
	scale?: ArrayVector3
	/** Whether the mesh is locked. */
	locked?: boolean
	/** Whether the mesh is exported. */
	export?: boolean
}
/**
 * An outliner element that displays a textured mesh.
 */
declare class TextureMesh extends OutlinerElement {
	/**
	 * Creates a new texture mesh.
	 * @param options Initial mesh data
	 * @param uuid UUID assigned to the mesh
	 */
	constructor(options: Partial<TextureMeshOptions>, uuid?: string)
	/** Name of the texture used by the mesh. */
	texture_name: string
	/** Local pivot of the mesh. */
	local_pivot: ArrayVector3
	/** Scale of the mesh. */
	scale: ArrayVector3

	/**
	 * Applies the provided options to the mesh.
	 * @param options Options to apply
	 */
	extend(options: Partial<TextureMeshOptions>): void
	/**
	 * Flips the mesh along an axis.
	 * @param axis Axis index
	 * @param center Coordinate to flip around
	 * @returns This mesh
	 */
	flip(axis: number, center: number): this
	/** Returns the world position of the mesh. */
	getWorldCenter(): THREE.Vector3
	/**
	 * Moves the mesh by an offset.
	 * @param offset Offset to apply
	 * @param axis Axis used when the offset is a single number
	 * @param update Whether to update the viewport immediately
	 */
	moveVector(offset: ArrayVector3 | THREE.Vector3, axis: number, update?: boolean): void

	/** All texture meshes in the current project. */
	static all: TextureMesh[]
	/** Currently selected texture meshes. */
	static selected: TextureMesh[]
}

/**
 * Toggle in the outliner
 */
interface OutlinerToggle {
	/** ID of the toggle. */
	id: string
	/** Display title of the toggle. */
	title: string
	/** Icon shown while the toggle is enabled. */
	icon: IconString
	/** Icon shown while the toggle is disabled. */
	icon_off?: IconString
	/** Icon shown while the toggle is in its alternate state. */
	icon_alt?: IconString
	/** Condition that determines whether the toggle is shown. */
	condition?: ConditionResolvable
	/**
	 * If true, the toggle will only be visible when "Toggle More Options" is enabled
	 */
	advanced_option?: boolean
	/**
	 * Override the visibility and still show the toggle under certain conditions, even if more options are disabled
	 */
	visibilityException?: (node: OutlinerNode) => boolean
	/**
	 * Returns the state of the toggle for a node, where `'alt'` selects the alternate icon.
	 * @param node Outliner node the toggle is displayed for
	 */
	getState?: (node: OutlinerNode) => boolean | 'alt'
}

/**
 * Namespace containing outliner state and helper functions.
 */
declare namespace Outliner {
	/** Root nodes of the outliner. */
	let root: OutlinerNode[]
	/** ID of the virtual root parent. */
	const ROOT: 'root'
	/** All elements in the outliner. */
	const elements: OutlinerElement[]
	/** Currently selected elements. */
	const selected: OutlinerElement[]
	/** All nodes in the outliner, including groups. */
	const nodes: OutlinerNode[]
	/** Menu items added to the group control menu. */
	let control_menu_group: MenuItem[]
	/** Outliner toggle buttons keyed by ID. */
	const buttons: {
		/** Auto UV toggle. */
		autouv: OutlinerToggle
		/** Export toggle. */
		export: OutlinerToggle
		/** Lock toggle. */
		locked: OutlinerToggle
		/** UV mirror toggle. */
		mirror_uv: OutlinerToggle
		/** Shade toggle. */
		shade: OutlinerToggle
		/** Visibility toggle. */
		visibility: OutlinerToggle
		[id: string]: OutlinerToggle
	};

	/**
	 * Rule that controls which nodes are displayed in the outliner.
	 */
	interface OutlinerDisplayRule {
		/**
		 * ID of the rule
		 */
		id: string
		/**
		 * A test function to determine if the node should be hidden by the rule
		 * @param node Outliner node (or element) to test
		 */
		test: (node: OutlinerNode) => boolean
	}
	/**
	 * Returns whether the node is displayed in the outliner.
	 * @param node Outliner node to test
	 */
	function isNodeDisplayed(node: OutlinerNode): boolean
	/**
	 * A list of rules regarding which nodes are displayed in the outliner. If any rule returns false, the node is not displayed
	 */
	const node_display_rules: OutlinerDisplayRule[]
	/**
	 * Update which nodes are displayed in the outliner
	 */
	function updateNodeDisplayRules(): void

	/** Returns the outliner structure as an array that can be saved in JSON. */
	function toJSON(): []
	/**
	 * Restores the outliner structure from a saved array.
	 * @param array Structure returned by {@link Outliner.toJSON}
	 * @param add_to_project Whether to add the restored nodes to the project
	 */
	function loadJSON(array: [], add_to_project?: boolean): void;
}



/**
 * Returns the outliner structure as an array that can be saved in JSON.
 * @deprecated Use {@link Outliner.toJSON} instead
 */
declare function compileGroups(undo: boolean, lut?: { [index: number]: number }): any[]

/**
 * Restores the outliner structure from a saved array.
 * @deprecated Use {@link Outliner.loadJSON} instead
 */
declare function parseGroups(array: any[], import_reference?: Group, startIndex?: number): void
