import three from 'three'

/**
 * Additional properties that Blockbench adds to Three.js.
 */
declare module 'three' {
	/**
	 * The extension of the Three.js `Object3D` class used by Blockbench.
	 */
	interface Object3D {
		/**The outline mesh of the mesh */
		outline?: three.Object3D | three.Mesh
		/**
		 * The base rotation of the object, restored when the default pose is displayed.
		 */
		fix_rotation?: three.Euler
		/**
		 * The base position of the object, restored when the default pose is displayed.
		 */
		fix_position?: three.Vector3
		/**
		 * Whether the object is skipped when the scene is exported.
		 */
		no_export?: boolean
		/**
		 * Whether the object is the mesh of an outliner element.
		 */
		isElement?: boolean
		/**
		 * Whether the object is the mesh of a group.
		 */
		isGroup?: boolean
	}
}
