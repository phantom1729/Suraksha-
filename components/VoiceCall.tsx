
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
  const [permissionState, setPermissionState] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [isMuted, setIsMuted] = useState(false);
  const [callStatus, setCallStatus] = useState('Dialing...');
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [waveformData, setWaveformData] = useState<number[]>(new Array(40).fill(5));
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  const startCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermissionState('granted');
      setCallStatus('Connecting...');

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
            setCallStatus('00:01'); // Start call timer or active state
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
            setCallStatus('Call Failed');
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `You are Sahara, a real ${persona} on a phone call. Be very professional yet deeply caring. Use Hinglish. Use natural fillers like "Hmm", "Suno", "Bilkul". Don't sound like an AI. Make them feel safe.`,
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setPermissionState('denied');
    }
  }, [gender, onClose, isMuted]);

  useEffect(() => {
    startCall();
    
    // Waveform simulation for professional look
    const updateWave = () => {
      setWaveformData(prev => prev.map(() => 
        isModelSpeaking ? Math.random() * 60 + 20 : Math.random() * 10 + 5
      ));
      animationFrameRef.current = requestAnimationFrame(updateWave);
    };
    animationFrameRef.current = requestAnimationFrame(updateWave);

    return () => {
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextsRef.current) {
        audioContextsRef.current.input.close();
        audioContextsRef.current.output.close();
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [startCall, isModelSpeaking]);

  if (permissionState === 'denied') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 text-white text-center">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border border-red-500/50 animate-pulse">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-2">Microphone Permission Chahiye</h2>
        <p className="text-slate-400 text-sm mb-8">Baat karne ke liye aapko browser mein mic allow karna hoga. Bina mic ke call nahi ho payegi.</p>
        <button 
          onClick={() => window.location.reload()}
          className="w-full bg-white text-black font-bold py-4 rounded-2xl active:scale-95 transition-all shadow-lg"
        >
          Try Again / Refresh
        </button>
        <button onClick={onClose} className="mt-4 text-slate-500 font-medium text-sm">Piche Jayein</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-between py-12 px-8 bg-slate-950 text-white animate-in fade-in duration-500">
      
      {/* Header Info */}
      <div className="text-center space-y-2 mt-4">
        <p className="text-[10px] font-bold tracking-[0.4em] text-white/40 uppercase">Encrypted Connection</p>
        <h2 className="text-3xl font-black tracking-tight">
          {gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}
        </h2>
        <p className={`text-sm font-medium transition-colors duration-500 ${callStatus === 'Dialing...' ? 'text-yellow-400' : 'text-green-400'}`}>
          {callStatus}
        </p>
      </div>

      {/* Main Avatar Area */}
      <div className="relative flex flex-col items-center">
        <div className={`absolute -inset-20 blur-[100px] opacity-20 rounded-full transition-colors duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'} ${isModelSpeaking ? 'scale-150' : 'scale-100'}`} />
        
        <div className={`w-52 h-52 rounded-[4rem] glass-call flex items-center justify-center transition-all duration-700 relative z-10 border border-white/10 ${isModelSpeaking ? 'scale-105 shadow-[0_0_50px_rgba(255,255,255,0.1)]' : ''}`}>
          <span className="text-8xl animate-float">
            {gender === 'female' ? '👩‍💼' : '👨‍💼'}
          </span>
          {isModelSpeaking && (
            <div className="absolute inset-0 rounded-[4rem] border-2 border-white/20 animate-ping opacity-20" />
          )}
        </div>

        {/* Professional Visualizer Bars */}
        <div className="flex items-center gap-1.5 h-16 mt-12 w-48">
          {waveformData.map((h, i) => (
            <div 
              key={i} 
              className={`w-1 rounded-full transition-all duration-100 ${gender === 'female' ? 'bg-rose-400' : 'bg-indigo-400'}`}
              style={{ height: `${h}%`, opacity: 0.3 + (h/100) }}
            />
          ))}
        </div>
      </div>

      {/* Control Buttons (Phone Style) */}
      <div className="w-full flex flex-col items-center gap-10 mb-8">
        <div className="flex gap-10">
          {/* Mute Button */}
          <div className="flex flex-col items-center gap-2">
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className={`p-6 rounded-full glass-call border transition-all active:scale-90 ${isMuted ? 'bg-white text-black border-white' : 'border-white/10 text-white hover:bg-white/5'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
              </svg>
            </button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">{isMuted ? 'Unmute' : 'Mute'}</span>
          </div>

          {/* End Call Button */}
          <div className="flex flex-col items-center gap-2">
            <button 
              onClick={onClose}
              className="p-8 rounded-full bg-red-600 text-white shadow-2xl shadow-red-600/20 active:scale-95 transition-all hover:bg-red-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-9 w-9 rotate-[135deg]" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
              </svg>
            </button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">End Call</span>
          </div>

          {/* Speaker Button (Mocked) */}
          <div className="flex flex-col items-center gap-2">
            <button className="p-6 rounded-full border border-white/10 text-white/40 cursor-not-allowed">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">Speaker</span>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .glass-call {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 4s ease-in-out infinite;
        }
      `}} />
    </div>
  );
};

export default VoiceCall;
