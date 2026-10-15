import Wintersky from 'wintersky';
import { openMolangEditor } from './molang_editor';
import { clipboard, currentwindow, dialog, fs, ipcRenderer } from '../native_apis';
import { Filesystem } from '../file_system';
import { Easings } from '../lib/easing';
import { markerColors } from '../marker_colors';

export class AnimationControllerState {
	constructor(controller, data = 0) {
		this.controller = controller;
		this.uuid = guid();
		this.transitions = [];
		this.animations = [];

		for (let key in AnimationControllerState.properties) {
			AnimationControllerState.properties[key].reset(this);
		}

		this.folded = false;
		this.fold = {
			animations: false,
			particles: true,
			sounds: true,
			on_entry: true,
			on_exit: true,
			transitions: true,
		};
		this.muted = {
			sound: false,
			particle: false,
		}
		this.playing_sounds = [];
		// 2D canvas position ({x, y}); null = automatic layout. Saved with the project via getUndoCopy/extend.
		// Moving a node is not an undoable edit by itself; positions ride along with other undo snapshots.
		this.position = null;

		if (data) {
			this.extend(data);
		}
		this.controller.states.safePush(this);
	}
	extend(data = 0) {
		// #97：Bedrock 文件中 on_entry/on_exit 是字符串数组；先合并为多行字符串，避免 Property.merge 按逗号拼成一行
		if (data && typeof data == 'object') {
			for (let key of ['on_entry', 'on_exit']) {
				if (data[key] instanceof Array) {
					data = {...data, [key]: data[key].join('\n')};
				}
			}
		}
		for (let key in AnimationControllerState.properties) {
			if (AnimationControllerState.properties[key].type == 'array') continue;
			AnimationControllerState.properties[key].merge(this, data)
		}
		if (typeof data.blend_transition_curve == 'object') {
			this.blend_transition_curve = {};
			for (let key in data.blend_transition_curve) {
				this.blend_transition_curve[key] = data.blend_transition_curve[key];
			}
		}
		if (data.animations instanceof Array) {
			let previous_animations = this.animations.slice();
			this.animations.empty();
			data.animations.forEach(a => {
				let animation = previous_animations.find(a1 => a1.uuid == a.uuid) ?? {
					uuid: guid(),
					key: '',
					animation: '',
					blend_value: ''
				};
				if (typeof a == 'object' && typeof a.uuid == 'string' && a.uuid.length == 36) {
					// Internal
					Object.assign(animation, a);
				} else if (typeof a == 'object' || typeof a == 'string') {
					// Bedrock
					let key = typeof a == 'object' ? Object.keys(a)[0] : a;
					let anim_match = Animation.all.find(anim => anim.getShortName() == key);
					Object.assign(animation, {
						key: key || '',
						animation: anim_match ? anim_match.uuid : '',// UUID
						blend_value: (typeof a == 'object' && a[key]) || ''
					});
				}
				this.animations.push(animation);
			})
		}
		if (data.transitions instanceof Array) {
			let previous_transitions = this.transitions.slice();
			this.transitions.empty();
			data.transitions.forEach(a => {
				let transition = previous_transitions.find(t1 => t1.uuid == a.uuid) ?? {
					uuid: guid(),
					target: '',
					condition: ''
				};
				this.transitions.push(transition);
				if (typeof a == 'object' && typeof a.uuid == 'string' && a.uuid.length == 36) {
					// Internal. Defaults first so keys absent from the snapshot (e.g. curvature before it was introduced) do not linger.
					Object.assign(transition, {target: '', condition: '', curvature: 0}, a);
				} else if (typeof a == 'object') {
					// Bedrock
					let key = Object.keys(a)[0];
					let state_match = this.controller.states.find(state => state !== this && state.name == key);
					Object.assign(transition, {
						target: state_match ? state_match.uuid : '',
						condition: a[key] || ''
					});
					if (!state_match) {
						setTimeout(() => {
							// Delay to after loading controller so that all states can be found
							let state_match = this.controller.states.find(state => state !== this && state.name == key);
							if (state_match) {
								let updated_transition = this.transitions.find(t => t.uuid == transition.uuid) ?? transitions;
								updated_transition.target = state_match.uuid;
							}
						}, 0);
					}
				}
			})
		}
		if (data.particles instanceof Array) {
			this.particles.empty();
			data.particles.forEach(particle => {
				this.particles.push(JSON.parse(JSON.stringify(particle)));
			})
		}
		if (data.sounds instanceof Array) {
			this.sounds.empty();
			data.sounds.forEach(sound => {
				this.sounds.push(JSON.parse(JSON.stringify(sound)));
			})
		}
		// From Bedrock
		if (data.particle_effects instanceof Array) {
			this.particles.empty();
			data.particle_effects.forEach(effect => {
				let particle = {
					uuid: guid(),
					effect: effect.effect || '',
					locator: effect.locator || '',
					bind_to_actor: effect.bind_to_actor !== false,
					pre_effect_script: effect.pre_effect_script || '',
					file: '',
				};
				this.particles.push(particle);
			})
		}
		if (data.sound_effects instanceof Array) {
			this.sounds.empty();
			data.sound_effects.forEach(effect => {
				let sound = {
					uuid: guid(),
					effect: effect.effect || '',
					file: '',
				};
				this.sounds.push(sound);
			})
		}
		if (typeof data.blend_transition == 'object') {
			this.blend_transition_curve = {};
			this.blend_transition = Math.max(...Object.keys(data.blend_transition).map(time => parseFloat(time)));
			for (let key in data.blend_transition) {
				let timecode = parseFloat(key) / this.blend_transition;
				this.blend_transition_curve[timecode] = data.blend_transition[key];
			}
		}
		if ('position' in data) {
			let p = data.position;
			this.position = (p && typeof p.x == 'number' && typeof p.y == 'number' && isFinite(p.x) && isFinite(p.y))
				? {x: p.x, y: p.y}
				: null;
		}
	}
	getUndoCopy() {
		var copy = {
			uuid: this.uuid,
			name: this.name,
		}
		for (let key in AnimationControllerState.properties) {
			let property = AnimationControllerState.properties[key];
			if (property.type == 'array') {
				// #112：直接深拷贝数组，避免 Property.copy 在 focus 时替换活跃数组元素导致输入框被重渲染失焦
				copy[key] = JSON.parse(JSON.stringify(this[key]));
			} else {
				property.copy(this, copy)
			}
		}
		copy.position = this.position ? {x: this.position.x, y: this.position.y} : null;
		return copy;
	}
	compileForBedrock() {
		let object = {};
		if (this.animations.length) {
			object.animations = this.animations.map(animation => {
				return animation.blend_value.trim()
					? new oneLiner({[animation.key]: animation.blend_value.trim()})
					: animation.key;
			})
		}
		['on_entry', 'on_exit'].forEach(type => {
			if (!this[type] || this[type] == '\n') return;
			let lines = this[type].split('\n');
			lines = lines.filter(script => !!script.replace(/[\n\s;.]+/g, ''));
			lines = lines.map(line => (line.match(/;\s*$/) || line.startsWith('/')) ? line : (line+';'));
			object[type] = lines;
		})
		if (this.particles.length) {
			object.particle_effects = this.particles.map(particle => {
				return {
					effect: particle.effect || '',
					locator: particle.locator || undefined,
					bind_to_actor: particle.bind_to_actor ? undefined : false,
					pre_effect_script: particle.pre_effect_script || undefined
				}
			})
		}
		if (this.sounds.length) {
			object.sound_effects = this.sounds.map(sound => {
				return new oneLiner({
					effect: sound.effect || ''
				});
			})
		}
		if (this.transitions.length) {
			object.transitions = this.transitions.map(transition => {
				let state = this.controller.states.find(s => s.uuid == transition.target);
				let condition = transition.condition.replace(/\n/g, '');
				return new oneLiner({[state ? state.name : 'missing_state']: condition})
			})
		}
		if (this.blend_transition) {
			object.blend_transition = this.blend_transition;
			let curve_keys = this.blend_transition_curve && Object.keys(this.blend_transition_curve);
			if (curve_keys?.length) {
				let curve_output = {};
				let points = curve_keys.map(key => ({time: parseFloat(key), value: this.blend_transition_curve[key]}));
				points.sort((a, b) => a.time - b.time);
				for (let point of points) {
					let timecode = trimFloatNumber(point.time * this.blend_transition, 4).toString();
					if (!timecode.includes('.')) timecode += '.0';
					curve_output[timecode] = Math.roundTo(point.value, 6);
				}
				object.blend_transition = curve_output;
			}
			if (this.blend_via_shortest_path) object.blend_via_shortest_path = this.blend_via_shortest_path;
		}
		Blockbench.dispatchEvent('compile_bedrock_animation_controller_state', {state: this, json: object});
		return object;
	}
	select(force) {
		if (this.controller.selected_state !== this || force) {
			this.controller.last_state = this.controller.selected_state;
			this.controller.transition_timestamp = performance.now();
			this.start_timestamp = performance.now();

			this.controller.selected_state = this;

			if (this.controller.last_state) this.controller.last_state.unselect();
			Animator.MolangParser.parse(this.on_entry);

			this.playEffects()
			Blockbench.dispatchEvent('select_animation_controller_state', {state: this});
		}
		return this;
	}
	unselect() {
		Animator.MolangParser.parse(this.on_exit);
		this.playing_sounds.forEach(media => {
			if (!media.paused) {
				media.pause();
			}
		})
		this.playing_sounds.empty();
	}
	playEffects() {
		if (!this.muted.sound) {
			this.sounds.forEach(sound => {
				if (sound.file && !sound.cooldown) {
					var media = new Audio(SoundAsset.resolvePlaybackSource(sound.file));
					media.playbackRate = Math.clamp(AnimationController.playback_speed/100, 0.1, 4.0);
					media.volume = Math.clamp(settings.volume.value/100, 0, 1);
					media.play().catch(() => {});
					this.playing_sounds.push(media);
					media.onended = () => {
						this.playing_sounds.remove(media);
					}

					sound.cooldown = true;
					setTimeout(() => {
						delete sound.cooldown;
					}, 400)
				}
			})
		}
		
		if (!this.muted.particle) {
			this.particles.forEach((particle) => {
				let particle_effect = particle.file && Animator.particle_effects[particle.file]
				if (particle_effect) {

					let emitter = particle_effect.emitters[particle.uuid];
					if (!emitter) {
						emitter = particle_effect.emitters[particle.uuid] = new Wintersky.Emitter(WinterskyScene, particle_effect.config);

						let old_variable_handler = emitter.Molang.variableHandler;
						emitter.Molang.variableHandler = (key, params) => {
							let curve_result = old_variable_handler.call(emitter, key, params);
							if (curve_result !== undefined) return curve_result;
							return Animator.MolangParser.variableHandler(key);
						}
					}
					emitter.Molang.parse(particle.pre_effect_script, Animator.MolangParser.global_variables);

					let locator = particle.locator && Locator.all.find(l => l.name == particle.locator)
					if (locator) {
						locator.mesh.add(emitter.local_space);
						emitter.parent_mode = 'locator';
					} else {
						emitter.parent_mode = 'entity';
					}
					emitter.stopLoop().playLoop();
				}
			})
		}
	}
	scrollTo() {
		let vue = Panels.animation_controllers && Panels.animation_controllers.inside_vue;
		if (vue) vue.panToState(this);
		return this;
	}
	rename() {
		Blockbench.textPrompt('generic.rename', this.name, value => {
			Undo.initEdit({animation_controller_state: this});
			this.name = value;
			this.createUniqueName();
			Undo.finishEdit('Rename animation controller state');
		})
		return this;
	}
	remove(undo) {
		if (undo) {
			Undo.initEdit({animation_controllers: [this.controller]});
		}
		this.controller.states.forEach(state => {
			state.transitions.forEach(transition => {
				if (transition.target == this.uuid) transition.target = '';
			})
		})
		this.controller.states.remove(this);
		if (this.controller.selected_state == this) this.controller.selected_state = null;
		if (undo) {
			Undo.finishEdit('Remove animation controller state');
		}
	}
	createUniqueName() {
		let scope = this;
		let others = this.controller.states;
		let name = this.name.replace(/\d+$/, '');
		function check(n) {
			for (let i = 0; i < others.length; i++) {
				if (others[i] !== scope && others[i].name == n) return false;
			}
			return true;
		}
		if (check(this.name)) {
			return this.name;
		}
		for (let num = 2; num < 8e3; num++) {
			if (check(name+num)) {
				scope.name = name+num;
				return scope.name;
			}
		}
		return false;
	}
	addAnimation(animation) {
		Undo.initEdit({animation_controller_state: this});
		let anim_link = {
			uuid: guid(),
			key: animation ? animation.getShortName() : '',
			animation: animation ? animation.uuid : '',
			blend_value: ''
		};
		this.animations.push(anim_link);
		this.fold.animations = false;
		Blockbench.dispatchEvent('add_animation_controller_animation', {state: this});
		Undo.finishEdit('Add animation to animation controller state');
	}
	addTransition(target = '') {
		Undo.initEdit({animation_controller_state: this});
		let transition = {
			uuid: guid(),
			target, // UUID
			condition: ''
		};
		this.transitions.push(transition);
		this.fold.transitions = false;
		Blockbench.dispatchEvent('add_animation_controller_transition', {state: this});
		Undo.finishEdit('Add transition to animation controller state');

		Vue.nextTick(() => {
			let node = document.querySelector(`.controller_state[uuid="${this.uuid}"] .controller_transition:last-child pre`);
			if (node) {
				$(node).trigger('focus');
			}
		})
	}
	addParticle(options = 0) {
		Undo.initEdit({animation_controller_state: this});
		let particle = {
			uuid: guid(),
			effect: options.effect || '',
			bind_to_actor: true,
			locator: '',
			pre_effect_script: '',
			file: '',
		};
		this.particles.push(particle);
		this.fold.particles = false;
		Blockbench.dispatchEvent('add_animation_controller_particle', {state: this});
		Undo.finishEdit('Add particle to animation controller state');

		Vue.nextTick(() => {
			let node = document.querySelector(`.controller_state[uuid="${this.uuid}"] .controller_particle input[type="text"]`);
			if (node) {
				$(node).trigger('focus');
			}
		})
	}
	addSound(options = 0) {
		Undo.initEdit({animation_controller_state: this});
		let sound = {
			uuid: guid(),
			effect: options.effect || '',
			file: options.file || '',
		};
		this.sounds.push(sound);
		this.fold.sounds = false;
		Blockbench.dispatchEvent('add_animation_controller_sound', {state: this});
		Undo.finishEdit('Add sound to animation controller state');

		Vue.nextTick(() => {
			let node = document.querySelector(`.controller_state[uuid="${this.uuid}"] .controller_sound input[type="text"]`);
			if (node) {
				$(node).trigger('focus');
			}
		})
	}
	calculateBlendValue(blend_progress) {
		if (!this.blend_transition_curve || Object.keys(this.blend_transition_curve).length < 2) {
			return blend_progress;
		}
		let time = blend_progress;
		let keys = Object.keys(this.blend_transition_curve);
		let values = keys.map(key => this.blend_transition_curve[key]);
		let times = keys.map(v => parseFloat(v));
		let prev_time = -Infinity, prev = null;
		let next_time = Infinity, next = null;
		let i = 0;
		for (let t of times) {
			if (t <= time && t > prev_time) {
				prev = i; prev_time = t;
			}
			if (t >= time && t < next_time) {
				next = i; next_time = t;
			}
			i++;
		}
		if (prev === null) return 1 - values[next];
		if (next === null || prev == next) return 1 - values[prev];
		let two_point_blend = Math.getLerp(prev_time, next_time, time) || 0;
		return 1 - Math.lerp(values[prev], values[next], two_point_blend);
	}
	editTransitionCurve() {
		let state = this;
		let duration = this.blend_transition;
		let points = [];
		for (let key in this.blend_transition_curve) {
			key = parseFloat(key);
			points.push({
				uuid: guid(),
				time: key,
				value: this.blend_transition_curve[key]
			})
		}
		if (!points.length) {
			points.push({time: 0, value: 1, uuid: guid()});
			points.push({time: 1, value: 0, uuid: guid()});
		}

		let preview_loop = setInterval(() => {
			dialog.content_vue.preview();
		}, 1000 / 60);
		let preview_loop_start_time = performance.now();

		let dialog = new Dialog('blend_transition_edit', {
			title: 'animation_controllers.state.blend_transition_curve',
			width: 478,
			keyboard_actions: {
				copy: {
					keybind: new Keybind({key: 'c', ctrl: true}),
					run() {
						this.content_vue.copy();
					}
				},
				paste: {
					keybind: new Keybind({key: 'v', ctrl: true}),
					run() {
						this.content_vue.paste();
					}
				}
			},
			form: {
				duration: {
					label: 'animation_controllers.state.blend_transition',
					value: duration,
					min: 0.05,
					step: 0.05,
					type: 'number',
				},
				extended_graph: {
					label: 'dialog.blend_transition_edit.extended',
					value: false,
					type: 'checkbox',
				},
				buttons: {
					type: 'buttons', buttons: [
						'generic.reset',
						tl('dialog.blend_transition_edit.ease_in_out', [6]),
						tl('dialog.blend_transition_edit.ease_in_out', [10]),
						'dialog.blend_transition_edit.generate',
					],
					click(index) {
						function generate(easing, point_amount) {
							points.empty();
							for (let i = 0; i < point_amount; i++) {
								let time = i / (point_amount-1);
								points.push({time, value: 1-easing(time), uuid: guid()})
							}
							dialog.content_vue.updateGraph();
						}
						if (index == 3) {
							let easings = {
								easeInSine: 'In Sine',
								easeOutSine: 'Out Sine',
								easeInOutSine: 'In Out Sine',
								easeInQuad: 'In Quad',
								easeOutQuad: 'Out Quad',
								easeInOutQuad: 'In Out Quad',
								easeInCubic: 'In Cubic',
								easeOutCubic: 'Out Cubic',
								easeInOutCubic: 'In Out Cubic',
								easeInQuart: 'In Quart',
								easeOutQuart: 'Out Quart',
								easeInOutQuart: 'In Out Quart',
								easeInQuint: 'In Quint',
								easeOutQuint: 'Out Quint',
								easeInOutQuint: 'In Out Quint',
								easeInExpo: 'In Expo',
								easeOutExpo: 'Out Expo',
								easeInOutExpo: 'In Out Expo',
								easeInCirc: 'In Circ',
								easeOutCirc: 'Out Circ',
								easeInOutCirc: 'In Out Circ',
								easeInBack: 'In Back',
								easeOutBack: 'Out Back',
								easeInOutBack: 'In Out Back',
								easeInElastic: 'In Elastic',
								easeOutElastic: 'Out Elastic',
								easeInOutElastic: 'In Out Elastic',
								easeOutBounce: 'Out Bounce',
								easeInBounce: 'In Bounce',
								easeInOutBounce: 'In Out Bounce',
							};
							let initial_points = points.slice();
							new Dialog('blend_transition_edit_easing', {
								title: 'dialog.blend_transition_edit.generate',
								width: 380,
								form: {
									easings: {type: 'info', text: tl('dialog.blend_transition_edit.generate.learn_more') + ': [easings.net](https://easings.net)'},
									curve: {type: 'select', label: 'dialog.blend_transition_edit.generate.curve', options: easings},
									steps: {type: 'number', label: 'dialog.blend_transition_edit.generate.steps', value: 10, step: 1, min: 3, max: 64}
								},
								onFormChange(result) {
									generate(Easings[result.curve], result.steps);
								},
								onConfirm(result) {
									generate(Easings[result.curve], result.steps);
								},
								onCancel() {
									points.replace(initial_points);
									dialog.content_vue.updateGraph();
								}
							}).show();

						} else {
							let point_amount = ([2, 6, 10])[index];
							function hermiteBlend(t) {
								return 3*(t**2) - 2*(t**3);
							}
							generate(hermiteBlend, point_amount);
						}

					}
				}
			},
			component: {
				data() {return {
					duration,
					points,
					graph_data: '',
					zero_line: '',
					preview_value: 0,
					width: Math.min(400, window.innerWidth - 42),
					height: 220,
					scale_y: 220
				}},
				methods: {
					dragPoint(point, e1) {
						let scope = this;
						let original_time = point.time;
						let original_value = point.value;
						let scale_y = this.scale_y;
						
						let drag = (e2) => {
							point.time = original_time + (e2.clientX - e1.clientX) / this.width;
							point.value = original_value - (e2.clientY - e1.clientY) / scale_y;
							point.time = Math.clamp(point.time, 0, 1);
							let limits = (this.scale_y > 188) ? [0, 1] : [-1, 2];
							point.value = Math.clamp(point.value, ...limits);
							Blockbench.setCursorTooltip(`${Math.roundTo(point.time * this.duration, 4)} x ${Math.roundTo(point.value, 4)}`);

							scope.updateGraph();
						}
						let stop = () => {
							removeEventListeners(document, 'mousemove touchmove', drag);
							removeEventListeners(document, 'mouseup touchend', stop);
							Blockbench.setCursorTooltip();
						}
						addEventListeners(document, 'mousemove touchmove', drag);
						addEventListeners(document, 'mouseup touchend', stop);
					},
					createNewPoint(event) {
						if (event.target.id !== 'blend_transition_graph' || event.which == 3) return;
						let offset_y = (this.height - this.scale_y) / 2;
						let point = {
							uuid: guid(),
							time: (event.offsetX - 5) / this.width,
							value: 1 - ((event.offsetY - 5 - offset_y) / this.scale_y),
						}
						this.points.push(point);
						this.updateGraph();
						this.dragPoint(point, event);
					},
					copy() {
						let copy = points.map(p => ({time: p.time, value: p.value}));
						Clipbench.setText(JSON.stringify(copy));
					},
					async paste() {
						let input;
						if (isApp) {
							input = clipboard.readText();
						} else {
							input = await navigator.clipboard.readText();
						}
						if (!input) return;
						try {
							let parsed = JSON.parse(input);
							if (!(parsed instanceof Array)) return;
							points.empty();
							for (let point_data of parsed) {
								let point = {
									uuid: guid(),
									time: point_data.time ?? 0,
									value: point_data.value ?? 0,
								}
								points.push(point);
							}
							this.updateGraph();

						} catch (err) {}
					},
					contextMenu(event) {
						new Menu([
							{
								id: 'copy',
								name: 'action.copy',
								icon: 'fa-copy',
								click: () => {
									this.copy();
								}
							}, {
								id: 'paste',
								name: 'action.paste',
								icon: 'fa-clipboard',
								click: () => {
									this.paste();
								}
							}
						]).open(event);
					},
					pointContextMenu(point, event) {
						new Menu([{
							id: 'remove',
							name: 'generic.remove',
							icon: 'clear',
							click: () => {
								points.remove(point);
								this.updateGraph();
							}
						}]).open(event.target);
					},
					scaleY() {
						let max_offset = 0;
						for (let point of points) {
							max_offset = Math.max(max_offset, -point.value, point.value-1);
						}
						return max_offset > 0.01 ? 90 : this.height;
					},
					updateGraph() {
						if (!this.points.length) {
							this.graph_data = '';
							return;
						}
						let offset = 5;
						let offset_y = 5 + (this.height - this.scale_y) / 2;
						this.points.sort((a, b) => a.time - b.time);
						let graph_data = `M${0} ${(1-this.points[0].value) * this.scale_y + offset_y} `;
						for (let point of this.points) {
							graph_data += `${graph_data ? 'L' : 'M'}${point.time * this.width + offset} ${(1-point.value) * this.scale_y + offset_y} `;
						}
						graph_data += `L${this.width + 10} ${(1-points.last().value) * this.scale_y + offset_y} `;
						this.graph_data = graph_data;

						this.zero_line = `M0 ${offset_y} L${this.width} ${offset_y} M0 ${offset_y + this.scale_y} L${this.width} ${offset_y + this.scale_y}`;
					},
					preview() {
						if (this.points.length == 0) return 0;
						let pause = 0.4;
						let absolute_time = ((performance.now() - preview_loop_start_time) / 1000);
						let time = (absolute_time % (this.duration + pause)) / this.duration;
						if (time > 1) {
							this.preview_value = 0;
							return;
						}
						let prev_time = -Infinity, prev = 0;
						let next_time = Infinity, next = 0;
						for (let pt of points) {
							if (pt.time <= time && pt.time > prev_time) {
								prev = pt; prev_time = pt.time;
							}
							if (pt.time >= time && pt.time < next_time) {
								next = pt; next_time = pt.time;
							}
						}
						if (!prev) return next.value;
						if (!next) return prev.value;
						let two_point_blend = Math.getLerp(prev_time, next_time, time);
						this.preview_value = Math.lerp(prev.value, next.value, two_point_blend);
					}
				},
				template: `
					<div class="blend_transition_graph_wrapper" @contextmenu="contextMenu($event)">
						<div id="blend_transition_graph"
							@mousedown="createNewPoint($event)"
							@touchstart="createNewPoint($event)"
							:style="{height: (height+10) + 'px', width: (width+10) + 'px'}"
						>
							<svg>+
								<path :d="graph_data" />
								<path :d="zero_line" class="zero_lines" />
							</svg>
							<div class="blend_transition_graph_point"
								v-for="point in points" :key="point.uuid"
								:style="{left: point.time * width + 'px', top: ( (1-point.value) * scale_y + (height-scale_y)/2 ) + 'px'}"
								@mousedown="dragPoint(point, $event)" @touchstart="dragPoint(point, $event)"
								@contextmenu.stop="pointContextMenu(point, $event)"
							></div>
						</div>
						<div class="blend_transition_preview" :style="{'--progress': scale_y > 200 ? preview_value : (1+preview_value) / 3}">
							<div />
						</div>
					</div>
				`,
				mounted() {
					this.updateGraph();
				}
			},
			onFormChange(result) {
				this.content_vue.duration = result.duration;
				this.content_vue.scale_y = result.extended_graph ? 220 / 3 : 220;
				this.content_vue.updateGraph();
			},
			onConfirm(result) {
				clearInterval(preview_loop);
				Undo.initEdit({animation_controller_state: state});
				state.blend_transition = result.duration;
				state.blend_transition_curve = {};
				let is_linear = points.length == 2 && points.find(p => p.time == 0 && p.value == 1) && points.find(p => p.time == 1 && p.value == 0);
				if (!is_linear) {
					for (let point of points) {
						state.blend_transition_curve[Math.clamp(point.time, 0, 1)] = point.value;
					}
				}
				Undo.finishEdit('Change blend transition curve');
			},
			onCancel() {
				clearInterval(preview_loop);
			}
		});
		dialog.show();
	}
	openMenu(event) {
		if (getFocusedTextInput()) return;
		AnimationControllerState.prototype.menu.open(event, this);
	}
	getStateTime() {
		if (!this.start_timestamp) return 0;
		return (performance.now() - this.start_timestamp) / 1000 * (AnimationController.playback_speed / 100);
	}
}
new Property(AnimationControllerState, 'string', 'name', {default: 'default'});
new Property(AnimationControllerState, 'array', 'animations');
new Property(AnimationControllerState, 'array', 'transitions');
new Property(AnimationControllerState, 'array', 'sounds');
new Property(AnimationControllerState, 'array', 'particles');
new Property(AnimationControllerState, 'string', 'on_entry');
new Property(AnimationControllerState, 'string', 'on_exit');
new Property(AnimationControllerState, 'number', 'blend_transition');
new Property(AnimationControllerState, 'object', 'blend_transition_curve');
new Property(AnimationControllerState, 'boolean', 'blend_via_shortest_path');
AnimationControllerState.prototype.menu = new Menu([
	{
		id: 'set_as_initial_state',
		name: 'Initial State',
		icon: (state) => (state.uuid == AnimationController.selected?.initial_state ? 'far.fa-dot-circle' : 'far.fa-circle'),
		click(state) {
			if (!AnimationController.selected) return;
			Undo.initEdit({animation_controllers: [AnimationController.selected]});
			AnimationController.selected.initial_state = state.uuid;
			Undo.finishEdit('Change animation controller initial state');
		}
	},
	new MenuSeparator('manage'),
	{
		id: 'add_transition',
		name: 'animation_controllers.state.add_transition',
		icon: 'login',
		searchable: true,
		children(state) {
			let list = [];
			state.controller?.states.forEach(state2 => {
				if (state2 == state || state.transitions.find(t => t.target == state2.uuid)) return;
				list.push({
					name: state2.name,
					icon: 'login',
					click: () => state.addTransition(state2.uuid)
				})
			})
			if (!list.length) {
				list.push({
					name: 'generic.unset',
					icon: 'remove',
					click: () => state.addTransition()
				})
			}
			return list;
		}
	},
	'duplicate',
	'rename',
	'delete',
]);

export class AnimationController extends AnimationItem {
	constructor(data) {
		super(data);
		this.name = '';
		this.uuid = guid()
		this.playing = false;
		this.selected = false;
		this.multi_selected = false;
		this.states = [];
		this.selected_state = null;

		for (let key in AnimationController.properties) {
			AnimationController.properties[key].reset(this);
		}
		if (typeof data === 'object') {
			this.extend(data);
			if (isApp && Format.animation_files && data.saved_name) {
				this.saved_name = data.saved_name;
			}
		}
	}
	extend(data) {
		for (let key in AnimationController.properties) {
			AnimationController.properties[key].merge(this, data)
		}
		Merge.string(this, data, 'name')

		if (data.states instanceof Array) {
			let old_states = this.states.splice(0, this.states.length);
			data.states.forEach(template => {
				let state = old_states.find(state2 => state2.name === template.name || (template.uuid && state2.uuid === template.uuid));
				if (state) {
					state.extend(template);
					if (template.uuid) state.uuid = template.uuid;
					this.states.push(state);
				} else {
					state = new AnimationControllerState(this, template);
					if (template.uuid) state.uuid = template.uuid;
				}
			})
		} else if (typeof data.states === 'object') {
			for (let name in data.states) {
				let state = this.states.find(state2 => state2.name === name);
				if (state) {
					state.extend(data.states[name]);
				} else {
					state = new AnimationControllerState(this, data.states[name]);
				}
				state.name = name;
			}
		}
		if (typeof data.initial_state == 'string') {
			if (data.initial_state.length == 36) {
				this.initial_state = data.initial_state;
			} else {
				this.initial_state = this.states.find(s => s.name == data.initial_state)?.uuid || '';
			}
		}
		if (typeof data.selected_state == 'string') {
			let state = this.states.find(s => s.uuid == data.selected_state);
			if (state) this.selected_state = state;
		}
		if (data.states) {
			this.states.forEach(state => state.createUniqueName());
		}
		return this;
	}
	getUndoCopy(options = 0, save) {
		var copy = {
			uuid: this.uuid,
			type: 'animation_controller',
			name: this.name,
			selected: this.selected,
			selected_state: this.selected_state ? this.selected_state.uuid : null
		}
		for (let key in AnimationController.properties) {
			AnimationController.properties[key].copy(this, copy);
		}
		copy.states = this.states.map(state => {
			return state.getUndoCopy();
		})
		return copy;
	}
	compileForBedrock() {
		let object = {};
		if (!this.states.length) return object;

		let initial_state = this.states.find(s => s.uuid == this.initial_state) || this.states[0];
		if (initial_state.name !== 'default') object.initial_state = initial_state.name;

		object.states = {};
		this.states.forEach(state => {
			object.states[state.name] = state.compileForBedrock();
		})

		Blockbench.dispatchEvent('compile_bedrock_animation_controller', {animation_controller: this, json: object});

		return object;
	}
	save() {
		if (isApp && !this.path) {
			Blockbench.export({
				resource_id: 'animation_controller',
				type: 'JSON Animation Controller',
				extensions: ['json'],
				name: (Project.geometry_name||'model')+'.animation_controllers',
				startpath: this.path,
				custom_writer: (content, path) => {
					if (!path) return
					this.path = path;
					this.save();
				}
			})
			return;
		}
		let content = {
			format_version: '1.19.0',
			animation_controllers: {
				[this.name]: this.compileForBedrock()
			}
		}
		if (isApp && this.path) {
			if (fs.existsSync(this.path)) {
				//overwrite path
				let data;
				try {
					data = fs.readFileSync(this.path, 'utf-8');
					data = autoParseJSON(data, false);
					if (typeof data.animation_controllers !== 'object') {
						throw 'Incompatible format'
					}

				} catch (err) {
					data = null;
					var answer = dialog.showMessageBoxSync(currentwindow, {
						type: 'warning',
						buttons: [
							tl('message.bedrock_overwrite_error.overwrite'),
							tl('dialog.cancel')
						],
						title: 'Blockbench',
						message: tl('message.bedrock_overwrite_error.message'),
						detail: err+'',
						noLink: false
					})
					if (answer === 1) {
						return;
					}
				}
				if (data) {
					let animation = content.animation_controllers[this.name];
					content = data;
					if (this.saved_name && this.saved_name !== this.name) delete content.animation_controllers[this.saved_name];
					content.animation_controllers[this.name] = animation;

					// Improve JSON formatting
					for (let key in data.animation_controllers) {
						let controller = data.animation_controllers[key];
						if (typeof controller.states == 'object') {
							for (let state_name in controller.states) {
								let state = controller.states[state_name];
								if (state.animations instanceof Array) {
									state.animations.forEach((a, i) => {
										if (typeof a == 'object') state.animations[i] = new oneLiner(a);
									})
								}
								if (state.transitions instanceof Array) {
									state.transitions.forEach((t, i) => {
										if (typeof t == 'object') state.transitions[i] = new oneLiner(t);
									})
								}
							}
						}
					}

					// Sort
					let file_keys = Object.keys(content.animation_controllers);
					let anim_keys = Animation.all.filter(anim => anim.path == this.path).map(anim => anim.name);
					let changes = false;
					let index = 0;

					anim_keys.forEach(key => {
						let key_index = file_keys.indexOf(key);
						if (key_index == -1) {
							//Skip
						} else if (key_index < index) {
							file_keys.splice(key_index, 1);
							file_keys.splice(index, 0, key);
							changes = true;

						} else {
							index = key_index;
						}
					})
					if (changes) {
						let sorted_animation_controllers = {};
						file_keys.forEach(key => {
							sorted_animation_controllers[key] = content.animation_controllers[key];
						})
						content.animation_controllers = sorted_animation_controllers;
					}
				}
			}
			// Write
			Blockbench.writeFile(this.path, {content: compileJSON(content)}, (real_path) => {
				this.saved = true;
				this.saved_name = this.name;
				this.path = real_path;
			});

		} else {
			// Web Download
			Blockbench.export({
				resource_id: 'animation',
				type: 'JSON Animation',
				extensions: ['json'],
				name: (Project.geometry_name||'model')+'.animation',
				startpath: this.path,
				content: compileJSON(content),
			}, (real_path) => {
				this.path == real_path;
				this.saved = true;
			})
		}
		return this;
	}
	select() {
		if (this == AnimationController.selected) return;
		if (Timeline.playing) Timeline.pause()
		AnimationItem.all.forEach((a) => {
			a.selected = false;
			if (a.playing == true) a.playing = false;
		})

		Panels.animation_controllers.inside_vue.controller = this;

		this.selected = true;
		if (this.playing == false) this.playing = true;
		AnimationItem.selected = this;

		if (Modes.animate) {
			Animator.preview();
			updateInterface();
			BarItems.slider_animation_controller_speed.update();
		}
		return this;
	}
	clickSelect() {
		Undo.initSelection();
		this.select();
		Undo.finishSelection('Select animation')
	}
	createUniqueName(arr) {
		var scope = this;
		var others = AnimationController.all.slice();
		if (arr && arr.length) {
			arr.forEach(g => {
				others.safePush(g)
			})
		}
		others = others.filter(a => a.path == this.path);
		var name = this.name.replace(/\d+$/, '');
		function check(n) {
			for (var i = 0; i < others.length; i++) {
				if (others[i] !== scope && others[i].name == n) return false;
			}
			return true;
		}
		if (check(this.name)) {
			return this.name;
		}
		for (var num = 2; num < 8e3; num++) {
			if (check(name+num)) {
				scope.name = name+num;
				return scope.name;
			}
		}
		return false;
	}
	rename() {
		var scope = this;
		Blockbench.textPrompt('generic.rename', this.name, function(name) {
			if (name && name !== scope.name) {
				Undo.initEdit({animation_controllers: [scope]});
				scope.name = name;
				scope.createUniqueName();
				Undo.finishEdit('Rename animation controller');
			}
		})
		return this;
	}
	updatePreview() {
		let mode = BarItems.animation_controller_preview_mode.value;
		if (mode == 'paused') {
			Animator._controller_static_pose_clean = false;
			return;
		}
		// Static-pose fast path: a state without animations shows the default
		// pose every frame, so after one full preview() the pose pipeline can be
		// skipped until something invalidates it (transition, edit, camera move
		// with billboards, plugin listeners, ...). Only transitions are checked.
		let static_state = mode == 'play' && this.selected_state && Animator.canReuseStaticControllerPose(this);
		if (static_state && Animator._controller_static_pose_clean === this.selected_state) {
			Animator._scene_matrices_fresh = true;
		} else {
			Animator.preview();
			if (Preview.selected) {
				Animator._static_path_camera_position.copy(Preview.selected.camera.position);
				Animator._static_path_camera_quaternion.copy(Preview.selected.camera.quaternion);
			}
			Animator._controller_static_pose_clean = static_state ? this.selected_state : false;
		}

		// Transitions
		if (mode == 'play' && this.selected_state) {
			for (let transition of this.selected_state.transitions) {
				let match = Animator.MolangParser.parse(transition.condition);
				let target_state = match && this.states.find(s => s.uuid == transition.target);
				if (match && target_state) {
					target_state.select();
					break;
				}
			}
		}
	}
	togglePlayingState(state) {
		if (!this.selected) {
			this.playing = state !== undefined ? state : !this.playing;
			Animator.preview();
		} else {
		}
		return this.playing;
	}
	showContextMenu(event) {
		if (!this.selected && !this.multi_selected) {
			AnimationItem.all.forEach(a => { if (a.multi_selected) a.multi_selected = false; });
			AnimationItem.last_selected = this;
			this.select();
		}
		this.menu.open(event, this);
		return this;
	}
	add(undo) {
		if (undo) {
			Undo.initEdit({animation_controllers: []})
		}
		if (!AnimationController.all.includes(this)) {
			AnimationController.all.push(this)
		}
		this.createUniqueName();
		if (undo) {
			this.select()
			Undo.finishEdit('Add animation controller', {animation_controllers: [this]})
		}
		return this;
	}
	remove(undo, remove_from_file = true) {
		if (undo) {
			Undo.initEdit({animation_controllers: [this]})
		}
		AnimationController.all.remove(this)
		if (undo) {
			Undo.finishEdit('Remove animation controller', {animation_controllers: []})

			if (isApp && remove_from_file && AnimationCodec.getCodec(this)?.deleteAnimationFromFile && this.path && fs.existsSync(this.path)) {
				Blockbench.showMessageBox({
					translateKey: 'delete_animation',
					icon: 'movie',
					buttons: ['generic.delete', 'dialog.cancel'],
					confirm: 0,
					cancel: 1,
				}, (result) => {
					if (result == 0) {
						AnimationCodec.getCodec(this).deleteAnimationFromFile(this);
					}
				})
			}
		}
		Blockbench.dispatchEvent('remove_animation', {animation_controllers: [this]})
		if (Animation.selected === this) {
			Animation.selected = null;
			Timeline.clear();
			Animator.preview();
		}
		return this;
	}
	propertiesDialog() {
		let dialog = new Dialog({
			id: 'animation_properties',
			title: this.name,
			width: 660,
			part_order: ['form', 'component'],
			form: {
				name: {label: 'generic.name', value: this.name},
				path: {
					label: 'menu.animation.file',
					value: this.path,
					type: 'file',
					extensions: ['json'],
					filetype: 'JSON Animation',
					condition: Animation.properties.path.condition
				}
			},
			onConfirm: form_data => {
				dialog.hide().delete();
				if (
					form_data.name != this.name
					|| (isApp && form_data.path != this.path)
				) {
					Undo.initEdit({animation_controllers: [this]});

					this.name = form_data.name;
					if (isApp) this.path = form_data.path;
					this.createUniqueName();

					Blockbench.dispatchEvent('edit_animation_controller_properties', {animation_controllers: [this]})

					Undo.finishEdit('Edit animation controller properties');
				}
			},
			onCancel() {
				dialog.hide().delete();
			}
		})
		dialog.show();
	}
	static playback_speed = 100
}
	Object.defineProperty(AnimationController, 'all', {
		get() {
			return Project.animation_controllers || [];
		},
		set(arr) {
			Project.animation_controllers.replace(arr);
		}
	})
	AnimationController.selected = null;
	AnimationController.prototype.menu = new Menu([
		new MenuSeparator('copypaste'),
		'copy',
		'paste',
		'duplicate',
		new MenuSeparator('manage'),
		{
			name: 'menu.animation.save',
			id: 'save',
			icon: 'save',
			condition: () => Format.animation_files,
			click(animation) {
				animation.save();
			}
		},
		{
			name: 'menu.animation.open_location',
			id: 'open_location',
			icon: 'folder',
			condition(animation) {return isApp && Format.animation_files && animation.path && fs.existsSync(animation.path)},
			click(animation) {
				Filesystem.showFileInFolder(animation.path);
			}
		},
		{
			name: 'generic.edit_externally',
			id: 'edit_externally',
			icon: 'edit_document',
			condition(animation) {return isApp && Format.animation_files && animation.path && fs.existsSync(animation.path)},
			click(animation) {
				ipcRenderer.send('open-in-default-app', animation.path);
			}
		},
		'rename',
		{
			id: 'reload',
			name: 'menu.animation.reload',
			icon: 'refresh',
			condition: (controller) => (Format.animation_files && isApp && controller.saved),
			click(controller) {
				Blockbench.read([controller.path], {}, ([file]) => {
					Undo.initEdit({animation_controllers: [controller]})
					let anim_index = AnimationController.all.indexOf(controller);
					controller.remove(false, false);
					let [new_ac] = AnimationCodec.codecs.bedrock_animation_controller.loadFile(file, [controller.name]);
					AnimationController.all.remove(new_ac);
					AnimationController.all.splice(anim_index, 0, new_ac);
					new_ac.select();
					Undo.finishEdit('Reload animation', {animation_controllers: [new_ac]});
				})
			}
		},
		{
			id: 'unload',
			name: 'menu.animation.unload',
			icon: 'remove',
			condition: () => Format.animation_files,
			click(controller) {
				let items = AnimationItem.getMultiSelected();
				if (items.length > 1 && items.includes(controller)) {
					AnimationItem.removeMultiSelected(items, false);
				} else {
					Undo.initEdit({animation_controllers: [controller]})
					controller.remove(false, false);
					Undo.finishEdit('Unload animation controller', {animation_controllers: []})
				}
			}
		},
		'delete',
		new MenuSeparator('properties'),
		{name: 'menu.animation.properties', icon: 'list', click(animation) {
			animation.propertiesDialog();
		}}
	])
	AnimationController.prototype.file_menu = Animation.prototype.file_menu;
	new Property(AnimationController, 'boolean', 'saved', {default: true})
	new Property(AnimationController, 'string', 'path', {condition: () => isApp})
	new Property(AnimationController, 'string', 'initial_state', {default: ''})

AnimationController.presets = [
	{
		name: 'Default',
		states: {
			default: {}
		}
	},
	{
		name: 'Simple Action',
		states: {
			default: {
				transitions: [{active: 'query.foo'}]
			},
			active: {
				transitions: [{default: '!query.foo'}]
			}
		}
	},
	{
		name: 'Walking',
		states: {
			idle: {
				transitions: [
					{walking: 'q.ground_speed > 1.0'}
				],
				blend_transition: 0.2
			},
			walking: {
				transitions: [
					{idle: 'q.ground_speed < 0.5'}
				],
				blend_transition: 0.2
			}
		}
	},
	{
		name: 'Open & Close',
		initial_state: 'default',
		states: {
			default: {
				transitions: [
					{closed: '!q.is_ignited'},
					{opened: 'q.is_ignited'}
				]
			},
			closed: {
				transitions: [
					{open: 'q.is_ignited'}
				]
			},
			open: {
				transitions: [
					{opened: 'query.any_animation_finished'},
					{close: '!q.is_ignited'}
				],
				blend_transition: 0.1
			},
			opened: {
				transitions: [
					{close: '!q.is_ignited'}
				],
				blend_transition: 0.1
			},
			close: {
				transitions: [
					{closed: 'query.all_animations_finished'}
				]
			}
		}
	}
];

Blockbench.on('finish_edit', event => {
	if (!Format.animation_controllers) return;
	if (event.aspects.animation_controllers) {
		event.aspects.animation_controllers.forEach(controller => {
			if (Undo.current_save && Undo.current_save.aspects.animation_controllers instanceof Array && Undo.current_save.aspects.animation_controllers.includes(controller)) {
				controller.saved = false;
			}
		})
	}
	if (event.aspects.animation_controller_state && AnimationController.selected) {
		AnimationController.selected.saved = false;
	}
})

SharedActions.add('rename', {
	condition: () => Prop.active_panel == 'animation_controllers' && AnimationController.selected?.selected_state,
	run() {
		AnimationController.selected?.selected_state.rename();
	}
})
SharedActions.add('delete', {
	condition: () => Prop.active_panel == 'animation_controllers' && AnimationController.selected?.selected_state,
	run() {
		AnimationController.selected?.selected_state.remove(true);
	}
})
SharedActions.add('duplicate', {
	condition: () => Prop.active_panel == 'animations' && AnimationController.selected,
	run() {
		let copy = AnimationController.selected.getUndoCopy();
		let controller = new AnimationController(copy);
		Property.resetUniqueValues(AnimationController, controller);
		controller.createUniqueName();
		AnimationController.all.splice(AnimationController.all.indexOf(AnimationController.selected)+1, 0, controller)
		controller.saved = false;
		controller.add(true).select();
	}
})
SharedActions.add('duplicate', {
	condition: () => Prop.active_panel == 'animation_controllers' && AnimationController.selected?.selected_state,
	run() {
		Undo.initEdit({animation_controllers: [AnimationController.selected]});
		let index = AnimationController.selected.states.indexOf(AnimationController.selected.selected_state);
		let state = new AnimationControllerState(AnimationController.selected, AnimationController.selected.selected_state);
		AnimationController.selected.states.remove(state);
		AnimationController.selected.states.splice(index+1, 0, state);
		Undo.finishEdit('Duplicate animation controller state');
	}
})

Interface.definePanels(() => {
	let panel = new Panel('animation_controllers', {
		icon: 'account_tree',
		condition: {modes: ['animate'], features: ['animation_controllers'], method: () => AnimationController.selected},
		default_position: {
			slot: 'bottom',
			float_position: [100, 400],
			float_size: [600, 300],
			height: 260,
		},
		growable: true,
		resizable: true,
		component: {
			name: 'panel-animation-controllers',
			components: {VuePrismEditor},
			data() {return {
				controller: null,
				presets: AnimationController.presets,
				zoom: 1,
				pan: {x: 40, y: 40},
				playback_speed: 100,
				preview_mode: 'manual',
				connecting: false,
				suppress_state_click: false,
				selected_states: [],
				marquee: null,
				connections_epoch: 0,
				pickwhip: {
					start_x: 0,
					start_y: 0,
					end_x: 0,
					end_y: 0,
				}
			}},
			mounted() {
				// BarSelect value is not reactive; poll so the "playing" highlight follows the toolbar mode
				this._preview_mode_interval = setInterval(() => {
					let mode = BarItems.animation_controller_preview_mode?.value || 'manual';
					if (mode != this.preview_mode) this.preview_mode = mode;
				}, 250);
			},
			beforeDestroy() {
				clearInterval(this._preview_mode_interval);
			},
			methods: {
				loadPreset(preset) {
					Undo.initEdit({animation_controllers: [AnimationController.selected]})
					this.controller.extend({
						states: preset.states,
						initial_state: preset.initial_state
					});
					Undo.finishEdit('Apply animation controller preset')
				},
				toggleStateSection(state, section) {
					state.fold[section] = !state.fold[section];
				},
				updateStateScript(state, key, value) {
					// 原样写回，保持「模型 === 编辑器内容」不变量；行数徽标侧自行忽略尾部空行
					state[key] = value;
				},
				getScriptLineCount(text) {
					// Ignore trailing empty lines so the badge matches the visible line count
					let trimmed = text.replace(/\s+$/, '');
					return trimmed ? trimmed.split('\n').length : 0;
				},
				openAnimationMenu(state, animation, target) {
					if (getFocusedTextInput()) return;
					let apply = anim => {
						animation.key = anim.getShortName();
						animation.animation = anim.uuid;
					}
					let list = [
						{
							name: 'generic.unset',
							icon: animation.animation == '' ? 'far.fa-dot-circle' : 'far.fa-circle',
							click: () => {
								animation.key = '';
								animation.animation = '';
							}
						},
						'_'
					];
					AnimationItem.all.forEach((anim, i) => {
						if (anim == this.controller) return;
						if (i && anim instanceof AnimationController) list.push('_');
						list.push({
							name: anim.name,
							icon: animation.animation == anim.uuid ? 'far.fa-dot-circle' : (state.animations.find(a => a.animation == anim.uuid) ? 'task_alt' : 'far.fa-circle'),
							click: () => apply(anim)
						})
					})
					list.push(
						'_',
						{id: 'remove', name: 'generic.remove', icon: 'clear', click() {
							Undo.initEdit({animation_controller_state: state});
							animation = state.animations.find(t => t.uuid == animation.uuid);
							state.animations.remove(animation);
							Undo.finishEdit('Remove animation from controller state');
						}}
					);
					let menu = new Menu('controller_state_animations', list, {searchable: list.length > 7});
					menu.open(target);
				},
				openTransitionMenu(state, transition, event) {
					if (getFocusedTextInput()) return;
					let list = [];
					this.controller.states.forEach(state2 => {
						if (state2 == state) return;
						list.push({
							name: state2.name,
							icon: transition.target == state2.uuid ? 'far.fa-dot-circle' : (state.transitions.find(t => t.target == state2.uuid) ? 'task_alt' : 'far.fa-circle'),
							click: () => {
								transition.target = state2.uuid;
							}
						})
					})
					list.push(
						'_',
						{id: 'remove', name: 'generic.remove', icon: 'clear', click() {
							Undo.initEdit({animation_controller_state: state});
							transition = state.transitions.find(t => t.uuid == transition.uuid);
							state.transitions.remove(transition);
							Undo.finishEdit('Remove transition from controller state');
						}}
					);
					let menu = new Menu('controller_state_transitions', list, {searchable: list.length > 9});
					menu.open(event.target);
				},
				openParticleMenu(state, particle, event) {
					if (getFocusedTextInput()) return;
					new Menu('controller_state_particle', [
						{
							name: 'generic.remove',
							icon: 'clear',
							click() {
								Undo.initEdit({animation_controller_state: state});
								// Property.copy replaces array items during initEdit; re-find by uuid
								particle = state.particles.find(p => p.uuid == particle.uuid);
								if (particle) state.particles.remove(particle);
								Undo.finishEdit('Remove particle from controller state');
							}
						}
					]).open(event);
					event.stopPropagation();
				},
				openSoundMenu(state, sound, event) {
					if (getFocusedTextInput()) return;
					new Menu('controller_state_sound', [
						{
							name: 'generic.remove',
							icon: 'clear',
							click() {
								Undo.initEdit({animation_controller_state: state});
								// Property.copy replaces array items during initEdit; re-find by uuid
								sound = state.sounds.find(s => s.uuid == sound.uuid);
								if (sound) state.sounds.remove(sound);
								Undo.finishEdit('Remove sound from controller state');
							}
						}
					]).open(event);
					event.stopPropagation();
				},
				addAnimationButton(state, event) {
					state.select();
					let list = [
						{
							name: 'generic.unset',
							icon: 'call_to_action',
							click: () => {
								state.addAnimation();
							}
						}
					];
					AnimationItem.all.forEach((anim, i) => {
						if (anim == this.controller) return;
						if (i && anim instanceof AnimationController) list.push('_');
						list.push({
							name: anim.name,
							icon: anim instanceof AnimationController ? 'account_tree' : 'movie',
							click: () => {
								state.addAnimation(anim);
							}
						})
					})
					let menu = new Menu('controller_state_animations', list, {searchable: list.length > 7});
					menu.open(event.target);
				},
				addTransitionButton(state, event) {
					state.select();
					let list = [];
					this.controller.states.forEach(state2 => {
						if (state2 == state || state.transitions.find(t => t.target == state2.uuid)) return;
						list.push({
							name: state2.name,
							icon: 'login',
							click: () => {
								state.addTransition(state2.uuid);
							}
						})
					})
					if (!list.length) {
						list.push({
							name: 'generic.unset',
							icon: 'remove',
							click: () => {
								state.addTransition();
							}
						})
					}
					let menu = new Menu('controller_state_transitions', list, {searchable: list.length > 9});
					menu.open(event.target);
				},
				addParticleButton(state, event) {
					state.addParticle();
				},
				addSoundButton(state, event) {
					state.addSound();
				},
				addState() {
					BarItems.add_animation_controller_state.trigger();
				},
				getStateName(uuid) {
					let state = this.controller.states.find(s => s.uuid == uuid);
					return state ? state.name : '';
				},
				onMouseWheel(event) {
					if (!this.controller) return;
					event.preventDefault();
					// 反馈#108：使用 AC 面板专属的缩放快捷键
					if (Keybinds.extra.ac_scroll_zoom.keybind.isTriggered(event)) {
						// Zoom around the cursor
						let old_zoom = this.zoom;
						let zoom = Math.clamp(old_zoom * (event.deltaY < 0 ? 1.1 : 0.9), 0.2, 2);
						if (zoom == old_zoom) return;
						let rect = this.$el.getBoundingClientRect();
						let cx = event.clientX - rect.left;
						let cy = event.clientY - rect.top;
						this.pan.x = cx - (cx - this.pan.x) * (zoom / old_zoom);
						this.pan.y = cy - (cy - this.pan.y) * (zoom / old_zoom);
						this.zoom = zoom;
					} else {
						// Pan
						this.pan.x -= event.deltaX + (event.shiftKey ? event.deltaY : 0);
						this.pan.y -= event.shiftKey ? 0 : event.deltaY;
					}
				},
				getStatePosition(state) {
					if (state.position) return state.position;
					let index = this.controller ? this.controller.states.indexOf(state) : 0;
					return {x: Math.max(index, 0) * 340, y: 0};
				},
				getStateWidth(state) {
					return state.folded ? 54 : 300;
				},
				panToState(state) {
					Vue.nextTick(() => {
						let node = this.$el.querySelector(`.controller_state[uuid="${state.uuid}"]`);
						if (!node) return;
						let pos = this.getStatePosition(state);
						let margin = 24;
						let view_w = this.$el.clientWidth;
						let view_h = this.$el.clientHeight;
						let w = node.offsetWidth * this.zoom;
						let h = node.offsetHeight * this.zoom;
						let px = pos.x * this.zoom;
						let py = pos.y * this.zoom;
						// Pan range in which the node is fully visible (swapped bounds if larger than viewport)
						let lo_x = view_w - margin - w - px, hi_x = margin - px;
						if (lo_x > hi_x) [lo_x, hi_x] = [hi_x, lo_x];
						let lo_y = view_h - margin - h - py, hi_y = margin - py;
						if (lo_y > hi_y) [lo_y, hi_y] = [hi_y, lo_y];
						this.pan.x = Math.clamp(this.pan.x, lo_x, hi_x);
						this.pan.y = Math.clamp(this.pan.y, lo_y, hi_y);
					})
				},
				zoomToFit() {
					if (!this.controller || !this.controller.states.length) return;
					Vue.nextTick(() => {
						let margin = 60;
						let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
						this.controller.states.forEach(state => {
							let pos = this.getStatePosition(state);
							let node = this.$el.querySelector(`.controller_state[uuid="${state.uuid}"]`);
							let w = node ? node.offsetWidth : 300;
							let h = node ? node.offsetHeight : 100;
							min_x = Math.min(min_x, pos.x);
							min_y = Math.min(min_y, pos.y);
							max_x = Math.max(max_x, pos.x + w);
							max_y = Math.max(max_y, pos.y + h);
						})
						let view_w = this.$el.clientWidth;
						let view_h = this.$el.clientHeight;
						let zoom = Math.clamp(Math.min(view_w / (max_x - min_x + 2 * margin), view_h / (max_y - min_y + 2 * margin)), 0.2, 2);
						this.zoom = Math.round(zoom * 100) / 100;
						this.pan.x = Math.round((view_w - (max_x - min_x) * this.zoom) / 2 - min_x * this.zoom);
						this.pan.y = Math.round((view_h - (max_y - min_y) * this.zoom) / 2 - min_y * this.zoom);
					})
				},
				autoLayout() {
					let controller = this.controller;
					if (!controller || !controller.states.length) return;
					let states = controller.states;
					// BFS into left-to-right layers, starting at the initial state; each disconnected component stacks below
					let visited = new Set();
					let components = [];
					let roots = [];
					let initial = states.find(s => s.uuid == controller.initial_state);
					if (initial) roots.push(initial);
					states.forEach(state => { if (state != initial) roots.push(state); });
					roots.forEach(root => {
						if (visited.has(root.uuid)) return;
						let layers = [];
						let queue = [[root, 0]];
						visited.add(root.uuid);
						while (queue.length) {
							let [state, depth] = queue.shift();
							(layers[depth] = layers[depth] || []).push(state);
							state.transitions.forEach(transition => {
								let target = states.find(s => s.uuid == transition.target);
								if (target && !visited.has(target.uuid)) {
									visited.add(target.uuid);
									queue.push([target, depth + 1]);
								}
							})
						}
						components.push(layers);
					})
					let component_y = 0;
					components.forEach(layers => {
						let component_bottom = component_y;
						layers.forEach((layer, depth) => {
							let y = component_y;
							layer.forEach(state => {
								let node = this.$el.querySelector(`.controller_state[uuid="${state.uuid}"]`);
								let h = node ? node.offsetHeight : 100;
								state.position = {x: depth * 380, y};
								y += h + 40;
							})
							component_bottom = Math.max(component_bottom, y);
						})
						component_y = component_bottom + 80;
					})
					this.zoomToFit();
				},
				onCanvasKeydown(event) {
					if (!this.controller) return;
					let tag = event.target.tagName;
					if (tag == 'INPUT' || tag == 'TEXTAREA' || event.target.isContentEditable) return;
					if (event.key == 'Home' || event.code == 'NumpadDecimal') {
						event.preventDefault();
						event.stopPropagation();
						this.zoomToFit();
					} else if (event.code == 'KeyA' && event.ctrlOrCmd) {
						event.preventDefault();
						event.stopPropagation();
						this.selected_states = this.controller.states.map(s => s.uuid);
						let last = this.controller.states.last();
						if (last) last.select();
					} else if (event.key == 'Delete' || (event.code == 'KeyX' && !event.ctrlOrCmd && !event.altKey)) {
						event.preventDefault();
						event.stopPropagation();
						let targets = this.controller.states.filter(s => this.selected_states.includes(s.uuid));
						if (!targets.length && this.controller.selected_state) targets = [this.controller.selected_state];
						if (!targets.length) return;
						if (targets.length == 1) {
							targets[0].remove(true);
						} else {
							Undo.initEdit({animation_controllers: [this.controller]});
							targets.forEach(state => state.remove(false));
							Undo.finishEdit('Remove animation controller states');
						}
						this.selected_states = [];
					}
				},
				panCanvas(event) {
					if (event.target.closest('.controller_state') || event.target.closest('path') || event.target.closest('.ac_canvas_tools') || event.target.closest('#animation_controller_presets')) return;
					if (!isTouchEvent(event)) {
						// 反馈#93：框选与平移画布的按键可在 设置>键盘 中自定义（ac_box_select / ac_pan_canvas）
						if (Keybinds.extra.ac_box_select.keybind.isTriggered(event)) return this.startMarquee(event);
						if (!Keybinds.extra.ac_pan_canvas.keybind.isTriggered(event)) return;
					}
					convertTouchEvent(event);
					let scope = this;
					let start_x = event.clientX, start_y = event.clientY;
					let start_pan = {x: this.pan.x, y: this.pan.y};
					let moved = false;
					function move(e2) {
						convertTouchEvent(e2);
						if (!moved && Math.abs(e2.clientX - start_x) + Math.abs(e2.clientY - start_y) < 4) return;
						moved = true;
						scope.pan.x = start_pan.x + e2.clientX - start_x;
						scope.pan.y = start_pan.y + e2.clientY - start_y;
					}
					function stop() {
						removeEventListeners(document, 'mousemove touchmove', move);
						removeEventListeners(document, 'mouseup touchend', stop);
						if (moved) {
							scope.suppress_state_click = true;
							setTimeout(() => { scope.suppress_state_click = false; }, 0);
						}
					}
					addEventListeners(document, 'mousemove touchmove', move);
					addEventListeners(document, 'mouseup touchend', stop);
				},
				startMarquee(event) {
					convertTouchEvent(event);
					event.preventDefault();
					let scope = this;
					let rect = this.$el.getBoundingClientRect();
					let toCanvas = e => ({
						x: (e.clientX - rect.left - this.pan.x) / this.zoom,
						y: (e.clientY - rect.top - this.pan.y) / this.zoom
					});
					let start = toCanvas(event);
					let moved = false;
					function move(e2) {
						convertTouchEvent(e2);
						let cur = toCanvas(e2);
						if (!moved && Math.abs(e2.clientX - event.clientX) + Math.abs(e2.clientY - event.clientY) < 4) return;
						moved = true;
						scope.marquee = {
							x: Math.min(start.x, cur.x),
							y: Math.min(start.y, cur.y),
							width: Math.abs(cur.x - start.x),
							height: Math.abs(cur.y - start.y),
						};
					}
					function stop(e2) {
						removeEventListeners(document, 'mousemove touchmove', move);
						removeEventListeners(document, 'mouseup touchend', stop);
						let box = scope.marquee;
						scope.marquee = null;
						if (!moved || !box || !scope.controller) return;
						scope.suppress_state_click = true;
						setTimeout(() => { scope.suppress_state_click = false; }, 0);
						// Select every state whose node intersects the marquee
						let hit = scope.controller.states.filter(state => {
							let pos = scope.getStatePosition(state);
							let node = scope.$el.querySelector(`.controller_state[uuid="${state.uuid}"]`);
							let w = node ? node.offsetWidth : scope.getStateWidth(state);
							let h = node ? node.offsetHeight : 100;
							return pos.x < box.x + box.width && pos.x + w > box.x
								&& pos.y < box.y + box.height && pos.y + h > box.y;
						});
						scope.selected_states = hit.map(s => s.uuid);
						let last = hit.last();
						if (last) last.select();
					}
					addEventListeners(document, 'mousemove touchmove', move);
					addEventListeners(document, 'mouseup touchend', stop);
				},
				dragStateNode(state, event) {
					// 反馈#93：节点拖动按键可在 设置>键盘 中自定义（ac_move_state）
					if (!isTouchEvent(event) && !Keybinds.extra.ac_move_state.keybind.isTriggered(event)) return;
					convertTouchEvent(event);
					if (event.type == 'mousedown') event.preventDefault();
					event.stopPropagation();
					let scope = this;
					// Group drag: move every state in the multi-selection together
					let group = (this.selected_states.length > 1 && this.selected_states.includes(state.uuid))
						? this.controller.states.filter(s => this.selected_states.includes(s.uuid))
						: [state];
					let start_positions = group.map(s => ({state: s, pos: this.getStatePosition(s)}));
					let start_x = event.clientX, start_y = event.clientY;
					let moved = false;
					function move(e2) {
						convertTouchEvent(e2);
						if (!moved && Math.abs(e2.clientX - start_x) + Math.abs(e2.clientY - start_y) < 4) return;
						moved = true;
						scope.suppress_state_click = true;
						let dx = (e2.clientX - start_x) / scope.zoom;
						let dy = (e2.clientY - start_y) / scope.zoom;
						start_positions.forEach(({state, pos}) => {
							state.position = {
								x: Math.round(pos.x + dx),
								y: Math.round(pos.y + dy)
							};
						})
					}
					function stop() {
						removeEventListeners(document, 'mousemove touchmove', move);
						removeEventListeners(document, 'mouseup touchend', stop);
						setTimeout(() => { scope.suppress_state_click = false; }, 0);
					}
					addEventListeners(document, 'mousemove touchmove', move);
					addEventListeners(document, 'mouseup touchend', stop);
				},
				onStateClick(state, event) {
					if (this.suppress_state_click) return;
					// 反馈#93：多选修饰键可在 设置>键盘 中自定义（ac_move_state 的 multi_select 变体，默认 Ctrl）
					if (Keybinds.extra.ac_move_state.keybind.additionalModifierTriggered(event, 'multi_select')) {
						// Toggle in multi-selection
						if (this.selected_states.includes(state.uuid)) {
							this.selected_states.remove(state.uuid);
							if (this.controller.selected_state == state) {
								let last = this.selected_states.last();
								let next = last && this.controller.states.find(s => s.uuid == last);
								if (next) next.select(); else this.controller.selected_state = null;
							}
						} else {
							this.selected_states.push(state.uuid);
							state.select().scrollTo();
						}
					} else {
						this.selected_states = [state.uuid];
						state.select().scrollTo();
					}
				},
				deselect(event) {
					if (!this.controller) return;
					// 框选/平移/拖拽结束后的残余 click 不应清空选择（与 onStateClick 共用抑制标记）
					if (this.suppress_state_click) return;
					let target = event.target;
					if (target.id !== 'animation_controllers_wrapper' && !target.classList?.contains('ac_canvas') && target.tagName !== 'svg') return;
					this.controller.selected_state = null;
					this.selected_states = [];
				},
				sortAnimation(state, event) {
					Undo.initEdit({animation_controller_state: state});
					var item = state.animations.splice(event.oldIndex, 1)[0];
					state.animations.splice(event.newIndex, 0, item);
					Undo.finishEdit('Reorder animations in controller state');
				},
				sortTransition(state, event) {
					Undo.initEdit({animation_controller_state: state});
					var item = state.transitions.splice(event.oldIndex, 1)[0];
					state.transitions.splice(event.newIndex, 0, item);
					Undo.finishEdit('Reorder transitions in controller state');
				},
				selectConnection(connection, event) {
					if (this.suppress_state_click) return;
					let state = this.controller.states[connection.state_index];
					let target = this.controller.states[connection.target_index];
					if (state == this.controller.selected_state || event.ctrlOrCmd || Pressing.overrides.ctrl) {
						target.select().scrollTo();
					} else {
						state.select().scrollTo();
					}
				},
				selectConnectionDeep(connection, event) {
					let state = this.controller.states[connection.state_index];
					let target = this.controller.states[connection.target_index];
					if (event.ctrlOrCmd || Pressing.overrides.ctrl) {
						target.select().scrollTo();
					} else {
						state.select().scrollTo();
						state.fold.transitions = false;
						Vue.nextTick(() => {
							let node = document.querySelector(`.controller_transition[uuid="${connection.uuid}"] pre`);
							if (node) {
								$(node).trigger('focus');
								document.execCommand('selectAll');
							}
						})
					}
				},
				connectionContextMenu(connection, event) {
					let vue = this;
					let state = this.controller.states[connection.state_index];
					new Menu('controller_connection_context', [
						{
							name: 'animation_controllers.state.edit_transition',
							icon: 'edit',
							click() {
								state.select().scrollTo();
								state.fold.transitions = false;
								Vue.nextTick(() => {
									let node = document.querySelector(`.controller_transition[uuid="${connection.uuid}"] pre`);
									if (node) {
										$(node).trigger('focus');
										document.execCommand('selectAll');
									}
								})
							}
						},
						{
							name: 'animation_controllers.connection.reset_curvature',
							icon: 'undo',
							condition: () => state.transitions.find(t => t.uuid == connection.uuid)?.curvature,
							click() {
								Undo.initEdit({animation_controller_state: state});
								// Property.copy replaces array items during initEdit; re-find by uuid
								let transition = state.transitions.find(t => t.uuid == connection.uuid);
								if (transition) transition.curvature = 0;
								vue.connections_epoch++;
								Undo.finishEdit('Reset connection curvature');
							}
						},
						{
							name: 'generic.remove',
							icon: 'clear',
							click() {
								Undo.initEdit({animation_controller_state: state});
								// Property.copy replaces array items during initEdit; re-find by uuid
								let transition = state.transitions.find(t => t.uuid == connection.uuid);
								if (transition) state.transitions.remove(transition);
								Undo.finishEdit('Remove animation controller transition');
							}
						},
					]).open(event)
				},
				dragConnectionCurve(connection, event) {
					// 反馈#93：连线曲率拖拽按键可在 设置>键盘 中自定义（ac_adjust_curvature）
					if (!isTouchEvent(event) && !Keybinds.extra.ac_adjust_curvature.keybind.isTriggered(event)) return;
					convertTouchEvent(event);
					let scope = this;
					let state = this.controller.states[connection.state_index];
					let start_y = event.clientY;
					let start_curvature = connection.curvature;
					let editing = false;
					let moved = false;
					function move(e2) {
						convertTouchEvent(e2);
						if (!moved && Math.abs(e2.clientY - start_y) < 4) return;
						if (!editing) {
							editing = true;
							Undo.initEdit({animation_controller_state: state});
						}
						moved = true;
						scope.suppress_state_click = true;
						// Property.copy replaces array items during initEdit; re-find by uuid
						let transition = state.transitions.find(t => t.uuid == connection.uuid);
						if (transition) {
							transition.curvature = Math.round(start_curvature + (e2.clientY - start_y) / scope.zoom);
							scope.connections_epoch++;
						}
					}
					function stop() {
						removeEventListeners(document, 'mousemove touchmove', move);
						removeEventListeners(document, 'mouseup touchend', stop);
						if (editing) Undo.finishEdit('Adjust connection curvature');
						setTimeout(() => { scope.suppress_state_click = false; }, 0);
					}
					addEventListeners(document, 'mousemove touchmove', move);
					addEventListeners(document, 'mouseup touchend', stop);
				},
				dragConnection(state, event) {
					// 反馈#93：连线按键可在 设置>键盘 中自定义（ac_create_connection）
					if (!isTouchEvent(event) && !Keybinds.extra.ac_create_connection.keybind.isTriggered(event)) return;
					state.select();
					convertTouchEvent(event);
					event.preventDefault();
					event.stopPropagation();
					let scope = this;
					let {controller, pickwhip} = this;
					let start_pos = this.getStatePosition(state);
					pickwhip.start_x = start_pos.x + this.getStateWidth(state);
					pickwhip.start_y = start_pos.y + 15;
					pickwhip.end_x = pickwhip.start_x;
					pickwhip.end_y = pickwhip.start_y;
					this.connecting = true;

					function move(e2) {
						convertTouchEvent(e2);
						// Visually update connection line
						let rect = scope.$el.getBoundingClientRect();
						pickwhip.end_x = (e2.clientX - rect.left - scope.pan.x) / scope.zoom;
						pickwhip.end_y = (e2.clientY - rect.top - scope.pan.y) / scope.zoom;
					}
					function stop(e2) {
						convertTouchEvent(e2);
						removeEventListeners(document, 'mousemove touchmove', move);
						removeEventListeners(document, 'mouseup touchend', stop);
						scope.connecting = false;

						if (Math.abs(event.clientX - e2.clientX) < 20 && Math.abs(event.clientY - e2.clientY) < 20) return;

						// find selected state
						let target;
						if (!Blockbench.isTouch) {
							let target_uuid = document.querySelector('.controller_state:hover')?.attributes.uuid.value;
							target = target_uuid && controller.states.find(s => s.uuid == target_uuid);
						} else {
							target = controller.states.find(state => {
								let rect = document.querySelector(`.controller_state[uuid="${state.uuid}"]`)?.getBoundingClientRect();
								return e2.clientX > rect.left && e2.clientY > rect.top && e2.clientX < rect.right && e2.clientY < rect.bottom;
							})
						}
						if (target == state || !target) return;

						// Create connection
						state.fold.transitions = false;
						state.addTransition(target.uuid);
					}
					addEventListeners(document, 'mousemove touchmove', move);
					addEventListeners(document, 'mouseup touchend', stop);
				},
				changeParticleFile(state, particle_entry) {
					Blockbench.import({
						resource_id: 'animation_particle',
						extensions: ['json'],
						type: 'Bedrock Particle',
						startpath: particle_entry.file
					}, (files) => {

						let json = autoParseJSON(files[0].content, {file_path: files[0].path});
						if (!json || !json.particle_effect) {
							Blockbench.showQuickMessage('message.invalid_particle_file');
							return;
						}
						let existing = isApp && files[0].path && ParticleAsset.all.find(a => a.path === files[0].path);
						Undo.initEdit({animation_controller_state: state, particles: existing ? [existing] : []});
						let asset = ParticleAsset.importFromFile(files[0]);
						// Property.copy replaces array items during initEdit; re-find by uuid
						particle_entry = state.particles.find(p => p.uuid == particle_entry.uuid) || particle_entry;
						particle_entry.file = asset.getRef();
						if (!particle_entry.effect) particle_entry.effect = files[0].name.toLowerCase().split('.')[0].replace(/[^a-z0-9._]+/g, '');
						Undo.finishEdit('Change animation controller particle file', {particles: [asset]});

						if (!asset.texture) {
							asset.changeTexture();
						}
					})
				},
				changeSoundFile(state, sound_entry) {
					Blockbench.import({
						resource_id: 'animation_audio',
						extensions: ['ogg', 'wav', 'mp3'],
						type: 'Audio File',
						readtype: 'binary',
						startpath: sound_entry.file
					}, (files) => {
						let existing = isApp && files[0].path && SoundAsset.all.find(a => a.path === files[0].path);
						Undo.initEdit({animation_controller_state: state, sounds: existing ? [existing] : []});
						let asset = SoundAsset.importFromFile(files[0]);
						if (!asset) {
							Undo.cancelEdit();
							return;
						}
						// Property.copy replaces array items during initEdit; re-find by uuid
						sound_entry = state.sounds.find(s => s.uuid == sound_entry.uuid) || sound_entry;
						sound_entry.file = asset.getRef();
						if (!sound_entry.effect) sound_entry.effect = files[0].name.toLowerCase().replace(/\.[a-z]+$/, '').replace(/[^a-z0-9._]+/g, '');
						Undo.finishEdit('Change animation controller audio file', {sounds: [asset]})
					})
				},
				editStateBlendTime(state) {
					if (!blend_time_edit_state) {
						blend_time_edit_state = state;
						Undo.initEdit({animation_controller_state: state});
					}
					state.controller.saved = false;
				},
				finishStateBlendTime(state) {
					if (blend_time_edit_state) {
						blend_time_edit_state = null;
						Undo.finishEdit('Change animation controller blend time');
					}
				},
				toggleStateShortestPath(state, value) {
					Undo.initEdit({animation_controller_state: state});
					state.blend_via_shortest_path = value;
					Undo.finishEdit('Toggle blend via shortest path');
				},

				updateLocatorSuggestionList() {
					Locator.updateAutocompleteList();
				},
				openMolangContextMenu(event, state, target_object, target_key) {
					new Menu([
						{
							name: 'menu.text_edit.expression_editor',
							icon: 'code_blocks',
							click: () => {
								let value = target_object[target_key];
								openMolangEditor({
									autocomplete_context: MolangAutocomplete.AnimationControllerContext,
									text: value
								}, result => {
									if (value != result) {
										Undo.initEdit({animation_controller_state: state});
										target_object[target_key] = result;
										Undo.finishEdit('Edit animation controller molang');
									}
								})
							}
						}
					]).open(event);
				},
				autocomplete(text, position) {
					if (Settings.get('autocomplete_code') == false) return [];
					let test = MolangAutocomplete.AnimationControllerContext.autocomplete(text, position);
					return test;
				}
			},
			computed: {
				connections() {
					// transition.curvature lives on unobserved plain objects; this epoch re-runs the computed when it changes
					void this.connections_epoch;
					let result = {
						list: [],
						colors: {},
					};
					if (!this.controller) return result;
					let {states, selected_state} = this.controller;

					states.forEach((state, state_index) => {
						let pos1 = this.getStatePosition(state);
						let x1 = pos1.x + this.getStateWidth(state);
						let y1 = pos1.y + 15;

						state.transitions.forEach(transition => {
							let target_index = states.findIndex(s => s.uuid == transition.target);
							let target = states[target_index];
							if (!target) return;
							let pos2 = this.getStatePosition(target);
							let selected = state == selected_state || !selected_state;
							let relevant = target == selected_state;
							let dimmed = !!(selected_state && state != selected_state && target != selected_state);
							let playing = this.preview_mode == 'play' && !!selected_state && state == selected_state;
							let active_in = this.preview_mode == 'play' && !!selected_state && target == selected_state && state != selected_state;
							let color = markerColors[result.list.length % markerColors.length].standard;

							let x2 = pos2.x;
							let y2 = pos2.y + 15;
							let spread = Math.clamp(Math.abs(x2 - x1) / 2, 40, 160);
							let curvature = transition.curvature || 0;

							result.list.push({
								state_index, target_index,
								selected, relevant, dimmed, playing, active_in, color,
								uuid: transition.uuid,
								condition: transition.condition,
								curvature,
								path: `M ${x1} ${y1} C ${x1 + spread} ${y1 + curvature}, ${x2 - spread} ${y2 + curvature}, ${x2} ${y2}`,
								arrow: `M ${x2} ${y2} L ${x2 - 9} ${y2 - 4.5} L ${x2 - 9} ${y2 + 4.5} Z`
							});
							result.colors[transition.uuid] = color;
						})
					})
					return result;
				}
			},
			template: `
				<div id="animation_controllers_wrapper"
					tabindex="0"
					:class="{connecting_controllers: connecting}"
					:style="{'--blend-transition': controller && controller.last_state ? (controller.last_state.blend_transition / (playback_speed/100)) + 's' : 0}"
					@mousedown="panCanvas($event)" @touchstart="panCanvas($event)"
					@click="deselect($event)" @wheel="onMouseWheel($event)" @keydown="onCanvasKeydown($event)"
				>

					<div class="ac_canvas" :style="{transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')'}">

						<svg v-if="controller" class="ac_connections">
							<g v-for="connection in connections.list" :key="connection.uuid"
								:class="{dimmed: connection.dimmed, conn_playing: connection.playing, conn_active_in: connection.active_in}"
							>
								<path class="ac_connection_hit" :d="connection.path"
									@mousedown="dragConnectionCurve(connection, $event)" @touchstart="dragConnectionCurve(connection, $event)"
									@click="selectConnection(connection, $event)" @dblclick="selectConnectionDeep(connection, $event)" @contextmenu="connectionContextMenu(connection, $event)"
								><title>{{ connection.condition }}</title></path>
								<path class="ac_connection" :class="{selected: connection.selected, relevant: connection.relevant}"
									:d="connection.path" :style="{stroke: connection.relevant ? 'var(--color-text)' : connection.color}"
								/>
								<path class="ac_connection_arrow" :d="connection.arrow" :style="{fill: connection.relevant ? 'var(--color-text)' : connection.color}"/>
							</g>
							<line v-if="connecting" class="ac_pickwhip"
								:x1="pickwhip.start_x" :y1="pickwhip.start_y" :x2="pickwhip.end_x" :y2="pickwhip.end_y"
							/>
						</svg>

						<template v-if="controller">
						<div v-for="state in controller.states" :key="state.uuid"
							class="controller_state"
							:class="{selected: controller.selected_state == state, multi_selected: selected_states.length > 1 && selected_states.includes(state.uuid), folded: state.folded, initial_state: controller.initial_state == state.uuid, playing: preview_mode == 'play' && controller.selected_state == state}"
							:uuid="state.uuid"
							:style="{left: getStatePosition(state).x + 'px', top: getStatePosition(state).y + 'px'}"
							@click="onStateClick(state, $event)"
							@contextmenu="state.openMenu($event)"
						>
							<div class="controller_state_title_bar" @mousedown="dragStateNode(state, $event)" @touchstart="dragStateNode(state, $event)">
								<label @dblclick="state.rename()">{{ state.name }}</label>
								<div class="tool" title="" @click="state.openMenu($event.target)" v-if="!state.folded"><i class="material-icons">drag_handle</i></div>
								<!--div class="tool" title="" @click="state.folded = !state.folded"><i class="material-icons">{{ state.folded ? 'chevron_right' : 'chevron_left' }}</i></div-->
							</div>

							<template v-if="!state.folded">

								<div class="controller_state_gate_in"></div>
								<div class="controller_state_gate_out"
									@mousedown="dragConnection(state, $event)" @touchstart="dragConnection(state, $event)"
								></div>

								<div class="controller_state_section_title" @click="toggleStateSection(state, 'animations')">
									<i v-if="state.fold.animations || state.animations.length == 0" class="icon-open-state fa fa-angle-right"></i>
									<i v-else class="icon-open-state fa fa-angle-down"></i>

									<label>${tl('animation_controllers.state.animations')}</label>
									<span class="controller_state_section_info" v-if="state.animations.length">{{ state.animations.length }}</span>

									<div class="text_button" @click.stop="addAnimationButton(state, $event)"><i class="icon fa fa-plus"></i></div>
								</div>
								<ul v-if="!state.fold.animations" v-sortable="{onUpdate(event) {sortAnimation(state, event)}, animation: 160, handle: '.controller_item_drag_handle'}">
									<li v-for="(animation, i) in state.animations" :key="animation.uuid" class="controller_animation">
										<div class="controller_item_drag_handle"></div>
										<div class="tool" title="" @click="openAnimationMenu(state, state.animations[i], $event.target)"><i class="material-icons">movie</i></div>
										<input type="text" class="dark_bordered tab_target animation_controller_text_input" v-model="state.animations[i].key">
										<vue-prism-editor 
											class="molang_input animation_controller_text_input tab_target"
											v-model="state.animations[i].blend_value"
											language="molang"
											@contextmenu.stop="openMolangContextMenu($event, state, state.animations[i], 'blend_value')"
											:autocomplete="autocomplete"
											:placeholder="'${tl('animation_controllers.state.condition')}'"
											:ignoreTabKey="true"
											:line-numbers="false"
										/>
									</li>
								</ul>

								<div class="controller_state_section_title" @click="toggleStateSection(state, 'particles')">
									<i v-if="state.fold.particles || state.particles.length == 0" class="icon-open-state fa fa-angle-right"></i>
									<i v-else class="icon-open-state fa fa-angle-down"></i>

									<label>${tl('animation_controllers.state.particles')}</label>
									<span class="controller_state_section_info" v-if="state.particles.length">{{ state.particles.length }}</span>

									<div class="text_button" v-if="state.particles.length" @click.stop="state.muted.particle = !state.muted.particle">
										<i class="channel_mute fas fa-eye-slash" style="color: var(--color-subtle_text)" v-if="state.muted.particle"></i>
										<i class="channel_mute fas fa-eye" v-else></i>
									</div>

									<div class="text_button" @click.stop="addParticleButton(state, $event)">
										<i class="icon fa fa-plus"></i>
									</div>
								</div>
								<ul v-if="!state.fold.particles">
									<li v-for="(particle, i) in state.particles" :key="particle.uuid" class="controller_particle" @contextmenu="openParticleMenu(state, state.particles[i], $event)">
										<div class="bar flex">
											<label>${tl('data.effect')}</label>
											<input type="text" class="dark_bordered tab_target animation_controller_text_input" v-model="state.particles[i].effect">
											<div class="tool" title="${tl('timeline.select_particle_file')}" @click="changeParticleFile(state, state.particles[i])">
												<i class="material-icons">upload_file</i>
											</div>
										</div>
										<div class="bar flex">
											<label>${tl('data.locator')}</label>
											<input type="text" class="dark_bordered tab_target animation_controller_text_input" v-model="state.particles[i].locator" list="locator_suggestion_list" @focus="updateLocatorSuggestionList()">
											<input type="checkbox" v-model="state.particles[i].bind_to_actor" title="${tl('timeline.bind_to_actor')}">
										</div>
										<div class="bar flex">
											<label>${tl('timeline.pre_effect_script')}</label>
											<vue-prism-editor
												class="molang_input animation_controller_text_input tab_target"
												v-model="state.particles[i].pre_effect_script"
												language="molang"
												@contextmenu.stop="openMolangContextMenu($event, state, state.particles[i], 'pre_effect_script')"
												:autocomplete="autocomplete"
												:ignoreTabKey="true"
												:line-numbers="false"
											/>
										</div>
									</li>
								</ul>

								<div class="controller_state_section_title" @click="toggleStateSection(state, 'sounds')">
									<i v-if="state.fold.sounds || state.sounds.length == 0" class="icon-open-state fa fa-angle-right"></i>
									<i v-else class="icon-open-state fa fa-angle-down"></i>

									<label>${tl('animation_controllers.state.sounds')}</label>
									<span class="controller_state_section_info" v-if="state.sounds.length">{{ state.sounds.length }}</span>

									<div class="text_button" v-if="state.sounds.length" @click.stop="state.muted.sound = !state.muted.sound">
										<i class="channel_mute fas fa-volume-mute" style="color: var(--color-subtle_text)" v-if="state.muted.sound"></i>
										<i class="channel_mute fas fa-volume-up" v-else></i>
									</div>

									<div class="text_button" @click.stop="addSoundButton(state, $event)">
										<i class="icon fa fa-plus"></i>
									</div>
								</div>
								<ul v-if="!state.fold.sounds">
									<li v-for="(sound, i) in state.sounds" :key="sound.uuid" class="controller_sound" @contextmenu="openSoundMenu(state, state.sounds[i], $event)">
										<div class="bar flex">
											<label>${tl('data.effect')}</label>
											<input type="text" class="dark_bordered tab_target animation_controller_text_input" v-model="state.sounds[i].effect">
											<div class="tool" title="${tl('timeline.select_sound_file')}" @click="changeSoundFile(state, state.sounds[i])">
												<i class="material-icons">upload_file</i>
											</div>
										</div>
									</li>
								</ul>

								<div class="controller_state_section_title" @click="toggleStateSection(state, 'on_entry')">
									<i v-if="state.fold.on_entry" class="icon-open-state fa fa-angle-right"></i>
									<i v-else class="icon-open-state fa fa-angle-down"></i>
									<label>${tl('animation_controllers.state.on_entry')}</label>
									<span class="controller_state_section_info" v-if="getScriptLineCount(state.on_entry)">{{ getScriptLineCount(state.on_entry) }}</span>
								</div>
								<vue-prism-editor
									v-if="!state.fold.on_entry"
									class="molang_input animation_controller_text_input tab_target"
									:code="state.on_entry"
									@change="updateStateScript(state, 'on_entry', $event)"
									language="molang"
									@contextmenu.stop="openMolangContextMenu($event, state, state, 'on_entry')"
									:autocomplete="autocomplete"
									:ignoreTabKey="true"
									:line-numbers="false"
								/>

								<div class="controller_state_section_title" @click="toggleStateSection(state, 'on_exit')">
									<i v-if="state.fold.on_exit" class="icon-open-state fa fa-angle-right"></i>
									<i v-else class="icon-open-state fa fa-angle-down"></i>
									<label>${tl('animation_controllers.state.on_exit')}</label>
									<span class="controller_state_section_info" v-if="getScriptLineCount(state.on_exit)">{{ getScriptLineCount(state.on_exit) }}</span>
								</div>
								<vue-prism-editor
									v-if="!state.fold.on_exit"
									class="molang_input animation_controller_text_input tab_target"
									:code="state.on_exit"
									@change="updateStateScript(state, 'on_exit', $event)"
									language="molang"
									@contextmenu.stop="openMolangContextMenu($event, state, state, 'on_exit')"
									:autocomplete="autocomplete"
									:ignoreTabKey="true"
									:line-numbers="false"
								/>

								<div class="controller_state_section_title" @click="toggleStateSection(state, 'transitions')">
									<i v-if="state.fold.transitions || state.transitions.length == 0" class="icon-open-state fa fa-angle-right"></i>
									<i v-else class="icon-open-state fa fa-angle-down"></i>

									<label>${tl('animation_controllers.state.transitions')}</label>
									<span class="controller_state_section_info" v-if="state.transitions.length">{{ state.transitions.length }}</span>

									<div class="text_button" @click.stop="addTransitionButton(state, $event)"><i class="icon fa fa-plus"></i></div>
								</div>
								<template v-if="!state.fold.transitions">
									<ul v-sortable="{onUpdate(event) {sortTransition(state, event)}, animation: 160, handle: '.controller_item_drag_handle'}">
										<li v-for="(transition, i) in state.transitions" :key="transition.uuid" :uuid="transition.uuid" class="controller_transition"">
											<div class="controller_item_drag_handle" :style="{'--color-marker': connections.colors[transition.uuid]}"></div>
											<div class="bb-select" @click="openTransitionMenu(state, state.transitions[i], $event)">{{ getStateName(state.transitions[i].target) }}</div>
											<vue-prism-editor 
												class="molang_input animation_controller_text_input tab_target"
												v-model="state.transitions[i].condition"
												language="molang"
												@contextmenu.stop="openMolangContextMenu($event, state, state.transitions[i], 'condition')"
												:autocomplete="autocomplete"
												:ignoreTabKey="true"
												:line-numbers="false"
											/>
										</li>
									</ul>
									<div class="controller_state_input_bar">
										<label>${tl('animation_controllers.state.blend_transition')}</label>
										<numeric-input style="width: 70px; flex-grow: 0;" v-model.number="state.blend_transition" :min="0" :step="0.05" @input="editStateBlendTime(state)" @change="finishStateBlendTime(state)" />
										<div
											class="tool blend_transition_curve_button"
											title="${tl('animation_controllers.state.blend_transition_curve')}"
											@click="state.editTransitionCurve()"
										>
											<i class="fas fa-chart-line icon"></i>
											<span v-if="Object.keys(state.blend_transition_curve).length">{{ Object.keys(state.blend_transition_curve).length }}</span>
										</div>
									</div>
									<div class="controller_state_input_bar">
										<label :for="state.uuid + '_shortest_path'">${tl('animation_controllers.state.shortest_path')}</label>
										<input type="checkbox" :id="state.uuid + '_shortest_path'" :checked="state.blend_via_shortest_path" @change="toggleStateShortestPath(state, $event.target.checked)">
									</div>
								</template>

							</template>
						</div>
						</template>

						<div v-if="marquee" class="ac_marquee"
							:style="{left: marquee.x + 'px', top: marquee.y + 'px', width: marquee.width + 'px', height: marquee.height + 'px'}"
						></div>

					</div>

					<div v-if="controller" class="ac_canvas_tools">
						<div class="ac_tool_button" title="${tl('animation_controllers.zoom_fit')} (Home)" @click="zoomToFit()">
							<i class="material-icons">zoom_out_map</i>
						</div>
						<div class="ac_tool_button" title="${tl('animation_controllers.auto_layout')}" @click="autoLayout()">
							<i class="material-icons">account_tree</i>
						</div>
						<div class="ac_tool_button" :title="'${tl('action.add_animation_controller_state')}'" @click="addState()">
							<i class="material-icons">add</i>
						</div>
					</div>

					<div v-if="controller && !controller.states.length" id="animation_controller_presets">
						<h4>${tl('animation_controllers.select_preset')}</h4>
						<ul>
							<li v-for="preset in presets" :key="preset.name" @click="loadPreset(preset)">
								{{ preset.name }}
							</li>
						</ul>
					</div>
				</div>
			`
		}
	})
	
	let blend_time_edit_state = null;
	let molang_edit_value;
	let class_name = 'animation_controller_text_input';
	function isTarget(target) {
		return target?.classList?.contains(class_name) || target?.parentElement?.parentElement?.classList?.contains(class_name);
	}
	document.addEventListener('focus', event => {
		if (isTarget(event.target)) {
			molang_edit_value = event.target.value || event.target.innerText;
			let state_uuid = document.querySelector('.controller_state:focus-within')?.attributes.uuid?.value;
			let state = state_uuid && AnimationController.selected?.states.find(s => s.uuid == state_uuid);
			if (state) {
				Undo.initEdit({animation_controller_state: state});
			}
		}
	}, true)
	document.addEventListener('focusout', event => {
		if (isTarget(event.target)) {

			let val = event.target.value || event.target.innerText;
			if (val != molang_edit_value) {
				Undo.finishEdit('Edit animation controller molang');
			} else {
				Undo.cancelEdit(false);
			}
		}
	})
})

Object.defineProperty(AnimationItem, 'all', {
	get() {
		return [...Animation.all, ...AnimationController.all]
	},
	set() {
		console.warn('AnimationItem.all is read-only')
	}
})
Object.defineProperty(AnimationItem, 'selected', {
	get() {
		return Animation.selected || AnimationController.selected
	},
	set(item) {
		if (item instanceof Animation) {
			Animation.selected = item;
			AnimationController.selected = null;
		} else {
			Animation.selected = null;
			AnimationController.selected = item;
		}
	}
})

BARS.defineActions(function() {
	// 反馈#93：AC 面板画布的鼠标操作接入 Keybind 体系，可在 设置>键盘 中自定义。默认键位与原有硬编码行为一致。
	// 修饰键默认用具体 false 而非 null，否则该修饰键会被锁定为“忽略”，用户无法在键盘设置里录制带修饰键的组合。
	new KeybindItem('ac_move_state', {
		category: 'animation',
		keybind: new Keybind({key: 1}, {multi_select: 'ctrl'}),
		variations: {
			multi_select: {name: 'keybind.ac_move_state.multi_select'},
		}
	})
	new KeybindItem('ac_pan_canvas', {
		category: 'animation',
		keybind: new Keybind({key: 1})
	})
	// 反馈#108：AC 画布视图缩放独立快捷键（此前硬编码复用 UV 编辑器的缩放键，无法单独自定义）
	new KeybindItem('ac_scroll_zoom', {
		category: 'animation',
		keybind: new Keybind({key: 1001, ctrl: true})
	})
	new KeybindItem('ac_box_select', {
		category: 'animation',
		keybind: new Keybind({key: 1, shift: true})
	})
	new KeybindItem('ac_create_connection', {
		category: 'animation',
		keybind: new Keybind({key: 1})
	})
	new KeybindItem('ac_adjust_curvature', {
		category: 'animation',
		keybind: new Keybind({key: 1})
	})
	new Action('add_animation_controller', {
		icon: 'post_add',
		category: 'animation',
		condition: {modes: ['animate'], features: ['animation_controllers']},
		click() {
			let controller = new AnimationController({
				name: 'controller.animation.' + (Project.geometry_name||'model') + '.new',
				saved: false
			}).add(true).propertiesDialog();
			Blockbench.dispatchEvent('add_animation_controller', {animation_controller: controller})
		}
	})
	new Action('add_animation_controller_state', {
		icon: 'add_box',
		category: 'animation',
		condition: {modes: ['animate'], features: ['animation_controllers'], method: () => AnimationController.selected},
		click() {
			Undo.initEdit({animation_controllers: [AnimationController.selected]})
			let state = new AnimationControllerState(AnimationController.selected, {}).select().scrollTo().rename();
			Blockbench.dispatchEvent('select_animation_controller_state', {animation_controller: AnimationController.selected, state});
			Undo.finishEdit('Add animation controller state')

		}
	})
	new BarSelect('animation_controller_preview_mode', {
		options: {
			paused: {name: true, icon: 'pause'},
			manual: {name: true, icon: 'back_hand'},
			play: {name: true, icon: 'play_arrow'},
		},
		icon_mode: true,
		value: 'manual',
		category: 'animation',
		keybind: new Keybind({key: 32}),
		condition: {modes: ['animate'], selected: {animation_controller: true}}
	})
	new NumSlider('slider_animation_controller_speed', {
		category: 'animation',
		condition: {modes: ['animate'], selected: {animation_controller: true}},
		settings: {
			default: 100,
			min: 0,
			max: 10000
		},
		get: function() {
			return AnimationController.playback_speed;
		},
		change: function(modify) {
			AnimationController.playback_speed = limitNumber(modify(AnimationController.playback_speed), 0, 10000);
			Panels.animation_controllers.inside_vue.playback_speed = AnimationController.playback_speed;
		},
		getInterval: (e) => {
			var val = BarItems.slider_animation_controller_speed.get()
			if (e.shiftKey) {
				if (val < 50) {
					return 10;
				} else {
					return 50;
				}
			}
			if (e.ctrlOrCmd) {
				if (val < 500) {
					return 1;
				} else {
					return 10;
				}
			}
			if (val < 10) {
				return 1;
			} else if (val < 50) {
				return 5;
			} else if (val < 160) {
				return 10;
			} else if (val < 300) {
				return 20;
			} else if (val < 1000) {
				return 50;
			} else {
				return 500;
			}
		}
	})
})

Object.assign(window, {AnimationController, AnimationControllerState});
