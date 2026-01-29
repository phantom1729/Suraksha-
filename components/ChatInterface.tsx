
import React, { useRef, useEffect, useState } from 'react';
import { Message, Gender } from '../types';

interface ChatInterfaceProps {
  messages: Message[];
  isTyping: boolean;
  onSend: (text: string) => void;
  gender: Gender;
  onStartVoice: () => void;
}

const StreamingMessage: React.FC<{ text: string }> = ({ text }) => {
  const [displayedText, setDisplayedText] = useState('');
  
  useEffect(() => {
    let i = 0;
    const words = text.split(' ');
    const interval = setInterval(() => {
      if (i < words.length) {
        setDisplayedText(prev => prev + (prev ? ' ' : '') + words[i]);
        i++;
      } else {
        clearInterval(interval);
      }
    }, 40);
    return () => clearInterval(interval);
  }, [text]);

  return <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{displayedText}</p>;
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, isTyping, onSend, gender, onStartVoice }) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSend(input);
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth"
      >
        {messages.map((msg, idx) => (
          <div 
            key={msg.id} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2`}
          >
            <div 
              className={`max-w-[85%] p-4 shadow-sm ${
                msg.role === 'user' 
                  ? `${gender === 'female' ? 'bg-rose-600' : 'bg-indigo-600'} text-white rounded-2xl rounded-tr-none` 
                  : 'glass text-slate-800 rounded-2xl rounded-tl-none border border-white/50'
              }`}
            >
              {msg.role === 'model' && idx === messages.length - 1 && !isTyping ? (
                <StreamingMessage text={msg.text} />
              ) : (
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              )}
              <span className={`text-[9px] mt-2 block opacity-50 font-bold uppercase`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="glass p-4 rounded-2xl rounded-tl-none shadow-sm flex gap-1 items-center">
              <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></span>
              <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 glass border-t border-white/20">
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Apni baat batayein..."
            className="w-full border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-white/50 bg-white/50 text-slate-800 resize-none min-h-[50px] max-h-[150px] placeholder-slate-400 text-sm shadow-inner"
            rows={1}
          />
          <button 
            type="submit"
            disabled={!input.trim() || isTyping}
            className={`${gender === 'female' ? 'bg-rose-600' : 'bg-indigo-600'} text-white p-3 rounded-full hover:brightness-110 disabled:grayscale transition-all shadow-lg flex-shrink-0 active:scale-90`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;
