// 社区版更新日志（反馈#147）：嵌入软件内的版本变更记录 + 帮助菜单入口。
// 数据维护方式：每次发版时在 COMMUNITY_CHANGELOG 数组头部追加一段。
import { Interface } from "./interface";

interface ChangelogEntry {
	version: string;
	date?: string;
	changes: string[];
}

const COMMUNITY_CHANGELOG: ChangelogEntry[] = [
	{
		version: '5.3.34（未发布）',
		changes: [
			'修复动画模式「自身」旋转在组有编辑模式旋转值时绕父级轴转的问题（#145）',
			'对称纹理支持全部三组对面：修复北↔南、顶↔底无反应（#127）',
			'负尺寸描边生成新增「读取删除面」选项，源块删除的面不再生成描边（#144）',
			'关键帧 Ctrl 点击切插值 / Shift 点击删除改为默认关闭，可在设置-社区版功能中开启（#146）',
			'标题栏 Logo 换为无边框纯白剪影 + βlockβench 文字（#148）',
		],
	},
	{
		version: '5.3.33',
		changes: [
			'设置页社区版功能按面板分组（时间轴/大纲/动画/绘画），每组带总开关',
			'大纲常驻显示父子结构树线（#130）',
			'关键帧 Ctrl 点击循环插值类型、Shift 点击删除（#16 交互，可开关）',
			'文件菜单新增分辨率转换（#137）',
			'负尺寸描边按钮：一键为选中的块/组生成描边壳块（#135）',
			'修复组隐藏无法隐藏子内容（#124/#133）、复制骨骼变量后缀同步（#136）',
			'修复序列帧模型帧模式语义（#123）、合批开启时笔刷光标消失（#138）、自身坐标系旋转偏斜（#132）',
		],
	},
	{
		version: '5.3.32',
		changes: [
			'Cube 静态合批渲染，大模型编辑/动画显著提速（#83，可开关）',
			'插件下载改走系统代理/PAC，修复开代理后安装失败（#128）',
			'绘画新增镜像事后补救：对称纹理复制（#127）、面内镜像复制（#131）',
			'设置页新增「社区版功能」分类，集中管理 fork 改动开关（#81）',
		],
	},
	{
		version: '5.3.31',
		changes: [
			'新增设置「负尺寸块按外面渲染」（#117），并加快捷键开关（#140）',
			'序列帧贴图导入改为平躺卡片、新增单面导入选项（#122）',
			'修复序列帧导入后动画模式组动块不随（#120）',
			'修复标签组颜色菜单着色（#78）、洋葱皮渲染（#126）',
		],
	},
	{
		version: '5.3.26 ~ 5.3.29',
		changes: [
			'动画控制器（AC）面板：键盘平移快捷键、视图操作自定义按键（#93/#108/#116）',
			'修复 AC 面板输入框失焦（#112）、粒子/音效无法删除（#96）、状态改名（#110）',
			'修复像素网格错位、大纲选中线、帧吸附等多项反馈',
		],
	},
	{
		version: '5.3.25',
		changes: [
			'社区插件源上线：插件商店合并官方源与社区源（TT432/blockbench-plugins）',
			'自动更新改为 GitHub Releases 载荷更新',
		],
	},
];

BARS.defineActions(() => {
	new Action('community_changelog', {
		icon: 'history_edu',
		category: 'blockbench',
		click() {
			let lines: HTMLElement[] = [];
			for (let entry of COMMUNITY_CHANGELOG) {
				let title = Interface.createElement('h3', {
					style: 'margin: 14px 0 4px; color: var(--color-accent);'
				}, entry.version + (entry.date ? `（${entry.date}）` : ''));
				lines.push(title);
				let ul = Interface.createElement('ul', {style: 'margin: 0 0 4px 18px; padding: 0;'});
				for (let change of entry.changes) {
					ul.append(Interface.createElement('li', {style: 'margin: 2px 0;'}, change));
				}
				lines.push(ul);
			}
			new Dialog({
				id: 'community_changelog',
				title: 'menu.help.community_changelog',
				width: 560,
				lines,
				buttons: ['dialog.close'],
			}).show();
		}
	});
});

// 帮助菜单社区版入口链接（菜单定义在 menu_bar.ts）
export const COMMUNITY_LINKS = {
	feedback_form: 'https://my.feishu.cn/share/base/form/shrcnfR7JgUKd19Hav282d7Y6ve',
	feedback_table: 'https://my.feishu.cn/base/DXG0bNakPaFqP0sTkSIcKygknZg',
};
