import * as url from 'url';

export class ValidationUtils {
    /**
     * Validate URL format
     */
    static isValidUrl(input: string): boolean {
        try {
            new url.URL(input);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate GitHub repository format
     */
    static isValidGitHubRepo(input: string): boolean {
        // Support both short form (user/repo) and full URLs
        if (input.includes('github.com')) {
            return /^https?:\/\/(www\.)?github\.com\/[^\/]+\/[^\/]+\/?$/.test(input);
        } else {
            return /^[^\/\s]+\/[^\/\s]+$/.test(input);
        }
    }

    /**
     * Validate GitLab repository format
     */
    static isValidGitLabRepo(input: string): boolean {
        return /^https?:\/\/[^\/]+\/[^\/]+\/[^\/]+\/?$/.test(input);
    }

    /**
     * Validate local path format
     */
    static isValidLocalPath(input: string): boolean {
        if (!input || input.length < 2) {
            return false;
        }
        
        // Basic validation - contains path separators
        return input.includes('/') || input.includes('\\') || input.startsWith('.') || input.startsWith('~');
    }

    /**
     * Validate skill name format
     */
    static isValidSkillName(name: string): boolean {
        if (!name || name.trim().length === 0) {
            return false;
        }
        
        // Skill names should be reasonable length and contain valid characters
        return /^[a-zA-Z0-9\-_\s]{1,100}$/.test(name.trim());
    }

    /**
     * Validate repository name
     */
    static isValidRepositoryName(name: string): boolean {
        if (!name || name.trim().length === 0) {
            return false;
        }
        
        // Repository names should be reasonable length
        return name.trim().length >= 1 && name.trim().length <= 50;
    }

    /**
     * Sanitize input string
     */
    static sanitizeString(input: string): string {
        if (!input) {
            return '';
        }
        
        // Remove dangerous characters and trim
        // eslint-disable-next-line no-control-regex
        return input.replace(/[<>:"'|?*\x00-\x1f]/g, '').trim();
    }

    /**
     * Validate agent name
     */
    static isValidAgentName(agent: string): boolean {
        const validAgents = [
            'github-copilot',
            'claude-code',
            'cursor',
            'cline',
            'continue',
            'windsurf',
            'codebuddy',
            'opencode',
            'amp',
            'antigravity',
            'augment',
            'bob',
            'openclaw',
            'warp',
            'codex',
            'command-code',
            'cortex',
            'crush',
            'deepagents',
            'droid',
            'firebender',
            'gemini-cli',
            'goose',
            'junie',
            'iflow-cli',
            'kilo',
            'kiro-cli',
            'kode',
            'mcpjam',
            'mistral-vibe',
            'mux',
            'openhands',
            'pi',
            'qoder',
            'qwen-code',
            'roo',
            'trae',
            'trae-cn',
            'zencoder',
            'neovate',
            'pochi',
            'adal',
            'kimi-cli',
            'replit',
            'universal'
        ];
        
        return validAgents.includes(agent.toLowerCase());
    }

    /**
     * Validate scope
     */
    static isValidScope(scope: string): boolean {
        return scope === 'global' || scope === 'project';
    }

    /**
     * Validate arrays
     */
    static isNonEmptyArray(input: any): boolean {
        return Array.isArray(input) && input.length > 0;
    }

    /**
     * Validate configuration object
     */
    static validateConfiguration(config: any): string[] {
        const errors: string[] = [];
        
        if (config.repositories && !Array.isArray(config.repositories)) {
            errors.push('repositories must be an array');
        }
        
        if (config.defaultScope && !this.isValidScope(config.defaultScope)) {
            errors.push('defaultScope must be either "global" or "project"');
        }
        
        if (config.targetAgents) {
            if (!Array.isArray(config.targetAgents)) {
                errors.push('targetAgents must be an array');
            } else {
                const invalidAgents = config.targetAgents.filter((agent: string) => 
                    !this.isValidAgentName(agent)
                );
                if (invalidAgents.length > 0) {
                    errors.push(`Invalid agents: ${invalidAgents.join(', ')}`);
                }
            }
        }
        
        if (config.autoUpdate !== undefined && typeof config.autoUpdate !== 'boolean') {
            errors.push('autoUpdate must be a boolean');
        }
        
        if (config.autoInstallCli !== undefined && typeof config.autoInstallCli !== 'boolean') {
            errors.push('autoInstallCli must be a boolean');
        }
        
        return errors;
    }

    /**
     * Extract GitHub username and repository from URL or short form
     */
    static parseGitHubRepo(input: string): { owner: string, repo: string } | null {
        try {
            if (input.includes('github.com')) {
                const match = input.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                if (match) {
                    return {
                        owner: match[1],
                        repo: match[2].replace(/\.git$/, '')
                    };
                }
            } else {
                const parts = input.split('/');
                if (parts.length === 2) {
                    return {
                        owner: parts[0],
                        repo: parts[1]
                    };
                }
            }
        } catch {
            // Invalid format
        }
        
        return null;
    }

    /**
     * Normalize repository URL for CLI usage
     */
    static normalizeRepositoryUrl(url: string, type: 'github' | 'gitlab' | 'local'): string {
        if (type === 'github') {
            const parsed = this.parseGitHubRepo(url);
            return parsed ? `${parsed.owner}/${parsed.repo}` : url;
        }
        
        return url;
    }
}