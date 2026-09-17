/** Host-persisted config (settings document, mirrored to the browser). */
interface InputHistoryConfig {
    inputHistoryEnabled: boolean;
    /** Workspace directory whose AGENTS.local.md the instructions editor targets. */
    workspaceDir: string;
    /** Optional explicit Python interpreter / venv directory; empty auto-detects. */
    pythonPath: string;
}
/** Client-local brand state (browser localStorage). */
interface BrandState {
    logoUrl: string;
    brandName: string;
    brandVersion: string;
}
interface ScopeSnapshot {
    status: 'loading' | 'ready' | 'unavailable';
    value: InputHistoryConfig | undefined;
    base: unknown;
    user: unknown;
    revision: number | undefined;
    writable: boolean;
    mode: 'host' | 'memory';
}
interface SettingsScope {
    getSnapshot(): ScopeSnapshot;
    subscribe(listener: () => void): () => void;
    set(field: string, value: unknown): Promise<void>;
    unset(field: string): Promise<void>;
}
interface DescribeSnapshot {
    status: 'idle' | 'loading' | 'ready' | 'unavailable';
    view: {
        writable: boolean;
        hasDocument: boolean;
        namespaces: ReadonlyArray<{
            ns: string;
            secrets: ReadonlyArray<{
                path: string[];
                set: boolean;
            }>;
        }>;
    } | undefined;
    error: string | null;
}
interface DescribeFace {
    getSnapshot(): DescribeSnapshot;
    subscribe(listener: () => void): () => void;
}
interface SlotRegisterOptions {
    name: string;
    key?: string;
    id?: string;
    order?: number;
    label?: () => string;
    inject?: () => Record<string, unknown>;
    priority?: number;
}
interface SlotsService {
    inject(key: string, fn: () => Iterable<unknown> | unknown): unknown;
    register(opts: SlotRegisterOptions, component: unknown): () => void;
    entries(key: string): Array<{
        options: Record<string, unknown>;
    }>;
    entriesOfSlot(key: string): Array<unknown>;
    spec(key: string): {
        kind: string;
        scope: string;
    } | undefined;
    subscribe(key: string, fn: () => void): () => void;
    getVersion(key: string): number;
}
export declare const inject: string[];
export declare function apply(ctx: {
    slots: SlotsService;
    settingsScope: {
        bind(spec: {
            namespace: string;
        }): SettingsScope;
        describe(): DescribeFace;
    };
}): void;
export interface BrandStore {
    get(): BrandState;
    set(field: keyof BrandState, value: string): void;
    subscribe(listener: () => void): () => void;
}
export {};
