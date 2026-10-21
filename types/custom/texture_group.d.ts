/// <reference types="./blockbench"/>

/**
 * Data used to create or save a texture group.
 */
interface TextureGroupOptions {
	/** Unique identifier of the group */
	uuid?: string
	/** Name of the group */
	name?: string
	/** Whether the group works as a material */
	is_material?: boolean
	/** Material configuration of the group */
	material_config?: TextureGroupMaterialConfigData
}

/**
 * A way to group textures. Texture groups can also be used to represent materials in enabled formats
 */
declare class TextureGroup {
	/** All texture groups of the current project */
	static all: TextureGroup[]

	/**
	 * Creates a texture group. The group is not part of the project until `add()` is called.
	 * @param data Initial group data
	 * @param uuid Unique identifier, generated when omitted
	 */
	constructor(data?: Omit<TextureGroupOptions, 'uuid'>, uuid?: string)
	/** Unique identifier of the group */
	uuid: string
	/** Name of the group */
	name: string
	/** Whether the group is collapsed in the texture panel */
	folded: boolean
	/**
	 * If true, the texture group works as a material
	 */
	is_material: boolean
	/**
	 * Material configuration
	 */
	material_config: TextureGroupMaterialConfig
	/** The material that represents this group in the preview */
	get material(): THREE.MeshStandardMaterial
	/**
	 * Applies the provided group data to this group.
	 * @param data Group data to apply
	 */
	extend(data: TextureGroupOptions): this
	/** Adds the group to the project */
	add(): this
	/** Selects all textures of the group */
	select(): this
	/** Removes the group from the project. Its textures stay in the project */
	remove(): void
	/**
	 * Opens the group's context menu.
	 * @param event Event that opened the menu
	 */
	showContextMenu(event: Event): void
	/** Opens a prompt to rename the group */
	rename(): this
	/** Returns all textures that belong to the group */
	getTextures(): Texture[]
	/** Returns a copy of the group for undo storage, including its position in the group list */
	getUndoCopy(): Required<TextureGroupOptions>
	/** Returns a copy of the group as it is saved in project files */
	getSaveCopy(): Omit<TextureGroupOptions, 'is_material' | 'uuid'>
	/** Rebuilds the group's material from its PBR textures and material configuration */
	updateMaterial(): void
	/** Returns the group's material, creating it when it does not exist yet */
	getMaterial(): THREE.MeshStandardMaterial
}

/**
 * Data used to save or restore a texture group's material configuration.
 */
interface TextureGroupMaterialConfigData {
	/** Uniform color, as RGBA with channels from 0 to 255 */
	color_value?: [number, number, number, number]
	/** Uniform metalness, emissive and roughness values, each from 0 to 255 */
	mer_value?: [number, number, number]
	/** Whether the configuration is saved, without unsaved changes */
	saved?: boolean
}
/**
 * Holds the material settings of a texture group, for formats that support material texture groups.
 */
declare class TextureGroupMaterialConfig {
	/**
	 * Creates the material configuration of a texture group.
	 * @param texture_group The group that owns the configuration
	 * @param data Initial configuration data
	 */
	constructor(texture_group: TextureGroup, data: TextureGroupMaterialConfigData)
	/** Uniform color used when the group has no color texture, as RGBA with channels from 0 to 255 */
	color_value: [number, number, number, number]
	/** Uniform metalness, emissive and roughness values used when the group has no MER texture, each from 0 to 255 */
	mer_value: [number, number, number]
	/** Whether the configuration is saved, without unsaved changes */
	saved: boolean
	/** The menu that opens when the configuration is right-clicked */
	menu: Menu
	/** The texture group that owns the configuration */
	texture_group: TextureGroup

	/**
	 * Applies the provided configuration data.
	 * @param data Configuration data to apply
	 */
	extend(data: TextureGroupMaterialConfigData): this
	/** Returns a copy of the configuration for undo storage */
	getUndoCopy(): {}
	/** Returns a copy of the configuration as it is saved in project files */
	getSaveCopy(): {}
	/** Returns the texture set content that represents the group in Bedrock resource packs */
	compileForBedrock(): {
		/** Version of the texture set format */
		format_version: string
		/** Texture set content, with a channel entry for each provided PBR channel */
		'minecraft:texture_set': {}
	}
	/** Returns the path of the texture set file, derived from the group's color texture, or an empty string if the group has no color texture */
	getFilePath(): string
	/**
	 * Returns the file name of the texture set file.
	 * @param extension Whether to include the file extension
	 */
	getFileName(extension?: boolean): string
	/** Writes the texture set file to disk, or exports it in the web app */
	save(): void
	/**
	 * Opens the configuration's context menu.
	 * @param event Event that opened the menu
	 */
	showContextMenu(event: Event): void
	/** Opens a dialog to edit the material configuration */
	propertiesDialog(): void
}
/**
 * Imports a `.texture_set.json` file as a material texture group.
 * @param file File to import
 * @param undo Whether to create an undo entry
 */
declare function importTextureSet(file: any, undo: boolean = true): void
