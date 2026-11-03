// @flownote/sdk — plugin developers import this, declare extension points,
// call `plugin.activate()`; every `registerX()` here just queues a message
// sent to the host on `activate()` (DESIGN.md §9.4). Runs inside a
// `sandbox="allow-scripts"` iframe with no `allow-same-origin` — no DOM
// access to the host, no `localStorage` — so everything here talks to the
// host purely via `postMessage`, never anything else.
import { isHostToPluginMessage, } from './protocol.js';
export * from './protocol.js';
export { FlowNoteBlock } from './block.js';
let nextRequestId = 1;
/** `plugin.storage` — isolated key/value storage backed by the host's `plugin_storage` table (DESIGN.md §9.2 `registerStorageNamespace`). */
export class PluginStorage {
    #send;
    constructor(send) {
        this.#send = send;
    }
    async get(key) {
        const result = await this.#request('get', key);
        return typeof result === 'string' ? result : null;
    }
    async set(key, value) {
        await this.#request('set', key, value);
    }
    async delete(key) {
        await this.#request('delete', key);
    }
    async list() {
        const result = await this.#request('list');
        return Array.isArray(result) ? result : [];
    }
    #request(op, key, value) {
        const requestId = `req-${nextRequestId++}`;
        return new Promise((resolve, reject) => {
            const onMessage = (e) => {
                if (!isHostToPluginMessage(e.data) || e.data.type !== 'storage:response' || e.data.requestId !== requestId)
                    return;
                window.removeEventListener('message', onMessage);
                if (e.data.ok)
                    resolve(e.data.result ?? null);
                else
                    reject(new Error(e.data.error ?? `plugin storage ${op} failed`));
            };
            window.addEventListener('message', onMessage);
            this.#send({ source: 'flownote-plugin', type: 'storage', requestId, op, key, value });
        });
    }
}
/**
 * The plugin's one entry point. Construct one, call its `registerX()`
 * methods to declare what it contributes, then `activate()` once — that's
 * when every queued registration actually reaches the host (DESIGN.md
 * §9.4's example does exactly this ordering).
 */
export class FlowNotePlugin {
    #queue = [];
    #ribbonActionHandlers = new Map();
    #activated = false;
    storage;
    constructor() {
        this.storage = new PluginStorage((msg) => window.parent.postMessage(msg, '*'));
        window.addEventListener('message', (e) => {
            const data = e.data;
            if (!isHostToPluginMessage(data) || data.type !== 'ribbon:action')
                return;
            this.#ribbonActionHandlers.get(data.groupId)?.(data.buttonId);
        });
    }
    registerBlockType(spec) {
        this.#enqueue('blockType', {
            name: spec.name,
            label: spec.label,
            slashCommand: spec.slashCommand,
            renderPath: spec.render,
            defaultAttrs: spec.defaultAttrs ?? {},
        });
        if (spec.slashCommand) {
            this.#enqueue('slashCommand', { id: spec.slashCommand, label: spec.label, blockType: spec.name });
        }
    }
    registerSectionTab(spec) {
        this.#enqueue('sectionTab', spec);
    }
    registerRibbonGroup(spec) {
        if (spec.onAction)
            this.#ribbonActionHandlers.set(spec.id, spec.onAction);
        this.#enqueue('ribbonGroup', { id: spec.id, ribbonTab: spec.ribbonTab, label: spec.label, buttons: spec.buttons });
    }
    registerSlashCommand(spec) {
        this.#enqueue('slashCommand', spec);
    }
    registerSidePanel(spec) {
        this.#enqueue('sidePanel', spec);
    }
    registerStorageNamespace() {
        this.#enqueue('storageNamespace', { declared: true });
    }
    /** Resolves a plugin-relative asset path to a URL the host's block-instance iframes can load. Relative to this iframe's own location — the host serves every installed plugin's assets from its own root. */
    resolveAsset(path) {
        return new URL(path, window.location.href).toString();
    }
    /** Sends every queued `registerX()` call to the host. Call once, after all registrations. */
    activate() {
        if (this.#activated)
            return;
        this.#activated = true;
        for (const { extensionPoint, payload } of this.#queue) {
            window.parent.postMessage({ source: 'flownote-plugin', type: 'register', extensionPoint, payload }, '*');
        }
    }
    #enqueue(extensionPoint, payload) {
        this.#queue.push({ extensionPoint, payload });
    }
}
