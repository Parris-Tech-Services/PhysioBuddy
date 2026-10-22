// Browser speech: text-to-speech coaching and spoken-command recognition.
// Recognition is suspended while the coach is speaking so the app never
// "hears" its own voice and mistakes it for a command.
import { acceptResult } from './commands.js';

export function pickVoice(voices, preferredName) {
  if (preferredName) {
    const named = voices.find((v) => v.name === preferredName);
    if (named) return named;
  }
  const byLang = (re) => voices.filter((v) => re.test(v.lang.replace('_', '-')));
  const au = byLang(/^en-AU/i);
  const pool = au.length ? au : byLang(/^en-GB/i).length ? byLang(/^en-GB/i) : byLang(/^en/i);
  return pool.find((v) => /natural|neural|google|online/i.test(v.name)) || pool[0] || null;
}

export function englishVoices() {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
}

export class Coach {
  constructor({ getSettings, onCaption, onSpeaking }) {
    this.getSettings = getSettings;
    this.onCaption = onCaption;
    this.onSpeaking = onSpeaking;
    this.supported = 'speechSynthesis' in window;
    this.lastText = '';
  }

  speak(text, { onEnd, remember = true } = {}) {
    if (remember) this.lastText = text;
    this.onCaption(text);
    const s = this.getSettings();
    if (!this.supported || !s.voiceOn) {
      if (onEnd) setTimeout(onEnd, 0);
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(speechSynthesis.getVoices(), s.voiceName);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : 'en-AU';
    u.rate = s.speechRate;
    u.pitch = 1;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      this.onSpeaking(false);
      if (onEnd) onEnd();
    };
    u.onstart = () => this.onSpeaking(true);
    u.onend = done;
    u.onerror = done;
    // Some Android voices never fire onend; fall back to an estimate.
    setTimeout(done, 1500 + text.length * 90 / s.speechRate);
    speechSynthesis.speak(u);
  }

  repeat() {
    if (this.lastText) this.speak(this.lastText);
  }

  cancel() {
    if (this.supported) speechSynthesis.cancel();
    this.onSpeaking(false);
  }
}

// Continuous command listener with automatic restart. Status values:
// 'off' | 'starting' | 'listening' | 'paused' | 'blocked' | 'unsupported' | 'error'
export class Listener {
  constructor({ onCommand, onHeard, onStatus }) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.Rec = Rec;
    this.onCommand = onCommand;
    this.onHeard = onHeard;
    this.onStatus = onStatus;
    this.wanted = false;
    this.suspended = false;
    this.rec = null;
    this.status = Rec ? 'off' : 'unsupported';
  }

  get supported() {
    return Boolean(this.Rec);
  }

  setStatus(status, message = '') {
    this.status = status;
    this.onStatus(status, message);
  }

  start() {
    if (!this.supported) {
      this.setStatus('unsupported', 'Voice commands are not available in this browser. Use the buttons instead.');
      return;
    }
    this.wanted = true;
    this.open();
  }

  stop() {
    this.wanted = false;
    this.close();
    this.setStatus('off');
  }

  // Pause while the coach talks.
  suspend(on) {
    this.suspended = on;
    if (!this.wanted) return;
    if (on) this.close();
    else this.open();
  }

  open() {
    if (this.rec || this.suspended || !this.wanted) return;
    const rec = new this.Rec();
    rec.lang = 'en-AU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => this.setStatus('listening');
    rec.onresult = (e) => this.handleResult(e);
    rec.onerror = (e) => this.handleError(e);
    rec.onend = () => {
      this.rec = null;
      if (this.wanted && !this.suspended && this.status !== 'blocked') setTimeout(() => this.open(), 300);
      else if (this.suspended) this.setStatus('paused');
    };
    this.rec = rec;
    this.setStatus('starting');
    try {
      rec.start();
    } catch {
      this.rec = null;
    }
  }

  close() {
    if (!this.rec) return;
    const rec = this.rec;
    this.rec = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
    if (this.suspended) this.setStatus('paused');
  }

  handleResult(e) {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const alt = r[0];
      this.onHeard(alt.transcript, !r.isFinal);
      const command = acceptResult({ transcript: alt.transcript, confidence: alt.confidence, isFinal: r.isFinal });
      if (r.isFinal) this.onCommand(command, alt.transcript);
    }
  }

  handleError(e) {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      this.wanted = false;
      this.setStatus('blocked', 'Microphone permission is off. Allow the microphone for this site in Chrome settings, or use the buttons.');
    } else if (e.error === 'audio-capture') {
      this.wanted = false;
      this.setStatus('error', 'No microphone was found. Use the buttons instead.');
    } else if (e.error === 'network') {
      this.wanted = false;
      this.setStatus('error', 'Voice recognition needs an internet connection on this device. The buttons still work offline.');
    }
    // 'no-speech' and 'aborted' are routine; onend restarts listening.
  }
}
