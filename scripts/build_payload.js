/**
 * Build a hot-update payload from the current build output.
 *
 * Collects the same file set electron-builder packs into the asar
 * (package.json build.files), adds a per-file sha512 manifest, and zips it
 * with a minimal in-process zip writer (deflate via node:zlib) so the output
 * is reproducible and needs no external archiver.
 *
 * Usage:
 *   node scripts/build_payload.js [--version x.y.z] [--changelog file.md]
 *                                 [--url https://…/payload-x.y.z.zip] [--out dir]
 *
 * Outputs in <out> (default release-out/):
 *   payload-<version>.zip   upload as release asset
 *   update.json             upload as release asset (URL inside points at --url)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
	args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = args.version || pkg.version;
const out_dir = args.out || 'release-out';
const changelog = args.changelog ? fs.readFileSync(args.changelog, 'utf-8') : '';
const payload_url = args.url
	|| `https://github.com/TT432/blockbench/releases/download/v${version}/payload-${version}.zip`;

// ---- Collect the payload file set (positive entries of build.files) ----
const entries = (pkg.build.files || []).filter(e => typeof e === 'string' && !e.startsWith('!'));
/** @type {string[]} relative paths with forward slashes */
const files = [];
function walk(abs, rel) {
	const stat = fs.statSync(abs);
	if (stat.isDirectory()) {
		for (const name of fs.readdirSync(abs)) walk(path.join(abs, name), rel ? rel + '/' + name : name);
	} else if (stat.isFile()) {
		files.push(rel);
	}
}
for (const entry of entries) {
	const clean = entry.replace(/\/$/, '');
	if (!fs.existsSync(clean)) {
		console.warn(`[build_payload] warning: build.files entry missing, skipped: ${entry}`);
		continue;
	}
	walk(clean, clean);
}
if (!files.includes('index.html')) {
	console.error('[build_payload] index.html missing from payload - run npm run build-electron first');
	process.exit(1);
}
if (!files.includes('dist/bundle.js')) {
	console.error('[build_payload] dist/bundle.js missing - run npm run build-electron first');
	process.exit(1);
}
files.sort();

// ---- Per-file manifest ----
const manifest = { files: {} };
for (const rel of files) {
	manifest.files[rel] = crypto.createHash('sha512').update(fs.readFileSync(rel)).digest('hex');
}

// ---- Minimal zip writer (method 8 deflate, UTF-8 names, no dir entries) ----
const crc_table = new Int32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
	crc_table[n] = c;
}
function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = crc_table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}
function buildZip(file_list, extra_files) {
	const chunks = [];
	const central = [];
	let offset = 0;
	const dos_time = 0; // fixed timestamp (1980-01-01) for reproducible archives
	function addEntry(name, content) {
		const name_buf = Buffer.from(name, 'utf-8');
		const crc = crc32(content);
		let method = 8;
		let data = zlib.deflateRawSync(content, { level: 9 });
		if (data.length >= content.length) { method = 0; data = content; }
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);          // version needed
		local.writeUInt16LE(0x0800, 6);      // UTF-8 flag
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(dos_time, 10);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(content.length, 22);
		local.writeUInt16LE(name_buf.length, 26);
		local.writeUInt16LE(0, 28);
		chunks.push(local, name_buf, data);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE(20, 4);
		cd.writeUInt16LE(20, 6);
		cd.writeUInt16LE(0x0800, 8);
		cd.writeUInt16LE(method, 10);
		cd.writeUInt32LE(dos_time, 12);
		cd.writeUInt32LE(crc, 16);
		cd.writeUInt32LE(data.length, 20);
		cd.writeUInt32LE(content.length, 24);
		cd.writeUInt16LE(name_buf.length, 28);
		cd.writeUInt32LE(0, 30);             // extra+comment len
		cd.writeUInt32LE(0, 38);             // external attrs
		cd.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([cd, name_buf]));
		offset += 30 + name_buf.length + data.length;
	}
	for (const rel of file_list) addEntry(rel, fs.readFileSync(rel));
	for (const [name, content] of Object.entries(extra_files)) addEntry(name, content);
	const cd_buf = Buffer.concat(central);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(central.length, 8);
	eocd.writeUInt16LE(central.length, 10);
	eocd.writeUInt32LE(cd_buf.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, cd_buf, eocd]);
}

fs.mkdirSync(out_dir, { recursive: true });
const zip = buildZip(files, { 'payload-manifest.json': Buffer.from(JSON.stringify(manifest)) });
const zip_name = `payload-${version}.zip`;
const zip_path = path.join(out_dir, zip_name);
fs.writeFileSync(zip_path, zip);

const update_json = {
	version,
	main_version: 1,
	min_app_version: '5.2.1',
	changelog,
	payload: {
		url: payload_url,
		sha512: crypto.createHash('sha512').update(zip).digest('hex'),
		size: zip.length
	}
};
fs.writeFileSync(path.join(out_dir, 'update.json'), JSON.stringify(update_json, null, 2));

console.log(`[build_payload] ${files.length} files -> ${zip_path} (${(zip.length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[build_payload] update.json written, payload url: ${payload_url}`);
