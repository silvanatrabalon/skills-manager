import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

export interface SkillUpdateInfo {
    name: string;
    currentHash: string;
    latestHash: string;
    source: string;
    hasUpdate: boolean;
    scope: 'global' | 'project';
    skillPath?: string;
    ref?: string;
}

export interface GitHubTreeResponse {
    sha: string;
    tree: Array<{
        path: string;
        type: 'blob' | 'tree';
        sha: string;
    }>;
}

export class UpdateCheckService {
    private outputChannel: vscode.OutputChannel | undefined;

    constructor(outputChannel?: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    private log(message: string) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
        console.log(message);
    }

    // ============================================
    // Public API
    // ============================================

    /**
     * Check for skill updates using GitHub Trees API.
     * Unified logic for both global and project scopes.
     * Uses skillFolderHash (GitHub tree SHA) for comparison in both scopes.
     */
    async checkSkillUpdates(scope: 'global' | 'project' | 'both' = 'both'): Promise<SkillUpdateInfo[]> {
        const results: SkillUpdateInfo[] = [];

        this.log(`🔍 [UpdateCheck] Starting update check (scope: ${scope})`);

        if (scope === 'global' || scope === 'both') {
            try {
                const globalResults = await this.checkLockFile(this.getGlobalLockPath(), 'global');
                results.push(...globalResults);
            } catch (error: any) {
                this.log(`❌ [UpdateCheck] Error checking global: ${error.message}`);
            }
        }

        if (scope === 'project' || scope === 'both') {
            try {
                const projectLockPath = this.getProjectLockPath();
                if (projectLockPath) {
                    const projectResults = await this.checkLockFile(projectLockPath, 'project');
                    results.push(...projectResults);
                }
            } catch (error: any) {
                this.log(`❌ [UpdateCheck] Error checking project: ${error.message}`);
            }
        }

        this.log(`🔍 [UpdateCheck] Total: ${results.length} skills, ${results.filter(r => r.hasUpdate).length} with updates`);
        results.forEach((r, i) => {
            if (r.hasUpdate) {
                this.log(`   ${i + 1}. ${r.name} (${r.scope}) UPDATE: ${r.currentHash.substring(0, 10)}… → ${r.latestHash.substring(0, 10)}…`);
            } else {
                this.log(`   ${i + 1}. ${r.name} (${r.scope}) up-to-date`);
            }
        });

        return results;
    }

    /**
     * Enrich a skill entry in a lock file with skillFolderHash + skillPath.
     * Used as post-install/post-update hook to enable update tracking.
     */
    async enrichLockEntry(skillName: string, lockFilePath: string, force: boolean = false): Promise<boolean> {
        this.log(`📝 [Enrich] Enriching ${skillName} in ${path.basename(lockFilePath)} (force: ${force})`);

        if (!fs.existsSync(lockFilePath)) {
            this.log(`📝 [Enrich] Lock file not found: ${lockFilePath}`);
            return false;
        }

        const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
        const entry = lockContent.skills?.[skillName];

        if (!entry) {
            this.log(`📝 [Enrich] Skill ${skillName} not found in lock file`);
            return false;
        }

        if (!this.isGitHubSkill(entry)) {
            this.log(`📝 [Enrich] Skipping ${skillName}: not a GitHub skill`);
            return false;
        }

        // Skip if already enriched, unless force is true (post-install always forces)
        if (!force && entry.skillFolderHash && entry.skillFolderHash.trim() !== '' && entry.skillPath) {
            this.log(`📝 [Enrich] ${skillName} already enriched, skipping`);
            return true;
        }

        try {
            const token = await this.getGitHubToken();
            const ownerRepo = this.normalizeGitHubUrl(entry.source);
            this.log(`📝 [Enrich] Fetching tree for ${ownerRepo}...`);

            const tree = await this.fetchRepoTree(ownerRepo, token, entry.ref);
            if (!tree) {
                this.log(`📝 [Enrich] Could not fetch tree for ${ownerRepo}`);
                return false;
            }

            // Always discover skillPath from tree (don't trust CLI value, it can be wrong)
            const skillPath = this.discoverSkillPath(tree, skillName) || entry.skillPath;
            if (!skillPath) {
                this.log(`📝 [Enrich] Could not discover skillPath for ${skillName}`);
                return false;
            }

            const folderHash = this.getSkillFolderHashFromTree(tree, skillPath);
            if (!folderHash) {
                this.log(`📝 [Enrich] Could not get folder hash for ${skillName} at ${skillPath}`);
                return false;
            }

            // Write enriched data back to lock file
            entry.skillFolderHash = folderHash;
            entry.skillPath = skillPath;
            fs.writeFileSync(lockFilePath, JSON.stringify(lockContent, null, 2) + '\n', 'utf8');

            this.log(`📝 [Enrich] ✅ ${skillName}: skillPath=${skillPath}, hash=${folderHash}`);
            return true;
        } catch (error: any) {
            this.log(`📝 [Enrich] Error enriching ${skillName}: ${error.message}`);
            return false;
        }
    }

    /**
     * Enrich all skills in a lock file that are missing skillFolderHash.
     * Called during update checks to auto-fix entries that don't have tracking data.
     */
    async enrichAllInLock(lockFilePath: string): Promise<number> {
        if (!fs.existsSync(lockFilePath)) {
            return 0;
        }

        const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
        const skills = lockContent.skills || {};
        let enriched = 0;

        for (const skillName of Object.keys(skills)) {
            const entry = skills[skillName];
            if (!this.isGitHubSkill(entry)) continue;
            if (entry.skillFolderHash && entry.skillFolderHash.trim() !== '') continue;

            const result = await this.enrichLockEntry(skillName, lockFilePath);
            if (result) enriched++;
        }

        return enriched;
    }

    // ============================================
    // Core check logic
    // ============================================

    /**
     * Check all skills in a lock file for updates.
     * Unified logic: uses skillFolderHash + skillPath for both global and project.
     * Groups skills by repo to minimize API calls (one tree fetch per repo).
     */
    private async checkLockFile(lockFilePath: string, scope: 'global' | 'project'): Promise<SkillUpdateInfo[]> {
        if (!fs.existsSync(lockFilePath)) {
            this.log(`🔍 [UpdateCheck] Lock file not found: ${lockFilePath}`);
            return [];
        }

        const lockContent = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
        const skills = lockContent.skills || {};
        const skillNames = Object.keys(skills);
        this.log(`🔍 [UpdateCheck] ${scope} lock: ${skillNames.length} skills`);

        // First pass: auto-enrich any skills missing skillFolderHash
        let needsEnrichment = false;
        for (const name of skillNames) {
            const entry = skills[name];
            if (this.isGitHubSkill(entry) && (!entry.skillFolderHash || entry.skillFolderHash.trim() === '')) {
                needsEnrichment = true;
                break;
            }
        }
        if (needsEnrichment) {
            this.log(`🔍 [UpdateCheck] Some ${scope} skills need enrichment, running auto-enrich...`);
            const enriched = await this.enrichAllInLock(lockFilePath);
            this.log(`🔍 [UpdateCheck] Auto-enriched ${enriched} skills`);
            // Re-read the file after enrichment
            const refreshed = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
            Object.assign(skills, refreshed.skills || {});
        }

        const results: SkillUpdateInfo[] = [];
        const token = await this.getGitHubToken();

        // Group skills by owner/repo to minimize API calls
        const repoGroups = new Map<string, Array<{ skillName: string; entry: any }>>();

        for (const [skillName, entry] of Object.entries(skills) as [string, any][]) {
            if (!this.isGitHubSkill(entry)) {
                this.log(`🔍 [UpdateCheck] Skip ${skillName}: not GitHub`);
                continue;
            }
            if (!entry.skillFolderHash || entry.skillFolderHash.trim() === '') {
                this.log(`🔍 [UpdateCheck] Skip ${skillName}: no skillFolderHash after enrichment`);
                continue;
            }
            if (!entry.skillPath) {
                this.log(`🔍 [UpdateCheck] Skip ${skillName}: no skillPath`);
                continue;
            }

            const ownerRepo = this.normalizeGitHubUrl(entry.source);
            if (!repoGroups.has(ownerRepo)) {
                repoGroups.set(ownerRepo, []);
            }
            repoGroups.get(ownerRepo)!.push({ skillName, entry });
        }

        // Fetch one tree per repo, then check all skills from that repo
        for (const [ownerRepo, skillEntries] of repoGroups) {
            this.log(`🔍 [UpdateCheck] Fetching tree for ${ownerRepo} (${skillEntries.length} skills)...`);

            const ref = skillEntries[0]?.entry.ref;
            const tree = await this.fetchRepoTree(ownerRepo, token, ref);

            if (!tree) {
                this.log(`🔍 [UpdateCheck] Could not fetch tree for ${ownerRepo}, marking all as no-update`);
                for (const { skillName, entry } of skillEntries) {
                    results.push({
                        name: skillName,
                        currentHash: entry.skillFolderHash,
                        latestHash: entry.skillFolderHash,
                        source: entry.source,
                        hasUpdate: false,
                        scope,
                        skillPath: entry.skillPath,
                        ref: entry.ref
                    });
                }
                continue;
            }

            for (const { skillName, entry } of skillEntries) {
                const latestHash = this.getSkillFolderHashFromTree(tree, entry.skillPath);
                const hasUpdate = !!(latestHash && latestHash !== entry.skillFolderHash);

                results.push({
                    name: skillName,
                    currentHash: entry.skillFolderHash,
                    latestHash: latestHash || entry.skillFolderHash,
                    source: entry.source,
                    hasUpdate,
                    scope,
                    skillPath: entry.skillPath,
                    ref: entry.ref
                });
            }
        }

        return results;
    }

    // ============================================
    // GitHub API
    // ============================================

    /**
     * Fetch the full repo tree with one API call.
     * Tries ref → main → master fallback.
     */
    private async fetchRepoTree(
        ownerRepo: string,
        token?: string,
        ref?: string
    ): Promise<GitHubTreeResponse | null> {
        const branch = ref || 'main';
        const result = await this.githubGet<GitHubTreeResponse>(
            `/repos/${ownerRepo}/git/trees/${branch}?recursive=1`,
            token
        );

        if (!result && branch === 'main') {
            return this.githubGet<GitHubTreeResponse>(
                `/repos/${ownerRepo}/git/trees/master?recursive=1`,
                token
            );
        }

        return result;
    }

    /**
     * Generic GitHub API GET request with timeout.
     */
    private githubGet<T>(apiPath: string, token?: string): Promise<T | null> {
        return new Promise((resolve) => {
            const url = `https://api.github.com${apiPath}`;
            const options: https.RequestOptions = {
                headers: {
                    'User-Agent': 'Skills-Manager-Extension',
                    'Accept': 'application/vnd.github.v3+json',
                    ...(token && { 'Authorization': `Bearer ${token}` })
                }
            };

            const req = https.get(url, options, (res) => {
                let data = '';
                res.on('data', (chunk: string) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data) as T);
                        } catch {
                            resolve(null);
                        }
                    } else {
                        this.log(`🔍 [GitHub] ${res.statusCode} for ${apiPath}`);
                        resolve(null);
                    }
                });
            });

            req.on('error', () => resolve(null));
            req.setTimeout(10000, () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    // ============================================
    // Hash and path utilities
    // ============================================

    /**
     * Extract folder hash from a tree response for a specific skill path.
     * Same logic as CLI blob.ts getSkillFolderHashFromTree.
     */
    private getSkillFolderHashFromTree(tree: GitHubTreeResponse, skillPath: string): string | null {
        let folderPath = skillPath.replace(/\\/g, '/');

        if (folderPath.endsWith('/SKILL.md')) {
            folderPath = folderPath.slice(0, -9);
        } else if (folderPath.endsWith('SKILL.md')) {
            folderPath = folderPath.slice(0, -8);
        }
        if (folderPath.endsWith('/')) {
            folderPath = folderPath.slice(0, -1);
        }

        if (!folderPath) {
            return tree.sha;
        }

        const entry = tree.tree.find((e) => e.type === 'tree' && e.path === folderPath);
        return entry?.sha ?? null;
    }

    /**
     * Discover the skillPath for a skill by scanning the repo tree for SKILL.md files.
     * Matches by folder name === skillName.
     */
    private discoverSkillPath(tree: GitHubTreeResponse, skillName: string): string | null {
        const skillFiles = tree.tree.filter(e =>
            e.type === 'blob' && e.path.endsWith('SKILL.md')
        );

        this.log(`📝 [Discover] Found ${skillFiles.length} SKILL.md files in tree`);

        for (const file of skillFiles) {
            const parts = file.path.split('/');
            if (parts.length >= 2) {
                const folderName = parts[parts.length - 2];
                if (folderName === skillName) {
                    this.log(`📝 [Discover] Matched ${skillName} → ${file.path}`);
                    return file.path;
                }
            }
        }

        // Fallback: root-level SKILL.md (single-skill repo)
        if (skillFiles.length === 1 && skillFiles[0].path === 'SKILL.md') {
            this.log(`📝 [Discover] Single SKILL.md at root, using for ${skillName}`);
            return 'SKILL.md';
        }

        this.log(`📝 [Discover] No match found for ${skillName}`);
        return null;
    }

    /**
     * Check if a skill entry is from a GitHub-hosted repo.
     */
    private isGitHubSkill(entry: any): boolean {
        if (!entry?.source) return false;
        if (entry.sourceType === 'github') return true;
        if (entry.sourceType === 'git') {
            const source = entry.source.toLowerCase();
            return source.includes('github.com') || source.startsWith('git@github.com');
        }
        return false;
    }

    /**
     * Normalize SSH/HTTPS GitHub URL to owner/repo format.
     */
    normalizeGitHubUrl(source: string): string {
        if (source.startsWith('git@github.com:')) {
            return source.replace('git@github.com:', '').replace('.git', '');
        }
        if (source.includes('github.com')) {
            const match = source.match(/github\.com[/:]([^/]+\/[^/]+)/);
            if (match) {
                return match[1].replace('.git', '');
            }
        }
        return source;
    }

    // ============================================
    // Paths
    // ============================================

    getGlobalLockPath(): string {
        return path.join(os.homedir(), '.agents', '.skill-lock.json');
    }

    getProjectLockPath(): string | null {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return null;
        const lockPath = path.join(workspaceFolder.uri.fsPath, 'skills-lock.json');
        return fs.existsSync(lockPath) ? lockPath : null;
    }

    // ============================================
    // Authentication
    // ============================================

    private async getGitHubToken(): Promise<string | undefined> {
        // 1. VS Code authentication API
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
            if (session?.accessToken) return session.accessToken;
        } catch { /* ignore */ }

        // 2. Environment variables
        if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
        if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

        // 3. gh CLI
        try {
            const execAsync = promisify(exec);
            const { stdout } = await execAsync('gh auth token');
            const token = stdout.trim();
            if (token) return token;
        } catch { /* ignore */ }

        return undefined;
    }
}
