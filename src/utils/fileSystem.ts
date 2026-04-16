import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class FileSystemUtils {
    /**
     * Check if a file exists
     */
    static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if a directory exists
     */
    static async directoryExists(dirPath: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(dirPath);
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Create a directory recursively
     */
    static async createDirectory(dirPath: string): Promise<void> {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }

    /**
     * Read a file as text
     */
    static async readTextFile(filePath: string): Promise<string> {
        return fs.promises.readFile(filePath, 'utf8');
    }

    /**
     * Write text to a file
     */
    static async writeTextFile(filePath: string, content: string): Promise<void> {
        const dir = path.dirname(filePath);
        await this.createDirectory(dir);
        await fs.promises.writeFile(filePath, content, 'utf8');
    }

    /**
     * List files in a directory
     */
    static async listFiles(dirPath: string): Promise<string[]> {
        try {
            return await fs.promises.readdir(dirPath);
        } catch {
            return [];
        }
    }

    /**
     * Find files matching a pattern recursively
     */
    static async findFiles(dirPath: string, pattern: RegExp): Promise<string[]> {
        const result: string[] = [];
        
        try {
            const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const item of items) {
                const fullPath = path.join(dirPath, item.name);
                
                if (item.isDirectory()) {
                    const subFiles = await this.findFiles(fullPath, pattern);
                    result.push(...subFiles);
                } else if (pattern.test(item.name)) {
                    result.push(fullPath);
                }
            }
        } catch {
            // Directory doesn't exist or can't be read
        }
        
        return result;
    }

    /**
     * Get the workspace root path
     */
    static getWorkspaceRoot(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /**
     * Get a path relative to the workspace root
     */
    static getWorkspaceRelativePath(absolutePath: string): string {
        const workspaceRoot = this.getWorkspaceRoot();
        if (workspaceRoot && absolutePath.startsWith(workspaceRoot)) {
            return path.relative(workspaceRoot, absolutePath);
        }
        return absolutePath;
    }

    /**
     * Normalize path separators for cross-platform compatibility
     */
    static normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/');
    }

    /**
     * Join paths safely
     */
    static joinPath(...paths: string[]): string {
        return this.normalizePath(path.join(...paths));
    }

    /**
     * Get file extension
     */
    static getFileExtension(filePath: string): string {
        return path.extname(filePath).toLowerCase();
    }

    /**
     * Get filename without extension
     */
    static getFileNameWithoutExtension(filePath: string): string {
        return path.basename(filePath, path.extname(filePath));
    }

    /**
     * Check if a path is absolute
     */
    static isAbsolutePath(filePath: string): boolean {
        return path.isAbsolute(filePath);
    }
}