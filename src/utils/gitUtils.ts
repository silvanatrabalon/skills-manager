import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface GitRepository {
    url: string;
    branch?: string;
    commit?: string;
}

export class GitUtils {
    /**
     * Check if git is available
     */
    static async isGitAvailable(): Promise<boolean> {
        try {
            await execAsync('git --version');
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Clone a repository to a temporary directory
     */
    static async cloneRepository(url: string, targetDir: string, branch?: string): Promise<void> {
        const args = ['git', 'clone'];
        
        if (branch) {
            args.push('--branch', branch);
        }
        
        args.push('--depth', '1'); // Shallow clone for better performance
        args.push(url, targetDir);
        
        await execAsync(args.join(' '));
    }

    /**
     * Get the latest commit hash from a repository
     */
    static async getLatestCommit(repoPath: string): Promise<string> {
        const result = await execAsync('git rev-parse HEAD', { cwd: repoPath });
        return result.stdout.trim();
    }

    /**
     * Get the current branch name
     */
    static async getCurrentBranch(repoPath: string): Promise<string> {
        try {
            const result = await execAsync('git branch --show-current', { cwd: repoPath });
            return result.stdout.trim();
        } catch {
            // Fallback for older git versions
            const result = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
            return result.stdout.trim();
        }
    }

    /**
     * Check if a directory is a git repository
     */
    static async isGitRepository(dirPath: string): Promise<boolean> {
        try {
            await execAsync('git rev-parse --is-inside-work-tree', { cwd: dirPath });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the remote origin URL
     */
    static async getRemoteUrl(repoPath: string): Promise<string | null> {
        try {
            const result = await execAsync('git config --get remote.origin.url', { cwd: repoPath });
            return result.stdout.trim();
        } catch {
            return null;
        }
    }

    /**
     * Pull latest changes from remote
     */
    static async pullLatest(repoPath: string): Promise<void> {
        await execAsync('git pull origin', { cwd: repoPath });
    }

    /**
     * Check if there are new commits available
     */
    static async hasNewCommits(repoPath: string): Promise<boolean> {
        try {
            await execAsync('git fetch origin', { cwd: repoPath });
            const result = await execAsync('git rev-list HEAD...origin --count', { cwd: repoPath });
            const count = parseInt(result.stdout.trim());
            return count > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get repository information
     */
    static async getRepositoryInfo(repoPath: string): Promise<{
        url: string | null;
        branch: string;
        commit: string;
        hasUncommittedChanges: boolean;
    }> {
        const [url, branch, commit, status] = await Promise.all([
            this.getRemoteUrl(repoPath),
            this.getCurrentBranch(repoPath),
            this.getLatestCommit(repoPath),
            this.getStatus(repoPath)
        ]);

        return {
            url,
            branch,
            commit,
            hasUncommittedChanges: status.length > 0
        };
    }

    /**
     * Get git status (list of changed files)
     */
    private static async getStatus(repoPath: string): Promise<string> {
        try {
            const result = await execAsync('git status --porcelain', { cwd: repoPath });
            return result.stdout.trim();
        } catch {
            return '';
        }
    }

    /**
     * Validate if a URL is a valid git repository
     */
    static async isValidGitRepository(url: string): Promise<boolean> {
        try {
            await execAsync(`git ls-remote --heads ${url}`);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Parse GitHub/GitLab URL and extract repository info
     */
    static parseRepositoryUrl(url: string): {
        provider: 'github' | 'gitlab' | 'other';
        owner?: string;
        repo?: string;
        host?: string;
    } | null {
        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/').filter(p => p);
            
            if (urlObj.hostname === 'github.com' && pathParts.length >= 2) {
                return {
                    provider: 'github',
                    owner: pathParts[0],
                    repo: pathParts[1].replace(/\.git$/, ''),
                    host: urlObj.hostname
                };
            } else if (urlObj.hostname.includes('gitlab') && pathParts.length >= 2) {
                return {
                    provider: 'gitlab',
                    owner: pathParts[0],
                    repo: pathParts[1].replace(/\.git$/, ''),
                    host: urlObj.hostname
                };
            } else {
                return {
                    provider: 'other',
                    host: urlObj.hostname
                };
            }
        } catch {
            // Try parsing as SSH URL (git@github.com:user/repo.git)
            const sshMatch = url.match(/git@([^:]+):([^\/]+)\/(.+)\.git$/);
            if (sshMatch) {
                const [, host, owner, repo] = sshMatch;
                const provider = host.includes('github') ? 'github' : 
                               host.includes('gitlab') ? 'gitlab' : 'other';
                
                return {
                    provider: provider as 'github' | 'gitlab' | 'other',
                    owner,
                    repo,
                    host
                };
            }
        }
        
        return null;
    }

    /**
     * Get the default branch of a repository
     */
    static async getDefaultBranch(url: string): Promise<string> {
        try {
            const result = await execAsync(`git ls-remote --symref ${url} HEAD`);
            const match = result.stdout.match(/ref: refs\/heads\/(.+)\s+HEAD/);
            return match ? match[1] : 'main';
        } catch {
            // Fallback to common default branch names
            return 'main';
        }
    }

    /**
     * List available branches in a repository
     */
    static async listBranches(url: string): Promise<string[]> {
        try {
            const result = await execAsync(`git ls-remote --heads ${url}`);
            const branches = result.stdout
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.split('\t')[1])
                .map(ref => ref.replace('refs/heads/', ''))
                .filter(branch => branch);
            
            return branches;
        } catch {
            return [];
        }
    }
}