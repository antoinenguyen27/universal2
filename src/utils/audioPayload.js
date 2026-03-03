function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : '');
    };
    reader.readAsDataURL(blob);
  });
}

function encodeMonoWav(audioBuffer) {
  const samples = audioBuffer.getChannelData(0);
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = audioBuffer.sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function resampleToMono16k(audioBuffer) {
  if (typeof OfflineAudioContext === 'undefined') return audioBuffer;
  const frameCount = Math.max(1, Math.ceil(audioBuffer.duration * 16000));
  const offlineContext = new OfflineAudioContext(1, frameCount, 16000);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  return offlineContext.startRendering();
}

export async function toTranscriptionPayload(blob) {
  const fallbackBase64 = await blobToBase64(blob);
  const fallback = {
    audioBase64: fallbackBase64,
    audioFormat: 'webm',
    convertedToWav: false,
    durationMs: null
  };

  if (!fallbackBase64) return fallback;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return fallback;

  try {
    const sourceBytes = await blob.arrayBuffer();
    const audioContext = new AudioContextCtor();
    const decoded = await audioContext.decodeAudioData(sourceBytes.slice(0));
    await audioContext.close().catch(() => {});

    const resampled = await resampleToMono16k(decoded);
    const wavBlob = encodeMonoWav(resampled);
    const wavBase64 = await blobToBase64(wavBlob);

    if (!wavBase64) return fallback;
    return {
      audioBase64: wavBase64,
      audioFormat: 'wav',
      convertedToWav: true,
      durationMs: Math.round(decoded.duration * 1000)
    };
  } catch {
    return fallback;
  }
}
