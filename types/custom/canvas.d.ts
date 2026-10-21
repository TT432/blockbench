/// <reference types="./blockbench"/>
interface UpdateViewOptions {
	/**
	 * List of elements to update
	 */
	elements?: OutlinerElement[]
	/**
	 * Which aspects of the elements to update
	 */
	element_aspects?: {
		/**
		 * Update visibility of elements
		 */
		visibility?: boolean
		/**
		 * Update the position and geometry
		 */
		geometry?: boolean
		/**
		 * Update the mesh faces
		 */
		faces?: boolean
		/**
		 * Update the UV mapping
		 */
		uv?: boolean
		/**
		 * Update the painting grid
		 */
		painting_grid?: boolean
		/**
		 * Update the transform of elements
		 */
		transform?: boolean
	}
	/**
	 * Groups to update
	 */
	groups?: Group[]
	/**
	 * Which aspects of the groups to update
	 */
	group_aspects?: {
		/**
		 * Update the transform of elements
		 */
		transform?: boolean
		/**
		 * Update visibility of elements
		 */
		visibility?: boolean
	}
	/**
	 * Whether to update the selection (updates the selection outlines and interface)
	 */
	selection?: boolean
}

/**
 * A global namespace handling miscellaneous functionality related to the 3D preview
 */
declare namespace Canvas {
	/**
	 * Colors used by the helpers of the 3D scene, indexed by color name
	 */
	const gizmo_colors: Record<string, THREE.Color>
	/**
	 * Materials indexed by UUID
	 */
	const materials: {
		[uuid: UUID]: THREE.Material
	}
	/**
	 * Materials used to render elements without a texture, indexed by marker color index
	 */
	const emptyMaterials: {
		[uuid: UUID]: THREE.Material
	}
	/**
	 * Materials used to render elements in a solid marker color, indexed by marker color index
	 */
	const coloredSolidMaterials: THREE.ShaderMaterial[]
	/**
	 * Meshes indexed by UUID
	 */
	const meshes: {
		[uuid: UUID]: THREE.Mesh
	}
	/**
	 * Bones indexed by UUID
	 */
	const bones: {
		[uuid: UUID]: THREE.Object3D
	}
	/**
	 * Group object that contains the outlines created by `outlineObjects`
	 */
	let outlines: THREE.Object3D
	/**
	 * Main scene, shared across all tabs
	 */
	const scene: THREE.Scene
	/**
	 * List of the gizmos (control and UI elements) in the 3D scene
	 */
	const gizmos: THREE.Object3D[]
	/**
	 * The material used for all selection outlines
	 */
	const outlineMaterial: THREE.LineBasicMaterial
	/**
	 * The material used for the outlines of unselected elements
	 */
	const outlineUnselectedMaterial: THREE.LineBasicMaterial
	/**
	 * The material used for the outlines of mesh elements
	 */
	const meshOutlineMaterial: THREE.LineBasicMaterial
	/**
	 * The material used for onion skin copies of keyframes before the current time
	 */
	const onionSkinEarlierMaterial: THREE.LineBasicMaterial
	/**
	 * The material used for onion skin copies of keyframes after the current time
	 */
	const onionSkinLaterMaterial: THREE.LineBasicMaterial
	/**
	 * The material used for the wireframe view
	 */
	const wireframeMaterial: THREE.MeshBasicMaterial
	/**
	 * The shader material used to render elements in a solid color
	 */
	const solidMaterial: THREE.ShaderMaterial
	/**
	 * The material used for the normal helper view mode
	 */
	const normalHelperMaterial: THREE.ShaderMaterial
	/**
	 * The material used for the UV helper view mode
	 */
	const uvHelperMaterial: THREE.ShaderMaterial
	/**
	 * The material used for the vertex points of mesh elements
	 */
	const meshVertexMaterial: THREE.PointsMaterial
	/**
	 * The invisible material assigned to element faces that have no texture
	 */
	const transparentMaterial: THREE.MeshBasicMaterial
	/**
	 * The material used for the grids
	 */
	const gridMaterial: THREE.LineBasicMaterial

	/**
	 * Object that marks the origin or pivot point of the selected element
	 */
	const pivot_marker: THREE.Object3D

	/**
	 * The plane below the model that the ground display slot uses
	 */
	const ground_plane: THREE.Mesh
	/**
	 * The mesh that draws the outline of the brush in paint mode
	 */
	const brush_outline: THREE.Mesh

	/**
	 * Whether gizmos are visible in the preview
	 */
	let show_gizmos: boolean
	/**
	 * Whether markers of elements such as locators and null objects are visible
	 */
	let show_element_markers: boolean
	/**
	 * Whether the ground display animation is running
	 */
	let ground_animation: boolean

	/**
	 * Color of the global light used by the display mode materials
	 */
	const global_light_color: THREE.Color
	/**
	 * Light side constant passed to the display mode materials
	 */
	let global_light_side: number

	/**
	 * Face keys of cubes, in the order their material groups are stored in the geometry
	 */
	const face_order: ['east', 'west', 'up', 'down', 'south', 'north']

	/**
	 * The line helper drawn at the hovered position in the viewport
	 */
	const hover_helper_line: THREE.LineSegments
	/**
	 * The vertex marker drawn at the hovered position in the viewport
	 */
	const hover_helper_vertex: THREE.Points

	/**
	 * Raycast on the currently selected preview
	 */
	function raycast(event: MouseEvent): any
	/**
	 * Execute the callback function without any gizmos, grids and helpers visible
	 */
	function withoutGizmos(cb: () => void): void
	/**
	 * Clear all elements from the scene
	 */
	function clear(): void
	/**
	 * Rebuild the grid in the preview according to the current settings
	 */
	function buildGrid(): void
	/**
	 * Update the scene lights and the shading uniforms according to the current settings
	 */
	function updateShading(): void
	/**
	 * Redraw all faces and shading after the view mode changed
	 */
	function updateViewMode(): void
	/**
	 * Update the hover highlights of all elements
	 * @param hover_cube The element that is currently hovered
	 * @param force_off Whether to hide all highlights instead of showing the hovered one
	 */
	function updateCubeHighlights(hover_cube: OutlinerElement, force_off?: boolean): void
	/**
	 * Updates selected aspects of the preview
	 * @param options
	 */
	function updateView(options: UpdateViewOptions): void
	/**
	 * Regenerate all elements in the scene. Very unoptimized, use with care
	 */
	function updateAll(): void
	/**
	 * Update the position and shape of all elements
	 */
	function updateAllPositions(): void
	/**
	 * Update the visibility of all elements
	 */
	function updateVisibility(): void
	/**
	 * Update all faces in the scene
	 * @param texture Texture filter. If specified, only faces with this texture will be updated
	 */
	function updateAllFaces(texture?: Texture): void
	/**
	 * Update all UV maps in the scene
	 */
	function updateAllUVs(): void
	/**
	 * Returns the three.js render sides based on the current settings and state
	 */
	function getRenderSide(): number
	/**
	 * Update render sides of all materials
	 */
	function updateRenderSides(): void
	/**
	 * Redraw the selected elements in the scene
	 * @param arr Optionally specify an array of elements to update
	 */

	function updateSelected(arr: any): void
	/**
	 * Update positions and shapes of the selected elements
	 */
	function updatePositions(y?: number): void
	/**
	 * Update the faces of all selected elements (material, UV map)
	 */
	function updateSelectedFaces(): void
	/**
	 * Update the UV maps of all selected elements
	 */
	function updateUVs(): void
	/**
	 * Update the hierarchy and position of all bones
	 */
	function updateAllBones(bones?: OutlinerNode[]): void
	/**
	 * Update the position of the origin / pivot point gizmo
	 */
	function updatePivotMarker(): boolean
	/**
	 * Update the position and shape of the specified cube
	 * @param cube Cube to update
	 * @param mesh Mesh instance of the cube
	 */
	function adaptObjectPosition(cube: Cube, mesh?: THREE.Mesh): void
	/**
	 * Update the geometry faces of the specified cube
	 * @param cube Cube to update
	 */
	function adaptObjectFaceGeo(cube: any): void
	/**
	 * Update the faces (material) of the specified cube
	 * @param cube Cube to update
	 * @param mesh Mesh instance of the cube
	 */
	function adaptObjectFaces(cube: any, mesh: any): void
	/**
	 * Update the layered or not layered material of all elements
	 */
	function updateLayeredTextures(): void
	/**
	 * Update the UV map of the specified cube
	 * @param cube Cube to update
	 * @param animation Whether to display the current animated texture frame
	 */
	function updateUV(cube: Cube, animation?: boolean): any
	/**
	 * Update the materials of marker colors if new colors were added
	 */
	function updateMarkerColorMaterials(): void
	/**
	 * Create an additional outline around the specified cubes
	 * @param arr List of cubes to outline
	 */
	function outlineObjects(arr: Cube[]): void
	/**
	 * Calculate the size of the model, in the currently displayed shape. Returns [width, height] in blockbench units
	 */
	function getModelBoundingBox(): THREE.Box3
	/**
	 * Return the width and height of the model, in blockbench units
	 */
	function getModelSize(): [number, number]
	/**
	 * Return the bounding box of the selected elements
	 */
	function getSelectionBounds(): THREE.Box3
}

/**
 * Marks a specific aspect of the interface to be updated in the next tick. Useful to avoid an update function getting called multiple times in the same task.
 */
declare namespace TickUpdates {
	private function Run(): void
	/**
	 * Marks the interface for an update in the next tick
	 */
	let interface: undefined | true
	/**
	 * Marks the outliner for an update in the next tick
	 */
	let outliner: undefined | true
	/**
	 * Marks the outliner selection for an update in the next tick
	 */
	let selection: undefined | true
	/**
	 * Marks the main UV editor for an update in the next tick
	 */
	let main_uv: undefined | true
	/**
	 * Marks the texture list for an update in the next tick
	 */
	let texture_list: undefined | true
	/**
	 * Marks the keyframe timeline for an update in the next tick
	 */
	let keyframes: undefined | true
	/**
	 * Marks the keyframe selection for an update in the next tick
	 */
	let keyframe_selection: undefined | true
	/**
	 * Marks the keybind conflict check for an update in the next tick
	 */
	let keybind_conflicts: undefined | true
}

/**
 * Options that define the behavior of a `NodePreviewController`
 */
interface NodePreviewControllerOptions {
	/**
	 * NOTE: This option is just for type checking and should not be set in the options object. It should be set inside of the setup function via `this.mesh`
	 *
	 * ```
	 * setup(element) {
	 *    this.mesh = new THREE.Mesh()
	 * }
	 * ```
	 */
	mesh?: THREE.Object3D | THREE.Mesh
	/**
	 * Called to create or update the mesh of an element
	 */
	setup?(element: OutlinerNode): void
	/**
	 * Called when the mesh of an element is removed from the scene
	 */
	remove?(element: OutlinerNode): void
	/**
	 * Called to update every aspect of the preview of an element
	 */
	updateAll?(element: OutlinerNode): void
	/**
	 * Called to update the position, rotation and scale of the mesh of an element
	 */
	updateTransform?(element: OutlinerNode): void
	/**
	 * Called to update the visibility of the mesh of an element
	 */
	updateVisibility?(element: OutlinerNode): void
	/**
	 * Called to update the selection outline of an element
	 */
	updateSelection?(element: OutlinerNode): void
	/**
	 * Called to update the geometry of the mesh of an element
	 */
	updateGeometry?(element: OutlinerNode): void
	/**
	 * Called to update the UV mapping of the faces of an element
	 */
	updateUV?(element: OutlinerNode): void
	/**
	 * Called to update the materials of the faces of an element
	 */
	updateFaces?(element: OutlinerNode): void
	/**
	 * Called to update the painting grid of an element
	 */
	updatePaintingGrid?(element: OutlinerNode): void
	/**
	 * Called to update the hover highlight of an element
	 * @param element The element whose highlight is updated
	 * @param args Additional arguments passed through from the caller
	 */
	updateHighlight?(element: OutlinerNode, ...args: any[]): void
	[key: string]: any
}
/**
 * Context passed to `viewportRectangleOverlap` when elements are selected with a rectangle
 */
interface ViewportRectangleOverlapContext {
	/**
	 * Projects a position in the scene to viewport coordinates
	 */
	projectPoint: (vector: THREE.Vector3) => ArrayVector2
	/**
	 * Whether the current selection is extended instead of replaced
	 */
	extend_selection: boolean
	/**
	 * First corner of the selection rectangle
	 */
	rect_start: ArrayVector2
	/**
	 * Second corner of the selection rectangle
	 */
	rect_end: ArrayVector2
	/**
	 * The preview in which the selection is made
	 */
	preview: Preview
}
/**
 * Controls how an element type is represented and updated in the 3D preview
 */
declare class NodePreviewController {
	/**
	 * Creates a preview controller for the given element type and registers it on that type
	 */
	constructor(
		type: typeof OutlinerElement | typeof OutlinerNode,
		options: NodePreviewControllerOptions
	)
	/**
	 * The element type this controller belongs to
	 */
	type: typeof OutlinerNode
	/**
	 * Registered event listeners, indexed by event name
	 */
	events: {
		[event_name: string]: ((data: any) => void)[]
	}
	/**
	 * The mesh that represents the element in the scene
	 */
	mesh: THREE.Object3D | THREE.Mesh
	/**
	 * Dispatches an event to all listeners registered for that event name
	 */
	dispatchEvent(event_name: string, data: Record<string, any>): void
	/**
	 * Adds an event listener
	 */
	on(event_name: string, cb: (data: any) => void): void
	/**
	 * Adds a single-use event listener
	 */
	once(event_name: string, cb: (data: any) => void): void
	/**
	 * Removes an event listener
	 */
	removeListener(event_name: string, cb: (data: any) => void): void

	/**
	 * Creates the mesh of the element and adds it to the scene
	 */
	setup(element: OutlinerNode): void
	/**
	 * Removes the mesh of the element from the scene and disposes its geometry
	 */
	remove(element: OutlinerNode): void
	/**
	 * Updates every aspect of the preview of the element
	 */
	updateAll(element: OutlinerNode): void
	/**
	 * Updates the position, rotation and scale of the element mesh
	 */
	updateTransform(element: OutlinerNode): void
	/**
	 * Updates the visibility of the element mesh
	 */
	updateVisibility(element: OutlinerNode): void
	/**
	 * Updates the selection outline of the element mesh
	 */
	updateSelection(element: OutlinerNode): void
	/**
	 * Updates the geometry of the element mesh
	 */
	updateGeometry(instance: OutlinerNode): void
	/**
	 * Updates the UV mapping of the element mesh
	 */
	updateUV(instance: OutlinerNode): void
	/**
	 * Updates the materials of the element mesh faces
	 */
	updateFaces(instance: OutlinerNode): void
	/**
	 * Updates the painting grid of the element mesh
	 */
	updatePaintingGrid(instance: OutlinerNode): void
	/**
	 * Updates the hover highlight of the element mesh
	 * @param instance The element whose highlight is updated
	 * @param args Additional arguments passed through from the caller
	 */
	updateHighlight(instance: OutlinerNode, ...args: any[]): void
	/**
	 * Returns whether the element is inside the selection rectangle
	 * @param element The element to test
	 * @param context Selection rectangle and projection data
	 */
	viewportRectangleOverlap(element: OutlinerNode, context: ViewportRectangleOverlapContext)
}
