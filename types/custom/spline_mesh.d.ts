/// <reference types="./blockbench"/>


/** The tube face of a spline, used as a runtime stand-in so the spline can be painted on. */
declare class SplineTubeFace extends MeshFace {
    /**
     * Creates a tube face for the given spline.
     * @param mesh The mesh that provides the vertex data.
     * @param spline The spline that owns the face.
     * @param data Initial face data.
     */
    constructor(mesh: any, spline: any, data: any);
    /** The spline that owns this face. */
    get element(): SplineMesh;
    /** Returns the texture of the spline that owns this face. */
    getTexture(): Texture;
}
/** Options that describe a single curve segment of a spline. */
interface SplineCurveOptions {
	/** The key of the handle at the start of the curve. */
	start_handle: any
	/** The key of the handle at the end of the curve. */
	end_handle: any
	/** The key of the vertex at the start of the curve. */
	start: any
	/** The key of the vertex at the end of the curve. */
	end: any
	/** The key of the control vertex that follows the start vertex. */
	start_ctrl: any
	/** The key of the control vertex that precedes the end vertex. */
	end_ctrl: any
}
/** A single cubic Bézier segment of a spline. */
declare class SplineCurve {
    /**
     * Creates a curve that belongs to the given spline.
     * @param spline The spline that owns the curve.
     * @param data Initial curve data.
     */
    constructor(spline: SplineMesh, data: SplineCurveOptions);
    /** The spline that owns this curve. */
    get element(): SplineMesh;
    /** Applies the given data to the curve. */
    extend(data: SplineCurveOptions): this;
    /** Returns the key of the curve, or `undefined` if it is not part of its spline. */
    getCurveKey(): string | undefined;
    /** Returns whether both ends of the curve are selected. */
    isSelected(): boolean;
    /** Returns the data that is saved to the project file. */
    getSaveCopy(): {
        /** The key of the handle at the start of the curve. */
        start_handle: any;
        /** The key of the handle at the end of the curve. */
        end_handle: any;
        /** The key of the vertex at the start of the curve. */
        start: any;
        /** The key of the control vertex that follows the start vertex. */
        start_ctrl: any;
        /** The key of the control vertex that precedes the end vertex. */
        end_ctrl: any;
        /** The key of the vertex at the end of the curve. */
        end: any;
    };
    /** Returns the copy of the curve that is used by the undo system. */
    getUndoCopy(): any;
    /**
     * Splits a curve in two distinct paths using De Casteljau's algorithm.
     * The split happens at the corresponding T (time) on the initial curve.
     *
     * @param {float} time Point at which the split occurs (in % from 0 to 1)
     * @returns {array} Adjusted and new points for our two new curves, as two Objects, one per curve.
     */
    split(time: any): {
        /** The start vertex of the first new curve. */
        start: any;
        /** The first control vertex of the first new curve. */
        start_ctrl: any;
        /** The second control vertex of the first new curve. */
        middle_ctrl1: any;
        /** The vertex shared by both new curves. */
        middle: any;
        /** The first control vertex of the second new curve. */
        middle_ctrl2: any;
        /** The second control vertex of the second new curve. */
        end_ctrl: any;
        /** The end vertex of the second new curve. */
        end: any;
    };
}
/** Options used to create a spline handle. */
interface SplineHandle {

}
/** The joint and control vertices of a spline handle. */
declare class SplineHandle {
    /**
     * Creates a handle that belongs to the given spline.
     * @param spline The spline that owns the handle.
     * @param data Initial handle data.
     */
    constructor(spline: SplineMesh, data: SplineHandle);
    /** The spline that owns this handle. */
    get element(): SplineMesh;
    /** Applies the given data to the handle. */
    extend(data: SplineHandle): this;
    /** Returns the key of the handle, or `undefined` if it is not part of its spline. */
    getHandleKey(): string | undefined;
    /** Returns whether the joint of the handle is selected. */
    isSelected(): boolean;
    /** Returns the data that is saved to the project file. */
    getSaveCopy(): {
        /** The key of the first control vertex. */
        control1: any;
        /** The key of the joint vertex. */
        joint: any;
        /** The key of the second control vertex. */
        control2: any;
        /** The tilt of the handle. */
        tilt: any;
        /** The size of the handle. */
        size: any;
    };
    /** Returns the copy of the handle that is used by the undo system. */
    getUndoCopy(): any;
}
/** Options used to create or update a spline. */
interface SplineMeshOptions {

}
/** A spline element that is rendered as a tube or as a path. */
declare class SplineMesh extends OutlinerElement {
    /**
     * Creates a spline element.
     * @param data Initial spline data.
     * @param uuid The UUID to use for the element.
     */
    constructor(data: any, uuid: any);
    /** The vertices of the spline, mapped by vertex key. */
    get vertices(): Record<string, ArrayVector3>;
    /** The handles of the spline, mapped by handle key. */
    get handles(): Record<string, SplineHandle>;
    /** The curves of the spline, mapped by curve key. */
    get curves(): Record<string, SplineCurve>;
    /** Replaces the vertices of the spline. */
    set vertices(v: Record<string, ArrayVector3>);
    /** Replaces the handles of the spline. */
    set handles(v: Record<string, SplineHandle>);
    /** Replaces the curves of the spline. */
    set curves(v: Record<string, SplineCurve>);
    /** The origin of the spline. */
    get position(): ArrayVector3;
    /** The vertex positions of the spline as a list. */
    get vertice_list(): any[];
    /** The tube faces of the spline, mapped by face key. */
    faces: Record<string, SplineTubeFace>
    /** Whether the spline forms a loop. */
    cyclic: boolean
    /** Whether the spline is included in exports. */
    export: boolean
    /** Whether space indicators are displayed along the spline. */
    display_space: boolean
    /** The number of segments around the tube. */
    radial_resolution: number
    /** The multiplier applied to the radius of the tube. */
    radius_multiplier: number
    /** The number of segments along the tube. */
    tubular_resolution: number
    /** How the tube lays out its UVs. */
    uv_mode: 'length_accurate' |'uniform' | 'per_segment'
    /** Whether the spline is rendered as a mesh tube or as a path. */
    render_mode: 'mesh' | 'path'
    /** The render order of the spline relative to other elements. */
    render_order: 'default' | 'behind' | 'in_front'
	/** The shading mode of the tube. */
	shading: 'flat' | 'smooth'

    /** Adds vertices at the given positions and returns their new keys. */
    addVertices(...vectors: ArrayVector3[]): any[];
    /** Adds handles to the spline and returns their new keys. */
    addHandles(...handles: SplineHandle[]): any[];
    /** Adds curves to the spline and returns their new keys. */
    addCurves(...curves: SplineCurve[]): any[];
    /** Applies the given data to the spline. */
    extend(data: SplineMeshOptions): this;
    /** Replaces the contents of the spline while preserving the order of handles and curves. */
    overwrite(data: SplineMeshOptions): this;
    /** Returns the copy of the spline that is used by the undo system. */
    getUndoCopy(aspects?: {}): {};
    /** Returns the data that is saved to the project file. */
    getSaveCopy(): {};
    /** Sets the marker color index of the spline. */
    setColor(index: number): void;
    /** Rotates the spline around the given axis by the given number of quarter turns. */
    roll(axis: axisNumber, steps: number, origin_arg?: ArrayVector3): this;
    /** Mirrors the spline on the given axis. */
    flip(axis: axisNumber, center?: number): this;
    /**
     * Refresh the dummy face object of this spline, allowing us to paint on it, or to convert it to a Mesh.
     */
    refreshTubeFaces(): void;
    /**
     * Returns the keys of the selected vertices.
     * @param make If true, the selection entry of the spline is created when it does not exist yet.
     */
    getSelectedVertices(make: boolean = false): any;
    /**
     * Readonly list of selected handles, based on selected vertices.
     * @param {*} loose Tells the handle selection if it should count controls being selected without their joint.
    **/
    getSelectedHandles(loose?: boolean): string[];
    /**
     * Readonly list of selected curves, based on selected handles. See {@link getSelectedHandles()} for handle selection.
     * @param {*} loose Tells the handle selection if it should count controls being selected without their joint.
    **/
    getSelectedCurves(loose?: boolean): string[];
    /** Returns the keys of the curves that use the given handle. */
    getCurvesOfHandle(hKey: string): string[];
    /** Returns the keys of the curves that use the given vertex. */
    getCurvesOfPoint(vKey: string): string[];
    /** Returns the key of the handle that uses the given vertex. */
    getHandleOfPoint(vKey: string): string | undefined;
    /** Returns the last selected spline. */
    getLastSelected(): SplineMesh | undefined;
    /** Returns the last handle of the spline and its key. */
    getLastHandle(): {
        /** The handle. */
        data: SplineHandle;
        /** The key of the handle. */
        key: string;
    };
    /** Returns the first handle of the spline and its key. */
    getFirstHandle(): {
        /** The handle. */
        data: SplineHandle;
        /** The key of the handle. */
        key: string;
    };
    /**
     * Returns the size of the spline on the given axis.
     * @param selection_only If true, only the selected vertices are measured.
     */
    getSize(axis?: axisNumber, selection_only?: any): number;
    /**
     * Gather control point transform data, primarily to orient the handleGizmos correctly, but also for normal transform space.
     * @param {*} hKey Key of the handle we want the transform of.
     * @param {*} euler re-orientation Euler in case we need to re-orient the result of this to match another direction.
    */
    getHandleEuler(hKey: string, euler?: THREE.Euler): {
        /** The orientation of the first control point, as Euler angles. */
        c1: any;
        /** The orientation of the second control point, as Euler angles. */
        c2: any;
        /** The orientation of the handle, as Euler angles. */
        combined: any;
    };
    /** Returns the gizmo position in world space, based on the current selection. */
    getWorldCenter(ignore_mesh_selection: any): THREE.Vector3;
    /** Moves the origin of the spline by the given offset. */
    moveVector(arr: ArrayVector3, axis: axisNumber, update?: boolean): void;
    /** Returns the center of all vertices, in local or world space. */
    getCenter(global?: boolean): ArrayVector3;
    /** Moves the origin of the spline without moving its geometry. */
    transferOrigin(origin: any, update?: boolean): this | undefined;
    /**
     * Applies the effects of Handle selection mode to the sibling vertex of this vKey. (Mirrored or Aligned)
     * @param {*} vkey The Key of the reference vertex, from which the result will be copied over to its sibling (if applicable).
     */
    applyHandleModeOnVertex(vkey: string): void;
    /**
     * Resizes the spline along the given axis.
     * @param bidirectional If true, the size change is applied on both sides of the selection center.
     */
    resize(val: any, axis: any, negative: any, allow_negative: any, bidirectional: any): void;
    /**
     * Builds a mesh representation of the spline tube.
     * @param removeDoubles If true, coincident vertices of the tube are merged.
     * @param mesh The mesh to add the tube geometry to.
     */
    getTubeMesh(removeDoubles?: boolean, mesh?: {
        /** The faces of the mesh, mapped by face key. */
        faces: {};
        /** The vertices of the mesh, mapped by vertex key. */
        vertices: {};
    }): {
        /** The faces of the generated tube, mapped by face key. */
        faces: {};
        /** The vertices of the generated tube, mapped by vertex key. */
        vertices: {};
    };
    /** Returns the buffer data of the spline tube geometry. */
    getTubeGeo(shadeSmooth: any): {
        /** The vertex positions. */
        vertices: any[];
        /** The vertex normals. */
        normals: any[];
        /** The triangle indices. */
        indices: number[];
        /** The UV coordinates of the vertices. */
        uvs: number[];
    };
    /**
     * Returns the data sampled along the spline path.
     * @param keepDoubles If true, points where separate curves meet are kept twice.
     */
    getBézierPath(keepDoubles?: boolean): {
        /** The normalized tangent at each point. */
        tangents: any[];
        /** The normal at each point. */
        normals: any[];
        /** The position of each point. */
        points: any[];
        /** The handle size at each point. */
        sizes: any[];
        /** Whether each point continues the previous segment of the path. */
        connections: boolean[];
        /** The length of the segment that ends at each point. */
        lengths: any[];
        /** The length of the path before each point. */
        accumulatedLengths: number[];
        /** The total length of the path. */
        pathLength: number;
    };
    /** Returns a normal vector for the given tangent. */
    getBézierNormal(tangent: any, up?: null): any;
    /** Returns the point and tangent at the given time on a curve of the spline. */
    getBézierForCurve(time: any, key: string): {
        /** The position on the curve. */
        point: any;
        /** The normalized tangent at that position. */
        tangent: any;
    };
    /** Returns the point and tangent at the given time on the curve defined by four vertices. */
    getBézierForPoints(time: any, p1k: any, p2k: any, p3k: any, p4k: any): {
        /** The position on the curve. */
        point: any;
        /** The normalized tangent at that position. */
        tangent: any;
    };
    /** Evaluates a cubic Bézier curve at the given time. */
    cubicBézier(time: any, point1: any, point2: any, point3: any, point4: any): {
        /** The position on the curve. */
        point: any;
        /** The normalized tangent at that position. */
        tangent: any;
    };
    /** Returns the texture of the spline. */
    getTexture(): Texture | undefined;
    /** Assigns a texture to the spline. */
    applyTexture(texture: Texture): void;
    /** Sets the shading mode of the spline and refreshes its geometry. */
    updateShading(shade_smooth: boolean): void;
}


