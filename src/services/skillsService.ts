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
    private cache: Map<string, RepositorySkills> = new Map();
    private cacheTimeout = 5 * 60 * 1000; // 5 minutes
    private outputChannel: vscode.OutputChannel;

    constructor(cliService: SkillsCliService, configService: ConfigService) {
        this.cliService = cliService;
        this.configService = configService;
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
        this.outputChannel.appendLine(`📚 [SkillsService] *** ENTRY getAvailableSkills method ***`);
        this.outputChannel.appendLine(`📚 [SkillsService] Getting available skills, forceRefresh: ${forceRefresh}`);
        
        const repositories = await this.configService.getRepositories();
        this.outputChannel.appendLine(`📚 [SkillsService] Found ${repositories.length} configured repositories`);
        this.outputChannel.appendLine(`📚 [SkillsService] Repositories: ${JSON.stringify(repositories.map(r => ({name: r.name, enabled: r.enabled})))}`);
        
        const results: RepositorySkills[] = [];

        for (const repository of repositories.filter(r => r.enabled !== false)) {
            this.outputChannel.appendLine(`📚 [SkillsService] *** PROCESSING REPOSITORY: ${repository.name} ***`);
            
            try {
                let repositorySkills = this.getCachedRepositorySkills(repository.id);
                this.outputChannel.appendLine(`📚 [SkillsService] Cache check for ${repository.name}: ${repositorySkills ? 'HIT' : 'MISS'}`);
                
                if (!repositorySkills || forceRefresh) {
                    this.outputChannel.appendLine(`📚 [SkillsService] *** CALLING loadRepositorySkills FOR ${repository.name} ***`);
                    repositorySkills = await this.loadRepositorySkills(repository);
                    this.outputChannel.appendLine(`📚 [SkillsService] *** BACK FROM loadRepositorySkills FOR ${repository.name} ***`);
                    this.setCachedRepositorySkills(repository.id, repositorySkills);
                    this.outputChannel.appendLine(`📚 [SkillsService] Cached results for ${repository.name}`);
                } else {
                    this.outputChannel.appendLine(`📚 [SkillsService] *** USING CACHE FOR ${repository.name} - NOT CALLING loadRepositorySkills ***`);
                }
                
                results.push(repositorySkills);
                this.outputChannel.appendLine(`📚 [SkillsService] Added ${repositorySkills.skills.length} skills from ${repository.name}`);
                
            } catch (error) {
                this.outputChannel.appendLine(`❌ [SkillsService] *** EXCEPTION in getAvailableSkills for ${repository.name}: ${(error as Error).message} ***`);
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
        this.outputChannel.appendLine(`🚀 [INSTALL] *** ENTRY installSkill method ***`);
        this.outputChannel.appendLine(`🚀 [INSTALL] repository: ${repository}`);
        this.outputChannel.appendLine(`🚀 [INSTALL] skillName: ${skillName}`);
        this.outputChannel.appendLine(`🚀 [INSTALL] options: ${JSON.stringify(options)}`);
        
        const scope = options.scope || this.configService.getDefaultScope();
        this.outputChannel.appendLine(`🚀 [INSTALL] scope: ${scope}`);
        
        // Install only to specific agents that are available  
        // This avoids the interactive agent selection prompt and agents not found errors
        const agents = ['cursor'];
        this.outputChannel.appendLine(`🚀 [INSTALL] agents: ${JSON.stringify(agents)}`);
        
        // Convert repository URL to proper CLI format
        const repoSource = this.formatRepositoryForCLI(repository);
        this.outputChannel.appendLine(`🚀 [INSTALL] repoSource (formatted): ${repoSource}`);

        const installOptions = {
            global: scope === 'global',
            agents,
            skills: skillName ? [skillName] : undefined,
            yes: true // Auto-confirm for better UX
        };
        
        this.outputChannel.appendLine(`🚀 [INSTALL] installOptions: ${JSON.stringify(installOptions)}`);

        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: `Installing skill${skillName ? ` "${skillName}"` : 's'}...`,
            cancellable: false
        };

        this.outputChannel.appendLine(`🚀 [INSTALL] About to call cliService.addSkill...`);
        
        try {
            const result = await vscode.window.withProgress(progressOptions, async (progress) => {
                this.outputChannel.appendLine(`🚀 [INSTALL] Inside withProgress callback`);
                this.outputChannel.appendLine(`🚀 [INSTALL] cliService exists: ${!!this.cliService}`);
                this.outputChannel.appendLine(`🚀 [INSTALL] cliService.addSkill exists: ${!!this.cliService?.addSkill}`);
                progress.report({ message: "Installing skill..." });
                
                const cliResult = await this.cliService.addSkill(repoSource, installOptions);
                this.outputChannel.appendLine(`🚀 [INSTALL] CLI result received: ${JSON.stringify(cliResult)}`);
                
                return cliResult;
            });
            
            this.outputChannel.appendLine(`🚀 [INSTALL] withProgress completed: ${JSON.stringify(result)}`);
            return result;
            
        } catch (error) {
            this.outputChannel.appendLine(`❌ [INSTALL] Exception in installSkill: ${(error as Error).message}`);
            this.outputChannel.appendLine(`❌ [INSTALL] Exception stack: ${(error as Error).stack}`);
            throw error;
        }
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

    // Convert repository URL to proper CLI format
    private formatRepositoryForCLI(repositoryUrl: string): string {
        // GitHub shorthand format: extract "owner/repo" from "https://github.com/owner/repo"
        const githubMatch = repositoryUrl.match(/^https?:\/\/github\.com\/([^\/]+\/[^\/]+)(?:\.git)?(?:\/.*)?$/);
        if (githubMatch) {
            return githubMatch[1]; // Returns "owner/repo"
        }
        
        // For other formats (GitLab, direct git URLs, etc.), use the URL as-is
        return repositoryUrl;
    }

    private async loadRepositorySkills(repository: Repository): Promise<RepositorySkills> {
        this.outputChannel.appendLine(`🏗️  [SkillsService] *** ENTRY loadRepositorySkills method ***`);
        this.outputChannel.appendLine(`🏗️  [SkillsService] Loading skills from repository: ${repository.name} (${repository.url})`);
        this.outputChannel.appendLine(`🏗️  [SkillsService] Repository type: ${repository.type}`);
        this.outputChannel.appendLine(`🏗️  [SkillsService] *** CLEARING CACHE AND FORCING FRESH LOAD ***`);
        
        // Clear any existing cache for this repository
        this.cache.delete(repository.id);
        this.cache.delete(`${repository.id}_time`);
        this.outputChannel.appendLine(`🏗️  [SkillsService] Cache cleared for repository: ${repository.name}`);
        
        try {
            this.outputChannel.appendLine(`🏗️  [SkillsService] *** ENTERING TRY BLOCK ***`);
            // Use CLI-based discovery for all repository types
            this.outputChannel.appendLine(`🏗️  [SkillsService] Using CLI to discover skills...`);
            this.outputChannel.appendLine(`🏗️  [SkillsService] *** CALLING listRepositorySkills METHOD ***`);
            
            const skillNames = await this.cliService.listRepositorySkills(repository.url);
            this.outputChannel.appendLine(`🏗️  [SkillsService] *** BACK FROM listRepositorySkills METHOD ***`);
            this.outputChannel.appendLine(`🏗️  [SkillsService] CLI found ${skillNames.length} skills`);
            this.outputChannel.appendLine(`🏗️  [SkillsService] Raw skillNames type: ${typeof skillNames}`);
            this.outputChannel.appendLine(`🏗️  [SkillsService] Raw skillNames isArray: ${Array.isArray(skillNames)}`);
            this.outputChannel.appendLine(`🏗️  [SkillsService] Raw skillNames: ${JSON.stringify(skillNames)}`);
            
            // Convert skill names to SkillSearchResult format
            const skills: SkillSearchResult[] = skillNames.map((skillName, index) => {
                this.outputChannel.appendLine(`🏗️  [SkillsService] Mapping skill ${index}: ${typeof skillName} = ${skillName}`);
                return {
                    name: skillName,
                    description: `Skill: ${skillName}`,
                    source: repository.url,
                    path: `skills/${skillName}`,
                    repository: repository.url,
                    downloadUrl: null,
                    type: 'skill'
                };
            });
            
            this.outputChannel.appendLine(`🏗️  [SkillsService] Successfully loaded ${skills.length} skills from ${repository.name}`);
            skills.forEach((skill, index) => {
                this.outputChannel.appendLine(`  - ${index}: ${skill.name} (${skill.description})`);
            });
            
            return {
                repository,
                skills,
                error: null
            };
            
        } catch (error) {
            this.outputChannel.appendLine(`❌ [SkillsService] *** EXCEPTION CAUGHT IN loadRepositorySkills ***`);
            this.outputChannel.appendLine(`❌ [SkillsService] Error type: ${typeof error}`);
            this.outputChannel.appendLine(`❌ [SkillsService] Error message: ${(error as Error).message}`);
            this.outputChannel.appendLine(`❌ [SkillsService] Error stack: ${(error as Error).stack}`);
            this.outputChannel.appendLine(`❌ [SkillsService] Repository name: ${repository.name}`);
            this.outputChannel.appendLine(`❌ [SkillsService] Returning empty skills array due to error`);
            
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