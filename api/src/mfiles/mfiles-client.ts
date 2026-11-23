/**
 * M-Files REST client (MFWS, /REST/…) for the photos of the Monteur (E-73): today the photos hang at the machine
 * object in M-Files and are viewed in BC through the M-Files view. The app creates one document per photo with a
 * lookup to the machine object (and the service order number), so nothing existing is checked out or changed.
 * Object type, class and property ids differ per vault – all configurable (OFFENE-PUNKTE OP-48).
 */
export interface MFilesConfig {
  baseUrl: string;
  vaultGuid: string;
  username: string;
  password: string;
  /** Object type of the machine (e.g. 101). */
  machineObjectType: number;
  /** Property of the machine object that holds the BC service item number (search key). */
  machineKeyProperty: number;
  /** Class of the created photo document. */
  photoClass: number;
  /** Lookup property on the document pointing at the machine object. */
  machineLookupProperty: number;
  /** Optional text property for the service order number. */
  orderNoProperty?: number | null;
}

export class MFilesError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const PROPERTY_CLASS = 100;
const PROPERTY_NAME = 0;

export class MFilesClient {
  private token: { value: string; at: number } | null = null;
  constructor(
    private readonly cfg: MFilesConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string) {
    return `${this.cfg.baseUrl.replace(/\/$/, '')}/REST${path}`;
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() - this.token.at < 30 * 60_000) return this.token.value;
    const res = await this.fetchImpl(this.url('/server/authenticationtokens'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        Username: this.cfg.username,
        Password: this.cfg.password,
        VaultGuid: this.cfg.vaultGuid,
      }),
    });
    if (!res.ok) throw new MFilesError(res.status, `M-Files-Anmeldung fehlgeschlagen (${res.status})`);
    const value = ((await res.json()) as { Value: string }).Value;
    this.token = { value, at: Date.now() };
    return value;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(this.url(path), {
      ...init,
      headers: { 'X-Authentication': await this.auth(), ...(init.headers ?? {}) },
    });
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new MFilesError(res.status, `M-Files ${init.method ?? 'GET'} ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  /** Object id of the machine with this BC service item number, or null. */
  async findMachine(serviceItemNo: string): Promise<number | null> {
    const r = await this.call<{ Items: Array<{ ObjVer: { ID: number } }> }>(
      `/objects/${this.cfg.machineObjectType}?p${this.cfg.machineKeyProperty}=${encodeURIComponent(serviceItemNo)}`,
    );
    return r.Items[0]?.ObjVer.ID ?? null;
  }

  /** Uploads the photo and creates a document with a lookup to the machine; returns the new object id. */
  async addPhoto(input: {
    bytes: Buffer;
    title: string;
    machineId: number;
    orderNo: string;
  }): Promise<number> {
    const upload = await this.call<{ UploadID: number; Size: number }>('/files', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(input.bytes),
    });
    const props: unknown[] = [
      { PropertyDef: PROPERTY_CLASS, TypedValue: { DataType: 9, Lookup: { Item: this.cfg.photoClass } } },
      { PropertyDef: PROPERTY_NAME, TypedValue: { DataType: 1, Value: input.title } },
      {
        PropertyDef: this.cfg.machineLookupProperty,
        TypedValue: { DataType: 10, Lookups: [{ Item: input.machineId }] },
      },
    ];
    if (this.cfg.orderNoProperty)
      props.push({
        PropertyDef: this.cfg.orderNoProperty,
        TypedValue: { DataType: 1, Value: input.orderNo },
      });
    const created = await this.call<{ ObjVer: { ID: number } }>('/objects/0', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        PropertyValues: props,
        Files: [{ UploadID: upload.UploadID, Title: input.title, Extension: 'jpg', Size: upload.Size }],
      }),
    });
    return created.ObjVer.ID;
  }
}
