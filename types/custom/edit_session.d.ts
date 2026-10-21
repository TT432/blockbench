/// <reference types="./blockbench"/>

/**
 * An edit session instance. Edit sessions can be attached to a project to collaborate on it with multiple users via P2P connections.
 */
declare class EditSession {
	/**
	 * Creates an edit session for the current project
	 */
	constructor()

	/**
	 * Whether the session is currently active
	 */
	active: boolean
	/**
	 * Whether this client hosts the session
	 */
	hosting: boolean
	/**
	 * Clients of the session, indexed by client ID
	 */
	clients: {}
	/**
	 * Number of clients that are connected to the session
	 */
	client_count: number
	/**
	 * Received data that is waiting to be processed
	 */
	data_queue: []
	/**
	 * Messages of the session chat
	 */
	chat_history: []
	/**
	 * Project that the session is attached to
	 */
	Project: ModelProject | null

	/**
	 * Updates the client count and broadcasts it to all clients
	 */
	updateClientCound(): void
	/**
	 * Starts hosting a new session
	 * @param username Name that is shown to the other clients
	 */
	start(username?: string): void
	/**
	 * Joins an existing session with the given token
	 * @param username Name that is shown to the other clients
	 * @param token Token of the session to join
	 */
	join(username: string, token: string): void
	/**
	 * Leaves the session and closes its peer connection
	 */
	quit(): void
	/**
	 * Sets whether the session is active and updates the interface
	 */
	setState(active: boolean): void
	/**
	 * Copies the session token, or reads it from the clipboard when the session is inactive
	 */
	copyToken(): void
	/**
	 * Sends the current model to all clients of the session
	 * @param force Whether to force clients to replace their model
	 */
	initNewModel(force?: boolean): void
	/**
	 * Registers the data listener on a peer connection
	 */
	initConnection(conn: any): void
	/**
	 * Sends data of the given type to all clients
	 * @param type Type of the data
	 * @param data Data to send
	 */
	sendAll(type: string, data: any): void
	/**
	 * Sends an undo entry to all clients
	 */
	sendEdit(entry: UndoEntry): void
	/**
	 * Receives data from a peer connection and dispatches the session event for it
	 */
	receiveData(tag: any): void
	/**
	 * Applies received data to the project
	 */
	processData(tag: any): void
	/**
	 * Processes the data that was queued while the session was not attached to the current project
	 */
	catchUp(): void
	/**
	 * Send a chat message
	 * @param text Text to send. If omitted, the current text in the chat panel input is sent
	 */
	sendChat(text?: string): void
	/**
	 * Adds a message to the session chat and returns the created message
	 */
	addChatMessage(message: any): any
	/**
	 * Sends a chat message from this client, or broadcasts it to all clients when hosting
	 */
	processChatMessage(data: any): void
	/**
	 * Token of the session that is hosted or joined
	 */
	static token?: string
}
