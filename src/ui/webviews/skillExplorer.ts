import * as vscode from 'vscode';
import * as path from 'path';
import { SkillsService } from '../../services/skillsService';

export class SkillsExplorerWebview {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private skillsService: SkillsService;

    constructor(context: vscode.ExtensionContext, skillsService: SkillsService) {
        this.context = context;
        this.skillsService = skillsService;
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'skillsExplorer',
            'Skills Explorer',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(this.context.extensionPath, 'webview-ui'))
                ]
            }
        );

        this.panel.iconPath = new vscode.ThemeIcon('extensions');
        this.panel.webview.html = this.getWebviewContent();

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleWebviewMessage(message);
            },
            undefined,
            this.context.subscriptions
        );

        // Clean up when the panel is disposed
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.context.subscriptions);

        // Load initial data
        this.loadData();
    }

    private async handleWebviewMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.loadData(true);
                break;
            case 'installSkill':
                await this.installSkill(message.repository, message.skillName, message.options);
                break;
            case 'updateSkill':
                await this.updateSkill(message.skillName, message.scope);
                break;
            case 'removeSkill':
                await this.removeSkill(message.skillName, message.scope);
                break;
            case 'searchSkills':
                await this.searchSkills(message.query);
                break;
            case 'filterByRepository':
                await this.filterByRepository(message.repositoryId);
                break;
        }
    }

    private async loadData(forceRefresh = false): Promise<void> {
        try {
            this.postMessage({
                command: 'loading',
                loading: true
            });

            const [availableSkills, installedSkills] = await Promise.all([
                this.skillsService.getAvailableSkills(forceRefresh),
                this.skillsService.getInstalledSkills()
            ]);

            this.postMessage({
                command: 'dataLoaded',
                availableSkills,
                installedSkills,
                loading: false
            });
        } catch (error) {
            this.postMessage({
                command: 'error',
                message: (error as Error).message,
                loading: false
            });
        }
    }

    private async installSkill(repository: string, skillName: string, options: any): Promise<void> {
        try {
            const result = await this.skillsService.installSkill(repository, skillName, options);
            
            if (result.success) {
                this.postMessage({
                    command: 'skillInstalled',
                    skillName,
                    success: true
                });
                vscode.window.showInformationMessage(`Successfully installed "${skillName}"`);
                // Refresh the data to show the newly installed skill
                await this.loadData();
            } else {
                this.postMessage({
                    command: 'skillInstalled',
                    skillName,
                    success: false,
                    error: result.message
                });
                vscode.window.showErrorMessage(`Failed to install "${skillName}": ${result.message}`);
            }
        } catch (error) {
            this.postMessage({
                command: 'skillInstalled',
                skillName,
                success: false,
                error: (error as Error).message
            });
            vscode.window.showErrorMessage('Error installing skill: ' + (error as Error).message);
        }
    }

    private async updateSkill(skillName: string, scope?: 'global' | 'project'): Promise<void> {
        try {
            const results = await this.skillsService.updateSkills([skillName], scope);
            const result = results[0];
            
            if (result && result.success) {
                this.postMessage({
                    command: 'skillUpdated',
                    skillName,
                    success: true,
                    updated: result.updated
                });
                
                if (result.updated) {
                    vscode.window.showInformationMessage(`Successfully updated "${skillName}"`);
                } else {
                    vscode.window.showInformationMessage(`"${skillName}" is already up to date`);
                }
                
                await this.loadData();
            } else {
                this.postMessage({
                    command: 'skillUpdated',
                    skillName,
                    success: false,
                    error: result?.message || 'Unknown error'
                });
                vscode.window.showErrorMessage(`Failed to update "${skillName}": ${result?.message || 'Unknown error'}`);
            }
        } catch (error) {
            this.postMessage({
                command: 'skillUpdated',
                skillName,
                success: false,
                error: (error as Error).message
            });
            vscode.window.showErrorMessage('Error updating skill: ' + (error as Error).message);
        }
    }

    private async removeSkill(skillName: string, scope?: 'global' | 'project'): Promise<void> {
        try {
            const results = await this.skillsService.removeSkills([skillName], { scope });
            const result = results[0];
            
            if (result && result.success) {
                this.postMessage({
                    command: 'skillRemoved',
                    skillName,
                    success: true
                });
                vscode.window.showInformationMessage(`Successfully removed "${skillName}"`);
                await this.loadData();
            } else {
                this.postMessage({
                    command: 'skillRemoved',
                    skillName,
                    success: false,
                    error: result?.message || 'Unknown error'
                });
                vscode.window.showErrorMessage(`Failed to remove "${skillName}": ${result?.message || 'Unknown error'}`);
            }
        } catch (error) {
            this.postMessage({
                command: 'skillRemoved',
                skillName,
                success: false,
                error: (error as Error).message
            });
            vscode.window.showErrorMessage('Error removing skill: ' + (error as Error).message);
        }
    }

    private async searchSkills(query: string): Promise<void> {
        try {
            const results = await this.skillsService.searchSkills(query);
            this.postMessage({
                command: 'searchResults',
                results
            });
        } catch (error) {
            this.postMessage({
                command: 'searchError',
                message: (error as Error).message
            });
        }
    }

    private async filterByRepository(repositoryId: string): Promise<void> {
        try {
            const availableSkills = await this.skillsService.getAvailableSkills();
            const filtered = repositoryId === 'all' 
                ? availableSkills 
                : availableSkills.filter(rs => rs.repository.id === repositoryId);
            
            this.postMessage({
                command: 'filteredSkills',
                skills: filtered
            });
        } catch (error) {
            this.postMessage({
                command: 'filterError',
                message: (error as Error).message
            });
        }
    }

    private postMessage(message: any): void {
        if (this.panel) {
            this.panel.webview.postMessage(message);
        }
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Skills Explorer</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }

                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                }

                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 10px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }

                .search-container {
                    display: flex;
                    gap: 10px;
                    flex: 1;
                    max-width: 500px;
                }

                .search-input {
                    flex: 1;
                    padding: 8px 12px;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    color: var(--vscode-input-foreground);
                    border-radius: 3px;
                }

                .btn {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 13px;
                }

                .btn:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }

                .btn-secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }

                .btn-secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }

                .content {
                    display: flex;
                    gap: 20px;
                    height: calc(100vh - 120px);
                }

                .sidebar {
                    width: 250px;
                    background-color: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 3px;
                    padding: 15px;
                }

                .main-content {
                    flex: 1;
                    overflow-y: auto;
                }

                .section-title {
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 10px;
                    color: var(--vscode-foreground);
                }

                .filter-group {
                    margin-bottom: 20px;
                }

                .filter-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 5px 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    font-size: 13px;
                }

                .filter-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }

                .filter-item.active {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }

                .skills-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 15px;
                }

                .skill-card {
                    background-color: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 3px;
                    padding: 15px;
                    transition: border-color 0.2s;
                }

                .skill-card:hover {
                    border-color: var(--vscode-focusBorder);
                }

                .skill-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 8px;
                }

                .skill-name {
                    font-size: 14px;
                    font-weight: 600;
                    color: var(--vscode-foreground);
                }

                .skill-status {
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: 500;
                }

                .status-installed {
                    background-color: var(--vscode-charts-green);
                    color: var(--vscode-charts-foreground);
                }

                .status-available {
                    background-color: var(--vscode-charts-blue);
                    color: var(--vscode-charts-foreground);
                }

                .skill-description {
                    font-size: 13px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                    line-height: 1.4;
                }

                .skill-meta {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 10px;
                }

                .skill-actions {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .btn-small {
                    padding: 4px 8px;
                    font-size: 12px;
                    min-width: 60px;
                }

                .loading {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 200px;
                    font-size: 14px;
                    color: var(--vscode-descriptionForeground);
                }

                .error {
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    padding: 10px;
                    border-radius: 3px;
                    margin-bottom: 15px;
                }

                .empty-state {
                    text-align: center;
                    padding: 40px;
                    color: var(--vscode-descriptionForeground);
                }

                .tabs {
                    display: flex;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    margin-bottom: 15px;
                }

                .tab {
                    padding: 8px 16px;
                    cursor: pointer;
                    border-bottom: 2px solid transparent;
                    font-size: 13px;
                }

                .tab.active {
                    border-bottom-color: var(--vscode-focusBorder);
                    color: var(--vscode-foreground);
                }

                .tab:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Skills Explorer</h1>
                <div class="search-container">
                    <input type="text" class="search-input" placeholder="Search skills..." id="searchInput">
                    <button class="btn" onclick="handleSearch()">Search</button>
                </div>
                <button class="btn btn-secondary" onclick="handleRefresh()">Refresh</button>
            </div>

            <div class="content">
                <div class="sidebar">
                    <div class="filter-group">
                        <div class="section-title">View</div>
                        <div class="filter-item active" onclick="setActiveTab('all')" id="tab-all">
                            All Skills
                        </div>
                        <div class="filter-item" onclick="setActiveTab('available')" id="tab-available">
                            Available
                        </div>
                        <div class="filter-item" onclick="setActiveTab('installed')" id="tab-installed">
                            Installed
                        </div>
                    </div>

                    <div class="filter-group" id="repositoryFilters">
                        <div class="section-title">Repositories</div>
                        <div class="filter-item active" onclick="filterByRepository('all')" id="repo-all">
                            All Repositories
                        </div>
                    </div>
                </div>

                <div class="main-content">
                    <div id="loading" class="loading" style="display: none;">
                        Loading skills...
                    </div>
                    <div id="error" class="error" style="display: none;"></div>
                    <div id="skillsContainer">
                        <div class="empty-state">
                            Loading skills...
                        </div>
                    </div>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let currentData = {
                    availableSkills: [],
                    installedSkills: [],
                    filteredSkills: null
                };
                let currentTab = 'all';
                let currentSearch = '';

                // Handle messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'loading':
                            showLoading(message.loading);
                            break;
                        case 'dataLoaded':
                            currentData.availableSkills = message.availableSkills;
                            currentData.installedSkills = message.installedSkills;
                            showLoading(false);
                            updateRepositoryFilters();
                            renderSkills();
                            break;
                        case 'error':
                            showError(message.message);
                            showLoading(false);
                            break;
                        case 'searchResults':
                            renderSearchResults(message.results);
                            break;
                        case 'filteredSkills':
                            currentData.filteredSkills = message.skills;
                            renderSkills();
                            break;
                        case 'skillInstalled':
                        case 'skillUpdated':
                        case 'skillRemoved':
                            // Refresh data after skill operations
                            handleRefresh();
                            break;
                    }
                });

                function showLoading(loading) {
                    document.getElementById('loading').style.display = loading ? 'flex' : 'none';
                }

                function showError(message) {
                    const errorEl = document.getElementById('error');
                    errorEl.textContent = message;
                    errorEl.style.display = 'block';
                    setTimeout(() => {
                        errorEl.style.display = 'none';
                    }, 5000);
                }

                function setActiveTab(tab) {
                    // Update tab styles
                    document.querySelectorAll('#tab-all, #tab-available, #tab-installed').forEach(el => {
                        el.classList.remove('active');
                    });
                    document.getElementById('tab-' + tab).classList.add('active');
                    
                    currentTab = tab;
                    renderSkills();
                }

                function filterByRepository(repositoryId) {
                    // Update filter styles
                    document.querySelectorAll('[id^="repo-"]').forEach(el => {
                        el.classList.remove('active');
                    });
                    document.getElementById('repo-' + repositoryId).classList.add('active');
                    
                    vscode.postMessage({
                        command: 'filterByRepository',
                        repositoryId: repositoryId
                    });
                }

                function handleSearch() {
                    const query = document.getElementById('searchInput').value;
                    currentSearch = query;
                    
                    if (query.trim()) {
                        vscode.postMessage({
                            command: 'searchSkills',
                            query: query
                        });
                    } else {
                        renderSkills();
                    }
                }

                function handleRefresh() {
                    vscode.postMessage({
                        command: 'refresh'
                    });
                }

                function installSkill(repository, skillName) {
                    // Simple install with default options
                    vscode.postMessage({
                        command: 'installSkill',
                        repository: repository,
                        skillName: skillName,
                        options: {
                            scope: 'project',
                            agents: ['github-copilot', 'claude-code', 'cursor']
                        }
                    });
                }

                function updateSkill(skillName, scope) {
                    vscode.postMessage({
                        command: 'updateSkill',
                        skillName: skillName,
                        scope: scope
                    });
                }

                function removeSkill(skillName, scope) {
                    if (confirm('Are you sure you want to remove "' + skillName + '"?')) {
                        vscode.postMessage({
                            command: 'removeSkill',
                            skillName: skillName,
                            scope: scope
                        });
                    }
                }

                function updateRepositoryFilters() {
                    const container = document.getElementById('repositoryFilters');
                    const allRepos = new Set();
                    
                    currentData.availableSkills.forEach(repoSkills => {
                        allRepos.add(repoSkills.repository.id);
                    });
                    
                    let html = '<div class="section-title">Repositories</div>';
                    html += '<div class="filter-item active" onclick="filterByRepository(\'all\')" id="repo-all">All Repositories</div>';
                    
                    currentData.availableSkills.forEach(repoSkills => {
                        html += '<div class="filter-item" onclick="filterByRepository(\'' + repoSkills.repository.id + '\')" id="repo-' + repoSkills.repository.id + '">';
                        html += repoSkills.repository.name;
                        html += ' (' + repoSkills.skills.length + ')';
                        html += '</div>';
                    });
                    
                    container.innerHTML = html;
                }

                function renderSkills() {
                    const container = document.getElementById('skillsContainer');
                    let skillsToShow = [];
                    
                    const dataSource = currentData.filteredSkills || currentData.availableSkills;
                    
                    switch (currentTab) {
                        case 'available':
                            dataSource.forEach(repoSkills => {
                                repoSkills.skills.forEach(skill => {
                                    const isInstalled = currentData.installedSkills.some(installed => installed.name === skill.name);
                                    if (!isInstalled) {
                                        skillsToShow.push({
                                            ...skill,
                                            repository: repoSkills.repository,
                                            status: 'available'
                                        });
                                    }
                                });
                            });
                            break;
                        case 'installed':
                            skillsToShow = currentData.installedSkills.map(skill => ({
                                ...skill,
                                status: 'installed'
                            }));
                            break;
                        case 'all':
                        default:
                            // Show all available skills with status
                            dataSource.forEach(repoSkills => {
                                repoSkills.skills.forEach(skill => {
                                    const installedSkill = currentData.installedSkills.find(installed => installed.name === skill.name);
                                    skillsToShow.push({
                                        ...skill,
                                        repository: repoSkills.repository,
                                        status: installedSkill ? 'installed' : 'available',
                                        scope: installedSkill ? installedSkill.scope : undefined
                                    });
                                });
                            });
                            break;
                    }
                    
                    if (skillsToShow.length === 0) {
                        container.innerHTML = '<div class="empty-state">No skills found</div>';
                        return;
                    }
                    
                    let html = '<div class="skills-grid">';
                    skillsToShow.forEach(skill => {
                        html += renderSkillCard(skill);
                    });
                    html += '</div>';
                    
                    container.innerHTML = html;
                }

                function renderSkillCard(skill) {
                    const isInstalled = skill.status === 'installed';
                    const statusClass = isInstalled ? 'status-installed' : 'status-available';
                    const statusText = isInstalled ? 'Installed' : 'Available';
                    
                    let actions = '';
                    if (isInstalled) {
                        actions += '<button class="btn btn-small btn-secondary" onclick="updateSkill(\'' + skill.name + '\', \'' + (skill.scope || 'project') + '\')">Update</button>';
                        actions += '<button class="btn btn-small" onclick="removeSkill(\'' + skill.name + '\', \'' + (skill.scope || 'project') + '\')">Remove</button>';
                    } else {
                        const repository = skill.repository ? skill.repository.url : skill.source;
                        actions += '<button class="btn btn-small" onclick="installSkill(\'' + repository + '\', \'' + skill.name + '\')">Install</button>';
                    }
                    
                    let meta = '';
                    if (skill.repository) {
                        meta += 'From: ' + skill.repository.name;
                    }
                    if (skill.scope) {
                        meta += (meta ? ' • ' : '') + 'Scope: ' + skill.scope;
                    }
                    
                    return '<div class="skill-card">' +
                        '<div class="skill-header">' +
                            '<div class="skill-name">' + skill.name + '</div>' +
                            '<div class="skill-status ' + statusClass + '">' + statusText + '</div>' +
                        '</div>' +
                        '<div class="skill-description">' + (skill.description || 'No description available') + '</div>' +
                        (meta ? '<div class="skill-meta">' + meta + '</div>' : '') +
                        '<div class="skill-actions">' + actions + '</div>' +
                    '</div>';
                }

                function renderSearchResults(results) {
                    const container = document.getElementById('skillsContainer');
                    
                    if (results.length === 0) {
                        container.innerHTML = '<div class="empty-state">No skills found for "' + currentSearch + '"</div>';
                        return;
                    }
                    
                    let html = '<div class="skills-grid">';
                    results.forEach(skill => {
                        const isInstalled = currentData.installedSkills.some(installed => installed.name === skill.name);
                        const skillWithStatus = {
                            ...skill,
                            status: isInstalled ? 'installed' : 'available'
                        };
                        html += renderSkillCard(skillWithStatus);
                    });
                    html += '</div>';
                    
                    container.innerHTML = html;
                }

                // Initialize search on Enter key
                document.getElementById('searchInput').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        handleSearch();
                    }
                });

                // Auto-refresh on focus
                window.addEventListener('focus', handleRefresh);
            </script>
        </body>
        </html>`;
    }
}