/**
 * Hot payload updater for the community fork.
 *
 * Instead of replacing the installed app (electron-updater / NSIS), updates are
 * downloaded as a self-contained "payload" (index.html + static bundles) into
 * the userData directory. The main process loads index.html from the payload
 * directory when a verified payload is present, and falls back to the builtin
 * copy inside the asar otherwise. Applying an update therefore only requires
 * reloading the page (loadURL) - no process restart, no installer.
 *
 * All network access uses Electron's `net` module (Chromium network stack),
 * so system proxy settings and PAC scripts are honored automatically.
 */
import { app, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

/**
 * Version of the main-process update protocol. Manifests requiring a higher
 * main_version cannot be applied as hot updates and fall back to a full install.
 */
export const MAIN_VERSION = 1;

export const DEFAULT_MANIFEST_URL = 'https://github.com/TT432/blockbench/releases/latest/download/update.json';
export const RELEASES_PAGE_URL = 'https://github.com/TT432/blockbench/releases/latest';

function getManifestURL() {
	return process.env.BB_UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL;
}
function payloadRoot() {
	return path.join(app.getPath('userData'), 'payload');
}
function pointerPath() {
	return path.join(payloadRoot(), 'current.json');
}
function appliedMarkerPath() {
	return path.join(app.getPath('userData'), 'update_just_applied.json');
}

/**
 * Numeric semver-ish comparison. Returns -1, 0 or 1.
 */
export function compareVersions(a, b) {
	const pa = String(a).split(/[.\-+]/);
	const pb = String(b).split(/[.\-+]/);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = parseInt(pa[i]) || 0;
		const nb = parseInt(pb[i]) || 0;
		if (na !== nb) return na < nb ? -1 : 1;
	}
	return 0;
}

function sha512File(file_path) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha512');
		const stream = fs.createReadStream(file_path);
		stream.on('data', d => hash.update(d));
		stream.on('end', () => resolve(hash.digest('hex')));
		stream.on('error', reject);
	});
}

function writeJSONAtomic(file_path, data) {
	const tmp = file_path + '.tmp';
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
	fs.renameSync(tmp, file_path);
}

/**
 * GET a URL and return the parsed JSON body. Follows redirects (required for
 * GitHub release asset URLs).
 */
function fetchJSON(url_string) {
	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = (err) => { if (!settled) { settled = true; reject(err); } };
		const request = net.request({ url: url_string });
		request.on('redirect', () => request.followRedirect());
		request.on('response', (response) => {
			if (response.statusCode < 200 || response.statusCode >= 300) {
				fail(new Error('manifest_http_' + response.statusCode));
				request.abort();
				return;
			}
			const chunks = [];
			let size = 0;
			response.on('data', (chunk) => {
				size += chunk.length;
				if (size > 4 * 1024 * 1024) {
					fail(new Error('manifest_too_large'));
					request.abort();
					return;
				}
				chunks.push(chunk);
			});
			response.on('end', () => {
				if (settled) return;
				settled = true;
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
				} catch (err) {
					reject(new Error('manifest_invalid_json'));
				}
			});
			response.on('error', fail);
		});
		request.on('error', fail);
		request.end();
	});
}

/**
 * Stream-download a URL to a file, reporting progress. Aborts as 'cancelled'
 * when token.cancelled is set (via token.request.abort()).
 */
function downloadFile(url_string, dest_path, token, onProgress) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let out = null;
		const fail = (err) => {
			if (out) out.destroy();
			if (!settled) { settled = true; reject(err); }
		};
		const succeed = () => { if (!settled) { settled = true; resolve(); } };
		const request = net.request({ url: url_string });
		token.request = request;
		request.on('redirect', () => request.followRedirect());
		request.on('response', (response) => {
			if (response.statusCode < 200 || response.statusCode >= 300) {
				fail(new Error('download_http_' + response.statusCode));
				request.abort();
				return;
			}
			const total = parseInt(response.headers['content-length']) || 0;
			let received = 0;
			out = fs.createWriteStream(dest_path);
			out.on('error', fail);
			response.on('data', (chunk) => {
				received += chunk.length;
				out.write(chunk);
				if (onProgress) {
					onProgress({
						received,
						total,
						percent: total ? (received / total * 100) : null
					});
				}
			});
			response.on('end', () => {
				out.end(() => {
					if (token.cancelled) fail(new Error('cancelled'));
					else succeed();
				});
			});
			response.on('error', fail);
		});
		request.on('abort', () => fail(new Error('cancelled')));
		request.on('error', (err) => fail(token.cancelled ? new Error('cancelled') : err));
		request.end();
	});
}

/**
 * Minimal zip extractor (stored + deflate entries). Implemented in-process with
 * node:zlib so updates do not depend on whatever `tar` happens to be on PATH.
 */
function extractZip(zip_path, dest_dir) {
	const data = fs.readFileSync(zip_path);
	let eocd = -1;
	for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
		if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error('extract_failed: not a zip file');
	const entry_count = data.readUInt16LE(eocd + 10);
	const root = path.resolve(dest_dir);
	let offset = data.readUInt32LE(eocd + 16);
	for (let i = 0; i < entry_count; i++) {
		if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error('extract_failed: bad central directory');
		const method = data.readUInt16LE(offset + 10);
		const compressed_size = data.readUInt32LE(offset + 20);
		const name_len = data.readUInt16LE(offset + 28);
		const extra_len = data.readUInt16LE(offset + 30);
		const comment_len = data.readUInt16LE(offset + 32);
		const local_offset = data.readUInt32LE(offset + 42);
		const name = data.toString('utf-8', offset + 46, offset + 46 + name_len);
		const target = path.resolve(root, name);
		if (target != root && !target.startsWith(root + path.sep)) {
			throw new Error('extract_failed: unsafe entry path ' + name);
		}
		if (name.endsWith('/')) {
			fs.mkdirSync(target, { recursive: true });
		} else {
			const local_name_len = data.readUInt16LE(local_offset + 26);
			const local_extra_len = data.readUInt16LE(local_offset + 28);
			const data_start = local_offset + 30 + local_name_len + local_extra_len;
			const raw = data.subarray(data_start, data_start + compressed_size);
			let content;
			if (method === 0) content = Buffer.from(raw);
			else if (method === 8) content = zlib.inflateRawSync(raw);
			else throw new Error('extract_failed: unsupported compression method ' + method + ' for ' + name);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, content);
		}
		offset += 46 + name_len + extra_len + comment_len;
	}
}

/**
 * Verify every file listed in payload-manifest.json against its sha512.
 */
async function verifyPayloadDir(dir) {
	const manifest_path = path.join(dir, 'payload-manifest.json');
	let data;
	try {
		data = JSON.parse(fs.readFileSync(manifest_path, 'utf-8'));
	} catch (err) {
		throw new Error('payload_manifest_missing');
	}
	if (!data.files || typeof data.files !== 'object') throw new Error('payload_manifest_invalid');
	const root = path.resolve(dir);
	for (const rel of Object.keys(data.files)) {
		const file_path = path.resolve(dir, rel);
		if (!file_path.startsWith(root + path.sep)) throw new Error('payload_path_invalid: ' + rel);
		if (!fs.existsSync(file_path)) throw new Error('payload_file_missing: ' + rel);
		const actual = await sha512File(file_path);
		if (actual !== String(data.files[rel]).toLowerCase()) {
			throw new Error('payload_file_corrupt: ' + rel);
		}
	}
	if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('payload_missing_index');
}

/**
 * Resolve which index.html the app should load: the verified external payload
 * if present, otherwise the builtin fallback. Verification is hashed once per
 * payload and cached in current.json (manifest_sha), so regular startups only
 * hash a single small file.
 */
export async function resolvePayloadIndex(fallback_index) {
	try {
		const pointer = JSON.parse(fs.readFileSync(pointerPath(), 'utf-8'));
		if (!pointer.version || typeof pointer.version !== 'string') throw new Error('pointer_invalid');
		const dir = path.join(payloadRoot(), pointer.version);
		const manifest_path = path.join(dir, 'payload-manifest.json');
		if (!fs.existsSync(manifest_path)) throw new Error('payload_manifest_missing');
		const current_manifest_sha = await sha512File(manifest_path);
		if (!(pointer.verified && pointer.manifest_sha === current_manifest_sha)) {
			await verifyPayloadDir(dir);
			writeJSONAtomic(pointerPath(), { version: pointer.version, verified: true, manifest_sha: current_manifest_sha });
		}
		const index_path = path.join(dir, 'index.html');
		if (!fs.existsSync(index_path)) throw new Error('payload_missing_index');
		return { index_path, source: 'payload', version: pointer.version };
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.warn('[update] External payload invalid, falling back to builtin:', err.message);
		}
		try { fs.rmSync(pointerPath(), { force: true }); } catch (e) {}
		return { index_path: fallback_index, source: 'builtin', version: null };
	}
}

/**
 * Remove leftover temp files from interrupted downloads.
 */
export function cleanupTemp() {
	try {
		const root = payloadRoot();
		if (!fs.existsSync(root)) return;
		for (const entry of fs.readdirSync(root)) {
			if (entry.startsWith('.tmp')) {
				fs.rmSync(path.join(root, entry), { recursive: true, force: true });
			}
		}
	} catch (err) {}
}

function pruneOldVersions(keep_version) {
	try {
		const root = payloadRoot();
		const versions = fs.readdirSync(root, { withFileTypes: true })
			.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== keep_version)
			.map(e => ({ name: e.name, mtime: fs.statSync(path.join(root, e.name)).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime);
		// Keep the most recent previous version as an emergency copy
		for (const old of versions.slice(1)) {
			fs.rmSync(path.join(root, old.name), { recursive: true, force: true });
		}
	} catch (err) {}
}

let last_manifest = null;
let active_apply = null;

/**
 * Check the update manifest. Returns {type: 'none' | 'hot' | 'cold', ...}.
 */
export async function checkForUpdate(current_version) {
	const manifest = await fetchJSON(getManifestURL());
	if (!manifest || typeof manifest.version !== 'string' || !manifest.payload || !manifest.payload.url || !manifest.payload.sha512) {
		throw new Error('manifest_invalid');
	}
	if (compareVersions(manifest.version, current_version) <= 0) {
		return { type: 'none' };
	}
	if ((manifest.main_version ?? 1) > MAIN_VERSION) {
		return { type: 'cold', version: manifest.version, url: RELEASES_PAGE_URL };
	}
	if (manifest.min_app_version && compareVersions(current_version, manifest.min_app_version) < 0) {
		return { type: 'cold', version: manifest.version, url: RELEASES_PAGE_URL };
	}
	last_manifest = manifest;
	return {
		type: 'hot',
		manifest: {
			version: manifest.version,
			changelog: manifest.changelog || '',
			size: manifest.payload.size || 0
		}
	};
}

async function applyUpdate(manifest, onProgress, token) {
	const version = manifest.version;
	const root = payloadRoot();
	fs.mkdirSync(root, { recursive: true });
	cleanupTemp();
	const zip_path = path.join(root, `.tmp-${version}.zip`);
	const extract_dir = path.join(root, `.tmp-payload-${version}`);
	const final_dir = path.join(root, version);
	try {
		await downloadFile(manifest.payload.url, zip_path, token, onProgress);
		if (token.cancelled) throw new Error('cancelled');

		const zip_sha = await sha512File(zip_path);
		if (zip_sha !== String(manifest.payload.sha512).toLowerCase()) {
			throw new Error('hash_mismatch');
		}
		if (token.cancelled) throw new Error('cancelled');

		fs.mkdirSync(extract_dir, { recursive: true });
		await extractZip(zip_path, extract_dir);
		if (token.cancelled) throw new Error('cancelled');

		await verifyPayloadDir(extract_dir);

		fs.rmSync(final_dir, { recursive: true, force: true });
		fs.renameSync(extract_dir, final_dir);

		const manifest_file_sha = await sha512File(path.join(final_dir, 'payload-manifest.json'));
		writeJSONAtomic(pointerPath(), { version, verified: true, manifest_sha: manifest_file_sha });
		writeJSONAtomic(appliedMarkerPath(), { version, changelog: manifest.changelog || '', date: Date.now() });
		pruneOldVersions(version);
		return { version, index_path: path.join(final_dir, 'index.html') };
	} finally {
		try { fs.rmSync(zip_path, { force: true }); } catch (e) {}
		try { fs.rmSync(extract_dir, { recursive: true, force: true }); } catch (e) {}
	}
}

/**
 * Start applying the manifest from the last successful check.
 * Returns {promise, cancel}. A second call while a download is running
 * returns the in-flight operation.
 */
export function startApply(onProgress) {
	if (active_apply) return active_apply;
	if (!last_manifest) {
		return { promise: Promise.reject(new Error('no_update_checked')), cancel() {} };
	}
	const token = { cancelled: false, request: null };
	const promise = applyUpdate(last_manifest, onProgress, token);
	active_apply = {
		promise,
		cancel() {
			token.cancelled = true;
			if (token.request) token.request.abort();
		}
	};
	promise.finally(() => { active_apply = null; }).catch(() => {});
	return active_apply;
}

/**
 * Read and delete the "update just applied" marker. Only the first caller
 * (the main window) receives the changelog.
 */
export function takeAppliedUpdate() {
	try {
		const data = JSON.parse(fs.readFileSync(appliedMarkerPath(), 'utf-8'));
		fs.rmSync(appliedMarkerPath(), { force: true });
		return data;
	} catch (err) {
		return null;
	}
}
