import * as vscode from 'vscode';
import { ConfigService, Repository } from '../services/configService';

export class RepositoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly repository?: Repository,
        public readonly type: 'repository' | 'info' = 'repository'
    ) {
        super(label, collapsibleState);
        
        if (repository) {
            this.tooltip = `${repository.name}\n${repository.url}\nType: ${repository.type}`;
            this.description = repository.url;
            this.contextValue = 'repository';
            
            // Set icon based on repository type
            switch (repository.type) {
                case 'github':
                    this.iconPath = new vscode.ThemeIcon('github');
                    break;
                case 'gitlab':
                    this.iconPath = new vscode.ThemeIcon('gitlab');
                    break;
                case 'local':
                    this.iconPath = new vscode.ThemeIcon('folder');
                    break;
                default:
                    this.iconPath = new vscode.ThemeIcon('repo');
            }
            
            // Show status - enabled/disabled
            if (repository.enabled === false) {
                this.description = `${this.description} (disabled)`;
                this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('descriptionForeground'));
            }
            
            // Show last sync time if available
            if (repository.lastSync) {
                const timeDiff = Date.now() - repository.lastSync.getTime();
                const minutes = Math.floor(timeDiff / (1000 * 60));
                if (minutes < 60) {
                    this.description = `${this.description} (${minutes}m ago)`;
                } else {
                    const hours = Math.floor(minutes / 60);
                    this.description = `${this.description} (${hours}h ago)`;
                }
            }
        } else if (type === 'info') {
            this.iconPath = new vscode.ThemeIcon('info');
            this.contextValue = 'info';
        }
    }
}

export class RepositoryProvider implements vscode.TreeDataProvider<RepositoryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RepositoryTreeItem | undefined | null | void> = new vscode.EventEmitter<RepositoryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RepositoryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private repositories: Repository[] = [];

    constructor(private configService: ConfigService) {
        this.refresh();
        
        // Listen for configuration changes
        configService.onDidChangeConfiguration(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this.loadRepositories();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RepositoryTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RepositoryTreeItem): Thenable<RepositoryTreeItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }
        return Promise.resolve([]);
    }

    private async loadRepositories(): Promise<void> {
        try {
            this.repositories = await this.configService.getRepositories();
        } catch (error) {
            console.error('Error loading repositories:', error);
            vscode.window.showErrorMessage('Failed to load repositories: ' + (error as Error).message);
            this.repositories = [];
        }
    }

    private getRootItems(): RepositoryTreeItem[] {
        if (this.repositories.length === 0) {
            return [
                new RepositoryTreeItem(
                    'No repositories configured',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'info'
                ),
                new RepositoryTreeItem(
                    'Click + to add a repository',
                    vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'info'
                )
            ];
        }

        const items: RepositoryTreeItem[] = [];
        
        // Add enabled repositories first
        const enabledRepos = this.repositories.filter(r => r.enabled !== false);
        const disabledRepos = this.repositories.filter(r => r.enabled === false);
        
        enabledRepos.forEach(repo => {
            items.push(new RepositoryTreeItem(
                repo.name,
                vscode.TreeItemCollapsibleState.None,
                repo
            ));
        });
        
        // Add disabled repositories at the end
        if (disabledRepos.length > 0) {
            disabledRepos.forEach(repo => {
                items.push(new RepositoryTreeItem(
                    repo.name,
                    vscode.TreeItemCollapsibleState.None,
                    repo
                ));
            });
        }

        return items;
    }

    // Repository management methods
    async addRepository(repository: Repository): Promise<void> {
        await this.configService.addRepository(repository);
        this.refresh();
    }

    async removeRepository(repository: Repository): Promise<void> {
        await this.configService.removeRepository(repository.id);
        this.refresh();
    }

    async toggleRepository(repository: Repository): Promise<void> {
        const updated = { 
            ...repository, 
            enabled: !repository.enabled 
        };
        await this.configService.updateRepository(updated);
        this.refresh();
    }

    async updateRepositoryLastSync(repositoryId: string): Promise<void> {
        const repo = this.repositories.find(r => r.id === repositoryId);
        if (repo) {
            const updated = { 
                ...repo, 
                lastSync: new Date() 
            };
            await this.configService.updateRepository(updated);
            this.refresh();
        }
    }

    // Utility methods
    getRepository(element: RepositoryTreeItem): Repository | undefined {
        return element.repository;
    }

    findRepository(id: string): Repository | undefined {
        return this.repositories.find(r => r.id === id);
    }

    getAllRepositories(): Repository[] {
        return [...this.repositories];
    }

    getEnabledRepositories(): Repository[] {
        return this.repositories.filter(r => r.enabled !== false);
    }
}