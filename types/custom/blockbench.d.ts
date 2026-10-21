/// <reference types="vue" />
/// <reference types="./libs" />
/// <reference types="@types/prismjs" />
/// <reference types="@types/jquery" />
/// <reference types="wintersky" />

/// <reference types="./texture_group" />
/// <reference types="./keybind" />
/// <reference types="./animation" />
/// <reference types="./animation_controller" />
/// <reference types="./canvas_frame" />
/// <reference types="./canvas" />
/// <reference types="./copy_paste" />
/// <reference types="./cube" />
/// <reference types="./desktop" />
/// <reference types="./display_mode" />
/// <reference types="./global" />
/// <reference types="./group" />
/// <reference types="./interface" />
/// <reference types="./keyframe" />
/// <reference types="./mesh" />
/// <reference types="./spline_mesh" />
/// <reference types="./misc" />
/// <reference types="./molang" />
/// <reference types="./outliner" />
/// <reference types="./painter" />
/// <reference types="./edit_session" />
/// <reference types="./screencam" />
/// <reference types="./textures" />
/// <reference types="./timeline" />
/// <reference types="./undo" />
/// <reference types="./util" />
/// <reference types="./io" />
/// <reference types="./uveditor" />
/// <reference types="./validator" />
/// <reference types="./display_mode" />
/// <reference types="./misc" />
/// <reference types="./util" />
/// <reference types="./math_util" />
/// <reference types="./canvas_frame" />
/// <reference types="./io" />
/// <reference types="./native_apis" />
/// <reference types="./util/VersionUtil" />

/**
 * Provides access to global Javascript/DOM variables that are overwritten by Blockbench's own variables
 */
declare const NativeGlobals: {
	/** The native DOM `Animation` constructor. */
	Animation: {
		new (
			effect?: AnimationEffect | null | undefined,
			timeline?: AnimationTimeline | null | undefined
		): Animation
		/** The prototype of the native `Animation` interface. */
		prototype: Animation
	}
}

/**
 * Shader support
 */
declare module "*.glsl" {
	/** The shader source code. */
	const value: string;
	export default value;
}
/**
 * Theme files imported as modules.
 */
declare module "*.bbtheme" {
	/** The CSS source of the theme. */
	const value: string | any;
	export default value;
}
/** A PNG image asset module. */
declare module "*.png"
/** A WebP image asset module. */
declare module "*.webp"
/** A JPEG image asset module. */
declare module "*.jpeg"
