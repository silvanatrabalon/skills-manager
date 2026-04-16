import * as vscode from 'vscode';
import { SkillsCliService, Skill, SkillSearchResult, InstallResult, UpdateResult, RemoveResult } from './cliWrapper';
import { ConfigService, Repository } from './configService';

export interface SkillWithRepository extends Skill {
    repository?: Repository;
}

export interface RepositorySkills {
    repository: Repository;
    skills: SkillSearchResult[];
    error?: string;
}

export class SkillsService {
    private cliService: SkillsCliService;
    private configService: ConfigService;
    private githubService: any; // GitHubService type
    private cache: Map<string, RepositorySkills> = new Map();
    private cacheTimeout = 5 * 60 * 1000; // 5 minutes
    private outputChannel: vscode.OutputChannel;

    constructor(cliService: SkillsCliService, configService: ConfigService, githubService: any) {
        this.cliService = cliService;
        this.configService = configService;
        this.githubService = githubService;
        this.outputChannel = vscode.window.createOutputChannel('Skills Service Debug');
    }

    // Get all installed skills
    async getInstalledSkills(): Promise<SkillWithRepository[]> {
        this.outputChannel.appendLine('📋 [SkillsService] Getting installed skills...');
        
        try {
            this.outputChannel.appendLine('📋 [SkillsService] Calling CLI for project skills...');
            const projectSkills = await this.cliService.listSkills('project');
            this.outputChannel.appendLine(`📋 [SkillsService] Project skills result: ${JSON.stringify({
                count: projectSkills.length,
                skills: projectSkills.map(s => ({ name: s.name, scope: s.scope }))
            })}`);
            
            this.outputChannel.appendLine('📋 [SkillsService] Calling CLI for global skills...');
            const globalSkills = await this.cliService.listSkills('global');
            this.outputChannel.appendLine(`📋 [SkillsService] Global skills result: ${JSON.stringify({
                count: globalSkills.length,
                skills: globalSkills.map(s => ({ name: s.name, scope: s.scope }))
            })}`);
            
            const allSkills = [...projectSkills, ...globalSkills];
            this.outputChannel.appendLine(`📋 [SkillsService] Combined skills: ${JSON.stringify({
                total: allSkills.length,
                project: projectSkills.length,
                global: globalSkills.length
            })}`);

            const repositories = await this.configService.getRepositories();
            this.outputChannel.appendLine(`📋 [SkillsService] Available repositories: ${repositories.length}`);

            // Try to match skills with their repositories
            const result = allSkills.map(skill => {
                const repository = repositories.find(repo => 
                    skill.source?.includes(repo.url) || skill.source?.includes(repo.name)
                );
                
                this.outputChannel.appendLine(`📋 [SkillsService] Skill ${skill.name}: source=${skill.source}, matched repo=${repository?.name || 'none'}`);
                
                return {
                    ...skill,
                    repository
                };
            });
            
            this.outputChannel.appendLine(`📋 [SkillsService] Final installed skills: ${result.length}`);
            this.outputChannel.show();
            return result;
        } catch (error) {
            this.outputChannel.appendLine(`📋 [SkillsService] Error getting installed skills: ${error}`);
            this.outputChannel.show();
            return [];
        }
    }

    // Get available skills from all configured repositories
    async getAvailableSkills(forceRefresh = false): Promise<RepositorySkills[]> {
        this.outputChannel.appendLine(`📚 [SkillsService] Getting available skills, forceRefresh: ${forceRefresh}`);
        
        const repositories = await this.configService.getRepositories();
        this.outputChannel.appendLine(`📚 [SkillsService] Found ${repositories.length} configured repositories`);
        
        const results: RepositorySkills[] = [];

        for (const repository of repositories.filter(r => r.enabled !== false)) {
            this.outputChannel.appendLine(`📚 [SkillsService] Processing repository: ${repository.name}`);
            
            try {
                let repositorySkills = this.getCachedRepositorySkills(repository.id);
                this.outputChannel.appendLine(`📚 [SkillsService] Cache check for ${repository.name}: ${repositorySkills ? 'HIT' : 'MISS'}`);
                
                if (!repositorySkills || forceRefresh) {
                    this.outputChannel.appendLine(`📚 [SkillsService] Loading fresh data for ${repository.name}`);
                    repositorySkills = await this.loadRepositorySkills(repository);
                    this.setCachedRepositorySkills(repository.id, repositorySkills);
                    this.outputChannel.appendLine(`📚 [SkillsService] Cached results for ${repository.name}`);
                }
                
                results.push(repositorySkills);
                this.outputChannel.appendLine(`📚 [SkillsService] Added ${repositorySkills.skills.length} skills from ${repository.name}`);
                
            } catch (error) {
                this.outputChannel.appendLine(`❌ [SkillsService] Error processing repository ${repository.name}: ${(error as Error).message}`);
                results.push({
                    repository,
                    skills: [],
                    error: (error as Error).message
                });
            }
        }

        this.outputChannel.appendLine(`📚 [SkillsService] Available skills complete: ${results.length} repositories processed`);
        return results;
    }

    // Search skills across all repositories
    async searchSkills(query: string): Promise<SkillSearchResult[]> {
        const repositorySkills = await this.getAvailableSkills();
        const allSkills = repositorySkills.flatMap(rs => rs.skills);
        
        if (!query.trim()) {
            return allSkills;
        }

        const searchTerm = query.toLowerCase();
        return allSkills.filter(skill => 
            skill.name.toLowerCase().includes(searchTerm) ||
            skill.description.toLowerCase().includes(searchTerm)
        );
    }

    // Install a skill
    async installSkill(
        repository: string, 
        skillName?: string, 
        options: {
            scope?: 'global' | 'project';
            agents?: string[];
        } = {}
    ): Promise<InstallResult> {
        const scope = options.scope || this.configService.getDefaultScope();
        const agents = options.agents || this.configService.getTargetAgents();

        const installOptions = {
            global: scope === 'global',
            agents,
            skills: skillName ? [skillName] : undefined,
            yes: true // Auto-confirm for better UX
        };

        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: `Installing skill${skillName ? ` "${skillName}"` : 's'}...`,
            cancellable: false
        };

        return vscode.window.withProgress(progressOptions, async () => {
            return this.cliService.addSkill(repository, installOptions);
        });
    }

    // Update skills
    async updateSkills(skillNames?: string[], scope?: 'global' | 'project'): Promise<UpdateResult[]> {
        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: skillNames ? `Updating ${skillNames.length} skill(s)...` : 'Updating all skills...',
            cancellable: false
        };

        return vscode.window.withProgress(progressOptions, async () => {
            return this.cliService.updateSkills(skillNames, {
                global: scope === 'global'
            });
        });
    }

    // Remove skills
    async removeSkills(skillNames: string[], options: {
        scope?: 'global' | 'project';
        agents?: string[];
    } = {}): Promise<RemoveResult[]> {
        const confirmMessage = skillNames.length === 1 
            ? `Are you sure you want to remove "${skillNames[0]}"?`
            : `Are you sure you want to remove ${skillNames.length} skills?`;

        const confirm = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Remove'
        );

        if (confirm !== 'Remove') {
            return skillNames.map(skill => ({
                success: false,
                message: 'Cancelled by user',
                skill
            }));
        }

        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: `Removing ${skillNames.length} skill(s)...`,
            cancellable: false
        };

        return vscode.window.withProgress(progressOptions, async () => {
            return this.cliService.removeSkills(skillNames, {
                global: options.scope === 'global',
                agents: options.agents,
                yes: true
            });
        });
    }

    // Get skill details by name (from available or installed)
    async getSkillDetails(skillName: string): Promise<SkillSearchResult | Skill | null> {
        // First, check installed skills
        const installedSkills = await this.getInstalledSkills();
        const installed = installedSkills.find(s => s.name === skillName);
        if (installed) {
            return installed;
        }

        // Then check available skills
        const availableSkills = await this.getAvailableSkills();
        for (const repo of availableSkills) {
            const skill = repo.skills.find(s => s.name === skillName);
            if (skill) {
                return skill;
            }
        }

        return null;
    }

    // Initialize a new skill
    async initializeSkill(name: string, path?: string): Promise<void> {
        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: `Creating skill "${name}"...`,
            cancellable: false
        };

        return vscode.window.withProgress(progressOptions, async () => {
            await this.cliService.initSkill(name, path);
        });
    }

    // Cache management
    private getCachedRepositorySkills(repositoryId: string): RepositorySkills | null {
        const cached = this.cache.get(repositoryId);
        if (cached) {
            // Check if cache is still valid
            const cacheTime = this.cache.get(`${repositoryId}_time`) as any;
            if (cacheTime && (Date.now() - cacheTime) < this.cacheTimeout) {
                return cached;
            } else {
                this.cache.delete(repositoryId);
                this.cache.delete(`${repositoryId}_time`);
            }
        }
        return null;
    }

    private setCachedRepositorySkills(repositoryId: string, data: RepositorySkills): void {
        this.cache.set(repositoryId, data);
        this.cache.set(`${repositoryId}_time`, Date.now());
    }

    private async loadRepositorySkills(repository: Repository): Promise<RepositorySkills> {
        this.outputChannel.appendLine(`🏗️  [SkillsService] Loading skills from repository: ${repository.name} (${repository.url})`);
        this.outputChannel.appendLine(`🏗️  [SkillsService] Repository type: ${repository.type}`);
        
        try {
            if (repository.type === 'github') {
                this.outputChannel.appendLine(`🏗️  [SkillsService] Using GitHub API to find skills...`);
                
                // Use GitHub API service instead of CLI
                const githubSkills = await this.githubService.findSkillsInRepository(repository.url);
                this.outputChannel.appendLine(`🏗️  [SkillsService] GitHub API found ${githubSkills.length} skills`);
                
                // Convert GitHub API response to SkillSearchResult format
                const skills: SkillSearchResult[] = githubSkills.map(skill => ({
                    name: skill.name,
                    description: skill.description,
                    source: repository.url,
                    path: skill.path,
                    repository: repository.url,
                    repositoryUrl: repository.url,
                    installed: false
                }));
                
                this.outputChannel.appendLine(`🏗️  [SkillsService] Converted to ${skills.length} skill search results`);
                skills.forEach(skill => {
                    this.outputChannel.appendLine(`  - ${skill.name}: ${skill.description}`);
                });
                
                return {
                    repository,
                    skills
                };
                
            } else {
                // For non-GitHub repositories, fall back to CLI (if needed)
                this.outputChannel.appendLine(`🏗️  [SkillsService] Non-GitHub repo, skipping for now`);
                return {
                    repository,
                    skills: [],
                    error: 'Only GitHub repositories are supported currently'
                };
            }
            
        } catch (error) {
            this.outputChannel.appendLine(`❌ [SkillsService] Error loading repository ${repository.name}: ${(error as Error).message}`);
            return {
                repository,
                skills: [],
                error: (error as Error).message
            };
        }
    }

    private normalizeRepositoryUrl(repository: Repository): string {
        if (repository.type === 'github') {
            // Convert GitHub URLs to the format expected by skills CLI
            if (repository.url.startsWith('http')) {
                const match = repository.url.match(/github\.com\/([^\/]+\/[^\/]+)/);
                return match ? match[1] : repository.url;
            }
            return repository.url;
        } else if (repository.type === 'gitlab') {
            return repository.url;
        } else if (repository.type === 'local') {
            return repository.url;
        }
        
        return repository.url;
    }

    // Clear cache
    clearCache(): void {
        this.cache.clear();
    }

    // Get repository by ID
    async getRepository(id: string): Promise<Repository | null> {
        const repositories = await this.configService.getRepositories();
        return repositories.find(r => r.id === id) || null;
    }
}