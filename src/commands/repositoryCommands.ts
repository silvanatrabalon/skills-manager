import * as vscode from 'vscode';
import { ConfigService, Repository } from '../services/configService';
import { RepositoryProvider, RepositoryTreeItem } from '../providers/repositoryProvider';

interface RepositoryTypeQuickPickItem extends vscode.QuickPickItem {
    type: 'github' | 'gitlab' | 'local';
}

export class RepositoryCommands {
    constructor(
        private configService: ConfigService,
        private repositoryProvider: RepositoryProvider
    ) {}

    async addRepository(): Promise<void> {
        try {
            // Step 1: Choose repository type
            const typeItems: RepositoryTypeQuickPickItem[] = [
                {
                    label: 'GitHub',
                    description: 'GitHub repository (e.g., username/repo)',
                    detail: 'Public or private GitHub repositories',
                    type: 'github'
                },
                {
                    label: 'GitLab',
                    description: 'GitLab repository (full URL)',
                    detail: 'GitLab.com or self-hosted GitLab',
                    type: 'gitlab'
                },
                {
                    label: 'Local',
                    description: 'Local file system path',
                    detail: 'Local folder containing skills',
                    type: 'local'
                }
            ];

            const selectedType = await vscode.window.showQuickPick(typeItems, {
                title: 'Repository Type',
                placeHolder: 'Select the type of repository to add...'
            });

            if (!selectedType) {
                return;
            }

            // Step 2: Get repository details
            const repository = await this.getRepositoryDetails(selectedType.type);
            if (!repository) {
                return;
            }

            // Step 3: Validate repository
            const validationErrors = this.configService.validateRepository(repository);
            if (validationErrors.length > 0) {
                vscode.window.showErrorMessage(`Invalid repository: ${validationErrors.join(', ')}`);
                return;
            }

            // Step 4: Add repository
            await this.configService.addRepository(repository);
            vscode.window.showInformationMessage(`Successfully added repository "${repository.name}"`);
            
            this.repositoryProvider.refresh();
        } catch (error) {
            if ((error as Error).message.includes('already exists')) {
                vscode.window.showWarningMessage('A repository with this name or URL already exists.');
            } else {
                vscode.window.showErrorMessage('Error adding repository: ' + (error as Error).message);
            }
        }
    }

    async removeRepository(item: RepositoryTreeItem): Promise<void> {
        if (!item.repository) {
            return;
        }

        const repository = item.repository;
        
        const confirmDelete = await vscode.window.showWarningMessage(
            `Are you sure you want to remove "${repository.name}"?`,
            { modal: true, detail: 'This will only remove the repository configuration, not any installed skills.' },
            'Remove'
        );

        if (confirmDelete === 'Remove') {
            try {
                await this.configService.removeRepository(repository.id);
                vscode.window.showInformationMessage(`Removed repository "${repository.name}"`);
                this.repositoryProvider.refresh();
            } catch (error) {
                vscode.window.showErrorMessage('Error removing repository: ' + (error as Error).message);
            }
        }
    }

    async editRepository(item: RepositoryTreeItem): Promise<void> {
        if (!item.repository) {
            return;
        }

        const repository = item.repository;
        
        // For now, we'll just allow editing the name and URL
        const newName = await vscode.window.showInputBox({
            title: 'Edit Repository Name',
            value: repository.name,
            placeHolder: 'Enter repository name...',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Repository name is required';
                }
                return null;
            }
        });

        if (!newName) {
            return;
        }

        const newUrl = await vscode.window.showInputBox({
            title: 'Edit Repository URL',
            value: repository.url,
            placeHolder: this.getUrlPlaceholder(repository.type),
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Repository URL is required';
                }
                return null;
            }
        });

        if (!newUrl) {
            return;
        }

        try {
            const updatedRepository: Repository = {
                ...repository,
                name: newName.trim(),
                url: newUrl.trim()
            };

            // Validate the updated repository
            const validationErrors = this.configService.validateRepository(updatedRepository);
            if (validationErrors.length > 0) {
                vscode.window.showErrorMessage(`Invalid repository: ${validationErrors.join(', ')}`);
                return;
            }

            await this.configService.updateRepository(updatedRepository);
            vscode.window.showInformationMessage(`Updated repository "${updatedRepository.name}"`);
            this.repositoryProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage('Error updating repository: ' + (error as Error).message);
        }
    }

    async toggleRepository(item: RepositoryTreeItem): Promise<void> {
        if (!item.repository) {
            return;
        }

        try {
            await this.repositoryProvider.toggleRepository(item.repository);
            const status = item.repository.enabled === false ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Repository "${item.repository.name}" ${status}`);
        } catch (error) {
            vscode.window.showErrorMessage('Error toggling repository: ' + (error as Error).message);
        }
    }

    private async getRepositoryDetails(type: 'github' | 'gitlab' | 'local'): Promise<Repository | undefined> {
        const name = await vscode.window.showInputBox({
            title: 'Repository Name',
            placeHolder: 'Enter a name for this repository...',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Repository name is required';
                }
                return null;
            }
        });

        if (!name) {
            return undefined;
        }

        const url = await vscode.window.showInputBox({
            title: 'Repository URL',
            placeHolder: this.getUrlPlaceholder(type),
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Repository URL is required';
                }
                return this.validateUrl(value.trim(), type);
            }
        });

        if (!url) {
            return undefined;
        }

        return {
            id: this.configService.generateRepositoryId(url),
            name: name.trim(),
            url: url.trim(),
            type,
            enabled: true
        };
    }

    private getUrlPlaceholder(type: 'github' | 'gitlab' | 'local'): string {
        switch (type) {
            case 'github':
                return 'e.g., username/repository or https://github.com/username/repository';
            case 'gitlab':
                return 'e.g., https://gitlab.com/username/repository';
            case 'local':
                return 'e.g., /path/to/local/skills or ./relative/path';
        }
    }

    private validateUrl(url: string, type: 'github' | 'gitlab' | 'local'): string | null {
        switch (type) {
            case 'github':
                if (url.includes('github.com')) {
                    const githubUrlPattern = /^https?:\/\/github\.com\/[^\/]+\/[^\/]+/;
                    if (!githubUrlPattern.test(url)) {
                        return 'Invalid GitHub URL format';
                    }
                } else {
                    const shortFormPattern = /^[^\/]+\/[^\/]+$/;
                    if (!shortFormPattern.test(url)) {
                        return 'Use format: username/repository or full GitHub URL';
                    }
                }
                break;
            case 'gitlab':
                const gitlabUrlPattern = /^https?:\/\/[^\/]+\/[^\/]+\/[^\/]+/;
                if (!gitlabUrlPattern.test(url)) {
                    return 'Invalid GitLab URL format';
                }
                break;
            case 'local':
                if (url.length < 2) {
                    return 'Path too short';
                }
                break;
        }
        return null;
    }

    // Quick actions for common repository types
    async addVercelSkills(): Promise<void> {
        const repository: Repository = {
            id: 'vercel-labs-agent-skills',
            name: 'Vercel Labs Agent Skills',
            url: 'vercel-labs/agent-skills',
            type: 'github',
            enabled: true
        };

        try {
            await this.configService.addRepository(repository);
            vscode.window.showInformationMessage('Added Vercel Labs Skills repository');
            this.repositoryProvider.refresh();
        } catch (error) {
            if ((error as Error).message.includes('already exists')) {
                vscode.window.showInformationMessage('Vercel Labs Skills repository already exists');
            } else {
                vscode.window.showErrorMessage('Error adding Vercel repository: ' + (error as Error).message);
            }
        }
    }

    async addLocalRepository(): Promise<void> {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            title: 'Select Local Skills Folder'
        });

        if (folderUri && folderUri[0]) {
            const path = folderUri[0].fsPath;
            const name = await vscode.window.showInputBox({
                title: 'Repository Name',
                value: path.split(/[\/\\]/).pop() || 'Local Skills',
                placeHolder: 'Enter a name for this local repository...'
            });

            if (name) {
                const repository: Repository = {
                    id: this.configService.generateRepositoryId(path),
                    name,
                    url: path,
                    type: 'local',
                    enabled: true
                };

                try {
                    await this.configService.addRepository(repository);
                    vscode.window.showInformationMessage(`Added local repository "${name}"`);
                    this.repositoryProvider.refresh();
                } catch (error) {
                    vscode.window.showErrorMessage('Error adding local repository: ' + (error as Error).message);
                }
            }
        }
    }
}