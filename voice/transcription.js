// WHY VOXTRAL VIA OPENROUTER CHAT COMPLETIONS:
// Voxtral accepts audio as base64 in chat messages, so transcription uses the
// same OpenAI-compatible endpoint and key as other LLM calls.

import OpenAI from 'openai';

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/your-org/universal-agent',
    'X-Title': 'Universal Agent'
  }
});

export async function transcribeAudio(audioBase64) {
  if (!audioBase64) return '';

  // Verified via web: OpenRouter OpenAI-compatible chat endpoint supports multimodal content with input_audio.
  // Verified via web: Voxtral model IDs are published under provider prefix `mistralai/`.
  const modelCandidates = [
    'mistralai/voxtral-small-24b-2507',
    'mistralai/voxtral-small-2507',
    'mistralai/voxtral-mini-2507'
  ];
  const formatCandidates = ['webm', 'wav', 'mp3'];
  let response;
  let lastError;

  for (const model of modelCandidates) {
    for (const format of formatCandidates) {
      try {
        response = await openrouter.chat.completions.create({
          model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: audioBase64,
                    format
                  }
                },
                {
                  type: 'text',
                  text: 'Transcribe this audio exactly. Return only the transcript text with no commentary.'
                }
              ]
            }
          ],
          temperature: 0
        });
        break;
      } catch (error) {
        const details = String(error?.message || error);
        if (
          /not a valid model ID/i.test(details) ||
          /No endpoints found/i.test(details) ||
          /Provider returned error/i.test(details) ||
          /Unsupported input/i.test(details) ||
          /invalid.*format/i.test(details)
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    if (response) break;
  }

  if (!response) {
    const details = String(lastError?.message || 'unknown provider error');
    throw new Error(`Transcription unavailable via OpenRouter Voxtral fallback chain: ${details}`);
  }

  const message = response.choices?.[0]?.message?.content;
  if (typeof message === 'string') return message.trim();

  if (Array.isArray(message)) {
    const textPart = message.find((part) => part.type === 'text' && part.text)?.text;
    return textPart?.trim() || '';
  }

  return '';
}
