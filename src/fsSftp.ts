import cloneDeep from "lodash/cloneDeep";
import type { Entity, SftpConfig } from "./baseTypes";
import { FakeFs } from "./fsAll";

export const DEFAULT_SFTP_CONFIG: SftpConfig = {
  protocol: "sftp",
  host: "",
  port: "22",
  username: "",
  password: "",
  remoteBaseDir: "",
};

const getSftpPath = (fileOrFolderPath: string, remoteBaseDir: string) => {
  let key = fileOrFolderPath;
  if (fileOrFolderPath === "/" || fileOrFolderPath === "") {
    key = `/${remoteBaseDir}/`;
  } else if (fileOrFolderPath.startsWith("/")) {
    key = `/${remoteBaseDir}${fileOrFolderPath}`;
  } else {
    key = `/${remoteBaseDir}/${fileOrFolderPath}`;
  }
  return key;
};

const getNormPath = (fileOrFolderPath: string, remoteBaseDir: string) => {
  if (
    !(
      fileOrFolderPath === `/${remoteBaseDir}` ||
      fileOrFolderPath.startsWith(`/${remoteBaseDir}/`)
    )
  ) {
    throw Error(
      `"${fileOrFolderPath}" doesn't start with "/${remoteBaseDir}/"`
    );
  }
  return fileOrFolderPath.slice(`/${remoteBaseDir}/`.length);
};

export class FakeFsSftp extends FakeFs {
  kind: "sftp";
  sftpConfig: SftpConfig;
  remoteBaseDir: string;
  saveUpdatedConfigFunc: () => Promise<any>;

  private _sftpClient: any | undefined;
  private _ftpClient: any | undefined;

  constructor(
    sftpConfig: SftpConfig,
    vaultName: string,
    saveUpdatedConfigFunc: () => Promise<any>
  ) {
    super();
    this.kind = "sftp";
    this.sftpConfig = cloneDeep(sftpConfig);
    this.remoteBaseDir = this.sftpConfig.remoteBaseDir || vaultName || "";
    this.saveUpdatedConfigFunc = saveUpdatedConfigFunc;
  }

  private async _ensureConnectedSftp(): Promise<any> {
    if (this._sftpClient !== undefined) {
      return this._sftpClient;
    }
    // Use window.require to bypass webpack bundling - works in Electron
    const SftpClient = (window as any).require("ssh2-sftp-client");
    const client = new SftpClient();
    await client.connect({
      host: this.sftpConfig.host,
      port: parseInt(this.sftpConfig.port) || 22,
      username: this.sftpConfig.username,
      password: this.sftpConfig.password,
    });
    this._sftpClient = client;
    return client;
  }

  private async _ensureConnectedFtp(): Promise<any> {
    if (this._ftpClient !== undefined) {
      return this._ftpClient;
    }
    const basicFtp = (window as any).require("basic-ftp");
    const client = new basicFtp.Client();
    client.ftp.verbose = false;
    await client.access({
      host: this.sftpConfig.host,
      port: parseInt(this.sftpConfig.port) || 21,
      user: this.sftpConfig.username,
      password: this.sftpConfig.password,
      secure: this.sftpConfig.protocol === "ftps",
    });
    this._ftpClient = client;
    return client;
  }

  private _isSftp(): boolean {
    return this.sftpConfig.protocol === "sftp";
  }

  private async _ensureRemoteBaseDir(): Promise<void> {
    const remotePath = `/${this.remoteBaseDir}`;
    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      try {
        await client.stat(remotePath);
      } catch {
        await client.mkdir(remotePath, true);
      }
    } else {
      const client = await this._ensureConnectedFtp();
      await client.ensureDir(remotePath);
      await client.cd("/");
    }
  }

  async walk(): Promise<Entity[]> {
    await this._ensureRemoteBaseDir();
    const result: Entity[] = [];
    const remotePath = `/${this.remoteBaseDir}`;

    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      const walkRecursive = async (dir: string) => {
        const list = await client.list(dir);
        for (const item of list) {
          const fullPath = `${dir}/${item.name}`;
          if (item.type === "d") {
            const key = getNormPath(fullPath, this.remoteBaseDir);
            result.push({
              key: `${key}/`,
              keyRaw: `${key}/`,
              mtimeSvr: item.modifyTime,
              mtimeCli: item.modifyTime,
              size: 0,
              sizeRaw: 0,
              synthesizedFolder: true,
            });
            await walkRecursive(fullPath);
          } else if (item.type === "-") {
            const key = getNormPath(fullPath, this.remoteBaseDir);
            result.push({
              key: key,
              keyRaw: key,
              mtimeSvr: item.modifyTime,
              mtimeCli: item.modifyTime,
              size: item.size,
              sizeRaw: item.size,
            });
          }
        }
      };
      await walkRecursive(remotePath);
    } else {
      const client = await this._ensureConnectedFtp();
      const walkRecursive = async (dir: string) => {
        const list = await client.list(dir);
        for (const item of list) {
          const fullPath =
            dir === "/" ? `/${item.name}` : `${dir}/${item.name}`;
          if (item.type === 2) {
            // directory
            const key = getNormPath(fullPath, this.remoteBaseDir);
            result.push({
              key: `${key}/`,
              keyRaw: `${key}/`,
              mtimeSvr: item.modifiedAt?.valueOf(),
              mtimeCli: item.modifiedAt?.valueOf(),
              size: 0,
              sizeRaw: 0,
              synthesizedFolder: true,
            });
            await walkRecursive(fullPath);
          } else if (item.type === 1) {
            // file
            const key = getNormPath(fullPath, this.remoteBaseDir);
            result.push({
              key: key,
              keyRaw: key,
              mtimeSvr: item.modifiedAt?.valueOf(),
              mtimeCli: item.modifiedAt?.valueOf(),
              size: item.size,
              sizeRaw: item.size,
            });
          }
        }
      };
      await walkRecursive(remotePath);
    }

    return result;
  }

  async walkPartial(): Promise<Entity[]> {
    await this._ensureRemoteBaseDir();
    const remotePath = `/${this.remoteBaseDir}`;
    const result: Entity[] = [];

    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      const list = await client.list(remotePath);
      for (const item of list.slice(0, 10)) {
        const fullPath = `${remotePath}/${item.name}`;
        const key = getNormPath(fullPath, this.remoteBaseDir);
        if (item.type === "d") {
          result.push({
            key: `${key}/`,
            keyRaw: `${key}/`,
            mtimeSvr: item.modifyTime,
            mtimeCli: item.modifyTime,
            size: 0,
            sizeRaw: 0,
            synthesizedFolder: true,
          });
        } else {
          result.push({
            key: key,
            keyRaw: key,
            mtimeSvr: item.modifyTime,
            mtimeCli: item.modifyTime,
            size: item.size,
            sizeRaw: item.size,
          });
        }
      }
    } else {
      const client = await this._ensureConnectedFtp();
      const list = await client.list(remotePath);
      for (const item of list.slice(0, 10)) {
        const fullPath = `${remotePath}/${item.name}`;
        const key = getNormPath(fullPath, this.remoteBaseDir);
        if (item.type === 2) {
          result.push({
            key: `${key}/`,
            keyRaw: `${key}/`,
            mtimeSvr: item.modifiedAt?.valueOf(),
            mtimeCli: item.modifiedAt?.valueOf(),
            size: 0,
            sizeRaw: 0,
            synthesizedFolder: true,
          });
        } else {
          result.push({
            key: key,
            keyRaw: key,
            mtimeSvr: item.modifiedAt?.valueOf(),
            mtimeCli: item.modifiedAt?.valueOf(),
            size: item.size,
            sizeRaw: item.size,
          });
        }
      }
    }

    return result;
  }

  async stat(key: string): Promise<Entity> {
    const remotePath = getSftpPath(key, this.remoteBaseDir);
    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      const info = await client.stat(remotePath);
      const isDir = info.isDirectory;
      const normKey = isDir && !key.endsWith("/") ? `${key}/` : key;
      return {
        key: normKey,
        keyRaw: normKey,
        mtimeSvr: info.modifyTime,
        mtimeCli: info.modifyTime,
        size: isDir ? 0 : info.size,
        sizeRaw: isDir ? 0 : info.size,
        synthesizedFolder: isDir,
      };
    } else {
      const client = await this._ensureConnectedFtp();
      const size = await client.size(remotePath);
      const lastMod = await client.lastMod(remotePath);
      const mtime = lastMod?.valueOf();
      return {
        key: key,
        keyRaw: key,
        mtimeSvr: mtime,
        mtimeCli: mtime,
        size: size,
        sizeRaw: size,
      };
    }
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    if (!key.endsWith("/")) {
      throw Error(`you should not call mkdir on ${key}`);
    }
    const remotePath = getSftpPath(key, this.remoteBaseDir);
    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      await client.mkdir(remotePath, true);
    } else {
      const client = await this._ensureConnectedFtp();
      await client.ensureDir(remotePath);
      await client.cd("/");
    }
    return {
      key: key,
      keyRaw: key,
      mtimeSvr: mtime ?? Date.now(),
      mtimeCli: mtime ?? Date.now(),
      size: 0,
      sizeRaw: 0,
      synthesizedFolder: true,
    };
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    if (key.endsWith("/")) {
      throw Error(`you should not call writeFile on ${key}`);
    }
    const remotePath = getSftpPath(key, this.remoteBaseDir);
    const Buffer = (window as any).require("buffer").Buffer;

    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      // Ensure parent directory exists
      const parentDir = remotePath.substring(0, remotePath.lastIndexOf("/"));
      if (parentDir) {
        try {
          await client.stat(parentDir);
        } catch {
          await client.mkdir(parentDir, true);
        }
      }
      await client.put(Buffer.from(content), remotePath);
      // Try to set mtime
      try {
        const sftpHandle = client.sftp;
        if (sftpHandle && sftpHandle.utimes) {
          await new Promise<void>((resolve, reject) => {
            sftpHandle.utimes(
              remotePath,
              Math.floor(mtime / 1000),
              Math.floor(mtime / 1000),
              (err: any) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
      } catch {
        // utimes not supported, ignore
      }
    } else {
      const client = await this._ensureConnectedFtp();
      const { Readable } = (window as any).require("stream");
      // Ensure parent directory exists
      const parentDir = remotePath.substring(0, remotePath.lastIndexOf("/"));
      if (parentDir) {
        await client.ensureDir(parentDir);
        await client.cd("/");
      }
      const readable = new Readable();
      readable.push(Buffer.from(content));
      readable.push(null);
      await client.uploadFrom(readable, remotePath);
    }

    return {
      key: key,
      keyRaw: key,
      mtimeSvr: mtime,
      mtimeCli: mtime,
      size: content.byteLength,
      sizeRaw: content.byteLength,
    };
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    if (key.endsWith("/")) {
      throw Error(`you should not call readFile on ${key}`);
    }
    const remotePath = getSftpPath(key, this.remoteBaseDir);

    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      const buff = await client.get(remotePath);
      if (buff instanceof ArrayBuffer) {
        return buff;
      }
      // ssh2-sftp-client returns Buffer
      return buff.buffer.slice(
        buff.byteOffset,
        buff.byteOffset + buff.byteLength
      );
    } else {
      const client = await this._ensureConnectedFtp();
      const { Writable } = (window as any).require("stream");
      const chunks: any[] = [];
      const writable = new Writable({
        write(chunk: any, _encoding: string, callback: () => void) {
          chunks.push(chunk);
          callback();
        },
      });
      await client.downloadTo(writable, remotePath);
      const Buffer = (window as any).require("buffer").Buffer;
      const buf = Buffer.concat(chunks);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  }

  async rename(key1: string, key2: string): Promise<void> {
    if (key1 === "/" || key2 === "/") {
      return;
    }
    const remotePath1 = getSftpPath(key1, this.remoteBaseDir);
    const remotePath2 = getSftpPath(key2, this.remoteBaseDir);
    if (this._isSftp()) {
      const client = await this._ensureConnectedSftp();
      await client.rename(remotePath1, remotePath2);
    } else {
      const client = await this._ensureConnectedFtp();
      await client.rename(remotePath1, remotePath2);
    }
  }

  async rm(key: string): Promise<void> {
    if (key === "/") {
      return;
    }
    const remotePath = getSftpPath(key, this.remoteBaseDir);
    try {
      if (this._isSftp()) {
        const client = await this._ensureConnectedSftp();
        if (key.endsWith("/")) {
          await client.rmdir(remotePath, true);
        } else {
          await client.delete(remotePath);
        }
      } else {
        const client = await this._ensureConnectedFtp();
        if (key.endsWith("/")) {
          await client.removeDir(remotePath);
        } else {
          await client.remove(remotePath);
        }
      }
    } catch (err) {
      console.error("some error while deleting");
      console.error(err);
    }
  }

  async checkConnect(callbackFunc?: any): Promise<boolean> {
    if (!this.sftpConfig.host) {
      const err = "Error: host is empty!";
      console.error(err);
      callbackFunc?.(err);
      return false;
    }

    try {
      await this._ensureRemoteBaseDir();
    } catch (err) {
      console.error(err);
      callbackFunc?.(err);
      return false;
    }

    return await this.checkConnectCommonOps(callbackFunc);
  }

  async getUserDisplayName(): Promise<string> {
    return this.sftpConfig.username || "";
  }

  async revokeAuth(): Promise<any> {
    // Password auth - nothing to revoke
    // But we should close connections
    try {
      if (this._sftpClient) {
        await this._sftpClient.end();
        this._sftpClient = undefined;
      }
      if (this._ftpClient) {
        this._ftpClient.close();
        this._ftpClient = undefined;
      }
    } catch {
      // ignore
    }
  }

  allowEmptyFile(): boolean {
    return true;
  }
}
