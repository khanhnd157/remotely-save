import type { Entity } from "../../src/baseTypes";
import { FakeFs } from "../../src/fsAll";
import type { FilenConfig } from "./baseTypesPro";

export const DEFAULT_FILEN_CONFIG: FilenConfig = {
  authType: "email",
  email: "",
  password: "",
  apiKey: "",
  remoteBaseDir: "",
  kind: "filen",
};

export class FakeFsFilen extends FakeFs {
  kind: string;
  filenConfig: FilenConfig;
  remoteBaseDir: string;
  vaultName: string;
  saveUpdatedConfigFunc: () => Promise<any>;
  filenSdk: any;
  loggedIn: boolean;

  constructor(
    filenConfig: FilenConfig,
    vaultName: string,
    saveUpdatedConfigFunc: () => Promise<any>
  ) {
    super();
    this.kind = "filen";
    this.filenConfig = filenConfig;
    this.remoteBaseDir = this.filenConfig.remoteBaseDir || vaultName || "";
    this.vaultName = vaultName;
    this.saveUpdatedConfigFunc = saveUpdatedConfigFunc;
    this.filenSdk = null;
    this.loggedIn = false;
  }

  private _getBasePath(): string {
    return `/${this.remoteBaseDir}`;
  }

  private _getFilenPath(key: string): string {
    const base = this._getBasePath();
    if (key === "" || key === "/") {
      return base;
    }
    // key may or may not start with /
    const cleanKey = key.startsWith("/") ? key : `/${key}`;
    return `${base}${cleanKey}`;
  }

  private _stripBasePath(fullPath: string): string {
    const base = this._getBasePath();
    if (fullPath.startsWith(base)) {
      let result = fullPath.slice(base.length);
      if (result.startsWith("/")) {
        result = result.slice(1);
      }
      return result;
    }
    return fullPath;
  }

  private async _ensureLogin(): Promise<void> {
    if (this.loggedIn && this.filenSdk) {
      return;
    }

    const { FilenSDK } = await import("@filen/sdk");

    if (this.filenConfig.authType === "apikey" && this.filenConfig.apiKey) {
      this.filenSdk = new FilenSDK({
        apiKey: this.filenConfig.apiKey,
        connectToSocket: false,
        metadataCache: true,
      });
    } else {
      this.filenSdk = new FilenSDK({
        connectToSocket: false,
        metadataCache: true,
      });
      await this.filenSdk.login({
        email: this.filenConfig.email,
        password: this.filenConfig.password,
      });
    }

    this.loggedIn = true;
  }

  private async _ensureBaseDir(): Promise<void> {
    await this._ensureLogin();
    const basePath = this._getBasePath();
    try {
      await this.filenSdk.fs().stat({ path: basePath });
    } catch {
      await this.filenSdk.fs().mkdir({ path: basePath });
    }
  }

  async walk(): Promise<Entity[]> {
    await this._ensureBaseDir();

    const basePath = this._getBasePath();
    const entries: Entity[] = [];

    let items: string[];
    try {
      items = await this.filenSdk.fs().readdir({ path: basePath, recursive: true });
    } catch {
      return entries;
    }

    for (const name of items) {
      const fullPath = `${basePath}/${name}`;
      try {
        const stats = await this.filenSdk.fs().stat({ path: fullPath });
        const keyRaw = stats.isDirectory() ? `${name}/` : name;
        entries.push({
          keyRaw: keyRaw,
          key: keyRaw,
          mtimeCli: stats.mtimeMs,
          mtimeSvr: stats.mtimeMs,
          size: stats.size,
          sizeRaw: stats.size,
        });
      } catch {
        // skip items we can't stat
      }
    }

    return entries;
  }

  async walkPartial(): Promise<Entity[]> {
    await this._ensureBaseDir();

    const basePath = this._getBasePath();
    const entries: Entity[] = [];

    let items: string[];
    try {
      items = await this.filenSdk.fs().readdir({ path: basePath, recursive: false });
    } catch {
      return entries;
    }

    for (const name of items) {
      const fullPath = `${basePath}/${name}`;
      try {
        const stats = await this.filenSdk.fs().stat({ path: fullPath });
        const keyRaw = stats.isDirectory() ? `${name}/` : name;
        entries.push({
          keyRaw: keyRaw,
          key: keyRaw,
          mtimeCli: stats.mtimeMs,
          mtimeSvr: stats.mtimeMs,
          size: stats.size,
          sizeRaw: stats.size,
        });
      } catch {
        // skip items we can't stat
      }
    }

    return entries;
  }

  async stat(key: string): Promise<Entity> {
    await this._ensureLogin();

    const fullPath = this._getFilenPath(key);
    const stats = await this.filenSdk.fs().stat({ path: fullPath });
    const isDir = stats.isDirectory();
    const keyRaw = isDir && !key.endsWith("/") ? `${key}/` : key;

    return {
      keyRaw: keyRaw,
      key: keyRaw,
      mtimeCli: stats.mtimeMs,
      mtimeSvr: stats.mtimeMs,
      size: stats.size,
      sizeRaw: stats.size,
    };
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    await this._ensureBaseDir();

    const cleanKey = key.endsWith("/") ? key.slice(0, -1) : key;
    const fullPath = this._getFilenPath(cleanKey);
    await this.filenSdk.fs().mkdir({ path: fullPath });

    return {
      keyRaw: key,
      key: key,
      mtimeCli: mtime ?? Date.now(),
      mtimeSvr: mtime ?? Date.now(),
      size: 0,
      sizeRaw: 0,
    };
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    await this._ensureBaseDir();

    const fullPath = this._getFilenPath(key);
    const buf = Buffer.from(content);
    await this.filenSdk.fs().writeFile({ path: fullPath, content: buf });

    return {
      keyRaw: key,
      key: key,
      mtimeCli: mtime,
      mtimeSvr: mtime,
      size: content.byteLength,
      sizeRaw: content.byteLength,
    };
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    await this._ensureLogin();

    const fullPath = this._getFilenPath(key);
    const buf: Buffer = await this.filenSdk.fs().readFile({ path: fullPath });
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  async rename(key1: string, key2: string): Promise<void> {
    await this._ensureLogin();

    const from = this._getFilenPath(key1);
    const to = this._getFilenPath(key2);
    await this.filenSdk.fs().rename({ from, to });
  }

  async rm(key: string): Promise<void> {
    await this._ensureLogin();

    const cleanKey = key.endsWith("/") ? key.slice(0, -1) : key;
    const fullPath = this._getFilenPath(cleanKey);
    await this.filenSdk.fs().rm({ path: fullPath });
  }

  async checkConnect(callbackFunc?: any): Promise<boolean> {
    try {
      await this._ensureBaseDir();
    } catch (err) {
      console.debug(err);
      callbackFunc?.(err);
      return false;
    }
    return await this.checkConnectCommonOps(callbackFunc);
  }

  async getUserDisplayName(): Promise<string> {
    return this.filenConfig.email || "Filen User";
  }

  async revokeAuth(): Promise<any> {
    this.filenSdk = null;
    this.loggedIn = false;
  }

  allowEmptyFile(): boolean {
    return true;
  }
}
