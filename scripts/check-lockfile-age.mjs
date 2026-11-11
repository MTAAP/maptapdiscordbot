#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function parseNpmrcPolicy(npmrcText) {
    const entries = new Map();
    for (const rawLine of npmrcText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        entries.set(key, value);
    }

    const minReleaseAgeRaw = entries.get('min-release-age');
    const minReleaseAgeDays = minReleaseAgeRaw !== undefined ? Number(minReleaseAgeRaw) : NaN;
    if (!Number.isFinite(minReleaseAgeDays) || minReleaseAgeDays < 2) {
        throw new Error(
            `.npmrc must set min-release-age>=2 (found: ${minReleaseAgeRaw ?? 'missing'})`
        );
    }

    const ignoreScripts = entries.get('ignore-scripts');
    if (ignoreScripts !== 'true') {
        throw new Error(
            `.npmrc must set ignore-scripts=true (found: ${ignoreScripts ?? 'missing'})`
        );
    }

    return { minReleaseAgeDays, ignoreScripts: true };
}

export function extractLockPackages(lockJson) {
    if (!lockJson || typeof lockJson !== 'object' || !lockJson.packages) {
        throw new Error('Invalid package-lock.json: missing packages map');
    }
    const result = new Map();
    for (const [pkgPath, meta] of Object.entries(lockJson.packages)) {
        if (pkgPath === '' || !meta || typeof meta !== 'object') continue;
        if (meta.link) continue;
        const marker = 'node_modules/';
        const idx = pkgPath.lastIndexOf(marker);
        const name = meta.name || (idx !== -1 ? pkgPath.slice(idx + marker.length) : null);
        const version = meta.version;
        if (!name || !version) {
            throw new Error(`Invalid package entry at ${pkgPath}: missing name or version`);
        }
        result.set(`${name}@${version}`, { name, version });
    }
    return result;
}

export function diffLockfilePackages(currentLock, baseLock) {
    const current = extractLockPackages(currentLock);
    if (!baseLock) {
        return Array.from(current.values());
    }
    const base = extractLockPackages(baseLock);
    const changed = [];
    for (const [key, pkg] of current.entries()) {
        if (!base.has(key)) {
            changed.push(pkg);
        }
    }
    return changed;
}

export function verifyReleaseAges(packages, packumentsByName, nowMs, minReleaseAgeDays) {
    if (!Array.isArray(packages)) {
        throw new Error('packages list is required');
    }
    const minAgeMs = minReleaseAgeDays * 24 * 60 * 60 * 1000;
    const violations = [];

    for (const { name, version } of packages) {
        const packument = packumentsByName.get(name);
        const publishedIso = packument?.time?.[version];
        if (!publishedIso) {
            violations.push(
                `${name}@${version}: missing registry publish timestamp (inconclusive/rejected)`
            );
            continue;
        }
        const publishedMs = Date.parse(publishedIso);
        if (!Number.isFinite(publishedMs)) {
            violations.push(
                `${name}@${version}: invalid registry timestamp "${publishedIso}"`
            );
            continue;
        }
        const ageMs = nowMs - publishedMs;
        if (ageMs < minAgeMs) {
            const ageHours = (ageMs / (60 * 60 * 1000)).toFixed(1);
            violations.push(
                `${name}@${version}: published ${ageHours}h ago (${publishedIso}), below ${minReleaseAgeDays * 24}h minimum`
            );
        }
    }

    return violations;
}

async function fetchPackuments(packageNames) {
    const uniqueNames = Array.from(new Set(packageNames));
    const results = new Map();
    const concurrency = 10;
    let cursor = 0;

    async function worker() {
        while (cursor < uniqueNames.length) {
            const name = uniqueNames[cursor++];
            const encoded = name.startsWith('@')
                ? `@${encodeURIComponent(name.slice(1))}`
                : encodeURIComponent(name);
            const res = await fetch(`https://registry.npmjs.org/${encoded}`, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) {
                throw new Error(`Registry lookup failed for ${name}: HTTP ${res.status}`);
            }
            results.set(name, await res.json());
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, uniqueNames.length) }, () => worker())
    );
    return results;
}

function loadBaseLockFromGit(repoRoot, baseRef) {
    try {
        const raw = execFileSync('git', ['show', `${baseRef}:package-lock.json`], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const repoRoot = process.cwd();
    const npmrcPath = path.join(repoRoot, '.npmrc');
    const lockPath = path.join(repoRoot, 'package-lock.json');

    if (!fs.existsSync(npmrcPath)) {
        throw new Error('Missing .npmrc');
    }
    if (!fs.existsSync(lockPath)) {
        throw new Error('Missing package-lock.json');
    }

    const { minReleaseAgeDays } = parseNpmrcPolicy(fs.readFileSync(npmrcPath, 'utf8'));
    const currentLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

    let baseRef = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--base' && args[i + 1]) {
            baseRef = args[i + 1];
            i++;
        }
    }
    const checkAll = args.includes('--all') || !baseRef;
    const baseLock = checkAll ? null : loadBaseLockFromGit(repoRoot, baseRef);
    const targets = diffLockfilePackages(currentLock, baseLock);

    if (targets.length === 0) {
        console.log(
            `Lockfile release-age check passed: 0 new/changed packages vs ${baseRef} (min-release-age=${minReleaseAgeDays}d, ignore-scripts=true).`
        );
        return;
    }

    const packuments = await fetchPackuments(targets.map(t => t.name));
    const violations = verifyReleaseAges(targets, packuments, Date.now(), minReleaseAgeDays);
    if (violations.length > 0) {
        console.error('Lockfile release-age check FAILED:');
        for (const v of violations) {
            console.error(`  - ${v}`);
        }
        process.exit(1);
    }

    console.log(
        `Lockfile release-age check passed: ${targets.length} package(s) >= ${minReleaseAgeDays * 24}h old (ignore-scripts=true).`
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
