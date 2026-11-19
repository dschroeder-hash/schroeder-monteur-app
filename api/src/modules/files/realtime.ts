/**
 * Realtime notifications (ARCHITEKTUR 6.1): Azure Web PubSub with groups order:{id}, user:{id}, location:{id}:board.
 * Clients only receive "something changed" events and then sync – no data travels through the hub.
 * Without a configured endpoint the app falls back to periodic sync.
 */
export const REALTIME = Symbol('REALTIME');

export interface Realtime {
  publish(groups: string[], event: Record<string, unknown>): Promise<void>;
  /** Client access URL limited to the given groups, or null if realtime is not configured. */
  clientUrl(userId: string, groups: string[]): Promise<string | null>;
}

export class NoRealtime implements Realtime {
  async publish() {}
  async clientUrl() {
    return null;
  }
}

export class WebPubSubRealtime implements Realtime {
  private client?: import('@azure/web-pubsub').WebPubSubServiceClient;
  constructor(
    private readonly endpoint: string,
    private readonly hub: string,
  ) {}

  private async svc() {
    if (!this.client) {
      const { WebPubSubServiceClient } = await import('@azure/web-pubsub');
      const { DefaultAzureCredential } = await import('@azure/identity');
      this.client = new WebPubSubServiceClient(this.endpoint, new DefaultAzureCredential(), this.hub);
    }
    return this.client;
  }

  async publish(groups: string[], event: Record<string, unknown>) {
    const svc = await this.svc();
    await Promise.all([...new Set(groups)].map((g) => svc.group(g).sendToAll(event)));
  }

  async clientUrl(userId: string, groups: string[]) {
    const token = await (
      await this.svc()
    ).getClientAccessToken({ userId, groups, expirationTimeInMinutes: 60 });
    return token.url;
  }
}
