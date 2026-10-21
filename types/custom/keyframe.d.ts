/// <reference types="./blockbench"/>

/**
 * Keyframes are used in animations to specify transformation or other data at specific points in the timeline
 * @module
 */

/**
 * Values applied to a keyframe data point.
 */
interface KeyframeDataPointData {
	/**
	 * Value of a property of the data point, indexed by property name.
	 */
	[key: string]: any
}
/**
 * Data point of a keyframe that holds the values of one point in time.
 */
declare class KeyframeDataPoint extends Object {
	/**
	 * Properties of keyframe data points, indexed by property name.
	 */
	static properties: Record<string, Property<any>>
	/**
	 * Creates a data point that belongs to the given keyframe.
	 * @param keyframe Keyframe that owns the data point.
	 */
	constructor(keyframe: BBKeyframe)
	/**
	 * Keyframe that owns this data point.
	 */
	readonly keyframe: Keyframe
	/**
	 * Applies the given values to this data point.
	 */
	extend(data: KeyframeDataPointData): void
	/**
	 * Returns a snapshot of the data point for the undo system.
	 */
	getUndoCopy(): {
		[key: string]: any
	}
	/**
	 * Value of a property of the data point, indexed by property name.
	 */
	[key: string]: any
}

/**
 * Options used to create or extend a keyframe.
 */
interface KeyframeOptions {
	/**
	 * Channel the keyframe belongs to.
	 */
	channel?: string
	/**
	 * Values of the data points of the keyframe.
	 */
	data_points: {}[]
	/**
	 * Time of the keyframe in seconds.
	 */
	time: number
	/**
	 * Color index of the keyframe in the timeline.
	 */
	color?: number
	/**
	 * Whether a single value is used for all axes.
	 */
	uniform?: boolean
	/**
	 * Interpolation mode used to calculate values between keyframes.
	 */
	interpolation?: 'linear' | 'catmullrom' | 'bezier' | 'step' | string
	/**
	 * Whether the bezier handles of all axes are linked.
	 */
	bezier_linked?: boolean
	/**
	 * Time offsets of the left bezier handles, one value per axis.
	 */
	bezier_left_time?: ArrayVector3
	/**
	 * Value offsets of the left bezier handles, one value per axis.
	 */
	bezier_left_value?: ArrayVector3
	/**
	 * Time offsets of the right bezier handles, one value per axis.
	 */
	bezier_right_time?: ArrayVector3
	/**
	 * Value offsets of the right bezier handles, one value per axis.
	 */
	bezier_right_value?: ArrayVector3
}
/**
 * Letter that identifies a transform axis.
 */
type axisLetter = 'x' | 'y' | 'z'
/**
 * Index of a transform axis.
 */
type axisNumber = 0 | 1 | 2

/**
 * Keyframe class
 *
 * `BBKeyframe` is an alias for `Keyframe`. Blockbench's Keyframe class conflicts with libdom's {@link Keyframe} type with its own `Keyframe` Class, but TypeScript doesn't include a way to overwrite UMD global types.
 * 
 * You can use `BBKeyframe` to get around the Typescript conflict, or use `Keyframe`.
 */
declare class BBKeyframe {
	/**
	 * Creates a keyframe from the given options.
	 * @param uuid UUID of the keyframe; a new UUID is generated when it is not valid.
	 */
	constructor(options: KeyframeOptions, uuid: any)
	/**
	 * Keyframes that are currently selected.
	 */
	static selected: BBKeyframe[]
	/**
	 * Data points of the keyframe.
	 */
	data_points: KeyframeDataPoint[]
	/**
	 * The animator that owns this keyframe.
	 */
	animator: GeneralAnimator
	/**
	 * Channel the keyframe belongs to.
	 */
	channel: string
	/**
	 * Time of the keyframe in seconds.
	 */
	time: number
	/**
	 * Unique identifier of the keyframe.
	 */
	uuid: string
	/**
	 * Color index of the keyframe in the timeline.
	 */
	color: number
	/**
	 * Whether a single value is used for all axes.
	 */
	uniform: boolean
	/**
	 * Interpolation mode used to calculate values between keyframes.
	 */
	interpolation: 'linear' | 'catmullrom' | 'bezier' | 'step' | string
	/**
	 * Whether the effect of the keyframe is temporarily skipped during playback.
	 */
	cooldown?: boolean
	/**
	 * Whether the bezier handles of all axes are linked.
	 */
	bezier_linked: boolean
	/**
	 * Time offsets of the left bezier handles, one value per axis.
	 */
	bezier_left_time: ArrayVector3
	/**
	 * Time offsets of the right bezier handles, one value per axis.
	 */
	bezier_right_time: ArrayVector3
	/**
	 * Value offsets of the left bezier handles, one value per axis.
	 */
	bezier_left_value: ArrayVector3
	/**
	 * Value offsets of the right bezier handles, one value per axis.
	 */
	bezier_right_value: ArrayVector3
	/**
	 * Whether the keyframe is selected.
	 */
	selected: boolean
	/**
	 * Whether the keyframe holds transform values.
	 */
	transform: boolean
	/**
	 * Whether any value of the keyframe is a Molang expression.
	 */
	has_expressions: boolean

	/**
	 * Applies the given options to the keyframe.
	 */
	extend(data: KeyframeOptions): this
	/**
	 * Returns the stored value of the axis of the given data point.
	 */
	get(axis: axisLetter, data_point?: number): number | string
	/**
	 * Evaluates the axis value of the data point as a Molang expression and returns a number.
	 */
	calc(axis: axisLetter, data_point?: number): number
	/**
	 * Sets the axis value of the given data point.
	 */
	set(axis: axisLetter, value: any, data_point?: number): this
	/**
	 * Adds an amount to the axis value of the data point, keeping expressions intact.
	 */
	offset(axis: axisLetter, amount: any, data_point?: number): void
	/**
	 * Mirrors the transform values of the keyframe around the given axis.
	 */
	flip(axis: axisLetter): this
	/**
	 * Returns the linearly interpolated value between this and another keyframe.
	 * @param amount Progress between the two keyframes.
	 * @param allow_expression If true, returns the expression when both values are equal.
	 */
	getLerp(other: BBKeyframe, axis: axisLetter, amount: number, allow_expression?: boolean): number
	/**
	 * Returns the catmullrom interpolated value of the axis at the given progress.
	 * @param before_plus Keyframe before the segment.
	 * @param before Keyframe at the start of the segment.
	 * @param after Keyframe at the end of the segment.
	 * @param after_plus Keyframe after the segment.
	 * @param alpha Progress between `before` and `after`.
	 */
	getCatmullromLerp(
		before_plus: BBKeyframe,
		before: BBKeyframe,
		after: BBKeyframe,
		after_plus: BBKeyframe,
		axis: axisLetter,
		alpha: number
	): number
	/**
	 * Returns the `x`, `y` and `z` values of the data point.
	 */
	getArray(data_point?: number): (number | string)[]
	/**
	 * Returns the axis values including the fixed transform of the animated node.
	 * @param get_quaternion If true, rotation channels return a quaternion instead of an euler.
	 */
	getFixed(
		data_point?: number,
		get_quaternion?: boolean
	): THREE.Vector3 | THREE.Euler | THREE.Quaternion
	/**
	 * Returns the time of the keyframe snapped to the animation snapping as a timecode string.
	 */
	getTimecodeString(): string
	/**
	 * Compiles the keyframe into the Minecraft Bedrock Edition animation format.
	 */
	compileBedrockKeyframe(): any
	/**
	 * Removes keyframes of the same channel that are at the same time.
	 * @param save Array that receives the removed keyframes.
	 */
	replaceOthers(save: any): void
	/**
	 * Selects the keyframe, optionally extending the selection with modifier keys.
	 * @param event Mouse event of the selection.
	 */
	select(event?: any): this
	/**
	 * Moves the playhead to the time of the keyframe.
	 */
	callPlayhead(): this
	/**
	 * Switches to animation mode and reveals the keyframe in the timeline.
	 */
	showInTimeline(): void
	/**
	 * Opens the context menu of the keyframe.
	 */
	showContextMenu(event: Event): this
	/**
	 * Removes the keyframe from its animator and from the selection.
	 */
	remove(): void
	/**
	 * Runs the callback on this keyframe, or on all selected keyframes when this one is part of the selection.
	 * @param undo_tag Description of the undo entry; the edit is not registered when omitted.
	 * @returns The keyframes that the callback was applied to.
	 */
	forSelected(callback: (keyframe: BBKeyframe) => void, undo_tag: any): this[]
	/**
	 * Returns a snapshot of the keyframe for the undo system.
	 * @param save If true, the snapshot is created for saving.
	 */
	getUndoCopy(save: any): {
		/**
		 * Animator that owns the keyframe.
		 */
		animator: any
		/**
		 * Channel of the keyframe.
		 */
		channel?: string | null
		/**
		 * Data points of the keyframe.
		 */
		data_points: KeyframeDataPoint[]
	}
}

/**
 * Updates the selection state of all keyframes in the timeline.
 */
declare function updateKeyframeSelection(): void
