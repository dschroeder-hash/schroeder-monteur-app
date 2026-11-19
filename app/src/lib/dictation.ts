'use client';

import { useCallback, useRef, useState } from 'react';
import { apiFetch, ApiError } from './api';
import { config } from './config';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

/**
 * Dictation (PROMPT 5.6): browser speech recognition (de-DE) where available, otherwise recording + Azure AI
 * Speech via the API (online only). The result is only a proposal – the Monteur confirms before it is saved.
 */
export function useDictation() {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => undefined);

  const start = useCallback(async () => {
    setError(null);
    setText('');
    const Ctor =
      (
        window as unknown as {
          SpeechRecognition?: new () => Recognition;
          webkitSpeechRecognition?: new () => Recognition;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (Ctor) {
      const rec = new Ctor();
      rec.lang = 'de-DE';
      rec.continuous = true;
      rec.interimResults = true;
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += `${r[0].transcript.trim()} `;
          else interim += r[0].transcript;
        }
        setText(`${finalText}${interim}`.trim());
      };
      rec.onerror = (e) =>
        setError(e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : 'Spracherkennung nicht verfügbar');
      rec.onend = () => setListening(false);
      rec.start();
      stopRef.current = () => rec.stop();
      setListening(true);
      return;
    }
    // Fallback: record and transcribe on the server (Azure AI Speech, max. 60 s).
    if (!navigator.onLine) return setError('Diktat ist auf diesem Gerät nur online möglich');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        try {
          const token = await (await import('./api')).getToken();
          const res = await fetch(`${config.apiUrl}/v1/speech/transcribe`, {
            method: 'POST',
            headers: {
              'content-type': recorder.mimeType || 'audio/webm',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: new Blob(chunks, { type: recorder.mimeType }),
          });
          if (!res.ok)
            throw new ApiError(
              res.status,
              ((await res.json().catch(() => ({}))) as { message?: string }).message ?? 'Fehler',
            );
          setText(((await res.json()) as { text: string }).text);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Diktat fehlgeschlagen');
        }
      };
      recorder.start();
      const timer = setTimeout(() => recorder.state === 'recording' && recorder.stop(), 60_000);
      stopRef.current = () => {
        clearTimeout(timer);
        if (recorder.state === 'recording') recorder.stop();
      };
      setListening(true);
    } catch {
      setError('Mikrofon nicht verfügbar');
    }
  }, []);

  const stop = useCallback(() => stopRef.current(), []);
  const rewrite = useCallback(
    async (input: string) =>
      (
        await apiFetch<{ text: string }>('/v1/speech/rewrite', {
          method: 'POST',
          body: JSON.stringify({ text: input }),
        })
      ).text,
    [],
  );
  return { listening, text, setText, error, start, stop, rewrite };
}
