
import React, { useState } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Gender, Message, ViewMode } from './types';
import ChatInterface from './components/ChatInterface';
import Onboarding from './components/Onboarding';
import Header from './components/Header';
import VoiceCall from './components/VoiceCall';

const App: React.FC = () => {
  const [gender, setGender] = useState<Gender>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('onboarding');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const handleGenderSelect = (selectedGender: Gender) => {
    setGender(selectedGender);
    setViewMode('chat');
    
    const initialText = selectedGender === 'female' 
      ? "Namaste meri pyaari behen. Main Sahara hoon. Dekho, tum mujhse kisi bhi cheez ke baare mein baat kar sakti ho. Main tumhari badi behen ki tarah tumhari har baat sunungi. Kya hua hai? Khul kar batao."
      : "Namaste mere bhai. Main Sahara hoon. Main tumhara bada bhai hoon, aur tum mujhse kuch bhi share kar sakte ho bina kisi darr ke. Kya baat hai? Batao mujhe.";
    
    setMessages([{
      id: 'initial',
      role: 'model',
      text: initialText,
      timestamp: new Date()
    }]);
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const apiKey = process.env.API_KEY || '';
      if (!apiKey || apiKey === 'undefined') {
        throw new Error("API Key missing on client side. Check Vercel environment variables.");
      }

      const ai = new GoogleGenAI({ apiKey });
      const persona = gender === 'female' ? "Elder Sister (Badi Behen)" : "Elder Brother (Bada Bhai)";
      
      const systemInstruction = `Role: You are Sahara, a real ${persona}. Tone: Supportive, protective, non-judgmental. Use Hinglish naturally. Phrases: "Main hoon na", "Daro mat", "Sab theek ho jayega". Audience: A young person in India. Keep it empathic and helpful.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: messages.concat(userMessage).map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
        config: { systemInstruction, temperature: 0.8 }
      });

      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: response.text || "Main sun rahi hoon, batao...",
        timestamp: new Date()
      }]);
    } catch (error: any) {
      console.error("Chat Error:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: "Maaf karna, connection mein thodi dikkat aa rahi hai. Kya aap check kar sakte hain ki internet theek hai? (Technical Error: " + (error.message || "Unknown") + ")",
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("Conversation clear karke naya start karein?")) {
      setGender(null);
      setMessages([]);
      setViewMode('onboarding');
    }
  };

  return (
    <div className="relative flex flex-col h-screen max-w-lg mx-auto bg-white shadow-2xl overflow-hidden border-x border-slate-100">
      {/* Background Drift Blobs */}
      <div className={`drift-blob w-72 h-72 top-20 -left-20 rounded-full transition-colors duration-1000 ${gender === 'female' ? 'bg-rose-200' : 'bg-indigo-200'}`} />
      <div className={`drift-blob w-80 h-80 bottom-20 -right-20 rounded-full transition-colors duration-1000 ${gender === 'female' ? 'bg-pink-200' : 'bg-blue-200'}`} style={{ animationDelay: '5s' }} />

      <Header 
        viewMode={viewMode} 
        onReset={handleReset} 
        onToggleVoice={() => setViewMode(prev => prev === 'voice' ? 'chat' : 'voice')}
        gender={gender}
      />
      
      <main className="flex-1 overflow-hidden relative flex flex-col bg-transparent">
        {viewMode === 'onboarding' && <Onboarding onSelect={handleGenderSelect} />}
        {viewMode === 'chat' && <ChatInterface messages={messages} isTyping={isTyping} onSend={handleSendMessage} gender={gender} onStartVoice={() => setViewMode('voice')} />}
        {viewMode === 'voice' && <VoiceCall gender={gender} onClose={() => setViewMode('chat')} />}
      </main>

      <footer className="p-2 text-center text-[9px] text-slate-300 font-bold uppercase tracking-widest border-t border-slate-50">
        Sahara Private & Secure Experience
      </footer>
    </div>
  );
};

export default App;
