/// <reference types="./blockbench"/>
/**
 * A global namespace containing various functionality for Blockbench's 2D and 3D paint tools and texture editor
 */
declare namespace Painter {
	/** Pixel coordinate that the brush is currently over */
	const currentPixel: ArrayVector2
	/** Whether the current brush stroke has changed any pixels */
	const brushChanges: boolean
	/** Data of the current paint action, such as the edited texture and element */
	let current: any
	/** Selection state used by the paint tools */
	const selection: any
	/** Whether painting is mirrored across the symmetry axes */
	const mirror_painting: boolean
	/** Whether painting keeps the existing alpha of the pixels */
	const lock_alpha: boolean
	/** Whether the fill and shape tools erase instead of painting color */
	const erase_mode: boolean
	/** Brush presets that are offered in the brush options dialog */
	const default_brush_presets: any[]
	/** Element that draws the brush outline in screen space */
	let screen_space_brush_cursor: HTMLElement

	/**
	 * Applies an edit to a texture and updates it afterwards.
	 * @param texture Texture to edit
	 * @param callback Receives the canvas that holds the content to edit
	 * @param options Editing options
	 */
	function edit(
		texture: Texture,
		callback: (canvas: HTMLCanvasElement) => void,
		options: TextureEditOptions
	): void
	/**
	 * Records the highest alpha value that was painted at a pixel during the current stroke.
	 * @param texture Texture that is edited
	 * @param x X coordinate of the pixel
	 * @param y Y coordinate of the pixel
	 * @param val Painted alpha value
	 */
	function setAlphaMatrix(texture: Texture, x: number, y: number, val: number): void
	/**
	 * Returns the alpha value that was recorded for a pixel during the current stroke.
	 * @param texture Texture that is edited
	 * @param x X coordinate of the pixel
	 * @param y Y coordinate of the pixel
	 */
	function getAlphaMatrix(texture: Texture, x: number, y: number): number

	/**
	 * Combines two colors using normal alpha blending.
	 * @param base Color that is already in the pixel
	 * @param added Color that is painted on top
	 * @param opacity Opacity of the added color, from 0 to 1
	 * @returns The resulting color
	 */
	function combineColors(base: RGBAColor, added: RGBAColor, opacity: number): RGBAColor
	/**
	 * Combines two colors using the given blend mode.
	 * @param base Color that is already in the pixel
	 * @param added Color that is painted on top
	 * @param opacity Opacity of the added color, from 0 to 1
	 * @param blend_mode ID of the blend mode to use
	 * @returns The resulting color
	 */
	function blendColors(
		base: RGBAColor,
		added: RGBAColor,
		opacity: number,
		blend_mode: string
	): RGBAColor
	/**
	 * Returns the element that mirrors the given element across the symmetry axes.
	 * @param element Element to mirror
	 * @param symmetry_axes Axes to mirror across, as booleans per axis
	 */
	function getMirrorElement(element: OutlinerElement, symmetry_axes: number[]): void
	/** Updates the brush sliders to match the current brush settings */
	function updateNslideValues(): void
	/**
	 * Returns the canvas composite operation that corresponds to a blend mode.
	 * @param blend_mode ID of the blend mode, defaults to the selected blend mode
	 */
	function getBlendModeCompositeOperation(blend_mode?: string): GlobalCompositeOperation
	/**
	 * Returns the width and height of a brush, applying the brush aspect ratio.
	 * @param size Size of the brush, defaults to the selected brush size
	 */
	function getBrushDimensions(size?: number): ArrayVector2
	/**
	 * Returns the pixel coordinates in a texture that correspond to a UV point.
	 * @param uv_point UV coordinate on the texture
	 * @param texture Texture that receives the brush stroke
	 */
	function getCanvasToolPixelCoords(uv_point: {/** Horizontal UV coordinate */ x: number, /** Vertical UV coordinate */ y: number}, texture: Texture): ArrayVector2
	/**
	 * Returns the canvas that holds the texture's content. Images are drawn into a new canvas.
	 * @param texture Texture to get the canvas of
	 */
	function getCanvas(texture: Texture): HTMLCanvasElement
	/**
	 * Returns a copy of a canvas, including its content.
	 * @param original_canvas Canvas to copy
	 */
	function copyCanvas(original_canvas: HTMLCanvasElement): HTMLCanvasElement
	/**
	 * Runs a callback for every pixel of a canvas area and writes the returned colors back.
	 * @param ctx Canvas 2D context to read and write
	 * @param x X coordinate of the area
	 * @param y Y coordinate of the area
	 * @param w Width of the area
	 * @param h Height of the area
	 * @param cb Called per pixel with its color; return a color to replace the pixel
	 */
	function scanCanvas(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		cb: ((px: number, py: number, color: [r: number, g: number, b: number, a: number]) => [number, number, number, number] | void)
	): void
	/**
	 * Returns the color of a single pixel.
	 * @param ctx Canvas 2D context to read
	 * @param x X coordinate of the pixel
	 * @param y Y coordinate of the pixel
	 */
	function getPixelColor(ctx: CanvasRenderingContext2D, x: number, y: number): tinycolor
	/**
	 * Lets a callback change the pixels of a canvas area, while respecting the texture selection.
	 * @param ctx Canvas 2D context to edit
	 * @param x X coordinate of the area
	 * @param y Y coordinate of the area
	 * @param w Width of the area
	 * @param h Height of the area
	 * @param cb Receives a function that edits a single pixel
	 */
	function modifyCanvasSection(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		w: number,
		h: number,
		cb: () => void
	): void
	/**
	 * Paints the pixels inside a circle around a point.
	 * @param ctx Canvas 2D context to edit
	 * @param x X coordinate of the circle center
	 * @param y Y coordinate of the circle center
	 * @param r Radius of the circle
	 * @param softness Softness of the brush edge, from 0 to 1
	 * @param editPx Called per pixel with its color and the brush opacity, returns the new color
	 */
	function editCircle(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		r: number,
		softness: number,
		editPx: (RGBAColor: any, opacity: number, px: number, py: number) => RGBAColor
	): void
	/**
	 * Paints the pixels inside a square around a point.
	 * @param ctx Canvas 2D context to edit
	 * @param x X coordinate of the square center
	 * @param y Y coordinate of the square center
	 * @param r Size of the square
	 * @param softness Softness of the brush edge, from 0 to 1
	 * @param editPx Called per pixel with its color and the brush opacity, returns the new color
	 */
	function editSquare(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		r: number,
		softness: number,
		editPx: (RGBAColor: any, opacity: number, px: number, py: number) => RGBAColor
	): void
	/** Opens the dialog with the brush presets and their options */
	function openBrushOptions(): void
	/**
	 * Applies a brush preset to the brush settings.
	 * @param preset Preset to apply
	 */
	function loadBrushPreset(preset: any): void
}

	/** Bar items that the paint tools and the texture editor use. */
	declare interface BarItemRegistry {
		/** Keybind item that paints with the secondary color */
		paint_secondary_color: KeybindItem
		/** Tool that pans the preview */
		pan_tool: Tool
		/** Tool that paints with the brush */
		brush_tool: Tool
		/** Tool that copies pixels from one texture area to another */
		copy_brush: Tool
		/** Tool that fills an area with the current color */
		fill_tool: Tool
		/** Tool that erases pixels */
		eraser: Tool
		/** Tool that picks the color of a pixel */
		color_picker: Tool
		/** Tool that draws shapes */
		draw_shape_tool: Tool
		/** Tool that paints a color gradient */
		gradient_tool: Tool
		/** Tool that moves the content of a layer */
		move_layer_tool: Tool
		/** Selects the shape of the brush */
		brush_shape: BarSelect
		/** Selects the shape that the shape tool draws */
		draw_shape_type: BarSelect
		/** Selects the blend mode of the paint tools */
		blend_mode: BarSelect
		/** Selects what the fill tool fills */
		fill_mode: BarSelect
		/** Selects the mode of the copy brush */
		copy_brush_mode: BarSelect
		/** Selects how the selection tool combines new selections with the existing one */
		selection_tool_operation_mode: BarSelect
		/** Action that opens the dialog to expand the texture selection */
		expand_texture_selection: Action
		/** Toggles mirrored painting */
		mirror_painting: Toggle
		/** Toggles erasing instead of painting with the fill and shape tools */
		color_erase_mode: Toggle
		/** Toggles painting that keeps the existing alpha of the pixels */
		lock_alpha: Toggle
		/** Toggles the pixel grid in the texture editor */
		painting_grid: Toggle
		/** Toggles the tiled preview of the texture in the texture editor */
		image_tiled_view: Toggle
		/** Toggles the onion skin preview of the animation frames in the texture editor */
		image_onion_skin_view: Toggle
		/** Slider for the brush size */
		slider_brush_size: NumSlider
		/** Slider for the brush softness */
		slider_brush_softness: NumSlider
		/** Slider for the brush opacity */
		slider_brush_opacity: NumSlider
		/** Toggles pixel perfect drawing */
		pixel_perfect_drawing: Toggle
		/** Slider for the color threshold of the selection tool */
		slider_color_select_threshold: NumSlider
	}