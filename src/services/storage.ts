import * as fs from 'fs/promises';
import * as path from 'path';

export class StorageService {
  private storagePath: string;

  constructor(storagePath: string = './storage') {
    this.storagePath = storagePath;
  }

  async initialize(): Promise<void> {
    try {
      await fs.access(this.storagePath);
    } catch {
      await fs.mkdir(this.storagePath, { recursive: true });
    }

    // Create subdirectories for organized storage
    const subdirs = ['papers', 'comments', 'temp', 'backups'];
    for (const subdir of subdirs) {
      const dirPath = path.join(this.storagePath, subdir);
      try {
        await fs.access(dirPath);
      } catch {
        await fs.mkdir(dirPath, { recursive: true });
        console.log(`📁 Created storage directory: ${subdir}`);
      }
    }
  }

  // Save research paper content
  async saveResearchPaper(eventId: string, content: string, metadata?: any): Promise<string> {
    const fileName = `${eventId}.md`;
    const filePath = path.join(this.storagePath, 'papers', fileName);
    
    // Add metadata header to the file
    let fileContent = content;
    if (metadata) {
      const metadataHeader = `---
Event ID: ${eventId}
Title: ${metadata.title || 'Untitled'}
Authors: ${metadata.authors ? metadata.authors.join(', ') : 'Unknown'}
Submitted: ${new Date().toISOString()}
Status: ${metadata.status || 'submitted'}
Size: ${Buffer.byteLength(content, 'utf8')} bytes
---

`;
      fileContent = metadataHeader + content;
    }
    
    await fs.writeFile(filePath, fileContent, 'utf8');
    console.log(`📄 Saved research paper: ${fileName}`);
    return filePath;
  }

  // Save comment content
  async saveComment(eventId: string, content: string, metadata?: any): Promise<string> {
    const fileName = `${eventId}.txt`;
    const filePath = path.join(this.storagePath, 'comments', fileName);
    
    let fileContent = content;
    if (metadata) {
      const metadataHeader = `---
Event ID: ${eventId}
Root Event: ${metadata.rootEvent || 'Unknown'}
Author: ${metadata.author || 'Unknown'}
Submitted: ${new Date().toISOString()}
Size: ${Buffer.byteLength(content, 'utf8')} bytes
---

`;
      fileContent = metadataHeader + content;
    }
    
    await fs.writeFile(filePath, fileContent, 'utf8');
    console.log(`💬 Saved comment: ${fileName}`);
    return filePath;
  }

  // Generic content save (legacy method)
  async saveContent(eventId: string, content: string): Promise<string> {
    const filePath = path.join(this.storagePath, `${eventId}.md`);
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  // Get content from any location
  async getContent(eventId: string, type?: 'paper' | 'comment'): Promise<string | null> {
    const locations = [];
    
    if (type === 'paper') {
      locations.push(path.join(this.storagePath, 'papers', `${eventId}.md`));
    } else if (type === 'comment') {
      locations.push(path.join(this.storagePath, 'comments', `${eventId}.txt`));
    } else {
      // Try all possible locations
      locations.push(
        path.join(this.storagePath, 'papers', `${eventId}.md`),
        path.join(this.storagePath, 'comments', `${eventId}.txt`),
        path.join(this.storagePath, `${eventId}.md`) // Legacy location
      );
    }

    for (const filePath of locations) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        return content;
      } catch {
        continue;
      }
    }
    
    return null;
  }

  // Delete content from appropriate location
  async deleteContent(eventId: string): Promise<boolean> {
    const locations = [
      path.join(this.storagePath, 'papers', `${eventId}.md`),
      path.join(this.storagePath, 'comments', `${eventId}.txt`),
      path.join(this.storagePath, `${eventId}.md`) // Legacy location
    ];

    let deleted = false;
    for (const filePath of locations) {
      try {
        await fs.unlink(filePath);
        console.log(`🗑️ Deleted: ${path.basename(filePath)}`);
        deleted = true;
      } catch {
        continue;
      }
    }
    
    return deleted;
  }

  // Get storage statistics
  async getStorageStats(): Promise<{ totalSizeMB: number; fileCount: number; paperCount: number; commentCount: number }> {
    try {
      const stats = {
        totalSizeMB: 0,
        fileCount: 0,
        paperCount: 0,
        commentCount: 0
      };

      // Check papers directory
      try {
        const paperFiles = await fs.readdir(path.join(this.storagePath, 'papers'));
        stats.paperCount = paperFiles.length;
        
        for (const file of paperFiles) {
          const filePath = path.join(this.storagePath, 'papers', file);
          const fileStat = await fs.stat(filePath);
          stats.totalSizeMB += fileStat.size / (1024 * 1024);
          stats.fileCount++;
        }
      } catch {}

      // Check comments directory
      try {
        const commentFiles = await fs.readdir(path.join(this.storagePath, 'comments'));
        stats.commentCount = commentFiles.length;
        
        for (const file of commentFiles) {
          const filePath = path.join(this.storagePath, 'comments', file);
          const fileStat = await fs.stat(filePath);
          stats.totalSizeMB += fileStat.size / (1024 * 1024);
          stats.fileCount++;
        }
      } catch {}

      // Check legacy files in root storage
      try {
        const rootFiles = await fs.readdir(this.storagePath);
        const legacyFiles = rootFiles.filter(file => 
          file.endsWith('.md') && !file.startsWith('.')
        );
        
        for (const file of legacyFiles) {
          const filePath = path.join(this.storagePath, file);
          const fileStat = await fs.stat(filePath);
          stats.totalSizeMB += fileStat.size / (1024 * 1024);
          stats.fileCount++;
        }
      } catch {}

      return stats;
    } catch {
      return { totalSizeMB: 0, fileCount: 0, paperCount: 0, commentCount: 0 };
    }
  }

  // List all files by type
  async listFiles(type?: 'papers' | 'comments' | 'all'): Promise<{
    papers: string[];
    comments: string[];
    legacy: string[];
  }> {
    const result = {
      papers: [] as string[],
      comments: [] as string[],
      legacy: [] as string[]
    };

    try {
      // List papers
      if (!type || type === 'papers' || type === 'all') {
        try {
          const paperFiles = await fs.readdir(path.join(this.storagePath, 'papers'));
          result.papers = paperFiles.filter(file => file.endsWith('.md'));
        } catch {}
      }

      // List comments
      if (!type || type === 'comments' || type === 'all') {
        try {
          const commentFiles = await fs.readdir(path.join(this.storagePath, 'comments'));
          result.comments = commentFiles.filter(file => file.endsWith('.txt'));
        } catch {}
      }

      // List legacy files
      if (!type || type === 'all') {
        try {
          const rootFiles = await fs.readdir(this.storagePath);
          result.legacy = rootFiles.filter(file => 
            file.endsWith('.md') && !file.startsWith('.')
          );
        } catch {}
      }
    } catch {}

    return result;
  }

  // Create backup of a file
  async createBackup(eventId: string): Promise<string | null> {
    const content = await this.getContent(eventId);
    if (!content) return null;

    const backupFileName = `${eventId}_backup_${Date.now()}.md`;
    const backupPath = path.join(this.storagePath, 'backups', backupFileName);
    
    await fs.writeFile(backupPath, content, 'utf8');
    console.log(`💾 Created backup: ${backupFileName}`);
    return backupPath;
  }

  // Clean up temporary files
  async cleanupTemp(olderThanMinutes: number = 60): Promise<number> {
    try {
      const tempDir = path.join(this.storagePath, 'temp');
      const files = await fs.readdir(tempDir);
      let deletedCount = 0;
      
      const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedCount} temporary files`);
      }
      
      return deletedCount;
    } catch {
      return 0;
    }
  }

  // Get detailed storage info for admin
  async getDetailedStorageInfo(): Promise<{
    directories: {
      papers: { count: number; sizeMB: number };
      comments: { count: number; sizeMB: number };
      legacy: { count: number; sizeMB: number };
      backups: { count: number; sizeMB: number };
      temp: { count: number; sizeMB: number };
    };
    totalSizeMB: number;
    totalFiles: number;
  }> {
    const info = {
      directories: {
        papers: { count: 0, sizeMB: 0 },
        comments: { count: 0, sizeMB: 0 },
        legacy: { count: 0, sizeMB: 0 },
        backups: { count: 0, sizeMB: 0 },
        temp: { count: 0, sizeMB: 0 }
      },
      totalSizeMB: 0,
      totalFiles: 0
    };

    const directories = ['papers', 'comments', 'backups', 'temp'];
    
    for (const dir of directories) {
      try {
        const dirPath = path.join(this.storagePath, dir);
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          const sizeMB = stats.size / (1024 * 1024);
          
          info.directories[dir as keyof typeof info.directories].count++;
          info.directories[dir as keyof typeof info.directories].sizeMB += sizeMB;
        }
      } catch {}
    }

    // Check legacy files
    try {
      const rootFiles = await fs.readdir(this.storagePath);
      const legacyFiles = rootFiles.filter(file => 
        file.endsWith('.md') && !file.startsWith('.')
      );
      
      for (const file of legacyFiles) {
        const filePath = path.join(this.storagePath, file);
        const stats = await fs.stat(filePath);
        const sizeMB = stats.size / (1024 * 1024);
        
        info.directories.legacy.count++;
        info.directories.legacy.sizeMB += sizeMB;
      }
    } catch {}

    // Calculate totals
    info.totalFiles = Object.values(info.directories).reduce((sum, dir) => sum + dir.count, 0);
    info.totalSizeMB = Object.values(info.directories).reduce((sum, dir) => sum + dir.sizeMB, 0);

    return info;
  }
}