/**
 * 跟随空间（反馈 #275）
 *
 * 移动/旋转工具栏的「跟随」空间：先按住 Ctrl 在视口里点选一个块或组作为「跟随源」，
 * 之后其他选中元素的位移/旋转轴向都按源的自身轴向进行（类似复制画笔的取源手感）。
 *
 * - 源本身不可移动/旋转：跟随空间生效且选择里含源时，gizmo 拖拽被拒绝并提示。
 * - 源用红色线框高亮，其余选中元素仍是常规的蓝色高亮。
 * - 进入「跟随」空间时底部状态栏给出 Ctrl「设置跟随源」提示；源除非重新设置，否则
 *   在整个工程期间一直有效。
 * - 尚未设置源时「跟随」退回全局空间，避免把用户锁死在无法操作的状态。
 */
import { THREE } from "../lib/libs";

/** 跟随空间在 getEditTransformSpace() 里的返回值（与 0/2/3 一样是空间编号） */
export const FOLLOW_SPACE = 4;

export const FollowSpace = {
	source: null as OutlinerNode | null,
	highlight: null as THREE.BoxHelper | null,

	/** 当前工具的空间选择是否处于「跟随」 */
	isFollowSelected(): boolean {
		if (typeof BarItems == 'undefined') return false;
		if (Toolbox.selected?.id === 'rotate_tool') return BarItems.rotation_space?.value === 'follow';
		return BarItems.transform_space?.value === 'follow';
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

	getOrphanedSource(): boolean {
		return this.isFollowSelected() && !this.getReference();
	},

	setSource(node: OutlinerNode) {
		if (!node || !node.mesh) return;
		this.source = node;
		this.updateHighlight();
		Blockbench.showQuickMessage(tl('message.follow.source_set', [node.name]), 2000);
	},

	clearSource() {
		this.source = null;
		this.updateHighlight();
	},

	selectionIncludesSource(): boolean {
		let source = this.getReference();
		if (!source) return false;
		if (Outliner.selected.includes(source as OutlinerElement)) return true;
		return Group.multi_selected.includes(source as Group) || Group.multi_selected.some(group => source?.isChildOf?.(group, 128));
	},

	/** 底部状态栏的 Ctrl「设置跟随源」提示只在跟随空间下出现 */
	syncHint() {
		// 状态栏 Vue 在进入工程后才挂载（onVueSetup），启动期调用会取不到 $data
		if (!Interface?.status_bar?.vue) return;
		let text = 'modifier_actions.set_follow_source';
		if (this.isFollowSelected()) {
			Interface.addSuggestedModifierKey('ctrl', text);
		} else {
			Interface.removeSuggestedModifierKey('ctrl', text);
		}
	},

	updateHighlight() {
		let source = this.isFollowSelected() ? this.getReference() : undefined;
		if (!source?.mesh) {
			if (this.highlight) {
				this.highlight.removeFromParent();
				if (this.highlight.geometry) this.highlight.geometry.dispose();
				this.highlight.material.dispose();
				this.highlight = null;
			}
			return;
		}
		if (!this.highlight) {
			// 红色线框标出跟随源（其余选中元素仍是常规蓝色高亮）
			this.highlight = new THREE.BoxHelper(source.mesh, 0xff3c3c);
			this.highlight.material.depthTest = false;
			this.highlight.material.transparent = true;
			this.highlight.renderOrder = 998;
		}
		if (this.highlight.parent !== Canvas.scene) Canvas.scene.add(this.highlight);
		this.highlight.setFromObject(source.mesh);
	},

	/** 视口 Ctrl+点击：把点到（或它最近的在选组）设为跟随源 */
	pickSource(event: MouseEvent, data: RaycastResult): boolean {
		if (!this.isFollowSelected()) return false;
		if (!(event.ctrlKey || event.metaKey || Pressing.overrides.ctrl)) return false;
		let node: OutlinerNode | undefined = data?.element;
		if (!node) return false;
		// 点在选中的组内部时，跟随源取那个组（更符合「单独一个块或者组」的意图）
		let group = Group.multi_selected.find(candidate => candidate instanceof Group && node.isChildOf(candidate, 128));
		this.setSource(group ?? node);
		updateSelection();
		return true;
	},
};

Blockbench.on('update_view', () => {
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
