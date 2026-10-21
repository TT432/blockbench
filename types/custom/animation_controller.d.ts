/// <reference types="./blockbench"/>

/**
 * A reference to an animation used by an animation controller state, as a name, a name-value map, or an internal link.
 */
type StateAnimationInput =
	| string
	| {
			[key: string]: string
	  }
	| {
			/** The UUID of the animation link. */
			uuid: string
			/** The short name of the referenced animation. */
			key?: string
			/** The UUID of the referenced animation. */
			animation?: string
			/** The value used to blend the animation. */
			blend_value?: number
	  }
/**
 * A resolved animation link inside an animation controller state.
 */
type StateAnimation = {
	/** The UUID of the animation link. */
	uuid: string
	/** The short name of the referenced animation. */
	key: string
	/** The UUID of the referenced animation. */
	animation: string
	/** The value used to blend the animation. */
	blend_value: number
}

/**
 * Options used to create an animation controller state.
 */
interface AnimationControllerStateOptions {
	/** The name of the state. */
	name?: string
	/** The animations played in the state. */
	animations?: StateAnimationInput[]
	/** The transitions from the state to other states. */
	transitions?: any[]
	/** The sound effects triggered when the state is entered. */
	sounds?: any[]
	/** The particle effects spawned when the state is entered. */
	particles?: any[]
	/** The Molang script that runs when the state is entered. */
	on_entry?: string
	/** The Molang script that runs when the state is exited. */
	on_exit?: string
	/** The blend transition time applied when the state is entered. */
	blend_transition?: number
	/** Whether the blend transition uses the shortest path between rotations. */
	blend_via_shortest_path?: boolean
}

/**
 * A state inside an animation controller, holding the animations, effects and transitions that belong to it.
 */
declare class AnimationControllerState {
	/**
	 * Creates a state and registers it with the controller.
	 * @param controller The controller that owns the state
	 * @param options Initial state data
	 */
	constructor(controller: AnimationController, options?: AnimationControllerStateOptions)
	/** The controller that owns this state. */
	controller: AnimationController
	/** The UUID of the state. */
	uuid: string
	/** The name of the state. */
	name: string
	/** Whether each section is collapsed in the state interface. */
	fold: {
		/** Whether the animations section is collapsed. */
		animations: boolean
		/** Whether the particles section is collapsed. */
		particles: boolean
		/** Whether the sounds section is collapsed. */
		sounds: boolean
		/** Whether the entry script section is collapsed. */
		on_entry: boolean
		/** Whether the exit script section is collapsed. */
		on_exit: boolean
		/** Whether the transitions section is collapsed. */
		transitions: boolean
	}
	/** Whether sound and particle effects are muted in the state interface. */
	muted: {
		/** Whether sounds are muted. */
		sound: boolean
		/** Whether particles are muted. */
		particle: boolean
	}
	/** The sound elements currently playing for this state. */
	playing_sounds: HTMLAudioElement[]
	/** The animations played in this state. */
	animations: StateAnimation[]
	/** The transitions from this state to other states. */
	transitions: any[]
	/** The sound effects triggered when the state is entered. */
	sounds: any[]
	/** The particle effects spawned when the state is entered. */
	particles: any[]
	/** The Molang script that runs when the state is entered. */
	on_entry: string
	/** The Molang script that runs when the state is exited. */
	on_exit: string
	/** The blend transition time applied when the state is entered. */
	blend_transition: number
	/** Whether the blend transition uses the shortest path between rotations. */
	blend_via_shortest_path: boolean

	/**
	 * Merges the given data into this state.
	 * @param data The state data to merge
	 */
	extend(data: AnimationControllerStateOptions): void
	/** Returns a serializable snapshot of the state for the undo history. */
	getUndoCopy(): any
	/** Returns the Bedrock Edition JSON representation of the state. */
	compileForBedrock(): any
	/**
	 * Selects the state, running its entry script and playing its effects.
	 * @param force Select the state even if it is already selected
	 */
	select(force?: boolean): void
	/** Unselects the state, running its exit script and stopping its playing sounds. */
	unselect(): void
	/** Plays the sound and particle effects of the state. */
	playEffects(): void
	/** Scrolls the animation controller panel to this state. */
	scrollTo(): void
	/** Opens a prompt to rename the state. */
	rename(): void
	/**
	 * Removes the state from its controller and clears transitions that target it.
	 * @param undo Whether to record the removal as an undoable edit
	 */
	remove(undo?: boolean): void
	/** Renames the state so that its name is unique within the controller. */
	createUniqueName(): void

	/**
	 * Adds an animation link to the state.
	 * @param animation The animation to link
	 */
	addAnimation(animation?: BBAnimation): void
	/**
	 * Adds a transition to another state.
	 * @param target_uuid The UUID of the target state
	 */
	addTransition(target_uuid?: string): void
	/**
	 * Adds a particle effect to the state.
	 * @param options Initial particle data
	 */
	addParticle(options?: {
		/** The particle effect name. */
		effect: string
	}): void
	/**
	 * Adds a sound effect to the state.
	 * @param options Initial sound data
	 */
	addSound(options?: {
		/** The sound effect name. */
		effect: string
		/** The path of the sound file. */
		file: string
	}): void
	/**
	 * Opens the context menu of the state.
	 * @param event The event used to position the menu
	 */
	openMenu(event: Event): void
	/**
	 * Returns the current animation time of the state in seconds
	 */
	getStateTime(): number
}

/**
 * Options used to create an animation controller.
 */
interface AnimationControllerOptions {
	/** The name of the animation controller. */
	name?: string
	/** The UUID of the animation controller. */
	uuid?: string
	/** The file path the animation controller is saved to. */
	path?: string
	/** The UUID or name of the state the controller starts in. */
	initial_state?: string
}

/**
 * Animation Controllers are state machines used for Minecraft: Bedrock Edition models to control and blend between animations.
 */
declare class AnimationController extends AnimationItem {
	/**
	 * Creates an animation controller and initializes it from the given data.
	 * @param data Initial controller data
	 */
	constructor(data?: AnimationControllerOptions)
	/** The name of the animation controller. */
	name: string
	/** The file path the animation controller is saved to. */
	path: string
	/** The UUID of the animation controller. */
	uuid: string
	/** Whether the controller preview is playing. */
	playing: boolean
	/** Whether the controller is marked as saved. */
	saved: boolean
	/** Whether the controller is selected. */
	selected: boolean
	/** The name under which the controller was last saved. */
	saved_name: string
	/** The states of the controller. */
	states: AnimationControllerState[]
	/** The UUID of the state the controller starts in. */
	initial_state: string
	/** The state that is currently active in the preview, or `null`. */
	selected_state: null | AnimationControllerState
	/**
	 * Merges the given data into this controller.
	 * @param data The controller data to merge
	 */
	extend(data: AnimationControllerOptions): this
	/** Returns a serializable snapshot of the controller for the undo history. */
	getUndoCopy(): any
	/** Returns the Bedrock Edition JSON representation of the controller. */
	compileForBedrock(): any
	/** Saves the controller to its file or exports it as a download. */
	save(): this | undefined
	/** Selects the controller and shows it in the animation controller panel. */
	select(): this | undefined
	/**
	 * Renames the controller so that its name is unique for its file path.
	 * @param references Additional controllers to treat as taken
	 * @returns The resulting name, or `false` if no unique name could be found
	 */
	createUniqueName(references: AnimationController[]): string | boolean
	/** Opens a prompt to rename the controller. */
	rename(): this
	/**
	 * Adds the animation controller to the current project and to the interface
	 * @param undo If true, the addition of the animation controller will be registered as an edit
	 */
	add(undo?: boolean): this
	/**
	 * Removes the controller from the project.
	 * @param undo Whether to record the removal as an undoable edit
	 * @param remove_from_file Whether to also delete the controller from its file
	 */
	remove(undo?: boolean, remove_from_file?: boolean): this
	/** Opens the properties dialog of the controller. */
	propertiesDialog(): void
	/**
	 * Updates the preview of the controller, including updating the animations and switching states if preview mode is set to play
	 */
	updatePreview(): void
	/**
	 * Toggles the preview playback of the controller.
	 * @param state Explicit playback state to set instead of toggling
	 * @returns Whether the controller is playing
	 */
	togglePlayingState(state?: boolean): boolean
	/**
	 * Opens the context menu of the controller.
	 * @param event The event or element used to position the menu
	 */
	showContextMenu(event: Event | HTMLElement): void
}
