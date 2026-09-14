import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface StorageProvider {
  uploadFile(fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string>;
  getFileUrl(fileKey: string): string;
  deleteFile(fileKey: string): Promise<void>;
}

// Local mock storage for Phase 1
export class LocalStorageProvider implements StorageProvider {
  private readonly uploadDir = path.join(process.cwd(), "public", "uploads");

  constructor() {
    this.ensureUploadDirExists();
  }

  private async ensureUploadDirExists() {
    try {
      await fs.access(this.uploadDir);
    } catch {
      await fs.mkdir(this.uploadDir, { recursive: true });
    }
  }

  async uploadFile(fileBuffer: Buffer, originalFilename: string, mimeType: string): Promise<string> {
    await this.ensureUploadDirExists();
    const ext = path.extname(originalFilename) || this.getExtensionFromMime(mimeType);
    const fileKey = `${crypto.randomUUID()}${ext}`;
    const filePath = path.join(this.uploadDir, fileKey);
    
    await fs.writeFile(filePath, fileBuffer);
    
    // Return relative URL that Express/Vite can serve
    return `/uploads/${fileKey}`;
  }

  getFileUrl(fileKey: string): string {
    return fileKey; // in local, the fileKey is already the relative path
  }

  async deleteFile(fileKey: string): Promise<void> {
    try {
      const fileName = fileKey.replace("/uploads/", "");
      const filePath = path.join(this.uploadDir, fileName);
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Failed to delete file: ${fileKey}`, error);
    }
  }

  private getExtensionFromMime(mimeType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "application/pdf": ".pdf",
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav"
    };
    return map[mimeType] || "";
  }
}

export const storage = new LocalStorageProvider();
