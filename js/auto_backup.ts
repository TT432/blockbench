import { addStartScreenSection } from "./interface/start_screen";
import { currentwindow } from "./native_apis";

//Backup
export const AutoBackup = {
	/**
	 * IndexedDB Database
	 */
	db: null as (null | IDBDatabase),
	initialize(): void {
		let request = indexedDB.open('auto_backups', 1);
		request.onerror = function(e) {
			console.error('Failed to load backup database', e);
		}
		request.onblocked = function(e) {
			console.error('Another instance of Blockbench is opened, the backup database cannot be upgraded at the moment');
		}
		request.onupgradeneeded = function() {
			let db = request.result;
			let store = db.createObjectStore('projects', {keyPath: 'uuid'});

			// Legacy system
			let backup_models = localStorage.getItem('backup_model')
			if (backup_models) {
				let parsed_backup_models = JSON.parse(backup_models);
				for (let uuid in parsed_backup_models) {
					let model = JSON.stringify(parsed_backup_models[uuid]);
					store.put({uuid, data: model});
				}
				console.log(`Upgraded ${Object.keys(parsed_backup_models).length} project back-ups to indexedDB`);
			}
		}
		request.onsuccess = async function() {
			AutoBackup.db = request.result;
			
			// Start Screen Message
			let has_backups = await AutoBackup.hasBackups();
			// @ts-expect-error
			if (has_backups && (!isApp || !currentwindow.webContents.second_instance)) {

				let section = addStartScreenSection('recover_backup', {
					graphic: {type: 'icon', icon: 'fa-archive'},
					// @ts-ignore Idk
					insert_before: 'start_files',
					text: [
						{type: 'h3', text: tl('message.recover_backup.title')},
						{type: 'p', text: tl('message.recover_backup.message')},
						{type: 'button', text: tl('message.recover_backup.recover'), click: (e) => {
							AutoBackup.recoverAllBackups().then(() => {
								section.delete();
							});
						}},
						{type: 'button', text: tl('dialog.discard'), click: (e) => {
							AutoBackup.removeAllBackups();
							section.delete();
						}}
					]
				})
			}

			AutoBackup.backupProjectLoop(false);
		}
	},
	async backupOpenProject() {
		if (!Project) return;
		let transaction = AutoBackup.db.transaction('projects', 'readwrite');
		let store = transaction.objectStore('projects');

		let model = Codecs.project.compile({compressed: false, backup: true, raw: true});
		let model_json = JSON.stringify(model)
		store.put({uuid: Project.uuid, data: model_json});
		
		await new Promise((resolve) => {
			transaction.oncomplete = resolve;
		})
	},
	/**
	 * Test if saved backups exist
	 */
	async hasBackups(): Promise<boolean> {
		let transaction = AutoBackup.db.transaction('projects', 'readonly');
		let store = transaction.objectStore('projects');
		return await new Promise(resolve => {
			let request = store.count();
			request.onsuccess = function() {
				resolve(!!request.result);
			}
			request.onerror = function(e) {
				console.error(e);
				resolve(false);
			}
		})
	},
	/**
	 * Recover all saved backups
	 */
	recoverAllBackups(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let transaction = AutoBackup.db.transaction('projects', 'readonly');
			let store = transaction.objectStore('projects');
			let request = store.getAll();
			request.onsuccess = async function() {
				let projects = request.result;
				for (let project of projects) {
					try {
						let parsed_content = JSON.parse(project.data);
						setupProject(Formats[parsed_content.meta.model_format] || Formats.free, project.uuid);
						Codecs.project.parse(parsed_content, 'backup.bbmodel');
						await new Promise(r => setTimeout(r, 40));
					} catch(err) {
						console.error(err);
					}
				}
				resolve();
			}
			request.onerror = function(e) {
				console.error(e);
				reject(e);
			}
		})
	},
	async removeBackup(uuid: string) {
		let transaction = AutoBackup.db.transaction('projects', 'readwrite');
		let store = transaction.objectStore('projects');
		let request = store.delete(uuid);
		
		return await new Promise((resolve, reject) => {
			request.onsuccess = resolve;
			request.onerror = function(e) {
				reject();
			}
		});
	},
	async removeAllBackups() {
		let transaction = AutoBackup.db.transaction('projects', 'readwrite');
		let store = transaction.objectStore('projects');
		let request = store.clear();
		
		return await new Promise((resolve, reject) => {
			request.onsuccess = resolve;
			request.onerror = function(e) {
				console.error(e);
				reject();
			}
		});
	},
	loop_timeout: null,
	backupProjectLoop(run_save: boolean = true) {
		if (run_save && Project && (Outliner.root.length || Project.textures.length)) {
			try {
				AutoBackup.backupOpenProject();
			} catch (err) {
				console.error('Unable to create backup. ', err)
			}
		}
		let interval = settings.recovery_save_interval.value as number;
		if (interval != 0) {
			interval = Math.max(interval, 5);
			AutoBackup.loop_timeout = setTimeout(() => AutoBackup.backupProjectLoop(true), interval * 1000);
		}
	}
}
Object.assign(window, {
	AutoBackup,
})