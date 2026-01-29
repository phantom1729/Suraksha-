
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
    setCallStatus('Microphone check kar rahe hain...');
    setErrorMessage('');
    
    let stream: MediaStream;
    try {
      // Step 1: Request Mic specifically
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      console.error('Mic Access Denied:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionState('denied');
        setErrorMessage('Aapne Mic permission block ki hai. Browser settings check karein.');
      } else {
        setPermissionState('error');
        setErrorMessage('Mic hardware nahi mil raha ya busy hai.');
      }
      return;
    }

    // Step 2: Transition to connecting state
    setPermissionState('connecting');
    setCallStatus('Sahara se connect ho rahe hain...');

    try {
      // Step 3: Setup Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      // Step 4: Connect to Gemini
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
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
          onclose: () => onClose(),
          onerror: (e) => {
            console.error('Session Connection Error:', e);
            setPermissionState('error');
            setErrorMessage('Server connection fail ho gayi. Internet check karein.');
            setCallStatus('Disconnected');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `Aap Sahara hain, user ke ${persona}. Tone: Supportive, protective sibling. Use Hinglish naturally. Keep responses concise and focus on helping the user feel safe.`,
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err: any) {
      console.error('API Connection Failure:', err);
      setPermissionState('error');
      setErrorMessage(err.message || 'API connection mein issue hai. Please check key ya internet.');
      setCallStatus('Error occurred');
    }
  };

  useEffect(() => {
    return () => {
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextsRef.current) {
        audioContextsRef.current.input.close();
        audioContextsRef.current.output.close();
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

  // Pre-call UI
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
                gender === 'female' ? 'bg-rose-500 shadow-rose-500/20' : 'bg-indigo-500 shadow-indigo-500/20'}`}>
              {permissionState === 'denied' ? '🚫' : (permissionState === 'error' ? '⚠️' : (gender === 'female' ? '👩‍💼' : '👨‍💼'))}
            </div>
          </div>
        </div>
        
        <div className="space-y-4 max-w-sm mx-auto mb-12">
          <h2 className="text-3xl font-black tracking-tight">
            {permissionState === 'connecting' ? 'Connecting...' : 
             permissionState === 'denied' ? 'Mic Access Blocked' : 
             permissionState === 'error' ? 'Kuch Masla Hua' : 'Sahara Voice Call'}
          </h2>
          
          <div className="bg-white/5 rounded-2xl p-5 border border-white/10 shadow-lg">
            <p className="text-slate-400 text-sm leading-relaxed">
              {permissionState === 'pending' && `Call shuru karne ke liye niche button dabaein aur "Allow Mic" karein.`}
              {permissionState === 'requesting' && 'Microphone permission mangi ja rahi hai...'}
              {permissionState === 'connecting' && 'Sahara AI se server connect ho raha hai, bas ek pal...'}
              {permissionState === 'denied' && (
                <>
                  Mic access block hai. Address bar ke upar <strong>Lock (🔒) icon</strong> pe click karke mic <strong>Allow</strong> karein.
                </>
              )}
              {permissionState === 'error' && (
                <span className="text-orange-400 font-bold">{errorMessage}</span>
              )}
            </p>
          </div>
        </div>

        <div className="w-full max-w-xs space-y-4">
          <button 
            onClick={handleStartCall}
            disabled={permissionState === 'requesting' || permissionState === 'connecting'}
            className={`group w-full py-5 rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 disabled:opacity-50
              ${permissionState === 'denied' || permissionState === 'error' ? 'bg-red-600 hover:bg-red-500 shadow-red-500/40' : 
                gender === 'female' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {(permissionState === 'requesting' || permissionState === 'connecting') ? (
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Wait Karein...
              </div>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {permissionState === 'denied' || permissionState === 'error' ? 'Retry Connection' : 'Call Start Karein'}
              </>
            )}
          </button>

          {(permissionState === 'denied' || permissionState === 'error') && (
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-black hover:bg-white/10 transition-all"
            >
              Reload Website
            </button>
          )}
        </div>

        <button onClick={onClose} className="mt-12 text-slate-500 font-black uppercase tracking-[0.2em] text-[10px] hover:text-white transition-colors">Abhi Nahi / Back</button>
      </div>
    );
  }

  // Active Call UI
  return (
    <div className="flex-1 flex flex-col items-center justify-between py-16 px-8 bg-[#030712] text-white animate-in fade-in duration-700">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.4em] text-white/20 mb-4">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
          Secured Voice Line
        </div>
        <h2 className="text-4xl font-black tracking-tighter mb-1">
          {gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}
        </h2>
        <p className={`text-sm font-bold tracking-widest font-mono ${callStatus === 'Connected' ? 'text-emerald-400' : 'text-slate-500'}`}>
          {callStatus === 'Connected' ? formatDuration(duration) : callStatus}
        </p>
      </div>

      <div className="relative w-full flex flex-col items-center">
        <div className={`absolute w-80 h-80 blur-[130px] rounded-full opacity-30 transition-all duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'} ${isModelSpeaking ? 'scale-125' : 'scale-90'}`} />
        <div className={`relative z-10 w-60 h-80 rounded-[4rem] bg-gradient-to-b from-white/10 to-transparent backdrop-blur-3xl border border-white/5 flex flex-col items-center justify-center shadow-2xl transition-all duration-500 ${isModelSpeaking ? 'scale-105 border-white/20' : 'scale-100'}`}>
          <div className="text-[130px] mb-4 select-none animate-float drop-shadow-2xl">
            {gender === 'female' ? '👩‍💼' : '👨‍💼'}
          </div>
        </div>
        <div className="flex items-center justify-center gap-[3px] h-24 w-full mt-12 px-6">
          {waveformData.map((h, i) => (
            <div key={i} className={`w-1 rounded-full transition-all duration-150 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`}
              style={{ height: `${h}%`, opacity: isModelSpeaking ? 1 : 0.1, filter: isModelSpeaking ? `drop-shadow(0 0 8px ${gender === 'female' ? '#fb7185' : '#818cf8'})` : 'none' }}
            />
          ))}
        </div>
      </div>

      <div className="w-full max-w-sm flex items-center justify-center gap-12 mb-4">
        <div className="flex flex-col items-center gap-3">
          <button onClick={() => setIsMuted(!isMuted)}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${isMuted ? 'bg-white text-black' : 'bg-white/5 border border-white/10 text-white'}`}
          >
            {isMuted ? <svg className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                   : <svg className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" /></svg>}
          </button>
          <span className="text-[10px] font-black uppercase text-white/20">{isMuted ? 'Muted' : 'Mute'}</span>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button onClick={onClose} className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-2xl shadow-red-500/40 hover:bg-red-500 transition-all">
            <svg className="h-10 w-10 rotate-[135deg]" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
          </button>
          <span className="text-[10px] font-black uppercase text-red-500">End</span>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button className="w-16 h-16 rounded-full bg-white/5 border border-white/10 text-white/20 flex items-center justify-center cursor-not-allowed">
            <svg className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
          </button>
          <span className="text-[10px] font-black uppercase text-white/10">Info</span>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `.animate-float { animation: float 6s ease-in-out infinite; } @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-20px); } }`}} />
    </div>
  );
};

export default VoiceCall;
