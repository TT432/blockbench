/**
 * A version string split into its numeric parts.
 */
interface ParsedVersion {
	/**
	 * The original version string.
	 */
	string: string
	/**
	 * The dot-separated numbers of the main version.
	 */
	version: number[]
	/**
	 * The dot-separated numbers of the beta version, if present.
	 */
	beta?: number[]
}

/**
 * A comparison operator accepted by `VersionUtil.compare`.
 */
type Operator = '<=' | '==' | '>=' | '>' | '<'

/**
 * Utilities to parse, compare and format version strings.
 */
declare namespace VersionUtil {
	/**
	 * Parses a version string such as `1.2.3` or `1.2.3-beta.4`.
	 * @param versionString The version string to parse.
	 */
	function parse(versionString: string): ParsedVersion

	/**
	 * Compare two version strings.
	 * @returns 0 if equal, -1 if versionA < versionB, 1 if versionA > versionB
	 */
	function compare(versionA: string, versionB: string): number
	/**
	 * Compare two version strings with an operator.
	 * @returns true if the comparison is true, false otherwise
	 */
	function compare(versionA: string, operator: Operator, versionB: string): boolean

	/**
	 * Format a version string for display.
	 * E.g. "4.8.0-beta.3" becomes "4.8.0 Beta 3"
	 */
	function format(version: string): string
}

/**
 * The global window interface.
 */
declare interface Window {
	/**
	 * The version utilities, exposed on the window.
	 */
	VersionUtil: typeof VersionUtil
}
