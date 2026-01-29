
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Gender } from '../types';

interface VoiceCallProps {
  gender: Gender;
  onClose: () => void;
}

// Helpers for audio processing
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const VoiceCall: React.FC<VoiceCallProps> = ({ gender, onClose }) => {
  const [isConnecting, setIsConnecting] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState('Connecting...');
  const [waveformData, setWaveformData] = useState<number[]>(new Array(40).fill(2));
  
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const sessionRef = useRef<any>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);

  const startSession = useCallback(async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const persona = gender === 'female' ? "Empathetic Elder Sister (Badi Behen)" : "Empathetic Elder Brother (Bada Bhai)";
      const voiceName = gender === 'female' ? 'Kore' : 'Puck';

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setStatus('Active');
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64 = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64) {
              const outCtx = audioContextsRef.current!.output;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64), outCtx, 24000, 1);
              const source = outCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outCtx.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
              
              // Simple visualization reaction
              setWaveformData(Array.from({ length: 40 }, () => Math.random() * 30 + 5));
              setTimeout(() => setWaveformData(new Array(40).fill(2)), 500);
            }
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Live API Error:', e);
            setStatus('Connection Error');
          },
          onclose: () => onClose(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          systemInstruction: `Role: You are a ${persona} named Sahara. Tone: Extremely empathetic and supportive. Respond via audio in Hinglish. Never judge. Be a sibling.`,
        },
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setStatus('Mic permission required');
    }
  }, [gender, onClose, isMuted]);

  useEffect(() => {
    startSession();
    return () => {
      if (sessionRef.current) sessionRef.current.close();
      if (audioContextsRef.current) {
        audioContextsRef.current.input.close();
        audioContextsRef.current.output.close();
      }
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-between p-8 bg-slate-900/40 backdrop-blur-2xl text-white">
      <div className="text-center mt-12 space-y-2">
        <p className="text-sm font-bold uppercase tracking-[0.3em] opacity-60">Voice Call</p>
        <h2 className="text-3xl font-black">{gender === 'female' ? 'Badi Behen' : 'Bada Bhai'}</h2>
        <p className={`text-xs font-bold ${status === 'Active' ? 'text-green-400' : 'text-yellow-400'} animate-pulse`}>
          {status}
        </p>
      </div>

      <div className="relative">
        {/* Pulsing Rings */}
        <div className={`absolute inset-0 rounded-full blur-2xl opacity-20 scale-150 transition-colors duration-1000 ${gender === 'female' ? 'bg-rose-500' : 'bg-indigo-500'}`} />
        <div className={`w-40 h-40 rounded-full flex items-center justify-center relative z-10 glass border-2 ${gender === 'female' ? 'border-rose-300' : 'border-indigo-300'} shadow-[0_0_50px_rgba(255,255,255,0.1)]`}>
          <span className="text-6xl animate-bounce">
            {gender === 'female' ? '👩‍💼' : '👨‍💼'}
          </span>
          <div className="absolute -inset-4 rounded-full border border-white/10 pulse-ring" />
          <div className="absolute -inset-8 rounded-full border border-white/5 pulse-ring [animation-delay:0.5s]" />
        </div>
      </div>

      {/* Visualizer */}
      <div className="flex items-center justify-center gap-[2px] h-20 w-full px-4">
        {waveformData.map((h, i) => (
          <div 
            key={i} 
            className={`waveform-bar w-1 rounded-full bg-white opacity-40`}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>

      <div className="flex items-center gap-6 mb-12">
        <button 
          onClick={() => setIsMuted(!isMuted)}
          className={`p-5 rounded-full glass transition-all active:scale-90 ${isMuted ? 'text-red-400 border-red-400/50' : 'text-white'}`}
        >
          {isMuted ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.983 5.983 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.983 3.983 0 0013 10a3.983 3.983 0 00-1.172-2.828a1 1 0 010-1.415z" clipRule="evenodd" />
            </svg>
          )}
        </button>

        <button 
          onClick={onClose}
          className="p-6 rounded-full bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.5)] active:scale-90"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 rotate-[135deg]" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
          </svg>
        </button>
      </div>
      
      <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">End-to-End Encrypted Session</p>
    </div>
  );
};

export default VoiceCall;
