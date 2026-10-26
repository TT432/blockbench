const DATABASE_NAME = 'preview_scene_cache';
const STORE_NAME = 'resources';

let database_promise: Promise<IDBDatabase> | null = null;
const resource_urls = new Map<string, string>();

function openDatabase(): Promise<IDBDatabase> {
	if (database_promise) return database_promise;
	const {promise, resolve, reject} = Promise.withResolvers<IDBDatabase>();
	database_promise = promise;
	function fail(error: unknown) {
		if (database_promise === promise) database_promise = null;
		reject(error);
	}
	try {
		const request = indexedDB.open(DATABASE_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => fail(request.error);
		request.onblocked = () => fail(new Error('Preview scene cache upgrade blocked'));
	} catch (error) {
		fail(error);
	}
	return promise;
}

async function readCachedResource(url: string): Promise<Blob | undefined> {
	const database = await openDatabase();
	const {promise, resolve, reject} = Promise.withResolvers<Blob | undefined>();
	const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(url);
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error);
	return promise;
}

async function cacheResource(url: string, blob: Blob): Promise<void> {
	const database = await openDatabase();
	const {promise, resolve, reject} = Promise.withResolvers<void>();
	const transaction = database.transaction(STORE_NAME, 'readwrite');
	transaction.objectStore(STORE_NAME).put(blob, url);
	transaction.oncomplete = () => resolve();
	transaction.onerror = () => reject(transaction.error);
	transaction.onabort = () => reject(transaction.error);
	return promise;
}

/**
 * Returns a process-lifetime object URL for a scene resource. Bytes are cached by
 * their complete source URL, so later launches and offline loads never need the CDN.
 */
export async function getPreviewSceneResource(url: string): Promise<string> {
	const existing = resource_urls.get(url);
	if (existing) return existing;

	let blob: Blob | undefined;
	try {
		blob = await readCachedResource(url);
	} catch (error) {
		console.warn('Failed to read preview scene cache', error);
	}
	if (!blob) {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Failed to load preview scene resource: ${response.status} ${url}`);
		blob = await response.blob();
		try {
			await cacheResource(url, blob);
		} catch (error) {
			console.warn('Failed to write preview scene cache', error);
		}
	}
	const object_url = URL.createObjectURL(blob);
	resource_urls.set(url, object_url);
	return object_url;
}
