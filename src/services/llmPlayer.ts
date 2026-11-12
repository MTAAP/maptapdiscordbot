import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../config';
import {
    completeLlmDailyRun,
    failLlmDailyRun,
    getLlmDailyRun,
    LlmDailyRunRecord,
    LlmRoundDetail,
    upsertLlmDailyRunStart,
} from '../database/queries';
import { getTodayDate } from '../utils/dates';
import { encodeAnimatedGifAsync, GifFrameInput } from '../utils/gifEncoder';

export const LLM_PLAYER_MODE = 'visual-crosshair';

const MAX_STEPS_PER_ROUND = 7;
const GIF_SIZE = 540;
const REPLAY_RETENTION_DAYS = 30;
const MAX_DISCORD_SAFE_GIF_BYTES = 9 * 1024 * 1024;

interface MinimalWebSocket {
    send(data: string): void;
    close(): void;
    addEventListener(
        type: 'open' | 'error' | 'message',
        listener: (event: { data?: unknown }) => void,
        options?: { once?: boolean }
    ): void;
}

declare const WebSocket: new (url: string) => MinimalWebSocket;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

class CDPClient {
    private ws: MinimalWebSocket | null = null;
    private nextId = 1;
    private pending = new Map<
        number,
        { resolve: (val: unknown) => void; reject: (err: Error) => void; method: string }
    >();

    constructor(private readonly wsUrl: string) {}

    async connect(): Promise<void> {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise<void>((resolve, reject) => {
            this.ws!.addEventListener('open', () => resolve(), { once: true });
            this.ws!.addEventListener(
                'error',
                () => reject(new Error(`CDP WebSocket connection failed: ${this.wsUrl}`)),
                { once: true }
            );
        });
        this.ws.addEventListener('message', ev => {
            const raw = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
            let msg: { id?: number; result?: unknown; error?: unknown };
            try {
                msg = JSON.parse(raw);
            } catch {
                return;
            }
            if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
                const entry = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                if (msg.error) {
                    entry.reject(new Error(`CDP error (${entry.method}): ${JSON.stringify(msg.error)}`));
                } else {
                    entry.resolve(msg.result);
                }
            }
        });
    }

    send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
        if (!this.ws) {
            return Promise.reject(new Error('CDP WebSocket is not connected'));
        }
        const id = this.nextId++;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`CDP command timed out (${method})`));
                }
            }, 30_000);

            this.pending.set(id, {
                method,
                resolve: val => {
                    clearTimeout(timer);
                    resolve(val as T);
                },
                reject: err => {
                    clearTimeout(timer);
                    reject(err);
                },
            });
            this.ws!.send(JSON.stringify({ id, method, params }));
        });
    }

    close(): void {
        for (const [, entry] of this.pending) {
            entry.reject(new Error('CDP client closed'));
        }
        this.pending.clear();
        try {
            this.ws?.close();
        } catch {
            // ignore close error
        }
    }
}

export function resolveChromeBinary(explicitPath?: string): string | null {
    const candidates = [
        explicitPath,
        config.llm.chromePath,
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter((p): p is string => Boolean(p && p.trim()));

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

export function isLlmPlayerConfigured(): boolean {
    return Boolean(config.llm.apiKey && resolveChromeBinary());
}

export function getReplaysDirectory(): string {
    return path.join(path.dirname(path.resolve(config.database.path)), 'replays');
}

function pruneOldReplayGifs(replaysDir: string): void {
    if (!fs.existsSync(replaysDir)) return;
    const cutoffMs = Date.now() - REPLAY_RETENTION_DAYS * 86_400_000;
    for (const entry of fs.readdirSync(replaysDir)) {
        if (!entry.endsWith('.gif')) continue;
        const full = path.join(replaysDir, entry);
        try {
            const st = fs.statSync(full);
            if (st.mtimeMs < cutoffMs) {
                fs.rmSync(full, { force: true });
            }
        } catch {
            // ignore concurrent delete
        }
    }
}

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'navigate_globe',
            description:
                'Rotate and/or zoom the 3D globe using virtual physical WASD + QE + Shift keys to align the center target crosshair over the target location. Zoom-out executes BEFORE panning; zoom-in executes AFTER panning in the same action.',
            parameters: {
                type: 'object',
                properties: {
                    north_south: {
                        type: 'string',
                        enum: ['north', 'south', 'none'],
                        description:
                            '"north" holds KeyW (moves crosshair north), "south" holds KeyS (moves crosshair south), "none" for no latitude change.',
                    },
                    ns_ms: {
                        type: 'number',
                        description:
                            'Duration in ms to hold north/south key (0 to 2800). With fine=false: ~2200ms crosses ~80 deg at full-globe view; ~700ms moves ~25% of visible globe width; ~250ms nudges ~10% of visible width.',
                    },
                    east_west: {
                        type: 'string',
                        enum: ['east', 'west', 'none'],
                        description:
                            '"east" holds KeyD (moves crosshair eastward), "west" holds KeyA (moves crosshair westward), "none" for no longitude change.',
                    },
                    ew_ms: {
                        type: 'number',
                        description:
                            'Duration in ms to hold east/west key (0 to 2800). Scales automatically with camera altitude.',
                    },
                    zoom: {
                        type: 'string',
                        enum: ['in', 'out', 'none'],
                        description:
                            '"in" holds KeyE (zooms closer AFTER panning), "out" holds KeyQ (zooms out BEFORE panning), "none" keeps current zoom.',
                    },
                    zoom_ms: {
                        type: 'number',
                        description:
                            'Duration in ms to hold zoom key (0 to 1800). With fine=false: ~800ms zooms ~2.7x closer; ~1200ms zooms ~5x closer.',
                    },
                    fine: {
                        type: 'boolean',
                        description:
                            'Hold ShiftLeft for 0.25x precision speed when zoomed in near the target for surgical final alignment.',
                    },
                    thought_short: {
                        type: 'string',
                        description:
                            'Brief 1-sentence note stating what you see under the crosshair and how you are adjusting.',
                    },
                },
                required: [
                    'north_south',
                    'ns_ms',
                    'east_west',
                    'ew_ms',
                    'zoom',
                    'zoom_ms',
                    'fine',
                    'thought_short',
                ],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'drop_pin',
            description:
                'Press Space to commit your guess at the exact center of the cyan/magenta target crosshair.',
            parameters: {
                type: 'object',
                properties: {
                    confidence: {
                        type: 'number',
                        description: 'Your confidence (0 to 100) that the crosshair center is right on the target.',
                    },
                    monologue: {
                        type: 'string',
                        description:
                            'Witty, vivid 1-2 sentence player monologue explaining your deduction and visual read of the terrain/coastlines as you press Space.',
                    },
                },
                required: ['confidence', 'monologue'],
            },
        },
    },
];

const SYSTEM_PROMPT = `You are Mappy's blind-hands visual geography player competing in the daily 5-round MapTap challenge on a 3D satellite globe using ONLY screenshots and physical keyboard controls (WASD + QE + Shift + Space).

HOW YOUR CONTROLS & CROSSHAIR WORK:
- Every screenshot is 900x900 px. A bright cyan-and-magenta reticle crosshair marks the EXACT pixel where pressing Space (drop_pin) drops your pin. Look directly through the open circular center of that crosshair.
- You have at most 7 actions total per round (Steps 1..7), including drop_pin. If you have not called drop_pin by Step 7, Space is automatically pressed after Step 7.
- Ideal cadence: 3 to 6 steps:
  1) Deduce the exact real-world city/place from the clue (identify the specific city, its country, and where it sits relative to coastlines, peninsulas, lakes, islands, or river valleys).
  2) Coarse pan to the region + moderate zoom in (e.g., zoom="in", zoom_ms=800..1000). Note: zoom="out" runs BEFORE panning; zoom="in" runs AFTER panning in the same navigate_globe call.
  3) Inspect coastlines, lakes, peninsulas, mountains, and urban patches relative to the crosshair center. Zoom closer (zoom_ms=700..1000) and use fine=true (0.25x speed) for surgical nudges so the crosshair center sits dead-on the city.
  4) Call drop_pin({ confidence, monologue }) once centered.

MOVEMENT CALIBRATION (when fine=false):
- Pan speed automatically scales with camera altitude. At ANY zoom level:
  - 2200-2600 ms moves ~75-90 deg at full-globe view (e.g. Americas -> Europe/Africa, or Europe -> East Asia).
  - 1200-1600 ms moves ~40-55 deg at full-globe view (~half the visible globe disk).
  - 600-900 ms moves ~25-35% of the currently visible terrain width.
  - 250-450 ms moves ~10-18% of the currently visible terrain width.
- With fine=true (Shift held), all pan & zoom rates are 0.25x: 300-600 ms gives a tiny, precise 3-7% screen nudge for pinpointing a city.
- Avoid zooming in so close too early that you lose sight of coastlines and geographic landmarks.`;

interface ChatToolCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}

interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> | null;
    reasoning_content?: string;
    tool_calls?: ChatToolCall[];
    tool_call_id?: string;
}

function stripOldImages(messages: ChatMessage[]): void {
    for (const m of messages) {
        if (Array.isArray(m.content)) {
            m.content = m.content.map(part =>
                part.type === 'image_url' ? { type: 'text', text: '[previous step screenshot omitted]' } : part
            );
        }
    }
}

const SAFE_BROWSER_ENV_KEYS = [
    'PATH',
    'LANG',
    'LC_ALL',
    'FONTCONFIG_PATH',
    'SYSTEMROOT',
    'DISPLAY',
] as const;

/**
 * Builds a minimal child-process environment for headless Chromium so application
 * secrets (DISCORD_TOKEN, SVPG_API_KEY, DATABASE_PATH) never enter the browser process.
 */
export function buildSanitizedBrowserEnv(timezone: string, profileDir: string): NodeJS.ProcessEnv {
    const cleanEnv: NodeJS.ProcessEnv = {
        TZ: timezone,
        HOME: profileDir,
        TMPDIR: profileDir,
        XDG_CONFIG_HOME: profileDir,
        XDG_CACHE_HOME: profileDir,
    };
    for (const key of SAFE_BROWSER_ENV_KEYS) {
        const val = process.env[key];
        if (val) {
            cleanEnv[key] = val;
        }
    }
    return cleanEnv;
}

async function callGatewayModel(
    baseUrl: string,
    apiKey: string,
    model: string,
    messages: ChatMessage[],
    reasoningEffort: 'low' | 'medium' | 'xhigh',
    abortSignal?: AbortSignal
): Promise<{
    msg: { content?: string | null; reasoning_content?: string; tool_calls: ChatToolCall[] };
    usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
    };
    wallMs: number;
}> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
        if (abortSignal?.aborted) {
            throw new Error('LLM player run aborted');
        }
        const t0 = performance.now();
        try {
            const timeoutSignal = AbortSignal.timeout(300_000);
            const combinedSignal = abortSignal
                ? AbortSignal.any([timeoutSignal, abortSignal])
                : timeoutSignal;

            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    reasoning_effort: reasoningEffort,
                    messages,
                    tools: TOOLS,
                    tool_choice: 'required',
                }),
                signal: combinedSignal,
            });
            const wallMs = Math.round(performance.now() - t0);

            if (!res.ok) {
                const errBody = (await res.text()).slice(0, 300);
                if ((res.status === 429 || res.status >= 500) && attempt < 3) {
                    await sleep(2000 * attempt);
                    continue;
                }
                throw new Error(`SVPG Gateway HTTP ${res.status}: ${errBody}`);
            }

            const data = (await res.json()) as {
                choices?: Array<{
                    message?: {
                        content?: string | null;
                        reasoning_content?: string;
                        tool_calls?: ChatToolCall[];
                    };
                }>;
                usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                    completion_tokens_details?: { reasoning_tokens?: number };
                };
            };

            const msg = data.choices?.[0]?.message;
            if (!msg || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
                throw new Error('Gateway response contained no structured tool_calls');
            }

            return {
                msg: {
                    content: msg.content ?? null,
                    reasoning_content: msg.reasoning_content,
                    tool_calls: msg.tool_calls,
                },
                usage: data.usage ?? {},
                wallMs,
            };
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (abortSignal?.aborted) {
                throw lastError;
            }
            if (attempt < 3) {
                await sleep(1500 * attempt);
            }
        }
    }

    throw lastError ?? new Error('SVPG Gateway call failed');
}

function isRunningInsideLinuxContainer(): boolean {
    if (process.platform !== 'linux') return false;
    return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
}

async function spawnIsolatedChromeOnce(
    chromeBin: string,
    profileDir: string,
    timezone: string,
    useSwiftShader: boolean,
    disableOsSandbox: boolean,
    session: ActiveBrowserSession
): Promise<{ proc: ChildProcess; cdp: CDPClient }> {
    if (session.abortController.signal.aborted || playerShuttingDown) {
        throw new Error('LLM player shutting down before browser launch');
    }

    const isLinux = process.platform === 'linux';
    const args = [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        '--window-size=900,900',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-extensions',
        '--disable-sync',
        '--site-per-process',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        ...(isLinux ? ['--disable-dev-shm-usage'] : []),
        ...(disableOsSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
        ...(useSwiftShader ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
        'about:blank',
    ];

    const proc = spawn(chromeBin, args, {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildSanitizedBrowserEnv(timezone, profileDir),
    });
    session.proc = proc;
    session.cdp = null;

    let cdp: CDPClient | null = null;
    try {
        const wsBrowserUrl = await new Promise<string>((resolve, reject) => {
            let stderr = '';
            const cleanupAbort = () => {
                session.abortController.signal.removeEventListener('abort', onAbort);
            };
            const onAbort = () => {
                clearTimeout(timer);
                cleanupAbort();
                reject(new Error('LLM player aborted while waiting for Chromium DevTools'));
            };
            const timer = setTimeout(() => {
                cleanupAbort();
                reject(new Error(`Timed out waiting for Chromium DevTools: ${stderr.slice(-400)}`));
            }, 20_000);

            if (session.abortController.signal.aborted) {
                onAbort();
                return;
            }
            session.abortController.signal.addEventListener('abort', onAbort, { once: true });

            proc.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
                const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
                if (m) {
                    clearTimeout(timer);
                    cleanupAbort();
                    resolve(m[1]);
                }
            });
            proc.once('error', err => {
                clearTimeout(timer);
                cleanupAbort();
                reject(err);
            });
            proc.once('exit', code => {
                clearTimeout(timer);
                cleanupAbort();
                reject(new Error(`Chromium exited early (code=${code}): ${stderr.slice(-400)}`));
            });
        });

        const port = new URL(wsBrowserUrl).port;
        const targetsRes = await fetch(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.any([AbortSignal.timeout(10_000), session.abortController.signal]),
        });
        const targets = (await targetsRes.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
        const pageTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!pageTarget?.webSocketDebuggerUrl) {
            throw new Error('No debuggable page target found in headless Chromium');
        }

        cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
        session.cdp = cdp;
        await cdp.connect();
        if (session.abortController.signal.aborted || playerShuttingDown) {
            throw new Error('LLM player aborted during CDP setup');
        }
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 900,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: timezone }).catch(() => {});

        return { proc, cdp };
    } catch (error) {
        await terminateChromeProcess(proc, cdp);
        if (session.proc === proc) session.proc = null;
        if (session.cdp === cdp) session.cdp = null;
        throw error;
    }
}

async function launchIsolatedChrome(
    chromeBin: string,
    profileDir: string,
    timezone: string,
    useSwiftShader: boolean,
    session: ActiveBrowserSession
): Promise<{ proc: ChildProcess; cdp: CDPClient }> {
    try {
        return await spawnIsolatedChromeOnce(chromeBin, profileDir, timezone, useSwiftShader, false, session);
    } catch (firstErr) {
        if (session.abortController.signal.aborted || playerShuttingDown) {
            throw firstErr;
        }
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const isContainerNamespaceDenial =
            isRunningInsideLinuxContainer() &&
            process.env.CHROMIUM_STRICT_SANDBOX !== '1' &&
            (msg.includes('No usable sandbox') ||
                msg.includes('Failed to move to new namespace') ||
                msg.includes('Operation not permitted'));
        if (!isContainerNamespaceDenial) {
            throw firstErr;
        }
        console.warn(
            '[LLM Player] Container seccomp blocked nested Chromium namespaces; falling back to container-isolated headless mode'
        );
        return spawnIsolatedChromeOnce(chromeBin, profileDir, timezone, useSwiftShader, true, session);
    }
}

async function terminateChromeProcess(proc: ChildProcess | null, cdp: CDPClient | null): Promise<void> {
    cdp?.close();
    if (!proc) return;

    const signalProcessTree = (sig: NodeJS.Signals) => {
        if (process.platform !== 'win32' && proc.pid) {
            try {
                process.kill(-proc.pid, sig);
                return;
            } catch {
                // fall back to direct child kill
            }
        }
        try {
            proc.kill(sig);
        } catch {
            // already exited
        }
    };

    if (proc.exitCode === null) {
        signalProcessTree('SIGTERM');
        await Promise.race([
            new Promise<void>(resolve => proc.once('exit', () => resolve())),
            sleep(2000),
        ]);
    }

    if (proc.exitCode === null) {
        signalProcessTree('SIGKILL');
        await Promise.race([
            new Promise<void>(resolve => proc.once('exit', () => resolve())),
            sleep(500),
        ]);
    }

    proc.stdout?.destroy();
    proc.stderr?.destroy();
}

const KEY_INFO: Record<string, string> = {
    KeyW: 'w',
    KeyS: 's',
    KeyA: 'a',
    KeyD: 'd',
    KeyE: 'e',
    KeyQ: 'q',
    ShiftLeft: 'Shift',
    Space: ' ',
};

async function ensureProtoCrosshair(cdp: CDPClient, visible: boolean): Promise<void> {
    await cdp.send('Runtime.evaluate', {
        expression: `(() => {
            let styleEl = document.getElementById('proto-crosshair-style');
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = 'proto-crosshair-style';
                styleEl.textContent = '#keyboard-globe-crosshair { opacity: 0 !important; }';
                document.head.appendChild(styleEl);
            }
            let el = document.getElementById('proto-crosshair');
            if (!el) {
                el = document.createElement('div');
                el.id = 'proto-crosshair';
                el.style.cssText = 'pointer-events: none; position: fixed; left: 50%; top: 50%; width: 52px; height: 52px; transform: translate(-50%, -50%); z-index: 9999;';
                el.innerHTML = \`
                    <svg width="52" height="52" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="26" cy="26" r="18" fill="none" stroke="#000000" stroke-width="3.5" opacity="0.65"/>
                        <circle cx="26" cy="26" r="18" fill="none" stroke="#ff2a85" stroke-width="1.8" stroke-dasharray="6 4"/>
                        <g stroke="#000000" stroke-width="4.2" stroke-linecap="round" opacity="0.75">
                            <line x1="26" y1="2" x2="26" y2="17"/><line x1="26" y1="35" x2="26" y2="50"/>
                            <line x1="2" y1="26" x2="17" y2="26"/><line x1="35" y1="26" x2="50" y2="26"/>
                        </g>
                        <g stroke="#00f7ff" stroke-width="2" stroke-linecap="round">
                            <line x1="26" y1="2" x2="26" y2="17"/><line x1="26" y1="35" x2="26" y2="50"/>
                            <line x1="2" y1="26" x2="17" y2="26"/><line x1="35" y1="26" x2="50" y2="26"/>
                        </g>
                        <circle cx="26" cy="26" r="1.5" fill="#ff2a85"/>
                    </svg>
                \`;
                document.body.appendChild(el);
            }
            const canvas = document.querySelector('#globeViz canvas') || document.getElementById('globeViz');
            if (canvas) {
                const r = canvas.getBoundingClientRect();
                el.style.left = (r.left + r.width / 2) + 'px';
                el.style.top = (r.top + r.height / 2) + 'px';
            }
            el.style.display = ${visible ? "'block'" : "'none'"};
        })()`,
    });
}

async function dispatchKey(cdp: CDPClient, type: 'keydown' | 'keyup', code: string): Promise<void> {
    const key = KEY_INFO[code] ?? '';
    await cdp.send('Runtime.evaluate', {
        expression: `(() => {
            if ('${type}' === 'keydown' && document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
            document.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', key: '${key}', bubbles: true, cancelable: true }));
        })()`,
    });
}

async function holdSingleKey(cdp: CDPClient, code: string, ms: number, fine: boolean): Promise<void> {
    if (ms <= 0) return;
    if (fine) await dispatchKey(cdp, 'keydown', 'ShiftLeft');
    await dispatchKey(cdp, 'keydown', code);
    await sleep(ms);
    await dispatchKey(cdp, 'keyup', code);
    if (fine) await dispatchKey(cdp, 'keyup', 'ShiftLeft');
}

async function holdPanKeys(
    cdp: CDPClient,
    nsCode: string | null,
    nsMs: number,
    ewCode: string | null,
    ewMs: number,
    fine: boolean
): Promise<void> {
    const activeNs = Boolean(nsCode && nsMs > 0);
    const activeEw = Boolean(ewCode && ewMs > 0);
    if (!activeNs && !activeEw) return;

    if (fine) await dispatchKey(cdp, 'keydown', 'ShiftLeft');
    if (activeNs && nsCode) await dispatchKey(cdp, 'keydown', nsCode);
    if (activeEw && ewCode) await dispatchKey(cdp, 'keydown', ewCode);

    if (activeNs && activeEw && nsCode && ewCode) {
        if (nsMs <= ewMs) {
            await sleep(nsMs);
            await dispatchKey(cdp, 'keyup', nsCode);
            if (ewMs - nsMs > 0) await sleep(ewMs - nsMs);
            await dispatchKey(cdp, 'keyup', ewCode);
        } else {
            await sleep(ewMs);
            await dispatchKey(cdp, 'keyup', ewCode);
            await sleep(nsMs - ewMs);
            await dispatchKey(cdp, 'keyup', nsCode);
        }
    } else if (activeNs && nsCode) {
        await sleep(nsMs);
        await dispatchKey(cdp, 'keyup', nsCode);
    } else if (activeEw && ewCode) {
        await sleep(ewMs);
        await dispatchKey(cdp, 'keyup', ewCode);
    }

    if (fine) await dispatchKey(cdp, 'keyup', 'ShiftLeft');
}

function clampMs(val: unknown, maxMs: number): number {
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(80, Math.min(maxMs, Math.round(n)));
}

interface AppliedMove {
    nsCode: string | null;
    nsMs: number;
    ewCode: string | null;
    ewMs: number;
    zoomCode: string | null;
    zoomMs: number;
    fine: boolean;
}

async function executeNavigateGlobe(
    cdp: CDPClient,
    args: Record<string, unknown>
): Promise<AppliedMove> {
    const fine = Boolean(args.fine);
    const nsCode = args.north_south === 'north' ? 'KeyW' : args.north_south === 'south' ? 'KeyS' : null;
    const ewCode = args.east_west === 'east' ? 'KeyD' : args.east_west === 'west' ? 'KeyA' : null;
    const zoomCode = args.zoom === 'in' ? 'KeyE' : args.zoom === 'out' ? 'KeyQ' : null;

    const nsMs = nsCode ? clampMs(args.ns_ms, 2800) : 0;
    const ewMs = ewCode ? clampMs(args.ew_ms, 2800) : 0;
    const zoomMs = zoomCode ? clampMs(args.zoom_ms, 1800) : 0;

    if (zoomCode === 'KeyQ' && zoomMs > 0) {
        await holdSingleKey(cdp, 'KeyQ', zoomMs, fine);
        await sleep(80);
    }

    await holdPanKeys(cdp, nsCode, nsMs, ewCode, ewMs, fine);

    if (zoomCode === 'KeyE' && zoomMs > 0) {
        await sleep(80);
        await holdSingleKey(cdp, 'KeyE', zoomMs, fine);
    }

    await sleep(350);
    return { nsCode, nsMs, ewCode, ewMs, zoomCode, zoomMs, fine };
}

async function pressSpaceToPlacePin(cdp: CDPClient): Promise<void> {
    await dispatchKey(cdp, 'keydown', 'Space');
    await sleep(60);
    await dispatchKey(cdp, 'keyup', 'Space');
}

async function captureScreenshotBase64(cdp: CDPClient): Promise<string> {
    const res = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    return res.data;
}

interface VisibleRoundHud {
    ready: boolean;
    round: number | null;
    instruction: string;
    header: string;
    puzzleTitle: string;
    gameDateKey: string;
}

/**
 * Blind-hands boundary: reads ONLY round readiness and visible HUD strings.
 * Never reads window.cities, runtime.activeRoundCity.lat/lng, or myGlobe.pointOfView().
 */
async function waitForRoundReady(
    cdp: CDPClient,
    targetRound: number,
    abortSignal?: AbortSignal
): Promise<VisibleRoundHud> {
    let prevInstruction = '';
    let stableCount = 0;

    for (let i = 0; i < 120; i++) {
        if (abortSignal?.aborted) {
            throw new Error(`Aborted waiting for MapTap Round ${targetRound}`);
        }
        await sleep(250);
        if (abortSignal?.aborted) {
            throw new Error(`Aborted waiting for MapTap Round ${targetRound}`);
        }
        const evalRes = await cdp.send<{ result: { value?: VisibleRoundHud } }>('Runtime.evaluate', {
            expression: `(() => {
                const ready = typeof gameState !== 'undefined'
                    && typeof runtime !== 'undefined'
                    && runtime.currentlyScoring === 0
                    && !!runtime.activeRoundCity
                    && gameState.round === ${targetRound};
                const instruction = (document.getElementById('instruction')?.innerText || document.getElementById('info')?.innerText || '').trim();
                const header = (document.getElementById('info_header')?.innerText || document.getElementById('round-meta')?.innerText || '').trim();
                const puzzleTitle = (document.getElementById('bar_center_text')?.innerText || '').trim();
                const gameDateKey = typeof GAME_DATE_KEY === 'string' ? GAME_DATE_KEY : '';
                return { ready, round: typeof gameState !== 'undefined' ? gameState.round : null, instruction, header, puzzleTitle, gameDateKey };
            })()`,
            returnByValue: true,
        });
        const st = evalRes.result.value;
        if (
            st?.ready &&
            st.instruction &&
            st.instruction !== 'Daily Geography puzzle' &&
            !st.instruction.startsWith('Loading')
        ) {
            if (st.instruction === prevInstruction) {
                stableCount++;
                if (stableCount >= 3) {
                    await sleep(400);
                    return st;
                }
            } else {
                prevInstruction = st.instruction;
                stableCount = 0;
            }
        }
    }
    throw new Error(`Timed out waiting for MapTap Round ${targetRound} to open`);
}

function getMultiplierForRound(round: number): number {
    if (round === 3) return 2;
    if (round === 4 || round === 5) return 3;
    return 1;
}

interface CaptionSpec {
    pngBase64: string;
    topText: string;
    bottomTitle: string;
    bottomSub: string;
    accentCss: string;
    delayMs: number;
}

/**
 * Uses Chromium's own Skia 2D canvas to scale each 900x900 PNG to 540x540 and
 * burn crisp top/bottom HUD caption bars, returning raw RGBA pixels.
 */
async function rasterizeCaptionedFrameInChromium(
    cdp: CDPClient,
    spec: CaptionSpec
): Promise<Uint8Array> {
    const payload = JSON.stringify({
        pngBase64: spec.pngBase64,
        topText: spec.topText,
        bottomTitle: spec.bottomTitle,
        bottomSub: spec.bottomSub,
        accentCss: spec.accentCss,
        size: GIF_SIZE,
    });

    const evalRes = await cdp.send<{ result: { value?: string } }>('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `((cfg) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const S = cfg.size;
                const canvas = document.createElement('canvas');
                canvas.width = S;
                canvas.height = S;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, S, S);

                // Top bar (34px)
                ctx.fillStyle = 'rgba(10, 14, 24, 0.88)';
                ctx.fillRect(0, 0, S, 34);
                ctx.fillStyle = cfg.accentCss;
                ctx.fillRect(0, 33, S, 2);
                ctx.font = 'bold 13px "Liberation Sans", -apple-system, BlinkMacSystemFont, Arial, sans-serif';
                ctx.fillStyle = '#f5faff';
                ctx.textBaseline = 'top';
                ctx.fillText(cfg.topText.slice(0, 72), 10, 10);

                // Bottom bar (64px)
                const botY = S - 64;
                ctx.fillStyle = 'rgba(10, 14, 24, 0.91)';
                ctx.fillRect(0, botY, S, 64);
                ctx.fillStyle = cfg.accentCss;
                ctx.fillRect(0, botY, S, 2);

                const wrapLines = (text, maxWidth, maxLines) => {
                    const words = String(text || '').split(/\\s+/).filter(Boolean);
                    const lines = [];
                    let cur = '';
                    for (const w of words) {
                        const test = cur ? cur + ' ' + w : w;
                        if (ctx.measureText(test).width <= maxWidth) {
                            cur = test;
                        } else {
                            if (cur) lines.push(cur);
                            cur = w;
                            if (lines.length >= maxLines - 1) break;
                        }
                    }
                    if (cur && lines.length < maxLines) lines.push(cur);
                    return lines;
                };

                let y = botY + 7;
                if (cfg.bottomTitle) {
                    ctx.font = 'bold 12px "Liberation Sans", -apple-system, BlinkMacSystemFont, Arial, sans-serif';
                    ctx.fillStyle = cfg.accentCss;
                    ctx.fillText(cfg.bottomTitle.slice(0, 74), 10, y);
                    y += 18;
                }

                ctx.font = '12px "Liberation Sans", -apple-system, BlinkMacSystemFont, Arial, sans-serif';
                ctx.fillStyle = '#ebf0f8';
                const subLines = wrapLines(cfg.bottomSub, S - 20, cfg.bottomTitle ? 2 : 3);
                for (const ln of subLines) {
                    ctx.fillText(ln, 10, y);
                    y += 16;
                }

                const bytes = ctx.getImageData(0, 0, S, S).data;
                let binary = '';
                const step = 32768;
                for (let i = 0; i < bytes.length; i += step) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
                }
                resolve(btoa(binary));
            };
            img.onerror = () => reject(new Error('Failed to decode screenshot PNG in canvas'));
            img.src = 'data:image/png;base64,' + cfg.pngBase64;
        }))(${payload})`,
    });

    const b64 = evalRes.result.value;
    if (!b64) {
        throw new Error('Canvas rasterizer returned empty frame data');
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
}

function selectRepresentativeSteps<T>(steps: T[], maxCount: number): T[] {
    if (steps.length <= maxCount) return steps;
    const out: T[] = [];
    for (let i = 0; i < maxCount; i++) {
        const idx = Math.round((i * (steps.length - 1)) / (maxCount - 1));
        out.push(steps[idx]);
    }
    return out;
}

export interface RunLlmChallengeOptions {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    reasoningEffort?: 'low' | 'medium' | 'xhigh';
    maptapUrl?: string;
    chromePath?: string;
    timezone?: string;
    replaysDir?: string;
    forceReplay?: boolean;
}

interface ActiveBrowserSession {
    proc: ChildProcess | null;
    cdp: CDPClient | null;
    profileDir: string;
    abortController: AbortController;
}

const inFlightByDate = new Map<string, Promise<LlmDailyRunRecord | null>>();
let browserSerialQueue: Promise<unknown> = Promise.resolve();
let currentBrowserSession: ActiveBrowserSession | null = null;
let playerShuttingDown = false;

export function isLlmRunInProgress(): boolean {
    return inFlightByDate.size > 0 || currentBrowserSession !== null;
}

export async function shutdownLlmPlayer(): Promise<void> {
    playerShuttingDown = true;
    const active = currentBrowserSession;
    if (active) {
        active.abortController.abort();
        await terminateChromeProcess(active.proc, active.cdp);
    }
    await Promise.race([browserSerialQueue.catch(() => null), sleep(3000)]);
    if (active) {
        await terminateChromeProcess(active.proc, active.cdp);
        try {
            fs.rmSync(active.profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
        } catch {
            // ignore temp cleanup error
        }
    }
}

export async function runLlmDailyChallenge(
    gameDate: string = getTodayDate(config.timezone),
    options: RunLlmChallengeOptions = {}
): Promise<LlmDailyRunRecord | null> {
    if (playerShuttingDown) {
        return null;
    }

    if (!options.forceReplay) {
        const existing = getLlmDailyRun(gameDate);
        if (existing?.status === 'completed') {
            return existing;
        }
        const pendingSameDate = inFlightByDate.get(gameDate);
        if (pendingSameDate) {
            return pendingSameDate;
        }
    }

    const apiKey = options.apiKey ?? config.llm.apiKey;
    const baseUrl = (options.baseUrl ?? config.llm.baseUrl).replace(/\/+$/, '');
    const model = options.model ?? config.llm.model;
    const reasoningEffort = options.reasoningEffort ?? config.llm.reasoningEffort;
    const maptapUrl = options.maptapUrl ?? config.llm.maptapUrl;
    const timezone = options.timezone ?? config.timezone;
    const replaysDir = options.replaysDir ?? getReplaysDirectory();
    const chromeBin = resolveChromeBinary(options.chromePath);

    if (!apiKey || !chromeBin) {
        return null;
    }

    const executeRun = async (): Promise<LlmDailyRunRecord | null> => {
        if (playerShuttingDown) {
            return null;
        }
        if (!options.forceReplay) {
            const existing = getLlmDailyRun(gameDate);
            if (existing?.status === 'completed') {
                return existing;
            }
        }

        const matchStart = performance.now();
        const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maptap-llm-chrome-'));
        fs.chmodSync(profileDir, 0o700);
        const abortController = new AbortController();
        const session: ActiveBrowserSession = {
            proc: null,
            cdp: null,
            profileDir,
            abortController,
        };
        currentBrowserSession = session;

        try {
            fs.mkdirSync(replaysDir, { recursive: true });
            pruneOldReplayGifs(replaysDir);
        } catch {
            // ignore retention pre-prune errors
        }

        upsertLlmDailyRunStart(gameDate, model, LLM_PLAYER_MODE);
        console.log(`[LLM Player] Starting ${model} (${LLM_PLAYER_MODE}) for ${gameDate}...`);

        try {
            const preferSwiftShaderOnBoot =
                process.platform === 'linux' && !fs.existsSync('/dev/dri');

            const launched = await launchIsolatedChrome(
                chromeBin,
                profileDir,
                timezone,
                preferSwiftShaderOnBoot,
                session
            );
            let cdp = launched.cdp;

            const bootstrapStorageScript = `
                localStorage.setItem('maptap_history_setaside', '1');
                localStorage.setItem('keyboardGlobe', '1');
            `;
            await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
                source: bootstrapStorageScript,
            });
            await cdp.send('Page.navigate', { url: maptapUrl });

            let r1Hud: VisibleRoundHud | null = null;
            let hasValidCanvas = false;
            try {
                r1Hud = await waitForRoundReady(cdp, 1, abortController.signal);
                const canvasCheck = await cdp.send<{ result: { value?: boolean } }>(
                    'Runtime.evaluate',
                    {
                        expression: `(() => {
                            const c = document.querySelector('#globeViz canvas');
                            return Boolean(c && c.width > 100 && c.height > 100);
                        })()`,
                        returnByValue: true,
                    }
                );
                hasValidCanvas = Boolean(canvasCheck.result.value);
            } catch {
                hasValidCanvas = false;
            }

            if (!hasValidCanvas && !preferSwiftShaderOnBoot && !abortController.signal.aborted && !playerShuttingDown) {
                console.log('[LLM Player] Retrying headless Chromium with Angle SwiftShader WebGL...');
                await terminateChromeProcess(session.proc, session.cdp);
                const fallback = await launchIsolatedChrome(chromeBin, profileDir, timezone, true, session);
                cdp = fallback.cdp;
                await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
                    source: bootstrapStorageScript,
                });
                await cdp.send('Page.navigate', { url: maptapUrl });
                r1Hud = await waitForRoundReady(cdp, 1, abortController.signal);
            }

            if (!r1Hud) {
                throw new Error('MapTap Round 1 failed to initialize WebGL globe');
            }

            if (r1Hud.gameDateKey && r1Hud.gameDateKey !== gameDate && maptapUrl.includes('maptap.gg')) {
                throw new Error(
                    `MapTap page date (${r1Hud.gameDateKey}) does not match requested gameDate (${gameDate})`
                );
            }

            const roundDetails: LlmRoundDetail[] = [];
            const captionSpecs: CaptionSpec[] = [];
            let puzzleTitle = r1Hud.puzzleTitle || 'MapTap Daily';
            let totalPromptTokens = 0;
            let totalCompletionTokens = 0;
            let totalReasoningTokens = 0;

            for (let round = 1; round <= 5; round++) {
                const roundHud =
                    round === 1 ? r1Hud : await waitForRoundReady(cdp, round, abortController.signal);
                if (roundHud.puzzleTitle) puzzleTitle = roundHud.puzzleTitle;
                const multiplier = getMultiplierForRound(round);

                await ensureProtoCrosshair(cdp, true);
                await sleep(120);

                let latestPngB64 = await captureScreenshotBase64(cdp);
                const initialPngB64 = latestPngB64;

                const messages: ChatMessage[] = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text:
                                    `ROUND ${round} OF 5 (${roundHud.header || `${multiplier}x Multiplier`})\n` +
                                    `VISIBLE CLUE / PROMPT: "${roundHud.instruction}"\n` +
                                    `Action budget: Step 1 of ${MAX_STEPS_PER_ROUND}. Inspect the globe and target crosshair carefully, deduce the exact location, and either call navigate_globe to move/zoom toward it or drop_pin if the crosshair center is already dead-on.`,
                            },
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/png;base64,${latestPngB64}` },
                            },
                        ],
                    },
                ];

                const navCaptures: Array<{
                    step: number;
                    applied: AppliedMove;
                    thought: string;
                    pngB64: string;
                }> = [];

                let stepCount = 0;
                let pinned = false;
                let forcedDrop = false;
                let finalConfidence = 50;
                let finalMonologue = '';

                for (let step = 1; step <= MAX_STEPS_PER_ROUND; step++) {
                    const { msg, usage } = await callGatewayModel(
                        baseUrl,
                        apiKey,
                        model,
                        messages,
                        reasoningEffort,
                        abortController.signal
                    );

                    totalPromptTokens += usage.prompt_tokens ?? 0;
                    totalCompletionTokens += usage.completion_tokens ?? 0;
                    totalReasoningTokens += usage.completion_tokens_details?.reasoning_tokens ?? 0;

                    messages.push({
                        role: 'assistant',
                        content: msg.content ?? null,
                        reasoning_content: msg.reasoning_content ?? '',
                        tool_calls: msg.tool_calls,
                    });

                    const primaryCall = msg.tool_calls[0];
                    const extraCalls = msg.tool_calls.slice(1);
                    let parsedArgs: Record<string, unknown> = {};
                    try {
                        parsedArgs = JSON.parse(primaryCall.function.arguments || '{}');
                    } catch {
                        parsedArgs = {};
                    }

                    stepCount = step;

                    if (primaryCall.function.name === 'drop_pin') {
                        finalConfidence = Number.isFinite(Number(parsedArgs.confidence))
                            ? Math.max(0, Math.min(100, Math.round(Number(parsedArgs.confidence))))
                            : 70;
                        finalMonologue = String(
                            parsedArgs.monologue || 'Crosshair locked onto target, pressing Space.'
                        ).trim();

                        await pressSpaceToPlacePin(cdp);
                        pinned = true;
                        break;
                    }

                    const applied = await executeNavigateGlobe(cdp, parsedArgs);
                    await ensureProtoCrosshair(cdp, true);
                    latestPngB64 = await captureScreenshotBase64(cdp);

                    const thoughtShort = String(parsedArgs.thought_short || '').trim();
                    navCaptures.push({
                        step,
                        applied,
                        thought: thoughtShort,
                        pngB64: latestPngB64,
                    });

                    if (step === MAX_STEPS_PER_ROUND) {
                        forcedDrop = true;
                        finalConfidence = 45;
                        finalMonologue = thoughtShort
                            ? `${thoughtShort} (Auto-dropping pin on Step ${MAX_STEPS_PER_ROUND})`
                            : `Out of moves on Step ${MAX_STEPS_PER_ROUND}, pressing Space at crosshair.`;
                        await pressSpaceToPlacePin(cdp);
                        pinned = true;
                        break;
                    }

                    stripOldImages(messages);
                    messages.push({
                        role: 'tool',
                        tool_call_id: primaryCall.id,
                        content: JSON.stringify({
                            status: 'moved',
                            applied,
                            step_completed: step,
                            steps_remaining: MAX_STEPS_PER_ROUND - step,
                        }),
                    });
                    for (const ec of extraCalls) {
                        messages.push({
                            role: 'tool',
                            tool_call_id: ec.id,
                            content: JSON.stringify({
                                skipped: 'Only one action executed per frame; inspect new screenshot first.',
                            }),
                        });
                    }

                    const budgetNotice =
                        step + 1 === MAX_STEPS_PER_ROUND
                            ? `FINAL STEP (${MAX_STEPS_PER_ROUND}/${MAX_STEPS_PER_ROUND}). Call drop_pin NOW to commit with your confidence and monologue.`
                            : step + 1 === MAX_STEPS_PER_ROUND - 1
                              ? `Step ${step + 1} of ${MAX_STEPS_PER_ROUND} (2 actions left: finish fine alignment or call drop_pin if centered).`
                              : `Step ${step + 1} of ${MAX_STEPS_PER_ROUND}. Inspect the updated globe and crosshair below.`;

                    messages.push({
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `${budgetNotice}\nReminder of clue: "${roundHud.instruction}"`,
                            },
                            {
                                type: 'image_url',
                                image_url: { url: `data:image/png;base64,${latestPngB64}` },
                            },
                        ],
                    });
                }

                if (!pinned) {
                    await pressSpaceToPlacePin(cdp);
                }

                await ensureProtoCrosshair(cdp, false);

                interface CommittedRoundData {
                    cityName: string;
                    score: number;
                    distance: number;
                }
                let roundResult: CommittedRoundData | null = null;
                for (let i = 0; i < 40; i++) {
                    await sleep(200);
                    const check = await cdp.send<{ result: { value?: CommittedRoundData | null } }>(
                        'Runtime.evaluate',
                        {
                            expression: `(() => {
                                const rd = (typeof gameState !== 'undefined' && Array.isArray(gameState.roundData))
                                    ? gameState.roundData[${round - 1}]
                                    : null;
                                return rd ? { cityName: rd.cityName, score: rd.score, distance: rd.distance } : null;
                            })()`,
                            returnByValue: true,
                        }
                    );
                    if (check.result.value) {
                        roundResult = check.result.value;
                        break;
                    }
                }

                if (!roundResult) {
                    throw new Error(`Round ${round} did not record roundData after pressing Space`);
                }

                await sleep(2500);
                let revealPngB64 = await captureScreenshotBase64(cdp);
                let snarkyText = '';
                let prevSnarky = '';
                let snarkyStable = 0;

                for (let i = 0; i < 14; i++) {
                    await sleep(200);
                    const snarkRes = await cdp.send<{
                        result: { value?: { visible: boolean; text: string } };
                    }>('Runtime.evaluate', {
                        expression: `(() => {
                            const cards = document.querySelectorAll('.score-display');
                            const card = cards[cards.length - 1];
                            if (!card) return { visible: false, text: '' };
                            const lines = Array.from(card.querySelectorAll('.snarky-text'))
                                .filter(el => el.style.display !== 'none' && el.style.opacity !== '0')
                                .map(el => (el.innerText || '').trim())
                                .filter(Boolean);
                            const cityEl = card.querySelector('.city-name');
                            const fading = cityEl && cityEl.style.opacity === '0';
                            return { visible: !fading, text: lines.join(' ') };
                        })()`,
                        returnByValue: true,
                    });
                    const sc = snarkRes.result.value;
                    if (sc?.text) {
                        snarkyText = sc.text;
                        if (sc.text === prevSnarky) {
                            snarkyStable++;
                            if (snarkyStable >= 2 && sc.visible) {
                                revealPngB64 = await captureScreenshotBase64(cdp);
                                break;
                            }
                        } else {
                            prevSnarky = sc.text;
                            snarkyStable = 0;
                        }
                    }
                }

                const rawScore = Number(roundResult.score) || 0;
                const weightedPoints = rawScore * multiplier;
                const distanceKm = +(Number(roundResult.distance) || 0).toFixed(1);

                console.log(
                    `[LLM Player] R${round}/5 ${roundResult.cityName}: ${rawScore}/100 (${weightedPoints} pts, ${distanceKm} km, ${stepCount} steps)`
                );

                roundDetails.push({
                    round,
                    multiplier,
                    cityName: roundResult.cityName,
                    rawScore,
                    weightedPoints,
                    distanceKm,
                    stepCount,
                    forcedDrop,
                    confidence: finalConfidence,
                    monologue: finalMonologue,
                    snarkyText,
                });

                // Queue GIF frames for this round (Step 0 + up to 3 representative nav steps + Reveal)
                captionSpecs.push({
                    pngBase64: initialPngB64,
                    topText: `${model} · R${round}/5 ${roundResult.cityName} (${multiplier}x) · Start`,
                    bottomTitle: `Clue: ${roundHud.instruction}`,
                    bottomSub: 'Inspecting satellite globe & center crosshair...',
                    accentCss: '#00f7ff',
                    delayMs: 850,
                });

                for (const nc of selectRepresentativeSteps(navCaptures, 3)) {
                    const keys: string[] = [];
                    if (nc.applied.nsCode) keys.push(`${nc.applied.nsCode}:${nc.applied.nsMs}ms`);
                    if (nc.applied.ewCode) keys.push(`${nc.applied.ewCode}:${nc.applied.ewMs}ms`);
                    if (nc.applied.zoomCode) keys.push(`${nc.applied.zoomCode}:${nc.applied.zoomMs}ms`);
                    if (nc.applied.fine) keys.push('Shift(0.25x)');
                    captionSpecs.push({
                        pngBase64: nc.pngB64,
                        topText: `${model} · R${round}/5 ${roundResult.cityName} · Step ${nc.step}`,
                        bottomTitle: `Keys: ${keys.join(' + ') || 'hold'}`,
                        bottomSub: nc.thought,
                        accentCss: '#00f7ff',
                        delayMs: 900,
                    });
                }

                const revealAccent =
                    rawScore >= 75 ? '#5aff82' : rawScore >= 40 ? '#ffcd46' : '#ff5f73';
                captionSpecs.push({
                    pngBase64: revealPngB64,
                    topText: `${model} · R${round}/5 ${roundResult.cityName} · REVEAL`,
                    bottomTitle: `Score: ${rawScore}/100 (${weightedPoints}/${100 * multiplier} pts, ${Math.round(distanceKm)} km) · Conf ${finalConfidence}%`,
                    bottomSub: `"${finalMonologue}"`,
                    accentCss: revealAccent,
                    delayMs: 1850,
                });

                // Wait for MapTap to advance to next round (or finish after Round 5)
                for (let i = 0; i < 60; i++) {
                    await sleep(250);
                    const adv = await cdp.send<{
                        result: { value?: { round: number; scoring: number } };
                    }>('Runtime.evaluate', {
                        expression: `(() => ({
                            round: typeof gameState !== 'undefined' ? gameState.round : 0,
                            scoring: typeof runtime !== 'undefined' ? runtime.currentlyScoring : 0,
                        }))()`,
                        returnByValue: true,
                    });
                    const v = adv.result.value;
                    if (round < 5 && v?.round === round + 1 && v.scoring === 0) break;
                    if (round === 5 && (v?.round ?? 0) > 5) break;
                }
            }

            await sleep(2500);
            const endgamePngB64 = await captureScreenshotBase64(cdp);

            const totalScore = roundDetails.reduce((sum, r) => sum + r.weightedPoints, 0);
            const rawScore = roundDetails.reduce((sum, r) => sum + r.rawScore, 0);
            const totalSteps = roundDetails.reduce((sum, r) => sum + r.stepCount, 0);
            const wallClockMs = Math.round(performance.now() - matchStart);

            captionSpecs.push({
                pngBase64: endgamePngB64,
                topText: `${model} (Blind Crosshair) · FINAL SCORE: ${totalScore}/1000`,
                bottomTitle: `${puzzleTitle} (${gameDate}) · Raw ${rawScore}/500 · ${totalSteps} steps`,
                bottomSub: '100% blind visual WASD/QE/Space navigation (zero coordinate access)',
                accentCss: '#5aff82',
                delayMs: 2500,
            });

            // Rasterize captioned frames via Chromium Skia canvas before closing browser
            let savedGifPath: string | null = null;
            try {
                fs.mkdirSync(replaysDir, { recursive: true });
                pruneOldReplayGifs(replaysDir);

                const gifFrames: GifFrameInput[] = [];
                for (const spec of captionSpecs) {
                    const rgba = await rasterizeCaptionedFrameInChromium(cdp, spec);
                    gifFrames.push({ rgba, delayMs: spec.delayMs });
                }

                const gifBuf = await encodeAnimatedGifAsync(gifFrames, GIF_SIZE, GIF_SIZE);
                if (gifBuf.length <= MAX_DISCORD_SAFE_GIF_BYTES) {
                    const outGif = path.join(replaysDir, `${gameDate}.gif`);
                    fs.writeFileSync(outGif, gifBuf);
                    savedGifPath = outGif;
                } else {
                    console.warn(
                        `[LLM Player] Generated GIF (${gifBuf.length} B) exceeded safe Discord cap; skipping file save`
                    );
                }
            } catch (gifErr) {
                console.warn('[LLM Player] Replay GIF generation failed (scores still saved):', gifErr);
            }

            completeLlmDailyRun({
                gameDate,
                model,
                mode: LLM_PLAYER_MODE,
                totalScore,
                rawScore,
                roundScores: roundDetails.map(r => r.rawScore),
                roundDetails,
                totalSteps,
                wallClockMs,
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                reasoningTokens: totalReasoningTokens,
                gifPath: savedGifPath,
            });

            console.log(
                `[LLM Player] Completed ${gameDate}: ${totalScore}/1000 in ${(wallClockMs / 1000).toFixed(1)}s`
            );
            return getLlmDailyRun(gameDate);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[LLM Player] Failed ${gameDate}:`, msg);
            failLlmDailyRun(gameDate, msg);
            return getLlmDailyRun(gameDate);
        } finally {
            await terminateChromeProcess(session.proc, session.cdp);
            if (currentBrowserSession === session) {
                currentBrowserSession = null;
            }
            try {
                fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
            } catch {
                // ignore temp cleanup error
            }
        }
    };

    const scheduledPromise = browserSerialQueue.then(
        () => executeRun(),
        () => executeRun()
    );
    browserSerialQueue = scheduledPromise.then(
        () => undefined,
        () => undefined
    );

    if (!options.forceReplay) {
        inFlightByDate.set(gameDate, scheduledPromise);
    }
    return scheduledPromise.finally(() => {
        if (inFlightByDate.get(gameDate) === scheduledPromise) {
            inFlightByDate.delete(gameDate);
        }
    });
}
