/// <reference types="./blockbench"/>
/**
 * Timeline state and controls of the animation panel.
 */
declare namespace Timeline {
	/**
	 * Animators currently listed in the timeline.
	 */
	const animators: GeneralAnimator[]
	/**
	 * Keyframes that are currently selected.
	 */
	const selected: BBKeyframe[]
	/**
	 * Audio elements that are currently played by sound keyframes.
	 */
	const playing_sounds: any[]
	/**
	 * Playback speed in percent.
	 */
	let playback_speed: number
	/**
	 * Current time
	 */
	let time: number
	/**
	 * Whether the timeline is currently playing.
	 */
	let playing: boolean
	/**
	 * Vue instance of the timeline panel.
	 */
	let vue: Vue

	/**
	 * Set the timeline to a specific time
	 * @param time Time in seconds
	 * @param editing If true, don't update the timeline timecode, because it is currently edited by the user
	 */
	function setTime(time: number, editing?: boolean): void
	/**
	 * Reveal the specified time in the timeline by scrolling to it's position
	 * @param time Time in seconds
	 */
	function revealTime(time: number): void
	/**
	 * Set the time code above the timeline to a specific time
	 * @param time Time in seconds
	 */
	function setTimecode(time: number): void
	/**
	 * Converts the input time to a time that is snapped to the current timeline snapping setting
	 * @param time Input time in seconds
	 * @param animation Animation to use the snapping setting from. If unspecified, uses the selected animation
	 */
	function snapTime(time: number, animation?: BBAnimation): number
	/**
	 * Returns the time between two snapping points
	 */
	function getStep(): number
	/**
	 * Return the maximum length of the timeline, based on the length of the selected animation and the time of all keyframes
	 */
	function getMaxLength(): number

	/**
	 * Unselect the selected keyframes
	 */
	function unselect(): void
	/**
	 * Start playing the animation
	 */
	function start(): void
	/**
	 * Run one frame of the animation
	 */
	function loop(): void
	/**
	 * Pause playing the animation
	 */
	function pause(): void

	/**
	 * All keyframes of the timeline.
	 */
	let keyframes: BBKeyframe[]
	/**
	 * Context menu of the timeline.
	 */
	let menu: Menu
	/**
	 * Opens the context menu of the timeline.
	 * @param event Mouse event that opened the menu.
	 */
	function showMenu(event: Event): void
	/**
	 * Animator that is currently selected in the timeline.
	 */
	let selected_animator: GeneralAnimator | null
}
