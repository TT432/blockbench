/**
 * Print the release notes for one version, taken from the single source of
 * truth: the COMMUNITY_CHANGELOG array in js/interface/community_changelog.ts
 * (the same data the in-app "更新日志" dialog renders).
 *
 * Why this exists: the release workflow used to read the annotated tag message
 * (`git tag -l --format='%(contents)'`). The release process tags with a plain
 * `git tag vX.Y.Z`, which makes `%(contents)` return the *commit message* —
 * shipped releases (v5.3.40/41/42/44) had "chore: bump version to X + 更新日志"
 * as their changelog, both on the GitHub release page and in the in-app update
 * dialogs (feedback #180). Reading the changelog array makes the published
 * notes independent of tag type.
 *
 * Usage:
 *   node scripts/changelog_notes.js [--version x.y.z] [--list]
 *
 * Exit codes: 0 = notes printed, 1 = version entry missing (release must stop),
 * 2 = changelog source unparsable.
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = path.join('js', 'interface', 'community_changelog.ts');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
	if (process.argv[i].startsWith('--')) {
		const next = process.argv[i + 1];
		if (next && !next.startsWith('--')) { args[process.argv[i].slice(2)] = next; i++; }
		else args[process.argv[i].slice(2)] = true;
	}
}

/** Slice the `[...]` literal that follows `COMMUNITY_CHANGELOG` and evaluate it. */
function readEntries() {
	const src = fs.readFileSync(SOURCE, 'utf-8');
	const decl = /const\s+COMMUNITY_CHANGELOG\b/.exec(src);
	if (!decl) throw new Error(`COMMUNITY_CHANGELOG declaration not found in ${SOURCE}`);
	const anchor = decl.index;
	// Skip the `ChangelogEntry[]` type annotation: the literal starts at `= [`.
	const assign = /=/.exec(src.slice(anchor));
	if (!assign) throw new Error(`assignment not found in ${SOURCE}`);
	const start = src.indexOf('[', anchor + assign.index);
	if (start === -1) throw new Error(`array literal not found in ${SOURCE}`);
	let depth = 0, end = -1, in_string = null, escaped = false;
	for (let i = start; i < src.length; i++) {
		const ch = src[i];
		if (in_string) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === in_string) in_string = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') { in_string = ch; continue; }
		if (ch === '[') depth++;
		else if (ch === ']') {
			depth--;
			if (depth === 0) { end = i; break; }
		}
	}
	if (end === -1) throw new Error(`unterminated array literal in ${SOURCE}`);
	const literal = src.slice(start, end + 1);
	// The literal is data only (no identifiers, calls or comments), so evaluating
	// it is equivalent to JSON.parse with single quotes / trailing commas allowed.
	const entries = new Function(`return (${literal});`)();
	if (!Array.isArray(entries)) throw new Error(`${SOURCE} did not evaluate to an array`);
	return entries;
}

function formatEntry(entry) {
	// No version heading: both consumers already print the version (release title,
	// dialog title "更新到 Blockbench X").
	const lines = [];
	for (const change of entry.changes || []) lines.push(`- ${change}`);
	return lines.join('\n');
}

let entries;
try {
	entries = readEntries();
} catch (err) {
	console.error(`[changelog_notes] ${err.message}`);
	process.exit(2);
}

if (args.list) {
	for (const entry of entries) console.log(entry.version);
	process.exit(0);
}

const version = String(args.version || JSON.parse(fs.readFileSync('package.json', 'utf-8')).version);
const entry = entries.find(e => e.version === version);
if (!entry) {
	console.error(`[changelog_notes] no COMMUNITY_CHANGELOG entry for ${version} in ${SOURCE}`);
	console.error(`[changelog_notes] known versions: ${entries.map(e => e.version).join(', ')}`);
	process.exit(1);
}
if (!(entry.changes || []).length) {
	console.error(`[changelog_notes] entry for ${version} has no changes`);
	process.exit(1);
}
console.log(formatEntry(entry));
