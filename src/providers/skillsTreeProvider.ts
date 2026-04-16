import * as vscode from 'vscode';
import { SkillsService, SkillWithRepository, RepositorySkills } from '../services/skillsService';
import { SkillSearchResult } from '../services/cliWrapper';

export class SkillTreeItem extends vscode.TreeItem {
    public readonly fullDescription?: string;  // Store full description separately
    
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly skill?: SkillWithRepository | SkillSearchResult,
        public readonly type: 'section' | 'skill' | 'local-section' | 'global-section' = 'skill'
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
            
            this.contextValue = 'skill';
            
            // Set icon and command based on skill status
            if ('installed' in skill && skill.installed) {
                // INSTALLED SKILL - Green check with uninstall command
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                this.command = {
                    command: 'skills.skill.uninstall',
                    title: 'Uninstall Skill',
                    arguments: [this]  // Pass TreeItem instead of just skill
                };
            } else {
                // AVAILABLE SKILL - Blue download with install command  
                this.iconPath = new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
                this.command = {
                    command: 'skills.skill.install',
                    title: 'Install Skill',
                    arguments: [this]  // Pass TreeItem instead of just skill
                };
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
        }
    }
}

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> = new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private installedSkills: { local: SkillWithRepository[], global: SkillWithRepository[] } = { local: [], global: [] };
    private availableSkills: RepositorySkills[] = [];
    private outputChannel: vscode.OutputChannel;

    constructor(public skillsService: SkillsService) {
        console.log('�️  [SkillsTreeProvider] Constructor called');
        this.outputChannel = vscode.window.createOutputChannel('Skills Tree Provider Debug');
        
        // Initialize arrays as empty with new scope structure
        this.installedSkills = { local: [], global: [] };
        this.availableSkills = [];
        console.log('🏗️  [SkillsTreeProvider] Constructor complete - arrays initialized as empty with scope structure');
    }
    
    // Call this AFTER tree view is registered
    async initialize(): Promise<void> {
        console.log('🚀 [SkillsTreeProvider] INITIALIZE called');
        
        try {
            console.log('🚀 [TreeProvider] Loading skills...');
            await this.loadSkills();
            
            console.log('🚀 [TreeProvider] Skills loaded successfully!');
            console.log('🚀 [TreeProvider] Final installedSkills total:', (this.installedSkills?.local.length || 0) + (this.installedSkills?.global.length || 0));
            console.log('🚀 [TreeProvider] Final availableSkills.length:', this.availableSkills?.length || 0);
            console.log('🚀 [TreeProvider] Firing tree change event...');
            
            this._onDidChangeTreeData.fire();
            console.log('✅ [TreeProvider] Tree change event fired - Initialize complete!');
            
        } catch (error) {
            console.error('❌ [TreeProvider] Initialize error:', error);
            console.error('❌ [TreeProvider] Error details:', JSON.stringify(error, null, 2));
            
            // Even if there's an error, fire the event to show what we have
            this._onDidChangeTreeData.fire();
        }
    }

    refresh(): void {
        console.log('🔄 [SkillsTreeProvider] Refresh called');
        this.loadSkills().then(() => {
            console.log('🔄 [SkillsTreeProvider] Load complete, firing tree data change');
            console.log('🔄 [SkillsTreeProvider] Current counts:', {
                installed: this.installedSkills.local.length + this.installedSkills.global.length,
                available: this.availableSkills.length
            });
            
            // Force fire the event to ensure UI updates
            setTimeout(() => {
                console.log('🔥 [SkillsTreeProvider] FORCE FIRING tree data change event');
                this._onDidChangeTreeData.fire();
            }, 100);
            
        }).catch(error => {
            console.error('❌ [SkillsTreeProvider] Refresh error:', error);
            this._onDidChangeTreeData.fire(); // Fire anyway to show error state
        });
    }

    async refreshAsync(): Promise<void> {
        console.log('🔄 [SkillsTreeProvider] Async refresh called');
        this.outputChannel.appendLine('🔄 [TreeProvider] Starting async refresh...');
        await this.loadSkills();
        console.log('🔄 [SkillsTreeProvider] Async load complete, firing tree data change');
        console.log('🔄 [SkillsTreeProvider] Final counts:', {
            installed: this.installedSkills.local.length + this.installedSkills.global.length,
            available: this.availableSkills.length
        });
        this.outputChannel.appendLine('🔄 [TreeProvider] About to fire tree data change event');
        
        // Force fire the event with a small delay to ensure UI updates
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('🔥 [SkillsTreeProvider] FORCE FIRING async tree data change event');
        this._onDidChangeTreeData.fire();
        
        this.outputChannel.appendLine('🔄 [TreeProvider] Tree data change event fired');
    }

    getTreeItem(element: SkillTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillTreeItem): Thenable<SkillTreeItem[]> {
        console.log('📦 [TreeProvider] getChildren called for:', element?.label || 'ROOT');
        console.log('📦 [TreeProvider] installedSkills:', this.installedSkills?.length || 'undefined');
        
        try {
            if (!element) {
                // Root level - show two main sections
                console.log('📦 [TreeProvider] Returning ROOT items...');
                const items = this.getRootItems();
                console.log('📦 [TreeProvider] Root items created:', items.length);
                return Promise.resolve(items);
            } else {
                // Child level - show skills in each section  
                console.log('📦 [TreeProvider] Returning CHILD items for:', element.label);
                return Promise.resolve(this.getChildItems(element));
            }
        } catch (error) {
            console.error('❌ [TreeProvider] ERROR in getChildren:', error);
            return Promise.resolve([]);
        }
    }

    private async loadSkills(): Promise<void> {
        console.log('� [SkillsTreeProvider] Loading skills...');
        
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
            console.error('❌ [TreeProvider] Error loading installed skills:', error);
            this.installedSkills = { local: [], global: [] };
        }
        
        // Load available skills (Re-enabled with timeout fix)
        console.log('🌐 [TreeProvider] Loading available skills...');
        try {
            console.log('🌐 [TreeProvider] Calling getAvailableSkills with timeout protection...');
            
            // Add timeout protection for available skills
            const available = await Promise.race([
                this.skillsService.getAvailableSkills(),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Available skills timeout after 15 seconds')), 15000)
                )
            ]);
            
            console.log('🌐 [TreeProvider] getAvailableSkills completed successfully');
            console.log('🌐 [TreeProvider] Received available skills from', available.length, 'repos');
            this.availableSkills = available;
            console.log('✅ [TreeProvider] Available skills assigned successfully');
            
        } catch (error) {
            console.error('❌ [TreeProvider] Error in getAvailableSkills (using timeout protection):', error);
            this.availableSkills = [];
        }
        
        console.log('🎉 [TreeProvider] loadSkills method completed successfully!');
    }

    private getRootItems(): SkillTreeItem[] {
        console.log('📋 [TreeProvider] getRootItems - Local skills:', this.installedSkills?.local?.length || 0, 'Global skills:', this.installedSkills?.global?.length || 0);
        
        try {
            const localCount = this.installedSkills?.local?.length || 0;
            const globalCount = this.installedSkills?.global?.length || 0;
            const totalInstalled = localCount + globalCount;
            const availableCount = (this.availableSkills || []).reduce((total, repo) => total + (repo.skills?.length || 0), 0);
            
            console.log('📋 [TreeProvider] Creating items with counts:', { local: localCount, global: globalCount, available: availableCount });
            
            const items = [
                new SkillTreeItem(
                    `📊 Installed Skills (${totalInstalled})`,
                    totalInstalled > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'section'
                ),
                new SkillTreeItem(
                    `📦 Available Skills (${availableCount})`,
                    availableCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'section'
                )
            ];
            
            console.log('📋 [TreeProvider] Created items:', items.map(i => i.label));
            return items;
        } catch (error) {
            console.error('❌ [TreeProvider] Error in getRootItems:', error);
            return [
                new SkillTreeItem('Error loading skills', vscode.TreeItemCollapsibleState.None)
            ];
        }
    }

    private getChildItems(element: SkillTreeItem): SkillTreeItem[] {
        const sectionTypes = ['section', 'local-section', 'global-section'];
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
                    `🏠 Local (${localCount})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    undefined,
                    'local-section'
                ));
            }
            
            if (globalCount > 0) {
                sections.push(new SkillTreeItem(
                    `🌍 Global (${globalCount})`,
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
                    skill
                )
            );
            
        } else if (element.type === 'global-section') {
            // Show global skills
            return (this.installedSkills?.global || []).map(skill => 
                new SkillTreeItem(
                    skill.name,
                    vscode.TreeItemCollapsibleState.None,
                    skill
                )
            );
            
        } else if (element.label.includes('Available')) {
            // Show available skills from all repositories
            const items: SkillTreeItem[] = [];
            
            for (const repoSkills of this.availableSkills) {
                if (repoSkills.error) {
                    items.push(new SkillTreeItem(
                        `${repoSkills.repository.name}: Error loading skills`,
                        vscode.TreeItemCollapsibleState.None
                    ));
                } else {
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
                            
                            items.push(new SkillTreeItem(
                                skill.name,
                                vscode.TreeItemCollapsibleState.None,
                                skillWithRepo
                            ));
                        }
                    }
                }
            }
            
            if (items.length === 0) {
                return [new SkillTreeItem('No available skills found', vscode.TreeItemCollapsibleState.None)];
            }
            
            return items;
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
        
        console.log('📊 [TreeProvider] installedCount getter called:', {
            local: localCount,
            global: globalCount,
            total: total,
            installedSkills: this.installedSkills
        });
        
        return total;
    }
    
    get availableCount(): number {
        return this.availableSkills.reduce((total, repo) => total + repo.skills.length, 0);
    }
    
    // Install skill method
    async installSkill(skillName: string, repository: string, _path?: string): Promise<void> {
        try {
            console.log(`Installing skill: ${skillName} from ${repository}`);
            
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
            console.error(`Error installing skill ${skillName}:`, error);
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