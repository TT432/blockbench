/// <reference types="./blockbench"/>
type ArrayVector4 = [number, number, number, number]
type ArrayVector3 = [number, number, number]
type ArrayVector2 = [number, number]
declare interface OutlinerNodeParentTraits {
	children: OutlinerNode[]
	openUp(): void
	isOpen: boolean
}

declare const elements: OutlinerNode[]
/**
 * @private
 */
declare abstract class OutlinerNode {
	name: string;
	uuid: UUID;
	export: boolean;
	locked: boolean;
	parent: (OutlinerNode & OutlinerNodeParentTraits) | 'root';
	selected: boolean;
	menu?: Menu;
	old_name?: string;
	children?: OutlinerNode[];
	name_regex: ((element?: OutlinerNode) => string | boolean) | undefined;
	static animator?: BoneAnimator;
	static isParent: false;
	static all: OutlinerNode[];
	static selected: OutlinerNode[];
	static preview_controller: NodePreviewController;
	static properties: Record<string, Property<any>>;
	static behavior: Record<string, any>;
	get preview_controller(): NodePreviewController;
	/**
	 * Mark the element as selected
	 */
	markAsSelected(descendants?: boolean): void;
	/**
	 * Displays the context menu of the element
	 * @param event Mouse event, determines where the context menu spawns.
	 */
	showContexMenu(event: Event | HTMLElement): this;
	getSaveCopy?(...args: any[]): Record<string, any>;
	extend?(data: any): void;
	constructor(uuid: UUID);
	/**
	 * Initializes the node. This should always be called when creating nodes that will be used in the outliner.
	 */
	init(): this;
	select(event?: Event, outliner_click?: boolean): false | this;
	unselect(unselect_parent?: boolean): void;
	clickSelect(event: MouseEvent, outliner_click?: boolean): void;
	getTypeBehavior(flag: string): boolean | string | any;
	sortInBefore(element?: OutlinerNode, index_modifier?: number): this;
	addTo(target?: OutlinerNode | 'root', index?: number): this;
	removeFromParent(): this;
	getParentArray(): OutlinerNode[];
	showContextMenu(event: any): this;
	/**
	 * Unfolds the outliner and scrolls up or down if necessary to show the group or element.
	 */
	showInOutliner(): void;
	/**
	 * Updates the Vue node of the element. This is only necessary in some rare situations
	 */
	updateElement(): this;
	get mesh(): import("three").Object3D;
	get scene_object(): THREE.Object3D;
	getDepth(): number;
	duplicate(): OutlinerNode;
	/**
	 * Removes the node.
	 */
	remove(remove_children?: boolean): void;
	/**
	 * Marks the name of the group or element in the outliner for renaming.
	 */
	rename(): this;
	/**
	 * Saves the changed name of the element by creating an undo point and making the name unique if necessary.
	 */
	saveName(save?: boolean): this;
	sanitizeName(): string;
	/**
	 * Create a unique name for the group or element by adding a number at the end or increasing it.
	 */
	createUniqueName(others?: OutlinerNode[]): string | false;
	isIconEnabled(toggle: any): any;
	matchesFilter(search_term_lowercase: any): any;
	/**
	 * Checks of the group or element is a child of `group`.
	 * @param max_levels The maximum number of generations that can be between the element and the group
	 */
	isChildOf(node: OutlinerNode, max_levels: number): boolean;
	static addBehaviorOverride(override_options: {
		condition: ConditionResolvable;
		priority?: number;
		behavior: Record<string, any>;
	}): Deletable;
	static behavior_overrides: any[];
	static uuids: {
		[uuid: UUID]: OutlinerNode;
	};
	type: string;
}


/**
 * @private
 */
type ElementTypeConstructor = {
	new (...args: any[]): OutlinerElement;
	init?(): void;
	behavior: any;
	properties: Record<string, Property<any>>
	selected: OutlinerElement[]
};
interface OutlinerElementData {
	name?: string;
}
declare abstract class OutlinerElement extends OutlinerNode {
	allow_mirror_modeling?: boolean;
	static animator?: BoneAnimator;
	static isParent: false;
	static all: OutlinerElement[];
	static selected: OutlinerElement[];
	constructor(data: OutlinerElementData, uuid?: string);
	init(): this;
	remove(): this;
	showContextMenu(event: MouseEvent): this;
	forSelected(fc: (element: OutlinerElement) => void, undo_tag?: string, selection_method?: 'all_selected' | 'all_in_group'): OutlinerElement[];
	duplicate(): OutlinerElement;
	select(event?: Event, is_outliner_click?: boolean): false | this;
	clickSelect(event: any, outliner_click?: boolean): void;
	markAsSelected(select_children?: boolean): this;
	unselect(unselect_parent?: boolean): this;
	getUndoCopy(): OutlinerElement;
	getSaveCopy(): any;
	static fromSave(obj: any, keep_uuid?: boolean): OutlinerElement;
	static isTypePermitted(type: string): boolean;
	/**Check if any elements of the type are in the project */
	static hasAny(): boolean;
	/**Check if any elements of the type are currently selected */
	static hasSelected(): boolean;
	static types: Record<string, ElementTypeConstructor>;
	static registerType(constructor: ElementTypeConstructor, id: string): void;
}

interface LocatorOptions {
	name: string
	from: ArrayVector3
}
declare class Locator extends OutlinerElement {
	constructor(options: Partial<LocatorOptions>, uuid?: string)
	name: string

	extend(options: Partial<LocatorOptions>): void
	flip(axis: number, center: number): this
	getWorldCenter(): THREE.Vector3

	static all: Locator[]
	static selected: Locator[]
}

interface NullObjectOptions {
	name?: string
	position?: ArrayVector3
	ik_target?: string
	lock_ik_target_rotation?: boolean
}
declare class NullObject extends OutlinerElement {
	constructor(options: Partial<NullObjectOptions>, uuid?: string)
	position: ArrayVector3
	ik_target: string
	lock_ik_target_rotation: boolean

	extend(options: Partial<NullObjectOptions>): void
	flip(axis: number, center: number): this
	getWorldCenter(): THREE.Vector3

	static all: NullObject[]
	static selected: NullObject[]
}

interface TextureMeshOptions {
	name?: string
	texture_name?: string
	origin?: ArrayVector3
	local_pivot?: ArrayVector3
	rotation?: ArrayVector3
	scale?: ArrayVector3
}
declare class TextureMesh extends OutlinerElement {
	constructor(options: Partial<TextureMeshOptions>, uuid?: string)
	texture_name: string
	local_pivot: ArrayVector3
	scale: ArrayVector3

	extend(options: Partial<TextureMeshOptions>): void
	flip(axis: number, center: number): this
	getWorldCenter(): THREE.Vector3
	moveVector(offset: ArrayVector3 | THREE.Vector3, axis: number, update?: boolean): void

	static all: TextureMesh[]
	static selected: TextureMesh[]
}

/**
 * Toggle in the outliner
 */
interface OutlinerToggle {
	id: string
	title: string
	icon: IconString
	icon_off?: IconString
	icon_alt?: IconString
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
	 * It's complicated, check the source code
	 */
	getState?: (node: OutlinerNode) => boolean | 'alt'
}

declare namespace Outliner {
	const root: OutlinerNode[]
	const ROOT: 'root'
	const elements: OutlinerElement[]
	const selected: OutlinerElement[]
	let control_menu_group: MenuItem[]
	const buttons: {
		autouv: OutlinerToggle
		export: OutlinerToggle
		locked: OutlinerToggle
		mirror_uv: OutlinerToggle
		shade: OutlinerToggle
		visibility: OutlinerToggle
		[id: string]: OutlinerToggle
	};
	function toJSON(): []
	function loadJSON(array: [], add_to_project?: boolean): void;
}

declare const markerColors: {
	pastel: string
	standard: string
	id: string
	name?: string
}[]

declare function compileGroups(undo: boolean, lut?: { [index: number]: number }): any[]

declare function parseGroups(array: any[], import_reference?: Group, startIndex?: number): void
