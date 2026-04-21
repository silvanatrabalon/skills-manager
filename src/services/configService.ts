import * as vscode from 'vscode';

export interface Repository {
    id: string;
    name: string;
    url: string;
    type: 'github' | 'gitlab' | 'local';
    enabled?: boolean;
    lastSync?: Date;
}

export interface AgentConfig {
    name: string;
    enabled: boolean;
    path?: string;
}

export class ConfigService {
    private context: vscode.ExtensionContext;
    private static readonly REPOSITORIES_KEY = 'skills.repositories.data';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // Repository Management
    async getRepositories(): Promise<Repository[]> {
        const workspaceRepos = vscode.workspace.getConfiguration('skills').get<Repository[]>('repositories', []);
        const globalRepos = this.context.globalState.get<Repository[]>(ConfigService.REPOSITORIES_KEY, []);
        
        // Combine workspace and global repositories, workspace takes precedence
        const combined = [...workspaceRepos, ...globalRepos];
        const unique = combined.filter((repo, index, self) => 
            index === self.findIndex(r => r.id === repo.id)
        );
        
        return unique;
    }

    async addRepository(repository: Repository): Promise<void> {
        const repositories = await this.getRepositories();
        
        // Check for duplicates
        if (repositories.find(r => r.id === repository.id || r.url === repository.url)) {
            throw new Error('Repository already exists');
        }

        // Add to global state
        const globalRepos = this.context.globalState.get<Repository[]>(ConfigService.REPOSITORIES_KEY, []);
        globalRepos.push({
            ...repository,
            enabled: true,
            lastSync: new Date()
        });
        
        await this.context.globalState.update(ConfigService.REPOSITORIES_KEY, globalRepos);
    }

    async removeRepository(id: string): Promise<void> {
        const globalRepos = this.context.globalState.get<Repository[]>(ConfigService.REPOSITORIES_KEY, []);
        const filtered = globalRepos.filter(repo => repo.id !== id);
        
        await this.context.globalState.update(ConfigService.REPOSITORIES_KEY, filtered);
    }

    async updateRepository(repository: Repository): Promise<void> {
        const globalRepos = this.context.globalState.get<Repository[]>(ConfigService.REPOSITORIES_KEY, []);
        const index = globalRepos.findIndex(r => r.id === repository.id);
        
        if (index >= 0) {
            globalRepos[index] = repository;
            await this.context.globalState.update(ConfigService.REPOSITORIES_KEY, globalRepos);
        }
    }

    // Agent Configuration
    getTargetAgents(): string[] {
        return vscode.workspace.getConfiguration('skills').get('targetAgents', ['github-copilot', 'claude-code', 'cursor']);
    }

    async setTargetAgents(agents: string[]): Promise<void> {
        await vscode.workspace.getConfiguration('skills').update('targetAgents', agents, vscode.ConfigurationTarget.Global);
    }

    getDefaultScope(): 'global' | 'project' {
        return vscode.workspace.getConfiguration('skills').get('defaultScope', 'project');
    }

    async setDefaultScope(scope: 'global' | 'project'): Promise<void> {
        await vscode.workspace.getConfiguration('skills').update('defaultScope', scope, vscode.ConfigurationTarget.Global);
    }

    // Auto-update settings
    isAutoUpdateEnabled(): boolean {
        return vscode.workspace.getConfiguration('skills').get('autoUpdate', false);
    }

    async setAutoUpdate(enabled: boolean): Promise<void> {
        await vscode.workspace.getConfiguration('skills').update('autoUpdate', enabled, vscode.ConfigurationTarget.Global);
    }

    // Utility methods
    generateRepositoryId(url: string): string {
        // Generate a unique ID based on URL
        if (url.includes('github.com') || url.includes('gitlab.com')) {
            const match = url.match(/([^\/]+)\/([^\/]+?)(\.git)?$/);
            if (match) {
                return `${match[1]}-${match[2]}`;
            }
        }
        
        // Fallback to hash-style ID
        return url.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    }

    validateRepository(repository: Partial<Repository>): string[] {
        const errors: string[] = [];
        
        if (!repository.name?.trim()) {
            errors.push('Repository name is required');
        }
        
        if (!repository.url?.trim()) {
            errors.push('Repository URL is required');
        } else {
            // Basic URL validation
            if (repository.type === 'github' || repository.type === 'gitlab') {
                const urlPattern = /^https?:\/\/(github|gitlab)\.com\/[^\/]+\/[^\/]+/;
                if (!urlPattern.test(repository.url)) {
                    errors.push('Invalid GitHub/GitLab URL format');
                }
            } else if (repository.type === 'local') {
                // For local paths, just check if it looks like a path
                if (!repository.url.includes('/') && !repository.url.includes('\\')) {
                    errors.push('Invalid local path format');
                }
            }
        }
        
        if (!repository.type) {
            errors.push('Repository type is required');
        } else if (!['github', 'gitlab', 'local'].includes(repository.type)) {
            errors.push('Invalid repository type');
        }
        
        return errors;
    }

    // Event handling for configuration changes
    onDidChangeConfiguration(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('skills')) {
                listener(e);
            }
        });
    }
}