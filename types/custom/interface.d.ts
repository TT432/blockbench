/// <reference types="./blockbench"/>

/**
 * Update the size of everything in the UI after the window has been resized or other UI size changes have happeped
 * @param event 
 */
declare function resizeWindow(event?: Event): void

/**
 * The interface module that manages sidebars, panels and custom interface elements.
 */
declare namespace Interface {
	/**
	 * Creates an HTML element.
	 * @param type Tag name of the element
	 * @param attributes Attributes to set on the element. Keys that start with `@` are registered as event listeners.
	 * @param content Text content or child nodes to append
	 * @returns The created element
	 */
	function createElement(
		type: keyof HTMLElementTagNameMap,
		attributes?: {},
		content?: string | HTMLElement | HTMLElement[]
	): HTMLElement

	/**
	 * Interface layout data that is restored from local storage.
	 */
	const data: {
		/**
		 * Default width of the left sidebar.
		 */
		left_bar_width: number
		/**
		 * Default width of the right sidebar.
		 */
		right_bar_width: number
		/**
		 * Horizontal position of the quad view divider, as a percentage of the preview width.
		 */
		quad_view_x: number
		/**
		 * Vertical position of the quad view divider, as a percentage of the preview height.
		 */
		quad_view_y: number
		/**
		 * Width of the timeline head.
		 */
		timeline_head: number
		/**
		 * Width of the start screen.
		 */
		start_screen_width: number
		/**
		 * Panel IDs stored for the left sidebar.
		 */
		left_bar: string[]
		/**
		 * Panel IDs stored for the right sidebar.
		 */
		right_bar: string[]
	}
	/**
	 * Width of the left sidebar, or 0 while the sidebar is hidden.
	 */
	let left_bar_width: number
	/**
	 * Width of the right sidebar, or 0 while the sidebar is hidden.
	 */
	let right_bar_width: number
	/**
	 * Height of the top panel area.
	 */
	let top_panel_height: number
	/**
	 * Height of the bottom panel area.
	 */
	let bottom_panel_height: number
	/**
	 * Default values of the interface layout data.
	 */
	let default_data: any
	/**
	 * Returns the active panel in the top slot, if there is one.
	 */
	function getTopPanel(): Panel
	/**
	 * Returns the active panel in the bottom slot, if there is one.
	 */
	function getBottomPanel(): Panel
	/**
	 * Returns the active panels in the left sidebar.
	 * @param in_order Whether to sort the panels by their sidebar position
	 */
	function getLeftPanels(in_order: boolean = true): Panel[]
	/**
	 * Returns the active panels in the right sidebar.
	 * @param in_order Whether to sort the panels by their sidebar position
	 */
	function getRightPanels(in_order: boolean = true): Panel[]
	/**
	 * Returns the layout data of the current UI mode.
	 */
	function getModeData(): any
	/**
	 * Resizer lines of the interface, keyed by their ID.
	 */
	const Resizers: {
		/**
		 * Resizer between the center screen and the left sidebar.
		 */
		left: ResizeLine
		/**
		 * Resizer between the center screen and the right sidebar.
		 */
		right: ResizeLine
		/**
		 * Vertical resizer between the preview panels of the quad view.
		 */
		quad_view_x: ResizeLine
		/**
		 * Horizontal resizer between the preview panels of the quad view.
		 */
		quad_view_y: ResizeLine
		/**
		 * Resizer between the top panel and the center screen.
		 */
		top: ResizeLine
		/**
		 * Resizer between the bottom panel and the center screen.
		 */
		bottom: ResizeLine
		/**
		 * Resizer of the timeline head.
		 */
		timeline_head: ResizeLine
		/**
		 * Resizer of the start screen.
		 */
		start_screen_width: ResizeLine
		[id: string]: ResizeLine
	}
	/**
	 * The status bar of the interface.
	 */
	const status_bar: {
		/**
		 * Menu that is opened from the status bar.
		 */
		menu: Menu
		/**
		 * Vue instance of the status bar.
		 */
		vue: Vue
	}
	/**
	 * Vue instance of the project tab bar.
	 */
	let tab_bar: Vue
	/**
	 * All registered panels, keyed by panel ID.
	 */
	const Panels: {
		[key: string]: Panel
	}
	/**
	 * Shows or hides a sidebar and updates the layout.
	 * @param side Sidebar to toggle, `left` or `right`
	 * @param status Whether to show the sidebar. Toggles the current state when omitted.
	 */
	function toggleSidebar(side: any, status: any): void

	/**
	 * Context menu for text inputs, with copy and paste entries.
	 */
	const text_edit_menu: Menu

	/**
	 * Adds a hint for a modifier key that is displayed in the status bar.
	 * @param key Modifier key
	 * @param text Translation key of the hint
	 */
	function addSuggestedModifierKey(key: 'ctrl' | 'shift' | 'alt', text: string): void
	/**
	 * Removes a hint for a modifier key from the status bar.
	 * @param key Modifier key
	 * @param text Translation key of the hint
	 */
	function removeSuggestedModifierKey(key: 'ctrl' | 'shift' | 'alt', text: string): void

	/**
	 * Registers a callback that defines panels. The callback runs while the interface is set up.
	 */
	function definePanels(callback: () => void): void

	/**
	 * The center screen element of the interface.
	 */
	const center_screen: HTMLElement
	/**
	 * The wrapper element of the page.
	 */
	const page_wrapper: HTMLElement
	/**
	 * The preview element that contains the 3D viewport or the image editor.
	 */
	const preview: HTMLElement
	/**
	 * The work screen element that contains the center screen and the status bar.
	 */
	const work_screen: HTMLElement
	/**
	 * The element of the right sidebar.
	 */
	const right_bar: HTMLElement
	/**
	 * The element of the left sidebar.
	 */
	const left_bar: HTMLElement

	/**
	 * Custom interface elements that can be used in forms and dialogs.
	 */
	namespace CustomElements {
		/**
		 * A dropdown element that opens a menu with the provided options.
		 */
		class SelectInput<T extends Record<string, string>> {
			/**
			 * The element node of the select input.
			 */
			node: HTMLElement
			/**
			 * Creates a select input.
			 * @param id ID of the element
			 * @param options Configuration of the select input
			 */
			constructor(
				id: string,
				options: {
					/**
					 * Initially selected option value.
					 */
					value?: T[keyof T]
					/**
					 * Option value used when `value` is not set.
					 */
					default?: T[keyof T]
					/**
					 * Map of option values to their labels.
					 */
					options: T
					/**
					 * Set to true to display the specified icon of the selected option in the UI element
					 */
					display_icon?: boolean
					/**
					 * Called when the selected option changes.
					 */
					onChange?(value: T[keyof T]): void
				}
			)
			/**
			 * Sets the selected option and updates the element.
			 */
			set(value: T[keyof T]): void
		}
		/**
		 * The `ResizeLine` class, for creating custom resizer lines.
		 */
		const ResizeLine: any
	}
}
/**
 * Updates the interface, including the bar conditions, the menu bar and the panel layout.
 */
declare function updateInterface(): void
