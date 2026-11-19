/**
 * Photo storage (ARCHITEKTUR 6.2). The client always speaks the Azure Blob block-upload protocol
 * (Put Block / Get Block List / Put Block List) against a short-lived URL, so uploads are resumable:
 *  - AzureBlobStorage: private container, user delegation SAS (no account keys; shared key access is disabled)
 *  - LocalBlobStorage: dev/test – the API itself implements the same protocol under /v1/blob/:token
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

export interface BlobStorage {
  /** URL for uploading blocks (write) – valid a few minutes. */
  uploadUrl(path: string): Promise<string>;
  /** URL for reading – valid a few minutes. */
  readUrl(path: string): Promise<string>;
  /** Size of the committed blob or null if it does not exist (yet). */
  size(path: string): Promise<number | null>;
  delete(path: string): Promise<void>;
}

export const SAS_MINUTES = 10;

// ---------------------------------------------------------------------------
// Azure
// ---------------------------------------------------------------------------

export class AzureBlobStorage implements BlobStorage {
  private client?: import('@azure/storage-blob').BlobServiceClient;
  private key?: { value: import('@azure/storage-blob').UserDelegationKey; expires: number };

  constructor(
    private readonly accountUrl: string,
    private readonly container: string,
  ) {}

  private async svc() {
    if (!this.client) {
      const { BlobServiceClient } = await import('@azure/storage-blob');
      const { DefaultAzureCredential } = await import('@azure/identity');
      this.client = new BlobServiceClient(this.accountUrl, new DefaultAzureCredential());
    }
    return this.client;
  }

  private async sas(path: string, permissions: string): Promise<string> {
    const { BlobSASPermissions, generateBlobSASQueryParameters, SASProtocol } =
      await import('@azure/storage-blob');
    const svc = await this.svc();
    const now = Date.now();
    if (!this.key || this.key.expires - now < 30 * 60_000) {
      const expires = now + 6 * 3_600_000;
      this.key = {
        value: await svc.getUserDelegationKey(new Date(now - 5 * 60_000), new Date(expires)),
        expires,
      };
    }
    const accountName = new URL(this.accountUrl).hostname.split('.')[0]!;
    const q = generateBlobSASQueryParameters(
      {
        containerName: this.container,
        blobName: path,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn: new Date(now - 2 * 60_000),
        expiresOn: new Date(now + SAS_MINUTES * 60_000),
        protocol: SASProtocol.Https,
      },
      this.key.value,
      accountName,
    );
    return `${this.accountUrl.replace(/\/$/, '')}/${this.container}/${path}?${q.toString()}`;
  }

  uploadUrl(path: string) {
    return this.sas(path, 'cw');
  }
  readUrl(path: string) {
    return this.sas(path, 'r');
  }
  async size(path: string) {
    const blob = (await this.svc()).getContainerClient(this.container).getBlobClient(path);
    try {
      return (await blob.getProperties()).contentLength ?? null;
    } catch {
      return null;
    }
  }
  async delete(path: string) {
    await (await this.svc()).getContainerClient(this.container).getBlobClient(path).deleteIfExists();
  }
}

// ---------------------------------------------------------------------------
// Local (dev/test)
// ---------------------------------------------------------------------------

export class LocalBlobStorage implements BlobStorage {
  constructor(
    private readonly dir: string,
    private readonly publicBaseUrl: string,
    private readonly secret: string,
  ) {}

  /** Token = base64url(path|perm|exp) + HMAC; verified by the /v1/blob route. */
  sign(path: string, perm: 'w' | 'r', minutes = SAS_MINUTES): string {
    const payload = Buffer.from(`${path}|${perm}|${Date.now() + minutes * 60_000}`).toString('base64url');
    const mac = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }

  verify(token: string, perm: 'w' | 'r'): string | null {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac)))
      return null;
    const [path, p, exp] = Buffer.from(payload, 'base64url').toString().split('|');
    if (!path || p !== perm || Number(exp) < Date.now()) return null;
    return path;
  }

  private file(path: string) {
    const f = normalize(join(this.dir, path));
    if (!f.startsWith(normalize(this.dir))) throw new Error('invalid path');
    return f;
  }

  async uploadUrl(path: string) {
    return `${this.publicBaseUrl}/v1/blob/${this.sign(path, 'w')}`;
  }
  async readUrl(path: string) {
    return `${this.publicBaseUrl}/v1/blob/${this.sign(path, 'r')}`;
  }
  async size(path: string) {
    try {
      return (await stat(this.file(path))).size;
    } catch {
      return null;
    }
  }
  async delete(path: string) {
    await rm(this.file(path), { force: true });
    await rm(`${this.file(path)}.blocks`, { recursive: true, force: true });
  }

  async putBlock(path: string, blockId: string, data: Buffer) {
    if (!/^[A-Za-z0-9+/=_-]{1,128}$/.test(blockId)) throw new Error('invalid block id');
    const dir = `${this.file(path)}.blocks`;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, Buffer.from(blockId).toString('hex')), data);
  }

  async uncommittedBlocks(path: string): Promise<Array<{ id: string; size: number }>> {
    const dir = `${this.file(path)}.blocks`;
    try {
      const names = await readdir(dir);
      return Promise.all(
        names.map(async (n) => ({
          id: Buffer.from(n, 'hex').toString(),
          size: (await stat(join(dir, n))).size,
        })),
      );
    } catch {
      return [];
    }
  }

  async commit(path: string, blockIds: string[]) {
    const dir = `${this.file(path)}.blocks`;
    const parts = await Promise.all(
      blockIds.map((id) => readFile(join(dir, Buffer.from(id).toString('hex')))),
    );
    await mkdir(normalize(join(this.file(path), '..')), { recursive: true });
    await writeFile(this.file(path), Buffer.concat(parts));
    await rm(dir, { recursive: true, force: true });
  }

  read(path: string) {
    return readFile(this.file(path));
  }
}
