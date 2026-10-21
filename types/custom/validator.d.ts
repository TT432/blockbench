/// <reference types="./blockbench"/>
/**
 * The validator in Blockbench provides feedback about the model and can detect issues in real time, based on a list of checks that can be added. This is a good way to ensure model files are valid, and to teach users about best practices.
 */
declare namespace Validator {
	/**
	 * All registered validator checks.
	 */
	const checks: ValidatorCheck[]

	/**
	 * Warnings collected by the checks during the last validation.
	 */
	const warnings: WarningOrError[]
	/**
	 * Errors collected by the checks during the last validation.
	 */
	const errors: WarningOrError[]
	/**
	 * Run the validator
	 * @param trigger ID of the Blockbench event that triggered the call
	 */
	function validate<T extends BlockbenchEventName>(trigger?: T): void
	/**
	 * Opens the Validator dialog
	 */
	function openDialog(): void
	/**
	 * The Validator dialog, created the first time it is opened
	 */
	const dialog: Dialog

	/**
	 * Cached trigger IDs
	 */
	const triggers: BlockbenchEventName[]
	/**
	 * Update the cached triggers list
	 */
	function updateCashedTriggers(): void
}

/**
 * Options that configure a validator check.
 */
interface ValidatorCheckOptions {
	/**
	 * Function that runs when the validator check runs
	 */
	run(): void
	/**
	 * Names of events that automatically trigger this check
	 */
	update_triggers?: BlockbenchEventName[]
	/**
	 * Condition that decides whether the check is run.
	 */
	condition?: ConditionResolvable
}
/**
 * A problem reported by a validator check.
 */
interface WarningOrError {
	/**
	 * Message that describes the problem, displayed in the Validator dialog.
	 */
	message: string
	/**
	 * Buttons that are offered for this problem in the Validator dialog.
	 */
	buttons?: {
		/**
		 * Name of the button, used as its tooltip.
		 */
		name: string
		/**
		 * Icon of the button.
		 */
		icon: IconString
		/**
		 * Called when the button is clicked.
		 */
		click(): void
	}[]
}

/**
 * A check for the validator. A check can be triggered by certain things, and updates the list of warnings and errors that can be displayed in the status bar.


### Example:

```javascript
	new ValidatorCheck('special_cube_name_rule', {
		update_triggers: ['update_selection'],
		run() {
			Cube.all.forEach(cube => {
				if (cube.name == 'sphere') {
					this.warn({
						message: `The cube "${cube.name}" has an invalid names. Cubes may not be called "sphere".`,
						buttons: [
							{
								name: 'Select Cube',
								icon: 'fa-cube',
								click() {
									Validator.dialog.hide();
									cube.select();
								}
							}
						]
					})
				}
			})
		}
	})
```
 */
declare class ValidatorCheck extends Deletable {
	/**
	 * The unique ID of this check.
	 */
	id: string
	/**
	 * Name of this check, displayed when listing the checks of a plugin.
	 */
	name: string
	/**
	 * ID of the plugin that created this check.
	 */
	plugin?: string
	/**
	 * Creates a check and adds it to the validator.
	 * @param id Unique ID of the check
	 * @param options Options that configure the check
	 */
	constructor(id: string, options: ValidatorCheckOptions)

	/**
	 * Manually run this check
	 */
	update(): void
	/**
	 * Throw a warning. This is intended to be used inside the run() method
	 */
	warn(...warnings: WarningOrError[]): void
	/**
	 * Throw an error. This is intended to be used inside the run() method
	 */
	fail(...warnings: WarningOrError[]): void
}
