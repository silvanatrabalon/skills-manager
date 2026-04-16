import * as vscode from 'vscode';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';

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

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Skills Manager');
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
            if (options.global) {
                args.push('--global');
            }

            const result = await this.runCommand(args.join(' '));
            return this.parseUpdateResults(result.stdout);
        } catch (error) {
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
            if (options.yes) {
                args.push('--yes');
            }

            const result = await this.runCommand(args.join(' '));
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
    
    // Parse skills list from CLI output
    private parseSkillsList(output: string): string[] {
        this.outputChannel.appendLine(`🔍 [PARSE] Starting parse of output (${output.length} chars)`);
        
        const skills: string[] = [];
        const lines = output.split('\n');
        let foundAvailableSection = false;
        
        this.outputChannel.appendLine(`🔍 [PARSE] Processing ${lines.length} lines`);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for "Available skills:" section (case insensitive)
            if (line.toLowerCase().includes('available')) {
                foundAvailableSection = true;
                this.outputChannel.appendLine(`🔍 [PARSE] Found "Available" section on line ${i}: "${line}"`);
                continue;
            }
            
            // If we found the "Available" section, look for skill lines
            if (foundAvailableSection) {
                // Look for lines like "│    - skill-name"
                const skillMatch = line.match(/│\s*-\s*([a-zA-Z0-9\-_]+)/);
                if (skillMatch) {
                    const skillName = skillMatch[1];
                    if (!skills.includes(skillName)) {
                        skills.push(skillName);
                        this.outputChannel.appendLine(`🔍 [PARSE] Found skill: ${skillName}`);
                    }
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
        
        const options: any = {
            shell: true,
            env: { ...process.env, PATH: fullPath }
        };
        if (cwd) {
            options.cwd = cwd;
        }

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

    private async runDirectCommand(command: string, cwd?: string): Promise<{ stdout: string, stderr: string }> {
        this.outputChannel.appendLine(`Running: ${command}`);
        
        const options: any = {};
        if (cwd) {
            options.cwd = cwd;
        }

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
        this.outputChannel.appendLine(`Raw output: "${output}"`);
        
        // First, clean ANSI color codes
        const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, '');
        this.outputChannel.appendLine(`Cleaned output: "${cleanOutput}"`);
        
        const skills: Skill[] = [];
        const lines = cleanOutput.split('\n').filter(line => line.trim());
        
        let currentScope: 'global' | 'project' = 'project';
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            this.outputChannel.appendLine(`Line ${i}: "${line}"`);
            
            // Detect scope headers
            if (line.toLowerCase().includes('project skills')) {
                currentScope = 'project';
                this.outputChannel.appendLine('  -> Found project section');
                continue;
            }
            
            if (line.toLowerCase().includes('global skills')) {
                currentScope = 'global';
                this.outputChannel.appendLine('  -> Found global section');
                continue;
            }
            
            // Skip empty lines, headers, and messages
            if (!line || 
                line.includes('Skills') || 
                line.includes('===') || 
                line.includes('No ') ||
                line.includes('Try listing') ||
                line.startsWith('Agents:')) {
                this.outputChannel.appendLine('  -> Skipping header/message line');
                continue;
            }
            
            // Look for main skill lines (not indented and have a space indicating name + path)
            if (!line.startsWith(' ') && line.includes(' ') && !line.includes(':')) {
                const parts = line.split(' ');
                if (parts.length >= 2) {
                    const skillName = parts[0];
                    const skillPath = parts.slice(1).join(' ');
                    
                    // Look ahead for agent info (indented line with "Agents:")
                    let agents = 'Unknown';
                    if (i + 1 < lines.length) {
                        const nextLine = lines[i + 1].trim();
                        if (nextLine.startsWith('Agents:')) {
                            agents = nextLine.replace('Agents:', '').trim();
                            i++; // Skip the agents line in next iteration
                        }
                    }
                    
                    const skill: Skill = {
                        name: skillName,
                        description: `Installed ${currentScope} skill`,
                        source: skillPath,
                        agent: agents,
                        installed: true,
                        scope: currentScope
                    };
                    
                    skills.push(skill);
                    this.outputChannel.appendLine(`  -> Parsed skill: ${skillName} (${currentScope}) - Agents: ${agents}`);
                }
            } else {
                this.outputChannel.appendLine('  -> Skipping indented or malformed line');
            }
        }
        
        this.outputChannel.appendLine(`=== PARSED ${skills.length} SKILLS ===`);
        skills.forEach(skill => this.outputChannel.appendLine(`- ${skill.name} (${skill.scope}) - ${skill.agent}`));
        
        return skills;
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
        // Parse update command output
        return [{
            success: true,
            message: output,
            skill: 'all',
            updated: output.includes('updated')
        }];
    }

    private parseRemoveResults(output: string, skills: string[]): RemoveResult[] {
        return skills.map(skill => ({
            success: true,
            message: `Removed ${skill}`,
            skill
        }));
    }
}