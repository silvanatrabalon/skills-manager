import * as vscode from 'vscode';
import * as https from 'https';
import { SkillsService } from './services/skillsService';
import { SkillsTreeProvider } from './providers/skillsTreeProvider';
import { SkillsCliService } from './services/cliWrapper';
import { UpdateManager } from './services/updateManager';

class GitHubService {
    constructor(private _configService: ConfigService) {}

    async getRepositoryContents(repoUrl: string, path: string = ''): Promise<any[]> {
        return new Promise((resolve, reject) => {
            try {
                const token = this._configService.getGitHubToken();
                
                if (!token) {
                    reject(new Error('GitHub token not configured'));
                    return;
                }

                // Parse repository URL
                const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                if (!match) {
                    reject(new Error('Invalid GitHub repository URL'));
                    return;
                }

                const [, owner, repo] = match;
                const cleanRepo = repo.replace(/\.git$/, '');
                
                const url = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${path}`;
                
                const options = {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'Skills Manager Extension',
                        'Accept': 'application/vnd.github.v3+json'
                    }
                };

                const req = https.get(url, options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            if (res.statusCode === 200) {
                                const contents = JSON.parse(data);
                                resolve(Array.isArray(contents) ? contents : [contents]);
                            } else {
                                const errorData = JSON.parse(data);
                                reject(new Error(`GitHub API error (${res.statusCode}): ${errorData.message}`));
                            }
                        } catch (parseError) {
                            reject(new Error(`Failed to parse GitHub API response: ${parseError}`));
                        }
                    });
                });

                req.on('error', reject);
                req.setTimeout(10000, () => {
                    req.destroy();
                    reject(new Error('GitHub API request timeout'));
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    async findSkillsInRepository(repoUrl: string): Promise<any[]> {
        try {
            console.log(`🔍 [GitHub] Finding skills in repository: ${repoUrl}`);
            const skills: any[] = [];

            // Buscar la carpeta "skills" en la raíz
            let skillsFolder = null;
            try {
                const rootContents = await this.getRepositoryContents(repoUrl);
                skillsFolder = rootContents.find(item => 
                    item.type === 'dir' && item.name.toLowerCase() === 'skills'
                );
                console.log(`🔍 [GitHub] Skills folder found: ${skillsFolder ? 'YES' : 'NO'}`);
            } catch (error) {
                console.error(`🔍 [GitHub] Error reading root directory: ${error}`);
                return [];
            }

            if (skillsFolder) {
                // Examinar cada subcarpeta en skills/ para obtener skill-name
                try {
                    const skillsContents = await this.getRepositoryContents(repoUrl, skillsFolder.path);
                    console.log(`🔍 [GitHub] Found ${skillsContents.length} items in skills folder`);

                    for (const item of skillsContents) {
                        if (item.type === 'dir') {
                            // Verificar que tiene SKILL.md (validación mínima)
                            console.log(`🔍 [GitHub] Checking skill folder: ${item.name}`);
                            
                            try {
                                const skillContents = await this.getRepositoryContents(repoUrl, item.path);
                                const hasSkillMd = skillContents.some(file => 
                                    file.type === 'file' && file.name.toUpperCase() === 'SKILL.MD'
                                );

                                if (hasSkillMd) {
                                    // El skill-name es el nombre de la carpeta
                                    skills.push({
                                        name: item.name,
                                        description: `Skill: ${item.name}`,
                                        path: item.path,
                                        repository: repoUrl,
                                        skillName: item.name, // Para el CLI: skills add {skillName}
                                        type: 'skill'
                                    });
                                    console.log(`✅ [GitHub] Valid skill: ${item.name}`);
                                } else {
                                    console.log(`❌ [GitHub] Invalid skill folder: ${item.name} (no SKILL.md)`);
                                }
                            } catch (subError) {
                                console.error(`🔍 [GitHub] Error checking skill folder ${item.name}: ${subError}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`🔍 [GitHub] Error reading skills folder: ${error}`);
                }
            } else {
                console.log(`🔍 [GitHub] No 'skills' folder found in repository root`);
            }

            console.log(`🔍 [GitHub] Total valid skills found: ${skills.length}`);
            skills.forEach(skill => {
                console.log(`  - skill-name: ${skill.skillName}`);
            });
            
            return skills;

        } catch (error) {
            console.error(`🔍 [GitHub] Failed to find skills in repository: ${(error as Error).message}`);
            return [];
        }
    }
}

// Configuration service
class ConfigService {
    private static readonly STORAGE_KEY = 'skills.repositories';

    constructor(private context: vscode.ExtensionContext) {}

    async getRepositories(): Promise<Repository[]> {
        const repos = this.context.globalState.get<Repository[]>(ConfigService.STORAGE_KEY, []);
        return repos;
    }

    async addRepository(repository: Repository): Promise<void> {
        const repos = await this.getRepositories();
        repos.push(repository);
        await this.context.globalState.update(ConfigService.STORAGE_KEY, repos);
    }

    async removeRepository(id: string): Promise<void> {
        const repos = await this.getRepositories();
        const filtered = repos.filter(r => r.id !== id);
        await this.context.globalState.update(ConfigService.STORAGE_KEY, filtered);
    }

    getGitHubToken(): string {
        if (process.env.GITHUB_TOKEN) {
            return process.env.GITHUB_TOKEN;
        }
        
        const config = vscode.workspace.getConfiguration('skills');
        return config.get<string>('github.token', '');
    }

    getGitHubTokenSource(): string {
        if (process.env.GITHUB_TOKEN) {
            return 'environment variable GITHUB_TOKEN';
        }
        
        const config = vscode.workspace.getConfiguration('skills');
        const configToken = config.get<string>('github.token', '');
        if (configToken) {
            return 'VS Code settings';
        }
        
        return 'not configured';
    }

    isGitHubApiEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('skills');
        return config.get<boolean>('github.enableApi', true);
    }

    async updateGitHubToken(token: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('skills');
        await config.update('github.token', token, vscode.ConfigurationTarget.Global);
    }

    getDefaultScope(): 'global' | 'project' {
        const config = vscode.workspace.getConfiguration('skills');
        return config.get<'global' | 'project'>('defaultScope', 'project');
    }

    getTargetAgents(): string[] {
        const config = vscode.workspace.getConfiguration('skills');
        return config.get<string[]>('targetAgents', []);
    }
}

interface Repository {
    id: string;
    name: string;
    url: string;
    type: string;
    enabled: boolean;
    addedAt: string;
}

// Simple tree provider for repositories
class RepositoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private configService: ConfigService) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(_element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        const repositories = await this.configService.getRepositories();
        
        if (repositories.length === 0) {
            return [
                this.createInfoItem('No repositories configured'),
                this.createInfoItem('Click + to add a repository')
            ];
        }

        return repositories.map(repo => {
            const item = new vscode.TreeItem(repo.name, vscode.TreeItemCollapsibleState.None);
            item.description = repo.url;
            item.tooltip = `${repo.name}\n${repo.url}\nType: ${repo.type}`;
            item.contextValue = 'repository';  // ¡Esta línea faltaba!
            item.iconPath = new vscode.ThemeIcon(
                repo.type === 'github' ? 'github' : 
                repo.type === 'gitlab' ? 'gitlab' : 
                repo.type === 'local' ? 'folder' : 'repo'
            );
            // Store repository data for remove command
            (item as any).repository = repo;
            return item;
        });
    }

    private createInfoItem(text: string): vscode.TreeItem {
        const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        item.contextValue = 'info';
        return item;
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('🚀 [Extension] Skills Manager extension is now active!');
    
    try {
        // Initialize services
        console.log('🔧 [Extension] Initializing services...');
        const configService = new ConfigService(context);
        const cliService = new SkillsCliService();
        const githubService = new GitHubService(configService);
        
        // Create tree providers
        console.log('🌳 [Extension] Creating tree providers...');
        const skillsService = new SkillsService(cliService, configService);
        const skillsProvider = new SkillsTreeProvider(skillsService);
        const repoProvider = new RepositoryTreeProvider(configService);
        
        // Register tree views
        console.log('📝 [Extension] Registering tree view...');
        const skillsTreeView = vscode.window.createTreeView('skills.tree', {
            treeDataProvider: skillsProvider,
            showCollapseAll: true
        });
        console.log('📝 [Extension] Tree view registered successfully');
        
        // NOW initialize the skills provider AFTER tree view registration
        console.log('🚀 [Extension] Calling skillsProvider.initialize()...');
        try {
            await skillsProvider.initialize();
            console.log('✅ [Extension] skillsProvider.initialize() completed successfully');
        } catch (error) {
            console.error('❌ [Extension] Error in skillsProvider.initialize():', error);
        }
        
        // ← NUEVO: Initialize UpdateManager DESPUÉS de que skillsProvider esté listo
        console.log('🕒 [Extension] Initializing UpdateManager...');
        const updateManager = new UpdateManager(context);
        await updateManager.initialize();
        
        // Configure the skills provider to use the update manager
        skillsProvider.setUpdateManager(updateManager);
        
        const repositoryTreeView = vscode.window.createTreeView('skills.repositories', {
            treeDataProvider: repoProvider,
            showCollapseAll: true
        });
        
        // Create a simple configuration provider
        const configProvider = {
            _onDidChangeTreeData: new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>(),
            onDidChangeTreeData: this._onDidChangeTreeData?.event,
            
            getTreeItem: (element: vscode.TreeItem) => element,
            getChildren: async (): Promise<vscode.TreeItem[]> => {
                const configItems: vscode.TreeItem[] = [];
                const tokenSource = configService.getGitHubTokenSource();
                
                if (tokenSource !== 'not configured') {
                    const tokenStatusItem = new vscode.TreeItem(`GitHub Token: ${tokenSource}`, vscode.TreeItemCollapsibleState.None);
                    tokenStatusItem.iconPath = new vscode.ThemeIcon('key');
                    tokenStatusItem.description = 'Configured ✓';
                    tokenStatusItem.command = { command: 'skills.github.testToken', title: 'Test Token' };
                    configItems.push(tokenStatusItem);
                } else {
                    const noTokenItem = new vscode.TreeItem('Configure GitHub Token', vscode.TreeItemCollapsibleState.None);
                    noTokenItem.iconPath = new vscode.ThemeIcon('key');
                    noTokenItem.description = 'Required for API access';
                    noTokenItem.command = { command: 'skills.github.configureToken', title: 'Configure Token' };
                    configItems.push(noTokenItem);
                }
                
                const debugItem = new vscode.TreeItem('Debug Environment', vscode.TreeItemCollapsibleState.None);
                debugItem.iconPath = new vscode.ThemeIcon('bug');
                debugItem.description = 'Show debug info';
                debugItem.command = { command: 'skills.debug.environment', title: 'Debug Environment' };
                configItems.push(debugItem);
                
                return configItems;
            },
            
            refresh: function() {
                this._onDidChangeTreeData.fire();
            }
        };
        
        const configurationTreeView = vscode.window.createTreeView('skills.configuration', {
            treeDataProvider: configProvider,
            showCollapseAll: true
        });
        
        // Commands
        const refreshCommand = vscode.commands.registerCommand('skills.refresh', async () => {
            await skillsProvider.refreshAsync();
            repoProvider.refresh();
            configProvider.refresh();
            vscode.window.showInformationMessage('Refreshed Skills Manager - Check output for details');
            cliService.showDebugOutput();
        });

        const collapseAllCommand = vscode.commands.registerCommand('skills.collapseAll', async () => {
            await vscode.commands.executeCommand('skills.tree.collapseAll');
            vscode.window.showInformationMessage('Collapsed all skill categories');
        });
        
        const addRepoCommand = vscode.commands.registerCommand('skills.repository.add', async () => {
            await addRepositoryInteractive(configService, repoProvider, skillsProvider);
        });

        const removeRepoCommand = vscode.commands.registerCommand('skills.repository.remove', async (item: vscode.TreeItem) => {
            await removeRepositoryInteractive(item, configService, repoProvider, skillsProvider);
        });
        
        const showDebugCommand = vscode.commands.registerCommand('skills.showDebug', () => {
            cliService.showDebugOutput();
        });
        
        const skillSelectCommand = vscode.commands.registerCommand('skills.skill.select', async (skill) => {
            if (skill.installed) {
                vscode.window.showInformationMessage(`Skill "${skill.name}" is already installed`);
            } else {
                const install = await vscode.window.showInformationMessage(
                    `Install skill "${skill.name}"?`,
                    'Install', 'Cancel'
                );
                
                if (install === 'Install') {
                    // Use repositoryUrl if available, fallback to repository
                    const repoUrl = skill.repositoryUrl || skill.repository;
                    const result = await skillsService.installSkill(repoUrl, skill.name);
                    if (result.success) {
                        vscode.window.showInformationMessage(`Skill "${skill.name}" installed successfully!`);
                        skillsProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage(`Failed to install skill "${skill.name}": ${result.error}`);
                        cliService.showDebugOutput();
                    }
                }
            }
        });

        const configureTokenCommand = vscode.commands.registerCommand('skills.github.configureToken', async () => {
            // Check if environment variable exists
            const envToken = process.env.GITHUB_TOKEN;
            if (envToken) {
                const useEnv = await vscode.window.showInformationMessage(
                    'GITHUB_TOKEN environment variable already exists. Use it or configure VS Code setting?',
                    'Use Environment Variable', 'Configure VS Code Setting', 'Cancel'
                );
                
                if (useEnv === 'Use Environment Variable') {
                    vscode.window.showInformationMessage('Using existing GITHUB_TOKEN environment variable. Refreshing skills...');
                    await skillsProvider.refreshAsync();
                    return;
                } else if (useEnv === 'Cancel') {
                    return;
                }
                // Continue to VS Code configuration if "Configure VS Code Setting" was selected
            }
            
            const token = await vscode.window.showInputBox({
                prompt: 'Enter your GitHub Personal Access Token (will be stored in VS Code settings)',
                password: true,
                placeHolder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value) {return 'Token is required';}
                    if (!value.startsWith('ghp_')) {return 'Token should start with ghp_';}
                    if (value.length < 10) {return 'Token seems too short';}
                    return undefined;
                }
            });
            
            if (token) {
                await configService.updateGitHubToken(token);
                vscode.window.showInformationMessage('GitHub token configured in VS Code settings! Refreshing skills...');
                await skillsProvider.refreshAsync();
            }
        });

        const removeTokenCommand = vscode.commands.registerCommand('skills.github.removeToken', async () => {
            await configService.updateGitHubToken('');
            vscode.window.showInformationMessage('GitHub token removed. Refreshing skills...');
            await skillsProvider.refreshAsync();
        });

        const testTokenCommand = vscode.commands.registerCommand('skills.github.testToken', async () => {
            const token = configService.getGitHubToken();
            const tokenSource = configService.getGitHubTokenSource();
            
            if (!token) {
                vscode.window.showWarningMessage('No GitHub token found. Set GITHUB_TOKEN environment variable or use "Configure GitHub Token" command.');
                return;
            }
            
            try {
                vscode.window.showInformationMessage(`Testing GitHub token from ${tokenSource}...`);
                await githubService.getRepositoryContents('https://github.com/octocat/Hello-World');
                vscode.window.showInformationMessage(`GitHub token (from ${tokenSource}) is valid and working!`);
            } catch (error: any) {
                vscode.window.showErrorMessage(`GitHub token test failed: ${error.message}`);
            }
        });

        const installSkillCommand = vscode.commands.registerCommand('skills.install', async (skillName: string, repository: string, path: string) => {
            await skillsProvider.installSkill(skillName, repository, path);
        });

        // Comando específico para install desde available skills
        const skillInstallCommand = vscode.commands.registerCommand('skills.skill.install', async (skillItem: any) => {
            try {
                console.log('🚀 [Install] Installing skill:', skillItem);
                
                // Extract data from TreeItem if needed
                const skill = skillItem.skill || skillItem;
                const skillName = skill.skillName || skill.name || skillItem.label;
                const repository = skill.repository || skill.source;
                
                if (!skillName || !repository) {
                    vscode.window.showErrorMessage('Missing skill name or repository info');
                    return;
                }

                // Show scope selection dialog
                const scopeOptions = [
                    {
                        label: '🏠 This repo (Project only)',
                        description: 'Install this skill for current project only',
                        detail: 'Skill will be available only in this workspace',
                        scope: 'local' as const
                    },
                    {
                        label: '🌍 Global (All projects)',
                        description: 'Install this skill globally for all projects',
                        detail: 'Skill will be available in all workspaces',
                        scope: 'global' as const
                    },
                    {
                        label: '🔄 Both (This repo + Global)',
                        description: 'Install in both this repository and global scopes',
                        detail: 'Maximum availability - install everywhere',
                        scope: 'both' as const
                    }
                ];

                const selectedScope = await vscode.window.showQuickPick(scopeOptions, {
                    title: `Install Skill: ${skillName}`,
                    placeHolder: 'Choose installation scope...',
                    ignoreFocusOut: true
                });

                if (!selectedScope) {
                    return; // User cancelled
                }

                // Show agent selection dialog
                const availableAgents = [
                    { label: 'cursor', description: 'Cursor AI Assistant', checked: true },
                    { label: 'github-copilot', description: 'GitHub Copilot', checked: false },
                    { label: 'opencode', description: 'OpenCode Assistant', checked: false },
                    { label: 'claude-code', description: 'Anthropic Claude', checked: false },
                    { label: 'antigravity', description: 'Antigravity Assistant', checked: false },
                    { label: 'codex', description: 'OpenAI Codex', checked: false }
                ];

                const selectedAgents = await vscode.window.showQuickPick(availableAgents, {
                    title: `Select Target Agents for ${skillName}`,
                    placeHolder: 'Choose which agents to install this skill for...',
                    canPickMany: true,
                    ignoreFocusOut: true
                });

                if (!selectedAgents || selectedAgents.length === 0) {
                    vscode.window.showWarningMessage('No agents selected. Installation cancelled.');
                    return;
                }

                const agentNames = selectedAgents.map(agent => agent.label);
                console.log(`🚀 [Install] Selected agents: ${agentNames.join(', ')}`);

                console.log(`🚀 [Install] Selected scope: ${selectedScope.scope}`);

                // Execute installation based on selected scope
                if (selectedScope.scope === 'both') {
                    // Install both local and global
                    const localResult = await skillsService.installSkill(repository, skillName, { 
                        scope: 'project',
                        agents: agentNames 
                    });
                    const globalResult = await skillsService.installSkill(repository, skillName, { 
                        scope: 'global',
                        agents: agentNames 
                    });
                    
                    if (localResult.success && globalResult.success) {
                        vscode.window.showInformationMessage(`✅ Successfully installed ${skillName} both locally and globally for ${agentNames.join(', ')}`);
                        // Post-install: enrich lock files with skillFolderHash (force=true to overwrite CLI values)
                        const ucs = updateManager.getUpdateCheckService();
                        const projectLock = ucs.getProjectLockPath();
                        if (projectLock) { await ucs.enrichLockEntry(skillName, projectLock, true); }
                        await ucs.enrichLockEntry(skillName, ucs.getGlobalLockPath(), true);
                    } else {
                        const errors = [];
                        if (!localResult.success) {errors.push(`Local: ${localResult.message}`);}
                        if (!globalResult.success) {errors.push(`Global: ${globalResult.message}`);}
                        vscode.window.showErrorMessage(`❌ Partial failure installing ${skillName}: ${errors.join(', ')}`);
                    }
                } else {
                    // Install single scope
                    const scope = selectedScope.scope === 'local' ? 'project' : 'global';
                    const result = await skillsService.installSkill(repository, skillName, { 
                        scope,
                        agents: agentNames 
                    });
                    
                    if (result.success) {
                        const scopeText = scope === 'project' ? 'locally' : 'globally';
                        vscode.window.showInformationMessage(`✅ Successfully installed ${skillName} ${scopeText} for ${agentNames.join(', ')}`);
                        // Post-install: enrich lock file with skillFolderHash (force=true to overwrite CLI values)
                        const ucs = updateManager.getUpdateCheckService();
                        const lockPath = scope === 'global' ? ucs.getGlobalLockPath() : ucs.getProjectLockPath();
                        if (lockPath) { await ucs.enrichLockEntry(skillName, lockPath, true); }
                    } else {
                        vscode.window.showErrorMessage(`❌ Failed to install ${skillName}: ${result.message}`);
                    }
                }
                
                // Refresh UI
                await skillsProvider.refreshAsync();
                
            } catch (error: any) {
                console.error('❌ [Install] Error installing skill:', error);
                vscode.window.showErrorMessage(`Failed to install skill: ${error.message}`);
            }
        });

        // Comando específico para uninstall desde installed skills
        const skillUninstallCommand = vscode.commands.registerCommand('skills.skill.uninstall', async (skillItem: any) => {
            try {
                console.log('🗑️ [Uninstall] Uninstalling skill:', skillItem);
                
                // Extract data from TreeItem if needed
                const skill = skillItem.skill || skillItem;
                const skillName = skill.name || skill.skillName || skillItem.label;
                
                if (!skillName) {
                    vscode.window.showErrorMessage('Missing skill name');
                    return;
                }

                // Confirmar antes de desinstalar
                const confirm = await vscode.window.showWarningMessage(
                    `Are you sure you want to uninstall "${skillName}"?`,
                    'Yes', 'Cancel'
                );
                
                if (confirm !== 'Yes') {
                    return;
                }

                // Determinar scope del skill para remover correctamente
                const skillScope = skill.scope; // 'project' | 'global' | undefined
                
                console.log(`🗑️ [Uninstall] Skill scope detected: ${skillScope}`);

                // Ejecutar el comando CLI via service (incluye --yes automáticamente)
                const results = await skillsService.removeSkills([skillName], { 
                    scope: skillScope // ✅ CORREGIDO: usar 'scope' en vez de 'global'
                });
                const result = results[0];
                
                if (result?.success) {
                    vscode.window.showInformationMessage(`✅ Uninstalled skill: ${skillName}`);
                } else {
                    vscode.window.showErrorMessage(`❌ Failed to uninstall ${skillName}: ${result?.message || 'Unknown error'}`);
                }
                
                await skillsProvider.refreshAsync();
                
            } catch (error: any) {
                console.error('❌ [Uninstall] Error uninstalling skill:', error);
                vscode.window.showErrorMessage(`Failed to uninstall skill: ${error.message}`);
            }
        });

        // Comando específico para mostrar detalles del skill  
        const skillShowDetailsCommand = vscode.commands.registerCommand('skills.skill.showDetails', async (skillItem: any) => {
            try {
                console.log('ℹ️ [Details] Showing skill details for:', skillItem);
                console.log('ℹ️ [Details] skillItem keys:', Object.keys(skillItem || {}));
                console.log('ℹ️ [Details] skillItem.skill:', skillItem?.skill);
                console.log('ℹ️ [Details] skillItem.fullDescription:', skillItem?.fullDescription);
                
                const skillName = skillItem?.name || skillItem?.skillName || skillItem?.label || 'Unknown Skill';
                const description = skillItem?.description || 'No description available';
                
                // Get full description from TreeItem if available, otherwise from skill object
                let fullDescription = skillItem?.fullDescription || 
                                    skillItem?.skill?.fullDescription || 
                                    skillItem?.skill?.description ||
                                    description;
                
                // If still truncated, try to get from the original skill data
                if (fullDescription.endsWith('...')) {
                    fullDescription = skillItem?.skill?.fullDescription || 
                                    skillItem?.skill?.description || 
                                    fullDescription;
                }
                
                const source = skillItem?.source || skillItem?.skill?.source || skillItem?.repository || 'Unknown source';
                const isInstalled = ('installed' in skillItem && skillItem.installed) || 
                                  (skillItem?.skill && 'installed' in skillItem.skill && skillItem.skill.installed) || 
                                  false;
                                  
                console.log('ℹ️ [Details] Final fullDescription:', fullDescription);
                console.log('ℹ️ [Details] Description length:', fullDescription.length);
                
                // Show in a webview panel for better formatting
                const panel = vscode.window.createWebviewPanel(
                    'skillDetails',
                    `Skill: ${skillName}`,
                    vscode.ViewColumn.Beside,
                    { 
                        enableCommandUris: true,
                        retainContextWhenHidden: true
                    }
                );
                
                panel.webview.html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Skill Details</title>
                        <style>
                            * {
                                box-sizing: border-box;
                                margin: 0;
                                padding: 0;
                            }
                            
                            body { 
                                font-family: var(--vscode-font-family);
                                line-height: 1.6;
                                color: var(--vscode-foreground);
                                background: var(--vscode-editor-background);
                                padding: 24px;
                                min-height: 100vh;
                            }
                            
                            .container {
                                max-width: 800px;
                                margin: 0 auto;
                                animation: fadeIn 0.3s ease-out;
                            }
                            
                            @keyframes fadeIn {
                                from { opacity: 0; transform: translateY(10px); }
                                to { opacity: 1; transform: translateY(0); }
                            }
                            
                            .header {
                                display: flex;
                                align-items: flex-start;
                                gap: 16px;
                                margin-bottom: 24px;
                                padding: 20px;
                                background: var(--vscode-sideBar-background);
                                border-radius: 12px;
                                border: 1px solid var(--vscode-sideBar-border);
                                position: relative;
                                overflow: hidden;
                            }
                            
                            .header::before {
                                content: '';
                                position: absolute;
                                top: 0;
                                left: 0;
                                right: 0;
                                height: 3px;
                                background: ${isInstalled ? 
                                    'linear-gradient(90deg, var(--vscode-charts-green), var(--vscode-charts-blue))' : 
                                    'linear-gradient(90deg, var(--vscode-charts-blue), var(--vscode-charts-purple))'
                                };
                            }
                            
                            .skill-icon {
                                font-size: 48px;
                                line-height: 1;
                                margin-top: 4px;
                                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
                            }
                            
                            .header-content {
                                flex: 1;
                            }
                            
                            h1 { 
                                font-size: 28px;
                                font-weight: 600;
                                color: var(--vscode-titleBar-activeForeground);
                                margin-bottom: 8px;
                                letter-spacing: -0.5px;
                            }
                            
                            .status-badge { 
                                display: inline-flex;
                                align-items: center;
                                gap: 8px;
                                padding: 8px 16px;
                                border-radius: 20px;
                                font-size: 14px;
                                font-weight: 500;
                                background: ${isInstalled ? 
                                    'var(--vscode-charts-green)' : 
                                    'var(--vscode-charts-blue)'
                                };
                                color: ${isInstalled ? 
                                    'var(--vscode-button-foreground)' : 
                                    'var(--vscode-button-foreground)'
                                };
                                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                            }
                            
                            .card {
                                background: var(--vscode-sideBar-background);
                                border: 1px solid var(--vscode-sideBar-border);
                                border-radius: 12px;
                                padding: 20px;
                                margin-bottom: 16px;
                                transition: all 0.2s ease;
                            }
                            
                            .card:hover {
                                border-color: var(--vscode-focusBorder);
                                box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                            }
                            
                            .card-title {
                                font-size: 16px;
                                font-weight: 600;
                                color: var(--vscode-textLink-foreground);
                                margin-bottom: 12px;
                                display: flex;
                                align-items: center;
                                gap: 8px;
                            }
                            
                            .card-title::before {
                                content: '';
                                width: 4px;
                                height: 16px;
                                background: var(--vscode-textLink-foreground);
                                border-radius: 2px;
                            }
                            
                            .source-info {
                                display: flex;
                                align-items: center;
                                gap: 12px;
                                flex-wrap: wrap;
                            }
                            
                            .source-chip { 
                                background: var(--vscode-textCodeBlock-background);
                                padding: 8px 12px;
                                border-radius: 8px;
                                font-family: var(--vscode-editor-font-family);
                                font-size: 13px;
                                border: 1px solid var(--vscode-input-border);
                                color: var(--vscode-textPreformat-foreground);
                                word-break: break-all;
                                flex: 1;
                                min-width: 200px;
                            }
                            
                            .source-icon {
                                font-size: 20px;
                                color: var(--vscode-symbolIcon-repositoryForeground);
                            }
                            
                            .description {
                                background: var(--vscode-textBlockQuote-background);
                                border: 1px solid var(--vscode-textBlockQuote-border);
                                border-left: 4px solid var(--vscode-textLink-foreground);
                                border-radius: 8px;
                                padding: 20px;
                                margin: 0;
                            }
                            
                            .description-content {
                                line-height: 1.7;
                                font-size: 14px;
                                color: var(--vscode-foreground);
                                white-space: pre-wrap;
                                word-wrap: break-word;
                            }
                            
                            /* Markdown-style formatting for description */
                            .description-content h1,
                            .description-content h2,
                            .description-content h3 {
                                color: var(--vscode-textLink-foreground);
                                margin: 16px 0 8px 0;
                                font-weight: 600;
                            }
                            
                            .description-content h1 { font-size: 20px; }
                            .description-content h2 { font-size: 18px; }
                            .description-content h3 { font-size: 16px; }
                            
                            .description-content p {
                                margin: 12px 0;
                            }
                            
                            .description-content code {
                                background: var(--vscode-textCodeBlock-background);
                                padding: 2px 6px;
                                border-radius: 4px;
                                font-family: var(--vscode-editor-font-family);
                                font-size: 13px;
                            }
                            
                            .description-content ul,
                            .description-content ol {
                                padding-left: 24px;
                                margin: 12px 0;
                            }
                            
                            .description-content li {
                                margin: 6px 0;
                            }
                            
                            .footer {
                                margin-top: 32px;
                                padding-top: 20px;
                                border-top: 1px solid var(--vscode-sideBar-border);
                                text-align: center;
                                color: var(--vscode-descriptionForeground);
                                font-size: 12px;
                                opacity: 0.7;
                            }
                            
                            /* Scrollbar styling */
                            ::-webkit-scrollbar {
                                width: 8px;
                            }
                            
                            ::-webkit-scrollbar-track {
                                background: var(--vscode-scrollbarSlider-background);
                            }
                            
                            ::-webkit-scrollbar-thumb {
                                background: var(--vscode-scrollbarSlider-background);
                                border-radius: 4px;
                            }
                            
                            ::-webkit-scrollbar-thumb:hover {
                                background: var(--vscode-scrollbarSlider-hoverBackground);
                            }
                            
                            /* Responsive design */
                            @media (max-width: 600px) {
                                body { padding: 16px; }
                                .header { flex-direction: column; text-align: center; }
                                .skill-icon { align-self: center; }
                                h1 { font-size: 24px; }
                                .source-info { flex-direction: column; }
                                .source-chip { min-width: auto; }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="header">
                                <div class="header-content">
                                    <h1>${skillName}</h1>
                                </div>
                            </div>
                            
                            <div class="card">
                                <div class="card-title">
                                    Source Information
                                </div>
                                <div class="source-info">
                                    <div class="source-chip">${source}</div>
                                </div>
                            </div>
                            
                            <div class="card">
                                <div class="card-title">
                                    Description
                                </div>
                                <div class="description">
                                    <div class="description-content">${fullDescription}</div>
                                </div>
                            </div>
                            
                            <div class="footer">
                                Skills Manager • Use the inline buttons in the tree view to manage this skill
                            </div>
                        </div>
                        <script>
                            // Auto-focus on load for better UX
                            window.addEventListener('load', () => {
                                document.body.focus();
                            });
                            
                            // Simple markdown-like formatting for descriptions
                            function formatDescription() {
                                const content = document.querySelector('.description-content');
                                if (!content) return;
                                
                                let html = content.textContent
                                    // Headers
                                    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
                                    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
                                    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
                                    // Code blocks
                                    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                                    // Bold text
                                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                    // Italic text
                                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                    // Line breaks
                                    .replace(/\n\n/g, '</p><p>')
                                    .replace(/\n/g, '<br>');
                                    
                                content.innerHTML = '<p>' + html + '</p>';
                            }
                            
                            // Format description on load
                            formatDescription();
                        </script>
                    </body>
                    </html>
                `;
                
            } catch (error: any) {
                console.error('❌ [Details] Error showing skill details:', error);
                vscode.window.showErrorMessage(`Failed to show skill details: ${error.message}`);
            }
        });

        const debugEnvironmentCommand = vscode.commands.registerCommand('skills.debug.environment', async () => {
            const output = cliService.showDebugOutput();
            const token = configService.getGitHubToken();
            const tokenSource = configService.getGitHubTokenSource();
            const apiEnabled = configService.isGitHubApiEnabled();
            
            output.appendLine('=== COMPLETE SKILLS MANAGER DEBUG ===');
            output.appendLine(`GITHUB_TOKEN env var: ${process.env.GITHUB_TOKEN ? 'Set (' + process.env.GITHUB_TOKEN.length + ' chars)' : 'Not set'}`);
            output.appendLine(`ConfigService token: ${token ? 'YES (' + token.length + ' chars)' : 'NO'}`);
            output.appendLine(`Token source: ${tokenSource}`);
            output.appendLine(`API enabled: ${apiEnabled}`);
            
            // Force refresh and wait for completion
            output.appendLine('\n🔄 Loading current skills data...');
            await skillsProvider.refreshAsync();
            
            // Direct inspection of internal state
            const internalState = (skillsProvider as any).installedSkills;
            output.appendLine(`\n=== INSTALLED SKILLS INTERNAL STATE ===`);
            output.appendLine(`Type of installedSkills: ${typeof internalState}`);
            output.appendLine(`Is array?: ${Array.isArray(internalState)}`);
            output.appendLine(`Has local?: ${Object.prototype.hasOwnProperty.call(internalState, 'local')}`);
            output.appendLine(`Has global?: ${Object.prototype.hasOwnProperty.call(internalState, 'global')}`);
            output.appendLine(`local length: ${internalState?.local?.length}`);
            output.appendLine(`global length: ${internalState?.global?.length}`);
            output.appendLine(`local content: ${JSON.stringify(internalState?.local?.map((s: any) => s.name))}`);
            output.appendLine(`global content: ${JSON.stringify(internalState?.global?.map((s: any) => s.name))}`);
            output.appendLine(`installedCount getter: ${skillsProvider.installedCount}`);
            output.appendLine(`=== END INTERNAL STATE ===\n`);
            
            output.appendLine(`Available skills: ${skillsProvider.availableCount}`);
            output.appendLine(`Installed skills: ${skillsProvider.installedCount}`);
            
            const config = vscode.workspace.getConfiguration('skills');
            output.appendLine(`VS Code github.token: ${config.get('github.token') ? 'Set (***masked***)' : 'Not set'}`);
            output.appendLine(`VS Code github.enableApi: ${config.get('github.enableApi')}`);
            output.show();
            
            // Force reload
            vscode.window.showInformationMessage(
                'Debug complete. Force reload available skills?',
                'Yes', 'No'
            ).then(async (selection) => {
                if (selection === 'Yes') {
                    output.appendLine('\n🔄 FORCE RELOADING...');
                    try {
                        await skillsProvider.reloadAvailableSkills();
                        output.appendLine(`✅ Reload complete: ${skillsProvider.availableCount} skills`);
                    } catch (error) {
                        output.appendLine(`❌ Reload error: ${error}`);
                    }
                }
            });
        });

        const testCliCommand = vscode.commands.registerCommand('skills.test.cli', async () => {
            const output = cliService.showDebugOutput();
            output.appendLine('=== TESTING CLI DIRECTLY ===');
            
            try {
                // Test the raw CLI command
                const { exec } = require('child_process');
                const { promisify } = require('util');
                const execAsync = promisify(exec);
                
                output.appendLine('Running: npx skills list');
                const result = await execAsync('npx skills list', {
                    env: { 
                        ...process.env, 
                        PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:' + require('os').homedir() + '/.nvm/versions/node/v20.15.0/bin'
                    }
                });
                
                output.appendLine('STDOUT:');
                output.appendLine(result.stdout);
                output.appendLine('STDERR:');
                output.appendLine(result.stderr || 'none');
                
                // Test skills find
                output.appendLine('\n=== TESTING SKILLS FIND ===');
                const findResult = await execAsync('npx skills find', {
                    env: { 
                        ...process.env, 
                        PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:' + require('os').homedir() + '/.nvm/versions/node/v20.15.0/bin'
                    }
                });
                output.appendLine('FIND STDOUT:');
                output.appendLine(findResult.stdout);
                
                // Test repositories configuration
                output.appendLine('\n=== TESTING REPOSITORIES CONFIG ===');
                const repositories = await configService.getRepositories();
                output.appendLine(`Configured repositories: ${repositories.length}`);
                repositories.forEach((repo, index) => {
                    output.appendLine(`${index + 1}. ${repo.name} (${repo.type}) - ${repo.url}`);
                });
                
                // Now test through our service
                output.appendLine('\n=== TESTING THROUGH SERVICE ===');
                const skills = await skillsProvider.skillsService.getInstalledSkills();
                output.appendLine(`Service returned: ${skills.length} skills`);
                skills.forEach(skill => {
                    output.appendLine(`- ${skill.name} (${skill.scope}) - ${skill.description}`);
                });
                
                // DIRECT PROVIDER TEST
                output.appendLine('\n=== TESTING PROVIDER DIRECTLY ===');
                output.appendLine(`skillsProvider.installedSkills.length: ${(skillsProvider as any).installedSkills.length}`);
                output.appendLine(`skillsProvider.installedCount: ${skillsProvider.installedCount}`);
                output.appendLine(`skillsProvider.availableCount: ${skillsProvider.availableCount}`);
                
                // Force manual assignment to test
                output.appendLine('\n=== MANUAL VARIABLE TEST ===');
                (skillsProvider as any).installedSkills = skills;
                output.appendLine(`After manual assignment: ${(skillsProvider as any).installedSkills.length}`);
                output.appendLine('Firing tree change event...');
                (skillsProvider as any)._onDidChangeTreeData.fire();
                
            } catch (error) {
                output.appendLine(`ERROR: ${error}`);
            }
            
            output.show();
            vscode.window.showInformationMessage('CLI test complete - check output panel');
        });

        const showExplorerCommand = vscode.commands.registerCommand('skills.explorer.show', async () => {
            try {
                // Show Skills tree view in sidebar
                await vscode.commands.executeCommand('workbench.view.extension.skills-sidebar');
                vscode.window.showInformationMessage('Skills Explorer opened!');
            } catch (error: any) {
                console.error('Error showing skills explorer:', error);
                vscode.window.showErrorMessage(`Failed to show Skills Explorer: ${error.message}`);
            }
        });

        const interactiveInstallCommand = vscode.commands.registerCommand('skills.install.interactive', async () => {
            try {
                // Trigger the same logic as the install button in available skills
                await vscode.commands.executeCommand('skills.refresh');
                vscode.window.showInformationMessage('Use the Skills tree view to browse and install skills!');
            } catch (error: any) {
                console.error('Error in interactive install:', error);
                vscode.window.showErrorMessage(`Failed to start interactive install: ${error.message}`);
            }
        });
        
        // ← NUEVO: Comando para actualizar un skill específico
        const skillUpdateCommand = vscode.commands.registerCommand('skills.skill.update', async (skillItem: any) => {
            try {
                console.log('🔄 [Update] Updating skill:', skillItem);
                
                const skill = skillItem.skill || skillItem;
                const skillName = skill.name || skill.skillName || skillItem.label;
                
                if (!skillName) {
                    vscode.window.showErrorMessage('Missing skill name');
                    return;
                }

                // Confirmar el update
                const confirm = await vscode.window.showInformationMessage(
                    `Update "${skillName}" to the latest version?`,
                    'Update', 'Cancel'
                );
                
                if (confirm !== 'Update') {
                    return;
                }

                // Ejecutar el update
                console.log(`🔄 [Extension] Updating skill "${skillName}" with scope: "${skill.scope}"`);
                const results = await skillsService.updateSkills([skillName], skill.scope);
                const result = results[0];
                
                if (result?.success) {
                    vscode.window.showInformationMessage(`✅ Updated skill: ${skillName}`);
                    
                    // Mark as updated in UpdateManager (scope-specific)
                    const updateScope = skill.scope === 'global' ? 'global' : 'project';
                    await updateManager.markSkillAsUpdated(skillName, updateScope as 'global' | 'project');
                    
                    // Post-update: enrich lock file with new skillFolderHash (force=true to get fresh hash)
                    const ucs = updateManager.getUpdateCheckService();
                    const lockPath = skill.scope === 'global' ? ucs.getGlobalLockPath() : ucs.getProjectLockPath();
                    if (lockPath) { await ucs.enrichLockEntry(skillName, lockPath, true); }
                    
                    // Refresh tree to remove update indicator
                    await skillsProvider.refreshAsync();
                } else {
                    vscode.window.showErrorMessage(`❌ Failed to update ${skillName}: ${result?.message || 'Unknown error'}`);
                }
                
            } catch (error: any) {
                console.error('❌ [Update] Error updating skill:', error);
                vscode.window.showErrorMessage(`Failed to update skill: ${error.message}`);
            }
        });
        
        // ← NUEVO: Comando para forzar check de updates
        const forceUpdateCheckCommand = vscode.commands.registerCommand('skills.update.check', async () => {
            try {
                vscode.window.showInformationMessage('Checking for skill updates...');
                const updatesAvailable = await updateManager.forceUpdateCheck();
                
                if (updatesAvailable.length > 0) {
                    vscode.window.showInformationMessage(`Found ${updatesAvailable.length} skill update(s)!`);
                } else {
                    vscode.window.showInformationMessage('All skills are up-to-date!');
                }
                
                await skillsProvider.refreshAsync();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to check for updates: ${error.message}`);
            }
        });

        // ← DEBUG: Comando para debug de estado de updates
        const debugUpdateStateCommand = vscode.commands.registerCommand('skills.update.debug', async () => {
            try {
                const state = updateManager.getDebugState();
                vscode.window.showInformationMessage(
                    `Debug State: ${state.availableUpdates.length} skills with updates, Last check: ${state.lastCheck ? new Date(state.lastCheck).toLocaleString() : 'Never'}`
                );
                console.log('🔍 [UpdateManager Debug State]', JSON.stringify(state, null, 2));
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to get debug state: ${error.message}`);
            }
        });

        // ← DEBUG: Comando para limpiar estado de updates
        const clearUpdateStateCommand = vscode.commands.registerCommand('skills.update.clear', async () => {
            try {
                await updateManager.clearAllUpdates();
                vscode.window.showInformationMessage('Update state cleared!');
                await skillsProvider.refreshAsync();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to clear update state: ${error.message}`);
            }
        });
        
        // Add subscriptions
        context.subscriptions.push(
            skillsTreeView,
            repositoryTreeView,
            configurationTreeView,
            refreshCommand,
            collapseAllCommand,
            addRepoCommand,
            removeRepoCommand,
            showDebugCommand,
            skillSelectCommand,
            configureTokenCommand,
            removeTokenCommand,
            testTokenCommand,
            installSkillCommand,
            skillInstallCommand,
            skillUninstallCommand,
            skillShowDetailsCommand,
            debugEnvironmentCommand,
            testCliCommand,
            showExplorerCommand,
            interactiveInstallCommand,
            skillUpdateCommand,        // ← NUEVO: Update command
            forceUpdateCheckCommand,   // ← NUEVO: Force check command
            debugUpdateStateCommand,   // ← DEBUG: Debug state command
            clearUpdateStateCommand,   // ← DEBUG: Clear state command
            updateManager             // ← NUEVO: Dispose del UpdateManager cuando se desactive la extensión
        );
        
        // Show message after a small delay
        setTimeout(() => {
            vscode.window.showInformationMessage('Skills Manager Extension Loaded - Check sidebar!');
        }, 1000);
        
    } catch (error) {
        console.error('Error in Skills Manager activation:', error);
        vscode.window.showErrorMessage('Skills Manager failed to activate: ' + (error as Error).message);
    }
}

async function addRepositoryInteractive(configService: ConfigService, repoProvider: RepositoryTreeProvider, skillsProvider: SkillsTreeProvider) {
    try {
        // Step 1: Repository type
        const repoType = await vscode.window.showQuickPick([
            { label: 'GitHub Repository', value: 'github', description: 'Public or private GitHub repository' },
            { label: 'GitLab Repository', value: 'gitlab', description: 'Public or private GitLab repository' },
            { label: 'Local Directory', value: 'local', description: 'Local folder with skills' }
        ], {
            placeHolder: 'Select repository type'
        });

        if (!repoType) {return;}

        // Step 2: Repository name
        const name = await vscode.window.showInputBox({
            prompt: 'Enter a name for this repository',
            placeHolder: 'e.g., "My Skills", "Company Skills"'
        });

        if (!name) {return;}

        let url: string | undefined;

        // Step 3: URL/Path based on type
        if (repoType.value === 'local') {
            const folders = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Select Skills Directory'
            });
            
            if (!folders || folders.length === 0) {return;}
            url = folders[0].fsPath;
        } else {
            url = await vscode.window.showInputBox({
                prompt: `Enter the ${repoType.label} URL`,
                placeHolder: repoType.value === 'github' 
                    ? 'https://github.com/username/repository'
                    : 'https://gitlab.com/username/repository'
            });

            if (!url) {return;}
        }

        // Create repository object
        const repository = {
            id: Date.now().toString(),
            name,
            url,
            type: repoType.value,
            enabled: true,
            addedAt: new Date().toISOString()
        };

        // Save repository
        await configService.addRepository(repository);
        
        // Refresh both views
        repoProvider.refresh();
        await skillsProvider.refreshAsync();

        vscode.window.showInformationMessage(`Repository "${name}" added successfully! Refreshing skills...`);

    } catch (error) {
        vscode.window.showErrorMessage('Failed to add repository: ' + (error as Error).message);
    }
}

async function removeRepositoryInteractive(item: vscode.TreeItem, configService: ConfigService, repoProvider: RepositoryTreeProvider, skillsProvider: SkillsTreeProvider) {
    try {
        // Access repository data from the stored property
        const repository = (item as any).repository;
        if (!repository) {
            vscode.window.showWarningMessage('No repository selected');
            return;
        }
        
        const confirmDelete = await vscode.window.showWarningMessage(
            `Are you sure you want to unsubscribe from "${repository.name}"?`,
            { 
                modal: true, 
                detail: 'This will remove the repository and hide its available skills. Installed skills will remain.' 
            },
            'Unsubscribe'
        );

        if (confirmDelete === 'Unsubscribe') {
            // Remove repository from configuration
            await configService.removeRepository(repository.id);
            
            // Refresh both views to update UI
            repoProvider.refresh();
            await skillsProvider.refreshAsync();
            
            vscode.window.showInformationMessage(`Successfully unsubscribed from "${repository.name}"`);
        }
    } catch (error) {
        vscode.window.showErrorMessage('Failed to unsubscribe from repository: ' + (error as Error).message);
    }
}

export function deactivate() {
    console.log('Skills Manager extension is now deactivated!');
}