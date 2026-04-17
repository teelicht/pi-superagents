/**
 * Type declarations for the test-only ESM loader hook.
 *
 * Responsibilities:
 * - expose the loader `resolve` hook to TypeScript tests that import the `.mjs` file
 * - keep the JavaScript loader minimal while preserving strict typecheck coverage
 * - avoid runtime side effects; declaration files are erased at execution time
 */

export interface LoaderResolveContext {
	parentURL?: string;
}

export interface LoaderResolveResult {
	url: string;
	format?: string;
	shortCircuit?: boolean;
}

/**
 * Rewrite missing relative `.js` imports to matching `.ts` files during tests.
 *
 * @param specifier Import specifier passed by Node's ESM loader.
 * @param context Loader context containing the optional parent module URL.
 * @param nextResolve Delegate resolver supplied by Node.
 * @returns The delegated loader resolution result.
 */
export function resolve(
	specifier: string,
	context: LoaderResolveContext,
	nextResolve: (specifier: string, context: LoaderResolveContext) => LoaderResolveResult,
): LoaderResolveResult;
