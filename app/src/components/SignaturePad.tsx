'use client';

import { Eraser } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';

/**
 * Signature field for finger or Apple Pencil (pointer events, works offline). Delivers a PNG data URL with
 * transparent background, scaled down to at most 900 px width to keep the sync payload small.
 */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);
  const ink = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    let lastWidth = -1;
    // Only a real size change clears the field (rotation) – not the keyboard opening for the name field.
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = c.getBoundingClientRect();
      if (width === lastWidth) return;
      lastWidth = width;
      c.width = Math.round(width * ratio);
      c.height = Math.round(height * ratio);
      const ctx = c.getContext('2d')!;
      ctx.scale(ratio, ratio);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#111';
      ink.current = false;
      setEmpty(true);
      onChange(null);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const exportPng = () => {
    const c = canvas.current!;
    const scale = Math.min(1, 900 / c.width);
    const out = document.createElement('canvas');
    out.width = Math.round(c.width * scale);
    out.height = Math.round(c.height * scale);
    out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height);
    onChange(out.toDataURL('image/png'));
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        aria-label="Unterschriftsfeld – mit dem Finger oder Stift unterschreiben"
        role="img"
        data-testid="signature-pad"
        className="h-48 w-full touch-none rounded-card border-2 border-dashed border-border bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = point(e);
          const ctx = canvas.current!.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          if (!ink.current) {
            ink.current = true;
            setEmpty(false);
          }
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
          if (ink.current) exportPng();
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-text-muted">
          {empty ? 'Bitte hier unterschreiben' : 'Unterschrift erfasst'}
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            const c = canvas.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            ink.current = false;
            setEmpty(true);
            onChange(null);
          }}
        >
          <Eraser aria-hidden className="h-5 w-5" /> Löschen
        </Button>
      </div>
    </div>
  );
}
