/**
 * Global declarations for the file loading functions.
 */
declare global {
    /**
     * Registers the drag handlers for textures, models and plugins.
     */
    function setupDragHandlers(): void;
    /**
     * Loads a dropped or opened file with the matching codec.
     * @param file The file with its path and content.
     * @param args Options passed to the codec that loads the file.
     */
    function loadModelFile(file: any, args?: any): void;
    /**
     * Loads image files as textures.
     * @param files The image files to load.
     * @param event The event that dropped or selected the files, when available.
     */
    function loadImages(files: any, event?: Event): Promise<void>;
    /**
     * Shows a dialog explaining that the file format is not supported.
     * @param file_name The path of the file that could not be loaded.
     */
    function unsupportedFileFormatMessage(file_name: string): void;
    /**
     * The image extrusion dialog and its conversion utilities.
     */
    namespace Extruder {
        /**
         * Loads an image file into the extrusion dialog.
         * @param file The image file to load.
         */
        function drawImage(file: any): void;
        /**
         * Converts the loaded image into extruded elements.
         * @param formResult The values of the extrusion dialog.
         */
        function startConversion(formResult: any): void;
    }
}

export {};
