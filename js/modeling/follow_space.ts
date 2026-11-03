/**
 * 跟随空间（反馈 #275）
 *
 * 移动/旋转工具栏的「跟随」空间：先按住 Ctrl 在视口里点选一个块或组作为「跟随源」，
 * 之后其他选中元素的位移/旋转轴向都按源的自身轴向进行（类似复制画笔的取源手感）。
 *
 * - 源本身不可移动/旋转：跟随空间生效且选择里含源时，gizmo 拖拽被拒绝并提示。
 * - 源用红色描边高亮（反馈#281：复用元素自身的局部空间描边几何，不再是世界 AABB 线框；
 *   组等没有逐元素描边的节点回退到与节点自身轴向一致的包围盒），其余选中元素仍是常规蓝色高亮。
 * - 进入「跟随」空间时底部状态栏给出 Ctrl「设置跟随源」提示；源除非重新设置或右键取消，
 *   否则在整个工程期间一直有效（反馈#290：已有源时 Ctrl 交还给普通多选）。
 * - 尚未设置源时「跟随」退回全局空间，避免把用户锁死在无法操作的状态。
 */
import { THREE } from "../lib/libs";

/** 跟随空间在 getEditTransformSpace() 里的返回值（与 0/2/3 一样是空间编号） */
export const FOLLOW_SPACE = 4;

let source_outline_material: THREE.LineBasicMaterial | null = null;
function getSourceOutlineMaterial(): THREE.LineBasicMaterial {
	if (!source_outline_material) {
		source_outline_material = new THREE.LineBasicMaterial({
			color: 0xff3c3c,
			linewidth: 2,
			transparent: true,
			depthTest: false,
		});
	}
	return source_outline_material;
}

/** 预览节点上的自定义字段（Blockbench 给 mesh 挂的描边/标记对象） */
interface PreviewNode extends THREE.Object3D {
	outline?: THREE.Line;
	geometry?: THREE.BufferGeometry;
	no_export?: boolean;
}

/**
 * 反馈#281：给没有逐元素描边的节点（组、定位器、骨骼）生成一个与节点自身轴向一致的
 * 包围盒线框——几何写在节点局部空间里，所以随节点旋转/缩放，不会像世界 AABB 那样错位放大。
 */
function buildLocalBoxOutline(root: THREE.Object3D): THREE.Object3D | null {
	if (!root.parent) return null;
	root.updateMatrixWorld(true);
	let inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
	let box = new THREE.Box3();
	let matrix = new THREE.Matrix4();
	root.traverse((node: THREE.Object3D) => {
		// Object3D 上声明了 geometry/no_export，是 Blockbench 预览层自己挂的字段
		let object = node as PreviewNode;
		if (!object.geometry?.attributes?.position) return;
		if (object.no_export) return;
		if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
		if (!object.geometry.boundingBox) return;
		matrix.multiplyMatrices(inverse, object.matrixWorld);
		box.union(new THREE.Box3().copy(object.geometry.boundingBox).applyMatrix4(matrix));
	});
	if (box.isEmpty()) return null;
	let helper = new THREE.Box3Helper(box, new THREE.Color(0xff3c3c));
	helper.material = getSourceOutlineMaterial();
	return helper;
}

export const FollowSpace = {
	source: null as OutlinerNode | null,
	/** 红色高亮用到的对象（克隆元素描边，或局部包围盒线框） */
	highlight: [] as THREE.Object3D[],
	highlight_source: null as OutlinerNode | null,

	/** 当前工具的空间选择是否处于「跟随」 */
	isFollowSelected(): boolean {
		if (typeof BarItems == 'undefined' || typeof Toolbox == 'undefined') return false;
		// 反馈#303：「跟随」空间由社区版设置开关控制，默认关闭——关闭时整条链路（源、红框、
		// 状态栏提示、轴向）都不生效
		if (typeof Settings == 'undefined' || !Settings.get('community_follow_space')) return false;
		let tool = Toolbox.selected?.id;
		// 反馈#298：跟随只属于「位移」和「旋转」两个工具。其它工具（缩放、顶点捕捉等）读的是
		// 同一个 transform_space，此前会被误判成跟随态，红框与源的轴向一直挂着。
		if (tool === 'rotate_tool') return BarItems.rotation_space?.value === 'follow';
		if (tool === 'move_tool') return BarItems.transform_space?.value === 'follow';
		return false;
	},

	/**
	 * 反馈#298：从位移/旋转切到别的工具时立刻取消跟随源（红框随之消失）。
	 * 切到缩放、顶点捕捉这些工具后「跟随」不再生效，源也就不该继续挂着——否则它们的轴向、
	 * 红框会一直被源的朝向牵着走。
	 */
	onToolSelect(current: Tool, previous?: Tool) {
		if (!previous) return;
		let was_transform_tool = previous.id === 'move_tool' || previous.id === 'rotate_tool';
		let is_transform_tool = current.id === 'move_tool' || current.id === 'rotate_tool';
		if (was_transform_tool && !is_transform_tool) {
			this.clearSource();
		}
		this.syncHint();
	},

	/** 跟随空间生效的参考节点；未设置源或不在跟随空间时返回 undefined */
	getReference(): OutlinerNode | undefined {
		if (!this.isFollowSelected()) return;
		let source = this.source;
		if (!source || !source.mesh || !OutlinerNode.uuids[source.uuid]) {
			return;
		}
		return source;
	},

	/**
	 * 反馈#303：开关关闭时收敛所有跟随态——跟随源/红框清空，两个空间下拉若是「跟随」则回落全局。
	 * 由 setup_settings.js 的 community_follow_space.onChange 与启动期各调用一次。
	 */
	applySetting() {
		if (typeof Settings == 'undefined' || Settings.get('community_follow_space')) return;
		this.clearSource();
		if (typeof BarItems !== 'undefined') {
			for (let bar of [BarItems.transform_space, BarItems.rotation_space]) {
				if (bar && bar.value === 'follow') bar.set('global');
			}
		}
		if (typeof BARS !== 'undefined') BARS.updateConditions();
	},

	getOrphanedSource(): boolean {
		return this.isFollowSelected() && !this.getReference();
	},

	setSource(node: OutlinerNode) {
		if (!node || !node.mesh) return;
		this.source = node;
		this.updateHighlight();
		this.syncHint();
		Blockbench.showQuickMessage(tl('message.follow.source_set', [node.name]), 2000);
	},

	clearSource() {
		this.source = null;
		this.updateHighlight();
		this.syncHint();
	},

	selectionIncludesSource(): boolean {
		let source = this.getReference();
		if (!source) return false;
		if (Outliner.selected.includes(source as OutlinerElement)) return true;
		return Group.multi_selected.includes(source as Group) || Group.multi_selected.some(group => source?.isChildOf?.(group, 128));
	},

	/**
	 * 底部状态栏提示：跟随空间下 Ctrl「设置跟随源」；已有源时再补一条右键「取消跟随源」
	 * （反馈#294，右键取消是 #290 引入的入口）。
	 */
	syncHint() {
		// 状态栏 Vue 在进入工程后才挂载（onVueSetup），启动期调用会取不到 $data
		if (!Interface?.status_bar?.vue) return;
		let set_text = 'modifier_actions.set_follow_source';
		let clear_text = 'modifier_actions.clear_follow_source';
		if (this.isFollowSelected()) {
			Interface.addSuggestedModifierKey('ctrl', set_text);
			if (this.getReference()) {
				Interface.addSuggestedModifierKey('mouse', clear_text);
			} else {
				Interface.removeSuggestedModifierKey('mouse', clear_text);
			}
		} else {
			Interface.removeSuggestedModifierKey('ctrl', set_text);
			Interface.removeSuggestedModifierKey('mouse', clear_text);
		}
	},

	/** 移除红色高亮对象（几何由元素描边共享，只移除克隆节点，不 dispose） */
	clearHighlight() {
		for (let object of this.highlight) {
			object.removeFromParent();
			if (object instanceof THREE.Box3Helper) object.geometry?.dispose();
		}
		this.highlight = [];
		this.highlight_source = null;
	},

	updateHighlight() {
		let source = this.isFollowSelected() ? this.getReference() : undefined;
		if (!source?.mesh) {
			this.clearHighlight();
			return;
		}
		// 源没变且高亮还在时不必重建（几何是共享的，元素几何变化会自动跟随）
		if (this.highlight_source === source && this.highlight.length) return;
		this.clearHighlight();
		this.highlight_source = source;

		let material = getSourceOutlineMaterial();
		source.mesh.traverse((node: THREE.Object3D) => {
			let outline = (node as PreviewNode).outline;
			if (!(outline instanceof THREE.Line) || !outline.geometry) return;
			// 与元素自己的描边共用几何：元素几何更新后红色高亮同步更新
			let clone = new (outline.constructor as new (geometry: THREE.BufferGeometry, material: THREE.Material) => THREE.Line)(
				outline.geometry,
				material
			);
			clone.position.copy(outline.position);
			clone.quaternion.copy(outline.quaternion);
			clone.scale.copy(outline.scale);
			clone.matrixAutoUpdate = outline.matrixAutoUpdate;
			clone.updateMatrix();
			clone.renderOrder = 999;
			clone.frustumCulled = false;
			clone.visible = true;
			// THREE.Line 类型声明没有 Blockbench 预览层的自定义标记字段，只能跨类型断言
			(clone as unknown as PreviewNode).no_export = true;
			node.add(clone);
			this.highlight.push(clone);
		});

		if (!this.highlight.length) {
			let box_outline = buildLocalBoxOutline(source.mesh);
			if (box_outline) {
				box_outline.renderOrder = 999;
				box_outline.frustumCulled = false;
				source.mesh.add(box_outline);
				this.highlight.push(box_outline);
			}
		}
	},

	/** 反馈#290：跟随空间下右键只取消跟随源，不弹上下文菜单 */
	clearSourceOnRightClick(): boolean {
		if (!this.getReference()) return false;
		this.clearSource();
		updateSelection();
		Blockbench.showQuickMessage(tl('message.follow.source_cleared'), 2000);
		return true;
	},

	/** 视口 Ctrl+点击：把点到（或它最近的在选组）设为跟随源 */
	pickSource(event: MouseEvent, data: RaycastResult): boolean {
		if (!this.isFollowSelected()) return false;
		if (!(event.ctrlKey || event.metaKey || Pressing.overrides.ctrl)) return false;
		// 反馈#290：已有跟随源时 Ctrl 交还给普通多选，换源要先右键取消当前源
		if (this.getReference()) return false;
		let node: OutlinerNode | undefined = data?.element;
		if (!node) return false;
		// 点在选中的组内部时，跟随源取那个组（更符合「单独一个块或者组」的意图）
		let group = Group.multi_selected.find(candidate => candidate instanceof Group && node.isChildOf(candidate, 128));
		this.setSource(group ?? node);
		updateSelection();
		return true;
	},
};

/** 已挂过监听的工具 id（反馈#298：工具切换没有全局事件，只能逐个 Tool 订阅） */
const watched_tools = new Set<string>();
function watchTools() {
	if (typeof Tool == 'undefined') return;
	for (let tool of Tool.all) {
		if (watched_tools.has(tool.id)) continue;
		watched_tools.add(tool.id);
		tool.on('select', (event: {previous_tool?: Tool}) => {
			FollowSpace.onToolSelect(tool, event?.previous_tool);
		});
	}
}

Blockbench.on('update_view', () => {
	// update_view 是启动/加载后必到的点：在这里补挂新出现的工具监听
	watchTools();
	FollowSpace.updateHighlight();
});
Blockbench.on('finish_edit', () => {
	FollowSpace.updateHighlight();
});
Blockbench.on('load_project', () => {
	FollowSpace.clearSource();
	FollowSpace.syncHint();
});
Blockbench.on('new_project', () => {
	FollowSpace.clearSource();
	FollowSpace.syncHint();
});

const global = {
	FollowSpace,
	FOLLOW_SPACE,
};
declare global {
	interface Window {
		FollowSpace: typeof FollowSpace
		FOLLOW_SPACE: number
	}
}
Object.assign(window, global);
