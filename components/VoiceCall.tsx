
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
  const [debugLog, setDebugLog] = useState<string[]>([]);
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

  const addLog = (msg: string) => setDebugLog(prev => [msg, ...prev].slice(0, 5));

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartCall = async () => {
    setPermissionState('requesting');
    setCallStatus('Mic check...');
    setErrorMessage('');
    addLog("Call shuru ho rahi hai...");
    
    // 1. Mic Request
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      addLog("Mic access mil gaya.");
    } catch (err: any) {
      setPermissionState('denied');
      setErrorMessage('Mic access nahi mila. Settings check karein.');
      return;
    }

    setPermissionState('connecting');
    setCallStatus('API Connecting...');

    try {
      // 2. API Key verification (Vercel specific)
      const apiKey = process.env.API_KEY;
      if (!apiKey || apiKey === 'undefined') {
        throw new Error("API Key nahi mil rahi. Vercel dashboard mein check karein.");
      }
      addLog("API Key detected.");

      // 3. Context Setup
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      // 4. Live API Connection
      const ai = new GoogleGenAI({ apiKey });
      const voiceName = gender === 'female' ? 'Kore' : 'Puck';
      const persona = gender === 'female' ? "Badi Behen" : "Bada Bhai";

      addLog("Server se link ho rahe hain...");
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setPermissionState('granted');
            setCallStatus('Connected');
            addLog("Connection successful!");
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
            if (permissionState === 'connecting') {
              setPermissionState('error');
              setErrorMessage('Server connection closed prematurely.');
              addLog(`Error code: ${e.code || 'Unknown'}`);
            } else {
              onClose();
            }
          },
          onerror: (e: any) => {
            console.error('API Error:', e);
            setPermissionState('error');
            setErrorMessage('Vercel API link fail ho gaya.');
            addLog(`API Error: ${e.message || 'Check Billing/Key'}`);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `Aap Sahara hain, user ke ${persona}. Role: Empathic sibling. Tone: Protective, safe, warm. Use Hinglish. Keep it real.`,
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Handled Startup Error:', err);
      setPermissionState('error');
      setErrorMessage(err.message || 'Connection startup failed.');
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
        <div className="relative mb-12 animate-float">
          <div className={`absolute -inset-10 blur-[80px] opacity-20 rounded-full ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
          <div className={`w-32 h-32 rounded-full border-4 border-dashed transition-all duration-700 
            ${(permissionState === 'requesting' || permissionState === 'connecting') ? 'border-emerald-500 animate-spin' : 
              permissionState === 'denied' ? 'border-red-500' : 
              permissionState === 'error' ? 'border-orange-500' : 'border-slate-800'}`} 
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl transition-all duration-500 
              ${permissionState === 'denied' || permissionState === 'error' ? 'bg-red-600/20 text-red-500' : 'bg-slate-900'}`}>
              {permissionState === 'denied' ? '🚫' : (permissionState === 'error' ? '⚠️' : (gender === 'female' ? '👩‍💼' : '👨‍💼'))}
            </div>
          </div>
        </div>
        
        <div className="space-y-4 max-w-sm mx-auto mb-10">
          <h2 className="text-3xl font-black tracking-tight italic">
            {permissionState === 'connecting' ? 'Connecting...' : 
             permissionState === 'denied' ? 'Mic Blocked' : 
             permissionState === 'error' ? 'Vercel Config Error' : 'Secure Call Mode'}
          </h2>
          
          <div className="bg-slate-900/80 rounded-2xl p-6 border border-white/5 backdrop-blur-xl shadow-2xl">
            {permissionState === 'error' ? (
              <div className="text-left space-y-3">
                <p className="text-orange-400 font-black text-sm uppercase tracking-wider">Troubleshooting Guide:</p>
                <ul className="text-slate-400 text-[11px] space-y-2 list-disc pl-4">
                  <li>Vercel Dashboard > Settings > <b>Environment Variables</b> check karein.</li>
                  <li>Variable ka naam exactly <b>API_KEY</b> hona chahiye.</li>
                  <li>Check karein ki "Production" aur "Preview" dono checkboxes ticked hain.</li>
                  <li>Changes ke baad <b>Redeploy</b> karna zaroori hai.</li>
                </ul>
                <div className="mt-4 p-2 bg-black/40 rounded border border-white/5 font-mono text-[9px] text-slate-500 overflow-hidden">
                  {debugLog.map((log, i) => <div key={i} className="truncate">>{log}</div>)}
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-sm leading-relaxed">
                {permissionState === 'pending' && `Click karein call shuru karne ke liye. Humari baatein private rahengi.`}
                {permissionState === 'requesting' && 'Permission mangi ja rahi hai...'}
                {permissionState === 'connecting' && 'Sahara server se connect ho rahi hai...'}
                {permissionState === 'denied' && 'Lock (🔒) icon se mic Allow karein.'}
              </p>
            )}
          </div>
        </div>

        <div className="w-full max-w-xs space-y-3">
          <button 
            onClick={handleStartCall}
            disabled={permissionState === 'requesting' || permissionState === 'connecting'}
            className={`w-full py-5 rounded-2xl font-black text-lg active:scale-95 transition-all flex items-center justify-center gap-4 disabled:opacity-50
              ${permissionState === 'denied' || permissionState === 'error' ? 'bg-white text-black' : 
                gender === 'female' ? 'bg-rose-600' : 'bg-indigo-600'}`}
          >
            {permissionState === 'connecting' ? 'Wait Karein...' : 'Start Call Now'}
          </button>
          <button onClick={() => window.location.reload()} className="w-full py-3 text-[10px] font-black uppercase tracking-[0.3em] text-slate-600 hover:text-white transition-colors">Hard Refresh</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-between py-12 px-8 bg-[#030712] text-white">
      <div className="text-center">
        <div className="bg-emerald-500/10 text-emerald-500 text-[10px] font-black px-4 py-1.5 rounded-full border border-emerald-500/20 mb-6 inline-block uppercase tracking-widest animate-pulse">
          Secure Line Active
        </div>
        <h2 className="text-4xl font-black tracking-tighter mb-1">{gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}</h2>
        <p className="text-sm font-bold tracking-widest font-mono text-slate-500">{formatDuration(duration)}</p>
      </div>

      <div className="relative w-full flex flex-col items-center">
        <div className={`absolute w-80 h-80 blur-[120px] rounded-full opacity-20 transition-all duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'} ${isModelSpeaking ? 'scale-150 opacity-40' : 'scale-100'}`} />
        <div className={`relative z-10 w-56 h-72 rounded-[3.5rem] bg-gradient-to-b from-white/10 to-transparent border border-white/5 flex flex-col items-center justify-center shadow-2xl transition-all duration-500 ${isModelSpeaking ? 'scale-110' : 'scale-100'}`}>
          <div className="text-[110px] mb-4 select-none animate-float drop-shadow-2xl">{gender === 'female' ? '👩‍💼' : '👨‍💼'}</div>
        </div>
        
        <div className="flex items-center justify-center gap-1 h-20 w-full mt-8 px-6">
          {waveformData.map((h, i) => (
            <div key={i} className={`w-1 rounded-full transition-all duration-75 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`}
              style={{ height: `${Math.max(4, h)}%`, opacity: isModelSpeaking ? 1 : 0.1 }}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-sm flex items-center justify-center gap-8">
        <button onClick={() => setIsMuted(!isMuted)} className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-red-500 text-white' : 'bg-slate-900 border border-white/10 text-white'}`}>
          {isMuted ? '🔇' : '🎤'}
        </button>
        <button onClick={onClose} className="w-20 h-20 bg-white text-black rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-transform">
          <svg className="h-10 w-10 rotate-[135deg]" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
        </button>
        <button className="w-14 h-14 rounded-full bg-slate-900 border border-white/10 text-slate-700">🔒</button>
      </div>
    </div>
  );
};

export default VoiceCall;
