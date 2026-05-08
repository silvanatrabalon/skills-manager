import * as vscode from 'vscode';
import { SkillsService, SkillWithRepository, RepositorySkills } from '../services/skillsService';
import { SkillSearchResult } from '../services/cliWrapper';
import { UpdateManager } from '../services/updateManager';

export class SkillTreeItem extends vscode.TreeItem {
    public readonly fullDescription?: string;  // Store full description separately
    
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly skill?: SkillWithRepository | SkillSearchResult,
        public readonly type: 'section' | 'skill' | 'local-section' | 'global-section' | 'repository-section' | 'error-repo' = 'skill',
        public readonly hasUpdateAvailable?: boolean  // ← NUEVO
    ) {
        super(label, collapsibleState);
        
        if (skill && type === 'skill') {
            // Enhanced tooltip with full description if available
            const fullDescription = ('fullDescription' in skill && skill.fullDescription) ? 
                skill.fullDescription : skill.description;
            
            // Store the full description in the TreeItem
            this.fullDescription = fullDescription;
            
            this.tooltip = new vscode.MarkdownString(`**${skill.name}**\n\n${fullDescription}`);
            this.tooltip.isTrusted = true;
            
            // Truncated description for display in tree only
            this.description = fullDescription.length > 60 ? 
                fullDescription.substring(0, 57) + '...' : 
                fullDescription;
            
            // Set icon and context value based on skill status
            if ('installed' in skill && skill.installed) {
                // INSTALLED SKILL - Different treatment based on update availability
                if (hasUpdateAvailable) {
                    // ← NUEVO: Skill has update available
                    this.contextValue = 'skill-with-update';
                    this.iconPath = new vscode.ThemeIcon('sync', new vscode.ThemeColor('charts.orange'));
                    this.description = `${this.description} • Update available`;
                } else {
                    // Regular installed skill
                    this.contextValue = 'skill';
                    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                }
            } else {
                // AVAILABLE SKILL - Blue download icon only
                this.contextValue = 'available-skill';
                this.iconPath = new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
            }
        } else if (type === 'section') {
            if (label.includes('Installed')) {
                this.iconPath = new vscode.ThemeIcon('symbol-folder');
            } else {
                this.iconPath = new vscode.ThemeIcon('cloud');
            }
            this.contextValue = 'section';
        } else if (type === 'local-section') {
            this.iconPath = new vscode.ThemeIcon('home', new vscode.ThemeColor('charts.blue'));
            this.contextValue = 'local-section';
        } else if (type === 'global-section') {
            this.iconPath = new vscode.ThemeIcon('globe', new vscode.ThemeColor('charts.green'));
            this.contextValue = 'global-section';
        } else if (type === 'repository-section') {
            this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.purple'));
            this.contextValue = 'repository-section';
        } else if (type === 'error-repo') {
            this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
            this.contextValue = 'error-repo';
        }
    }
}

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> = new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private installedSkills: { local: SkillWithRepository[], global: SkillWithRepository[] } = { local: [], global: [] };
    private availableSkills: RepositorySkills[] = [];
    private outputChannel: vscode.OutputChannel;
    private updateManager?: UpdateManager;  // ← NUEVO

    constructor(public skillsService: SkillsService) {
        this.outputChannel = vscode.window.createOutputChannel('Skills Tree Provider Debug');
        
        // Initialize arrays as empty with new scope structure
        this.installedSkills = { local: [], global: [] };
        this.availableSkills = [];
    }
    
    // ← NUEVO: Método para configurar el UpdateManager
    setUpdateManager(updateManager: UpdateManager): void {
        this.updateManager = updateManager;
        
        // Listen to update changes and refresh tree
        this.updateManager.onDidUpdateChange(() => {
            this._onDidChangeTreeData.fire();
        });
    }
    
    // Helper method to check if a skill has update available (scope-aware)
    private hasUpdateAvailable(skillName: string, scope?: 'global' | 'project'): boolean {
        if (!this.updateManager) {
            return false;
        }
        return this.updateManager.hasUpdateAvailable(skillName, scope);
    }
    
    // Call this AFTER tree view is registered
    async initialize(): Promise<void> {
        
        try {
            await this.loadSkills();
            
            
            this._onDidChangeTreeData.fire();
            
        } catch (error) {
            
            // Even if there's an error, fire the event to show what we have
            this._onDidChangeTreeData.fire();
        }
    }

    refresh(): void {
        this.loadSkills().then(() => {
            
            // Force fire the event to ensure UI updates
            setTimeout(() => {
                this._onDidChangeTreeData.fire();
            }, 100);
            
        }).catch(error => {
            this._onDidChangeTreeData.fire(); // Fire anyway to show error state
        });
    }

    async refreshAsync(): Promise<void> {
        this.outputChannel.appendLine('🔄 [TreeProvider] Starting async refresh...');
        await this.loadSkills();
        this.outputChannel.appendLine('🔄 [TreeProvider] About to fire tree data change event');
        
        // Force fire the event with a small delay to ensure UI updates
        await new Promise(resolve => setTimeout(resolve, 100));
        this._onDidChangeTreeData.fire();
        
        this.outputChannel.appendLine('🔄 [TreeProvider] Tree data change event fired');
    }

    getTreeItem(element: SkillTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillTreeItem): Thenable<SkillTreeItem[]> {
        
        try {
            if (!element) {
                // Root level - show two main sections
                const items = this.getRootItems();
                return Promise.resolve(items);
            } else {
                // Child level - show skills in each section  
                return Promise.resolve(this.getChildItems(element));
            }
        } catch (error) {
            return Promise.resolve([]);
        }
    }

    private async loadSkills(): Promise<void> {
        
        // Load installed skills by scope
        try {
            this.outputChannel.appendLine('💾 [TreeProvider] Calling getInstalledSkillsByScope...');
            const installedByScope = await this.skillsService.getInstalledSkillsByScope();
            this.outputChannel.appendLine(`💾 [TreeProvider] Received - Local: ${installedByScope.local.length}, Global: ${installedByScope.global.length}`);
            this.outputChannel.appendLine(`💾 [TreeProvider] Local names: ${JSON.stringify(installedByScope.local.map(s => s.name))}`);
            this.outputChannel.appendLine(`💾 [TreeProvider] Global names: ${JSON.stringify(installedByScope.global.map(s => s.name))}`);
            
            this.installedSkills = installedByScope;
            this.outputChannel.appendLine(`💾 [TreeProvider] After assignment - local: ${this.installedSkills.local.length}, global: ${this.installedSkills.global.length}`);
            this.outputChannel.appendLine('✅ [TreeProvider] Installed skills loaded successfully');
            
        } catch (error) {
            this.installedSkills = { local: [], global: [] };
        }
        
        // Load available skills (Re-enabled with timeout fix)
        try {
            
            // Add timeout protection for available skills
            const available = await Promise.race([
                this.skillsService.getAvailableSkills(),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Available skills timeout after 15 seconds')), 15000)
                )
            ]);
            
            this.availableSkills = available;
            
        } catch (error) {
            this.availableSkills = [];
        }
        
    }

    private getRootItems(): SkillTreeItem[] {
        
        try {
            const localCount = this.installedSkills?.local?.length || 0;
            const globalCount = this.installedSkills?.global?.length || 0;
            const totalInstalled = localCount + globalCount;
            const availableCount = (this.availableSkills || []).reduce((total, repo) => total + (repo.skills?.length || 0), 0);
            
            
            const items = [
                new SkillTreeItem(
                    `Installed Skills (${totalInstalled})`,
                    totalInstalled > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'section'
                ),
                new SkillTreeItem(
                    `Available Skills (${availableCount})`,
                    availableCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'section'
                )
            ];
            
            return items;
        } catch (error) {
            return [
                new SkillTreeItem('Error loading skills', vscode.TreeItemCollapsibleState.None)
            ];
        }
    }

    private getChildItems(element: SkillTreeItem): SkillTreeItem[] {
        const sectionTypes = ['section', 'local-section', 'global-section', 'repository-section', 'error-repo'];
        if (!element.type || !sectionTypes.includes(element.type)) {
            return [];
        }

        if (element.label.includes('Installed')) {
            // Show Local and Global subsections
            const localCount = this.installedSkills?.local?.length || 0;
            const globalCount = this.installedSkills?.global?.length || 0;
            
            if (localCount === 0 && globalCount === 0) {
                return [new SkillTreeItem('No skills installed', vscode.TreeItemCollapsibleState.None)];
            }
            
            const sections = [];
            
            if (localCount > 0) {
                sections.push(new SkillTreeItem(
                    `This repo (${localCount})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    'local-section'
                ));
            }
            
            if (globalCount > 0) {
                sections.push(new SkillTreeItem(
                    `Global (${globalCount})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    'global-section'
                ));
            }
            
            return sections;
            
        } else if (element.type === 'local-section') {
            // Show local skills
            return (this.installedSkills?.local || []).map(skill => 
                new SkillTreeItem(
                    skill.name,
                    vscode.TreeItemCollapsibleState.None,
                    skill,
                    'skill',
                    this.hasUpdateAvailable(skill.name, 'project')
                )
            );
            
        } else if (element.type === 'global-section') {
            // Show global skills
            return (this.installedSkills?.global || []).map(skill => 
                new SkillTreeItem(
                    skill.name,
                    vscode.TreeItemCollapsibleState.None,
                    skill,
                    'skill',
                    this.hasUpdateAvailable(skill.name, 'global')
                )
            );
            
        } else if (element.label.includes('Available')) {
            // Show repositories as subcategories under Available Skills
            const repoItems: SkillTreeItem[] = [];
            
            for (const repoSkills of this.availableSkills) {
                if (repoSkills.error) {
                    repoItems.push(new SkillTreeItem(
                        `${repoSkills.repository.name}: Error loading skills`,
                        vscode.TreeItemCollapsibleState.None,
                        undefined,
                        'error-repo'
                    ));
                } else {
                    // Count available (not installed) skills for this repo
                    const availableSkillsFromRepo = repoSkills.skills.filter(skill => {
                        const isInstalledLocal = this.installedSkills.local?.some(installed => installed.name === skill.name) || false;
                        const isInstalledGlobal = this.installedSkills.global?.some(installed => installed.name === skill.name) || false;
                        return !isInstalledLocal && !isInstalledGlobal;
                    });
                    
                    if (availableSkillsFromRepo.length > 0) {
                        repoItems.push(new SkillTreeItem(
                            `${repoSkills.repository.name} (${availableSkillsFromRepo.length})`,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            undefined,
                            'repository-section'
                        ));
                    }
                }
            }
            
            if (repoItems.length === 0) {
                return [new SkillTreeItem('No available skills found', vscode.TreeItemCollapsibleState.None)];
            }
            
            return repoItems;
            
        } else if (element.type === 'repository-section') {
            // Show skills from specific repository
            const repoName = element.label.split(' (')[0]; // Extract repo name before count
            const repoSkills = this.availableSkills.find(repo => repo.repository.name === repoName);
            
            if (!repoSkills || repoSkills.error) {
                return [new SkillTreeItem('Error loading skills from this repository', vscode.TreeItemCollapsibleState.None)];
            }
            
            const skillItems: SkillTreeItem[] = [];
            for (const skill of repoSkills.skills) {
                // Skip skills that are already installed in either scope
                const isInstalledLocal = this.installedSkills.local?.some(installed => installed.name === skill.name) || false;
                const isInstalledGlobal = this.installedSkills.global?.some(installed => installed.name === skill.name) || false;
                
                if (!isInstalledLocal && !isInstalledGlobal) {
                    // Add repository info to skill for install command
                    const skillWithRepo = {
                        ...skill,
                        repository: repoSkills.repository.url,
                        skillName: skill.name // Ensure skillName is available for CLI
                    };
                    
                    skillItems.push(new SkillTreeItem(
                        skill.name,
                        vscode.TreeItemCollapsibleState.None,
                        skillWithRepo
                    ));
                }
            }
            
            if (skillItems.length === 0) {
                return [new SkillTreeItem('No available skills in this repository', vscode.TreeItemCollapsibleState.None)];
            }
            
            return skillItems;
        }
        
        return [];
    }

    // Get skill by tree item
    getSkill(element: SkillTreeItem): SkillWithRepository | SkillSearchResult | undefined {
        return element.skill;
    }

    // Find specific skill in either local or global scope
    findSkill(skillName: string): SkillWithRepository | undefined {
        const localSkill = this.installedSkills.local?.find(s => s.name === skillName);
        if (localSkill) {return localSkill;}
        
        const globalSkill = this.installedSkills.global?.find(s => s.name === skillName);
        return globalSkill;
    }

    // Get all installed skills
    getAllInstalledSkills(): SkillWithRepository[] {
        return [...this.installedSkills.local, ...this.installedSkills.global];
    }

    // Get all available skills
    getAllAvailableSkills(): RepositorySkills[] {
        return [...this.availableSkills];
    }
    
    // Convenience getters for counts
    get installedCount(): number {
        const localCount = this.installedSkills?.local?.length ?? 0;
        const globalCount = this.installedSkills?.global?.length ?? 0;
        const total = localCount + globalCount;
        
        
        return total;
    }
    
    get availableCount(): number {
        return this.availableSkills.reduce((total, repo) => total + repo.skills.length, 0);
    }
    
    // Install skill method
    async installSkill(skillName: string, repository: string, _path?: string): Promise<void> {
        try {
            
            // Find the skill in available skills to get details
            let foundSkill: any = null;
            for (const repoSkills of this.availableSkills) {
                const skill = repoSkills.skills.find(s => s.name === skillName);
                if (skill) {
                    foundSkill = skill;
                    break;
                }
            }
            
            if (!foundSkill) {
                throw new Error(`Skill ${skillName} not found in available skills`);
            }
            
            // Use SkillsService to install - note the parameter order
            const result = await this.skillsService.installSkill(repository, skillName);
            
            if (result.success) {
                vscode.window.showInformationMessage(`Successfully installed skill: ${skillName}`);
                // Refresh after installation
                this.refresh();
            } else {
                throw new Error(result.error || 'Installation failed');
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`Error installing skill: ${error}`);
            throw error;
        }
    }
    
    // Force reload available skills
    async reloadAvailableSkills(): Promise<void> {
        await this.loadSkills();
        this._onDidChangeTreeData.fire();
    }
}