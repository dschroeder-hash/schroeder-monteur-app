/**
 * Dictation fallback via Azure AI Speech (REST, short audio ≤ 60 s, language de-DE) and an optional AI rewrite
 * of dictated text. The rewrite is behind feature flag `dictation.ai` and has no provider until data residency is
 * decided (OFFENE-PUNKTE OP-10); the Monteur always confirms the text before saving.
 */
export const SPEECH = Symbol('SPEECH');
export const TEXT_REWRITE = Symbol('TEXT_REWRITE');

export interface SpeechToText {
  readonly configured: boolean;
  transcribe(audio: Buffer, contentType: string): Promise<string>;
}

export interface TextRewrite {
  readonly configured: boolean;
  rewrite(text: string): Promise<string>;
}

export class AzureSpeech implements SpeechToText {
  readonly configured: boolean;
  constructor(
    private readonly region: string,
    private readonly key: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.configured = !!key;
  }

  async transcribe(audio: Buffer, contentType: string): Promise<string> {
    const url = `https://${this.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=de-DE&format=simple&profanity=raw`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key!,
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body: new Uint8Array(audio),
    });
    if (!res.ok) throw new Error(`Speech service ${res.status}`);
    const json = (await res.json()) as { RecognitionStatus: string; DisplayText?: string };
    return json.RecognitionStatus === 'Success' ? (json.DisplayText ?? '') : '';
  }
}

export class NoRewrite implements TextRewrite {
  readonly configured = false;
  async rewrite(): Promise<string> {
    throw new Error('not configured');
  }
}
