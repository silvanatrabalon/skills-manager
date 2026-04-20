import * as vscode from 'vscode';
import { UpdateCheckService, SkillUpdateInfo } from './updateCheckService';

export class UpdateManager implements vscode.Disposable {
    private static readonly UPDATE_CHECK_KEY = 'skills.updateCheck.available';
    private static readonly LAST_CHECK_KEY = 'skills.updateCheck.lastCheck';
    private static readonly CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours
    
    private context: vscode.ExtensionContext;
    private updateCheckService: UpdateCheckService;
    private checkTimer: NodeJS.Timeout | undefined;
    private outputChannel: vscode.OutputChannel;
    private _onDidUpdateChange = new vscode.EventEmitter<string[]>();
    public readonly onDidUpdateChange = this._onDidUpdateChange.event;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Update Manager');
        this.updateCheckService = new UpdateCheckService(this.outputChannel);
    }
    
    /**
     * Initialize the update manager and start periodic checking
     */
    async initialize(): Promise<void> {
        this.outputChannel.appendLine('🕒 [UpdateManager] Initializing periodic update checking...');
        this.outputChannel.show(); // Force show the output channel
        
        // Check if it's time for an update check
        const lastCheck = this.context.globalState.get<number>(UpdateManager.LAST_CHECK_KEY, 0);
        const now = Date.now();
        const timeSinceLastCheck = now - lastCheck;
        
        this.outputChannel.appendLine(`🕒 [UpdateManager] Last check: ${new Date(lastCheck).toISOString()}`);
        this.outputChannel.appendLine(`🕒 [UpdateManager] Time since last check: ${Math.round(timeSinceLastCheck / 1000)} seconds`);
        this.outputChannel.appendLine(`🕒 [UpdateManager] Check interval: ${UpdateManager.CHECK_INTERVAL / 1000} seconds`);
        
        // If it's been more than 30 seconds, check immediately
        if (timeSinceLastCheck >= UpdateManager.CHECK_INTERVAL || lastCheck === 0) {
            this.outputChannel.appendLine('🕒 [UpdateManager] Time for immediate check...');
            // Run check in background to avoid blocking initialization
            setTimeout(() => this.checkForUpdates(), 1000);
        } else {
            this.outputChannel.appendLine('🕒 [UpdateManager] Recent check found, skipping immediate check');
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
    async forceUpdateCheck(): Promise<string[]> {
        this.outputChannel.appendLine('🕒 [UpdateManager] Force update check requested...');
        this.outputChannel.show(); // Force show the output channel
        return await this.checkForUpdates();
    }
    
    /**
     * Check for updates and store the results
     */
    private async checkForUpdates(): Promise<string[]> {
        try {
            this.outputChannel.appendLine('🔍 [UpdateManager] Starting update check...');
            this.outputChannel.show(); // Force show the output channel
            
            // Check for updates using the UpdateCheckService
            this.outputChannel.appendLine('🔍 [UpdateManager] Calling updateCheckService.checkSkillUpdates...');
            const updateInfos = await this.updateCheckService.checkSkillUpdates('both');
            this.outputChannel.appendLine(`🔍 [UpdateManager] checkSkillUpdates returned ${updateInfos.length} results`);
            
            // Log each update info for debugging
            updateInfos.forEach((info, index) => {
                this.outputChannel.appendLine(`🔍 [UpdateManager] Update info ${index + 1}: ${info.name} - hasUpdate: ${info.hasUpdate} - scope: ${info.scope}`);
                this.outputChannel.appendLine(`   Current hash: ${info.currentHash}`);
                this.outputChannel.appendLine(`   Latest hash: ${info.latestHash}`); 
                this.outputChannel.appendLine(`   Source: ${info.source}`);
            });
            
            // Extract skill names that have updates available
            const skillsWithUpdates = updateInfos
                .filter(info => info.hasUpdate)
                .map(info => info.name);
            
            this.outputChannel.appendLine(`🔍 [UpdateManager] Updates available: ${skillsWithUpdates.length} skills`);
            this.outputChannel.appendLine(`🔍 [UpdateManager] Skills: ${skillsWithUpdates.join(', ')}`);
            
            // Store results in global state
            await this.context.globalState.update(UpdateManager.UPDATE_CHECK_KEY, skillsWithUpdates);
            await this.context.globalState.update(UpdateManager.LAST_CHECK_KEY, Date.now());
            
            this.outputChannel.appendLine(`🔍 [UpdateManager] Stored ${skillsWithUpdates.length} updates in globalState`);
            
            // Fire event to notify tree provider
            this._onDidUpdateChange.fire(skillsWithUpdates);
            this.outputChannel.appendLine(`🔍 [UpdateManager] Fired onDidUpdateChange event`);
            
            // Show notification if updates are available
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
    getSkillsWithUpdatesAvailable(): string[] {
        return this.context.globalState.get<string[]>(UpdateManager.UPDATE_CHECK_KEY, []);
    }
    
    /**
     * Check if a specific skill has an update available
     */
    hasUpdateAvailable(skillName: string): boolean {
        const skillsWithUpdates = this.getSkillsWithUpdatesAvailable();
        return skillsWithUpdates.includes(skillName);
    }
    
    /**
     * Mark a skill as updated (remove from available updates list)
     */
    async markSkillAsUpdated(skillName: string): Promise<void> {
        const currentUpdates = this.getSkillsWithUpdatesAvailable();
        const updatedList = currentUpdates.filter(name => name !== skillName);
        await this.context.globalState.update(UpdateManager.UPDATE_CHECK_KEY, updatedList);
        this.outputChannel.appendLine(`✅ [UpdateManager] Marked ${skillName} as updated`);
        
        // Fire event to notify tree provider
        this._onDidUpdateChange.fire(updatedList);
    }
    
    /**
     * Clear all update notifications
     */
    async clearAllUpdates(): Promise<void> {
        await this.context.globalState.update(UpdateManager.UPDATE_CHECK_KEY, []);
        this.outputChannel.appendLine('🗑️ [UpdateManager] Cleared all update notifications');
        
        // Fire event to notify tree provider
        this._onDidUpdateChange.fire([]);
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