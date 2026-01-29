
import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Gender } from '../types';

interface VoiceCallProps {
  gender: Gender;
  onClose: () => void;
}

// Optimized Audio Encoding/Decoding for Live API
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const VoiceCall: React.FC<VoiceCallProps> = ({ gender, onClose }) => {
  const [permissionState, setPermissionState] = useState<'pending' | 'requesting' | 'granted' | 'denied' | 'error' | 'connecting'>('pending');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [callStatus, setCallStatus] = useState('Taiyar hain');
  const [isMuted, setIsMuted] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>(new Array(40).fill(2));
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartCall = async () => {
    setPermissionState('requesting');
    setCallStatus('Connection check ho raha hai...');
    setErrorMessage('');

    // 1. API KEY CHECK
    // Vercel check: Agar browser mein process.env.API_KEY undefined hai, toh error dikhao
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === 'undefined') {
      console.error('API KEY MISSING IN BROWSER CONTEXT');
      setPermissionState('error');
      setErrorMessage('API Key nahi mil rahi. Vercel mein "API_KEY" variable check karein.');
      return;
    }
    
    let stream: MediaStream;
    try {
      // 2. Request Mic
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      console.error('Mic Access Denied:', err);
      setPermissionState('denied');
      setErrorMessage('Mic blocked hai. Please setting se allow karein.');
      return;
    }

    setPermissionState('connecting');
    setCallStatus('Sahara se baat karwa rahe hain...');

    try {
      // 3. Audio Setup
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      // 4. Connect to Gemini Live API
      const ai = new GoogleGenAI({ apiKey });
      const voiceName = gender === 'female' ? 'Kore' : 'Puck';
      const persona = gender === 'female' ? "Elder Sister (Badi Behen)" : "Elder Brother (Bada Bhai)";

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setPermissionState('granted');
            setCallStatus('Connected');
            timerRef.current = window.setInterval(() => setDuration(prev => prev + 1), 1000);

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then(s => s.sendRealtimeInput({
                media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' }
              }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setIsModelSpeaking(true);
              const outCtx = audioContextsRef.current!.output;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              const audioBuffer = await decodeAudioData(decode(audioData), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outCtx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsModelSpeaking(false);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
              setWaveformData(Array.from({ length: 40 }, () => Math.random() * 80 + 20));
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsModelSpeaking(false);
            }
          },
          onclose: (e) => {
            console.log('Session closed', e);
            if (permissionState === 'connecting') {
              setPermissionState('error');
              setErrorMessage('Server ne connection close kar diya. Key invalid ho sakti hai.');
            } else {
              onClose();
            }
          },
          onerror: (e: any) => {
            console.error('Session Connection Error:', e);
            setPermissionState('error');
            setErrorMessage(e.message || 'API connection fail ho gayi. Internet ya key check karein.');
            setCallStatus('Disconnected');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `Aap Sahara hain, user ke ${persona}. Tone: Supportive, protective sibling. Use Hinglish naturally. Keep responses concise. Focus on empathy.`,
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Handled Catch Connection Failure:', err);
      setPermissionState('error');
      setErrorMessage(err.message || 'API link karne mein dikkat hui hai.');
      setCallStatus('Error');
    }
  };

  useEffect(() => {
    return () => {
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextsRef.current) {
        audioContextsRef.current.input.close().catch(() => {});
        audioContextsRef.current.output.close().catch(() => {});
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isModelSpeaking) {
      const interval = setInterval(() => {
        setWaveformData(prev => prev.map(v => Math.max(4, v * 0.9)));
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isModelSpeaking]);

  if (permissionState !== 'granted') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#020617] text-white text-center">
        <div className="relative mb-12">
          <div className={`absolute -inset-8 blur-3xl opacity-20 rounded-full animate-pulse ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
          <div className={`w-36 h-36 rounded-full border-4 border-dashed transition-all duration-700 
            ${(permissionState === 'requesting' || permissionState === 'connecting') ? 'border-yellow-500 animate-spin' : 
              permissionState === 'denied' ? 'border-red-500' : 
              permissionState === 'error' ? 'border-orange-500' : 'border-slate-500/30'}`} 
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-28 h-28 rounded-full flex items-center justify-center text-6xl shadow-2xl transition-all duration-500 
              ${permissionState === 'denied' || permissionState === 'error' ? 'bg-red-600' : 
                gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`}>
              {permissionState === 'denied' ? '🚫' : (permissionState === 'error' ? '⚠️' : (gender === 'female' ? '👩‍💼' : '👨‍💼'))}
            </div>
          </div>
        </div>
        
        <div className="space-y-4 max-w-sm mx-auto mb-12">
          <h2 className="text-3xl font-black tracking-tight">
            {permissionState === 'connecting' ? 'Connecting...' : 
             permissionState === 'denied' ? 'Mic Access Blocked' : 
             permissionState === 'error' ? 'API / Server Issue' : 'Sahara Voice Call'}
          </h2>
          <div className="bg-white/5 rounded-2xl p-5 border border-white/10">
            <p className="text-slate-400 text-sm leading-relaxed">
              {permissionState === 'pending' && `Call shuru karne ke liye niche button dabaein.`}
              {permissionState === 'requesting' && 'Permission check ho rahi hai...'}
              {permissionState === 'connecting' && 'Sahara AI server se jud rahe hain...'}
              {permissionState === 'denied' && 'Mic blocked hai. Lock (🔒) icon se allow karein.'}
              {permissionState === 'error' && (
                <span className="text-orange-400 font-bold">{errorMessage || 'Kuch galat hua. Key check karein.'}</span>
              )}
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-4">
          <button 
            onClick={handleStartCall}
            disabled={permissionState === 'requesting' || permissionState === 'connecting'}
            className={`w-full py-5 rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 disabled:opacity-50
              ${permissionState === 'denied' || permissionState === 'error' ? 'bg-red-600' : 
                gender === 'female' ? 'bg-rose-600' : 'bg-indigo-600'}`}
          >
            {permissionState === 'connecting' ? 'Connecting...' : 'Call Start Karein'}
          </button>
          <button onClick={() => window.location.reload()} className="w-full py-3 text-xs text-slate-500 hover:text-white uppercase font-black tracking-widest">Refresh Page</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-between py-16 px-8 bg-[#030712] text-white">
      <div className="text-center">
        <h2 className="text-4xl font-black tracking-tighter mb-1">{gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}</h2>
        <p className={`text-sm font-bold tracking-widest font-mono text-emerald-400`}>{formatDuration(duration)}</p>
      </div>

      <div className="relative w-full flex flex-col items-center">
        <div className={`absolute w-80 h-80 blur-[130px] rounded-full opacity-30 transition-all duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'} ${isModelSpeaking ? 'scale-125' : 'scale-90'}`} />
        <div className={`relative z-10 w-60 h-80 rounded-[4rem] bg-gradient-to-b from-white/10 to-transparent backdrop-blur-3xl border border-white/5 flex flex-col items-center justify-center shadow-2xl transition-all duration-500 ${isModelSpeaking ? 'scale-105 border-white/20' : 'scale-100'}`}>
          <div className="text-[130px] mb-4 select-none animate-float">{gender === 'female' ? '👩‍💼' : '👨‍💼'}</div>
        </div>
        <div className="flex items-center justify-center gap-[3px] h-24 w-full mt-12 px-6">
          {waveformData.map((h, i) => (
            <div key={i} className={`w-1 rounded-full transition-all duration-150 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`}
              style={{ height: `${h}%`, opacity: isModelSpeaking ? 1 : 0.1 }}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-sm flex items-center justify-center gap-12">
        <button onClick={() => setIsMuted(!isMuted)} className={`w-16 h-16 rounded-full flex items-center justify-center ${isMuted ? 'bg-white text-black' : 'bg-white/5 border border-white/10'}`}>
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button onClick={onClose} className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/40">
          <svg className="h-10 w-10 rotate-[135deg]" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
        </button>
        <button className="w-16 h-16 rounded-full bg-white/5 border border-white/10 text-white/20">ℹ️</button>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `.animate-float { animation: float 6s ease-in-out infinite; } @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }`}} />
    </div>
  );
};

export default VoiceCall;
