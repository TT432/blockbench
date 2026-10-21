/// <reference types="./blockbench"/>

type ConditionResolvable<Context extends any = any> =
	| undefined
	| boolean
	| ((context: Context) => boolean)
	| Partial<{
			/** Editor mode IDs in which the condition can be true. */
			modes: string[]
			/** Project format IDs in which the condition can be true. */
			formats: string[]
			/** Tool IDs in which the condition can be true. */
			tools: string[]
			/** Format features that must be available. */
			features: (string | keyof FormatFeatures)[]
			/** Selection state the condition is checked against. */
			selected: {
				/** Requires (`true`) or forbids (`false`) a selected animation. */
				animation?: boolean
				/** Requires (`true`) or forbids (`false`) a selected animation controller. */
				animation_controller?: boolean
				/** Requires (`true`) or forbids (`false`) a selected animation controller state. */
				animation_controller_state?: boolean
				/** Requires (`true`) or forbids (`false`) selected keyframes. */
				keyframe?: boolean
				/** Requires (`true`) or forbids (`false`) a selected group. */
				group?: boolean
				/** Requires (`true`) or forbids (`false`) a selected texture. */
				texture?: boolean
				/** Requires (`true`) or forbids (`false`) selected outliner elements. */
				element?: boolean
				/** Requires (`true`) or forbids (`false`) selected cubes. */
				cube?: boolean
				/** Requires (`true`) or forbids (`false`) selected meshes. */
				mesh?: boolean
				/** Requires (`true`) or forbids (`false`) selected locators. */
				locator?: boolean
				/** Requires (`true`) or forbids (`false`) selected null objects. */
				null_any?: boolean
				/** Requires (`true`) or forbids (`false`) selected texture meshes. */
				texture_mesh?: boolean
				/** Requires (`true`) or forbids (`false`) a selected outliner element or group. */
				outliner?: boolean
				/** Requires (`true`) or forbids (`false`) selected splines. */
				spline?: boolean
			}
			/** Requires an open project. */
			project: boolean
			/** Additional check that receives the context of the condition. */
			method(context: Context): boolean
	  }>

/**
 * Tests if a condition is truthy or falsy. Returns true if the condition is unspecified
 * @param condition Boolean, function, any or anything else
 */
declare function Condition<Context extends any = any>(condition: ConditionResolvable<Context>, context?: Context): boolean


/**
 * If the input event is a touch event, convert touch event to a compatible mouse event
 */
declare function convertTouchEvent(event: MouseEvent): MouseEvent

/**
 * Adds an event listener to an element, except that is supports multiple event types simultaneously
 * @param element Target Element
 * @param events Event types, separated by space characters
 * @param func Function
 * @param option Option
 */
declare function addEventListeners(
	element: HTMLElement | Document,
	events: string,
	func: (event: Event) => void,
	option?: any
): void
/**
 * Removes event listeners from an element for multiple event types at once.
 * @param el Target element.
 * @param events Event types, separated by space characters.
 * @param func Listener function.
 * @param option Listener options.
 */
declare function removeEventListeners(
	el: HTMLElement | Document,
	events: string,
	func: (event: Event) => void,
	option?: any
): void

/**
 * @deprecated Use {@link VersionUtil.compare} instead.
 */
declare function compareVersions(versionA: any, versionB: any): boolean
/**
 * Sets properties such as clientX on a TouchEvent based on touches. The use of the PointerEvent API is recommended instead.
 * @param event 
 */
declare function convertTouchEvent(event: TouchEvent | MouseEvent): MouseEvent
/**
 * Generate a new random UUID
 */
declare function guid(): string
/**
 * Returns true if the passed input is a UUID
 */
declare function isUUID(s: string): boolean
/**
 * Generates a random alphanumeric ID of the given length.
 */
declare function bbuid(length: number): string
/**
 * Formats a number with a limited number of decimal places, without trailing zeros.
 * @param value The number to format.
 * @param decimal_places Maximum number of decimal places.
 */
declare function trimFloatNumber(value: number, decimal_places: number = 4): string
/**
 * Returns the axis letter (`x`, `y` or `z`) for an axis index.
 */
declare function getAxisLetter(axisNumber: number): string
/**
 * Returns the axis index for an axis letter.
 */
declare function getAxisNumber(axisLetter: string): number
/**
 * Limits a number to the range between `min` and `max`.
 */
declare function limitNumber(number: any, min: any, max: any): any
/**
 * Returns the key of the entry with the highest numeric value, or the lowest when `inverse` is true.
 */
declare function highestInObject(obj: any, inverse: any): string
/**
 * Returns the rectangle spanned by two points, with ordered corners and its size.
 */
declare function getRectangle(
	a: any,
	b: any,
	c: any,
	d: any
): {
	/** Ordered x coordinate of the first corner. */
	ax: any
	/** Ordered y coordinate of the first corner. */
	ay: any
	/** Ordered x coordinate of the second corner. */
	bx: any
	/** Ordered y coordinate of the second corner. */
	by: any
	/** Horizontal extent between the ordered corners. */
	x: number
	/** Width of the rectangle. */
	w: number
	/** Vertical extent between the ordered corners. */
	y: number
	/** Height of the rectangle. */
	h: number
}
/**
 * Returns true if the two rectangles overlap.
 */
declare function doRectanglesOverlap(rect1: any, rect2: any): boolean
/**
 * Returns a copy of an object without the given keys.
 * @param dual_level When true, also omits the keys from one level of nested objects.
 */
declare function omitKeys(obj: any, keys: any, dual_level?: boolean): {}
/**
 * Returns the value of a key in an object, or the default value when the key is missing.
 */
declare function get(options: any, name: any, defaultValue: any): any
/**
 * Returns the first key of an object that has the given value.
 */
declare function getKeyByValue(any: any, value: any): any
/**
 * Registers a function to run when a Vue component is set up.
 */
declare function onVueSetup(func: any): void
/**
 * Returns the string with its first character converted to upper case.
 */
declare function capitalizeFirstLetter(string: any): any
/**
 * Returns `s` unless the input has a length of one, in which case it returns an empty string.
 */
declare function pluralS(arr: any): '' | 's'
/**
 * Returns the file name of a path.
 * @param extension When true, the file extension is kept.
 */
declare function pathToName(path: string, extension: boolean = false): string | ''
/**
 * Returns the lowercase file extension of a path without the dot, or an empty string when there is none.
 */
declare function pathToExtension(path: string): string | ''
/**
 * Converts a packed integer into separate red, green, blue and alpha channels.
 */
declare function intToRGBA(int: any): {
	/** Red channel value. */
	r: number
	/** Green channel value. */
	g: number
	/** Blue channel value. */
	b: number
	/** Alpha channel value. */
	a: number
}
/**
 * Returns the average color of the opaque pixels of an image.
 * @param imgEl The image element to sample.
 * @param blockSize Step between the sampled pixels.
 */
declare function getAverageRGB(
	imgEl: any,
	blockSize: any
): {
	/** Average red channel value. */
	r: number
	/** Average green channel value. */
	g: number
	/** Average blue channel value. */
	b: number
}
/**
 * Returns the integer as a string with thousands separators.
 */
declare function stringifyLargeInt(int: any): any
/**
 * Returns true if the line segment from `p1` to `p2` intersects the segment from `p3` to `p4`.
 */
declare function intersectLines(p1: any, p2: any, p3: any, p4: any): boolean
/**
 * Returns true if the point lies strictly inside the rectangle given by its start and end corners.
 */
declare function pointInRectangle(point: any, rect_start: any, rect_end: any): boolean
/**
 * Returns true if the line segment intersects the rectangle or lies inside it.
 */
declare function lineIntersectsRectangle(p1: any, p2: any, rect_start: any, rect_end: any): boolean
/**
 * Returns the camera rotation that looks from a position towards a target.
 */
declare function cameraTargetToRotation(position: any, target: any): any[]
/**
 * Returns the point that a camera at the given position looks at with the given rotation.
 */
declare function cameraRotationToTarget(position: any, rotation: any): any

/**
 * Tests if a condition is truthy or falsy.
 * @param condition Input condition. Can be undefined, a boolean, a function or a condition object.
 * @param context Context passed to function conditions.
 */
declare function Condition(condition: (() => boolean) | undefined | boolean, context: any): boolean
/**
 * Evaluates conditions that describe when an action or a control is available.
 */
declare namespace Condition {
	/**
	 * Returns true if the two conditions can never be true at the same time.
	 */
	function mutuallyExclusive(a: any, b: any): boolean
}
/**
 * Runs a function for every index, waiting for each call to continue with the next one.
 * @param o Loop options with the length, the function to loop and the completion callback.
 */
declare function asyncLoop(o: any): void
/**
 * Helpers for comparing plain objects.
 */
declare namespace Objector {
	/**
	 * Returns true if both objects have the same own keys.
	 */
	function equalKeys(obj: any, ref: any): boolean
	/**
	 * Returns the number of own keys of an object.
	 */
	function keyLength(obj: any): number
}
/**
 * Helpers that merge values from a source object into a target object.
 */
declare namespace Merge {
	/**
	 * Assigns the source value when it can be parsed as a number.
	 */
	export function number(obj: any, source: any, index?: any): void
	/**
	 * Assigns the source value as a string.
	 * @param validate Optional check that must return true for the value to be assigned.
	 */
	export function string(obj: any, source: any, index?: any, validate?: boolean): void
	/**
	 * Assigns the source value as a Molang-safe string.
	 */
	export function molang(obj: any, source: any, index?: any): void
	/**
	 * Assigns the source value when it passes the optional validation.
	 * @param validate Optional check that must return true for the value to be assigned.
	 */
	export function boolean(obj: any, source: any, index?: any, validate?: boolean): void
	/**
	 * Assigns the source value when it is a function.
	 * @param validate Optional check that must return true for the value to be assigned.
	 */
	export function _function(obj: any, source: any, index?: any, validate?: boolean): void
	export { _function as function }
	/**
	 * Assigns the source array into the target three-dimensional vector.
	 * @param validate Optional check that must return true for the value to be assigned.
	 */
	export function arrayVector(obj: any, source: any, index?: any, validate?: boolean): void
	/**
	 * Assigns the source array into the target two-dimensional vector.
	 * @param validate Optional check that must return true for the value to be assigned.
	 */
	export function arrayVector2(obj: any, source: any, index?: any, validate?: boolean): void
}

/**
 * Reusable data types that can be used by anything, but should not be used to store data between function calls. Can be used to save memory on frequent function calls.
 */
declare namespace Reusable {
	/** Reusable three-dimensional vector. */
	const vec1: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec2: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec3: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec4: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec5: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec6: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec7: THREE.Vector3
	/** Reusable three-dimensional vector. */
	const vec8: THREE.Vector3
	/** Reusable quaternion. */
	const quat1: THREE.Quaternion
	/** Reusable quaternion. */
	const quat2: THREE.Quaternion
	/** Reusable Euler rotation. */
	const euler1: THREE.Euler
	/** Reusable Euler rotation. */
	const euler2: THREE.Euler
}

/**
 * Returns the group that new elements are added to: the selected group, or the common parent group of the selected elements.
 */
declare function getCurrentGroup(): Group

/**
 * Merge the value under a certain key from one object into another
 */
declare namespace Merge {
	/**
	 * Copies the source value to the target when it can be parsed as a number.
	 */
	function number(target: object, source: object, key: string | number): void
	/**
	 * Copies the source value to the target as a string.
	 * @param validate Optional check that must return true for the value to be copied.
	 */
	function string(
		target: object,
		source: object,
		key: string | number,
		validate?: (value: string) => boolean
	): void
	/**
	 * Copies the source value to the target as a Molang-safe string.
	 */
	function molang(target: object, source: object, key: string | number): void
	/**
	 * Copies the source value to the target when it passes the optional validation.
	 * @param validate Optional check that must return true for the value to be copied.
	 */
	function boolean(
		target: object,
		source: object,
		key: string | number,
		validate?: (value: boolean) => boolean
	): void
	/**
	 * Copies the source array into the three-dimensional vector stored under the key.
	 * @param validate Optional check that must return true for the value to be copied.
	 */
	function arrayVector(
		target: object,
		source: object,
		key: string | number,
		validate?: (value: number[]) => boolean
	): void
	/**
	 * Copies the source array into the two-dimensional vector stored under the key.
	 * @param validate Optional check that must return true for the value to be copied.
	 */
	function arrayVector2(
		target: object,
		source: object,
		key: string | number,
		validate?: (value: ArrayVector2) => boolean
	): void
}

/**
 * A rectangle defined by a start corner, a width and a height.
 */
declare class Rectangle {
	/**
	 * Creates a rectangle from the start corner, the width and the height.
	 */
	constructor(start_x: number, start_y: number, width: number, height: number)
	/** X coordinate of the start corner. */
	start_x: number
	/** Y coordinate of the start corner. */
	start_y: number
	/** Width of the rectangle. */
	width: number
	/** Height of the rectangle. */
	height: number
	/** The start corner as a coordinate pair. */
	readonly start: ArrayVector2
	/** Width of the rectangle. */
	readonly w: number
	/** Height of the rectangle. */
	readonly h: number
	/** X coordinate of the end corner; assigning it updates the width. */
	end_x: number
	/** Y coordinate of the end corner; assigning it updates the height. */
	end_y: number
	/** Area of the rectangle. */
	readonly area: number
	/**
	 * Sets the rectangle from two corners, keeping the given coordinate order.
	 */
	fromCoords(x1: number, y1: number, x2: number, y2: number): void
	/**
	 * Sets the rectangle from two corners, ordering the coordinates so that the start corner is the top left one.
	 */
	fromUnorderedCoords(x1: number, y1: number, x2: number, y2: number): void
	/**
	 * Grows the rectangle so that it includes the given point.
	 */
	expandTo(x: number, y: number): void
}

/**
 * TGA / Targa library
 */
declare class Targa {
	/**
	 * Creates a Targa image instance.
	 */
	constructor()
	/**
	 * Loads TGA image data.
	 * @param data The bytes of the TGA file.
	 */
	load(data: Uint8Array)
	/**
	 * Returns the loaded image as a data URL.
	 */
	getDataURL(): string
	/**
	 * Loads a TGA file and calls the callback when it is ready.
	 * @param file The file to load.
	 * @param callback Called after the file has been loaded.
	 */
	open(file: any, callback: () => void)
}
