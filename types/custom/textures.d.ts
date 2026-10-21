/// <reference types="./blockbench"/>

import type { FSWatcher } from 'fs'
import type { ShaderMaterial } from 'three'

/**
 * Describes a file format that textures can be saved in.
 */
interface FileFormatOptions {
	/** Name of the format, shown in the interface. */
	name: string
	/** File extensions of the format, without the leading dot. */
	extensions: string[],
	/**
	 * Encodes the texture content into binary file data.
	 * @param texture Texture to encode
	 * @returns The encoded file content
	 */
	async encode?(texture: Texture): Uint8Array
	/**
	 * Decodes binary file data into the texture's canvas.
	 * @param data File content to decode
	 * @param texture Texture that receives the decoded image
	 */
	async decode?(data: Uint8Array, texture: Texture): void
}

/** Declares the texture API as globals. */
declare global {
	/**
	 * Data used to create or save a texture.
	 */
	interface TextureData {
		/** Path of the file on the local hard drive, if the texture is linked to one. */
		path?: string
		/** Unique identifier of the texture. */
		uuid?: string
		/** Name of the texture, including the file extension. */
		name?: string
		/**
		 * Relative path to the file's directory, used by some formats such as Java Block/Item
		 * */
		folder?: string
		/** Namespace of the texture, used by some formats such as Java Block/Item */
		namespace?: string
		/**
		 * Texture ID or key, used by some formats. By default this is a number that increases with every texture that is added
		 * */
		id?: string
		/**
		 * Whether the texture is used for the models particle system. Used by some formats such as Java Block/Item
		 * */
		particle?: boolean
		/** Whether the texture is visible, used by layered rendering */
		visible?: boolean
		/** How the texture is rendered in the preview */
		render_mode?: 'default' | 'emissive' | 'additive' | 'layered' | string
		/** Which sides of the model surface the texture is rendered on */
		render_sides?: 'auto' | 'front' | 'double' | string
		/** How the texture is sampled outside of the UV range */
		wrap_mode?: 'limited' | 'repeat' | 'clamp'
		/** PBR channel that the texture provides when it belongs to a material texture group */
		pbr_channel?: 'color' | 'normal' | 'height' | 'mer'
		/**
		 * UUID of the texture group that the texture is in
		 */
		group?: string
		/** Scope index used by multi file editing formats to group textures */
		scope?: number

		/**
		 * Texture animation frame time
		 * */
		frame_time?: number
		/** How the animation frames are played back */
		frame_order_type?: 'custom' | 'loop' | 'backwards' | 'back_and_forth'
		/**
		 * Custom frame order
		 * */
		frame_order?: string
		/**
		 * Interpolate between frames
		 * */
		frame_interpolate?: boolean
		/**
		 * Whether the texture is saved
		 */
		saved?: boolean
		/**
		 * If true, the texture is loaded internally. If false, the texture is loaded directly from a file
		 */
		internal?: boolean
		/**
		 * Flag to indicate that the texture was manually resized, and on load it should not try to automatically adjust UV size
		 */
		keep_size?: boolean
		/** HTML-style source of the texture's displayed data, either a path or a base64 data URL */
		source?: string
		/** Width of the texture in pixels */
		width?: number
		/** Height of the texture in pixels */
		height?: number
		/** Whether the texture is handled as a standalone texture */
		standalone?: boolean
		/** Path of the texture relative to the project file, used by saved projects */
		relative_path?: string
	}
	/**
	 * Options that control how a texture edit is performed and recorded.
	 */
	interface TextureEditOptions {
		/**
		 * Edit method. 'canvas' is default
		 */
		method?: 'canvas' | 'jimp'
		/**
		 * Name of the undo entry that is created
		 */
		edit_name?: string
		/**
		 * Whether to use the cached canvas/jimp instance
		 */
		use_cache?: boolean
		/**
		 * If true, no undo point is created. Default is false
		 */
		no_undo?: boolean
		/**
		 * If true, the texture is not updated visually
		 */
		no_update?: boolean
		/** If true, no undo entry is started before the edit */
		no_undo_init?: boolean
		/** If true, the started undo entry is not finished after the edit */
		no_undo_finish?: boolean
	}

	/**
	 * A texture combines the functionality of material, texture, and image, in one. Textures can be linked to files on the local hard drive, or hold the information in RAM.
	 */
	class Texture {
		/**
		 * Creates a texture. The texture is not part of the project until `add()` is called.
		 * @param data Initial texture data
		 * @param uuid Unique identifier, generated when omitted
		 */
		constructor(data?: TextureData, uuid?: string)
		/** Number of animation frames, or undefined if the texture is not animated */
		readonly frameCount: number | undefined
		/** Height of a single animation frame in pixels */
		readonly display_height: number
		/** Width / height ratio of the texture */
		readonly ratio: number
		/** The directly selected texture */
		static selected?: Texture

		/** Unique identifier of the texture */
		uuid: UUID
		/** Path of the file on the local hard drive, if the texture is linked to one */
		path?: string
		/** Name of the texture, including the file extension */
		name: string
		/** Relative path to the file's directory, used by some formats such as Java Block/Item*/
		folder: string
		/** Namespace of the texture, used by some formats such as Java Block/Item */
		namespace: string
		/** Texture ID or key, used by some formats. By default this is a number that increases with every texture that is added */
		id: string
		/** Whether the texture is used for the models particle system. Used by some formats such as Java Block/Item */
		particle: boolean
		/** How the texture is rendered in the preview */
		render_mode: 'default' | 'emissive' | 'additive' | 'layered' | string
		/** Which sides of the model surface the texture is rendered on */
		render_sides: 'auto' | 'front' | 'double' | string
		/** How the texture is sampled outside of the UV range */
		wrap_mode: 'limited' | 'repeat' | 'clamp'
		/** PBR channel that the texture provides when it belongs to a material texture group */
		pbr_channel: 'color' | 'normal' | 'height' | 'mer'
		/** Whether the texture is used as the default texture in formats that support it */
		use_as_default: boolean
		/** UUID of the TextureGroup that this texture is in, if set */
		group: string
		/** Scope index used by multi file editing formats to group textures */
		scope: number

		/** Texture animation frame time */
		frame_time: number
		/** How the animation frames are played back */
		frame_order_type: 'custom' | 'loop' | 'backwards' | 'back_and_forth'
		/** Custom frame order */
		frame_order: string
		/** Interpolate between frames */
		frame_interpolate: boolean

		/** HTML-style source of the texture's displayed data. Can be a path (desktop app only), or a base64 data URL */
		source: string
		/**
		 * Whether the texture is directly selected
		 */
		selected: boolean
		/**
		 * Whether the texture is multi selected
		 */
		multi_selected: boolean
		/** The selected layer, or null if no layer is selected */
		selected_layer: TextureLayerItem | null
		/** Whether the texture is displayed with an icon in the texture list */
		show_icon: boolean
		/** Numeric error state of the texture, where 0 means no error */
		error: number
		/** Whether the texture is visible. Used for layered textures mode */
		visible: boolean

		/** Width of the texture in pixels */
		width: number
		/** Height of the texture in pixels */
		height: number
		/** UV width of the texture, used when the format uses per texture UV sizes */
		uv_width: number
		/** UV height of the texture, used when the format uses per texture UV sizes */
		uv_height: number
		/** Index of the currently displayed animation frame */
		currentFrame: number
		/** Whether the texture is saved, without unsaved changes */
		saved: boolean
		/**
		 * Whether the latest version of the texture is currently loaded from and linked to a file on disk, or held in memory as bitmap data
		 * @deprecated Use {@link Texture.internal} instead
		 */
		mode: never
		/**
		 * If true, the texture is loaded internally. If false, the texture is loaded directly from a file
		 */
		internal: boolean
		/**
		 * Set a function that will run once the next time the texture is loaded
		 */
		load_callback?: null | ((texture: Texture) => void)
		/**
		 * Custom texture flags
		 */
		flags: Set

		/**
		 * Texture selection in paint mode
		 */
		selection: IntMatrix
		/** Layers of the texture */
		layers: TextureLayerItem[]
		/** Whether the texture content is composed from layers */
		layers_enabled: boolean
		/**
		 * The UUID of the project to sync the texture to
		 */
		sync_to_project: UUID | ''

		/**
		 * The texture's associated canvas. Since 4.9, this is the main source of truth for textures in internal mode.
		 */
		canvas: HTMLCanvasElement
		/**
		 * The 2D context of the texture's associated canvas.
		 */
		ctx: CanvasRenderingContext2D
		/**
		 * Texture image element
		 */
		img: HTMLImageElement
		/** Position offset of the texture content, in pixels */
		readonly offset: ArrayVector2

		/** Path of the texture relative to the project file, used by saved projects */
		relative_path?: string
		/** The shader material that renders the texture in the preview */
		get material(): THREE.ShaderMaterial
		/** Replaces the shader material that renders the texture in the preview */
		set material(value: THREE.ShaderMaterial)

		/**
		 * 半透明内容判定（社区版）：贴图是否含 0<alpha<255 的 texel（additive 恒为 true）
		 */
		hasTranslucency(): boolean
		/**
		 * 半透明内容判定（社区版）：该元素各面 UV 区域内是否含半透明 texel
		 */
		elementHasTranslucency(element: OutlinerElement): boolean
		/**
		 * 半透明内容判定（社区版）：指定 UV 区域内是否含半透明 texel
		 */
		uvAreaHasTranslucency(u0: number, v0: number, u1: number, v1: number): boolean
		/**
		 * 半透明内容缓存（社区版）：undefined 表示未判定/已失效（贴图像素变化后重算）
		 */
		_has_translucency?: boolean

		/** Returns the message that describes the texture's error state, or an empty string if there is no error */
		getErrorMessage(): string
		/**
		 * Applies the provided texture data to this texture.
		 * @param data Texture data to apply
		 */
		extend(data: TextureData): this

		/**
		 * Get the UV width of the texture if the format uses per texture UV size, otherwise get the project texture width
		 */
		getUVWidth(): number
		/**
		 * Get the UV height of the texture if the format uses per texture UV size, otherwise get the project texture height
		 */
		getUVHeight(): number
		/**
		 * Returns a copy of the texture data for undo storage.
		 * @param bitmap If true, the image content is included in the copy
		 */
		getUndoCopy(bitmap?: boolean): any
		/**
		 * Returns a copy of the texture data as it is saved in project files.
		 * @param bitmap If true, the image content is included in the copy
		 */
		getSaveCopy(bitmap?: boolean): any
		/**
		 * Start listening for changes to the linked file. Desktop only
		 */
		startWatcher(): void
		/**
		 * Stop listening for changes to the linked file. Desktop only
		 */
		stopWatcher(): void
		/**
		 * Generate the Java Block/Item folder property from the file path
		 */
		generateFolder(): void
		/**
		 * Loads the texture from it's current source
		 * @param cb Callback function
		 */
		load(cb?: () => {}): this
		/**
		 * Loads the texture from a Java Block/Item texture link.
		 * @param link Texture link from the model file
		 * @param path_array Folders that the linked texture may be located in
		 * @param externalDataLoader Optional callback that provides texture data for a path
		 */
		fromJavaLink(link: string, path_array: string[], externalDataLoader?: (path) => any): this
		/**
		 * Loads the texture from a file object, as returned by `Blockbench.read`.
		 * @param file File to load
		 * @param externalDataLoader Optional callback that provides texture data for a path
		 */
		fromFile(file: { /** File name, including the extension */ name: string; /** File content, if it is already loaded */ content?: string; /** Path of the file */ path: string } | FileSystem.FileResult, externalDataLoader?: (path) => any): this
		/**
		 * Loads the texture from a file path. Desktop app only.
		 * @param path Path of the texture file
		 * @param externalDataLoader Optional callback that provides texture data for a path
		 */
		fromPath(path: string, externalDataLoader?: (path) => any): this
		/**
		 * Loads file content **only**.
		 *
		 * Does not read `png.mcmeta`, or attempt to overwrite an existing texture in the project with the same name.
		 *
		 * Used internally when loading `.bbmodel` files
		 * @param path
		 */
		loadContentFromPath(path: string): this
		/**
		 * Loads the texture from a data URL and stores its content internally.
		 * @param data_url Data URL of the image
		 */
		fromDataURL(data_url: string): this
		/** Loads a matching texture from the configured default texture pack and returns true if one was found */
		fromDefaultPack(): true | undefined
		/**
		 * Loads the default white error texture
		 * @param error_id Sets the error ID of the texture
		 */
		loadEmpty(error_id?: number): this

		/**
		 * Updates the texture source and the displayed image.
		 * @param dataUrl Data URL to use as the new source, defaults to the current source
		 */
		updateSource(dataUrl: string): this
		/** Updates the texture's material to match its current properties */
		updateMaterial(): this

		/**
		 * Opens a dialog to replace the texture with another file
		 * @param force If true, no warning appears of the texture has unsaved changes
		 */
		reopen(force: boolean): void
		/**
		 * Reloads the texture. Only works in the desktop app
		 */
		reloadTexture(): void
		/**
		 * Get the material that the texture displays. When previewing PBR, this will return the shared PBR material
		 */
		getMaterial(): THREE.ShaderMaterial | THREE.MeshStandardMaterial
		/**
		 * Get the texture's own material
		 */
		getOwnMaterial(): THREE.ShaderMaterial
		/**
		 * Selects the texture
		 * @param event Click event during selection
		 */
		select(event?: Event): this
		/**
		 * Adds texture to the textures list and initializes it
		 * @param undo If true, an undo point is created
		 */
		add(undo?: boolean, uv_size_from_resolution?: boolean): Texture
		/**
		 * Removes the texture
		 * @param no_update If true, the texture is silently removed. The interface is not updated, no undo point is created
		 */
		remove(no_update?: boolean): void
		/** Toggles the texture's visibility in layered rendering. Textures that are not layered stay visible */
		toggleVisibility(): this
		/** Marks this texture as the particle texture of the model */
		enableParticle(): this
		/**
		 * Enables 'particle' on this texture if it is not enabled on any other texture
		 */
		fillParticle(): this
		/**
		 * Select this as the default texture in supported formats
		 */
		setAsDefaultTexture()
		/**
		 * Applies the texture to the selected elements
		 * @param all If true, the texture is applied to all faces of the elements. If 'blank', the texture is only applied to blank faces
		 */
		apply(all?: true | false | 'blank'): this
		/**
		 * Shows the texture file in the file explorer
		 */
		openFolder(): this
		/**
		 * Opens the texture in the configured image editor
		 */
		openEditor(): this
		/**
		 * Opens the texture in an image editor tab inside Blockbench
		 */
		openInImageEditor(): this
		/**
		 * Selects the texture and opens its context menu.
		 * @param event Event that opened the menu
		 */
		showContextMenu(event: MouseEvent): void
		/** Opens the texture's menu */
		openMenu(): void
		/** Opens a dialog to change the size of the texture */
		resizeDialog(): this
		/**
		 * Scroll the texture list to this texture
		 */
		scrollTo(): void
		/**
		 * Saves the texture as an image file.
		 * @param as If true, a new save location is requested even if the texture already has a path
		 */
		save(as?: any): this
		/**
		 * Returns the content of the texture as PNG as a base64 encoded string
		 */
		getBase64(): string
		/**
		 * Returns the content of the texture as PNG as a base64 encoded data URL
		 */
		getDataURL(): string
		/**
		 * Wrapper to do edits to the texture.
		 * @param callback
		 * @param options Editing options
		 */
		edit(
			callback?: (instance: HTMLCanvasElement | any) => void | HTMLCanvasElement,
			options?: TextureEditOptions
		): void
		/** The menu that opens when the texture is right-clicked */
		menu: Menu
		/**
		 * Get the selected layer. If no layer is selected, returns the bottom layer
		 */
		getActiveLayer(): TextureLayer
		/**
		 * Enables layers on the texture, creating a layer for the current content.
		 * @param undo If true, an undo entry is created
		 */
		activateLayers(undo?: boolean): void
		/**
		 * Turns the texture selection into a layer
		 * @param undo Whether to create an undo entry
		 * @param clone When true, the selection is copied into the new layer and also left on the original layer
		 */
		selectionToLayer(undo?: boolean, clone?: boolean): void
		/** Returns the texture reference as used in Java Block/Item model files */
		javaTextureLink(): string

		/** Returns the `.mcmeta` animation data of the texture, for formats that support it */
		getMCMetaContent(): {
			/** Animation data, present when the texture has more than one frame */
			animation?: {
				/** Duration of a single frame, in twentieths of a second */
				frametime: number
				/** Width of a single animation frame within the image */
				width?: number
				/** Height of a single animation frame within the image */
				height?: number
				/** Whether frames are interpolated between */
				interpolate?: boolean
				/** Frame indices in playback order */
				frames?: number[]
			}
		}
		/** Returns the animation frame indices in playback order, based on the frame order settings */
		getAnimationFrameIndices(): number[]

		/** Opens a dialog to export an emission map generated from the texture's alpha channel */
		exportEmissionMap(): void

		/**
		 * Stores the texture content in memory instead of linking it to a file.
		 * @param data_url Data URL that becomes the new source, defaults to the current image content
		 */
		convertToInternal(data_url?: string): this
		/**
		 * Redraws the texture content from the layers
		 * @param update_data_url If true, the texture source gets updated as well. This is slower, but is necessary at the end of an edit. During an edit, to preview changes, this can be false
		 */
		updateLayerChanges(update_data_url?: boolean): void
		/**
		 * Update everything after a content edit to the texture or one of the layers. Updates the material, the layers, marks the texture as unsaved, syncs changes to other projects
		 */
		updateChangesAfterEdit(): void
		/**
		 * Update the attached img element with the content from the texture's canvas
		 */
		updateImageFromCanvas(): void
		/**
		 * If layers are enabled, returns the active layer, otherwise returns the texture. Either way, the 'canvas', 'ctx', and 'offset' properties can be used from the returned object
		 */
		getActiveCanvas(): Texture | TextureLayer
		/**
		 * When editing the same texture in different tabs (via Edit In Blockbench option), sync changes that were made to the texture to other projects
		 */
		syncToOtherProject(): this

		/** Returns a copy of the texture for undo storage */
		getUndoCopy(): Texture
		/**
		 * Return the texture group that the texture is attached to
		 */
		getGroup(): TextureGroup | undefined

		/** All textures of the current project */
		static all: Texture[]
		/** Returns the texture that is used as the default texture in the project */
		static getDefault(): Texture
		/** All texture properties, keyed by property name */
		static properties: Record<string, Property<any>>

		/** Registered texture file formats, keyed by format ID */
		static file_formats: Record<string, FileFormatOptions>
		/** Returns the file extensions of all registered texture file formats, without the leading dot */
		static getAllExtensions(): string[]
	}
	/**
	 * Saves all textures
	 * @param lazy If true, the texture isn't saved if it doesn't have a local file to save to
	 */
	function saveTextures(lazy?: boolean): Promise<void>
	/**
	 * Update the draggable/sortable functionality of the texture list
	 */
	function loadTextureDraggable(): void
	/**
	 * Unselect all textures
	 */
	function unselectTextures(): void

	/**
	 * An Int Matrix holds an int (unsigned 8 bit) for each pixel in a matrix, via array. The override property can be used to set an override value for the entire area. This is used for texture selections.
	 */
	class IntMatrix {
		/**
		 * Creates a matrix. The pixel array does not exist until `activate()` is called.
		 * @param width Width of the matrix in pixels
		 * @param height Height of the matrix in pixels
		 */
		constructor(width: number, height: number)
		/** Width of the matrix in pixels */
		width: number
		/** Height of the matrix in pixels */
		height: number
		/** Pixel values of the matrix, or null while the matrix is not activated */
		array: null | Int8Array
		/**
		 * The override can be set to true to indicate that the whole texture is selected, or false, which indicates that nothing is selected. Null indicates a custom selection
		 */
		override: boolean | null
		/**
		 * True if there is a custom selection
		 */
		readonly is_custom: boolean
		/**
		 * The array does not exist by default to save memory, this activates it.
		 */
		activate(): void
		/**
		 * Get the value at the specified pixel
		 * @param x X coordinate
		 * @param y Y coordinate
		 * @returns The value of the targeted pixel
		 */
		get(x: number, y: number): number | boolean
		/**
		 * Test whether painting is allowed at a specific pixel
		 * @param x X coordinate
		 * @param y Y coordinate
		 * @returns Boolean or value of the pixel
		 */
		allow(x: number, y: number): number | boolean
		/**
		 * Get the value at the specified pixel directly without override and bounds check
		 * @param x X coordinate
		 * @param y Y coordinate
		 * @returns
		 */
		getDirect(x: number, y: number): number
		/**
		 * Return the smallest possible rectangle that contains all of the selection
		 * @param respect_empty If true, if there is no selection, the bounding box will still cover the entire area
		 */
		getBoundingRect(respect_empty: boolean = false): Rectangle
		/**
		 * Checks whether a selection is present and contains selected pixels
		 */
		hasSelection(): boolean
		/**
		 * Set the value at a specified pixel
		 * @param {*} x X coordinate
		 * @param {*} y Y coordinate
		 * @param {number} value
		 */
		set(x: number, y: number, value: number): void
		/**
		 * If there was a selection, whether override or not, clear it
		 */
		clear(): void
		/**
		 * Change override mode
		 * @param {true|false|null} value
		 * @returns
		 */
		setOverride(value: boolean | null): void
		/**
		 * Change the size of the matrix. Unless using overrides, the selection gets lost.
		 * @param {number} width
		 * @param {number} height
		 * @returns {boolean} Whether the size had to be changed
		 */
		changeSize(width: number, height: number): void
		/**
		 * Run a method on each pixel, whether selected or not
		 * @param callback Function to run per pixel
		 */
		forEachPixel(callback: (x: number, y: number, value: number, index: number) => void): void
		/**
		 * Shift custom selections by a specified offset
		 * @param offset_x
		 * @param offset_y
		 */
		translate(offset_x: number, offset_y: number): void
		/**
		 * Return the selection simplified into non-overlapping boxes. Boxes are [x, y, width, height].
		 */
		toBoxes(): [number, number, number, number][]
		/**
		 * Mask the provided canvas using the selection
		 * @param ctx Canvas 2D context
		 * @param offset Position offset of the canvas, e. g. when using a layer
		 */
		maskCanvas(ctx: CanvasRenderingContext2D, offset: ArrayVector2): void
	}

	/**
	 * Handles playback of animated textures
	 */
	namespace TextureAnimator {
		/** Whether the animated textures are currently playing */
		const isPlaying: boolean
		/** Timer that advances the animation */
		const interval: any
		/** Starts the playback of the animated textures */
		function start(): void
		/** Stops the playback of the animated textures */
		function stop(): void
		/** Starts the playback if it is stopped, otherwise stops it */
		function toggle(): void
		/** Restarts the playback so that a changed animation speed applies immediately */
		function updateSpeed(): void
		/** Advances the animation by one frame */
		function nextFrame(): void
		/** Stops the playback and resets all animated textures to their first frame */
		function reset(): void
		/** Updates the play/pause icon of the animation button */
		function updateButton(): void
		/**
		 * Sets the displayed frame of all animated textures from an animation time.
		 * @param anim_time Animation time in seconds, defaults to the time since the playback started
		 */
		function playAnimationFrame(anim_time?: number): void
	}
}
