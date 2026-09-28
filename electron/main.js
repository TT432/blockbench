import {app, BrowserWindow, Menu, ipcMain, shell} from 'electron'
import path from 'path'
import url from 'url'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import * as PayloadUpdater from './payload_updater.js'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const remote = require('@electron/remote/main')
remote.initialize();


// Community edition uses its own app identity (separate userData, install dir, shortcuts)
// so it never interferes with an official Blockbench installation.
app.setName('blockbench-community');
// Resolved app entry point: external hot-update payload when present and verified,
// otherwise the builtin index.html. Set during app startup and after applying an update.
let current_index_path = path.join(__dirname, './../index.html');
let current_version = null;

let all_wins = [];
let orig_win;
let load_project_data;

(() => {
	// Allow advanced users to specify a custom userData directory.
	// Useful for portable installations, and for setting up development environments.
	const index = process.argv.findIndex(arg => arg === '--userData');
	if (index !== -1) {
		if (!process.argv.at(index + 1)) {
			console.error('No path specified after --userData')
			process.exit(1)
		}
		app.setPath('userData', process.argv[index + 1]);
	}
})()

const LaunchSettings = {
	path: path.join(app.getPath('userData'), 'launch_settings.json'),
	settings: {},
	get(key) {
		return this.settings[key]
	},
	set(key, value) {
		this.settings[key] = value;
		let content = JSON.stringify(this.settings, null, '\t');
		fs.writeFileSync(this.path, content);
	},
	load() {
		try {
			if (fs.existsSync(this.path)) {
				let content = fs.readFileSync(this.path, 'utf-8');
				this.settings = JSON.parse(content);
			}
		} catch (error) {}
		return this;
	}
}.load();

if (LaunchSettings.get('hardware_acceleration') == false) {
	app.disableHardwareAcceleration();
	if (process.platform != 'win32') {
		app.commandLine.appendSwitch('enable-unsafe-swiftshader');
	}
}

function createWindow(second_instance, options = {}) {
	if (app.requestSingleInstanceLock && !app.requestSingleInstanceLock()) {
		app.quit()
		return;
	}
	let native_frame = LaunchSettings.get('native_window_frame') === true;
	let win_options = {
		icon: 'icon.ico',
		show: false,
		backgroundColor: '#21252b',
		frame: native_frame,
		titleBarStyle: native_frame ? 'default' : 'hidden',
		minWidth: 640,
		minHeight: 480,
		width: 1080,
		height: 720,
		webPreferences: {
			webgl: true,
			webSecurity: true,
			nodeIntegration: true,
			contextIsolation: false,
			enableRemoteModule: true,
			backgroundThrottling: false
		}
	};
	if (options.position) {
		win_options.x = options.position[0] - 300;
		win_options.y = Math.max(options.position[1] - 100, 0);
	}
	let win = new BrowserWindow(win_options)
	if (!orig_win) orig_win = win;
	all_wins.push(win);

	remote.enable(win.webContents)

	if (process.platform === 'darwin') {

		let template = [
			{
				"label": "βlockβench",
				"submenu": [
					{
						"role": "hide"
					},
					{
						"role": "hideothers"
					},
					{
						"role": "unhide"
					},
					{
						"type": "separator"
					},
					{
                        "role": "quit"
					}
				]
			},
			{
				"label": "Edit",
				"submenu": [
					{
						"role": "cut"
					},
					{
						"role": "copy"
					},
					{
						"role": "paste"
					},
					{
						"role": "selectall"
					}
				]
			},
			{
				"label": "Window",
				"role": "window",
				"submenu": [
					{
						"label": "Toggle Full Screen",
						"accelerator": "Ctrl+Command+F"
					},
					{
						"role": "minimize"
					},
					{
						"role": "close"
					},
					{
						"type": "separator"
					},
					{
						"role": "front"
					}
				]
			}
		]


		var osxMenu = Menu.buildFromTemplate(template);
		Menu.setApplicationMenu(osxMenu)
	} else {
		win.setMenu(null);
	}
	
	if (options.maximize !== false) win.maximize()

	let url_path = url.format({
		pathname: current_index_path,
		protocol: 'file:',
		slashes: true
	});
	win.loadURL(url_path).finally(() => {
		win.show();
	});
	win.on('closed', () => {
		win = null;
		all_wins.splice(all_wins.indexOf(win), 1);
	})
	if (second_instance === true) {
		win.webContents.second_instance = true;
	}
	return win;
}

app.commandLine.appendSwitch('ignore-gpu-blacklist')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-accelerated-video')

app.on('second-instance', function (event, argv, cwd) {
	process.argv = argv;
	let win = all_wins.find(win => !win.isDestroyed());
	if (win && argv[argv.length-1 || 1] && argv[argv.length-1 || 1].substr(0, 2) !== '--') {
		win.webContents.send('open-model', argv[argv.length-1 || 1]);
		win.focus();
	} else {
		createWindow(true);
	}
})
app.on('open-file', function (event, path) {
	process.argv[process.argv.length-1 || 1] = path;
	let win = all_wins.find(win => !win.isDestroyed());
	if (win) {
		win.webContents.send('open-model', path);
	}
})

ipcMain.on('edit-launch-setting', (event, arg) => {
	LaunchSettings.set(arg.key, arg.value);
})
ipcMain.handle('get-launch-setting', (event, arg) => {
	return LaunchSettings.get(arg.key);
})
ipcMain.on('add-recent-project', (event, path) => {
	app.addRecentDocument(path);
})
ipcMain.on('dragging-tab', (event, value) => {
	all_wins.forEach(win => {
		if (win.isDestroyed() || win.id == event.sender.id) return;
		win.webContents.send('accept-detached-tab', JSON.parse(value));
	})
})
ipcMain.on('new-window', (event, data, position) => {
	if (typeof data == 'string') load_project_data = JSON.parse(data);
	if (position) {
		position = JSON.parse(position)
		let place_in_window = all_wins.find(win => {
			if (win.isDestroyed() || win.webContents == event.sender || win.isMinimized()) return false;
			let pos = win.getPosition();
			let size = win.getSize();
			return (position.offset[0] >= pos[0] && position.offset[0] <= pos[0] + size[0]
				 && position.offset[1] >= pos[1] && position.offset[1] <= pos[1] + size[1]);
		})
		if (place_in_window) {
			place_in_window.send('load-tab', load_project_data);
			place_in_window.focus();
			load_project_data = null;
		} else {
			createWindow(true, {
				maximize: false,
				position: position.offset
			});
		}
	} else {
		createWindow(true);
	}
})
ipcMain.on('close-detached-project', async (event, window_id, uuid) => {
	let window = all_wins.find(win => win.id == window_id);
	if (window) window.send('close-detached-project', uuid);
})
ipcMain.on('request-color-picker', async (event, arg) => {
	const ColorPicker = await import('electron-color-picker');
	const color = await ColorPicker.getColorHexRGB().catch((error) => {
		console.warn('[Error] Failed to pick color', error)
		return ''
	})
	if (color) {
		all_wins.forEach(win => {
			if (win.isDestroyed() || (!arg.sync && win.webContents.getProcessId() != event.sender.getProcessId())) return;
			win.webContents.send('set-main-color', color)
		})
	}
})
ipcMain.on('show-item-in-folder', async (event, path) => {
	shell.showItemInFolder(path);
})
ipcMain.on('open-in-default-app', async (event, path) => {
	shell.openPath(path);
})
// Hot payload update IPC (community fork: manual updates, no app restart)
ipcMain.handle('bb-update:check', async () => {
	try {
		return await PayloadUpdater.checkForUpdate(current_version || app.getVersion());
	} catch (err) {
		console.warn('[update] Update check failed:', err.message);
		return {type: 'none'};
	}
})
let active_apply = null;
ipcMain.on('bb-update:start', (event) => {
	if (active_apply) return;
	const send = (channel, data) => {
		if (!event.sender.isDestroyed()) event.sender.send(channel, data);
	}
	active_apply = PayloadUpdater.startApply(progress => send('bb-update:progress', progress));
	active_apply.promise.then(result => {
		current_index_path = result.index_path;
		current_version = result.version;
		console.log('[update] Payload applied:', result.version);
		send('bb-update:done', {version: result.version});
	}).catch(err => {
		if (err.message !== 'cancelled') {
			console.error('[update] Update failed:', err.message);
			send('bb-update:error', {message: err.message});
		}
	}).finally(() => {
		active_apply = null;
	})
})
ipcMain.on('bb-update:cancel', () => {
	if (active_apply) active_apply.cancel();
})
ipcMain.handle('bb-update:reload', () => {
	let url_path = url.format({
		pathname: current_index_path,
		protocol: 'file:',
		slashes: true
	});
	for (let win of all_wins) {
		if (!win.isDestroyed()) win.loadURL(url_path);
	}
	return current_version;
})
ipcMain.handle('bb-update:take-applied', () => {
	return PayloadUpdater.takeAppliedUpdate();
})

app.on('ready', async () => {

	const dev_mode = process.execPath && process.execPath.match(/node_modules[\\\/]electron/);

	const resolved = await PayloadUpdater.resolvePayloadIndex(path.join(__dirname, './../index.html'));
	current_index_path = resolved.index_path;
	current_version = resolved.version;
	if (resolved.source == 'payload') {
		console.log('[Blockbench] Loading external payload version', resolved.version);
	}
	PayloadUpdater.cleanupTemp();

	createWindow();

	let app_was_loaded = false;
	ipcMain.on('app-loaded', () => {

		if (load_project_data) {
			all_wins[all_wins.length-1].send('load-tab', load_project_data);
			load_project_data = null;
		}

		if (app_was_loaded) {
			console.log('[Blockbench] App reloaded or new window opened')
			return;
		}

		app_was_loaded = true;
		if (dev_mode) {
			console.log('[Blockbench] App launched in development mode')
		}
	})
})

app.on('window-all-closed', () => {
	app.quit()
})
