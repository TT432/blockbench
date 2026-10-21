/// <reference types="./blockbench"/>

import type { CubeBatcher as CubeBatcherType } from '../../js/preview/cube_batcher';

/**
 * Extends the global scope with the members added by Blockbench.
 */
declare global {
	// const Prism: typeof import('prismjs')
	/**
	 * @deprecated Use {@link Canvas.scene} instead
	 */
	const scene: THREE.Scene
	/** The transform gizmo of the viewport. */
	const Transformer: any

	/**
	 * The main preview of the editor.
	 * @deprecated
	 */
	const main_preview: Preview
	/**
	 * The interface that is currently open as a dialog, if any.
	 * @deprecated
	 */
	let open_interface: Dialog | any | undefined

	/**
	 * Shows a confirmation dialog and returns true when the user confirms.
	 * @param message The message shown in the dialog.
	 * @param title The dialog title.
	 */
	function confirm(message: string, title: string): boolean

	/** The Node.js `path` module. */
	const PathModule: typeof import('path')

	/**
	 * @deprecated Use {@link Outliner.selected} instead
	 */
	let selected: OutlinerElement[]

	/**
	 * Rotates the current rotation objects around one axis.
	 * @param modify Callback that receives the current angle on the axis, in degrees, and returns the new angle.
	 * @param axis Axis index, where 0 is x, 1 is y and 2 is z.
	 * @param slider Whether the rotation is driven by a slider.
	 */
	function rotateOnAxis(modify: OutlinerNode, axis: number, slider?: boolean): void
	/**
	 * Updates the cubes and spline meshes that are affected by a rotation.
	 */
	function afterRotateOnAxis(): void

	// const Transformer: THREE.TransformControls
	/** Image element extensions added by Blockbench. */
	interface HTMLImageElement {
		/** The source URL of the image. */
		src: string
		/** The texture created from the image. */
		tex: THREE.Texture & {
			/** Magnification filter applied to the texture. */
			magFilter: THREE.TextureFilter
			/** Minification filter applied to the texture. */
			minFilter: THREE.TextureFilter
		}
	}
	/** Date helpers added by Blockbench. */
	interface Date {
		/**
		 * Returns a timestamp in the format 16:30
		 */
		getTimestamp(): string
		/** Returns the day of the month, the month and the year as an array. */
		getDateArray(): number[]
		/** Returns the date formatted as `DD.MM.YYYY`. */
		getDateString(): string
		/** Returns the day of the year. */
		dayOfYear(): number
	}
	/** Number helpers added by Blockbench. */
	interface Number {
		/** Returns the number as a string padded with zeros to the given length. */
		toDigitString(digits: number): string
	}
	/** String helpers added by Blockbench. */
	interface String {
		/** Returns a numeric hash of the string. */
		hashCode(): number
	}
	/** Event helpers added by Blockbench. */
	interface Event {
		/** Whether the Ctrl key or the Command key is pressed. */
		readonly ctrlOrCmd: boolean
	}
	/** Math helpers added by Blockbench. */
	interface Math {
		/** Limits a number to the range between `min` and `max`. */
		limitNumber(number: number, min: number, max: number): number
		/** Converts radians to degrees. */
		radToDeg(radians: number): number
		/** Converts degrees to radians. */
		degToRad(degrees: number): number
		/**
		 * Rounds the input number to N digits
		 */
		roundTo(number: number, digits: number): number
		/**
		 * Test if the number is between two other numbers
		 */
		isBetween(number: number, limit1: number, limit2: number): boolean
		/**
		 * Checks if the absolute difference between a and b is smaller than epsilon
		 */
		epsilon(a: number, b: number, epsilon?: number): boolean
		/**
		 * Take a rotation value in degrees, and trim it to a value between -180 and 180, while keeping the same angle
		 */
		trimDeg(degrees: number): number
		/** Returns true if the number is a power of two. */
		isPowerOfTwo(number: number): boolean
		/***
		 * Checks if the input is of type number
		 */
		isNumber(number: any): boolean
		/**
		 * Generates a random float between a and b
		 */
		randomab(a: number, b: number): number
		/** Returns true if one number is a multiple of the other. */
		areMultiples(number1: number, number2: number): boolean
		/**
		 * Return the next highest power of n
		 * @param num Power
		 * @param min Value that the result should be equal to or higher than
		 */
		getNextPower(num: number, min: number): number
		/**
		 * Snap the value to the closest number in a list of 1 or more snap points
		 */
		snapToValues(number: number, snap_points: number[], epsilon: number): number
		/**
		 * Get the lerp alpha value of m, between points a and b
		 */
		getLerp: (a: number, b: number, m: number) => number
		/**
		 * Lerp between a and b using the 0-1 alpha value
		 */
		lerp: (a: number, b: number, alpha: number) => number
		/**
		 * Return a random integer
		 */
		randomInteger: (a: number, b: number) => number
		/** Returns the hermite blend of the input value. */
		hermiteBlend: (input: number) => number
		/** Limits a number to the range between `min` and `max`. */
		clamp: (number: number, min: number, max: number) => number
	}
	/** Array helpers added by Blockbench. */
	interface Array<T> {
		/** Removes the item from the array. */
		remove(item: any): boolean
		/***
		 * Adds items to the array if they are not yet in the array
		 */
		safePush(...items: any): boolean
		/** Returns true if the array has the same items as the given array. */
		equals(array: Array<any>): boolean
		/** Replaces all items of the array with the given items. */
		replace(items: T[]): boolean
		/** Returns true if the callback returns true for every item. */
		allAre(callback: (item: T, index: number) => boolean): boolean
		/**
		 * Returns the first item whose property equals the value.
		 * @param key The property to compare.
		 * @param value The value to compare against.
		 */
		findInArray(key: string, value: any): number
		/** Returns the item for which the callback returns the highest number. */
		findHighest(callback: ((item: T) => number)): T
		/** Returns the number of truthy items in the array. */
		positiveItems(): number
		/**
		 * Empties the array
		 */
		empty(): this
		/** Returns the last item of the array. */
		last(): T
		/**
		 * Get the item at the specified index with a modulo applied, so any index will return a value
		 */
		atWrapped(index: number): T
		/** Returns true if every item equals the given value. */
		allEqual(item: T): boolean
		/** Returns a random item of the array. */
		random(): T
		/**
		 * Adds the item when the state is true and removes it otherwise.
		 * @param state Target state; defaults to the opposite of whether the item is included.
		 */
		toggle(item: T, state?: boolean): boolean
		/**
		 * Same as forEach, but in reverse order
		 */
		forEachReverse(callback: (item: T, index: number) => void): void
		/**
		 * Returns the amount of items that exist in this array and the reference array
		 */
		overlap(arr: Array<any>): number

		/** Sets the vector components. */
		V3_set(x: number, y: number, z: number): ArrayVector3
		/** Sets the vector components from an array. */
		V3_set(values: ArrayVector3): ArrayVector3
		// V3_set(value: THREE.Vector3): this
		/** Adds the given components to this vector. */
		V3_add(x: number, y: number, z: number): ArrayVector3
		/** Adds the given vector array to this vector. */
		V3_add(values: ArrayVector3): ArrayVector3
		/** Adds the given vector to this vector. */
		V3_add(value: THREE.Vector3): ArrayVector3
		/** Subtracts the given components from this vector. */
		V3_subtract(x: number, y: number, z: number): ArrayVector3
		/** Subtracts the given vector array from this vector. */
		V3_subtract(values: ArrayVector3): ArrayVector3
		/** Subtracts the given vector from this vector. */
		V3_subtract(value: THREE.Vector3): ArrayVector3
		/** Multiplies the components of this vector. */
		V3_multiply(x: number, y: number, z: number): ArrayVector3
		/** Multiplies the components of this vector by an array. */
		V3_multiply(values: ArrayVector3): ArrayVector3
		/** Multiplies the components of this vector by a vector. */
		V3_multiply(value: THREE.Vector3): ArrayVector3
		/** Divides the components of this vector. */
		V3_divide(x: number, y: number, z: number): ArrayVector3
		/** Divides the components of this vector by an array. */
		V3_divide(values: ArrayVector3): ArrayVector3
		/** Divides the components of this vector by a vector. */
		V3_divide(value: THREE.Vector3): ArrayVector3
		/** Returns the vector as a `THREE.Vector3`. */
		V3_toThree(): THREE.Vector3

		/** Sets the vector components. */
		V2_set(x: number, y: number): ArrayVector2
		/** Sets the vector components from an array. */
		V2_set(values: ArrayVector2): ArrayVector2
		/** Adds the given components to this vector. */
		V2_add(x: number, y: number): ArrayVector2
		/** Adds the given vector array to this vector. */
		V2_add(values: ArrayVector2): ArrayVector2
		/** Subtracts the given components from this vector. */
		V2_subtract(x: number, y: number): ArrayVector2
		/** Subtracts the given vector array from this vector. */
		V2_subtract(values: ArrayVector2): ArrayVector2
		/** Multiplies the components of this vector. */
		V2_multiply(x: number, y: number): ArrayVector2
		/** Multiplies the components of this vector by an array. */
		V2_multiply(values: ArrayVector2): ArrayVector2
		/** Divides the components of this vector. */
		V2_divide(x: number, y: number): ArrayVector2
		/** Divides the components of this vector by an array. */
		V2_divide(values: ArrayVector2): ArrayVector2
	}

	/** Additional event properties added by Blockbench. */
	interface Event {
		/** Whether the Shift key is pressed. */
		shiftKey?: boolean
	}

	/** The cube batcher of the preview. */
	const CubeBatcher: typeof CubeBatcherType
	/** bone_batch.js 的全局合批器（JS 模块，此处仅声明 CubeBatcher 互斥压制所需的最小面） */
	const BoneBatcher: {
		/** Whether the batcher is enabled. */
		enabled: boolean
		/**
		 * Enables or disables the batcher.
		 * @param value Whether to enable the batcher.
		 */
		setEnabled(value: boolean): void
	}
}

export { }

