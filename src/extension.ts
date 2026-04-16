import * as vscode from 'vscode';
import * as https from 'https';
import { SkillsService } from './services/skillsService';
import { SkillsTreeProvider } from './providers/skillsTreeProvider';
import { SkillsCliService } from './services/cliWrapper';

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
            item.iconPath = new vscode.ThemeIcon(
                repo.type === 'github' ? 'github' : 
                repo.type === 'gitlab' ? 'gitlab' : 
                repo.type === 'local' ? 'folder' : 'repo'
            );
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
        
        const addRepoCommand = vscode.commands.registerCommand('skills.repository.add', async () => {
            await addRepositoryInteractive(configService, repoProvider, skillsProvider);
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
                        label: '🏠 Local (Project only)',
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
                        label: '🔄 Both (Local + Global)',
                        description: 'Install in both local and global scopes',
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

                // Ejecutar el comando CLI
                const terminal = vscode.window.createTerminal('Skills Uninstall');
                terminal.show();
                terminal.sendText(`npx skills remove "${skillName}"`);
                
                vscode.window.showInformationMessage(`Uninstalling skill: ${skillName}`);
                
                // Refresh después de unos segundos
                setTimeout(async () => {
                    await skillsProvider.refreshAsync();
                }, 3000);
                
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
                            body { 
                                font-family: var(--vscode-font-family);
                                padding: 8px;
                                line-height: 1.3;
                                color: var(--vscode-foreground);
                                background: var(--vscode-editor-background);
                                margin: 0;
                                height: 100vh;
                                box-sizing: border-box;
                                overflow-y: auto;
                            }
                            .container {
                                max-width: 100%;
                                height: 100%;
                                display: flex;
                                flex-direction: column;
                            }
                            h1 { 
                                color: var(--vscode-textLink-foreground); 
                                margin-top: 0;
                                word-wrap: break-word;
                            }
                            .status { 
                                padding: 8px 12px;
                                border-radius: 4px;
                                background: var(--vscode-textBlockQuote-background);
                                margin: 10px 0;
                                font-weight: bold;
                            }
                            .source { 
                                background: var(--vscode-textCodeBlock-background);
                                padding: 4px 8px;
                                border-radius: 3px;
                                font-family: var(--vscode-editor-font-family);
                                font-size: 0.9em;
                                word-break: break-all;
                            }
                            .description {
                                margin: 15px 0;
                                padding: 8px;
                                border-left: 4px solid var(--vscode-textBlockQuote-border);
                                background: var(--vscode-textBlockQuote-background);
                                border-radius: 4px;
                                flex-grow: 1;
                                overflow-y: auto;
                                max-height: 60vh;
                                word-wrap: break-word;
                                white-space: pre-wrap;
                            }
                            .description-content {
                                line-height: 1.5;
                            }
                            .actions {
                                margin-top: 8px;
                                padding-top: 8px;
                                border-top: 1px solid var(--vscode-textBlockQuote-border);
                                flex-shrink: 0;
                            }
                            button {
                                background: var(--vscode-button-background);
                                color: var(--vscode-button-foreground);
                                border: none;
                                padding: 6px 12px;
                                border-radius: 4px;
                                cursor: pointer;
                                margin-right: 6px;
                                font-size: 14px;
                                font-weight: 500;
                            }
                            button:hover {
                                background: var(--vscode-button-hoverBackground);
                            }
                            .metadata {
                                display: flex;
                                gap: 20px;
                                margin: 15px 0;
                                flex-wrap: wrap;
                            }
                            .metadata-item {
                                display: flex;
                                flex-direction: column;
                                min-width: 200px;
                            }
                            .metadata-label {
                                font-weight: bold;
                                margin-bottom: 5px;
                                color: var(--vscode-textLink-foreground);
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>${skillName}</h1>
                            <div class="status">${isInstalled ? '✅ Installed' : '📦 Available for installation'}</div>
                            
                            <div class="metadata">
                                <div class="metadata-item">
                                    <div class="metadata-label">Source:</div>
                                    <span class="source">${source}</span>
                                </div>
                            </div>
                            
                            <div class="description">
                                <div class="metadata-label">Description:</div>
                                <div class="description-content">${fullDescription}</div>
                            </div>
                            
                            <div class="actions">
                                ${!isInstalled ? 
                                    `<button onclick="installSkill()">📥 Install Skill</button>` : 
                                    `<button onclick="uninstallSkill()" style="background: var(--vscode-errorForeground); color: white;">🗑️ Uninstall Skill</button>`
                                }
                                <button onclick="refreshData()" style="background: var(--vscode-textLink-foreground);">🔄 Refresh</button>
                            </div>
                        </div>
                        <script>
                            const vscode = acquireVsCodeApi();
                            
                            // Prepare skill object for messages 
                            const skillData = ${JSON.stringify({
                                name: skillName,
                                skillName: skillName,
                                repository: source,
                                source: source,
                                description: fullDescription,
                                fullDescription: fullDescription,
                                installed: isInstalled
                            })};
                            
                            function installSkill() {
                                vscode.postMessage({ command: 'install', skill: skillData });
                            }
                            function uninstallSkill() {
                                if (confirm('Are you sure you want to uninstall this skill?')) {
                                    vscode.postMessage({ command: 'uninstall', skill: skillData });
                                }
                            }
                            function refreshData() {
                                vscode.postMessage({ command: 'refresh' });
                            }
                            
                            // Auto-focus on load for better UX
                            window.addEventListener('load', () => {
                                document.body.focus();
                            });
                        </script>
                    </body>
                    </html>
                `;
                
                // Handle messages from webview
                panel.webview.onDidReceiveMessage(
                    async (message) => {
                        switch (message.command) {
                            case 'install':
                                await vscode.commands.executeCommand('skills.skill.install', message.skill);
                                panel.dispose(); // Close panel after install
                                break;
                            case 'uninstall':
                                await vscode.commands.executeCommand('skills.skill.uninstall', message.skill);
                                panel.dispose(); // Close panel after uninstall
                                break;
                            case 'refresh':
                                await vscode.commands.executeCommand('skills.refresh');
                                vscode.window.showInformationMessage('Skills refreshed!');
                                break;
                        }
                    },
                    undefined,
                    context.subscriptions
                );
                
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
        
        // Add subscriptions
        context.subscriptions.push(
            skillsTreeView,
            repositoryTreeView,
            configurationTreeView,
            refreshCommand,
            addRepoCommand,
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
            interactiveInstallCommand
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
            placeholder: 'e.g., "My Skills", "Company Skills"'
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
                placeholder: repoType.value === 'github' 
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

export function deactivate() {
    console.log('Skills Manager extension is now deactivated!');
}