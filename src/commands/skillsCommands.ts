import * as vscode from 'vscode';
import { SkillsService } from '../services/skillsService';
import { SkillsTreeProvider, SkillTreeItem } from '../providers/skillsTreeProvider';

interface InstallQuickPickItem extends vscode.QuickPickItem {
    repository: string;
    skillName?: string;
}

interface AgentQuickPickItem extends vscode.QuickPickItem {
    agent: string;
}

export class SkillsCommands {
    constructor(
        private _skillsService: SkillsService,
        private _skillsTreeProvider: SkillsTreeProvider
    ) {}

    async installInteractive(): Promise<void> {
        try {
            // Step 1: Get available skills from all repositories
            const repositorySkills = await this.skillsService.getAvailableSkills();
            
            if (repositorySkills.length === 0) {
                vscode.window.showWarningMessage('No repositories configured. Please add a repository first.');
                vscode.commands.executeCommand('skills.repository.add');
                return;
            }

            // Flatten all skills with repository information
            const allSkills: InstallQuickPickItem[] = [];
            repositorySkills.forEach(repoSkills => {
                if (repoSkills.error) {
                    console.warn(`Error loading skills from ${repoSkills.repository.name}: ${repoSkills.error}`);
                    return;
                }
                
                repoSkills.skills.forEach(skill => {
                    allSkills.push({
                        label: skill.name,
                        description: skill.description,
                        detail: `From: ${repoSkills.repository.name}`,
                        repository: skill.repository || skill.source,
                        skillName: skill.name
                    });
                });
            });

            if (allSkills.length === 0) {
                vscode.window.showInformationMessage('No skills found in configured repositories.');
                return;
            }

            // Step 2: Let user select skill(s)
            const selectedSkill = await vscode.window.showQuickPick(allSkills, {
                title: 'Select a skill to install',
                placeHolder: 'Choose a skill from the available repositories...',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedSkill) {
                return;
            }

            // Step 3: Installation options
            const installOptions = await this.getInstallOptions();
            if (!installOptions) {
                return;
            }

            // Step 4: Install the skill
            const result = await this.skillsService.installSkill(
                selectedSkill.repository,
                selectedSkill.skillName,
                installOptions
            );

            if (result.success) {
                vscode.window.showInformationMessage(`Successfully installed "${selectedSkill.label}"`);
                this.skillsTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage(`Failed to install "${selectedSkill.label}": ${result.message}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error during interactive installation: ' + (error as Error).message);
        }
    }

    async updateAll(): Promise<void> {
        const installedSkills = await this.skillsService.getInstalledSkills();
        
        if (installedSkills.length === 0) {
            vscode.window.showInformationMessage('No skills installed to update.');
            return;
        }

        const confirmUpdate = await vscode.window.showInformationMessage(
            `Update all ${installedSkills.length} installed skills?`,
            { modal: true },
            'Update All'
        );

        if (confirmUpdate === 'Update All') {
            try {
                const results = await this.skillsService.updateSkills();
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;

                if (failed === 0) {
                    vscode.window.showInformationMessage(`Successfully updated ${successful} skills.`);
                } else {
                    vscode.window.showWarningMessage(`Updated ${successful} skills, ${failed} failed.`);
                }

                this.skillsTreeProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage('Error updating skills: ' + (error as Error).message);
            }
        }
    }

    async installSkill(item: SkillTreeItem): Promise<void> {
        if (!item.skill) {
            return;
        }

        const skill = item.skill;
        
        if (skill.installed) {
            vscode.window.showInformationMessage(`"${skill.name}" is already installed.`);
            return;
        }

        const installOptions = await this.getInstallOptions();
        if (!installOptions) {
            return;
        }

        try {
            const repository = skill.repository?.url || skill.source;
            const result = await this.skillsService.installSkill(
                repository,
                skill.name,
                installOptions
            );

            if (result.success) {
                vscode.window.showInformationMessage(`Successfully installed "${skill.name}"`);
                this.skillsTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage(`Failed to install "${skill.name}": ${result.message}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error installing skill: ' + (error as Error).message);
        }
    }

    async uninstallSkill(item: SkillTreeItem): Promise<void> {
        if (!item.skill) {
            return;
        }

        const skill = item.skill;
        
        try {
            const results = await this.skillsService.removeSkills([skill.name], {
                scope: skill.scope
            });

            const result = results[0];
            if (result && result.success) {
                vscode.window.showInformationMessage(`Successfully removed "${skill.name}"`);
                this.skillsTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage(`Failed to remove "${skill.name}": ${result?.message || 'Unknown error'}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error removing skill: ' + (error as Error).message);
        }
    }

    async updateSkill(item: SkillTreeItem): Promise<void> {
        if (!item.skill) {
            return;
        }

        const skill = item.skill;
        
        try {
            const results = await this.skillsService.updateSkills([skill.name], skill.scope);
            const result = results[0];
            
            if (result && result.success) {
                if (result.updated) {
                    vscode.window.showInformationMessage(`Successfully updated "${skill.name}"`);
                } else {
                    vscode.window.showInformationMessage(`"${skill.name}" is already up to date`);
                }
                this.skillsTreeProvider.refresh();
            } else {
                vscode.window.showErrorMessage(`Failed to update "${skill.name}": ${result?.message || 'Unknown error'}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error updating skill: ' + (error as Error).message);
        }
    }

    private async getInstallOptions(): Promise<{
        scope: 'global' | 'project';
        agents: string[];
    } | undefined> {
        // Step 1: Choose scope
        const scopeChoice = await vscode.window.showQuickPick([
            { label: 'Project', description: 'Install for current project only', value: 'project' as const },
            { label: 'Global', description: 'Install globally for all projects', value: 'global' as const }
        ], {
            title: 'Installation Scope',
            placeHolder: 'Choose where to install the skill...'
        });

        if (!scopeChoice) {
            return undefined;
        }

        // Step 2: Choose agents
        const availableAgents = [
            'github-copilot',
            'claude-code',
            'cursor',
            'cline',
            'continue',
            'windsurf',
            'codebuddy',
            'opencode'
        ];

        const agentItems: AgentQuickPickItem[] = availableAgents.map(agent => ({
            label: agent,
            description: `Install skill for ${agent}`,
            agent,
            picked: ['github-copilot', 'claude-code', 'cursor'].includes(agent) // Default selection
        }));

        const selectedAgents = await vscode.window.showQuickPick(agentItems, {
            title: 'Target Agents',
            placeHolder: 'Select which agents should use this skill...',
            canPickMany: true
        });

        if (!selectedAgents || selectedAgents.length === 0) {
            return undefined;
        }

        return {
            scope: scopeChoice.value,
            agents: selectedAgents.map(item => item.agent)
        };
    }
}