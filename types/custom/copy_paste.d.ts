/**
 * Declarations that are added to the global scope.
 */
declare global {
    /**
     * The clipboard module that stores copied data and handles the copy and paste actions.
     */
    namespace Clipbench {
        /**
         * Save copies of the copied outliner elements.
         */
        let elements: any[];
        /**
         * Data of the copied texture layer.
         */
        let layer: any;
        /**
         * Map of original outliner nodes to their duplicates during duplication and paste.
         */
        let duplicate_map: Map<OutlinerNode, OutlinerNode>
        /**
         * Clipboard content types that the copy and paste actions support.
         */
        enum types {
            text = 'text',
            display_slot = 'display_slot',
            keyframe = 'keyframe',
            animation = 'animation',
            face = 'face',
            mesh_selection = 'mesh_selection',
            texture = 'texture',
            layer = 'layer',
            outliner = 'outliner',
            texture_selection = 'texture_selection',
            image = 'image',
        }
        /**
         * Image copied from the texture editor, with its position in the texture.
         */
        let image: undefined | {
            /**
             * Horizontal position of the image in the texture.
             */
            x: number,
            /**
             * Vertical position of the image in the texture.
             */
            y: number,
            /**
             * Frame of the texture that the image belongs to.
             */
            frame?: number
            /**
             * Image data, stored as a data URL.
             */
            data: string
        }
        /**
         * Icons of the paste types, keyed by type.
         */
        namespace type_icons {
            /**
             * Icon of the face paste type.
             */
            let face = 'aspect_ratio';
            /**
             * Icon of the mesh selection paste type.
             */
            let mesh_selection = 'fa-gem';
            /**
             * Icon of the outliner paste type.
             */
            let outliner = 'fas.fa-cube';
        }
        /**
         * Returns the clipboard type that applies to the current selection and panel.
         * @param mode `1` to test for copying, `2` to test for pasting
         * @param check Set to true to skip the check for a focused text input
         */
        function getCopyType(mode: any, check: any): Clipbench.types;
        /**
         * Returns the clipboard type that applies to the current panel. Asks the user when several types are possible.
         */
        function getPasteType(): Promise<Clipbench.types>;
        /**
         * Copies the current selection or the selected text to the clipboard.
         * @param cut Set to true to remove the copied content after copying
         */
        function copy(event: Event, cut: any): void;
        /**
         * Pastes the clipboard content into the current panel.
         */
        function paste(event: Event): Promise<void>;
        /**
         * Stores the provided groups as clipboard content.
         */
        function setGroups(groups: Group[]): void;
        /**
         * Stores the provided elements as clipboard content.
         */
        function setElements(arr: OutlinerElement[]): void;
        /**
         * Writes the text to the clipboard.
         */
        function setText(text: string): void;
        /**
         * Stores the selected vertices and faces of the mesh as clipboard content.
         */
        function setMeshSelection(mesh: Mesh): void;
        /**
         * Pastes the stored mesh selection into the selected meshes.
         */
        function pasteMeshSelection(): void;
        /**
         * Pastes the stored elements or groups into the outliner.
         */
        function pasteOutliner(event: Event): void;
        /**
         * Pastes the image from the clipboard as a new texture.
         */
        function pasteImage(): void;
    }
}

export {};
