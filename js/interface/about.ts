import VersionUtil from '../util/version_util'

BARS.defineActions(() => {
	new Action('about_window', {
		name: tl('dialog.settings.about') + '...',
		description: `Blockbench ${Blockbench.version}`,
		icon: 'info',
		category: 'blockbench',
		click: function () {
			const data = {
				isApp,
				version_label: Blockbench.version
			};
			jQuery.ajax({
				url: 'https://api.github.com/repos/JannisX11/blockbench/releases/latest',
				cache: false,
				type: 'GET',
				success(release) {
					let releaseVersion = release.tag_name.replace(/^v/, '');
					let display_version = VersionUtil.format(Blockbench.version);
					switch (VersionUtil.compare(Blockbench.version, releaseVersion)) {
						case 1:
							data.version_label = `${display_version} (Pre-release)`;
							break;
						case 0:
							data.version_label = `${display_version} (${tl('about.version.up_to_date')}😄)`;
							break;
						case -1:
							data.version_label = `${display_version} (${tl('about.version.update_available', [releaseVersion])})`;
							break;
					}
				},
				error(err) {}
			})

			new Dialog({
				id: 'about',
				title: 'dialog.settings.about',
				width: 640,
				title_menu: new Menu([
					'settings_window',
					'keybindings_window',
					'theme_window',
					'about_window',
				]),
				buttons: [],
				component: {
					data() {return data},
					template: `
						<div>
							<div class="blockbench_logo" id="about_page_title">
								<img src="assets/logo_text_white.svg" alt="Blockbench" width="340px">
							</div>
							<p>Version <span>{{ version_label }}</span></p>

							<div class="socials">
								<a class="open-in-browser" href="https://blockbench.net">
									<i class="icon icon-blockbench_inverted" style="transform: scale(1.3);"></i>
									<label>Website</label>
								</a>
								<a class="open-in-browser" href="https://bsky.app/profile/blockbench.net">
									<i class="icon fab fa-bluesky"></i>
									<label>Bluesky</label>
								</a>
								<a class="open-in-browser" href="https://twitter.com/blockbench">
									<i class="icon fab fa-twitter"></i>
									<label>Twitter</label>
								</a>
								<a class="open-in-browser" href="http://discord.blockbench.net">
									<i class="icon fab fa-discord"></i>
									<label>Discord</label>
								</a>
								<a class="open-in-browser" href="https://youtube.com/Blockbench3D">
									<i class="icon fab fa-youtube"></i>
									<label>YouTube</label>
								</a>
								<a class="open-in-browser" href="https://github.com/JannisX11/blockbench">
									<i class="icon fab fa-github"></i>
									<label>GitHub</label>
								</a>
								<a class="open-in-browser" href="https://blockbench.net/wiki">
								<i class="icon material-icons">menu_book</i>
									<label>Wiki</label>
								</a>
							</div>

							<p>Created by Jannis Petersen</p>
							<p style="color: var(--color-subtle_text);">A free and open-source low-poly model editor. To make 3D art easy and accessible for everyone.
								For all who enjoy stylized 3D art. For game developers, students, content creators, and for the Minecraft community.</p>

							<h4>COMMUNITY EDITION</h4>
							<p>社区版由 TT432 制作并维护</p>
							<p class="community_description" style="color: var(--color-subtle_text);">此版本基于官方开源的 Blockbench 制作，在官方版本之上追加社区功能、问题修复与中文文案，
								并维护社区插件源与反馈渠道。上游作者与贡献者的署名见下方致谢。</p>
							<div class="community_links">
								<a class="open-in-browser" href="https://github.com/TT432/blockbench">
									<i class="icon fab fa-github"></i>
									<label>GitHub</label>
								</a>
								<a class="open-in-browser" href="https://afdian.com/a/NmmOC7">
									<svg class="afdian_icon" viewBox="0 0 24 24" role="img" aria-label="爱发电"><path d="M9 14.234a.567.567 0 1 0 0 1.134.567.567 0 0 0 0-1.134m5.351 1.705a.567.567 0 1 0 0 1.135.567.567 0 0 0 0-1.135m8.401 1.436c-.189.095-.461.1-.713.013-.169-.06-.352-.116-.534-.172-.339-.104-.904-.276-1.011-.407a.533.533 0 1 0-.853.643c.059.08.139.146.22.209-.816 1.131-4.398 3.382-9.464 2.273-2.283-.5-3.819-1.413-4.444-2.639-.451-.885-.348-1.797-.133-2.293.62-1.29 5.097-4.261 7.955-5.943a.537.537 0 0 0 .188-.733c-.149-.254-.49-.356-.73-.189-.231.135-1.015.601-2.015 1.236-.338-.227-.923-.508-1.86-.6-1.486-.148-4.92-.805-6.029-1.275C2.535 7.162.731 6.27 1.131 5.267c.092-.234.527-.613 1.47-.974a8.5 8.5 0 0 1 1.995-.492l-.212.103c-.642.312-1.343.662-1.813 1.075-.034-.022-.07-.044-.094-.069a.527.527 0 0 0-.754-.017.533.533 0 0 0-.017.756c.19.2.471.35.829.465l.039.014c1.245.383 3.458.336 6.578.211 1.345-.052 2.615-.102 3.674-.082 3.512.07 6.152 1.469 8.07 4.279 1.178 1.725.753 3.426.079 4.903a1.4 1.4 0 0 1-.231-.222.54.54 0 0 0-.75-.085.535.535 0 0 0-.086.751c.109.137.665.778 1.355.724l.037-.002c.021-.003.042.001.064-.003.472-.086.768-.063 1.045.111.367.232.547.37.511.485-.021.073-.076.125-.168.177M8.19 11.418l-.315.231a1.6 1.6 0 0 1-.243-.32c.123-.038.33.007.558.089m14.733 4.356a1.9 1.9 0 0 0-.81-.27c.632-1.544 1.034-3.565-.336-5.572-2.096-3.072-5.101-4.668-8.93-4.744-1.091-.022-2.377.029-3.737.083-1.58.063-3.683.145-5.112.027.285-.155.588-.304.851-.431 1.006-.49 1.797-.872 1.535-1.548-.137-.396-.547-.603-1.219-.618C3.748 2.669.688 3.489.138 4.872c-.31.779-.361 2.282 2.775 3.61 1.29.548 4.934 1.216 6.341 1.355.397.039.701.119.931.205a75 75 0 0 0-.986.664c-.577-.329-1.521-.718-2.226-.237a.94.94 0 0 0-.435.768c-.01.385.224.763.486 1.066-1.038.83-1.877 1.634-2.175 2.253-.332.762-.467 2.008.153 3.224.786 1.544 2.524 2.62 5.166 3.199 3.454.755 6.437.075 8.411-.966 1.099-.579 1.878-1.27 2.257-1.887l.356.113c.169.051.338.103.496.159.522.181 1.1.157 1.545-.068l.025-.013c.336-.177.577-.46.683-.803.285-.922-.528-1.432-1.018-1.74"/></svg>
									<label>爱发电</label>
								</a>
							</div>

							<h4>SPECIAL THANKS TO</h4>
							<ul class="multi_column_list special_thanks_mentions">
								<li>Mojang Studios</li>
								<li>All contributors</li>
								<li>The community moderators</li>
								<li>All donators</li>
								<li>All translators</li>
								<li>Wacky</li>
								<li>Ewan Howell and Lukas</li>
								<li>SirBenet</li>
								<li>Sultan Taha and Kanno</li>
								<li>The Blockbench Community</li>
							</ul>

							<h4>FRAMEWORKS, LIBRARIES, AND ICONS</h4>

							<p style="margin-bottom: 16px" v-if="isApp">This program is powered by <a class="open-in-browser" href="https://electronjs.org">Electron</a></p>

							<ul class="multi_column_list">
								<li><a class="open-in-browser" href="https://material.io/icons/">Material Icons</a></li>
								<li><a class="open-in-browser" href="https://fontawesome.com/icons/">Font Awesome</a></li>
								<li><a class="open-in-browser" href="https://github.com/microsoft/vscode-codicons">VSCode Codicons</a></li>
								<li><a class="open-in-browser" href="https://electronjs.org">Electron</a></li>
								<li><a class="open-in-browser" href="https://vuejs.org">Vue</a></li>
								<li><a class="open-in-browser" href="https://github.com/weibangtuo/vue-tree">Vue Tree</a></li>
								<li><a class="open-in-browser" href="https://github.com/sagalbot/vue-sortable">Vue Sortable</a></li>
								<li><a class="open-in-browser" href="https://threejs.org">ThreeJS</a></li>
								<li><a class="open-in-browser" href="https://bgrins.github.io/spectrum">Spectrum</a></li>
								<li><a class="open-in-browser" href="https://github.com/mattdesl/gifenc">gifenc</a></li>
								<li><a class="open-in-browser" href="https://stuk.github.io/jszip/">JSZip</a></li>
								<li><a class="open-in-browser" href="https://github.com/rotemdan/lzutf8.js">LZ-UTF8</a></li>
								<li><a class="open-in-browser" href="https://jquery.com">jQuery</a></li>
								<li><a class="open-in-browser" href="https://jqueryui.com">jQuery UI</a></li>
								<li><a class="open-in-browser" href="https://github.com/furf/jquery-ui-touch-punch">jQuery UI Touch Punch</a></li>
								<li><a class="open-in-browser" href="https://github.com/eligrey/FileSaver.js">FileSaver.js</a></li>
								<li><a class="open-in-browser" href="https://github.com/AndrewRayCode/easing-utils">easing-utils</a></li>
								<li><a class="open-in-browser" href="https://peerjs.com">PeerJS</a></li>
								<li><a class="open-in-browser" href="https://github.com/markedjs/marked">Marked</a></li>
								<li><a class="open-in-browser" href="https://github.com/cure53/DOMPurify">DOMPurify</a></li>
								<li><a class="open-in-browser" href="https://prismjs.com">Prism</a></li>
								<li><a class="open-in-browser" href="https://github.com/akalverboer/canvas2apng">Canvas2APNG</a></li>
								<li><a class="open-in-browser" href="https://github.com/lunapaint/tga-codec">lunapaint/tga-codec</a></li>
								<li><a class="open-in-browser" href="https://github.com/koca/vue-prism-editor">Vue Prism Editor</a></li>
								<li><a class="open-in-browser" href="https://github.com/JannisX11/molangjs">MolangJS</a></li>
								<li><a class="open-in-browser" href="https://github.com/JannisX11/wintersky">Wintersky</a></li>
							</ul>

							<p style="margin-top: 20px">Released under the <a class="open-in-browser" href="https://github.com/JannisX11/blockbench/blob/master/LICENSE.MD">GPL 3.0 license</a></p>
							<p><a class="open-in-browser" href="https://www.blockbench.net/privacy-policy">Privacy Policy</a></p>

						</div>`
				}
			}).show()
		}
	})
})
