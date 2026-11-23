'use client';

/**
 * Picture of the manufacturer cart for "Warenkorb übertragen" (E-76). The shop page belongs to another site, so the
 * app cannot read it; it takes a picture instead:
 * - laptop / workshop PC: a one-off capture of this browser tab (the browser asks once which tab to share);
 * - iPad / phone (no screen capture in Safari): a screenshot the Monteur picks from Photos.
 */
export const canCaptureTab = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  !/iPad|iPhone|Android/i.test(navigator.userAgent) &&
  !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Scales the picture down (long side ≤ 2000 px) and encodes it as JPEG – enough to read part numbers. */
async function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, 2000 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild nicht erzeugt'))), 'image/jpeg', 0.88),
  );
}

export async function captureTab(): Promise<Blob | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
      // Chrome/Edge: offer this tab first.
      ...({ preferCurrentTab: true, selfBrowserSurface: 'include' } as object),
    });
  } catch {
    return null; // cancelled
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, 300)); // first frame after the share prompt has closed
    return await toJpeg(video, video.videoWidth, video.videoHeight);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export async function shrinkImageFile(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    return await toJpeg(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}
