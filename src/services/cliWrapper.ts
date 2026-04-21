import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { UpdateCheckService, SkillUpdateInfo } from './updateCheckService';

const execAsync = promisify(exec);

export interface Skill {
    name: string;
    description: string;
    source: string;
    agent: string;
    installed: boolean;
    scope: 'global' | 'project';
    version?: string;
    metadata?: {
        internal?: boolean;
        [key: string]: any;
    };
}

export interface SkillWithDetails {
    name: string;
    description: string;
    source: string;
    triggers?: string;
    fullDescription?: string;
}

export interface SkillSearchResult {
    name: string;
    description: string;
    source: string;
    path: string;
    repository: string;
}

export interface InstallResult {
    success: boolean;
    message: string;
    skill?: Skill;
}

export interface UpdateResult {
    success: boolean;
    message: string;
    skill: string;
    updated: boolean;
}

export interface RemoveResult {
    success: boolean;
    message: string;
    skill: string;
}

export interface UpdateCheckResult {
    skillsAvailable: string[];
    skillsUpToDate: string[];
    skillsSkipped: { name: string; reason: string }[];
    updateInfos: SkillUpdateInfo[];
}

export interface AddSkillOptions {
    agents?: string[];
    skills?: string[];
    global?: boolean;
    copy?: boolean;
    yes?: boolean;
    all?: boolean;
}

export interface RemoveOptions {
    global?: boolean;
    agents?: string[];
    yes?: boolean;
}

export class SkillsCliService {
    private outputChannel: vscode.OutputChannel;
    private updateCheckService: UpdateCheckService;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Skills Manager');
        this.updateCheckService = new UpdateCheckService();
    }

    async checkCliAvailability(): Promise<boolean> {
        this.outputChannel.appendLine('Checking Skills CLI availability...');
        
        try {
            // Try npx skills first (works for both local and global installations)
            this.outputChannel.appendLine('Trying: npx skills --version');
            await this.runCommand('npx skills --version');
            this.outputChannel.appendLine('✓ Skills CLI found via npx');
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`❌ npx skills failed: ${(error as Error).message}`);
            
            // Fallback: try direct skills command (for global installations in PATH)
            try {
                this.outputChannel.appendLine('Trying: skills --version');
                await this.runCommand('skills --version');
                this.outputChannel.appendLine('✓ Skills CLI found via direct command');
                return true;
            } catch (directError) {
                this.outputChannel.appendLine(`❌ direct skills failed: ${(directError as Error).message}`);
                
                // Final attempt: check if skills exists in known NVM path
                try {
                    const homedir = require('os').homedir();
                    const nvmPath = `${homedir}/.nvm/versions/node/v20.15.0/bin/skills`;
                    this.outputChannel.appendLine(`Trying direct path: ${nvmPath} --version`);
                    await this.runCommand(`${nvmPath} --version`);
                    this.outputChannel.appendLine('✓ Skills CLI found via direct NVM path');
                    return true;
                } catch (nvmError) {
                    this.outputChannel.appendLine(`❌ NVM path failed: ${(nvmError as Error).message}`);
                    this.outputChannel.appendLine('❌ Skills CLI not available through any method');
                    return false;
                }
            }
        }
    }

    async installCli(): Promise<void> {
        const progressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: 'Installing Skills CLI...',
            cancellable: false
        };

        return vscode.window.withProgress(progressOptions, async () => {
            // Try different npm paths
            const npmCommands = [
                'npm',
                '/usr/local/bin/npm',
                '/opt/homebrew/bin/npm',
                'which npm && npm'
            ];

            for (const npmCmd of npmCommands) {
                try {
                    await this.runCommand(`${npmCmd} install -g skills`);
                    return;
                } catch (error) {
                    console.log(`Failed with ${npmCmd}:`, error);
                    continue;
                }
            }
            
            throw new Error('Could not find npm. Please install Skills CLI manually: npm install -g skills');
        });
    }

    async addSkill(repository: string, options: AddSkillOptions = {}): Promise<InstallResult> {
        this.outputChannel.appendLine(`🚀 [CLI] *** ENTRY addSkill method ***`);
        this.outputChannel.appendLine(`🚀 [CLI] repository: ${repository}`);
        this.outputChannel.appendLine(`🚀 [CLI] options: ${JSON.stringify(options)}`);
        
        try {
            const args = ['npx', 'skills', 'add', repository];
            
            if (options.global) {
                this.outputChannel.appendLine(`🚀 [CLI] Adding --global`);
                args.push('--global');
            }
            if (options.agents?.length) {
                this.outputChannel.appendLine(`🚀 [CLI] Adding --agent with: ${JSON.stringify(options.agents)}`);
                // Escape '*' properly for shell
                const escapedAgents = options.agents.map(agent => agent === '*' ? "'*'" : agent);
                this.outputChannel.appendLine(`🚀 [CLI] Escaped agents: ${JSON.stringify(escapedAgents)}`);
                args.push('--agent', ...escapedAgents);
            }
            if (options.skills?.length) {
                this.outputChannel.appendLine(`🚀 [CLI] Adding --skill with: ${JSON.stringify(options.skills)}`);
                args.push('--skill', ...options.skills);
            }
            if (options.copy) {
                this.outputChannel.appendLine(`🚀 [CLI] Adding --copy`);
                args.push('--copy');
            }
            if (options.yes) {
                this.outputChannel.appendLine(`🚀 [CLI] Adding --yes`);
                args.push('--yes');
            }
            if (options.all) {
                this.outputChannel.appendLine(`🚀 [CLI] Adding --all`);
                args.push('--all');
            }

            this.outputChannel.appendLine(`🚀 [CLI] Final install command: ${args.join(' ')}`);
            const result = await this.runCommand(args.join(' '));
            
            return {
                success: true,
                message: result.stdout
            };
        } catch (error) {
            return {
                success: false,
                message: (error as Error).message
            };
        }
    }

    async listSkills(scope?: 'global' | 'project'): Promise<Skill[]> {
        try {
            const args = ['npx', 'skills', 'list'];
            if (scope === 'global') {
                args.push('--global');
            }

            const result = await this.runCommand(args.join(' '));
            return this.parseSkillsList(result.stdout);
        } catch (error) {
            this.outputChannel.appendLine(`Error listing skills: ${(error as Error).message}`);
            return [];
        }
    }

    async listSkillsByScope(): Promise<{ local: Skill[], global: Skill[] }> {
        try {
            this.outputChannel.appendLine(`📋 [CLI] Listing skills by scope...`);
            
            // Get both local and global skills in parallel for better performance
            const [localSkills, globalSkills] = await Promise.all([
                this.listSkills('project'),
                this.listSkills('global')
            ]);

            this.outputChannel.appendLine(`📋 [CLI] Found ${localSkills.length} local skills, ${globalSkills.length} global skills`);
            
            return {
                local: localSkills,
                global: globalSkills
            };
        } catch (error) {
            this.outputChannel.appendLine(`❌ [CLI] Error listing skills by scope: ${(error as Error).message}`);
            return { local: [], global: [] };
        }
    }

    async findSkills(query?: string, repository?: string): Promise<SkillSearchResult[]> {
        try {
            this.outputChannel.appendLine(`🔍 [CLI] Finding skills - query: ${query || 'none'}, repo: ${repository || 'none'}`);
            
            const args = ['npx', 'skills', 'find'];
            if (query) {
                args.push(query);
            }
            
            this.outputChannel.appendLine(`🔍 [CLI] Running command: ${args.join(' ')}`);

            // Add timeout to prevent hanging
            const result = await Promise.race([
                this.runCommand(args.join(' ')),
                new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Command timeout after 10 seconds')), 10000)
                )
            ]);
            
            this.outputChannel.appendLine(`🔍 [CLI] Command completed, parsing results...`);
            const skills = this.parseSkillsSearch(result.stdout, repository || '');
            this.outputChannel.appendLine(`🔍 [CLI] Found ${skills.length} skills`);
            
            return skills;
        } catch (error) {
            this.outputChannel.appendLine(`❌ [CLI] Error finding skills: ${(error as Error).message}`);
            return [];
        }
    }

    async updateSkills(skills?: string[], options: { global?: boolean } = {}): Promise<UpdateResult[]> {
        try {
            const args = ['npx', 'skills', 'update'];
            if (skills?.length) {
                args.push(...skills);
            }
            
            // Add scope flags based on CLI requirements
            if (options.global) {
                args.push('-g');  // Use -g for global scope
            } else {
                args.push('-p');  // Use -p for project scope (default)
            }

            const finalCommand = args.join(' ');
            console.log(`🔄 [CLI] Executing: ${finalCommand}`);

            const result = await this.runCommand(finalCommand);
            return this.parseUpdateResults(result.stdout);
        } catch (error) {
            console.error(`🔄 [CLI] Error updating skills:`, error);
            this.outputChannel.appendLine(`Error updating skills: ${(error as Error).message}`);
            return [];
        }
    }

    async removeSkills(skills: string[], options: RemoveOptions = {}): Promise<RemoveResult[]> {
        try {
            const args = ['npx', 'skills', 'remove', ...skills];
            
            if (options.global) {
                args.push('--global');
            }
            if (options.agents?.length) {
                args.push('--agent', ...options.agents);
            }
            // Always use --yes for non-interactive mode
            args.push('--yes');

            const finalCommand = args.join(' ');
            console.log(`🗑️ [CLI] Executing: ${finalCommand}`);

            const result = await this.runCommand(finalCommand);
            return this.parseRemoveResults(result.stdout, skills);
        } catch (error) {
            this.outputChannel.appendLine(`Error removing skills: ${(error as Error).message}`);
            return skills.map(skill => ({
                success: false,
                message: (error as Error).message,
                skill
            }));
        }
    }

    async initSkill(name: string, path?: string): Promise<void> {
        const args = ['npx', 'skills', 'init'];
        if (name) {
            args.push(name);
        }

        await this.runCommand(args.join(' '), path);
    }

    // List skills available in a repository using CLI discovery
    async listRepositorySkills(repository: string): Promise<string[]> {
        this.outputChannel.appendLine(`🔍 [CLI] Starting discovery for repository: ${repository}`);
        
        try {
            // Use a non-existent skill name to trigger the CLI to list all skills
            // IMPORTANT: '*' must be quoted to work in Node.js shell
            const args = ['npx', 'skills', 'add', repository, '--skill', 'nonexistent-skill-name', '--agent', "'*'", '-y'];
            this.outputChannel.appendLine(`🔍 [CLI] Command: ${args.join(' ')}`);
            
            const result = await this.runCommand(args.join(' '));
            this.outputChannel.appendLine(`🔍 [CLI] SUCCESS - stdout length: ${result.stdout.length}`);
            this.outputChannel.appendLine(`🔍 [CLI] SUCCESS - stderr length: ${result.stderr.length}`);
            
            // Get complete output and parse it
            const fullOutput = result.stdout + '\n' + result.stderr;
            return this.parseSkillsFromCompleteOutput(fullOutput);
            
        } catch (error) {
            // The command will fail (exit code != 0) but still output the skills list
            const errorMessage = (error as any).message || '';
            const errorStdout = (error as any).stdout || '';
            const errorStderr = (error as any).stderr || '';
            
            this.outputChannel.appendLine(`🔍 [CLI] EXPECTED ERROR - getting complete output...`);
            
            // Get complete output and parse it
            const fullOutput = errorStdout + '\n' + errorStderr + '\n' + errorMessage;
            return this.parseSkillsFromCompleteOutput(fullOutput);
        }
    }

    async listRepositorySkillsWithDetails(repository: string): Promise<SkillWithDetails[]> {
        this.outputChannel.appendLine(`🌟 [CLI] Starting detailed discovery for repository: ${repository}`);
        
        try {
            const args = ['npx', 'skills', 'add', repository, '--list'];
            this.outputChannel.appendLine(`🌟 [CLI] Command: ${args.join(' ')}`);
            
            const result = await this.runCommand(args.join(' '));
            this.outputChannel.appendLine(`🌟 [CLI] SUCCESS - stdout length: ${result.stdout.length}`);
            
            return this.parseDetailedSkillsOutput(result.stdout, repository);
            
        } catch (error) {
            this.outputChannel.appendLine(`🌟 [CLI] Error in listRepositorySkillsWithDetails: ${(error as Error).message}`);
            return [];
        }
    }
    
    // Parse skills from complete CLI output by finding "Available" section
    private parseSkillsFromCompleteOutput(fullOutput: string): string[] {
        this.outputChannel.appendLine(`🔍 [PARSE] Starting parse of complete output (${fullOutput.length} chars)`);
        
        // Find "Available" section and cut everything before it
        const availableIndex = fullOutput.toLowerCase().indexOf('available');
        if (availableIndex === -1) {
            this.outputChannel.appendLine(`🔍 [PARSE] No "Available" section found`);
            return [];
        }
        
        this.outputChannel.appendLine(`🔍 [PARSE] Found "Available" at position ${availableIndex}`);
        const afterAvailable = fullOutput.substring(availableIndex);
        this.outputChannel.appendLine(`🔍 [PARSE] Text after "Available":\n${afterAvailable}`);
        
        // Now parse the skills from the section after "Available"
        const skills: string[] = [];
        const lines = afterAvailable.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for lines like "│    - skill-name" or "   - skill-name"
            const skillMatch = line.match(/[-│\s]*-\s*([a-zA-Z0-9\-_]+)/);
            if (skillMatch) {
                const skillName = skillMatch[1];
                if (!skills.includes(skillName)) {
                    skills.push(skillName);
                    this.outputChannel.appendLine(`🔍 [PARSE] Found skill: ${skillName}`);
                }
            }
        }
        
        this.outputChannel.appendLine(`🔍 [PARSE] Final result: ${skills.length} skills found: [${skills.join(', ')}]`);
        return skills;
    }
    
    private async runCommand(command: string, cwd?: string): Promise<{ stdout: string, stderr: string }> {
        this.outputChannel.appendLine(`Running: ${command}`);
        
        // Build comprehensive PATH including common Node.js installation locations
        const homedir = require('os').homedir();
        const extraPaths = [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            `${homedir}/.nvm/versions/node/v20.15.0/bin`, // Current NVM node version
            `${homedir}/.nodenv/shims`,
            `${homedir}/.fnm/current/bin`,
            '/usr/local/lib/node_modules/.bin',
            '/opt/homebrew/lib/node_modules/.bin'
        ];
        
        const fullPath = [process.env.PATH, ...extraPaths].filter(Boolean).join(':');
        
        // Use workspace directory as default cwd for proper skills CLI operation
        const defaultCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || homedir;
        const executionCwd = cwd || defaultCwd;
        
        this.outputChannel.appendLine(`Executing in directory: ${executionCwd}`);
        this.outputChannel.appendLine(`HOME directory: ${homedir}`);
        
        const options: any = {
            shell: true,
            cwd: executionCwd,
            env: { 
                ...process.env, 
                PATH: fullPath,
                HOME: homedir,  // Ensure HOME is properly set
                DISABLE_TELEMETRY: 'true'  // Disable Skills CLI telemetry for privacy
            }
        };

        try {
            const result = await execAsync(command, options);
            this.outputChannel.appendLine(`Output: ${result.stdout}`);
            
            if (result.stderr) {
                this.outputChannel.appendLine(`Stderr: ${result.stderr}`);
            }
            
            return result;
        } catch (error: any) {
            this.outputChannel.appendLine(`Error: ${error.message}`);
            throw error;
        }
    }

    private parseSkillsList(output: string): Skill[] {
        this.outputChannel.appendLine(`=== PARSING SKILLS LIST ===`);
        
        // Clean ANSI color codes
        // eslint-disable-next-line no-control-regex
        const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
        
        const skills: Skill[] = [];
        const lines = cleanOutput.split('\n').filter(line => line.trim());
        
        let currentScope: 'global' | 'project' = 'project';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Detect scope headers (exact match)
            if (line.toLowerCase() === 'project skills') {
                currentScope = 'project';
                continue;
            }
            if (line.toLowerCase() === 'global skills') {
                currentScope = 'global';
                continue;
            }
            
            // Skip "No X found" and hint messages
            if (line.startsWith('No ') || line.startsWith('Try listing')) {
                continue;
            }
            
            // Skill line format: "skill-name ~/path/to/skill"
            // skill name is kebab-case, followed by a space, followed by the path
            const match = line.match(/^([a-z0-9][a-z0-9\-]+)\s+(\S+)$/);
            if (match) {
                const skillName = match[1];
                const skillPath = match[2];
                
                // Look ahead for "Agents:" line
                let agents = 'Unknown';
                if (i + 1 < lines.length && lines[i + 1].trim().startsWith('Agents:')) {
                    agents = lines[i + 1].trim().replace('Agents:', '').trim();
                    i++; // Skip the agents line
                }
                
                skills.push({
                    name: skillName,
                    description: this.readSkillDescription(skillPath),
                    source: skillPath,
                    agent: agents,
                    installed: true,
                    scope: currentScope
                });
                
                this.outputChannel.appendLine(`  -> Parsed skill: ${skillName} (${currentScope}) - Agents: ${agents}`);
            }
        }
        
        this.outputChannel.appendLine(`=== PARSED ${skills.length} SKILLS ===`);
        skills.forEach(skill => this.outputChannel.appendLine(`- ${skill.name} (${skill.scope}) - ${skill.agent}`));
        
        return skills;
    }

    private readSkillDescription(skillPath: string): string {
        try {
            const homedir = require('os').homedir();
            const resolved = skillPath.startsWith('~') 
                ? path.join(homedir, skillPath.slice(1)) 
                : skillPath;
            const skillMd = path.join(resolved, 'SKILL.md');
            if (!fs.existsSync(skillMd)) { return ''; }
            const content = fs.readFileSync(skillMd, 'utf8');
            // Extract description from frontmatter
            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (fmMatch) {
                const descMatch = fmMatch[1].match(/description:\s*(.+)/i);
                if (descMatch) { return descMatch[1].trim().replace(/^["']|["']$/g, ''); }
            }
            // Fallback: first non-empty, non-heading line after frontmatter
            const body = fmMatch ? content.slice(fmMatch[0].length) : content;
            const firstLine = body.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
            return firstLine || '';
        } catch {
            return '';
        }
    }

    showDebugOutput(): vscode.OutputChannel {
        this.outputChannel.show();
        return this.outputChannel;
    }

    private parseSkillsSearch(output: string, repository: string): SkillSearchResult[] {
        // Parse the output from `skills find` command
        const results: SkillSearchResult[] = [];
        const lines = output.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
            // Basic parsing - adjust based on actual CLI output format
            if (line.includes('●') || line.includes('○')) {
                const parts = line.split(' - ');
                if (parts.length >= 2) {
                    const name = parts[0].replace(/[●○]\s*/, '').trim();
                    const description = parts[1].trim();
                    
                    results.push({
                        name,
                        description,
                        source: repository,
                        path: name,
                        repository
                    });
                }
            }
        }
        
        return results;
    }

    private parseUpdateResults(output: string): UpdateResult[] {
        console.log('🔄 [CLI] Parsing update output:', output);
        
        const results: UpdateResult[] = [];
        const lines = output.split('\n');
        
        let foundSkills = false;
        
        for (const line of lines) {
            // Look for success indicators in CLI output
            if (line.includes('Successfully updated') || line.includes('✓')) {
                // Extract skill name if possible
                const skillMatch = line.match(/(?:Successfully updated|✓)\s+"?([^"]+)"?/i);
                if (skillMatch) {
                    results.push({
                        success: true,
                        message: line.trim(),
                        skill: skillMatch[1],
                        updated: true
                    });
                    foundSkills = true;
                }
            } else if (line.includes('is already up-to-date') || line.includes('No updates available')) {
                const skillMatch = line.match(/"?([^"]+)"?\s+is already up-to-date/i);
                if (skillMatch) {
                    results.push({
                        success: true,
                        message: line.trim(),
                        skill: skillMatch[1],
                        updated: false
                    });
                    foundSkills = true;
                }
            } else if (line.includes('Updated') && line.includes('to')) {
                // Handle format: "Updated skill-name to version"
                const skillMatch = line.match(/Updated\s+([^\s]+)/i);
                if (skillMatch) {
                    results.push({
                        success: true,
                        message: line.trim(),
                        skill: skillMatch[1],
                        updated: true
                    });
                    foundSkills = true;
                }
            }
        }
        
        // If no specific skills found, return a general result
        if (!foundSkills) {
            const updated = output.toLowerCase().includes('updated') && !output.toLowerCase().includes('no updates');
            results.push({
                success: !output.toLowerCase().includes('error') && !output.toLowerCase().includes('failed'),
                message: output.trim() || 'Update command completed',
                skill: 'unknown',
                updated
            });
        }
        
        console.log('🔄 [CLI] Parsed update results:', results);
        return results;
    }

    private parseRemoveResults(output: string, skills: string[]): RemoveResult[] {
        return skills.map(skill => ({
            success: true,
            message: `Removed ${skill}`,
            skill
        }));
    }

    private parseDetailedSkillsOutput(output: string, repository: string): SkillWithDetails[] {
        this.outputChannel.appendLine(`🌟 [PARSE] Starting detailed parsing of output (${output.length} chars)`);
        
        const skills: SkillWithDetails[] = [];
        const lines = output.split('\n');
        
        let inAvailableSection = false;
        let currentSkill: Partial<SkillWithDetails> | null = null;
        let collectingDescription = false;
        let descriptionLines: string[] = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            this.outputChannel.appendLine(`🌟 [PARSE] Line ${i}: "${line}"`);
            
            // Look for "Available Skills" section
            if (line.toLowerCase().includes('available skills')) {
                inAvailableSection = true;
                this.outputChannel.appendLine(`🌟 [PARSE] Found "Available Skills" section`);
                continue;
            }
            
            if (!inAvailableSection) {continue;}
            
            // Skip the footer line
            if (line.includes('Use --skill')) {
                break;
            }
            
            // Look for skill name line: "│    skill-name" (name only, no spaces in skill name)
            const skillNameMatch = line.match(/^│\s+([a-zA-Z0-9\-_]+)\s*$/);
            if (skillNameMatch) {
                // Finalize previous skill if exists
                if (currentSkill && descriptionLines.length > 0) {
                    currentSkill.description = descriptionLines.join(' ').trim();
                    currentSkill.fullDescription = currentSkill.description;
                    skills.push(currentSkill as SkillWithDetails);
                    this.outputChannel.appendLine(`🌟 [PARSE] Completed skill: ${currentSkill.name}`);
                }
                
                // Start new skill
                currentSkill = {
                    name: skillNameMatch[1],
                    source: repository,
                    description: '',
                    fullDescription: ''
                };
                descriptionLines = [];
                collectingDescription = false;
                this.outputChannel.appendLine(`🌟 [PARSE] Found new skill: ${skillNameMatch[1]}`);
                continue;
            }
            
            // Look for description start: "│      text..." (description starts with indentation)
            const descriptionMatch = line.match(/^│\s{6,}(.+)$/);
            if (descriptionMatch && currentSkill) {
                collectingDescription = true;
                const descText = descriptionMatch[1].trim();
                if (descText) {
                    descriptionLines.push(descText);
                    this.outputChannel.appendLine(`🌟 [PARSE] Added description line: "${descText}"`);
                }
                continue;
            }
            
            // Continue collecting description if we're in description mode and line has content
            if (collectingDescription && currentSkill) {
                const continuationMatch = line.match(/^(.+?)(?:\s+│)?$/);
                if (continuationMatch) {
                    const descText = continuationMatch[1].trim();
                    if (descText && !descText.startsWith('│') && !descText.startsWith('┌') && !descText.startsWith('└')) {
                        descriptionLines.push(descText);
                        this.outputChannel.appendLine(`🌟 [PARSE] Continued description: "${descText}"`);
                        continue;
                    }
                }
            }
            
            // Empty line with just "│" - transition or end of description
            if (line.match(/^│\s*$/) && collectingDescription) {
                collectingDescription = false;
                this.outputChannel.appendLine(`🌟 [PARSE] End of description for current skill`);
            }
        }
        
        // Finalize last skill
        if (currentSkill && descriptionLines.length > 0) {
            currentSkill.description = descriptionLines.join(' ').trim();
            currentSkill.fullDescription = currentSkill.description;
            skills.push(currentSkill as SkillWithDetails);
            this.outputChannel.appendLine(`🌟 [PARSE] Completed final skill: ${currentSkill.name}`);
        }
        
        this.outputChannel.appendLine(`🌟 [PARSE] Final result: ${skills.length} skills with details found`);
        skills.forEach((skill, index) => {
            this.outputChannel.appendLine(`  ${index + 1}. ${skill.name}: ${skill.description?.substring(0, 100)}${(skill.description?.length || 0) > 100 ? '...' : ''}`);
        });
        
        return skills;
    }

    async checkForUpdates(scope?: 'global' | 'project'): Promise<UpdateCheckResult> {
        this.outputChannel.appendLine(`🔍 [CLI] Checking for skill updates (scope: ${scope || 'both'})`);
        
        try {
            const updateInfos = await this.updateCheckService.checkSkillUpdates(scope || 'both');
            this.outputChannel.appendLine(`🔍 [CLI] Found ${updateInfos.length} skills in lock files`);
            
            const skillsAvailable = updateInfos
                .filter(info => info.hasUpdate)
                .map(info => info.name);
            
            const skillsUpToDate = updateInfos
                .filter(info => !info.hasUpdate)
                .map(info => info.name);
            
            this.outputChannel.appendLine(`🔍 [CLI] Updates available: ${skillsAvailable.length} skills`);
            this.outputChannel.appendLine(`🔍 [CLI] Up to date: ${skillsUpToDate.length} skills`);
            
            if (skillsAvailable.length > 0) {
                this.outputChannel.appendLine(`🔍 [CLI] Skills with updates: ${skillsAvailable.join(', ')}`);
            }
            
            const checkResult: UpdateCheckResult = {
                skillsAvailable,
                skillsUpToDate,
                skillsSkipped: [], // Could be enhanced to track skipped skills
                updateInfos
            };
            
            this.outputChannel.appendLine(`🔍 [CLI] Update check complete`);
            
            return checkResult;
            
        } catch (error) {
            this.outputChannel.appendLine(`❌ [CLI] Error checking for updates: ${(error as Error).message}`);
            this.outputChannel.show();
            throw error;
        }
    }
}