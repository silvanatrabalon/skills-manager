import * as vscode from 'vscode';
import { SkillsService, SkillWithRepository, RepositorySkills } from '../services/skillsService';
import { SkillSearchResult, SkillWithDetails } from '../services/cliWrapper';

export class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly skill?: SkillWithRepository | SkillSearchResult,
        public readonly type: 'section' | 'skill' = 'skill'
    ) {
        super(label, collapsibleState);
        
        if (skill && type === 'skill') {
            // Enhanced tooltip with full description if available
            const fullDescription = ('fullDescription' in skill && skill.fullDescription) ? 
                skill.fullDescription : skill.description;
            
            this.tooltip = new vscode.MarkdownString(`**${skill.name}**\n\n${fullDescription}`);
            this.tooltip.isTrusted = true;
            
            // Truncated description for display
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
                    arguments: [skill]
                };
            } else {
                // AVAILABLE SKILL - Blue download with install command  
                this.iconPath = new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
                this.command = {
                    command: 'skills.skill.install',
                    title: 'Install Skill',
                    arguments: [skill]
                };
            }
        } else if (type === 'section') {
            if (label.includes('Installed')) {
                this.iconPath = new vscode.ThemeIcon('check-all');
            } else {
                this.iconPath = new vscode.ThemeIcon('cloud');
            }
            this.contextValue = 'section';
        }
    }
}

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> = new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private installedSkills: SkillWithRepository[] = [];
    private availableSkills: RepositorySkills[] = [];
    private outputChannel: vscode.OutputChannel;

    constructor(public skillsService: SkillsService) {
        console.log('�️  [SkillsTreeProvider] Constructor called');
        this.outputChannel = vscode.window.createOutputChannel('Skills Tree Provider Debug');
        
        // Initialize arrays as empty
        this.installedSkills = [];
        this.availableSkills = [];
        console.log('🏗️  [SkillsTreeProvider] Constructor complete - arrays initialized as empty');
    }
    
    // Call this AFTER tree view is registered
    async initialize(): Promise<void> {
        console.log('🚀 [SkillsTreeProvider] INITIALIZE called');
        
        try {
            console.log('🚀 [TreeProvider] Loading skills...');
            await this.loadSkills();
            
            console.log('🚀 [TreeProvider] Skills loaded successfully!');
            console.log('🚀 [TreeProvider] Final installedSkills.length:', this.installedSkills?.length || 0);
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
                installed: this.installedSkills.length,
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
            installed: this.installedSkills.length,
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
        
        // Load installed skills
        try {
            console.log('💾 [TreeProvider] Calling getInstalledSkills...');
            const installed = await this.skillsService.getInstalledSkills();
            console.log('💾 [TreeProvider] Received', installed.length, 'installed skills');
            
            this.installedSkills = installed;
            console.log('💾 [TreeProvider] Assigned to this.installedSkills, length is now:', this.installedSkills.length);
            console.log('✅ [TreeProvider] Installed skills loaded successfully - continuing...');
            
        } catch (error) {
            console.error('❌ [TreeProvider] Error loading installed skills:', error);
            this.installedSkills = [];
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
        console.log('📋 [TreeProvider] getRootItems - installedSkills length:', this.installedSkills?.length || 0);
        
        try {
            const installedCount = this.installedSkills?.length || 0;
            const availableCount = (this.availableSkills || []).reduce((total, repo) => total + (repo.skills?.length || 0), 0);
            
            console.log('📋 [TreeProvider] Creating items with counts:', { installed: installedCount, available: availableCount });
            
            const items = [
                new SkillTreeItem(
                    `Installed (${installedCount})`,
                    installedCount > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
                    undefined,
                    'section'
                ),
                new SkillTreeItem(
                    `Available (${availableCount})`,
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
        if (element.type !== 'section') {
            return [];
        }

        if (element.label.includes('Installed')) {
            // Show installed skills
            if (this.installedSkills.length === 0) {
                return [new SkillTreeItem('No skills installed', vscode.TreeItemCollapsibleState.None)];
            }
            
            return this.installedSkills.map(skill => 
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
                        // Skip skills that are already installed
                        const isInstalled = this.installedSkills.some(installed => installed.name === skill.name);
                        if (!isInstalled) {
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

    // Find specific skill
    findSkill(skillName: string): SkillWithRepository | undefined {
        return this.installedSkills.find(s => s.name === skillName);
    }

    // Get all installed skills
    getAllInstalledSkills(): SkillWithRepository[] {
        return [...this.installedSkills];
    }

    // Get all available skills
    getAllAvailableSkills(): RepositorySkills[] {
        return [...this.availableSkills];
    }
    
    // Convenience getters for counts
    get installedCount(): number {
        return this.installedSkills.length;
    }
    
    get availableCount(): number {
        return this.availableSkills.reduce((total, repo) => total + repo.skills.length, 0);
    }
    
    // Install skill method
    async installSkill(skillName: string, repository: string, path?: string): Promise<void> {
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