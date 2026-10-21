/// <reference types="./blockbench"/>

type OccupationMatrix = {
	[x: number]: {
		[y: number]: boolean
	}
}
/** The keys of the two vertices that form an edge. */
type MeshEdge = [string, string]

/** Seam marking of a mesh edge, as set by the seam tool. */
type MeshSeamValue = 'auto' | 'divide' | 'join'
/** Options used to create a mesh element. */
interface MeshOptions {
	/** The name of the mesh. */
	name?: string
	/** The marker color index of the mesh. */
	color?: number
	/** Whether the mesh is visible. */
	visibility?: boolean
	/** The rotation of the mesh. */
	rotation?: ArrayVector3
	/** The origin of the mesh, relative to its parent. */
	origin?: ArrayVector3
	/** The vertices of the mesh, mapped by vertex key. */
	vertices?: {
		[vkey: string]: ArrayVector3
	}
}

/** Options used to create a mesh face. */
interface MeshFaceOptions extends FaceOptions {
	/** The keys of the vertices that make up the face. */
	vertices?: string[]
	/** The UV coordinates of each vertex, mapped by vertex key. */
	uv?: { [vkey: string]: ArrayVector2 }
}
/** A polygonal face of a mesh element. */
declare class MeshFace extends Face {
	/**
	 * Creates a face that belongs to the given mesh.
	 * @param mesh The mesh that owns the face.
	 * @param data Initial face data.
	 */
	constructor(mesh: Mesh, data: MeshFaceOptions)
	/**
	 * The vertices that make up the face, as vertex keys. The vertices go around the face counter-clockwise when looking at the front side of the face. That also means that reversing the vertex order reverses the face direction.
	 */
	vertices: string[]
	/** The mesh that owns this face. */
	mesh: Mesh
	/** The UV coordinates of the face, mapped by vertex key. */
	uv: {
		[vertex: string]: ArrayVector2
	}
	/** Applies the given data to the face. */
	extend(data: MeshFaceOptions): this
	/**
	 * Returns the face normal in mesh space as calculated from the vertex positions
	 * @param normalize If true, the values will be normalized.
	 * @param alt_tri On quads, if true, this will return the normal of the second tri instead of the first
	 */
	getNormal(normalize: boolean = false, alt_tri?: boolean): ArrayVector3
	/**
	 * Calculates which pixels the UV face occupies, and returns them as a map
	 */
	getOccupationMatrix(
		texture_space?: boolean,
		start_offset?: ArrayVector2,
		matrix?: OccupationMatrix
	): OccupationMatrix
	/**
	 * Get the keys of this face and all faces that are connected with it on the UV map
	 */
	getUVIsland(): string[]
	/**
	 * Returns the angle between two faces in degrees
	 */
	getAngleTo(other_face: MeshFace): number
	/**
	 * Inverts the direction of the face
	 */
	invert(): void
	/**
	 * Returns whether the face is selected
	 * @param face_key Optional face key of the face, the method runs faster if this is provided
	 */
	isSelected(face_key?: string): boolean
	/**
	 * Returns true if the face is concave
	 */
	isConcave(): boolean
	/**
	 * Returns the vertices of a quad in an order that creates a convex quad shape if possible. If the face has less than 4 vertices, it just returns the vertices in original order.
	 */
	getSortedVertices(): string[]
	/**
	 * Get the adjacent face in the specified side
	 */
	getAdjacentFace(
		side_index: number
	): {
		/** The adjacent face. */
		face: MeshFace
		/** The key of the adjacent face. */
		key: string
		/** The shared edge, as vertex keys. */
		edge: MeshEdge
		/** The index of the shared edge on the adjacent face. */
		index: number
	} | null
	/**
	 * Return all edges of the face
	 */
	getEdges(): [string, string][]
	/**
	 * Returns the face key
	 */
	getFaceKey(): string
	/**
	 * Takes a UV coordinate and turns it into a 3D space coordinate in local space of the mesh. On quads, the first triangle is used for calculation, so the coordinates on warped quads may be inaccurate.
	 */
	UVToLocal(uv: ArrayVector2): THREE.Vector3
	/**
	 * Takes a 3D coordinate in local space of the mesh, and turns it into a coordinate on the UV map using barycentric coordinates. On quads, the first triangle is used for calculation, so the coordinates on warped quads may be inaccurate.
	 */
	localToUV(vector: THREE.Vector3): ArrayVector2
	/**
	 * Get the face center by weight in local space
	 */
	getCenter(): ArrayVector3
}

/** Options used to update a mesh element. */
interface MeshOptions {
	/** The name of the mesh. */
	name?: string
	/** The marker color index of the mesh. */
	color?: number
	/** Whether the mesh is visible. */
	visibility?: boolean
	/** The normal shading mode of the mesh. */
	shading?: 'flat' | 'smooth'
	/** The rotation of the mesh. */
	rotation?: ArrayVector3
	/** The origin of the mesh, relative to its parent. */
	origin?: ArrayVector3
	/** The vertices of the mesh, mapped by vertex key. */
	vertices?: {
		[vkey: string]: ArrayVector3
	}
}
/** A mesh element made of vertices and polygonal faces. */
declare class Mesh extends OutlinerElement {
	/**
	 * Creates a mesh element.
	 * @param options Initial mesh data.
	 * @param uuid The UUID to use for the element.
	 */
	constructor(options: Partial<MeshOptions>, uuid?: string)

	/** The normal shading mode of the mesh. */
	shading: 'flat' | 'smooth'
	/** Whether the mesh is visible. */
	visibility: boolean
	/** The marker color index of the mesh. */
	color: number
	/** The origin of the mesh, relative to its parent. */
	origin: ArrayVector3
	/** The rotation of the mesh. */
	rotation: ArrayVector3

	/** The vertices of the mesh, mapped by vertex key. */
	vertices: {
		[vkey: string]: ArrayVector3
	}
	/** The faces of the mesh, mapped by face key. */
	faces: {
		[fkey: string]: MeshFace
	}
	/** The seam markings of the mesh edges, mapped by edge key. */
	seams: {
		[vkey: string]: MeshSeamValue
	}
	/** The vertex positions of the mesh as a list. */
	vertice_list: ArrayVector3[]
	/** The UUID of the armature that controls the mesh. */
	armature: string

	/** Applies the given options to the mesh. */
	extend(options: Partial<MeshOptions>): this

	/**
	 * Get selected vertices as vertex keys
	 * @param can_write If true, the array can safely be modified to update the selection
	 */
	getSelectedVertices(can_write?: boolean): string[]
	/**
	 * Get selected edges as vertex key pairs
	 * @param can_write If true, the array can safely be modified to update the selection
	 */
	getSelectedEdges(can_write?: boolean): [string, string][]
	/**
	 * Get selected faces as face keys
	 * @param can_write If true, the array can safely be modified to update the selection
	 */
	getSelectedFaces(can_write?: boolean): string[]

	/**
	 * Get the armature if one is attached to the mesh
	 */
	getArmature() : Armature | undefined
	/**
	 * Vertex lists of quads are generally in arbitrary order, the order is calculated when calling getSortedVertices() to account for dfiferent face geometries. Calling this method pre-sorts all faces to allow optimizing subsequent processing
	 */
	sortAllFaceVertices(): void
	/** Returns the smoothed vertex normals of the mesh, mapped by vertex key. */
	calculateNormals(): Record<string, ArrayVector3>

	/**
	 * Sets the seam marking of an edge.
	 * @param value A `MeshSeamValue`, or a falsy value to remove the marking.
	 */
	setSeam(edge: MeshEdge, value: any): void
	/** Returns the seam marking of an edge. */
	getSeam(edge: MeshEdge): MeshSeamValue
	/** Returns the center of the selected vertices in world space. */
	getWorldCenter(ignore_mesh_selection?: boolean): THREE.Vector3
	/** Adds vertices at the given positions and returns their new keys. */
	addVertices(...ArrayVector3: ArrayVector3[]): string[]
	/** Adds faces to the mesh and returns their new keys. */
	addFaces(...MeshFace: MeshFace[]): string[]
	/** Applies the given data to the mesh. */
	extend(data: MeshOptions): void
	/** Returns the copy of the element that is used by the undo system. */
	getUndoCopy(aspects?: any): any
	/** Returns the rotation of the current mesh selection. */
	getSelectionRotation(): THREE.Euler
	/** Returns the center of all vertices, in local or world space. */
	getCenter(global: boolean): THREE.Vector3
	/** Runs the callback for every face of the mesh. */
	forAllFaces(callback: (face: MeshFace, key: string) => void): void
	/** Moves the origin of the mesh without moving its geometry. */
	transferOrigin(origin: ArrayVector3, update?: boolean): void
	/** Sets the marker color index of the mesh. */
	setColor(color: number): void
	/** Rotates the mesh around the given axis by the given number of quarter turns. */
	roll(axis: number, steps: number, origin?: ArrayVector3): void
	/** Mirrors the mesh on the given axis. */
	flip(axis: number): void
	/** Moves the origin of the mesh by the given offset. */
	moveVector(offset: ArrayVector3, axis: number, update?: boolean): void
	/**
	 * Resizes the mesh along the given axis.
	 * @param bidirectional If true, the size change is applied on both sides of the selection center.
	 */
	resize(
		val: number,
		axis: number,
		negative: boolean,
		allow_negative: boolean,
		bidirectional?: boolean
	): void
	/**
	 * Assigns a texture to the faces of the mesh.
	 * @param faces `true` to update all faces, an array of face keys to update specific faces, or nothing to update the selected faces.
	 */
	applyTexture(texture: Texture, faces?: true | undefined | string[]): void

	/** All mesh elements in the project. */
	static all: Mesh[]
	/** All selected mesh elements. */
	static selected: Mesh[]
	/**Check if any elements of the type are in the project */
	static hasAny: () => boolean
	/**Check if any elements of the type are currently selected */
	static hasSelected: () => boolean
}

/** Options used to extend a mesh face. */
interface MeshFaceOptions extends FaceOptions {}
