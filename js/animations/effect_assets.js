/*
	Project assets for animation effects: particle effects (Bedrock particle JSON)
	and sound files. Unlike plain file path references, these assets are embedded
	into the .bbmodel file so a project stays portable.

	Reference model: keyframe data points and animation controller state entries
	store a string reference in their `file` property, which is either the asset's
	disk path (app) or its uuid (when no path exists, e.g. web). All playback and
	preview lookups resolve through ParticleAsset.fromRef / SoundAsset.fromRef,
	so existing consumers keyed by that string keep working.
*/

import { fs, PathModule, NodeBuffer } from "../native_apis";

function effectAssetArrayBufferToBase64(buffer) {
	let bytes = new Uint8Array(buffer);
	let binary = '';
	let chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}
function effectAssetDataURLToUint8Array(data_url) {
	let base64 = data_url.substring(data_url.indexOf(',') + 1);
	let binary = atob(base64);
	let bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
function getAudioMimeType(name) {
	let ext = pathToExtension(name || '');
	switch (ext) {
		case 'ogg': return 'audio/ogg';
		case 'wav': return 'audio/wav';
		case 'mp3': return 'audio/mpeg';
		default: return 'application/octet-stream';
	}
}
// 扫描引用某粒子资产（file 引用字符串）的所有 keyframe 与动画控制器状态；
// 传入 new_ref 时同步改指新引用（必须在 Undo.initEdit 之后对活动对象调用）。
function findParticleRefUsage(old_ref, new_ref) {
	let keyframes = [];
	let controllers = [];
	Animation.all.forEach(animation => {
		for (let uuid in animation.animators) {
			let animator = animation.animators[uuid];
			if (!(animator.particle instanceof Array)) continue;
			animator.particle.forEach(kf => {
				let affected = false;
				kf.data_points.forEach(data_point => {
					if (data_point.file === old_ref) {
						if (new_ref !== undefined) data_point.file = new_ref;
						affected = true;
					}
				});
				if (affected) keyframes.safePush(kf);
			});
		}
	});
	AnimationController.all.forEach(controller => {
		let affected = false;
		controller.states.forEach(state => {
			state.particles.forEach(particle => {
				if (particle.file === old_ref) {
					if (new_ref !== undefined) particle.file = new_ref;
					affected = true;
				}
			});
		});
		if (affected) controllers.push(controller);
	});
	return {keyframes, controllers};
}

export class ParticleAsset {
	constructor(data, uuid) {
		this.uuid = uuid || guid();
		this.name = '';
		this.path = '';
		this.texture_path = '';
		// Embedded texture image as dataURL (single slot)
		this.texture = '';
		// Parsed particle JSON (particle_effect root)
		this.content = null;
		this.saved = false;
		if (typeof data == 'object' && data) {
			this.extend(data);
		}
	}
	getRef() {
		return this.path || this.uuid;
	}
	getIdentifier() {
		return this.content?.particle_effect?.description?.identifier || '';
	}
	getSaveCopy() {
		return {
			uuid: this.uuid,
			name: this.name,
			path: this.path || undefined,
			texture_path: this.texture_path || undefined,
			texture: this.texture || undefined,
			content: this.content ? JSON.parse(JSON.stringify(this.content)) : null,
			saved: this.saved,
		};
	}
	getUndoCopy() {
		let copy = this.getSaveCopy();
		delete copy.saved;
		return copy;
	}
	extend(data) {
		if (typeof data.name == 'string') this.name = data.name;
		if (typeof data.path == 'string') this.path = data.path;
		if (typeof data.texture_path == 'string') this.texture_path = data.texture_path;
		if (typeof data.texture == 'string') this.texture = data.texture;
		if (typeof data.saved == 'boolean') this.saved = data.saved;
		if (data.content && typeof data.content == 'object') {
			this.content = JSON.parse(JSON.stringify(data.content));
		}
		return this;
	}
	add(undo) {
		if (this.path) {
			let existing = ParticleAsset.all.find(a => a !== this && a.path === this.path);
			if (existing) return existing;
		}
		if (undo === true) {
			Undo.initEdit({particles: []});
			ParticleAsset.all.push(this);
			Undo.finishEdit('Add particle', {particles: [this]});
		} else {
			ParticleAsset.all.push(this);
		}
		Blockbench.dispatchEvent('add_particle_asset', {asset: this});
		return this;
	}
	remove() {
		Undo.initEdit({particles: [this]});
		ParticleAsset.all.remove(this);
		unloadParticleEffectEntry(this.getRef());
		Undo.finishEdit('Remove particle', {particles: []});
	}
	loadEmitter() {
		if (!this.content) return null;
		let effect = Animator.loadParticleEmitter(this.getRef(), JSON.stringify(this.content));
		if (effect && this.texture) {
			effect.config.preview_texture = this.texture;
			effect.config.updateTexture();
		}
		return effect;
	}
	// Try to locate the particle's texture image on disk (same logic as the
	// WinterskyScene fetchTexture callback) and embed it as dataURL.
	autoResolveTexture() {
		if (this.texture || !this.content) return;
		let effect = Animator.particle_effects[this.getRef()];
		let texture_path = effect?.config?.particle_texture_path;
		if (!texture_path || !isApp || !this.path) return;
		let path_arr = this.path.split(/[\\/]+/);
		let particle_index = path_arr.indexOf('particles');
		if (particle_index < 0) return;
		path_arr.splice(particle_index);
		let file_path = PathModule.join(path_arr.join(PathModule.sep), texture_path.replace(/\.png$/, '') + '.png');
		if (!fs.existsSync(file_path)) return;
		try {
			let buffer = fs.readFileSync(file_path);
			this.texture = 'data:image/png;base64,' + buffer.toString('base64');
			this.texture_path = file_path;
			effect.config.preview_texture = this.texture;
			effect.config.updateTexture();
		} catch (err) {
			console.warn('Could not embed particle texture', file_path, err);
		}
	}
	changeTexture() {
		Blockbench.import({
			extensions: ['png'],
			type: 'Particle Texture',
			readtype: 'image',
			startpath: this.texture_path || this.path || undefined
		}, (files) => {
			let apply = (data_url, texture_path) => {
				Undo.initEdit({particles: [this]});
				this.texture = data_url;
				if (texture_path) this.texture_path = texture_path;
				let effect = Animator.particle_effects[this.getRef()];
				if (effect) {
					effect.config.preview_texture = data_url;
					effect.config.updateTexture();
				}
				Undo.finishEdit('Change particle texture', {particles: [this]});
			};
			if (isApp) {
				let texture_path = files[0].path;
				try {
					let buffer = fs.readFileSync(texture_path);
					apply('data:image/png;base64,' + buffer.toString('base64'), texture_path);
				} catch (err) {
					console.error('Could not read particle texture', err);
				}
			} else {
				apply(files[0].content);
			}
		})
	}
	changeFile() {
		Blockbench.import({
			resource_id: 'animation_particle',
			extensions: ['json'],
			type: 'Bedrock Particle',
			startpath: this.path || undefined
		}, (files) => {
			let json = autoParseJSON(files[0].content, {file_path: files[0].path});
			if (!json || !json.particle_effect) {
				Blockbench.showQuickMessage('message.invalid_particle_file');
				return;
			}
			let old_ref = this.getRef();
			let new_ref = files[0].path || old_ref;
			// 路径变化时引用该资产的 keyframe/控制器状态需要一并改指新引用。
			// 先扫描收集 Undo 方面，initEdit 后重新扫描活动对象再改（Undo 快照会替换数组内对象）。
			let affected = new_ref !== old_ref ? findParticleRefUsage(old_ref) : null;
			Undo.initEdit({
				particles: [this],
				keyframes: affected ? affected.keyframes : [],
				animation_controllers: affected ? affected.controllers : []
			});
			this.content = json;
			if (files[0].path) {
				this.path = files[0].path;
				this.saved = true;
			}
			this.texture = '';
			this.texture_path = '';
			if (affected) {
				unloadParticleEffectEntry(old_ref);
				findParticleRefUsage(old_ref, new_ref);
			}
			this.loadEmitter();
			this.autoResolveTexture();
			Undo.finishEdit('Change particle file', {particles: [this]});
		})
	}
	save(as) {
		if (!this.content) return;
		let content = compileJSON(this.content);
		if (isApp && this.path && !as) {
			fs.writeFile(this.path, content, (err) => {
				if (!err) this.saved = true;
			});
		} else {
			Blockbench.export({
				resource_id: 'animation_particle',
				type: 'Bedrock Particle',
				extensions: ['json'],
				name: this.name,
				content,
				startpath: this.path || undefined,
				savetype: 'text'
			}, (path) => {
				if (isApp && path) {
					this.path = path;
				}
				this.saved = true;
			})
		}
	}
	rename() {
		Blockbench.textPrompt('generic.rename', this.name, (text) => {
			if (!text || text == this.name) return;
			Undo.initEdit({particles: [this]});
			this.name = text;
			Undo.finishEdit('Rename particle', {particles: [this]});
		})
	}
	showContextMenu(event) {
		this.menu.open(event, this);
	}
	static fromRef(ref) {
		if (!ref || typeof ref != 'string') return null;
		return ParticleAsset.all.find(a => a.uuid === ref || (a.path && a.path === ref)) || null;
	}
	// Create or refresh an asset from an imported/read file result.
	// Adds the asset to the project (without undo; callers wrap with Undo edits).
	static importFromFile(file) {
		let json = autoParseJSON(file.content, {file_path: file.path});
		if (!json || !json.particle_effect) return null;
		let path = isApp ? file.path : '';
		let existing = path && ParticleAsset.all.find(a => a.path === path);
		if (existing) {
			existing.content = json;
			existing.saved = true;
			existing.loadEmitter();
			return existing;
		}
		let asset = new ParticleAsset({
			name: pathToName(file.name || path, false),
			path: path || '',
			content: json,
			saved: !!path,
		});
		asset.add(false);
		asset.loadEmitter();
		asset.autoResolveTexture();
		return asset;
	}
	// Ensure that whatever `ref` points to is loaded: embedded asset, or a
	// legacy disk path that gets auto-imported as an asset. When the file
	// cannot be found/read, a content-less placeholder asset is created so the
	// reference stays resolvable and shows up (red) in the particle panel,
	// where clicking it re-imports the file.
	static ensureLoaded(ref) {
		if (!ref) return null;
		let asset = ParticleAsset.fromRef(ref);
		if (asset) {
			asset.loadEmitter();
			return asset;
		}
		// 桌面端路径引用先预检：Blockbench.read 读不到文件时不会回调（errorbox 关闭时静默失败）
		if (isApp && !isUUID(ref) && !fs.existsSync(ref)) {
			ParticleAsset.createMissingPlaceholder(ref);
			return null;
		}
		try {
			Blockbench.read([ref], {errorbox: false}, (files) => {
				if (!files || !files[0]) {
					ParticleAsset.createMissingPlaceholder(ref);
					return;
				}
				let imported = ParticleAsset.importFromFile({
					name: files[0].name || pathToName(ref, true),
					path: isApp ? ref : undefined,
					content: files[0].content
				});
				if (!imported) {
					ParticleAsset.createMissingPlaceholder(ref);
				}
			})
		} catch (err) {
			console.log('Could not load particle effect for', ref);
			ParticleAsset.createMissingPlaceholder(ref);
		}
		return null;
	}
	// 文件缺失时创建无内容的占位资产（面板中显示为红色，点击可重新导入）
	static createMissingPlaceholder(ref) {
		if (!ref || ParticleAsset.fromRef(ref)) return null;
		let is_uuid = isUUID(ref);
		let asset = new ParticleAsset({
			name: is_uuid ? ref : pathToName(ref, false),
			// 保留引用路径（含 web 端）：fromRef 靠它匹配，否则保存/重开后
			// 路径丢失会重复创建占位资产
			path: is_uuid ? '' : ref,
		}, is_uuid ? ref : undefined);
		asset.add(false);
		return asset;
	}
}
ParticleAsset.prototype.menu = new Menu([
	{
		id: 'change_file',
		name: 'menu.particle_asset.change_file',
		icon: 'upload_file',
		click(asset) { asset.changeFile(); }
	},
	{
		id: 'change_texture',
		name: 'menu.particle_asset.change_texture',
		icon: 'image',
		click(asset) { asset.changeTexture(); }
	},
	{
		id: 'save',
		name: 'menu.texture.save',
		icon: 'save',
		click(asset) { asset.save(); }
	},
	{
		id: 'rename',
		name: 'generic.rename',
		icon: 'text_fields',
		click(asset) { asset.rename(); }
	},
	'_',
	{
		id: 'remove',
		name: 'generic.remove',
		icon: 'clear',
		click(asset) { asset.remove(); }
	}
]);
Object.defineProperty(ParticleAsset, 'all', {
	get() { return Project?.particles || []; }
});

export class SoundAsset {
	constructor(data, uuid) {
		this.uuid = uuid || guid();
		this.name = '';
		this.path = '';
		// Audio data as dataURL (embedded into .bbmodel, used for playback)
		this.source = '';
		this.saved = false;
		this.playing = false;
		// Non-enumerable so Vue does not observe the DOM Audio node
		Object.defineProperty(this, 'playing_media', {value: null, writable: true, enumerable: false, configurable: true});
		if (typeof data == 'object' && data) {
			this.extend(data);
		}
	}
	getRef() {
		return this.path || this.uuid;
	}
	getPlaybackSource() {
		return this.source || this.path || '';
	}
	getDuration() {
		let waveform = Timeline.waveforms[this.getRef()];
		return waveform?.duration || 0;
	}
	getSaveCopy() {
		return {
			uuid: this.uuid,
			name: this.name,
			path: this.path || undefined,
			source: this.source || undefined,
			saved: this.saved,
		};
	}
	getUndoCopy() {
		let copy = this.getSaveCopy();
		delete copy.saved;
		return copy;
	}
	extend(data) {
		if (typeof data.name == 'string') this.name = data.name;
		if (typeof data.path == 'string') this.path = data.path;
		if (typeof data.source == 'string') this.source = data.source;
		if (typeof data.saved == 'boolean') this.saved = data.saved;
		return this;
	}
	add(undo) {
		if (this.path) {
			let existing = SoundAsset.all.find(a => a !== this && a.path === this.path);
			if (existing) return existing;
		}
		if (undo === true) {
			Undo.initEdit({sounds: []});
			SoundAsset.all.push(this);
			Undo.finishEdit('Add sound', {sounds: [this]});
		} else {
			SoundAsset.all.push(this);
		}
		Blockbench.dispatchEvent('add_sound_asset', {asset: this});
		return this;
	}
	remove() {
		Undo.initEdit({sounds: [this]});
		if (this.playing_media && !this.playing_media.paused) {
			this.playing_media.pause();
		}
		SoundAsset.all.remove(this);
		delete Timeline.waveforms[this.getRef()];
		Undo.finishEdit('Remove sound', {sounds: []});
	}
	togglePlay() {
		if (this.playing_media && !this.playing_media.paused) {
			this.playing_media.pause();
			this.playing = false;
			return;
		}
		let source = this.getPlaybackSource();
		if (!source) return;
		let media = new Audio(source);
		media.volume = Math.clamp(settings.volume.value / 100, 0, 1);
		this.playing_media = media;
		this.playing = true;
		media.onended = () => {
			this.playing = false;
		};
		media.onerror = () => {
			this.playing = false;
		};
		media.play().catch(() => {
			this.playing = false;
		});
	}
	changeFile() {
		Blockbench.import({
			resource_id: 'animation_audio',
			extensions: ['ogg', 'wav', 'mp3'],
			type: 'Audio File',
			readtype: 'binary',
			startpath: this.path || undefined
		}, (files) => {
			let source = SoundAsset.fileToSource(files[0]);
			if (!source) return;
			Undo.initEdit({sounds: [this]});
			this.source = source;
			if (isApp && files[0].path) {
				this.path = files[0].path;
				this.saved = true;
			} else {
				this.saved = false;
			}
			delete Timeline.waveforms[this.getRef()];
			Timeline.visualizeAudioFile(this.getRef());
			Undo.finishEdit('Change sound file', {sounds: [this]});
		})
	}
	save(as) {
		if (!this.source) return;
		let content = effectAssetDataURLToUint8Array(this.source);
		let extension = pathToExtension(this.path || this.name) || 'ogg';
		if (isApp && this.path && !as) {
			fs.writeFile(this.path, NodeBuffer.Buffer.from(content), (err) => {
				if (!err) this.saved = true;
			});
		} else {
			Blockbench.export({
				resource_id: 'animation_audio',
				type: 'Audio File',
				extensions: [extension],
				name: this.name,
				content,
				startpath: this.path || undefined,
				savetype: 'buffer'
			}, (path) => {
				if (isApp && path) {
					this.path = path;
				}
				this.saved = true;
			})
		}
	}
	rename() {
		Blockbench.textPrompt('generic.rename', this.name, (text) => {
			if (!text || text == this.name) return;
			Undo.initEdit({sounds: [this]});
			this.name = text;
			Undo.finishEdit('Rename sound', {sounds: [this]});
		})
	}
	showContextMenu(event) {
		this.menu.open(event, this);
	}
	static fromRef(ref) {
		if (!ref || typeof ref != 'string') return null;
		return SoundAsset.all.find(a => a.uuid === ref || (a.path && a.path === ref)) || null;
	}
	// Resolve any file reference (asset uuid/path or legacy path) to a playable URL
	static resolvePlaybackSource(ref) {
		let asset = SoundAsset.fromRef(ref);
		return asset ? asset.getPlaybackSource() : ref;
	}
	static fileToSource(file) {
		if (typeof file.content == 'string' && file.content.startsWith('data:')) {
			return file.content;
		}
		let buffer = file.content;
		if (typeof buffer == 'string' && isApp) {
			// readtype yielded a path
			try {
				buffer = fs.readFileSync(buffer);
			} catch (err) {
				console.error('Could not read audio file', err);
				return '';
			}
		} else if (!buffer && isApp && file.path) {
			try {
				buffer = fs.readFileSync(file.path);
			} catch (err) {
				console.error('Could not read audio file', err);
				return '';
			}
		}
		if (!buffer) return '';
		let mime = getAudioMimeType(file.name || file.path);
		return `data:${mime};base64,` + effectAssetArrayBufferToBase64(buffer);
	}
	static importFromFile(file) {
		let path = isApp ? file.path : '';
		let existing = path && SoundAsset.all.find(a => a.path === path);
		let source = SoundAsset.fileToSource(file);
		if (!source) return null;
		if (existing) {
			existing.source = source;
			existing.saved = true;
			delete Timeline.waveforms[existing.getRef()];
			return existing;
		}
		let asset = new SoundAsset({
			name: pathToName(file.name || path, false),
			path: path || '',
			source,
			saved: !!path,
		});
		asset.add(false);
		return asset;
	}
	static ensureLoaded(ref) {
		if (!ref) return null;
		let asset = SoundAsset.fromRef(ref);
		if (!asset && isApp && !isUUID(ref) && fs.existsSync(ref)) {
			asset = SoundAsset.importFromFile({name: pathToName(ref, true), path: ref});
		}
		if (asset) {
			if (!Timeline.waveforms[ref]) Timeline.visualizeAudioFile(ref);
			return asset;
		}
		if (!Timeline.waveforms[ref]) {
			Timeline.visualizeAudioFile(ref).catch?.(() => {});
		}
		return null;
	}
}
SoundAsset.prototype.menu = new Menu([
	{
		id: 'play',
		name: 'action.play_animation',
		icon: 'play_arrow',
		click(asset) { asset.togglePlay(); }
	},
	{
		id: 'change_file',
		name: 'menu.sound_asset.change_file',
		icon: 'upload_file',
		click(asset) { asset.changeFile(); }
	},
	{
		id: 'save',
		name: 'menu.texture.save',
		icon: 'save',
		click(asset) { asset.save(); }
	},
	{
		id: 'rename',
		name: 'generic.rename',
		icon: 'text_fields',
		click(asset) { asset.rename(); }
	},
	'_',
	{
		id: 'remove',
		name: 'generic.remove',
		icon: 'clear',
		click(asset) { asset.remove(); }
	}
]);
Object.defineProperty(SoundAsset, 'all', {
	get() { return Project?.sounds || []; }
});

// Remove a loaded runtime particle effect entry (emitters + watcher)
function unloadParticleEffectEntry(ref) {
	let effect = Animator.particle_effects[ref];
	if (!effect) return;
	if (isApp && effect.watcher) {
		effect.watcher.close();
	}
	for (let uuid in effect.emitters) {
		effect.emitters[uuid].delete();
		delete effect.emitters[uuid];
	}
	delete Animator.particle_effects[ref];
}

// Actions
BARS.defineActions(function() {
	new Action('import_particle', {
		icon: 'wand_shine',
		category: 'file',
		condition: () => Project && !Format.image_editor,
		click() {
			Blockbench.import({
				resource_id: 'animation_particle',
				extensions: ['json'],
				type: 'Bedrock Particle',
				multiple: true,
			}, function(files) {
				let valid_files = files.filter(f => {
					let json = autoParseJSON(f.content, {file_path: f.path});
					return json && json.particle_effect;
				});
				if (!valid_files.length) return;
				let affected_before = valid_files.map(f => isApp && f.path && ParticleAsset.all.find(a => a.path === f.path)).filter(a => a);
				Undo.initEdit({particles: affected_before});
				let added = [];
				valid_files.forEach(f => {
					let asset = ParticleAsset.importFromFile(f);
					if (asset) added.safePush(asset);
				});
				Undo.finishEdit('Import particle', {particles: added});
			})
		}
	})
	new Action('import_sound', {
		icon: 'music_note',
		category: 'file',
		condition: () => Project && !Format.image_editor,
		click() {
			Blockbench.import({
				resource_id: 'animation_audio',
				extensions: ['ogg', 'wav', 'mp3'],
				type: 'Audio File',
				readtype: 'binary',
				multiple: true,
			}, function(files) {
				let affected_before = files.map(f => isApp && f.path && SoundAsset.all.find(a => a.path === f.path)).filter(a => a);
				Undo.initEdit({sounds: affected_before});
				let added = [];
				files.forEach(f => {
					let asset = SoundAsset.importFromFile(f);
					if (asset) {
						added.safePush(asset);
						Timeline.visualizeAudioFile(asset.getRef());
					}
				});
				Undo.finishEdit('Import sound', {sounds: added});
			})
		}
	})
})

// Global drag-drop import for audio files (json is excluded to not conflict
// with model import; particles support drop onto the panel instead)
Blockbench.addDragHandler(
	'sound_asset',
	{extensions: ['ogg', 'wav', 'mp3'], propagate: true, readtype: 'binary', condition: () => Project && !Format.image_editor && !Dialog.open},
	function(files) {
		let affected_before = files.map(f => isApp && f.path && SoundAsset.all.find(a => a.path === f.path)).filter(a => a);
		Undo.initEdit({sounds: affected_before});
		let added = [];
		files.forEach(f => {
			let asset = SoundAsset.importFromFile(f);
			if (asset) {
				added.safePush(asset);
				Timeline.visualizeAudioFile(asset.getRef());
			}
		});
		Undo.finishEdit('Import sound', {sounds: added});
	}
)

Interface.definePanels(function() {

	let particle_component = Vue.extend({
		props: {
			particle: ParticleAsset
		},
		methods: {
			getDescription(particle) {
				if (!particle.content) return particle.path || tl('panel.particles.missing_particle');
				return particle.getIdentifier() || particle.path || '';
			},
			handleClick(particle) {
				if (!particle.content) particle.changeFile();
			},
		},
		template: `
			<li
				class="texture particle_asset"
				v-bind:class="{missing: !particle.content}"
				v-bind:texid="particle.uuid"
				:title="particle.content ? '' : tl('panel.particles.missing_particle')"
				@click="handleClick(particle)"
				@contextmenu.prevent.stop="particle.showContextMenu($event)"
				@dblclick="particle.rename()"
			>
				<div class="texture_icon_wrapper particle_texture_slot" :title="tl('menu.particle_asset.change_texture')" @click.stop="particle.changeTexture()">
					<i v-if="!particle.content" class="material-icons particle_missing_icon">error_outline</i>
					<img v-else-if="particle.texture" :src="particle.texture" class="texture_icon" width="48px" alt="" />
					<i v-else class="material-icons particle_texture_slot_empty">image</i>
				</div>
				<div class="texture_description_wrapper">
					<div class="texture_name">{{ particle.name }}</div>
					<div class="texture_res">{{ getDescription(particle) }}</div>
				</div>
				<i v-if="particle.content" class="material-icons texture_save_icon" v-bind:class="{clickable: !particle.saved}" @click.stop="particle.save()">
					<template v-if="particle.saved">check_circle</template>
					<template v-else>save</template>
				</i>
			</li>
		`
	})

	let sound_component = Vue.extend({
		props: {
			sound: SoundAsset
		},
		methods: {
			getDescription(sound) {
				let duration = sound.getDuration();
				return duration ? trimFloatNumber(duration, 2) + 's' : (sound.path || '');
			},
		},
		template: `
			<li
				class="texture sound_asset"
				v-bind:texid="sound.uuid"
				@contextmenu.prevent.stop="sound.showContextMenu($event)"
				@dblclick="sound.rename()"
			>
				<div class="texture_icon_wrapper sound_asset_icon" :title="tl('action.play_animation')" @click.stop="sound.togglePlay()">
					<i class="material-icons">{{ sound.playing ? 'stop' : 'play_arrow' }}</i>
				</div>
				<div class="texture_description_wrapper">
					<div class="texture_name">{{ sound.name }}</div>
					<div class="texture_res">{{ getDescription(sound) }}</div>
				</div>
				<i class="material-icons texture_save_icon" v-bind:class="{clickable: !sound.saved}" @click.stop="sound.save()">
					<template v-if="sound.saved">check_circle</template>
					<template v-else>save</template>
				</i>
			</li>
		`
	})

	function readDroppedFiles(file_list, readtype) {
		return Promise.all(Array.from(file_list).map(file => {
			return new Promise((resolve) => {
				let result = {name: file.name, path: file.path || undefined};
				if (isApp && file.path) {
					try {
						result.content = readtype == 'binary' ? fs.readFileSync(file.path) : fs.readFileSync(file.path, 'utf8');
					} catch (err) {
						console.error(err);
					}
					resolve(result);
				} else {
					let reader = new FileReader();
					reader.onload = () => {
						result.content = reader.result;
						resolve(result);
					};
					reader.onerror = () => resolve(null);
					if (readtype == 'binary') {
						reader.readAsArrayBuffer(file);
					} else {
						reader.readAsText(file);
					}
				}
			})
		})).then(results => results.filter(r => r && r.content !== undefined));
	}

	new Panel('particles', {
		icon: 'wand_shine',
		growable: true,
		resizable: true,
		// 反馈#111：粒子/声音面板只在动画模式出现
		condition: {modes: ['animate'], method: () => !Format.image_editor},
		default_position: {
			slot: 'left_bar',
			float_position: [0, 0],
			float_size: [300, 300],
			height: 300,
			sidebar_index: 5,
		},
		toolbars: [
			new Toolbar('particle_asset_list', {
				children: ['import_particle']
			})
		],
		component: {
			name: 'panel-particles',
			data() { return {
				particles: ParticleAsset.all,
			}},
			components: {ParticleAsset: particle_component},
			methods: {
				openMenu(event) {
					Interface.Panels.particles.menu.show(event)
				},
				handleDrop(event) {
					if (!event.dataTransfer?.files?.length) return;
					readDroppedFiles(event.dataTransfer.files, 'text').then(files => {
						let valid_files = files.filter(f => {
							let json = autoParseJSON(f.content, {file_path: f.path});
							return json && json.particle_effect;
						});
						if (!valid_files.length) return;
						let affected_before = valid_files.map(f => f.path && ParticleAsset.all.find(a => a.path === f.path)).filter(a => a);
						Undo.initEdit({particles: affected_before});
						let added = [];
						valid_files.forEach(f => {
							let asset = ParticleAsset.importFromFile(f);
							if (asset) added.safePush(asset);
						});
						Undo.finishEdit('Import particle', {particles: added});
					})
				}
			},
			template: `
				<div @drop.stop.prevent="handleDrop($event)" @dragover.stop.prevent>
					<ul class="list mobile_scrollbar" @contextmenu.stop.prevent="openMenu($event)">
						<ParticleAsset
							v-for="particle in particles"
							:key="particle.uuid"
							:particle="particle"
						></ParticleAsset>
					</ul>
				</div>
			`
		},
		menu: new Menu([
			'import_particle',
		])
	})

	new Panel('sounds', {
		icon: 'music_note',
		growable: true,
		resizable: true,
		// 反馈#111：粒子/声音面板只在动画模式出现，默认与粒子面板合并为一组卡片
		condition: {modes: ['animate'], method: () => !Format.image_editor},
		default_position: {
			slot: 'left_bar',
			float_position: [0, 0],
			float_size: [300, 300],
			height: 300,
			sidebar_index: 6,
			attached_to: 'particles',
		},
		toolbars: [
			new Toolbar('sound_asset_list', {
				children: ['import_sound']
			})
		],
		component: {
			name: 'panel-sounds',
			data() { return {
				sounds: SoundAsset.all,
			}},
			components: {SoundAsset: sound_component},
			methods: {
				openMenu(event) {
					Interface.Panels.sounds.menu.show(event)
				},
				handleDrop(event) {
					if (!event.dataTransfer?.files?.length) return;
					readDroppedFiles(event.dataTransfer.files, 'binary').then(files => {
						let affected_before = files.map(f => f.path && SoundAsset.all.find(a => a.path === f.path)).filter(a => a);
						Undo.initEdit({sounds: affected_before});
						let added = [];
						files.forEach(f => {
							let asset = SoundAsset.importFromFile(f);
							if (asset) {
								added.safePush(asset);
								Timeline.visualizeAudioFile(asset.getRef());
							}
						});
						Undo.finishEdit('Import sound', {sounds: added});
					})
				}
			},
			template: `
				<div @drop.stop.prevent="handleDrop($event)" @dragover.stop.prevent>
					<ul class="list mobile_scrollbar" @contextmenu.stop.prevent="openMenu($event)">
						<SoundAsset
							v-for="sound in sounds"
							:key="sound.uuid"
							:sound="sound"
						></SoundAsset>
					</ul>
				</div>
			`
		},
		menu: new Menu([
			'import_sound',
		])
	})
})

Object.assign(window, {
	ParticleAsset,
	SoundAsset,
});
