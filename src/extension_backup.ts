import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as https from 'https';
import { SkillsService } from './services/skillsService';
import { SkillsTreeProvider } from './providers/skillsTreeProvider';
import { SkillsCliService } from './services/cliWrapper';

const execAsync = promisify(exec);

// GitHub API service to discover available skills 
class GitHubService {
        this.outputChannel.appendLine('=== Finding skills ' + (repositoryUrl ? `from ${repositoryUrl}` : 'globally') + ' ===');
        
        if (!repositoryUrl) {
            this.outputChannel.appendLine('No repository URL provided - returning empty array');
            return [];
        }
        
        try {
            // Use --list flag to see available skills without installing
            const command = `npx skills add "${repositoryUrl}" --list`;
            this.outputChannel.appendLine(`Executing: ${command}`);
            
            const result = await execAsync(command, {
                env: { 
                    ...process.env, 
                    PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:' + require('os').homedir() + '/.nvm/versions/node/v20.15.0/bin'
                }
            });
            
            this.outputChannel.appendLine(`stdout: ${result.stdout}`);
            this.outputChannel.appendLine(`stderr: ${result.stderr || 'none'}`);
            
            // Parse the output to extract skill names
            // Looking for patterns like "- skill-name" or bullet points from the CLI output
            const lines = result.stdout.split('\n');
            const skills: any[] = [];
            
            let inSkillsSection = false;
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                
                // Look for "Found X skills" or "Available skills:" section
                if ((line.includes('Found') && line.includes('skill')) || 
                    (line.includes('Available skills:')) ||
                    (line.includes('●  Available skills:'))) {
                    inSkillsSection = true;
                    continue;
                }
                
                // Parse skill names when we're in the skills section
                if (inSkillsSection && line) {
                    // Remove common prefixes and clean the skill name
                    let skillName = line
                        .replace(/^[- *•│├└┌┐┘┴┬┤●]+\s*/, '') // Remove tree/list markers
                        .replace(/^\d+\.\s*/, '') // Remove numbers
                        .trim();
                    
                    // Skip empty lines, section headers, or other info
                    if (!skillName || 
                        skillName.includes(':') || 
                        skillName.includes('Command') || 
                        skillName.includes('Done') || 
                        skillName.includes('Security') ||
                        skillName.includes('Installation') ||
                        skillName.length < 2) {
                        continue;
                    }
                    
                    // Stop if we hit the end or another section
                    if (skillName.includes('├───') || skillName.includes('└')) {
                        break;
                    }
                    
                    skills.push({
                        name: skillName,
                        description: `Available skill from repository`,
                        repository: repositoryUrl,
                        installed: false
                    });
                }
            }
            
            // If no skills found with the above method, try a simpler approach
            if (skills.length === 0) {
                this.outputChannel.appendLine('Trying alternative parsing method...');
                for (const line of lines) {
                    const trimmed = line.trim();
                    // Look for lines that look like skill names (no special chars, reasonable length)
                    if (trimmed && 
                        !trimmed.includes('skills') && 
                        !trimmed.includes('Found') && 
                        !trimmed.includes('●') &&
                        !trimmed.includes('│') &&
                        !trimmed.includes('├') &&
                        !trimmed.includes('└') &&
                        !trimmed.includes(':') &&
                        trimmed.length > 2 && 
                        trimmed.length < 50 &&
                        /^[a-zA-Z0-9\-_]+$/.test(trimmed)) {
                        
                        skills.push({
                            name: trimmed,
                            description: `Available skill from repository`,
                            repository: repositoryUrl,
                            installed: false
                        });
                    }
                }
            }
            
            this.outputChannel.appendLine(`Parsed ${skills.length} skills`);
            skills.forEach(skill => this.outputChannel.appendLine(`- ${skill.name}: ${skill.description}`));
            
            return skills;
        } catch (error) {
            this.outputChannel.appendLine(`ERROR: ${error}`);
            // Don't show output automatically - user can open it manually
            return [];
        }
    }

    async listInstalledSkills(): Promise<any[]> {
        this.outputChannel.appendLine('=== Listing installed skills ===');
        
        try {
            // Test the commands separately first
            this.outputChannel.appendLine('Testing project skills command...');
            const projectResult = await execAsync('npx skills list --json', {
                env: { 
                    ...process.env, 
                    PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:' + require('os').homedir() + '/.nvm/versions/node/v20.15.0/bin'
                }
            });
            
            this.outputChannel.appendLine(`Project skills stdout: "${projectResult.stdout}"`);
            this.outputChannel.appendLine(`Project skills stderr: "${projectResult.stderr || 'none'}"`);
            
            this.outputChannel.appendLine('Testing global skills command...');
            const globalResult = await execAsync('npx skills list -g --json', {
                env: { 
                    ...process.env, 
                    PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:' + require('os').homedir() + '/.nvm/versions/node/v20.15.0/bin'
                }
            });
            
            this.outputChannel.appendLine(`Global skills stdout: "${globalResult.stdout}"`);
            this.outputChannel.appendLine(`Global skills stderr: "${globalResult.stderr || 'none'}"`);
            
            // Function to clean ANSI codes
            const cleanAnsiCodes = (text: string): string => {
                return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
            };
            
            const parseSkillsOutput = (output: string, scope: 'project' | 'global') => {
                this.outputChannel.appendLine(`Parsing ${scope} skills from output: "${output}"`);
                
                // First, try JSON parsing
                try {
                    const jsonData = JSON.parse(output);
                    this.outputChannel.appendLine(`Successfully parsed JSON data`);
                    // Handle JSON format if available
                    if (Array.isArray(jsonData)) {
                        return jsonData.map(skill => ({
                            name: skill.name || skill.id || 'unknown',
                            description: `Installed ${scope} skill`,
                            installed: true,
                            scope,
                            path: skill.path || '',
                            agents: skill.agents || 'Unknown'
                        }));
                    }
                } catch (jsonError) {
                    this.outputChannel.appendLine(`JSON parsing failed, trying text parsing: ${jsonError}`);
                }
                
                // Fallback to text parsing with ANSI cleaning
                const cleanOutput = cleanAnsiCodes(output);
                this.outputChannel.appendLine(`Cleaned output: "${cleanOutput}"`);
                
                const lines = cleanOutput.split('\n');
                const skills: any[] = [];
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    this.outputChannel.appendLine(`Line ${i}: "${line}"`);
                    
                    // Skip empty lines and headers
                    if (!line || 
                        line.includes('Skills') || 
                        line.includes('No project skills') || 
                        line.includes('No global skills') ||
                        line.includes('Try listing') ||
                        line.startsWith('Agents:')) {
                        continue;
                    }
                    
                    // Look for pattern: "skill-name path" (everything before first space is skill name)
                    const parts = line.split(' ');
                    if (parts.length >= 2 && !line.includes('Agents:')) {
                        const skillName = parts[0];
                        const skillPath = parts.slice(1).join(' ');
                        
                        // Look ahead for agent info
                        let agents = 'Unknown';
                        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('Agents:')) {
                            agents = cleanAnsiCodes(lines[i + 1].replace('Agents:', '').trim());
                            i++; // Skip the agents line in next iteration
                        }
                        
                        skills.push({
                            name: skillName,
                            description: `Installed ${scope} skill`,
                            installed: true,
                            scope,
                            path: skillPath,
                            agents
                        });
                        
                        this.outputChannel.appendLine(`Parsed skill: ${skillName} (${scope})`);
                    }
                }
                
                return skills;
            };
            
            const projectSkills = parseSkillsOutput(projectResult.stdout, 'project');
            const globalSkills = parseSkillsOutput(globalResult.stdout, 'global');
            const allSkills = [...projectSkills, ...globalSkills];
            
            this.outputChannel.appendLine(`Final result: ${allSkills.length} installed skills (${projectSkills.length} project, ${globalSkills.length} global)`);
            return allSkills;
        } catch (error) {
            this.outputChannel.appendLine(`ERROR in listInstalledSkills: ${error}`);
            return [];
        }
    }

    async installSkill(skillName: string, repository?: string): Promise<boolean> {
        if (!repository) {
            this.outputChannel.appendLine('ERROR: Repository URL required for installation');
            return false;
        }
        
        try {
            const command = `npx skills add "${repository}" --skill "${skillName}" --agent github-copilot --yes`;
            this.outputChannel.appendLine(`Installing skill: ${command}`);
            
            const result = await execAsync(command, {
                env: { 
                    ...process.env, 
                    PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:' + require('os').homedir() + '/.nvm/versions/node/v20.15.0/bin'
                }
            });
            
            this.outputChannel.appendLine(`Install stdout: ${result.stdout}`);
            this.outputChannel.appendLine(`Install stderr: ${result.stderr || 'none'}`);
            this.outputChannel.appendLine(`Skill installed successfully`);
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Install error: ${error}`);
            return false;
        }
    }

    showDebugOutput(): vscode.OutputChannel {
        this.outputChannel.show();
        return this.outputChannel;
    }
}

// GitHub API service to discover available skills
class GitHubService {
    constructor(private configService: ConfigService) {}

    async getRepositoryContents(repoUrl: string, path: string = ''): Promise<any[]> {
        return new Promise((resolve, reject) => {
            try {
                // Parse GitHub URL to extract owner/repo
                const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                if (!match) {
                    reject(new Error('Invalid GitHub URL'));
                    return;
                }
                
                const [, owner, repo] = match;
                const cleanRepo = repo.replace(/\.git$/, '');
                
                const apiUrl = `https://api.github.com/repos/${owner}/${cleanRepo}/contents/${path}`;
                console.log(`Making GitHub API request to: ${apiUrl}`);
                
                // Get authentication token
                const token = this.configService.getGitHubToken();
                const tokenSource = this.configService.getGitHubTokenSource();
                
                const headers: any = {
                    'User-Agent': 'VS Code Skills Extension',
                    'Accept': 'application/vnd.github.v3+json'
                };
                
                // Add authorization if token exists
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                    console.log(`Using GitHub token from ${tokenSource}`);
                } else {
                    console.log('No GitHub token found - checking environment variable and VS Code settings. May hit rate limits.');
                }
                
                https.get(apiUrl, { headers }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        console.log(`GitHub API response status: ${res.statusCode}`);
                        if (res.statusCode === 200) {
                            try {
                                resolve(JSON.parse(data));
                            } catch (parseError) {
                                console.log('JSON parse error:', parseError);
                                reject(new Error('Failed to parse GitHub response'));
                            }
                        } else if (res.statusCode === 403) {
                            console.log('GitHub API rate limited or unauthorized (403). Response:', data.substring(0, 200));
                            if (token) {
                                reject(new Error(`GitHub token (from ${tokenSource}) may be invalid or expired. Please check your token.`));
                            } else {
                                reject(new Error('GitHub API rate limited. Set GITHUB_TOKEN environment variable or configure token in VS Code Settings > Skills > GitHub Token.'));
                            }
                        } else if (res.statusCode === 401) {
                            console.log('GitHub API unauthorized (401). Response:', data.substring(0, 200));
                            reject(new Error(`GitHub token (from ${tokenSource}) is invalid. Please check your token.`));
                        } else {
                            console.log(`GitHub API error: ${res.statusCode}, Response:`, data.substring(0, 200));
                            reject(new Error(`GitHub API error: ${res.statusCode}`));
                        }
                    });
                }).on('error', (error) => {
                    console.log('HTTP request error:', error);
                    reject(error);
                });
            } catch (error) {
                console.log('GitHub request setup error:', error);
                reject(error);
            }
        });
    }
    
    async findSkillsInRepository(repoUrl: string): Promise<any[]> {
        try {
            const contents = await this.getRepositoryContents(repoUrl);
            const skills: any[] = [];
            
            // Look for a "skills" folder first
            const skillsFolder = contents.find(item => item.type === 'dir' && item.name === 'skills');
            if (skillsFolder) {
                console.log('Found skills folder, exploring its contents...');
                try {
                    const skillsFolderContents = await this.getRepositoryContents(repoUrl, 'skills');
                    
                    // Everything inside the skills folder is considered a skill (except .zip files)
                    for (const skillItem of skillsFolderContents) {
                        // Skip .zip files and other non-skill files
                        if (skillItem.name.endsWith('.zip') || 
                            skillItem.name.endsWith('.tar.gz') || 
                            skillItem.name.startsWith('.') ||
                            skillItem.name === 'README.md' ||
                            skillItem.name === 'package.json') {
                            console.log(`Skipping ${skillItem.name} (not a skill)`);
                            continue;
                        }
                        
                        if (skillItem.type === 'dir' || skillItem.type === 'file') {
                            // For directories, check if they contain SKILL.md for better description
                            let description = `${skillItem.name} skill from skills folder`;
                            
                            if (skillItem.type === 'dir') {
                                try {
                                    const skillDirContents = await this.getRepositoryContents(repoUrl, `skills/${skillItem.name}`);
                                    const hasSkillMd = skillDirContents.some(file => file.name === 'SKILL.md');
                                    if (hasSkillMd) {
                                        description = `${skillItem.name} skill (verified with SKILL.md)`;
                                    }
                                } catch (error) {
                                    // Keep default description if we can't read the directory
                                }
                            }
                            
                            skills.push({
                                name: skillItem.name,
                                description: description,
                                repository: repoUrl,
                                path: skillItem.type === 'dir' ? `skills/${skillItem.name}` : `skills/${skillItem.name}`,
                                installed: false
                            });
                        }
                    }
                } catch (error) {
                    console.log(`Could not read skills folder: ${error}`);
                }
            }
            
            // Also look for directories that contain SKILL.md files (original logic)
            for (const item of contents) {
                if (item.type === 'dir' && item.name !== 'skills') { // Skip the skills folder as we already processed it
                    try {
                        // Check if this directory has a SKILL.md file
                        const dirContents = await this.getRepositoryContents(repoUrl, item.name);
                        const hasSkillMd = dirContents.some(file => file.name === 'SKILL.md');
                        
                        if (hasSkillMd) {
                            // Try to get description from SKILL.md content
                            let description = `${item.name} skill`;
                            
                            skills.push({
                                name: item.name,
                                description: description,
                                repository: repoUrl,
                                path: item.name,
                                installed: false
                            });
                        }
                    } catch (error) {
                        // Skip this directory if we can't read it
                        console.log(`Could not read directory ${item.name}: ${error}`);
                    }
                }
            }
            
            return skills;
        } catch (error) {
            console.error(`Error finding skills in repository ${repoUrl}:`, error);
            return [];
        }
    }
}

// Simple configuration service
class ConfigService {
    constructor(private context: vscode.ExtensionContext) {}

    async getRepositories(): Promise<any[]> {
        const repos = this.context.globalState.get('skills.repositories', []);
        
        // If no repositories are configured, add default ones
        if (repos.length === 0) {
            console.log('No repositories configured, adding default repositories...');
            const defaultRepos = [
                {
                    name: 'Vercel Agent Skills',
                    url: 'vercel-labs/agent-skills',
                    type: 'github',
                    description: 'Official Vercel agent skills repository'
                }
            ];
            
            // Add default repositories to storage
            await this.context.globalState.update('skills.repositories', defaultRepos);
            return defaultRepos;
        }
        
        return repos;
    }

    async addRepository(repository: any): Promise<void> {
        const repos = await this.getRepositories();
        repos.push(repository);
        await this.context.globalState.update('skills.repositories', repos);
    }

    getGitHubToken(): string {
        // First check environment variable (most common)
        const envToken = process.env.GITHUB_TOKEN;
        console.log('Environment GITHUB_TOKEN check:', envToken ? 'Found (***masked***)' : 'Not found');
        
        if (envToken) {
            console.log('Using GitHub token from GITHUB_TOKEN environment variable');
            return envToken;
        }
        
        // Fallback to VS Code configuration
        const config = vscode.workspace.getConfiguration('skills');
        const configToken = config.get<string>('github.token', '');
        console.log('VS Code config token check:', configToken ? 'Found (***masked***)' : 'Not found');
        
        if (configToken) {
            console.log('Using GitHub token from VS Code configuration');
            return configToken;
        }
        
        console.log('No GitHub token found in environment or VS Code settings');
        return '';
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

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
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
    console.log('Skills Manager extension is now active!');
    
    try {
        // Initialize services
        const configService = new ConfigService(context);
        const cliService = new SkillsCliService();
        const githubService = new GitHubService(configService);
        
        // Create tree providers
        const skillsService = new SkillsService(cliService, configService);
        const skillsProvider = new SkillsTreeProvider(skillsService);
        const repoProvider = new RepositoryTreeProvider(configService);
        
        // Register tree views
        const skillsTreeView = vscode.window.createTreeView('skills.tree', {
            treeDataProvider: skillsProvider,
            showCollapseAll: true
        });
        
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
        const refreshCommand = vscode.commands.registerCommand('skills.refresh', () => {
            skillsProvider.refresh();
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
                    const success = await cliService.installSkill(skill.name, repoUrl);
                    if (success) {
                        vscode.window.showInformationMessage(`Skill "${skill.name}" installed successfully!`);
                        skillsProvider.refresh();
                    } else {
                        vscode.window.showErrorMessage(`Failed to install skill "${skill.name}"`);
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
                    skillsProvider.refresh();
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
                    if (!value) return 'Token is required';
                    if (!value.startsWith('ghp_')) return 'Token should start with ghp_';
                    if (value.length < 10) return 'Token seems too short';
                    return undefined;
                }
            });
            
            if (token) {
                await configService.updateGitHubToken(token);
                vscode.window.showInformationMessage('GitHub token configured in VS Code settings! Refreshing skills...');
                skillsProvider.refresh();
            }
        });

        const removeTokenCommand = vscode.commands.registerCommand('skills.github.removeToken', async () => {
            await configService.updateGitHubToken('');
            vscode.window.showInformationMessage('GitHub token removed. Refreshing skills...');
            skillsProvider.refresh();
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

        const debugEnvironmentCommand = vscode.commands.registerCommand('skills.debug.environment', () => {
            const output = cliService.showDebugOutput();
            const token = configService.getGitHubToken();
            const tokenSource = configService.getGitHubTokenSource();
            const apiEnabled = configService.isGitHubApiEnabled();
            
            output.appendLine('=== COMPLETE SKILLS MANAGER DEBUG ===');
            output.appendLine(`GITHUB_TOKEN env var: ${process.env.GITHUB_TOKEN ? 'Set (' + process.env.GITHUB_TOKEN.length + ' chars)' : 'Not set'}`);
            output.appendLine(`ConfigService token: ${token ? 'YES (' + token.length + ' chars)' : 'NO'}`);
            output.appendLine(`Token source: ${tokenSource}`);
            output.appendLine(`API enabled: ${apiEnabled}`);
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
        
        // Add subscriptions
        context.subscriptions.push(
            skillsTreeView,
            repositoryTreeView,
            refreshCommand,
            addRepoCommand,
            showDebugCommand,
            skillSelectCommand,
            configureTokenCommand,
            removeTokenCommand,
            testTokenCommand,
            installSkillCommand,
            debugEnvironmentCommand
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

        if (!repoType) return;

        // Step 2: Repository name
        const name = await vscode.window.showInputBox({
            prompt: 'Enter a name for this repository',
            placeholder: 'e.g., "My Skills", "Company Skills"'
        });

        if (!name) return;

        let url: string | undefined;

        // Step 3: URL/Path based on type
        if (repoType.value === 'local') {
            const folders = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                openLabel: 'Select Skills Directory'
            });
            
            if (!folders || folders.length === 0) return;
            url = folders[0].fsPath;
        } else {
            url = await vscode.window.showInputBox({
                prompt: `Enter the ${repoType.label} URL`,
                placeholder: repoType.value === 'github' 
                    ? 'https://github.com/username/repository'
                    : 'https://gitlab.com/username/repository'
            });

            if (!url) return;
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
        skillsProvider.refresh();

        vscode.window.showInformationMessage(`Repository "${name}" added successfully! Refreshing skills...`);

    } catch (error) {
        vscode.window.showErrorMessage('Failed to add repository: ' + (error as Error).message);
    }
}

export function deactivate() {
    console.log('Skills Manager extension is now deactivated!');
}