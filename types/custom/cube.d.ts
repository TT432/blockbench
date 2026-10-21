/// <reference types="./blockbench"/>
/**
 * Names of the six cube face directions.
 */
type CardinalDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

/**
 * Options used to create a {@link Cube}.
 */
interface ICubeOptions {
	/** Name of the cube. */
	name?: string
	/** Auto UV mode, where `0` is disabled, `1` is enabled and `2` is relative auto UV. */
	autouv?: 0 | 1 | 2
	/** Whether shading based on the face normal is enabled. */
	shade?: boolean
	/** Whether box UV is mirrored across the X axis. */
	mirror_uv?: boolean
	/** Inflation value added to all sides equally. */
	inflate?: number
	/** Index of the cube color. */
	color?: number
	/** Whether the cube is visible in the viewport. */
	visibility?: boolean
	/** Start corner of the cube. */
	from?: ArrayVector3
	/** End corner of the cube. */
	to?: ArrayVector3
	/** Rotation of the cube. */
	rotation?: ArrayVector3
	/** Rotation pivot of the cube. */
	origin?: ArrayVector3
	/** Stretch factor applied to the cube. */
	stretch?: ArrayVector3
	/** Whether the cube uses box UV. */
	box_uv?: boolean
	/**
	 * UV position for box UV mode
	 */
	uv_offset?: ArrayVector2
	/** Face data keyed by face direction. */
	faces?: Partial<Record<CardinalDirection, CubeFaceOptions>>
}

/**
 * An outliner element that represents a cuboid.
 */
declare class Cube extends OutlinerElement {
	/**
	 * Creates a new cube.
	 * @param options Initial cube data
	 * @param uuid UUID assigned to the cube
	 */
	constructor(options: ICubeOptions, uuid?: string)
	/** Name of the cube. */
	name: string
	/** Unique identifier of the cube. */
	uuid: string
	/** Index of the cube color. */
	color: any
	/**
	 * Auto UV setting, saved as an integer, where 0 means disabled, 1 means enabled, and 2 means relative auto UV (cube position affects UV)
	 */
	autouv: 0 | 1 | 2
	/**
	 * Enable or disable shading based on face normal
	 */
	shade: boolean
	/**
	 * UV mirror across the X axis when using Box UV
	 */
	mirror_uv: boolean
	/**
	 * If the cube is using Box UV
	 */
	box_uv: boolean
	/**
	 * Inflate adds an inflation value to all sides equally
	 */
	inflate: number
	/**
	 * Visibility of the cube in the viewport
	 */
	visibility: boolean
	/** Light level emitted by the cube, from `0` to `15`. */
	light_emission: number
	/** Direction used for shading, or an empty string to use the generic behavior. */
	shade_direction_override: any
	/** Start corner of the cube. */
	from: ArrayVector3
	/** End corner of the cube. */
	to: ArrayVector3
	/** Rotation of the cube. */
	rotation: ArrayVector3
	/** Rotation pivot of the cube. */
	origin: ArrayVector3
	/** Stretch factor applied to the cube. */
	stretch: ArrayVector3
	/** Cube faces keyed by face direction. */
	faces: {
		[fkey: string]: CubeFace
	}
	/** Whether the cube is rescaled when it is rotated. */
	rescale?: boolean
	/** Axis around which the cube is rotated. */
	rotation_axis: 'x' | 'y' | 'z'
	/**
	 * UV position for box UV mode
	 */
	uv_offset: ArrayVector2
	/** Three.js mesh used to display the cube. */
	mesh: THREE.Mesh & {
		/** Mesh used to display the cube outline. */
		outline: THREE.Mesh
		/** Geometry of the cube. */
		geometry: THREE.BufferGeometry & {
			/** Face directions of the geometry faces. */
			faces: string[]
		}
	}

	/**
	 * Applies the provided options to the cube.
	 * @param options Options to apply
	 * @returns This cube
	 */
	extend(options: ICubeOptions): this
	/**
	 * Calculates and returns the size of the cube
	 */
	size(): ArrayVector3
	/**
	 * Calculates and returns the size of a cube on a certain axis
	 * @param axis Axis index
	 * @param floored Whether to floor the returned size
	 */
	size(axis: number, floored?: boolean): number
	/** Returns the letter of the axis used for rotation. */
	rotationAxis(): string
	/** Returns a copy of the cube used to restore its state when undoing. */
	getUndoCopy(aspects?: any): any
	/** Returns a copy of the cube as it is saved in the project file. */
	getSaveCopy(): Cube
	/**
	 * Rotate the cube around axis in 90 degree steps
	 * @param axis Axis index
	 * @param steps Number of steps
	 * @param origin Rotation pivot
	 */
	roll(axis: number, steps: number, origin: ArrayVector3): void
	/**
	 * Flips the cube along an axis.
	 * @param axis Axis index
	 * @param center Coordinate to flip around
	 * @param skipUV Whether to leave the UV data unchanged
	 */
	flip(axis: number, center: number, skipUV?: boolean): void
	/**
	 * Transfer the origin to a new position, while updating from and to to keep the same visual position.
	 */
	transferOrigin(origin: ArrayVector3, update?: boolean): void
	/** Returns the world position of the cube center. */
	getWorldCenter(): THREE.Vector3
	/** Returns the world positions of the cube corners. */
	getGlobalVertexPositions(): ArrayVector3[]
	/**
	 * Switches the cube between box UV and per-face UV.
	 * @param box_uv Whether to use box UV
	 */
	setUVMode(box_uv: boolean): void
	/**
	 * Sets the color index of the cube.
	 * @param color Index of the cube color
	 */
	setColor(color: number): void
	/**
	 * Assigns a texture to the specified faces.
	 * @param texture Texture to apply
	 * @param faces `true` for all faces, or the list of face directions to change
	 */
	applyTexture(texture: Texture, faces: true | undefined | CubeFaceDirection[]): void
	/** Applies automatic UV mapping to the cube. */
	mapAutoUV(): void
	/**
	 * Moves the cube by an offset.
	 * @param offset Offset to apply
	 * @param axis Axis used when the offset is a single number
	 * @param update Whether to update the viewport immediately
	 */
	moveVector(offset: ArrayVector3, axis: number, update?: boolean): void
	/**
	 * Resizes the cube along an axis.
	 * @param value Amount to resize by
	 * @param axis Axis index
	 * @param negative Whether to resize the negative side
	 * @param allow_negative Whether the cube may be resized past its opposite side
	 * @param bidirectional Whether to resize both sides
	 */
	resize(
		value: number,
		axis: number,
		negative: boolean,
		allow_negative?: boolean,
		bidirectional?: boolean
	): void

	/** All cubes in the current project. */
	static all: Cube[]
	/** Currently selected cubes. */
	static selected: Cube[]
	/**Check if any elements of the type are in the project */
	static hasAny: () => boolean
	/**Check if any elements of the type are currently selected */
	static hasSelected: () => boolean
	/** Preview controller that renders the cube. */
	preview_controller: NodePreviewController
	/** Preview controller that renders cubes. */
	static preview_controller: NodePreviewController
}

/**
 * Common options shared by the faces of outliner elements.
 */
interface FaceOptions {
	/** Texture applied to the face, or `false` to clear it. */
	texture?: Texture | UUID | false
}

/**
 * Face direction of a cube.
 */
type CubeFaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
/**
 * Options used to create a {@link CubeFace}.
 */
interface CubeFaceOptions extends FaceOptions {
	/** UV rectangle in the format `[u1, v1, u2, v2]`. */
	uv?: [number, number, number, number]
	/** Rotation of the face texture. */
	rotation?: number
	/** Tint color index applied to the face. */
	tint?: number
	/** Face direction used for culling, or an empty string for none. */
	cullface?: CubeFaceDirection | ''
	/** Name of the material assigned to the face. */
	material_name?: string
	/** Whether the face is enabled. */
	enabled?: boolean
}
/**
 * A single face of a cube.
 */
declare class CubeFace extends Face {
	/**
	 * Creates a new cube face.
	 * @param direction Direction the face points to
	 * @param data Initial face data
	 * @param cube Cube that owns the face
	 */
	constructor(direction: CubeFaceDirection, data: CubeFaceOptions, cube: Cube)
	/** Cube that owns the face. */
	cube: Cube
	/** Direction the face points to. */
	direction: CubeFaceDirection
	/** UV rectangle in the format `[u1, v1, u2, v2]`. */
	uv: [number, number, number, number]
	/** Width and height of the face UV rectangle. */
	uv_size: readonly [number, number]
	/** Rotation of the face texture. */
	rotation: number
	/** Tint color index applied to the face. */
	tint: number
	/** Face direction used for culling, or an empty string for none. */
	cullface: CubeFaceDirection | ''
	/** Name of the material assigned to the face. */
	material_name: string
	/** Whether the face is enabled. */
	enabled: boolean

	/**
	 * Applies the provided options to the face.
	 * @param data Options to apply
	 * @returns This face
	 */
	extend(data: CubeFaceOptions): this
	/** Returns the indices of the cube corners that make up the face. */
	getVertexIndices(): [number, number, number, number]
}

/** Helper object for billboard elements. */
declare const Billboard: any
/** Helper object for billboard elements. */
declare type Billboard = any
