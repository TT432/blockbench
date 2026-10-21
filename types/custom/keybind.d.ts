/**
 * Keybindings and action control
 */
/// <reference types="./blockbench"/>

declare global {
	/**
	 * Keys that make up a keybind.
	 */
	export interface KeybindKeys {
		/**
		 * Main key, can be a numeric keycode or a lower case character
		 */
		key?: number | string
		/** Whether the Control key is part of the combination. */
		ctrl?: boolean
		/** Whether the Shift key is part of the combination. */
		shift?: boolean
		/** Whether the Alt key is part of the combination. */
		alt?: boolean
		/** Whether the Meta key is part of the combination. */
		meta?: boolean
	}
	/**
	 * The modifier condition under which a keybind variation applies.
	 */
	type VariationModifier =
		| 'always'
		| 'ctrl'
		| 'shift'
		| 'alt'
		| 'meta'
		| 'unless_ctrl'
		| 'unless_shift'
		| 'unless_alt'
	/**
	 * A modifier key name.
	 */
	type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta'
	/**
	 * A customizable keybind
	 */
	class Keybind {
		/**
		 * Create a keybind
		 * @param {object} keys Set up the default keys that need to be pressed
		 * @param {number|string} keys.key Main key. Check keycode.info to find out the numeric value, or simply use letters for letter keys
		 * @param {boolean} keys.ctrl Control key. On MacOS this automatically works for Cmd
		 * @param {boolean} keys.shift Shift key
		 * @param {boolean} keys.alt Alt key
		 * @param {boolean} keys.meta Meta key
		 */
		constructor(keys?: KeybindKeys | null, variations?: Record<string, VariationModifier>)
		/** The keycode of the main key, or a negative value when no key is assigned. */
		key: number
		/** Whether the Control key is part of the combination. */
		ctrl?: boolean
		/** Whether the Shift key is part of the combination. */
		shift?: boolean
		/** Whether the Alt key is part of the combination. */
		alt?: boolean
		/** Whether the Meta key is part of the combination. */
		meta?: boolean
		/** The modifier condition of each keybind variation. */
		variations?: {
			[key: string]: ModifierKey
		}
		/** The display label of the current key combination. */
		label: string
		/**
		 * Sets the key combination of the keybind.
		 * @param keys The keys to assign
		 * @param default_keybind Default keybind used to determine which modifiers are unset
		 */
		set(keys: KeybindKeys, default_keybind?: Keybind): this
		/**
		 * Unassign the assigned key
		 */
		clear(): this
		/**
		 * Save any changes to local storage
		 * @param save Save all keybinding changes to local storage. Set to false if updating multiple at once
		 */
		save(save?: boolean): this
		/**
		 * Assign an action to the keybind
		 * @param id ID of the action
		 * @param sub_id sub keybind ID
		 */
		setAction(id: string, sub_id?: string): this | undefined
		/**
		 * Get display text showing the keybind
		 * @param formatted If true, the return string will include HTML formatting
		 */
		getText(formatted?: boolean): string
		/**
		 * Get the name of the bound key
		 */
		getCode(key?: string): string
		/**
		 * Check if a key is assigned
		 */
		hasKey(): boolean
		/**
		 * Test if the keybind would be triggered by the event
		 */
		isTriggered(event: Event): boolean
		/**
		 * Test which variation would be triggered by the event. Returns the ID of the variation if triggered
		 * @param event The event to test
		 */
		additionalModifierTriggered(event: Event): string | undefined
		/**
		 * Test if a variation would be triggered by the event
		 * @param event The event to test
		 * @param variation The variation to test againts
		 */
		additionalModifierTriggered(event: Event, variation: string): boolean
		/**
		 * Open a UI to let the user record a new key combination
		 */
		record(): this
		/**
		 * Stop recording a new key combination
		 */
		stopRecording(): this
		/**
		 * Returns the label of the keybinding
		 */
		toString(): string

		/**
		 * Load an included keymap by ID
		 * @param id
		 * @param from_start_screen
		 */
		static loadKeymap(id: string, from_start_screen?: boolean): void | true
		/**
		 * Check if two KeybindItems are mutually exclusive, so only one can be available at the time. This is only the case if they each have a ConditionResolvable that is structured to support this
		 */
		static no_overlap(k1: KeybindItem, k2: KeybindItem): boolean
	}

	/**
	 * A dialog-based interface to search and trigger actions and other things
	 */
	namespace ActionControl {
		/** Whether the action control dialog is open. */
		const open: boolean
		/** The interface type of the action control. */
		const type: string
		/** The maximum number of entries shown in the action control list. */
		const max_length: number
		/**
		 * Opens the action control and searches for the given input.
		 * @param input The initial search input
		 */
		function select(input?: string): void
		/**
		 * Shows the action control with the given search input.
		 * @param input The initial search input
		 */
		function show(input?: string): void
		/** Closes the action control. */
		function hide(): void
		/**
		 * Triggers the entry that is currently selected in the action control.
		 * @param event The event that triggered the confirmation
		 */
		function confirm(event: Event): void
		/** Closes the action control without triggering an entry. */
		function cancel(): void
		/**
		 * Triggers the given action control entry.
		 * @param action The entry to trigger
		 * @param event The event that triggered the entry
		 */
		function trigger(action: any, event: Event): void
		/**
		 * Triggers the given entry and closes the action control.
		 * @param action The entry to trigger
		 * @param event The event that triggered the entry
		 */
		function click(action: any, event: Event): void
		/**
		 * Handles keyboard input while the action control is open.
		 * @param event The keyboard event to handle
		 * @returns Whether the event was handled
		 */
		function handleKeys(event: Event): boolean
	}
	/**
	 * Stores and handles keybinds
	 */
	namespace Keybinds {
		/** The keybinding settings dialog. */
		let dialog: Dialog
		/** The bar items that have keybinds. */
		const actions: BarItem[]
		/** The saved key combinations, keyed by action ID. */
		const stored: Record<string, {
			/** The saved keycode. */
			key: number
			/** Whether Control is part of the saved combination. */
			ctrl: boolean
			/** Whether Shift is part of the saved combination. */
			shift: boolean
		}>
		/** Additional keybind items that are not registered as actions. */
		const extra: Record<string, KeybindItem>
		/** The keybinding categories and the actions listed in them. */
		const structure: any
		/** Saves the stored keybinds to local storage. */
		function save(): void
		/** Resets the stored keybinds. */
		function reset(): void
		/**
		 * Loads a keymap preset, replacing the current keybinds.
		 * @param id The ID of the keymap preset
		 * @param from_start_screen Whether the keymap is loaded from the start screen
		 */
		function loadKeymap(id: string, from_start_screen: boolean = false): true | void
	}
	/** The vertex snapping tool. */
	const Vertexsnap: any
}

export {}
