/**
 * A subset of `node:fs` that is scoped to a directory approved for the requesting plugin.
 */
type ScopedFS = Pick<typeof import("node:fs"),
	"access" |
	"accessSync" |
	"copyFile" |
	"copyFileSync" |
	"readFile" |
	"readFileSync" |
	"writeFile" |
	"writeFileSync" |
	"appendFile" |
	"appendFileSync" |
	"existsSync" |
	"mkdir" |
	"mkdirSync" |
	"readdir" |
	"readdirSync" |
	"rename" |
	"renameSync" |
	"rm" |
	"rm" |
	"rmdir" |
	"rmdirSync" |
	"unlink" |
	"unlinkSync" |
	"stat" |
	"statSync" |
	"watchFile" |
	"unwatchFile" |
	"watch"
> & {
	/** Asynchronous variants of the scoped file system methods. */
	promises: Pick<typeof import("node:fs").promises, 
		"access" |
		"copyFile" |
		"readFile" |
		"writeFile" |
		"appendFile" |
		"mkdir" |
		"readdir" |
		"rename" |
		"rm" |
		"rmdir" |
		"unlink" |
		"stat" |
		"watch"
	>
}
/**
 * Options for the native module permission dialog.
 */
interface RequireDialogOptions {
	/** Extra text shown in the permission dialog. */
	message?: string
	/** Whether denying the permission is optional; when `false`, denying can offer to disable the plugin. */
	optional?: boolean
}
/**
 * Requests access to the native `fs` module, scoped to a directory.
 * @param module The module name
 * @param options The directory scope and permission dialog options
 */
declare function requireNativeModule(module: 'fs', options?: {
	/** The directory that the file system access is scoped to. */
	scope?: string
} & RequireDialogOptions): ScopedFS | undefined
/** Returns the native `path` module. */
declare function requireNativeModule(module: 'path'): typeof import("node:path");
/** Returns the native `crypto` module. */
declare function requireNativeModule(module: 'crypto'): typeof import("node:crypto");
/** Returns the native `events` module. */
declare function requireNativeModule(module: 'events'): typeof import("node:events");
/** Returns the native `zlib` module. */
declare function requireNativeModule(module: 'zlib'): typeof import("node:zlib");
/** Returns the native `timers` module. */
declare function requireNativeModule(module: 'timers'): typeof import("node:timers");
/** Returns the native `url` module. */
declare function requireNativeModule(module: 'url'): typeof import("node:url");
/** Returns the native `string_decoder` module. */
declare function requireNativeModule(module: 'string_decoder'): typeof import("node:string_decoder");
/** Returns the native `stream` module. */
declare function requireNativeModule(module: 'stream'): typeof import("node:stream");
/** Returns the native `perf_hooks` module. */
declare function requireNativeModule(module: 'perf_hooks'): typeof import("node:perf_hooks");
/** Returns the native `querystring` module. */
declare function requireNativeModule(module: 'querystring'): typeof import("node:querystring");
/** Requests access to the native `child_process` module. */
declare function requireNativeModule(module: 'child_process', options?: RequireDialogOptions): (typeof import("node:child_process")) | undefined;
/** Requests access to the native `electron` module. */
declare function requireNativeModule(module: 'electron', options?: RequireDialogOptions): (typeof import("node:electron")) | undefined;
/** Requests access to the native `https` module. */
declare function requireNativeModule(module: 'https', options?: RequireDialogOptions): (typeof import("node:https")) | undefined;
/** Requests access to the native `net` module. */
declare function requireNativeModule(module: 'net', options?: RequireDialogOptions): (typeof import("node:net")) | undefined;
/** Requests access to the native `tls` module. */
declare function requireNativeModule(module: 'tls', options?: RequireDialogOptions): (typeof import("node:tls")) | undefined;
/** Requests access to the native `util` module. */
declare function requireNativeModule(module: 'util', options?: RequireDialogOptions): (typeof import("node:util")) | undefined;
/** Requests access to the native `os` module. */
declare function requireNativeModule(module: 'os', options?: RequireDialogOptions): (typeof import("node:os")) | undefined;
/** Requests access to the native `v8` module. */
declare function requireNativeModule(module: 'v8', options?: RequireDialogOptions): (typeof import("node:v8")) | undefined;
/** Requests access to the native clipboard API. */
declare function requireNativeModule(module: 'clipboard', options?: RequireDialogOptions): (import('electron').Clipboard) | undefined;
/** Requests access to the native shell API. */
declare function requireNativeModule(module: 'shell', options?: RequireDialogOptions): (import('electron').Shell) | undefined;
