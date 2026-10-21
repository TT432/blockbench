/// <reference types="./blockbench"/>
/**
 * Options for taking a screenshot.
 */
interface ScreenshotOptions {
	/** Whether to crop the screenshot to the model; enabled unless set to `false`. */
	crop?: boolean
	/** The target width of the screenshot in pixels. */
	width?: number
	/** The target height of the screenshot in pixels. */
	height?: number
}
/**
 * Options for recording the preview as an animated image.
 */
interface RecordGIFOptions {
	/** The number of frames recorded per second. */
	fps: number
	/** The output format. */
	format?: 'gif' | 'apng' | 'png_sequence'
	/** How the recording length is determined. */
	length_mode?: 'seconds' | 'frames' | 'turntable' | 'animation'
	/** The recording length, interpreted according to `length_mode`. */
	length?: number
	/** The pixelation factor applied to the recorded frames. */
	pixelate?: number
	/** The color quality used when encoding the frames. */
	quality?: number
	/** The background color of the recorded frames. */
	background: string
	/** The path of an image used as the background. */
	background_image?: string
	/** The turntable rotation speed. */
	turnspeed?: string
	/** Start playing the selected animation when the animation starts */
	play?: boolean
	/** The repeat setting of the recording. */
	repeat?: any
	/** Disable all UI feedback about GIF recording */
	silent?: boolean
}
/**
 * Options for recording a timelapse.
 */
interface RecordTimelapseOptions {
	/** Destination oath */
	destination: string
	/** The view that is captured. */
	source: 'preview' | 'locked' | 'interface'
	/** Interval between frames in seconds */
	interval: number
}
/**
 * A callback that receives the screenshot as a data URL.
 */
type ScreenshotReturn = (dataURL: string) => void

/**
 * A global namespace handling screenshot and GIF recording utilities.
 */
declare namespace Screencam {
	/**
	 * Provided preview with anti aliasing disabled that can be used for screenshots
	 */
	let NoAAPreview: Preview
	/**
	 * Whether a timelapse is currently being recorded
	 */
	const recording_timelapse: boolean
	/** The dialog used to configure GIF recording. */
	const gif_options_dialog: Dialog
	/** The crop amounts applied to GIF frames. */
	const gif_crop: {
		/** The crop amount from the top edge. */
		top: number
		/** The crop amount from the left edge. */
		left: number
		/** The crop amount from the right edge. */
		right: number
		/** The crop amount from the bottom edge. */
		bottom: number
	}

	/**
	 * Takes a screenshot of the given preview.
	 * @param preview The preview to capture
	 * @param options Screenshot options
	 * @param cb Callback that receives the screenshot
	 */
	function screenshotPreview(
		preview: Preview,
		options: ScreenshotOptions,
		cb: ScreenshotReturn
	): void

	/**
	 * Takes a screenshot of the whole application window.
	 * @param options Screenshot options
	 * @param cb Callback that receives the screenshot
	 */
	function fullScreen(options: ScreenshotOptions, cb: ScreenshotReturn): void

	/**
	 * Takes a screenshot of the 2D editor canvas.
	 * @param options Screenshot options
	 * @param cb Callback that receives the screenshot
	 */
	function screenshot2DEditor(options: ScreenshotOptions, cb: ScreenshotReturn): void

	/**
	 * Passes the screenshot to the callback, or shows the screenshot dialog when no callback is given.
	 * @param dataUrl The screenshot as a data URL
	 * @param cb Callback that receives the screenshot
	 * @param blob The encoded image data, when available
	 */
	function returnScreenshot(dataUrl: any, cb: ScreenshotReturn, blob: any): void

	/**
	 * Runs callback in a clean canvas, where only the model is visible and the control gizmos are hidden
	 * @param options
	 * @param cb
	 */
	function cleanCanvas(options: any, cb: ScreenshotReturn): void

	/**
	 * Records the preview as a GIF, APNG or PNG sequence.
	 * @param options Recording options
	 * @param cb Callback that receives the recorded image
	 */
	function createGif(options: RecordGIFOptions, cb: ScreenshotReturn): void

	/**
	 * Starts recording timelapse frames to the destination folder.
	 * @param options Timelapse options
	 */
	function recordTimelapse(options: RecordTimelapseOptions): void

	/** Stops the timelapse recording. */
	function stopTimelapse(): void
}
