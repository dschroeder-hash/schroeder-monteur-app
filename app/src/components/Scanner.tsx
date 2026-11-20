'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';

/**
 * Barcode/QR scanner with the device camera (PROMPT 5.5). zxing-wasm decodes EAN, Code 128, QR and DataMatrix on
 * all platforms incl. iOS (E-18). The WebAssembly file is served by the app itself and precached → works offline.
 */
export function Scanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
        prepareZXingModule({
          overrides: {
            locateFile: (path: string) => (path.endsWith('.wasm') ? '/zxing/zxing_reader.wasm' : path),
          },
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const loop = async () => {
          if (stopped) return;
          if (v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0);
            const results = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
              formats: ['EAN13', 'EAN8', 'Code128', 'Code39', 'QRCode', 'DataMatrix'],
              tryHarder: true,
            });
            const hit = results.find((r) => r.isValid && r.text);
            if (hit) {
              if (navigator.vibrate) navigator.vibrate(80);
              onResult(hit.text);
              return;
            }
          }
          setTimeout(() => void loop(), 250);
        };
        void loop();
      } catch {
        setError('Kamera nicht verfügbar. Bitte Kamerazugriff erlauben oder die Nummer eingeben.');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scannen"
      className="fixed inset-0 z-50 flex flex-col bg-black"
    >
      <video ref={video} className="h-full w-full object-cover" playsInline muted />
      <div
        className="pointer-events-none absolute inset-x-8 top-1/3 h-1/4 rounded-card border-4 border-white/80"
        aria-hidden
      />
      {error && (
        <p role="alert" className="absolute inset-x-4 top-4 rounded-card bg-danger-bg p-3 text-danger">
          {error}
        </p>
      )}
      <div className="absolute inset-x-4 bottom-6">
        <Button size="lg" variant="secondary" className="w-full" onClick={onClose}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
