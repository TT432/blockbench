import MolangParser from "molangjs"

/** The constructor type of the `molangjs` parser. */
type MolangParserClass = typeof MolangParser
/** Declares the Molang parser constructor in the global scope. */
declare global {
	/** The `molangjs` parser constructor, made available as a global declaration. */
	const MolangParser: MolangParserClass
}

/** Describes a Molang expression found in the project. */
declare interface MolangExpression {
	/** The animation that owns the expression, when it belongs to an animation. */
	animation: BBAnimation
	/** The animator that owns the expression, when it belongs to a keyframe. */
	animator: BoneAnimator
	/** The animator channel of the keyframe, when the expression belongs to a keyframe. */
	channel: string
	/** The property key the expression is stored in. */
	key: string
	/** The keyframe that contains the expression, when it belongs to a keyframe. */
	kf: BBKeyframe
	/** The kind of element the expression belongs to, such as `animation`, `keyframe` or `controller`. */
	type: string
	/** The Molang expression text. */
	value: string
}

/** Collects the Molang expressions of all animations and animation controllers in the project. */
declare function getAllMolangExpressions(): MolangExpression[]

/** Provides autocompletion for Molang expressions. */
declare namespace MolangAutocomplete {
	/** Represents the result of a Molang autocomplete operation. */
	interface MolangAutocompleteResult {
		/** The text to insert. */
		text: string
		/** The label to display in the autocomplete menu. */
		label?: string
		/** The number of characters to overlap with the incomplete string. */
		overlap: number
		/** The suggestion priority. A higher number means it will be suggested first. */
		priority?: number
	}

	/** Represents a root token. */
	interface RootToken {
		/** The ID of the new root token. */
		id: string
		/** The arguments of the root token. */
		arguments?: string[]
		/** The suggestion priority of the root token. A higher number means it will be suggested first. */
		priority?: number
		/** Optional usage description, shown in the Molang manual. */
		description?: string
	}

	/** Represents a query. */
	interface Query {
		/** The ID of the new query. */
		id: string
		/** The arguments of the query. */
		arguments?: string[]
		/** The suggestion priority of the query. A higher number means it will be suggested first. */
		priority?: number
		/** Optional usage description, shown in the Molang manual. */
		description?: string
	}

	/** Represents the options for a namespace. */
	interface NamespaceOptions {
		/** The ID of the new namespace. */
		id: string
		/** The shorthand of the new namespace. Eg. `q` for `query`. */
		shorthand?: string
		/** The suggestion priority of the namespace. A higher number means it will be suggested first. */
		priority?: number
	}

	/** Represents the options for a namespace union. */
	interface NamespaceUnionOptions {
		/** The ID of the new namespace. */
		id: string
		/** The shorthand of the new namespace. Eg. `q` for `query`. */
		shorthand?: string
		/** The suggestion priority of the namespace. A higher number means it will be suggested first. */
		priority?: number
	}

	/** A group of Molang queries that share an ID and an optional shorthand, such as `query` / `q`. */
	class Namespace {
		/** The ID of the namespace. */
		id: string
		/** The shorthand of the namespace, if one was configured. */
		shorthand: string
		/** The queries in the namespace, keyed by query ID. */
		queries: Map<string, Query>
		/** The getter functions in the namespace, keyed by getter ID; their results are recomputed for each completion request. */
		queryGetters: Map<string, () => Query[]>
		/** Creates a new namespace. */
		constructor(options: NamespaceOptions)
		/** Adds a new query to the namespace and returns the namespace for chaining. */
		addQuery(query: Query): Namespace
		/** Checks whether the namespace contains the query with the given ID. */
		hasQuery(queryID: string): boolean
		/** Removes the query with the given ID and reports whether it existed. */
		removeQuery(queryID: string): boolean
		/** Adds a getter function that returns dynamically generated queries. */
		addQueryGetter(id: string, getter: (incomplete: string) => Query[]): Namespace
		/** Removes the getter function with the given ID. */
		removeQueryGetter(id: string): void
		/** Creates a new namespace that merges this namespace with another; queries with the same ID keep the other namespace's version. */
		createUnion(other: Namespace, options?: NamespaceUnionOptions): Namespace
		/** Returns the queries whose ID starts with `incomplete`. */
		getPossibleQueries(expression: string, incomplete: string, recursive?: boolean): Query[]
	}

	/** Represents the options for a context. */
	interface MolangAutocompleteContextOptions {
		/** The ID of the new context. */
		id: string
		/** The root tokens in the new context. */
		rootTokens?: RootToken[]
		/** The inherited context. */
		inheritedContext?: Context
	}

	/** A set of namespaces and root tokens used to autocomplete Molang in one editing location. */
	class Context {
		/** All contexts created so far; `delete()` removes a context from this list. */
		static all: Context[]
		/** The ID of the context. */
		id: string
		/** The root tokens in the context, keyed by token ID. */
		rootTokens: Map<string, RootToken>
		/** The namespaces in the context, keyed by namespace ID. */
		namespaces: Map<string, Namespace>
		/** The context that contributes additional namespaces and root tokens, when one was configured. */
		inheritedContext: Context
		/** Creates a new context and adds it to `Context.all`. */
		constructor(options: MolangAutocompleteContextOptions)
		/** Adds a new root token to the context and returns the context for chaining. */
		addRootToken(token: RootToken): Context
		/** Returns the root token with the given ID. */
		getRootToken(tokenID: string): RootToken
		/** Removes the root token with the given ID and reports whether it existed. */
		removeRootToken(tokenID: string): boolean
		/** Checks whether the context or an inherited context contains the namespace with the given ID. */
		hasNamespace(namespaceID: string, recursive?: boolean): boolean
		/** Adds a namespace to the context, merging it with an existing namespace of the same ID when `createUnion` is not `false`. */
		addNamespace(namespace: Namespace, createUnion?: boolean): Context
		/** Returns the namespace with the given ID, merged with the inherited namespace of the same ID. */
		getNamespace(namespaceID: string, recursive?: boolean): Namespace
		/** Removes a namespace defined in this context; namespaces of inherited contexts are unaffected. */
		removeNamespace(namespaceID: string): boolean
		/** Returns the namespaces whose ID or shorthand starts with `incomplete`. */
		getPossibleNamespaces(incomplete: string, recursive?: boolean): Namespace[]
		/** Returns the root tokens whose ID starts with `incomplete`. */
		getPossibleRootTokens(incomplete: string, recursive?: boolean): RootToken[]
		/** Attempts to autocomplete the given text from the given position in the text. */
		autocomplete(text: string, position: number): MolangAutocompleteResult[]
		/** Removes the context from `Context.all`. */
		delete(): void
	}

	/** The context with the Molang keywords and default namespaces; its `new` / `n` namespace is filled by queries generated from the project's and plugins' custom Molang definitions. */
	const DefaultContext: Context
	/** The autocomplete context used for keyframe Molang values. */
	const KeyframeContext: Context
	/** The autocomplete context used for animation controller Molang; it adds `query.all_animations_finished` and `query.any_animation_finished`. */
	const AnimationControllerContext: Context
	/** The autocomplete context used for animation Molang properties. */
	const AnimationContext: Context
	/** The autocomplete context used for variable placeholders; it adds the `toggle`, `slider` and `impulse` root tokens. */
	const VariablePlaceholdersContext: Context
	/** The autocomplete context used for bone Bedrock entity bindings. */
	const BedrockBindingContext: Context
}
