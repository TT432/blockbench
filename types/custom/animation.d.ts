/// <reference types="./blockbench"/>

/**
 * Base class for entries listed in the animation panel, such as animations and animation controllers.
 */
declare class AnimationItem {
	/**
	 * All animation panel entries of the project.
	 */
	static all: BBAnimation[]
	/**
	 * Currently selected animation panel entry.
	 */
	static selected: BBAnimation | null
	/**
	 * Returns a plain object that holds the data of this entry for the undo system.
	 * @param options Options forwarded to the undo copies of nested animators.
	 * @param save Whether the copy is created for saving.
	 */
	getUndoCopy?(options?: any, save?: any): AnimationOptions
	/**
	 * Returns the name of this entry without its namespace prefix.
	 */
	getShortName(): string
}

/**
 * Options used to create or extend an animation.
 */
interface AnimationOptions {
	/**
	 * Name of the animation.
	 */
	name?: string
	/**
	 * Unique identifier of the animation.
	 */
	uuid?: string
	/**
	 * File path the animation is saved to.
	 */
	path?: string
	/**
	 * Loop mode used when playback reaches the end of the animation.
	 */
	loop?: 'once' | 'hold' | 'loop'
	/**
	 * Whether the animation replaces the default pose of the animated nodes instead of adding to it.
	 */
	override?: boolean
	/**
	 * Molang expression that updates the animation time.
	 */
	anim_time_update?: string
	/**
	 * Molang expression that scales the displayed animation values.
	 */
	blend_weight?: string
	/**
	 * Length of the animation in seconds.
	 */
	length?: number
	/**
	 * Number of snapping steps per second for keyframe times.
	 */
	snapping?: number
	/**
	 * Animators of the animation, indexed by outliner node uuid.
	 */
	animators?: any
}

/**
 * Snapshot of an animation used by the undo system.
 */
interface AnimationUndoCopy {
	/**
	 * Unique identifier of the animation.
	 */
	uuid: string
	/**
	 * Name of the animation.
	 */
	name: string
	/**
	 * Loop mode of the animation.
	 */
	loop: any
	/**
	 * Whether the animation replaces the default pose of the animated nodes.
	 */
	override: boolean
	/**
	 * Molang expression that updates the animation time.
	 */
	anim_time_update: string
	/**
	 * Molang expression that scales the displayed animation values.
	 */
	blend_weight: string
	/**
	 * Length of the animation in seconds.
	 */
	length: number
	/**
	 * Number of snapping steps per second for keyframe times.
	 */
	snapping: number
	/**
	 * Whether the animation was selected when the snapshot was taken.
	 */
	selected: boolean
}


/**
 * Animation class
 *
 * `BBAnimation` is an alias for `Animation`. Blockbench's Animation class conflicts with libdom's {@link Animation} type with its own `Animation` Class, but TypeScript doesn't include a way to overwrite UMD global types.
 * 
 * You can use `BBAnimation` to get around the Typescript conflict, or use `Animation`.
 */
declare class BBAnimation extends AnimationItem {
	/**
	 * Creates an animation and applies the given data.
	 * @param data Initial data of the animation.
	 */
	constructor(data?: AnimationOptions)
	/**
	 * Applies the given data to this animation and returns it.
	 */
	extend(data?: AnimationOptions): this
	/**
	 * Returns a snapshot of this animation for the undo system.
	 */
	getUndoCopy(options?: {}, save?: any): AnimationUndoCopy
	/**
	 * Compiles the JSON tree of the animation for the Minecraft Bedrock Edition animation format.
	 * @deprecated
	 */
	compileBedrockAnimation(): any
	/**
	 * Saves this animation through the active animation codec.
	 */
	save(): this | undefined
	/**
	 * Selects this animation and shows it in the timeline.
	 */
	select(): this | undefined
	/**
	 * Sets the length of the animation, clamped between the latest keyframe time and 10000.
	 */
	setLength(length?: number): void
	/**
	 * Ensures that the name of this animation is unique within its file and returns the name, or `false` when no free name is found.
	 * @param references Additional animations to take into account.
	 */
	createUniqueName(references?: BBAnimation[]): any
	/**
	 * Sets the animation scope from the first animated group that has a scope and returns it.
	 */
	setScopeFromAnimators(): number | undefined
	/**
	 * Opens a prompt to rename the animation.
	 */
	rename(): this
	/**
	 * Toggles the playback state of the animation and returns the new state.
	 * @param state Playback state to set instead of toggling.
	 */
	togglePlayingState(state: any): any
	/**
	 * Opens the context menu of the animation.
	 */
	showContextMenu(event: any): this
	/**
	 * Returns (if necessary creates) the animator of a specific outliner node of this animation
	 * May returns null if the node may not be animated due to being in a different scope
	 */
	getBoneAnimator(node?: OutlinerNode): BoneAnimator | null
	/**
	 * Removes the animator of the given outliner node from the animation.
	 * @param id UUID of the outliner node.
	 */
	removeAnimator(id: string): void
	/**
	 * Adds the animation to the current project and to the interface
	 * @param undo If true, the addition of the animation will be registered as an edit
	 */
	add(undo?: boolean): this
	/**
	 * Removes the animation from the project.
	 * @param undo If true, the removal is registered as an edit.
	 * @param remove_from_file If true, the animation is also deleted from its file.
	 */
	remove(undo: boolean, remove_from_file?: boolean): this
	/**
	 * Returns the latest keyframe time across all animators, or the animation length when it is longer.
	 */
	getMaxLength(): number
	/**
	 * Sets the loop mode of the animation.
	 * @param value Loop mode to set.
	 * @param undo If true, the change is registered as an edit.
	 */
	setLoop(value: any, undo: any): void
	/**
	 * Calculate the snapping value that the animation should use, based on the time codes of the keyframes that it holds. Directly updates the value, but also returns it as a number (snaps per second)
	 */
	calculateSnappingFromKeyframes(): number
	/**
	 * Opens the properties dialog
	 */
	propertiesDialog(): void

	/**
	 * Name of the animation.
	 */
	name: string
	/**
	 * Unique identifier of the animation.
	 */
	uuid: string
	/**
	 * Loop mode of the animation.
	 */
	loop: 'once' | 'hold' | 'loop'
	/**
	 * Whether the animation replaces the default pose of the animated nodes.
	 */
	override: boolean
	/**
	 * Molang expression that updates the animation time.
	 */
	anim_time_update: string
	/**
	 * Molang expression that scales the displayed animation values.
	 */
	blend_weight: string
	/**
	 * Length of the animation in seconds.
	 */
	length: number
	/**
	 * Number of snapping steps per second for keyframe times.
	 */
	snapping: number
	/**
	 * Molang expression that delays subsequent loop iterations.
	 */
	loop_delay: string
	/**
	 * Molang expression that delays the start of the animation.
	 */
	start_delay: string
	/**
	 * File path the animation is saved to.
	 */
	path: string
	/**
	 * Playback state of the animation in the animation panel.
	 */
	playing: boolean
	/**
	 * Whether the animation is saved to its file.
	 */
	saved: boolean
	/**
	 * Current time of the animation, taking the loop mode into account.
	 */
	time: number

	/**
	 * Animator of the effect channels of the animation.
	 */
	effects?: EffectAnimator

	/**
	 * Markers placed on the timeline of this animation.
	 */
	markers: TimelineMarker[]
	/**
	 * Animators of this animation, indexed by outliner node uuid.
	 */
	animators: {
		[id: string]: GeneralAnimator
	}
	/**
	 * Name under which the animation is stored in its file.
	 */
	saved_name?: string
	/**
	 * Whether the animation is selected in the animation panel.
	 */
	selected: boolean
	/**
	 * Type identifier of the animation panel entry.
	 */
	type: string
	/**
	 * Context menu of the animation.
	 */
	menu: Menu
	/**
	 * Menu of operations for the file that holds the animation.
	 */
	file_menu: Menu

	/**
	 * All animations of the project.
	 */
	static all: BBAnimation[]
	/**
	 * Currently selected animation.
	 */
	static selected: BBAnimation | null
}
/**
 * Entry returned by the Molang autocompletion of the animator.
 */
interface MolangAutoCompletionItem {
	/**
	 * Text inserted into the expression.
	 */
	text: string
	/**
	 * Label shown in the autocompletion list.
	 */
	label: string | undefined
	/**
	 * Number of characters before the cursor that the completion replaces.
	 */
	overlap: number
}

/**
 * Global state and helpers of the animation preview.
 */
declare namespace Animator {
	/**
	 * Whether animation mode is currently active.
	 */
	const open: boolean
	/**
	 * Molang parser used to evaluate animation expressions.
	 */
	const MolangParser: Molang
	/**
	 * All animation channels available on animators.
	 */
	const possible_channels: unknown[]
	/**
	 * Object that holds the rendered motion trail.
	 */
	const motion_trail: THREE.Object3D
	/**
	 * Lock state of the motion trail.
	 */
	const motion_trail_lock: boolean
	/**
	 * Particle effects used by animation keyframes, indexed by file path.
	 */
	const particle_effects: any
	/**
	 * All animations of the project.
	 */
	const animations: BBAnimation[]
	/**
	 * Currently selected animation.
	 */
	const selected: BBAnimation | undefined
	/**
	 * Last displayed values of each animation channel, indexed by channel.
	 */
	const _last_values: Record<string, ArrayVector3>
	/**
	 * Whether the scene matrices reflect the current pose.
	 */
	let _scene_matrices_fresh: boolean
	/**
	 * Enters animation mode and prepares the animation preview.
	 */
	function join(): void
	/**
	 * Leaves animation mode and clears the animation preview.
	 */
	function leave(): void
	/**
	 * Shows the default pose of all animated nodes.
	 * @param no_matrix_update If true, skips the scene matrix and armature geometry updates.
	 */
	function showDefaultPose(no_matrix_update?: boolean): void
	/**
	 * Removes all active particle emitters from the scene.
	 */
	function resetParticles(): void
	/**
	 * Renders the motion trail of the given node or of the current selection.
	 * @param target Node to draw the trail for; defaults to the selection.
	 */
	function showMotionTrail(target?: Group): void
	/**
	 * Updates the preview based on the current time
	 */
	function preview(in_loop?: boolean): void
	/**
	 * Loads a particle effect for the given path and content.
	 * @param path Path that identifies the particle effect.
	 * @param content JSON content of the particle effect.
	 */
	function loadParticleEmitter(path: string, content: string): void
	/**
	 * Import a Bedrock animation file
	 * @param file File any
	 * @param animation_filter List of names of animations to import
	 * @deprecated AnimationCodec should be used instead
	 */
	function loadFile(file: any, animation_filter?: string[]): void
	/**
	 * @deprecated AnimationCodec should be used instead
	 */
	function exportAnimationFile(path: string, save_as?: boolean): void
	/**
	 * @deprecated AnimationCodec should be used instead
	 */
	function exportAnimationControllerFile(path: string, save_as?: boolean): void
	/**
	 * Resets the stored last values of all animation channels.
	 */
	function resetLastValues(): void
	/**
	 * Returns Molang autocompletion entries for the given text and cursor position.
	 * @param text Expression text.
	 * @param position Cursor position in the text.
	 */
	function autocompleteMolang(
		text: string,
		position: number,
		type: string
	): MolangAutoCompletionItem[]
}

/**
 * Options for `GeneralAnimator.addChannel`.
 */
interface AddChannelOptions {
	/**
	 * Display name of the channel.
	 */
	name?: string
	/**
	 * Whether the channel holds transform values.
	 */
	transform?: boolean
	/**
	 * Whether the channel can be muted.
	 */
	mutable?: boolean
	/**
	 * Maximum number of data points per keyframe of the channel.
	 */
	max_data_points?: number
	/**
	 * Condition that controls whether the channel is available.
	 */
	condition?: ConditionResolvable<GeneralAnimator>
	/**
	 * Callback that displays the channel values of an animator.
	 */
	displayFrame?: (animator: GeneralAnimator, multiplier: number) => void
}
/**
 * Definition of an animation channel.
 */
interface Channel {
	/**
	 * Display name of the channel.
	 */
	name: string
	/**
	 * Whether the channel holds transform values.
	 */
	transform: boolean
	/**
	 * Whether the channel can be muted.
	 */
	mutable: boolean
	/**
	 * Maximum number of data points per keyframe of the channel.
	 */
	max_data_points: number
	/**
	 * Condition that controls whether the channel is available.
	 */
	condition?: ConditionResolvable<GeneralAnimator>
}
/**
 * Base class for animators that hold the keyframes of animation channels.
 */
declare class GeneralAnimator {
	/**
	 * Creates an animator for the given animation.
	 * @param uuid UUID of the node the animator is attached to.
	 * @param animation Animation that owns the animator.
	 * @param name Display name of the animator.
	 */
	constructor(uuid: string | null, animation: BBAnimation, name: string)
	/**
	 * UUID of the node this animator is attached to.
	 */
	uuid: string
	/**
	 * All keyframes of the animator across its channels.
	 */
	keyframes: BBKeyframe[]
	/**
	 * The animation that owns this animator.
	 */
	animation: BBAnimation
	/**
	 * Whether the animator is expanded in the timeline.
	 */
	expanded: boolean
	/**
	 * Whether the animator is selected in the timeline.
	 */
	selected: boolean
	/**
	 * Selects the animator in the timeline.
	 */
	select(): this
	/**
	 * Adds the animator to the timeline list and expands it.
	 */
	addToTimeline(): this
	/**
	 * Creates a keyframe from the given data and adds it to the animator.
	 * @param uuid UUID of the new keyframe.
	 */
	addKeyframe(data: KeyframeOptions, uuid?: string): BBKeyframe
	/**
	 * Creates a keyframe for the animator.
	 */
	createKeyframe(): BBKeyframe
	/**
	 * Returns the keyframe at the current time as `before` and the keyframe to edit as `result`.
	 */
	getOrMakeKeyframe(): {
		/**
		 * Existing keyframe at the current time, when one exists.
		 */
		before: BBKeyframe
		/**
		 * Keyframe to edit, either the existing keyframe or a newly created one.
		 */
		result: BBKeyframe
	}
	/**
	 * Toggles whether the given channel is muted and returns the animator.
	 */
	toggleMuted(channel: string): this
	/**
	 * Scrolls the timeline to the row of this animator.
	 */
	scrollTo(): this

	/**
	 * Registers a new animation channel for the animator class.
	 * @param channel Name of the channel.
	 * @param options Options of the channel.
	 */
	static addChannel(channel: string, options: AddChannelOptions): void
	/**
	 * Channels of the animator, indexed by channel name.
	 */
	channels: {
		[channel: string]: Channel
	}
	/**
	 * Mute state of each channel of the animator.
	 */
	muted: {
		[channel: string]: boolean | undefined
	};
	/**
	 * Keyframes of the channel with the matching name.
	 */
	[channel: string]: any
}

/**
 * Animator that applies keyframes to an outliner group.
 */
declare class BoneAnimator extends GeneralAnimator {
	/**
	 * Name of the animated group.
	 */
	name: string
	/**
	 * UUID of the animated group.
	 */
	uuid: string
	/**
	 * Rotation keyframes of the bone.
	 */
	rotations: BBKeyframe[]
	/**
	 * Position keyframes of the bone.
	 */
	position: BBKeyframe[]
	/**
	 * Scale keyframes of the bone.
	 */
	scale: BBKeyframe[]
	/**
	 * Returns the group that this animator animates.
	 */
	getGroup(): Group
	/**
	 * Fills the values of a keyframe from the current state of the group.
	 */
	fillValues(): void
	/**
	 * Adds the keyframe to the animator and sets its animator reference.
	 */
	pushKeyframe(): void
	/**
	 * Returns whether the animator can currently render its pose.
	 */
	doRender(): boolean
	/**
	 * Applies rotation values to the bone.
	 * @param arr Rotation values; four components are interpreted as a quaternion.
	 * @param multiplier Factor applied to the rotation values.
	 */
	displayRotation(arr?: ArrayVector3 | ArrayVector4, multiplier?: number): void
	/**
	 * Applies position values to the bone.
	 * @param arr Position values.
	 * @param multiplier Factor applied to the position values.
	 */
	displayPosition(arr?: ArrayVector3, multiplier?: number): this
	/**
	 * Applies scale values to the bone.
	 * @param arr Scale values.
	 * @param multiplier Factor applied to the scale values.
	 */
	displayScale(arr?: ArrayVector3, multiplier?: number): void
	/**
	 * Returns the interpolated value of a channel at the current animation time, or `false` when it cannot be computed.
	 * @param channel Channel to interpolate.
	 * @param allow_expression If true, returns the expression when the neighboring values are equal.
	 * @param axis Axis to interpolate, or all axes when omitted.
	 */
	interpolate(channel: string, allow_expression?: boolean, axis?: string): ArrayVector3 | false
	/**
	 * Applies the interpolated channel values of the current frame to the bone.
	 * @param multiplier Factor applied to the displayed values.
	 */
	displayFrame(multiplier?: number): void
}
/**
 * Animator that applies keyframes to a null object.
 */
declare class NullObjectAnimator extends GeneralAnimator {
	/**
	 * Name of the animated null object.
	 */
	name: string
	/**
	 * UUID of the animated null object.
	 */
	uuid: string
	/**
	 * Rotation keyframes inherited from `BoneAnimator`.
	 */
	rotations: BBKeyframe[]
	/**
	 * Position keyframes of the null object.
	 */
	position: BBKeyframe[]
	/**
	 * Scale keyframes inherited from `BoneAnimator`.
	 */
	scale: BBKeyframe[]
	/**
	 * Returns the null object that this animator animates.
	 */
	getElement(): NullObject
	/**
	 * Checks whether the null object can currently be rendered.
	 */
	doRender(): void
	/**
	 * Applies inverse kinematics driven by the null object.
	 */
	displayIK(): void
	/**
	 * Applies the interpolated channel values of the current frame to the null object.
	 */
	displayFrame(): void
}
/**
 * Animator for the effect channels of an animation, such as sound and particle keyframes.
 */
declare class EffectAnimator extends GeneralAnimator {
	/**
	 * Creates an effect animator for the given animation.
	 */
	constructor(animation: BBAnimation)
	/**
	 * Display name of the effect animator.
	 */
	name: string
	/**
	 * UUID of the effect animator.
	 */
	uuid: string
	/**
	 * Rotation keyframes inherited from `GeneralAnimator`.
	 */
	rotations: BBKeyframe[]
	/**
	 * Position keyframes inherited from `GeneralAnimator`.
	 */
	position: BBKeyframe[]
	/**
	 * Scale keyframes inherited from `GeneralAnimator`.
	 */
	scale: BBKeyframe[]
	/**
	 * Adds the keyframe to the animator and sets its animator reference.
	 */
	pushKeyframe(keyframe: BBKeyframe): this
	/**
	 * Plays sound and particle keyframes at the current time.
	 * @param in_loop If true, sounds and particles are played as part of ongoing playback.
	 */
	displayFrame(in_loop?: boolean): void
	/**
	 * Starts sounds whose keyframes are before the current time.
	 */
	startPreviousSounds(): void
}

/**
 * Marker placed at a specific time on the timeline.
 */
declare class TimelineMarker {
	/**
	 * Color index of the marker.
	 */
	color: number
	/**
	 * Time of the marker in seconds.
	 */
	time: number
}
/**
 * Wintersky scene used to render particle effects in the animation preview.
 */
declare const WinterskyScene: Wintersky.Scene
