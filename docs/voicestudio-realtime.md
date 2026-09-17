# VoiceStudio call integration

## Phase 1: reliable turn mode

Rakazo's existing CallView remains the default. The server-side `voicestudio` voice adapter sends STT to VoiceStudio and TTS to the existing Kokoro bridge. Both calls stay server-side. The VoiceStudio API key stays in Rakazo's encrypted Space voice credential and is never sent to the browser or placed in a URL.

Production configuration:

- `RAKAZO_VOICESTUDIO_BASE_URL=http://voicestudio:3900/v1`
- TTS service `RAKAZO_KOKORO_BASE_URL`, model `kokoro`, voice `af_heart`
- STT engine `sherpa-onnx-asr`, model `sherpa-whisper-tiny`
- one active STT and TTS request per call until CPU benchmarks establish safe concurrency
- KittenTTS remains an optional later quality path; it is not on the call-critical path

## Phase 2: streaming mode

Streaming is shipped behind `VOICE_STREAM_ENABLED=false`. Do not show the mode in the UI until all items below pass a one-account canary:

1. Add an authenticated same-origin Rakazo WebSocket. Validate the Better Auth session, exact Origin, Space membership, a short-lived call id, request size, duration, and rate limits.
2. Rakazo opens VoiceStudio `/v1/audio/transcriptions/stream` with the server-side bearer credential. The browser never connects to VoiceStudio directly.
3. Forward partial captions, but create a Rakazo user message only for an authoritative utterance final. Attach session id and sequence id for replay-safe idempotency.
4. Pipeline sentence-level TTS from committed bot message events. VoiceStudio currently returns a complete file per `/v1/audio/speech` request, so this is not token-level audio streaming.
5. Local VAD stops playback and aborts pending TTS immediately. Finalized speech steers the active run; background-noise triggers do not kill the run.
6. Enable browser acoustic echo cancellation and a 250 ms debounce. Keep one STT session and one TTS job, drop stale partials, never drop finals.
7. After two WebSocket failures, a TTS timeout, unsupported codec, or server backpressure, switch the call to turn mode without reload.

Turn mode remains available during and after the streaming rollout. Rollback is `VOICE_STREAM_ENABLED=false`; a full rollback restores the prior Rakazo image and removes the provider/network environment without deleting databases or volumes.
