
import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Gender } from '../types';

interface VoiceCallProps {
  gender: Gender;
  onClose: () => void;
}

// Helper: Securely log key status for debugging (only first 3 chars)
const getApiKeyInfo = () => {
  const key = process.env.API_KEY;
  if (!key) return "Missing";
  if (key === 'undefined') return "String 'undefined'";
  return `Exists (Starts with: ${key.substring(0, 3)}...)`;
};

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
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [callStatus, setCallStatus] = useState('Line Clear Hai');
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
    setCallStatus('Mic activation...');
    setErrorMessage('');
    setDebugInfo('');
    
    let stream: MediaStream;
    try {
      // 1. Mic Request (Hardware level)
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      console.error('Mic Error:', err);
      setPermissionState('denied');
      setErrorMessage('Mic access nahi mila. Browser settings check karein.');
      return;
    }

    // 2. Network/API Layer
    setPermissionState('connecting');
    setCallStatus('Connecting to Sahara...');

    try {
      const apiKey = process.env.API_KEY || '';
      
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      // Initialize AI
      const ai = new GoogleGenAI({ apiKey });
      const voiceName = gender === 'female' ? 'Kore' : 'Puck';
      const persona = gender === 'female' ? "Badi Behen" : "Bada Bhai";

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
            console.log('Close Event:', e);
            if (permissionState === 'connecting') {
              setPermissionState('error');
              setErrorMessage('Server connection rejected.');
              setDebugInfo(`Reason: ${e.reason || 'Unknown session close. Check API key in Vercel settings.'}`);
            } else {
              onClose();
            }
          },
          onerror: (e: any) => {
            console.error('API Error:', e);
            setPermissionState('error');
            setErrorMessage('API Issue Detected.');
            setDebugInfo(e.message || 'Key invalid ho sakti hai ya billing setup nahi hai.');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `Aap Sahara hain, user ke ${persona}. Role: Empathic sibling. Tone: Protective, safe, warm. Use Hinglish. Focus on being a listener first.`,
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('Fatal Catch:', err);
      setPermissionState('error');
      setErrorMessage('Connection failed at startup.');
      setDebugInfo(err.message || 'Check network or API availability.');
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
          <div className={`absolute -inset-10 blur-[80px] opacity-20 rounded-full animate-pulse ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
          <div className={`w-32 h-32 rounded-full border-2 border-dashed transition-all duration-700 
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
          <h2 className="text-2xl font-black tracking-tight uppercase italic">
            {permissionState === 'connecting' ? 'Verifying Link...' : 
             permissionState === 'denied' ? 'Access Denied' : 
             permissionState === 'error' ? 'Technical Issue' : 'Start Secure Call'}
          </h2>
          
          <div className="bg-slate-900/50 rounded-2xl p-6 border border-white/5 backdrop-blur-sm">
            <p className="text-slate-400 text-sm leading-relaxed">
              {permissionState === 'pending' && `Aapki call encrypted aur private hai. Baatein shuru karne ke liye button dabaein.`}
              {permissionState === 'requesting' && 'Microphone wake-up call...'}
              {permissionState === 'connecting' && 'Sahara server se handshake kar rahi hai...'}
              {permissionState === 'denied' && 'Mic blocked! Address bar mein "Lock" icon check karein.'}
              {permissionState === 'error' && (
                <>
                  <span className="text-orange-400 block font-black mb-1">{errorMessage}</span>
                  <span className="text-[10px] opacity-50 block font-mono bg-black/30 p-2 rounded mt-2">{debugInfo}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-4">
          <button 
            onClick={handleStartCall}
            disabled={permissionState === 'requesting' || permissionState === 'connecting'}
            className={`w-full py-5 rounded-2xl font-black text-lg active:scale-95 transition-all flex items-center justify-center gap-4 disabled:opacity-50
              ${permissionState === 'denied' || permissionState === 'error' ? 'bg-white text-black' : 
                gender === 'female' ? 'bg-rose-600 shadow-xl shadow-rose-900/20' : 'bg-indigo-600 shadow-xl shadow-indigo-900/20'}`}
          >
            {permissionState === 'connecting' ? 'Hold On...' : 'Connect Now'}
          </button>
          
          <div className="pt-4 flex flex-col gap-2">
            <button onClick={() => window.location.reload()} className="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-white transition-colors">Hard Reload</button>
            <button onClick={onClose} className="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-white transition-colors">Go Back</button>
          </div>
        </div>

        {/* Diagnostic Footer */}
        <div className="mt-8 opacity-20 text-[9px] font-mono">
          API Status: {getApiKeyInfo()}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-between py-12 px-8 bg-[#030712] text-white">
      <div className="text-center">
        <div className="bg-emerald-500/10 text-emerald-500 text-[10px] font-black px-3 py-1 rounded-full border border-emerald-500/20 mb-6 inline-block uppercase tracking-widest">
          Active Line
        </div>
        <h2 className="text-4xl font-black tracking-tighter mb-1">{gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}</h2>
        <p className="text-sm font-bold tracking-widest font-mono text-slate-500">{formatDuration(duration)}</p>
      </div>

      <div className="relative w-full flex flex-col items-center">
        <div className={`absolute w-80 h-80 blur-[120px] rounded-full opacity-20 transition-all duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'} ${isModelSpeaking ? 'scale-150 opacity-40' : 'scale-100'}`} />
        <div className={`relative z-10 w-56 h-72 rounded-[3.5rem] bg-gradient-to-b from-white/10 to-transparent border border-white/5 flex flex-col items-center justify-center shadow-2xl transition-all duration-500 ${isModelSpeaking ? 'scale-110' : 'scale-100'}`}>
          <div className="text-[110px] mb-4 select-none animate-float drop-shadow-2xl">{gender === 'female' ? '👩‍💼' : '👨‍💼'}</div>
        </div>
        
        {/* Visualizer */}
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
      <style dangerouslySetInnerHTML={{ __html: `.animate-float { animation: float 6s ease-in-out infinite; } @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }`}} />
    </div>
  );
};

export default VoiceCall;
