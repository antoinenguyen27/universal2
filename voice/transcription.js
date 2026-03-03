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

export async function transcribeAudio(audioBase64, options = {}) {
  if (!audioBase64) return '';
  const onLog = typeof options.onLog === 'function' ? options.onLog : null;
  const audioFormat = options.audioFormat || 'webm';
  const log = (message, type = 'status') => {
    onLog?.(message, type);
  };

  // Keep transcription path strict to reduce noisy false fallbacks.
  const model = process.env.TRANSCRIPTION_MODEL || 'mistralai/voxtral-small-24b-2507';
  let response;
  log(`Transcription started: OpenRouter request initialized (model=${model}, format=${audioFormat}).`, 'api');

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
                format: audioFormat
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
    log('Transcription response received from OpenRouter.', 'api');
  } catch (error) {
    const details = String(error?.message || error || 'unknown provider error');
    log(`Transcription failed: ${details}`, 'error');
    throw new Error(`Transcription failed for model ${model}: ${details}`);
  }

  const message = response.choices?.[0]?.message?.content;
  if (typeof message === 'string') return message.trim();

  if (Array.isArray(message)) {
    const textPart = message.find((part) => part.type === 'text' && part.text)?.text;
    return textPart?.trim() || '';
  }

  return '';
}
