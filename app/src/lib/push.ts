'use client';

import { apiFetch } from './api';

/** Web Push subscription (VAPID). iOS/iPadOS only for the installed PWA (ARCHITEKTUR 4.4). */
export async function pushState(): Promise<'unsupported' | 'denied' | 'off' | 'on'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

const toUint8 = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function enablePush(): Promise<'unsupported' | 'denied' | 'off' | 'on'> {
  const { publicKey } = await apiFetch<{ publicKey: string | null }>('/v1/push/vapid-public-key');
  if (!publicKey) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toUint8(publicKey),
  });
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await apiFetch('/v1/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return 'on';
}
