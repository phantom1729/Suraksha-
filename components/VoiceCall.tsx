
import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  const [permissionState, setPermissionState] = useState<'pending' | 'requesting' | 'granted' | 'denied'>('pending');
  const [isMuted, setIsMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('Ready to connect');
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

  const startCall = useCallback(async () => {
    setPermissionState('requesting');
    setCallStatus('Connecting...');
    
    try {
      // Direct user action to trigger browser mic prompt
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermissionState('granted');

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      const voiceName = gender === 'female' ? 'Kore' : 'Puck';
      const persona = gender === 'female' ? "Elder Sister (Badi Behen)" : "Elder Brother (Bada Bhai)";

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setCallStatus('Connected');
            timerRef.current = window.setInterval(() => {
              setDuration(prev => prev + 1);
            }, 1000);

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
              
              setWaveformData(Array.from({ length: 40 }, () => Math.random() * 70 + 30));
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
            console.error(e);
            setCallStatus('Call Error');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `Aap Sahara hain, user ke ${persona}. Ye ek real call hai. 
          Badi behen/bhai ki tarah baat karein. Hinglish use karein. Natural banein. 
          Fillers use karein like 'Hmm', 'Theek hai', 'Suno'. 
          Make them feel secure and heard.`,
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setPermissionState('denied');
    }
  }, [gender, onClose, isMuted]);

  useEffect(() => {
    // Try auto-prompting once
    startCall();
    
    return () => {
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextsRef.current) {
        audioContextsRef.current.input.close();
        audioContextsRef.current.output.close();
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Idle waveform animation
  useEffect(() => {
    if (!isModelSpeaking) {
      const interval = setInterval(() => {
        setWaveformData(prev => prev.map(v => Math.max(4, v * 0.85)));
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isModelSpeaking]);

  if (permissionState === 'pending' || permissionState === 'requesting') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-white text-center">
        <div className="relative mb-12">
          <div className="w-32 h-32 rounded-full border-2 border-white/10 animate-[ping_3s_infinite]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-24 h-24 rounded-full flex items-center justify-center text-5xl shadow-2xl ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`}>
              {gender === 'female' ? '👩‍💼' : '👨‍💼'}
            </div>
          </div>
        </div>
        <h2 className="text-2xl font-black mb-2">Connecting to Sahara</h2>
        <p className="text-slate-400 text-sm mb-12 max-w-xs mx-auto">
          Aapki line secure ki ja rahi hai. Please browser mein 'Allow' par click karein.
        </p>
        {permissionState === 'pending' && (
          <button 
            onClick={startCall}
            className={`w-full max-w-xs py-4 rounded-2xl font-bold shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 ${gender === 'female' ? 'bg-rose-600' : 'bg-indigo-600'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            Start Call Now
          </button>
        )}
        <button onClick={onClose} className="mt-8 text-slate-500 font-bold uppercase tracking-widest text-[10px]">Back to Chat</button>
      </div>
    );
  }

  if (permissionState === 'denied') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-white text-center">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-8 border border-red-500/40">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-4">Mic Blocked Hai</h2>
        <p className="text-slate-400 mb-8 text-sm leading-relaxed">
          Call karne ke liye aapko browser setting mein jaakar mic 'Allow' karna hoga. 
          Aapke address bar mein upar ek icon dikhega, waha se permission on karein.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="w-full max-w-xs bg-white text-black font-bold py-4 rounded-2xl active:scale-95 transition-all"
        >
          Setting Update Karke Refresh Karein
        </button>
        <button onClick={onClose} className="mt-6 text-slate-500 font-bold uppercase tracking-widest text-[10px]">Wapas Jayein</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-between py-16 px-8 bg-[#050505] text-white animate-in fade-in duration-1000">
      
      {/* Top Section */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.4em] text-white/20 mb-6">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Private & Secure Call
        </div>
        <h2 className="text-4xl font-black tracking-tighter drop-shadow-2xl mb-1">
          {gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}
        </h2>
        <p className={`text-sm font-bold transition-all duration-500 ${callStatus === 'Connected' ? 'text-emerald-400' : 'text-slate-500'}`}>
          {callStatus === 'Connected' ? formatDuration(duration) : callStatus}
        </p>
      </div>

      {/* Avatar Display */}
      <div className="relative w-full flex flex-col items-center">
        <div className={`absolute w-72 h-72 blur-[120px] rounded-full opacity-30 transition-all duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'} ${isModelSpeaking ? 'scale-150' : 'scale-100'}`} />
        
        <div className={`relative z-10 w-56 h-72 rounded-[4rem] bg-gradient-to-b from-white/10 to-transparent backdrop-blur-3xl border border-white/5 flex flex-col items-center justify-center shadow-2xl transition-all duration-500 ${isModelSpeaking ? 'scale-105 border-white/20' : 'scale-100'}`}>
          <div className="text-[120px] mb-4 select-none filter drop-shadow-2xl animate-float">
            {gender === 'female' ? '👩‍💼' : '👨‍💼'}
          </div>
          {isModelSpeaking && (
            <div className="absolute inset-0 rounded-[4rem] border-2 border-white/10 animate-ping opacity-10" />
          )}
        </div>

        {/* Dynamic Waveform */}
        <div className="flex items-center justify-center gap-1.5 h-20 w-full mt-12 px-10">
          {waveformData.map((h, i) => (
            <div 
              key={i} 
              className={`w-1 rounded-full transition-all duration-150 ${gender === 'female' ? 'bg-rose-400' : 'bg-indigo-400'}`}
              style={{ 
                height: `${h}%`,
                opacity: isModelSpeaking ? 0.9 : 0.15,
                boxShadow: isModelSpeaking ? `0 0 10px ${gender === 'female' ? '#fb7185' : '#818cf8'}` : 'none'
              }}
            />
          ))}
        </div>
      </div>

      {/* Call Buttons */}
      <div className="w-full max-w-sm flex items-center justify-center gap-10 mb-6">
        <div className="flex flex-col items-center gap-3">
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-90 ${isMuted ? 'bg-white text-black' : 'bg-white/5 border border-white/10 text-white hover:bg-white/10'}`}
          >
            {isMuted ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-white/30">{isMuted ? 'Unmuted' : 'Mute'}</span>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button 
            onClick={onClose}
            className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-[0_20px_40px_rgba(220,38,38,0.4)] hover:bg-red-500 transition-all active:scale-95"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 rotate-[135deg]" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
            </svg>
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-red-500">End</span>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button className="w-16 h-16 rounded-full bg-white/5 border border-white/10 text-white/20 flex items-center justify-center cursor-not-allowed">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-white/10">Speaker</span>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-15px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
      `}} />
    </div>
  );
};

export default VoiceCall;
