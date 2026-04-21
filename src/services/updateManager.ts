import * as vscode from 'vscode';
import { UpdateCheckService, SkillUpdateInfo } from './updateCheckService';

export interface SkillUpdateEntry {
    name: string;
    scope: 'global' | 'project';
}

export class UpdateManager implements vscode.Disposable {
    private static readonly UPDATE_CHECK_KEY = 'skills.updateCheck.available';
    private static readonly LAST_CHECK_KEY = 'skills.updateCheck.lastCheck';
    private static readonly CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
    
    private context: vscode.ExtensionContext;
    private updateCheckService: UpdateCheckService;
    private checkTimer: NodeJS.Timeout | undefined;
    private outputChannel: vscode.OutputChannel;
    private _onDidUpdateChange = new vscode.EventEmitter<SkillUpdateEntry[]>();
    public readonly onDidUpdateChange = this._onDidUpdateChange.event;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Update Manager');
        this.updateCheckService = new UpdateCheckService(this.outputChannel);
    }
    
    /**
     * Get the underlying UpdateCheckService for post-install/update enrichment
     */
    getUpdateCheckService(): UpdateCheckService {
        return this.updateCheckService;
    }
    
    /**
     * Initialize the update manager and start periodic checking
     */
    async initialize(): Promise<void> {
        this.outputChannel.appendLine('🕒 [UpdateManager] Initializing periodic update checking...');
        this.outputChannel.show(); // Force show the output channel
        
        // Clear any stale update state from previous sessions
        await this.clearAllUpdates();
        this.outputChannel.appendLine('🕒 [UpdateManager] Cleared stale update state from previous session');
        
        // Check if it's time for an update check
        const lastCheck = this.context.globalState.get<number>(UpdateManager.LAST_CHECK_KEY, 0);
        const now = Date.now();
        const timeSinceLastCheck = now - lastCheck;
        
        this.outputChannel.appendLine(`🕒 [UpdateManager] Last check: ${new Date(lastCheck).toISOString()}`);
        this.outputChannel.appendLine(`🕒 [UpdateManager] Time since last check: ${Math.round(timeSinceLastCheck / 1000)} seconds`);
        this.outputChannel.appendLine(`🕒 [UpdateManager] Check interval: ${UpdateManager.CHECK_INTERVAL / 1000} seconds`);
        
        // Run check if interval has elapsed
        if (timeSinceLastCheck >= UpdateManager.CHECK_INTERVAL || lastCheck === 0) {
            this.outputChannel.appendLine('🕒 [UpdateManager] Time for immediate check...');
            setTimeout(() => this.checkForUpdates(), 3000);
        } else {
            this.outputChannel.appendLine('🕒 [UpdateManager] Recent check exists, skipping startup check');
        }
        
        // Set up periodic timer
        this.startPeriodicChecking();
        this.outputChannel.appendLine('🕒 [UpdateManager] Automatic periodic checking activated!');
        this.outputChannel.appendLine('🕒 [UpdateManager] Initialization complete');
    }
    
    /**
     * Start the periodic checking timer
     */
    private startPeriodicChecking(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        
        this.checkTimer = setInterval(async () => {
            this.outputChannel.appendLine('🕒 [UpdateManager] ⏰ Periodic check triggered automatically...');
            this.outputChannel.show(); // Force show when periodic check triggers
            await this.checkForUpdates();
        }, UpdateManager.CHECK_INTERVAL);
        
        this.outputChannel.appendLine(`🕒 [UpdateManager] Periodic checking started (every ${UpdateManager.CHECK_INTERVAL / 1000} seconds)`);
        this.outputChannel.appendLine(`🕒 [UpdateManager] Timer ID: ${this.checkTimer}`);
    }
    
    /**
     * Force an immediate update check
     */
    async forceUpdateCheck(): Promise<SkillUpdateEntry[]> {
        this.outputChannel.appendLine('🕒 [UpdateManager] Force update check requested...');
        this.outputChannel.show(); // Force show the output channel
        return await this.checkForUpdates();
    }
    
    /**
     * Check for updates and store the results
     */
    private async checkForUpdates(): Promise<SkillUpdateEntry[]> {
        try {
            this.outputChannel.appendLine('🔍 [UpdateManager] Starting update check...');
            this.outputChannel.show();
            
            this.outputChannel.appendLine('🔍 [UpdateManager] Calling updateCheckService.checkSkillUpdates...');
            const updateInfos = await this.updateCheckService.checkSkillUpdates('both');
            this.outputChannel.appendLine(`🔍 [UpdateManager] checkSkillUpdates returned ${updateInfos.length} results`);
            
            updateInfos.forEach((info, index) => {
                this.outputChannel.appendLine(`🔍 [UpdateManager] Update info ${index + 1}: ${info.name} - hasUpdate: ${info.hasUpdate} - scope: ${info.scope}`);
                this.outputChannel.appendLine(`   Current hash: ${info.currentHash}`);
                this.outputChannel.appendLine(`   Latest hash: ${info.latestHash}`);
                this.outputChannel.appendLine(`   Source: ${info.source}`);
            });
            
            // Extract entries with scope info
            const skillsWithUpdates: SkillUpdateEntry[] = updateInfos
                .filter(info => info.hasUpdate)
                .map(info => ({ name: info.name, scope: info.scope }));
            
            this.outputChannel.appendLine(`🔍 [UpdateManager] Updates available: ${skillsWithUpdates.length} skills`);
            this.outputChannel.appendLine(`🔍 [UpdateManager] Skills: ${skillsWithUpdates.map(s => `${s.name}(${s.scope})`).join(', ')}`);
            
            await this.context.globalState.update(UpdateManager.UPDATE_CHECK_KEY, skillsWithUpdates);
            await this.context.globalState.update(UpdateManager.LAST_CHECK_KEY, Date.now());
            
            this.outputChannel.appendLine(`🔍 [UpdateManager] Stored ${skillsWithUpdates.length} updates in globalState`);
            
            this._onDidUpdateChange.fire(skillsWithUpdates);
            this.outputChannel.appendLine(`🔍 [UpdateManager] Fired onDidUpdateChange event`);
            
            if (skillsWithUpdates.length > 0) {
                this.outputChannel.appendLine(`🔍 [UpdateManager] Showing notification for ${skillsWithUpdates.length} updates`);
                const action = await vscode.window.showInformationMessage(
                    `${skillsWithUpdates.length} skill update(s) available!`,
                    'View Updates', 'Later'
                );
                
                if (action === 'View Updates') {
                    await vscode.commands.executeCommand('skills.refresh');
                }
            } else {
                this.outputChannel.appendLine('🔍 [UpdateManager] No updates found - all skills are up-to-date');
            }
            
            this.outputChannel.appendLine(`🔍 [UpdateManager] Update check complete`);
            return skillsWithUpdates;
            
        } catch (error) {
            this.outputChannel.appendLine(`❌ [UpdateManager] Error during update check: ${error}`);
            this.outputChannel.show();
            return [];
        }
    }
    
    /**
     * Get list of skills that have updates available
     */
    getSkillsWithUpdatesAvailable(): SkillUpdateEntry[] {
        return this.context.globalState.get<SkillUpdateEntry[]>(UpdateManager.UPDATE_CHECK_KEY, []);
    }
    
    /**
     * Check if a specific skill has an update available (scope-aware)
     */
    hasUpdateAvailable(skillName: string, scope?: 'global' | 'project'): boolean {
        const skillsWithUpdates = this.getSkillsWithUpdatesAvailable();
        if (scope) {
            return skillsWithUpdates.some(s => s.name === skillName && s.scope === scope);
        }
        return skillsWithUpdates.some(s => s.name === skillName);
    }
    
    /**
     * Mark a skill as updated in a specific scope
     */
    async markSkillAsUpdated(skillName: string, scope?: 'global' | 'project'): Promise<void> {
        const currentUpdates = this.getSkillsWithUpdatesAvailable();
        const updatedList = scope
            ? currentUpdates.filter(s => !(s.name === skillName && s.scope === scope))
            : currentUpdates.filter(s => s.name !== skillName);
        await this.context.globalState.update(UpdateManager.UPDATE_CHECK_KEY, updatedList);
        this.outputChannel.appendLine(`✅ [UpdateManager] Marked ${skillName} (${scope || 'all'}) as updated`);
        
        this._onDidUpdateChange.fire(updatedList);
    }
    
    /**
     * Clear all update notifications
     */
    async clearAllUpdates(): Promise<void> {
        const currentUpdates = this.getSkillsWithUpdatesAvailable();
        await this.context.globalState.update(UpdateManager.UPDATE_CHECK_KEY, []);
        this.outputChannel.appendLine(`🗑️ [UpdateManager] Cleared ${currentUpdates.length} update notifications`);
        
        this._onDidUpdateChange.fire([]);
    }
    
    /**
     * Debug method to show current state
     */
    getDebugState(): { availableUpdates: SkillUpdateEntry[], lastCheck: number } {
        return {
            availableUpdates: this.getSkillsWithUpdatesAvailable(),
            lastCheck: this.context.globalState.get<number>(UpdateManager.LAST_CHECK_KEY, 0)
        };
    }
    
    /**
     * Get the last check timestamp
     */
    getLastCheckTime(): number {
        return this.context.globalState.get<number>(UpdateManager.LAST_CHECK_KEY, 0);
    }
    
    /**
     * Get time until next automatic check (in milliseconds)
     */
    getTimeUntilNextCheck(): number {
        const lastCheck = this.getLastCheckTime();
        const nextCheck = lastCheck + UpdateManager.CHECK_INTERVAL;
        const now = Date.now();
        return Math.max(0, nextCheck - now);
    }
    
    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        this._onDidUpdateChange.dispose();
        this.outputChannel.appendLine('🕒 [UpdateManager] Disposed');
    }
}