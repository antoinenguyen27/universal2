import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function speak(text) {
  if (!text?.trim()) return { audioBase64: null, mimeType: null, source: 'none' };

  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
    const eleven = await speakElevenLabs(text).catch(() => null);
    if (eleven) return { ...eleven, source: 'elevenlabs' };
  }

  await speakSystem(text);
  return { audioBase64: null, mimeType: null, source: 'system' };
}

async function speakElevenLabs(text) {
  // Verified via web: ElevenLabs streaming endpoint is POST /v1/text-to-speech/{voice_id}/stream and returns audio bytes.
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        output_format: 'mp3_44100_128'
      })
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed with status ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return { audioBase64: bytes.toString('base64'), mimeType: 'audio/mpeg' };
}

export async function speakSystem(text) {
  const sanitizedDouble = text.replace(/"/g, '');
  const sanitizedSingle = text.replace(/'/g, '');

  if (process.platform === 'darwin') {
    await execFileAsync('say', [sanitizedDouble]);
    return;
  }

  if (process.platform === 'linux') {
    try {
      await execFileAsync('espeak', [sanitizedDouble]);
    } catch {
      // Silent fallback when espeak is unavailable.
    }
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('PowerShell', [
      '-Command',
      `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${sanitizedSingle}')`
    ]);
  }
}
