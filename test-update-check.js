const fs = require('fs');
const https = require('https');
const path = require('path');

// Simulamos las clases necesarias
class UpdateCheckService {
    async checkSkillUpdates(scope = 'both') {
        console.log(`🔍 [UpdateCheckService] Starting skill updates check for scope: ${scope}`);
        const results = [];
        
        if (scope === 'project' || scope === 'both') {
            try {
                console.log(`🔍 [UpdateCheckService] Checking project skills...`);
                const projectUpdates = await this.checkProjectSkillUpdates();
                console.log(`🔍 [UpdateCheckService] Found ${projectUpdates.length} project skills`);
                results.push(...projectUpdates);
            } catch (error) {
                console.error('Error checking project skills:', error);
            }
        }
        
        console.log(`🔍 [UpdateCheckService] Total results: ${results.length} skills checked`);
        console.log(`🔍 [UpdateCheckService] Skills with updates: ${results.filter(r => r.hasUpdate).length}`);
        
        // Log detailed results for debugging
        results.forEach((result, index) => {
            console.log(`🔍 [UpdateCheckService] Result ${index + 1}: ${result.name} (${result.scope}) - Update: ${result.hasUpdate}`);
            if (result.hasUpdate) {
                console.log(`   Current: ${result.currentHash}`);
                console.log(`   Latest: ${result.latestHash}`);
            } else {
                console.log(`   Hash: ${result.currentHash} (no change)`);
            }
        });
        
        return results;
    }
    
    async checkProjectSkillUpdates() {
        const projectLockPath = path.join(process.cwd(), 'skills-lock.json');
        console.log(`🔍 [UpdateCheckService] Checking project lock file: ${projectLockPath}`);
        
        if (!fs.existsSync(projectLockPath)) {
            console.log(`🔍 [UpdateCheckService] Project lock file does not exist: ${projectLockPath}`);
            return [];
        }
        
        console.log(`🔍 [UpdateCheckService] Reading project lock file...`);
        const lockContent = JSON.parse(fs.readFileSync(projectLockPath, 'utf8'));
        console.log(`🔍 [UpdateCheckService] Project lock file version: ${lockContent.version}`);
        console.log(`🔍 [UpdateCheckService] Project lock file skills: ${Object.keys(lockContent.skills || {}).length}`);
        
        // Log the structure of each skill for debugging
        Object.entries(lockContent.skills || {}).forEach(([name, skill]) => {
            console.log(`🔍 [UpdateCheckService] Project skill ${name}:`, {
                hasSource: !!skill.source,
                hasSourceType: !!skill.sourceType,
                hasSkillFolderHash: !!skill.skillFolderHash,
                hasSkillPath: !!skill.skillPath,
                hasComputedHash: !!skill.computedHash,
                version: lockContent.version
            });
        });
        
        const skills = await this.checkSkillsFromLock(lockContent.skills || {}, 'project');
        return skills;
    }
    
    async checkSkillsFromLock(skills, scope) {
        console.log(`🔍 [UpdateCheckService] checkSkillsFromLock() - processing ${scope} skills`);
        console.log(`🔍 [UpdateCheckService] Skills to process: ${Object.keys(skills).join(', ')}`);
        
        const results = [];
        
        for (const [skillName, entry] of Object.entries(skills)) {
            console.log(`🔍 [UpdateCheckService] Processing skill: ${skillName}`);
            console.log(`🔍 [UpdateCheckService] Skill data:`, { 
                hasSkillFolderHash: !!entry.skillFolderHash, 
                hasComputedHash: !!entry.computedHash,
                hasPath: !!entry.skillPath, 
                sourceType: entry.sourceType,
                source: entry.source 
            });
            
            // Check if this is a GitHub-based skill
            const isGitHubSkill = this.isGitHubSkill(entry);
            if (!isGitHubSkill) {
                console.log(`🔍 [UpdateCheckService] Skipping ${skillName}: not a GitHub skill`);
                continue;
            }
            
            // Get the hash to compare
            const currentHash = entry.skillFolderHash || entry.computedHash;
            if (!currentHash) {
                console.log(`🔍 [UpdateCheckService] Skipping ${skillName}: no hash available`);
                continue;
            }
            
            try {
                console.log(`🔍 [UpdateCheckService] Fetching latest hash for ${skillName}...`);
                
                // For skills with skillPath, use the folder hash approach
                // For skills without skillPath, use the full repo hash approach
                let latestHash;
                if (entry.skillPath) {
                    console.log(`🔍 [UpdateCheckService] Using folder hash method for ${skillName}`);
                    latestHash = await this.fetchSkillFolderHash(
                        this.normalizeGitHubUrl(entry.source),
                        entry.skillPath,
                        null,
                        entry.ref
                    );
                } else {
                    console.log(`🔍 [UpdateCheckService] Using commit hash method for ${skillName}`);
                    latestHash = await this.fetchRepoCommitHash(
                        this.normalizeGitHubUrl(entry.source),
                        null,
                        entry.ref
                    );
                }
                
                const hasUpdate = !!(latestHash && latestHash !== currentHash);
                
                console.log(`🔍 [UpdateCheckService] ${skillName} check result:`, {
                    currentHash,
                    latestHash,
                    hasUpdate,
                    method: entry.skillPath ? 'folder' : 'commit'
                });
                
                results.push({
                    name: skillName,
                    currentHash,
                    latestHash: latestHash || currentHash,
                    source: entry.source,
                    hasUpdate,
                    scope,
                    skillPath: entry.skillPath,
                    ref: entry.ref
                });
                
                if (hasUpdate) {
                    console.log(`🔍 [UpdateCheckService] Update available for ${skillName}: ${currentHash} -> ${latestHash}`);
                }
                
            } catch (error) {
                console.error(`🔍 [UpdateCheckService] Error checking ${skillName}:`, error);
                results.push({
                    name: skillName,
                    currentHash,
                    latestHash: currentHash,
                    source: entry.source,
                    hasUpdate: false,
                    scope,
                    skillPath: entry.skillPath,
                    ref: entry.ref
                });
            }
        }
        
        console.log(`🔍 [UpdateCheckService] ${scope} check completed: ${results.length} skills checked, ${results.filter(r => r.hasUpdate).length} with updates`);
        return results;
    }
    
    isGitHubSkill(entry) {
        if (!entry.source) return false;
        
        if (entry.sourceType === 'github') return true;
        
        if (entry.sourceType === 'git') {
            const source = entry.source.toLowerCase();
            return source.includes('github.com') || source.startsWith('git@github.com');
        }
        
        return false;
    }
    
    normalizeGitHubUrl(source) {
        console.log(`🔍 [UpdateCheckService] Normalizing GitHub URL: ${source}`);
        
        // Handle SSH URLs: git@github.com:owner/repo.git
        if (source.startsWith('git@github.com:')) {
            const normalized = source
                .replace('git@github.com:', '')
                .replace('.git', '');
            console.log(`🔍 [UpdateCheckService] Normalized SSH URL to: ${normalized}`);
            return normalized;
        }
        
        // Handle HTTPS URLs: https://github.com/owner/repo
        if (source.includes('github.com')) {
            const match = source.match(/github\.com[/:]([^/]+\/[^/]+)/);
            if (match) {
                const normalized = match[1].replace('.git', '');
                console.log(`🔍 [UpdateCheckService] Normalized HTTPS URL to: ${normalized}`);
                return normalized;
            }
        }
        
        console.log(`🔍 [UpdateCheckService] URL already normalized: ${source}`);
        return source;
    }
    
    async fetchRepoCommitHash(ownerRepo, token, ref = 'main') {
        return new Promise((resolve, reject) => {
            const url = `https://api.github.com/repos/${ownerRepo}/commits/${ref}`;
            
            console.log(`🔍 [UpdateCheckService] Fetching repo commit hash: ${url}`);
            
            const options = {
                headers: {
                    'User-Agent': 'VSCode-Skills-Extension',
                    ...(token && { 'Authorization': `token ${token}` })
                }
            };
            
            const req = https.get(url, options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        console.log(`🔍 [UpdateCheckService] GitHub API response status: ${res.statusCode}`);
                        
                        if (res.statusCode !== 200) {
                            console.log(`🔍 [UpdateCheckService] GitHub API responded with ${res.statusCode}:`);
                            console.log(data.substring(0, 500)); // Show first 500 chars of error
                            
                            if (ref === 'main') {
                                console.log(`🔍 [UpdateCheckService] Trying master branch fallback`);
                                this.fetchRepoCommitHash(ownerRepo, token, 'master').then(resolve).catch(reject);
                                return;
                            }
                            resolve(null);
                            return;
                        }
                        
                        const commit = JSON.parse(data);
                        const commitSha = commit.sha;
                        console.log(`🔍 [UpdateCheckService] Latest commit SHA: ${commitSha}`);
                        resolve(commitSha);
                        
                    } catch (error) {
                        console.error(`🔍 [UpdateCheckService] Error parsing commit response:`, error);
                        reject(error);
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error(`🔍 [UpdateCheckService] Request error:`, error);
                reject(error);
            });
            
            req.setTimeout(10000);
        });
    }
}

// Ejecutar la prueba
async function testUpdateCheck() {
    console.log('🧪 Starting Update Check Test\n');
    
    const updateService = new UpdateCheckService();
    
    try {
        const results = await updateService.checkSkillUpdates('project');
        console.log('\n✅ Test completed successfully');
        console.log(`Found ${results.length} skills, ${results.filter(r => r.hasUpdate).length} with updates`);
        
        if (results.length > 0) {
            console.log('\nSkill details:');
            results.forEach(skill => {
                console.log(`- ${skill.name}: ${skill.hasUpdate ? '🟡 Update available' : '✅ Up to date'}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testUpdateCheck();