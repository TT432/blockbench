import { electron, app, fs, PathModule, currentwindow, shell, ipcRenderer, process, nativeImage, SystemInfo } from './native_apis';
import { separateThousands } from './util/math_util';
import { silentReject, wait } from './util/util';

export const recent_projects = (function() {
	let array: RecentProjectData[] = [];
	var raw = localStorage.getItem('recent_projects')
	if (raw) {
		try {
			array = JSON.parse(raw).slice().reverse()
		} catch (err) {}
		array = array.filter(project => {
			return fs.existsSync(project.path);
		})
	}
	return array
})() as RecentProjectData[];


app.setAppUserModelId('blockbench');


export function initializeDesktopApp() {

	//Setup
	$(document.body).on('click auxclick', 'a[href]', (event) => {
		event.preventDefault();
		shell.openExternal(event.currentTarget.href);
		return true;
	});

	if (Blockbench.startup_count <= 1 && electron.nativeTheme.inForcedColorsMode) {
		let theme = CustomTheme.themes.find(t => t.id == 'contrast');
		CustomTheme.loadTheme(theme);
	}

	function makeUtilFolder(name) {
		let path = PathModule.join(app.getPath('userData'), name)
		if (!fs.existsSync(path)) fs.mkdirSync(path)
	}
	['backups', 'thumbnails'].forEach(makeUtilFolder)

	createBackup(true)

	$('.web_only').remove()
	if (__dirname.includes('C:\\xampp\\htdocs\\blockbench')) {
		Blockbench.addFlag('dev')
	}

	settings.interface_scale.onChange(settings.interface_scale.value);

	if (settings.native_window_frame.value != true) {
		// Window controls
		if (Blockbench.platform == 'darwin') {
			//Placeholder
			$('#mac_window_menu').show()
			currentwindow.on('enter-full-screen', () => {
				$('#mac_window_menu').hide()
			})
			currentwindow.on('leave-full-screen', () => {
				$('#mac_window_menu').show()
			})
		} else {
			$('#windows_window_menu').show()
		}
	}
	if (Blockbench.platform == 'linux') {
		// Clear GPU cache: https://github.com/JannisX11/blockbench/issues/1964
		let gpu_cache_path = PathModule.join(app.getPath('userData'), 'GPUCache');
		try {
			let cache_files = fs.readdirSync(gpu_cache_path);
			for (let file_name of cache_files) {
				fs.unlinkSync(PathModule.join(gpu_cache_path, file_name));
			}
			console.log(`Cleared ${cache_files.length} GPU-cache files`);
		} catch (err) {
			console.error('Attempted and failed to clear GPU cache', err);
		}
	}

	if (location.href.endsWith('/blockbench/index.html')) {
		let action = new Action('dev_mode_reload', {
			name: 'Reload',
			icon: 'refresh',
			color: 'var(--color-update)',
			click() {
				Blockbench.reload();
			}
		})
		action.toElement('#update_menu');
	}

	UpdateManager.initialize();
}
//Load Model
export function loadOpenWithBlockbenchFile() {
	function load(path: string) {
		if (!path || path.length < 7 || path.startsWith('--') || !path.match(/.\.\w+$/)) return;
		var extension = pathToExtension(path);
		if (extension == 'png') {
			Blockbench.read([path], {readtype: 'image'}, (files) => {
				loadImages(files);
			})
		} else if (Codec.getAllExtensions().includes(extension)) {
			Blockbench.read([path], {}, (files) => {
				loadModelFile(files[0]);
			})
		} else {
			unsupportedFileFormatMessage(path);
		}
	}
	ipcRenderer.on('open-model', (event, path) => {
		load(path);
	})
	ipcRenderer.on('load-tab', (event, model) => {
		let fake_file = {
			name: model.name || '',
			path: model.editor_state?.save_path || ''
		};
		Codecs.project.load(model, fake_file);
		if (model.detached_uuid) {
			ipcRenderer.send('close-detached-project', model.detached_window_id, model.detached_uuid);
		}
	})
	ipcRenderer.on('accept-detached-tab', (event, value) => {
		Interface.page_wrapper.classList.toggle('accept_detached_tab', value);
	})
	ipcRenderer.on('close-detached-project', (event, uuid) => {
		let tab = ModelProject.all.find(project => project.uuid == uuid && project.detached);
		if (tab) tab.close(true);
	})
	if (electron.process.argv.length >= 2) {
		let path = electron.process.argv.last();
		load(path);
	}
}
console.log('Electron '+process.versions.electron+', Node '+process.versions.node)

window.confirm = function(message: string, title?: string) {
	let index = electron.dialog.showMessageBoxSync(currentwindow, {
		title: title || electron.app.name,
		detail: message,
		message: '',
		type: 'none',
		noLink: true,
		buttons: [tl('dialog.ok'), tl('dialog.cancel')]
	});
	return index == 0;
}
window.alert = function(message: string, title?: string) {
	electron.dialog.showMessageBoxSync(electron.getCurrentWindow(), {
		title: title || electron.app.name,
		message: '',
		detail: message
	});
}

//Recent Projects
export type RecentProjectData = {
	name: string
	path: string
	icon: string
	day: number
	favorite: boolean
	textures?: string[]
	texture_sets?: string[]
	animation_files?: string[]
}
export function updateRecentProjects() {
	recent_projects.splice(Math.clamp(settings.recent_projects.value as number, 0, 512));
	let fav_count = 0;
	recent_projects.forEach((project, i) => {
		if (project.favorite) {
			recent_projects.splice(i, 1);
			recent_projects.splice(fav_count, 0, project);
			fav_count++;
		}
	})
	//Set Local Storage
	localStorage.setItem('recent_projects', JSON.stringify(recent_projects.slice().reverse()));
}
export function addRecentProject(data: Partial<RecentProjectData>) {
	var i = recent_projects.length-1;
	let former_entry: RecentProjectData;
	while (i >= 0) {
		var p = recent_projects[i]
		if (p.path === data.path) {
			recent_projects.splice(i, 1);
			former_entry = p;
		}
		i--;
	}
	if (data.name.length > 48) data.name = data.name.substr(0, 20) + '...' + data.name.substr(-20);
	let project: RecentProjectData = {
		name: data.name,
		path: data.path,
		icon: data.icon,
		favorite: former_entry ? former_entry.favorite : false,
		day: new Date().dayOfYear(),
	}
	recent_projects.splice(0, 0, project)
	ipcRenderer.send('add-recent-project', data.path);
	StartScreen.updateThumbnails([data.path]);
	Settings.updateSettingsInProfiles();
	updateRecentProjects()
}
export function updateRecentProjectData() {
	let project = Project.getProjectMemory();
	if (!project) return;
	
	if (project.name.length > 48) project.name = project.name.substr(0, 20) + '...' + project.name.substr(-20);

	project.textures = Texture.all.filter(t => t.path).map(t => t.path);
	project.texture_sets = TextureGroup.all.filter(t => t.is_material && t.material_config).map(t => t.material_config.getFilePath());

	if (Format.animation_files) {
		project.animation_files = [];
		// @ts-expect-error
		Animation.all.forEach(anim => {
			if (anim.path) project.animation_files.safePush(anim.path);
		})
	}

	Blockbench.dispatchEvent('update_recent_project_data', {data: project});
	updateRecentProjects()
}
export async function updateRecentProjectThumbnail() {
	let project = Project && Project.getProjectMemory();
	if (!project) return;

	let thumbnail;
	const resolution = [270, 150];

	if (Format.image_editor && Texture.all.length) {		
		await new Promise((resolve, reject) => {
			let tex = Texture.getDefault();
			let frame = new CanvasFrame(resolution[0], resolution[1]);
			frame.ctx.imageSmoothingEnabled = false;

			let {width, height} = tex;
			if (width > resolution[0])   {height /= width / resolution[0];  width = resolution[0];}
			if (height > resolution[1]) {width /= height / resolution[1]; height = resolution[1];}
			if (width < resolution[0] && height < resolution[1]) {
				let factor = Math.min(resolution[0] / width, resolution[1] / height);
				factor *= 0.92;
				height *= factor; width *= factor;
			}
			frame.ctx.drawImage(tex.img, (resolution[0] - width)/2, (resolution[1] - height)/2, width, height)

			let url = frame.canvas.toDataURL();

			let hash = project.path.hashCode().toString().replace(/^-/, '0');
			let path = PathModule.join(app.getPath('userData'), 'thumbnails', `${hash}.png`)
			thumbnail = url;
			Blockbench.writeFile(path, {
				savetype: 'image',
				content: url
			}, resolve)
		})
	} else {
		if (Outliner.elements.length == 0) return;

		MediaPreview.resize(resolution[0], resolution[1])
		MediaPreview.loadAnglePreset(DefaultCameraPresets[0])
		MediaPreview.setFOV(30);
		let bounding_box = Canvas.getModelBoundingBox();
		if (bounding_box.isEmpty()) {
			MediaPreview.controls.target.set(0, 0, 0);
		} else {
			bounding_box.getCenter(MediaPreview.controls.target);
		}

		let box = Canvas.getModelSize();
		let size = Math.max(box[0], box[1]*2)
		let camera_dist = MediaPreview.camera.position.length();
		MediaPreview.camera.position.multiplyScalar(size / camera_dist * 1.2);
		
		await new Promise((resolve, reject) => {
			MediaPreview.screenshot({crop: false}, url => {
				let hash = project.path.hashCode().toString().replace(/^-/, '0');
				let path = PathModule.join(app.getPath('userData'), 'thumbnails', `${hash}.png`)
				thumbnail = url;
				Blockbench.writeFile(path, {
					savetype: 'image',
					content: url
				}, resolve)
				let store_path = project.path;
				project.path = '';
				project.path = store_path;
			})
		})
	}
	Blockbench.dispatchEvent('update_recent_project_thumbnail', {data: project, thumbnail});
	StartScreen.updateThumbnails([project.path]);

	// Clean old files
	if (Math.random() < 0.2) {
		let folder_path = PathModule.join(app.getPath('userData'), 'thumbnails')
		let existing_names = [];
		recent_projects.forEach(project => {
			let hash = project.path.hashCode().toString().replace(/^-/, '0');
			existing_names.safePush(hash)
		})
		fs.readdir(folder_path, (err, files) => {
			if (!err) {
				files.forEach((name, i) => {
					if (existing_names.includes(name.replace(/\..+$/, '')) == false) {
						try {
							fs.unlinkSync(folder_path +osfs+ name)
						} catch (err) {}
					}
				})
			}
		})
	}
}
export function loadDataFromModelMemory() {
	let project = Project && Project.getProjectMemory();
	if (!project) return;

	let remember = Format.remember_files ?? [];
	if (project.textures && remember.includes('textures')) {
		Blockbench.read(project.textures, {}, files => {
			files.forEach(f => {
				if (!Texture.all.find(t => t.path == f.path)) {
					new Texture({name: f.name}).fromFile(f).add(false);
				}
			})
		})
	}
	if (project.texture_sets && remember.includes('texture_sets')) {
		Blockbench.read(project.texture_sets, {}, files => {
			files.forEach(f => {
				if (!TextureGroup.all.find(tg => tg.material_config.getFilePath() == f.path)) {
					importTextureSet(f, false);
				}
			})
		})
	}
	if (project.animation_files && remember.includes('animation_files')) {
		Project.memory_animation_files_to_load = project.animation_files;
	}
	Blockbench.dispatchEvent('load_from_recent_project_data', {data: project});
}

//Window Controls
function updateWindowState(type: string) {
	let maximized = currentwindow.isMaximized();
	$('#header_free_bar').toggleClass('resize_space', !maximized);
	document.body.classList.toggle('maximized', maximized);
}
currentwindow.on('maximize', () => updateWindowState('maximize'));
currentwindow.on('unmaximize', () => updateWindowState('unmaximize'));
currentwindow.on('enter-full-screen', () => updateWindowState('screen'));
currentwindow.on('leave-full-screen', () => updateWindowState('screen'));
currentwindow.on('ready-to-show', () => updateWindowState('load'));

const ImageEditorPresets = {
	aseprite: {
		name: 'Aseprite',
		paths: {
			win32: 'C:\\Program Files\\Aseprite\\Aseprite.exe',
			darwin: '/Applications/Aseprite.app',
			linux: '/usr/share/applications/aseprite.desktop',
		}
	},
	pixieditor: {
		name: 'PixiEditor',
		paths: {
			win32: 'C:\\Program Files\\PixiEditor\\PixiEditor.exe',
			darwin: '/Applications/PixiEditor.app',
			linux: '/usr/share/applications/pixieditor.desktop',
		}
	},
	ps: {
		name: 'Photoshop',
		paths: {
			win32: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe',
			darwin: '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app',
			linux: '/usr/share/applications/photoshop.desktop'
		}
	},
	gimp: {
		name: 'GIMP',
		paths: {
			win32: 'C:\\Program Files\\GIMP 3\\bin\\gimp-3.exe',
			darwin: '/Applications/Gimp-3.app',
			linux: '/usr/share/applications/gimp.desktop',
		}
	},
	pdn: {
		name: 'Paint.NET',
		paths: {
			win32: 'C:\\Program Files\\paint.net\\PaintDotNet.exe'
		}
	},
	affinity: {
		name: 'Affinity',
		paths: {
			win32: () => PathModule.join(SystemInfo.appdata_directory, '..\\Local\\Microsoft\\WindowsApps\\Affinity.exe'),
			darwin: '/Applications/Affinity.app'
		}
	}
};

//Image Editor
export function isImageEditorValid(path: string) {
	if (!path) return false;
	try {
		fs.accessSync(path);
		return true;
	} catch (err) {
		return false;
	}
}
export function changeImageEditor(texture?: Texture, not_found?: boolean) {
	let app_file_extension = {
		'win32': ['exe'],
		'linux': [],
		'darwin': ['app'],
	};
	let options: Record<string, string> = {};
	for (let key in ImageEditorPresets) {
		let entry = ImageEditorPresets[key];
		if (!entry.paths[SystemInfo.platform]) continue;
		options[key] = entry.name;
	}
	options.other = 'message.image_editor.file';

	new Dialog({
		title: tl('message.image_editor.title'),
		id: 'image_editor',
		form: {
			not_found_text: {type: 'info', text: 'message.image_editor.not_found', condition: not_found == true},
			editor: {type: 'select', full_width: true, options},
			file: {
				label: 'message.image_editor.file',
				type: 'file',
				filetype: 'Program',
				extensions: app_file_extension[Blockbench.platform],
				readtype: 'none',
				description: 'message.image_editor.exe',
				condition: result => result.editor == 'other'
			}
		},
		onConfirm(result) {
			let id = result.editor;
			let path;
			if (id == 'other') {
				path = result.file;
			} else {
				path = ImageEditorPresets[result.editor].paths[SystemInfo.platform];
				if (typeof path == 'function') path = path();
			}
			if (isImageEditorValid(path)) {
				settings.image_editor.value = path
				ipcRenderer.send('edit-launch-setting', {key: 'image_editor', value: path});
				Settings.save();
				if (texture) {
					texture.openEditor()
				}
			} else {
				changeImageEditor(texture, true);
			}
		},
	}).show()
}
//Default Pack
export function openDefaultTexturePath() {
	let detail = tl('message.default_textures.detail');
	if (settings.default_path.value) {
		detail += '\n\n' + tl('message.default_textures.current') + ': ' + settings.default_path.value;
	}
	let buttons = (
		settings.default_path.value ? 	[tl('dialog.continue'), tl('generic.remove'), tl('dialog.cancel')]
									:	[tl('dialog.continue'), tl('dialog.cancel')]
	)
	var answer = electron.dialog.showMessageBoxSync(currentwindow, {
		type: 'info',
		buttons,
		noLink: true,
		title: tl('message.default_textures.title'),
		message: tl('message.default_textures.message'),
		detail
	})
	if (answer === buttons.length-1) {
		return;
	} else if (answer === 0) {

		let path = Blockbench.pickDirectory({
			title: tl('message.default_textures.select'),
			resource_id: 'texture',
		});
		if (path) {
			settings.default_path.value = path;
			Settings.saveLocalStorages();
		}
	} else {
		settings.default_path.value = false;
		Settings.saveLocalStorages();
	}
}
export function findExistingFile(paths: string[]) {
	for (var path of paths) {
		if (fs.existsSync(path)) {
			return path;
		}
	}
}
//Backup
export function createBackup(init: boolean) {
	setTimeout(createBackup, limitNumber(parseFloat(settings.backup_interval.value as string), 1, 10e8)*60000)

	let duration = parseInt(settings.backup_retain.value as string)+1
	let folder_path = app.getPath('userData')+osfs+'backups'
	let d = new Date()
	let days = d.getDate() + (d.getMonth()+1)*30.44 + (d.getFullYear()-2000)*365.25

	if (init) {
		//Clear old backups
		fs.readdir(folder_path, (err, files) => {
			if (!err) {
				files.forEach((name, i) => {
					let date = name.split('_')[1]
					if (date) {
						let nums = date.split('.').map(v => parseInt(v));
						let b_days = nums[0] + nums[1]*30.44 + nums[2]*365.25
						if (!isNaN(b_days) && days - b_days > duration) {
							try {
								fs.unlinkSync(folder_path +osfs+ name)
							} catch (err) {console.log(err)}
						}
					}
				})
			}
		})
	}
	if (init || !Project || (elements.length === 0 && Texture.all.length === 0)) return;

	let model = Codecs.project.compile({compressed: true, backup: true});
	let short_name = Project.name.replace(/[.]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 16);
	if (short_name) short_name = '_' + short_name;
	let file_name = 'backup_'+d.getDate()+'.'+(d.getMonth()+1)+'.'+(d.getFullYear()-2000)+'_'+d.getHours()+'.'+d.getMinutes() + short_name;
	let file_path = folder_path+osfs+file_name+'.bbmodel';

	fs.writeFile(file_path, model, function (err) {
		if (err) {
			console.log('Error creating backup: '+err)
		}
	})
}

BARS.defineActions(() => {

	let selected_id; // Remember selected one after re-opening
	new Action('view_backups', {
		icon: 'fa-archive',
		category: 'file',
		condition: () => isApp,
		click(e) {

			let backup_directory = app.getPath('userData')+osfs+'backups';
			let files = fs.readdirSync(backup_directory);

			let entries = files.map((file, i) => {
				let path = PathModule.join(backup_directory, file);
				let stats = fs.statSync(path);
				
				let size = `${separateThousands(Math.round(stats.size / 1024))} KB`;
				let entry = {
					id: file,
					path,
					name: file.replace(/backup_\d+\.\d+\.\d+_\d+\.\d+_?/, '').replace(/\.bbmodel$/, '').replace(/_/g, ' ') || 'no name',
					date: stats.mtime.toLocaleDateString(),
					time: stats.mtime.toLocaleTimeString().replace(/:\d+ /, ' '),
					date_long: stats.mtime.toString(),
					timestamp: stats.mtime.getTime(),
					size,
				}
				return entry;
			})
			entries.sort((a, b) => b.timestamp - a.timestamp);

			let selected;
			const dialog = new Dialog({
				id: 'view_backups',
				title: 'action.view_backups',
				width: 720,
				buttons: ['dialog.confirm', 'dialog.view_backups.open_folder', 'dialog.cancel'],
				component: {
					data() {return {
						backups: entries,
						page: 0,
						per_page: 80,
						search_term: '',
						selected: (selected_id ? entries.find(e => e.id == selected_id) : null)
					}},
					methods: {
						select(backup) {
							selected = this.selected = backup;
							selected_id = backup.id;
						},
						open() {
							dialog.confirm();
						},
						setPage(number) {
							this.page = number;
							this.$refs.backups_list.scrollTop = 0;
						}
					},
					computed: {
						filtered_backups() {
							let term = this.search_term.toLowerCase();
							return this.backups.filter(backup => {
								return backup.name.includes(term);
							})
						},
						viewed_backups() {
							return this.filtered_backups.slice(this.page * this.per_page, (this.page+1) * this.per_page);
						},
						pages() {
							let pages = [];
							let length = this.filtered_backups.length;
							for (let i = 0; i * this.per_page < length; i++) {
								pages.push(i);
							}
							return pages;
						}
					},
					template: `
						<div>
							<div class="bar">
								<search-bar v-model="search_term" @input="setPage(0)"></search-bar>
							</div>
							<ul id="view_backups_list" class="list" ref="backups_list">
								<li v-for="backup in viewed_backups" :key="backup.id" :class="{selected: selected == backup}" @dblclick="open(backup)" @click="select(backup);">
									<span :title="backup.id">{{ backup.name }}</span>
									<div class="view_backups_info_field" :title="backup.date_long">{{ backup.date }}</div>
									<div class="view_backups_info_field" :title="backup.date_long">{{ backup.time }}</div>
									<div class="view_backups_info_field">{{ backup.size }}</div>
								</li>
							</ul>
							<ol class="pagination_numbers" v-if="pages.length > 1">
								<li v-for="number in pages" :class="{selected: page == number}" @click="setPage(number)">{{ number+1 }}</li>
							</ol>
						</div>
					`
				},
				onButton(button) {
					if (button == 1) {
						shell.openPath(backup_directory);
					}
				},
				onConfirm() {
					Blockbench.read([selected.path], {}, (files) => {
						loadModelFile(files[0]);
					})
					dialog.close();
				}
			}).show();
		}
	})
})

// Windows/Linux window controls
document.getElementById('window_controls_button_minimize').addEventListener('click', () => {
	currentwindow.minimize()
})
document.getElementById('window_controls_button_maximize').addEventListener('click', () => {
	currentwindow.isMaximized() ? currentwindow.unmaximize() : currentwindow.maximize()
})
document.getElementById('window_controls_button_close').addEventListener('click', () => {
	currentwindow.close()
})

//Close
window.onbeforeunload = function (event) {
	try {
		updateRecentProjectData()
	} catch(err) {}


	if (Blockbench.hasFlag('allow_closing')) {
		try {
			if (!Blockbench.hasFlag('allow_reload')) {
				currentwindow.webContents.closeDevTools()
			}
		} catch (err) {}

	} else if (ModelProject.all.find(project => !project.saved)) {
		showUnsavedWorkDialog().then(async (all_saved) => {
			if (all_saved) {
				await wait(200);
			}
			closeBlockbenchWindow();
		}).catch(silentReject);

		event.returnValue = true;
		return true;
	} else {
		setTimeout(closeBlockbenchWindow, 1);
		return false;
	}
}

async function closeBlockbenchWindow() {
	for (let project of ModelProject.all.slice()) {
		project.closeOnQuit();
	}
	AutoBackup.removeAllBackups();
	window.onbeforeunload = null;
	Blockbench.addFlag('allow_closing');
	Blockbench.dispatchEvent('before_closing', {});
	if (Project.EditSession) Project.EditSession.quit()
	return window.close();
};


// Hot payload update (community fork): manual update button in the title bar,
// progress dialog while downloading, page reload to apply, changelog afterwards.
// No automatic downloads, no app restart, no installer.
type UpdateCheckResult =
	| {type: 'none'}
	| {type: 'hot', manifest: {version: string, changelog?: string, size?: number}}
	| {type: 'cold', version: string, url: string}

export const UpdateManager = {
	manifest: null as {version: string, changelog?: string, size?: number} | null,
	action: null as Action | null,
	progress_dialog: null as Dialog | null,

	initialize() {
		this.showAppliedChangelog();
		// Keep startup fast: check for updates in the background
		setTimeout(() => this.check(false), 4000);

		new Action('check_for_updates', {
			name: tl('menu.help.check_update'),
			icon: 'refresh',
			click: () => this.check(true)
		});
		MenuBar.menus.help.addAction('check_for_updates', '#about');
	},
	async showAppliedChangelog() {
		try {
			let applied = await ipcRenderer.invoke('bb-update:take-applied');
			if (applied && applied.version) {
				Blockbench.showMessageBox({
					title: tl('update.updated_title', [applied.version]),
					message: applied.changelog || tl('update.updated_message', [applied.version]),
					icon: 'browser_updated',
					width: 560
				});
			}
		} catch (err) {}
	},
	async check(manual: boolean) {
		let result: UpdateCheckResult;
		try {
			result = await ipcRenderer.invoke('bb-update:check');
		} catch (err) {
			console.warn('[update] Update check failed', err);
			if (manual) Blockbench.showQuickMessage('update.failed.title');
			return;
		}
		if (!result || result.type == 'none') {
			if (manual) Blockbench.showQuickMessage('update.no_update');
			return;
		}
		if (this.action) return;
		if (result.type == 'cold') {
			// The update requires a newer main process: fall back to a full install
			this.action = new Action('update_available', {
				name: tl('update.cold_available', [result.version]),
				icon: 'browser_updated',
				click: () => shell.openExternal(result.url)
			});
		} else {
			this.manifest = result.manifest;
			let icon_node = Blockbench.getIconNode('browser_updated');
			icon_node.style.color = 'var(--color-confirm)';
			this.action = new Action('update_available', {
				name: tl('update.available', [result.manifest.version]),
				icon: icon_node,
				click: () => this.confirmUpdate()
			});
		}
		this.action.toElement('#update_menu');
		MenuBar.menus.help.addAction('_');
		MenuBar.menus.help.addAction(this.action);
	},
	confirmUpdate() {
		if (!this.manifest) return;
		new Dialog({
			id: 'bb_update_confirm',
			title: tl('update.confirm_title', [this.manifest.version]),
			width: 600,
			component: {
				data: {changelog: this.manifest.changelog || ''},
				methods: {pureMarked},
				template: `<div class="markdown" style="max-height: 320px; overflow-y: auto; padding: 4px 8px;" v-html="pureMarked(changelog)"></div>`
			},
			buttons: ['update.confirm_button', 'dialog.cancel'],
			onConfirm: () => {
				this.startDownload();
			}
		}).show();
	},
	startDownload() {
		this.progress_dialog = new Dialog({
			id: 'bb_update_download',
			title: tl('update.download_title', [this.manifest ? this.manifest.version : '']),
			progress_bar: {},
			cancel_on_click_outside: false,
			buttons: ['dialog.cancel'],
			onCancel: () => {
				ipcRenderer.send('bb-update:cancel');
			}
		});
		this.progress_dialog.show();
		ipcRenderer.on('bb-update:progress', this.onProgress);
		ipcRenderer.on('bb-update:done', this.onDone);
		ipcRenderer.on('bb-update:error', this.onError);
		ipcRenderer.send('bb-update:start');
	},
	removeDownloadListeners() {
		ipcRenderer.removeListener('bb-update:progress', this.onProgress);
		ipcRenderer.removeListener('bb-update:done', this.onDone);
		ipcRenderer.removeListener('bb-update:error', this.onError);
	},
	onProgress(event, progress: {received: number, total: number, percent: number | null}) {
		if (UpdateManager.progress_dialog && UpdateManager.progress_dialog.progress_bar) {
			UpdateManager.progress_dialog.progress_bar.setProgress((progress.percent ?? 0) / 100);
		}
	},
	onDone() {
		UpdateManager.removeDownloadListeners();
		if (UpdateManager.progress_dialog) {
			UpdateManager.progress_dialog.hide();
			UpdateManager.progress_dialog.delete();
			UpdateManager.progress_dialog = null;
		}
		UpdateManager.checkUnsavedAndReload();
	},
	onError(event, err: {message: string}) {
		UpdateManager.removeDownloadListeners();
		if (UpdateManager.progress_dialog) {
			UpdateManager.progress_dialog.hide();
			UpdateManager.progress_dialog.delete();
			UpdateManager.progress_dialog = null;
		}
		Blockbench.showMessageBox({
			title: 'update.failed.title',
			message: tl('update.failed.message', [err.message || 'unknown']),
			icon: 'error'
		});
	},
	getOtherWindows() {
		return electron.BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.id != currentwindow.id);
	},
	async countUnsavedProjects(): Promise<number> {
		let count = ModelProject.all.filter(project => !project.saved).length;
		for (let win of this.getOtherWindows()) {
			try {
				count += await win.webContents.executeJavaScript(
					`ModelProject.all.filter(project => !project.saved).length`
				);
			} catch (err) {}
		}
		return count;
	},
	async backupUnsavedProjects() {
		for (let project of ModelProject.all.filter(project => !project.saved)) {
			try {
				await project.select();
				await AutoBackup.backupOpenProject();
			} catch (err) {
				console.error('[update] Backup before update failed', err);
			}
		}
		for (let win of this.getOtherWindows()) {
			try {
				await win.webContents.executeJavaScript(`(async () => {
					for (let project of ModelProject.all.filter(project => !project.saved)) {
						await project.select();
						await AutoBackup.backupOpenProject();
					}
				})()`);
			} catch (err) {
				console.error('[update] Backup before update failed', err);
			}
		}
	},
	async checkUnsavedAndReload() {
		let unsaved = await this.countUnsavedProjects();
		if (unsaved) {
			Blockbench.showMessageBox({
				title: 'update.unsaved.title',
				message: 'update.unsaved.message',
				icon: 'warning',
				buttons: ['update.backup_reload', 'update.reload_anyway', 'dialog.cancel'],
				cancel: 2
			}, async (button) => {
				if (button === 0) {
					await this.backupUnsavedProjects();
					this.reloadAllWindows();
				} else if (button === 1) {
					this.reloadAllWindows();
				}
			});
		} else {
			this.reloadAllWindows();
		}
	},
	async reloadAllWindows() {
		// Bypass the unsaved-work guard in every window, then reload into the new payload
		for (let win of this.getOtherWindows()) {
			try {
				await win.webContents.executeJavaScript(
					`Blockbench.addFlag('allow_reload'); Blockbench.addFlag('allow_closing'); void 0;`
				);
			} catch (err) {}
		}
		Blockbench.addFlag('allow_reload');
		Blockbench.addFlag('allow_closing');
		await ipcRenderer.invoke('bb-update:reload');
	}
}


const global = {
	PathModule,
	recent_projects,
	nativeImage,
	updateRecentProjects,
	addRecentProject,
	updateRecentProjectData,
	loadDataFromModelMemory,
	changeImageEditor,
	openDefaultTexturePath,
	updateRecentProjectThumbnail,
	createBackup,
	UpdateManager,
};
declare global {
	const recent_projects: RecentProjectData[]
	type RecentProjectData = import('./desktop').RecentProjectData
	const updateRecentProjects: typeof global.updateRecentProjects
	const addRecentProject: typeof global.addRecentProject
	const updateRecentProjectData: typeof global.updateRecentProjectData
	const updateRecentProjectThumbnail: typeof global.updateRecentProjectThumbnail
	const loadDataFromModelMemory: typeof global.loadDataFromModelMemory
	const changeImageEditor: typeof global.changeImageEditor
	const openDefaultTexturePath: typeof global.openDefaultTexturePath
	const createBackup: typeof global.createBackup
	const UpdateManager: typeof global.UpdateManager
}
Object.assign(window, global);
